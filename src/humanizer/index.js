/**
 * Stage 5 - Humanize.
 *
 * Two passes, in this order:
 *   1. Mechanical rules. Free, deterministic, catches the obvious tells.
 *   2. A cheap LLM "editor" pass. One focused prompt beats stuffing every
 *      style rule into the writing prompt and hoping.
 *
 * The rules run again after the editor, because editors reintroduce em-dashes.
 */

import { createLogger } from '../lib/logger.js';
import { applyRules, detectAiTells } from './rules.js';

const log = createLogger('humanizer');

/**
 * Split a trailing hashtag line off the post.
 *
 * The editor pass is a language model, and asking it to "keep the hashtags"
 * does not reliably work - it drops them perhaps half the time. So we take
 * them out of its reach entirely and put them back afterwards. Hashtags are
 * not prose, so there is nothing for the humanizer to improve about them.
 */
function splitOffHashtags(text) {
  const lines = text.trimEnd().split('\n');
  const last = lines[lines.length - 1].trim();

  // A hashtag line is nothing but hashtags separated by spaces.
  const isHashtagLine = last.length > 0 && /^#[A-Za-z][A-Za-z0-9]*(\s+#[A-Za-z][A-Za-z0-9]*)*$/.test(last);

  if (!isHashtagLine) return { prose: text, hashtagLine: '' };

  return {
    prose: lines.slice(0, -1).join('\n').trimEnd(),
    hashtagLine: last,
  };
}

/** Put the hashtag line back on the end. */
function reattachHashtags(prose, hashtagLine) {
  return hashtagLine ? `${prose.trimEnd()}\n\n${hashtagLine}` : prose;
}

const EDITOR_PROMPT = `You are an editor. You get a LinkedIn post that was
written by a language model and your job is to make it read like a human
developer typed it.

Keep: the meaning, the facts, the numbers, the hashtags.
Keep it roughly the same length or shorter.

Keep the structure exactly as you find it. The line breaks and the number of
paragraphs were chosen deliberately, and posts are built to different shapes
on purpose. Never merge lines into a paragraph, never split a paragraph up,
and never reflow a block of log or terminal output into prose. If the post
does not end with a question, it is not supposed to, so do not add one.

Change:
- Break up any rhythm where every sentence is the same length. Mix a long one
  with a three-word fragment.
- Replace anything that sounds like a press release with how a person talks.
- Delete words that add nothing. Models over-explain; people don't.
- Contractions everywhere. Lowercase is fine mid-post for emphasis.
- No em-dashes at all. Full stops and commas only.
- If a joke is explained, delete the explanation and keep the joke.

Do not add new claims. Do not add emoji. Do not add hashtags.
Reply with the edited post only, no preamble and no quotes around it.`;

export function createHumanizer({ config, llm }) {
  const settings = config.humanizer;

  return {
    /**
     * Clean up one post.
     *
     * @param {string} text
     * @param {object} [options]
     * @param {string} [options.shapeNote]  what shape the post was written to,
     *   so the editor tightens the prose instead of quietly rewriting a
     *   two-line zinger back into the usual four-paragraph post
     * @returns {Promise<{text: string, report: object}>}
     */
    async humanize(text, { shapeNote = '' } = {}) {
      // Hashtags are held aside for the whole process and reattached at the
      // end, so no pass can lose them.
      const { prose, hashtagLine } = splitOffHashtags(text);

      const firstPass = applyRules(prose, { maxEmDashes: settings.maxEmDashes });

      if (!settings.useLlmEditorPass) {
        log.info('Humanized with rules only', {
          removed: firstPass.changes.bannedPhrasesRemoved.length,
          remaining: firstPass.changes.remainingTells.length,
        });
        return {
          text: reattachHashtags(firstPass.text, hashtagLine),
          report: { ...firstPass.changes, editorPass: false },
        };
      }

      let edited = firstPass.text;

      try {
        const problems = firstPass.changes.remainingTells
          .map((issue) => `- ${issue.type}: ${issue.detail} (${issue.reason})`)
          .join('\n');

        const brief = [
          shapeNote ? `This post was written to a set shape. Respect it:\n${shapeNote}` : '',
          problems ? `Known problems to fix:\n${problems}` : '',
          `Post:\n${firstPass.text}`,
        ].filter(Boolean).join('\n\n');

        edited = await llm.chat({
          label: 'humanize-edit',
          temperature: 0.85,
          maxTokens: 600,
          system: EDITOR_PROMPT,
          user: brief,
        });
      } catch (error) {
        // The rules already did real work, so a failed editor pass is not fatal.
        log.warn('Editor pass failed, keeping the rule-cleaned version', { error: error.message });
        return {
          text: reattachHashtags(firstPass.text, hashtagLine),
          report: { ...firstPass.changes, editorPass: 'failed' },
        };
      }

      // Second rule pass: the editor often puts em-dashes straight back in.
      const secondPass = applyRules(edited.trim(), { maxEmDashes: settings.maxEmDashes });

      log.info('Humanized', {
        removedFirstPass: firstPass.changes.bannedPhrasesRemoved.length,
        removedSecondPass: secondPass.changes.bannedPhrasesRemoved.length,
        remaining: secondPass.changes.remainingTells.length,
      });

      return {
        text: reattachHashtags(secondPass.text, hashtagLine),
        report: {
          editorPass: true,
          hashtagsPreserved: Boolean(hashtagLine),
          firstPass: firstPass.changes,
          secondPass: secondPass.changes,
          remainingTells: secondPass.changes.remainingTells,
        },
      };
    },
  };
}

export { applyRules, detectAiTells, splitOffHashtags, reattachHashtags };
export default { createHumanizer };
