/**
 * Stage 4 - Generate the post copy.
 *
 * One LLM call per story. It returns several hooks and one body; we pick the
 * hook ourselves with plain rules, which is cheaper and more consistent than
 * asking the model which of its own lines is best.
 *
 * Two things rotate independently here: the SHAPE of the post (its skeleton,
 * see shapes.js) and the STYLE of its opening line. Six shapes against five
 * styles means the same pairing does not come round again for thirty posts.
 *
 * Cost per post so far: 1 call here, 1 in the humanizer's editor pass.
 */

import { createLogger } from '../lib/logger.js';
import { SYSTEM_PROMPT, OPENING_STYLES, buildUserPrompt } from './prompts.js';
import { POST_SHAPES, FALLBACK_SHAPE, getShape, normalizeParts, assemblePost } from './shapes.js';
import { pickBestHook } from './hook-scorer.js';

const log = createLogger('content-engine');

/** Keep hashtags inside the configured shape and drop the banned generic ones. */
function cleanHashtags(hashtags, rules) {
  const banned = new Set(rules.banned.map((tag) => tag.toLowerCase()));

  const cleaned = (hashtags ?? [])
    .map((tag) => String(tag).trim())
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .filter((tag) => /^#[A-Za-z][A-Za-z0-9]*$/.test(tag))
    .filter((tag) => !banned.has(tag.toLowerCase()));

  const unique = [...new Map(cleaned.map((tag) => [tag.toLowerCase(), tag])).values()];

  // Top up from the preferred list if the model was stingy.
  for (const tag of rules.preferred) {
    if (unique.length >= rules.min) break;
    if (!unique.some((existing) => existing.toLowerCase() === tag.toLowerCase())) unique.push(tag);
  }

  return unique.slice(0, rules.max);
}

export function createContentEngine({ config, llm, store }) {
  const settings = config.content;

  /**
   * Walk a list one step per post and remember where we got to.
   *
   * The counter lives in the store rather than in memory because every run is
   * a fresh process. If the store is empty the counter restarts at zero,
   * which is exactly how two consecutive posts ended up identical.
   */
  async function rotate(stateKey, names, known) {
    const usable = names.filter((name) => known[name]);
    if (!usable.length) return null;

    const index = Number(await store.getState(stateKey, 0));
    await store.setState(stateKey, index + 1);

    return usable[index % usable.length];
  }

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
      const shapeName = (await rotate('shapeRotationIndex', settings.postShapes, POST_SHAPES)) ?? FALLBACK_SHAPE;
      const style = (await rotate('styleRotationIndex', settings.openingStyles, OPENING_STYLES)) ?? 'blunt-claim';

      const result = await llm.chatJson({
        label: 'write-post',
        temperature: 0.95,
        maxTokens: 900,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          article,
          shape: shapeName,
          style,
          hookCount: settings.hookCandidates,
          hashtagRules: {
            min: settings.hashtagCount.min,
            max: settings.hashtagCount.max,
            preferred: settings.preferredHashtags,
            banned: settings.bannedHashtags,
          },
          learnings: await getLearnings(),
        }),
      });

      const { best, scored } = pickBestHook(result.hooks, settings.hookMaxChars);

      if (!best) throw new Error('The model returned no usable hook');

      const hashtags = cleanHashtags(result.hashtags, {
        min: settings.hashtagCount.min,
        max: settings.hashtagCount.max,
        preferred: settings.preferredHashtags,
        banned: settings.bannedHashtags,
      });

      const parts = normalizeParts(getShape(shapeName), result);

      const draft = {
        hook: best,
        shape: shapeName,
        parts,
        hashtags,
        text: assemblePost({ shapeName, hook: best, parts, hashtags }),
        meme: {
          topText: String(result.memeTopText ?? '').trim(),
          bottomText: String(result.memeBottomText ?? '').trim(),
          format: String(result.memeFormat ?? article.curation?.memeFormat ?? '').trim(),
        },
        openingStyle: style,
        shapeInstruction: getShape(shapeName).instruction,
        hookScoreboard: scored,
      };

      log.info('Draft written', {
        title: article.title,
        shape: shapeName,
        style,
        hookScore: scored[0]?.score,
        words: draft.text.split(/\s+/).length,
      });

      return draft;
    },
  };
}

export { pickBestHook, assemblePost };
export default { createContentEngine };
