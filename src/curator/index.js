/**
 * Stage 3 - Curate.
 *
 * This is where the agent reasons instead of sorting by date. It shortlists
 * cheaply, then spends exactly one LLM call to rank the shortlist and say out
 * loud why each pick is worth a post and what the angle should be.
 *
 * Whatever performed well recently (Stage 8) is fed back into this prompt, so
 * the agent's taste shifts over time instead of staying frozen.
 */

import { createLogger } from '../lib/logger.js';
import { scoreMemeability, extractTopics } from './meme-score.js';
import { FRAME_NAMES, UNKNOWN_FRAME, describeFrames } from './frames.js';

const log = createLogger('curator');

const SYSTEM_PROMPT = `You pick tech stories for the LinkedIn page of a
software engineer who builds with AI and ML. Their followers are engineers,
ML people and technical founders. They follow because each post explains
something real: how a thing works, what it costs, what breaks, what to do
differently. Dry humour when the facts are funny, never corporate.

Every story you pick has to give an engineer something to learn, use or
argue about that the headline does not already say: a mechanism, a number
that does not add up, a consequence for how they build, a detail most
readers will skip. Before you pick one, ask yourself: what would I teach or
claim about this that the reader does not know from the title? If the
answer is "nothing", do not pick it, however big the news is.

GOOD picks:
- a model, tool, API or technique whose inner workings the article explains
- something broke and the article says how (an outage, a data-loss bug, a
  bad deploy, an agent misbehaving)
- numbers that tell a story (cost, latency, scale, a price cut, a benchmark
  that does not hold up)
- a change that alters what an engineer should do, check or stop doing
- irony or hype meeting reality, when there is a real detail under it
- a founder's or company's technical bet with a clear turn in it

BAD picks, no matter how big the news:
- human extinction, AI doom, existential risk
- layoffs, people losing jobs, death, war
- lawsuits, regulation, policy with no technical detail
- funding rounds with no technical detail

FRAMES
Every story gets told from an angle. These are the ones this page uses:
${describeFrames()}

The page cannot be the same frame every time. Two "something failed" posts in
a row read as one miserable page with one opinion, even when the two stories
share no companies at all. If you are told a frame has been used recently,
pick something else unless the story is genuinely too good to pass up.

Rank them best first. The first ones get written; the last ones are spares,
used only if a story above them turns out to have less in it than it seemed.

For each story you pick, give:
  angle      the observation the post should make, in one sentence. A claim
             about what this means for people who build, not a summary and
             not a pun.
  joke       what is genuinely funny here, in a few words, or "" if nothing
             is. An empty joke is fine. A forced one is not.
  frame      one of: ${FRAME_NAMES.join(', ')}

Reply as JSON:
{"picks": [{"id": "...", "rank": 1, "reason": "why this beats the others",
"angle": "the take to argue", "joke": "what is funny about it",
"frame": "one of the frames above",
"memeFormat": "a meme framing in a few words"}]}`;

/**
 * Stop one kind of story taking over the shortlist.
 *
 * The soft score penalty handles continuity between runs, but it cannot help
 * inside a single run: if the eight highest-scoring stories are all failures,
 * the model has no other option to choose, whatever the prompt asks for. So
 * the list is filled in score order with a hard cap per frame, and only topped
 * up past the cap if there is nothing else left.
 *
 * @param {object[]} scored  articles sorted best first, each with a guessedFrame
 */
export function diversifyShortlist(scored, size, maxPerFrame) {
  const counts = new Map();
  const picked = [];
  const overflow = [];

  for (const article of scored) {
    const frame = article.guessedFrame;
    const used = counts.get(frame) ?? 0;

    // Stories we could not read are not a category, so capping them would
    // drop good stories for failing to match a keyword.
    if (frame !== UNKNOWN_FRAME && used >= maxPerFrame) {
      overflow.push(article);
      continue;
    }

    counts.set(frame, used + 1);
    picked.push(article);

    if (picked.length >= size) break;
  }

  // A thin day beats an empty one, so fall back to the plain ranking.
  return [...picked, ...overflow].slice(0, size);
}

