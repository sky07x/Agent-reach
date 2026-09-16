/**
 * Stage 4 - Generate the post copy.
 *
 * One LLM call per story. It returns several hooks and one body; we pick the
 * hook ourselves with plain rules, which is cheaper and more consistent than
 * asking the model which of its own lines is best.
 *
 * Cost per post so far: 1 call here, 1 in the humanizer's editor pass.
 */

import { createLogger } from '../lib/logger.js';
import { SYSTEM_PROMPT, OPENING_STYLES, buildUserPrompt } from './prompts.js';
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

/** Glue the parts into the text that actually goes on LinkedIn. */
export function assemblePost({ hook, body, question, hashtags }) {
  return [hook, '', body.trim(), '', question.trim(), '', hashtags.join(' ')]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createContentEngine({ config, llm, store }) {
  const settings = config.content;

  /**
   * Rotate the opening style by how many posts we have made, so consecutive
   * posts never share a shape.
   */
  async function nextOpeningStyle() {
    const index = Number(await store.getState('styleRotationIndex', 0));
    const styles = settings.openingStyles.filter((style) => OPENING_STYLES[style]);
    const style = styles[index % styles.length];

    await store.setState('styleRotationIndex', index + 1);
    return style;
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
      const style = await nextOpeningStyle();

      const result = await llm.chatJson({
        label: 'write-post',
        temperature: 0.95,
        maxTokens: 900,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          article,
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

      const draft = {
        hook: best,
        body: String(result.body ?? '').trim(),
        question: String(result.question ?? '').trim(),
        hashtags,
        text: assemblePost({
          hook: best,
          body: String(result.body ?? ''),
          question: String(result.question ?? ''),
          hashtags,
        }),
        meme: {
          topText: String(result.memeTopText ?? '').trim(),
          bottomText: String(result.memeBottomText ?? '').trim(),
          format: String(result.memeFormat ?? article.curation?.memeFormat ?? '').trim(),
        },
        openingStyle: style,
        hookScoreboard: scored,
      };

      log.info('Draft written', {
        title: article.title,
        style,
        hookScore: scored[0]?.score,
        words: draft.text.split(/\s+/).length,
      });

      return draft;
    },
  };
}

export { pickBestHook, assemblePost as _assemblePost };
export default { createContentEngine };
