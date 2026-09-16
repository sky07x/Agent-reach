/**
 * Stage 4 - Generate the post copy.
 *
 * One LLM call per story. It returns several hooks and one body; we pick the
 * hook ourselves with plain rules, which is cheaper and more consistent than
 * asking the model which of its own lines is best.
 *
 * Four things rotate independently here: the SHAPE of the post (its skeleton),
 * the STYLE of its opening line, how it ENDS - including the option of not
 * ending with anything - and how LONG it runs. Six shapes against five styles
 * against six endings against four lengths means the same combination is
 * effectively out of reach. See shapes.js.
 *
 * Cost per post so far: 1 call here, 1 in the humanizer's editor pass.
 */

import { createLogger } from '../lib/logger.js';
import { createRotation } from '../lib/rotation.js';
import { SYSTEM_PROMPT, OPENING_STYLES, buildUserPrompt } from './prompts.js';
import {
  POST_SHAPES,
  CLOSER_STYLES,
  LENGTH_MOODS,
  FALLBACK_SHAPE,
  getShape,
  normalizeParts,
  assemblePost,
  getCloserStyle,
  targetWords,
} from './shapes.js';
import { pickBestHook } from './hook-scorer.js';
import { chooseHashtags, tagsForFrame } from './hashtags.js';
import { assessDraft } from './quality.js';

const log = createLogger('content-engine');

/** Words in the post itself. Hashtags are not prose and do not count. */
export function countWords(text) {
  return text
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('#'))
    .length;
}