export function createCurator({ config, llm, store }) {
  const settings = config.curator;

  /**
   * What we have covered recently, in both senses: the companies and the kind
   * of story. Newest first, so the callers that care about order get it.
   */
  async function getRecent() {
    const recent = await store.listRecentAttempted(settings.topicCooldownPosts);

    return {
      topics: recent.flatMap((post) => post.topics ?? []),
      frames: recent.map((post) => post.frame).filter(Boolean),
    };
  }

  /** A one-line summary of what has been working, fed back into the prompt. */
  async function getLearnings() {
    const learnings = await store.getState('learnings', null);
    if (!learnings?.summary) return '';

    return `\n\nWhat has performed well for this page recently:\n${learnings.summary}`;
  }

  return {
    /**
     * Pick the best stories to post about.
     *
     * @param {object[]} articles  classified, unused, recent articles
     * @param {number} count       how many posts we need
     */
    async curate(articles, count) {
      const relevant = articles.filter((article) => article.classification?.relevant);

      if (!relevant.length) {
        log.warn('Nothing relevant to curate');
        return [];
      }

      const recent = await getRecent();

      // Cheap pass: score everything, then fill the shortlist in score order
      // without letting one kind of story take it over.
      const scored = relevant
        .map((article) => ({ ...article, ...scoreMemeability(article, settings, recent) }))
        .sort((a, b) => b.memeScore - a.memeScore);

      const shortlist = diversifyShortlist(scored, settings.shortlistSize, settings.maxPerFrame);

      log.info('Shortlist built', {
        candidates: relevant.length,
        shortlisted: shortlist.length,
        topScore: shortlist[0]?.memeScore,
        frames: [...new Set(shortlist.map((article) => article.guessedFrame))],
        recentFrames: recent.frames,
      });

      // If we only need as many as we have, the model has nothing to choose
      // between. Skip the call and save the money.
      if (shortlist.length <= count) {
        return shortlist.map((article, index) => ({
          ...article,
          curation: {
            rank: index + 1,
            reason: `Only ${shortlist.length} candidates available. ${article.reasons.join('; ')}`,
            angle: '',
            joke: '',
            frame: article.guessedFrame,
            memeFormat: '',
            decidedBy: 'heuristic',
          },
        }));
      }

      const learnings = await getLearnings();

      const candidateList = shortlist.map((article) => [
        `id: ${article.id}`,
        `title: ${article.title}`,
        `summary: ${(article.summary ?? '').slice(0, 500)}`,
        `signals: ${article.reasons.join(', ') || 'none'}`,
      ].join('\n')).join('\n---\n');

      // Newest first, so "the last one" is unambiguous to the model.
      const frameNote = recent.frames.length
        ? `\n\nFrames used in the last ${recent.frames.length} posts, newest first: ${recent.frames.join(', ')}. Avoid repeating them.`
        : '';

      let picks = [];

      try {
        const result = await llm.chatJson({
          label: 'curate',
          temperature: 0.7,
          maxTokens: 700,
          system: SYSTEM_PROMPT + learnings,
          user: `Pick the best ${count} of these ${shortlist.length} stories.${frameNote}\n\n${candidateList}`,
        });
        picks = Array.isArray(result.picks) ? result.picks : [];
      } catch (error) {
        log.warn('LLM curation failed, falling back to the heuristic ranking', { error: error.message });
      }

      // Match the model's picks back to real articles. Anything it invented
      // is dropped; if it returns nothing useful we use our own ranking.
      const byId = new Map(shortlist.map((article) => [article.id, article]));

      const selected = picks
        .map((pick) => {
          const article = byId.get(pick.id);
          if (!article) return null;

          return {
            ...article,
            curation: {
              rank: Number(pick.rank) || 99,
              reason: String(pick.reason ?? ''),
              angle: String(pick.angle ?? ''),
              joke: String(pick.joke ?? ''),
              // Models invent frame names. Fall back to our own guess rather
              // than storing something the cooldown will never match again.
              frame: FRAME_NAMES.includes(pick.frame) ? pick.frame : article.guessedFrame,
              memeFormat: String(pick.memeFormat ?? ''),
              decidedBy: 'llm',
            },
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.curation.rank - b.curation.rank)
        .slice(0, count);

      if (selected.length) {
        log.info('Curated', { picked: selected.length, titles: selected.map((a) => a.title) });
        return selected;
      }

      return shortlist.slice(0, count).map((article, index) => ({
        ...article,
        curation: {
          rank: index + 1,
          reason: article.reasons.join('; ') || 'Highest heuristic score',
          angle: '',
          joke: '',
          frame: article.guessedFrame,
          memeFormat: '',
          decidedBy: 'heuristic',
        },
      }));
    },
  };
}

export { scoreMemeability, extractTopics };
export default { createCurator };
