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

const log = createLogger('curator');

const SYSTEM_PROMPT = `You pick tech stories for a LinkedIn page that posts
like Fireship: fast, technical, funny, sarcastic, never corporate.

The page is a JOKE page for developers. Every story you pick has to have a
joke in it. Before you pick one, ask yourself: can I make a developer laugh
at this? If the answer is no, do not pick it, however important it is.

GOOD picks:
- something broke in a funny way (an outage, a data-loss bug, a bad deploy)
- an absurd number ($4B for 12 people, 400 pull requests in one night)
- irony (an AI company's AI fails, a security company gets hacked)
- hype meeting reality (a benchmark that nobody can reproduce)
- pain every developer knows (a breaking change, a deprecation, bad docs)
- a new tool developers will actually argue about

BAD picks, no matter how big the news:
- human extinction, AI doom, existential risk. No joke lives there.
- layoffs, people losing jobs, death, war. Punching down is not funny.
- lawsuits, regulation, policy. Boring and heavy.
- funding rounds with no technical detail.

For each story you pick, give:
  angle      the take the post should argue, in one sentence. A point of
             view, not a summary.
  joke       what is actually funny here, in a few words. If you cannot fill
             this in, you picked the wrong story.

Reply as JSON:
{"picks": [{"id": "...", "rank": 1, "reason": "why this beats the others",
"angle": "the take to argue", "joke": "what is funny about it",
"memeFormat": "a meme framing in a few words"}]}`;

export function createCurator({ config, llm, store }) {
  const settings = config.curator;

  /** Topics we have covered recently, so we don't repeat ourselves. */
  async function getRecentTopics() {
    const recent = await store.listRecentPublished(settings.topicCooldownPosts);
    return recent.flatMap((post) => post.topics ?? []);
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

      const recentTopics = await getRecentTopics();

      // Cheap pass: score everything, keep the top handful.
      const shortlist = relevant
        .map((article) => ({ ...article, ...scoreMemeability(article, settings, recentTopics) }))
        .sort((a, b) => b.memeScore - a.memeScore)
        .slice(0, settings.shortlistSize);

      log.info('Shortlist built', {
        candidates: relevant.length,
        shortlisted: shortlist.length,
        topScore: shortlist[0]?.memeScore,
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
            memeFormat: '',
            decidedBy: 'heuristic',
          },
        }));
      }

      const learnings = await getLearnings();

      const candidateList = shortlist.map((article) => [
        `id: ${article.id}`,
        `title: ${article.title}`,
        `summary: ${(article.summary ?? '').slice(0, 300)}`,
        `signals: ${article.reasons.join(', ') || 'none'}`,
      ].join('\n')).join('\n---\n');

      let picks = [];

      try {
        const result = await llm.chatJson({
          label: 'curate',
          temperature: 0.7,
          maxTokens: 700,
          system: SYSTEM_PROMPT + learnings,
          user: `Pick the best ${count} of these ${shortlist.length} stories.\n\n${candidateList}`,
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
          memeFormat: '',
          decidedBy: 'heuristic',
        },
      }));
    },
  };
}

export { scoreMemeability, extractTopics };
export default { createCurator };