export function createContentEngine({ config, llm, store }) {
  const settings = config.content;

  // Shared with the media picker, so both recover the same way when a store
  // turns up without its counters. See lib/rotation.js.
  const rotation = createRotation({ store });

  const rotate = (key, names, known, seed) => rotation.next({ key, names, known, seed });

  async function getLearnings() {
    const learnings = await store.getState('learnings', null);
    return learnings?.summary ?? '';
  }

  /**
   * Write one draft. Notes from a failed attempt are fed back in, so a retry
   * is told what was wrong rather than just rolling the dice again.
   */
  async function writeDraft(article, { notes, choices } = {}) {
      // A rewrite keeps the format it was given and only fixes the words.
      //
      // Letting the retry take fresh rotation values was wrong twice over: it
      // burned a slot in all four rotations for a post that never shipped,
      // and it applied feedback about the writing to a completely different
      // shape, so the note and the rewrite were about different posts.
      const reusing = Boolean(choices);

      // The rotation only walks shapes this story can actually carry. Handing
      // quote-reaction to a story with no quote in it is how a post went out
      // that said nothing at all.
      const shapeName = choices?.shapeName ?? (await rotation.next({
        key: 'shapeRotationIndex',
        names: settings.postShapes,
        known: POST_SHAPES,
        seed: (posts) => posts.filter((post) => post.shape).length,
        accept: (name) => POST_SHAPES[name].fits(article),
      })) ?? FALLBACK_SHAPE;

      if (!reusing) {
        const declined = settings.postShapes.filter((name) => POST_SHAPES[name] && !POST_SHAPES[name].fits(article));
        if (declined.length) log.debug('Shapes this story cannot carry', { declined });
      }

      const style = choices?.style ?? (await rotate(
        'styleRotationIndex', settings.openingStyles, OPENING_STYLES,
        (posts) => posts.filter((post) => post.openingStyle).length,
      )) ?? 'blunt-claim';

      const shape = getShape(shapeName);

      // Shapes that end themselves do not consume a turn of the ending
      // rotation, so the endings stay evenly spread over the posts that
      // actually use one. That is also why this one counts posts that have a
      // closerStyle rather than posts in general.
      const closerStyle = reusing ? choices.closerStyle : (shape.closer === 'rotate'
        ? (await rotate(
          'closerRotationIndex', settings.closerStyles, CLOSER_STYLES,
          (posts) => posts.filter((post) => post.closerStyle).length,
        )) ?? 'argument-bait'
        : null);

      const lengthMood = choices?.lengthMood ?? (await rotate(
        'lengthRotationIndex', settings.lengthMoods, LENGTH_MOODS,
        (posts) => posts.filter((post) => post.lengthMood).length,
      )) ?? 'mid';

      const result = await llm.chatJson({
        label: 'write-post',
        temperature: 0.95,
        maxTokens: 900,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          article,
          shape: shapeName,
          style,
          closerStyle,
          lengthMood,
          maxWords: settings.maxWords,
          hookCount: settings.hookCandidates,
          hashtagRules: {
            min: settings.hashtagCount.min,
            max: settings.hashtagCount.max,
            preferred: tagsForFrame(article.curation?.frame),
            banned: settings.bannedHashtags,
          },
          learnings: await getLearnings(),
          notes,
        }),
      });

      const { best, scored, contenders } = pickBestHook(result.hooks, {
        maxChars: settings.hookMaxChars,
        jitter: settings.hookJitter,
      });

      if (!best) throw new Error('The model returned no usable hook');

      // How many tags this post gets is itself rotated: twelve of the first
      // thirteen posts carried exactly three, which is its own small tell.
      const hashtagCount = Number(await rotate(
        'hashtagCountRotationIndex',
        settings.hashtagCounts.map(String),
        null,
        (posts) => posts.filter((post) => post.hashtags?.length).length,
      ) ?? settings.hashtagCount.min);

      const recent = await store.listRecentAttempted(settings.hashtagHistory);

      const hashtagPick = chooseHashtags({
        modelTags: result.hashtags,
        frame: article.curation?.frame,
        // The story in its own words decides the subject. The frame only
        // describes its shape, which is a different thing entirely.
        text: `${article.title} ${article.summary ?? ""}`,
        recentSets: recent.map((post) => post.hashtags ?? []),
        previousSet: recent[0]?.hashtags ?? [],
        count: hashtagCount,
        rules: {
          min: settings.hashtagCount.min,
          banned: settings.bannedHashtags,
          cooldown: settings.hashtagCooldown,
          maxShare: settings.hashtagMaxShare,
          setCooldown: settings.hashtagSetCooldown,
        },
      });

      const hashtags = hashtagPick.tags;

      const parts = normalizeParts(shape, result, closerStyle);
      const length = targetWords(shape, lengthMood, settings.maxWords);
      const text = assemblePost({ shapeName, hook: best, parts, hashtags });
      const words = countWords(text);

      const draft = {
        hook: best,
        shape: shapeName,
        parts,
        hashtags,
        text,
        words,
        lengthMood,
        targetWords: length.target,
        meme: {
          topText: String(result.memeTopText ?? '').trim(),
          bottomText: String(result.memeBottomText ?? '').trim(),
          format: String(result.memeFormat ?? article.curation?.memeFormat ?? '').trim(),
        },
        openingStyle: style,
        closerStyle,
        // What the humanizer's editor pass is told to respect, so it tightens
        // the prose instead of quietly restoring the closing question.
        shapeInstruction: [
          shape.instruction,
          closerStyle ? getCloserStyle(closerStyle).instruction : '',
          `Length: about ${length.target} words. Do not pad it back out.`,
        ].filter(Boolean).join('\n'),
        hookScoreboard: scored,
        hashtagReasons: hashtagPick.chosen,
      };

      // Not enforced by trimming: cutting a post to a word count mid-sentence
      // does more damage than the overrun does. Worth knowing about, though,
      // because a shape that always overshoots has a prompt that needs work.
      if (words > length.max) {
        log.warn('Post ran long', { shape: shapeName, words, ceiling: length.max });
      }

      log.info('Draft written', {
        title: article.title,
        shape: shapeName,
        style,
        closerStyle,
        lengthMood,
        words,
        target: length.target,
        hookScore: scored.find((entry) => entry.chosen)?.score,
        hookContenders: contenders,
        hashtags: hashtags.join(" "),
        hashtagsRelaxed: hashtagPick.relaxed,
      });

      return draft;
  }

  return {
    /**
     * Write one post for one curated article, and refuse to hand back
     * something not worth posting.
     *
     *  draft, carrying needsReview when it did not pass
     */
    async generate(article) {
      let draft = await writeDraft(article);
      let assessment = await assessDraft({ article, draft, llm, settings: settings.quality });

      // One retry, told exactly what was wrong. Two models disagreeing twice
      // is a signal about the story, not something more attempts will fix.
      if (!assessment.ok) {
        log.warn("Rewriting after a failed assessment", { problems: assessment.problems });

        draft = await writeDraft(article, {
          notes: assessment.problems,
          // Same shape, style, ending and length. Only the words change.
          choices: {
            shapeName: draft.shape,
            style: draft.openingStyle,
            closerStyle: draft.closerStyle,
            lengthMood: draft.lengthMood,
          },
        });
        assessment = await assessDraft({ article, draft, llm, settings: settings.quality });
      }

      draft.quality = assessment;
      draft.needsReview = !assessment.ok;

      if (!assessment.ok) {
        log.warn("Draft is not good enough to publish", {
          title: article.title,
          score: assessment.score,
          verdict: assessment.verdict,
          problems: assessment.problems,
        });
      }

      return draft;
    },
  };
}

export { pickBestHook, assemblePost };
export default { createContentEngine };
