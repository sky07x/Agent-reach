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

  return {
    /**
     * Write one post for one curated article.
     *
     * @returns draft with the copy, the chosen hook, and the meme text
     */
    async generate(article) {
      // Each rotation says how to rebuild its own counter from post history,
      // because they do not all advance once per post.
      const shapeName = (await rotate(
        'shapeRotationIndex', settings.postShapes, POST_SHAPES,
        (posts) => posts.filter((post) => post.shape).length,
      )) ?? FALLBACK_SHAPE;

      const style = (await rotate(
        'styleRotationIndex', settings.openingStyles, OPENING_STYLES,
        (posts) => posts.filter((post) => post.openingStyle).length,
      )) ?? 'blunt-claim';

      const shape = getShape(shapeName);

      // Shapes that end themselves do not consume a turn of the ending
      // rotation, so the endings stay evenly spread over the posts that
      // actually use one. That is also why this one counts posts that have a
      // closerStyle rather than posts in general.
      const closerStyle = shape.closer === 'rotate'
        ? (await rotate(
          'closerRotationIndex', settings.closerStyles, CLOSER_STYLES,
          (posts) => posts.filter((post) => post.closerStyle).length,
        )) ?? 'argument-bait'
        : null;

      const lengthMood = (await rotate(
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
    },
  };
}

export { pickBestHook, assemblePost };
export default { createContentEngine };
