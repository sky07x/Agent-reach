/**
 * Stage 4 - Generate the post copy.
 *
 * The story comes first and everything else follows from it:
 *
 *   read the story      what happened, the specifics, the one point to make.
 *                       A story with nothing to add is turned down here,
 *                       before anything else is spent on it. (insight.js)
 *   pick the format     only shapes and endings this story can carry are
 *                       eligible; the rotations choose between those, so
 *                       they still stop repetition without overriding fit.
 *   write first lines   several candidates, in different opening styles.
 *   choose one          plain rules sink the generic ones, a cheap rating
 *                       judges which creates real curiosity. (hook-scorer.js)
 *   write the rest      around the line that actually runs.
 *   judge it            and rewrite once, or hold it. (quality.js)
 *
 * Four things still rotate independently: the SHAPE of the post, the STYLE
 * of its opening line (now through the hook candidates, see below), how it
 * ENDS, and how LONG it runs. See shapes.js.
 *
 * Cost per post: insight, hooks, hook rating, body, judge, plus the
 * humanizer's editor pass. Six calls on the cheap model is still well under
 * a cent.
 */

import { createLogger } from '../lib/logger.js';
import { createRotation } from '../lib/rotation.js';
import { SYSTEM_PROMPT, OPENING_STYLES, stylesFor, buildHookPrompt, buildUserPrompt } from './prompts.js';
import {
  POST_SHAPES,
  CLOSER_STYLES,
  LENGTH_MOODS,
  FALLBACK_SHAPE,
  getShape,
  normalizeParts,
  assemblePost,
  getCloserStyle,
  closerFits,
  targetWords,
} from './shapes.js';
import { pickBestHook, rateHooks } from './hook-scorer.js';
import { chooseHashtags, tagsForFrame } from './hashtags.js';
import { assessDraft } from './quality.js';
import { extractInsight, storyAnchors } from './insight.js';

const log = createLogger('content-engine');

/** Words in the post itself. Hashtags are not prose and do not count. */
export function countWords(text) {
  return text
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('#'))
    .length;
}

/** The last line of prose in a finished post, for the repetition checks. */
export function lastLine(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .at(-1) ?? '';
}

/**
 * The shapes this story is allowed, in rotation order.
 *
 * Fit first, then variety. A shape must pass its own fits() check, and when
 * the insight step named the shapes that suit the story, it must be one of
 * those too. The rotation then chooses between whatever is left.
 *
 * If the insight's list and the fit checks share nothing, the fit checks
 * win: they are about what the story physically contains, and the model's
 * taste is only a preference.
 */
export function eligibleShapes({ names, article, insight }) {
  // Some shapes need something only the insight step can see: a breakdown
  // with no mechanism to walk through is a summary with arrows on it. Without
  // an insight nothing can be judged, so nothing is ruled out on that count.
  const fitting = names.filter((name) => POST_SHAPES[name]?.fits(article)
    && (!insight || !POST_SHAPES[name].fitsInsight || POST_SHAPES[name].fitsInsight(insight)));
  const suited = insight?.shapes?.length ? fitting.filter((name) => insight.shapes.includes(name)) : [];
  return suited.length ? suited : fitting;
}

/**
 * Never the same skeleton twice in a row, when the story allows another.
 *
 * Done after the rotation rather than inside its filter. Dropping the last
 * shape from the list the rotation walks would shift every index by one and
 * make the rotation skip slots; the full rotation never repeats on its own,
 * so this only matters when fit has narrowed the list to two or three.
 */
export function avoidRepeat(picked, eligible, previous) {
  if (picked !== previous || eligible.length < 2) return picked;
  return eligible[(eligible.indexOf(picked) + 1) % eligible.length];
}

/** The model's hook list, as {text, style}, whatever form it came back in. */
function normalizeHooks(raw) {
  return (Array.isArray(raw) ? raw : [raw])
    .map((hook) => (typeof hook === 'string'
      ? { text: hook.trim() }
      : { text: String(hook?.text ?? '').trim(), style: OPENING_STYLES[hook?.style] ? hook.style : undefined }))
    .filter((hook) => hook.text);
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

  /** What the last few posts opened and closed with, newest first. */
  async function getRecent() {
    const posts = await store.listRecentAttempted(settings.recentPostsShown ?? 6);

    return posts.map((post) => ({
      hook: post.hook ?? '',
      ending: lastLine(post.text),
      shape: post.shape,
      openingStyle: post.openingStyle,
      visualType: post.visualType,
      // The whole post, for the phrase-repetition check.
      text: post.text ?? '',
    }));
  }

  /**
   * Write the candidate first lines, rate them, and pick one.
   *
   * The opening style used to be rotated before a word was written, one per
   * post, so "fake-confession" (now "uncomfortable-truth") came up for a story about a camera company
   * and produced a confession about photo filters nobody ever made. Now the
   * candidates are written in different styles and the best one wins; the
   * last post's style is marked down slightly, which keeps the variety the
   * rotation was there for.
   */
  async function chooseHook({ article, insight, shapeName, recent, notes }) {
    const styles = stylesFor(settings.openingStyles, article);

    const result = await llm.chatJson({
      label: 'write-hooks',
      model: settings.writerModel || undefined,
      temperature: 0.95,
      maxTokens: 500,
      system: SYSTEM_PROMPT,
      user: buildHookPrompt({
        article,
        insight,
        shape: shapeName,
        styles: styles.length ? styles : ['blunt-claim'],
        hookCount: settings.hookCandidates,
        maxChars: settings.hookMaxChars,
        recent,
        notes,
        authorContext: settings.authorContext,
      }),
    });

    const candidates = normalizeHooks(result.hooks);
    const ratings = settings.rateHooks === false
      ? null
      : await rateHooks({ hooks: candidates, article, insight, llm, model: settings.reviewModel });

    const pick = pickBestHook(candidates, {
      maxChars: settings.hookMaxChars,
      jitter: settings.hookJitter,
      anchors: storyAnchors(article, insight),
      ratings,
      avoidStyle: recent[0]?.openingStyle,
    });

    if (!pick.best) throw new Error('The model returned no usable hook');

    return { ...pick, style: pick.style ?? styles[0] ?? 'blunt-claim' };
  }

  /**
   * Write one draft. Notes from a failed attempt are fed back in, so a retry
   * is told what was wrong rather than just rolling the dice again.
   */
  async function writeDraft(article, { notes, choices, insight = null, recent = [] } = {}) {
      // A rewrite keeps the format it was given and only fixes the words.
      //
      // Letting the retry take fresh rotation values was wrong twice over: it
      // burned a slot in the rotations for a post that never shipped, and it
      // applied feedback about the writing to a completely different shape,
      // so the note and the rewrite were about different posts.
      const reusing = Boolean(choices);

      // The rotation only walks shapes this story can actually carry. Handing
      // quote-reaction to a story with no quote in it is how a post went out
      // that said nothing at all.
      const eligible = eligibleShapes({ names: settings.postShapes, article, insight });

      const shapeName = choices?.shapeName ?? avoidRepeat(await rotation.next({
        key: 'shapeRotationIndex',
        names: settings.postShapes,
        known: POST_SHAPES,
        seed: (posts) => posts.filter((post) => post.shape).length,
        accept: (name) => eligible.includes(name),
      }), eligible, recent[0]?.shape) ?? FALLBACK_SHAPE;

      if (!reusing) log.debug('Shapes this story can carry', { eligible, suggested: insight?.shapes });

      const shape = getShape(shapeName);

      // Shapes that end themselves do not consume a turn of the ending
      // rotation, so the endings stay evenly spread over the posts that
      // actually use one. That is also why this one counts posts that have a
      // closerStyle rather than posts in general.
      const closerStyle = reusing ? choices.closerStyle : (shape.closer === 'rotate'
        ? (await rotation.next({
          key: 'closerRotationIndex',
          names: settings.closerStyles,
          known: CLOSER_STYLES,
          seed: (posts) => posts.filter((post) => post.closerStyle).length,
          // An ending that needs a disagreement only runs on a story with one.
          accept: (name) => closerFits(name, insight),
        })) ?? 'flat-verdict'
        : null);

      const lengthMood = choices?.lengthMood ?? (await rotate(
        'lengthRotationIndex', settings.lengthMoods, LENGTH_MOODS,
        (posts) => posts.filter((post) => post.lengthMood).length,
      )) ?? 'mid';

      // A rewrite keeps a first line the judge had no complaint about, so the
      // second attempt fixes what was wrong instead of rerolling what was not.
      const hookPick = choices?.hook
        ? { best: choices.hook, style: choices.style, scored: choices.hookScoreboard ?? [], contenders: 1 }
        : await chooseHook({ article, insight, shapeName, recent, notes });

      const best = hookPick.best;
      const style = hookPick.style;

      const result = await llm.chatJson({
        label: 'write-post',
        model: settings.writerModel || undefined,
        temperature: 0.9,
        maxTokens: 1200,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          article,
          insight,
          hook: best,
          shape: shapeName,
          closerStyle,
          lengthMood,
          maxWords: settings.maxWords,
          hashtagRules: {
            min: settings.hashtagCount.min,
            max: settings.hashtagCount.max,
            preferred: tagsForFrame(article.curation?.frame),
            banned: settings.bannedHashtags,
          },
          learnings: await getLearnings(),
          recent,
          notes,
          authorContext: settings.authorContext,
        }),
      });

      // How many tags this post gets is itself rotated: twelve of the first
      // thirteen posts carried exactly three, which is its own small tell.
      const hashtagCount = Number(await rotate(
        'hashtagCountRotationIndex',
        settings.hashtagCounts.map(String),
        null,
        (posts) => posts.filter((post) => post.hashtags?.length).length,
      ) ?? settings.hashtagCount.min);

      const recentPosts = await store.listRecentAttempted(settings.hashtagHistory);

      const hashtagPick = chooseHashtags({
        modelTags: result.hashtags,
        frame: article.curation?.frame,
        // The story in its own words decides the subject. The frame only
        // describes its shape, which is a different thing entirely.
        text: `${article.title} ${article.summary ?? ""} ${insight?.whatHappened ?? ''}`,
        recentSets: recentPosts.map((post) => post.hashtags ?? []),
        previousSet: recentPosts[0]?.hashtags ?? [],
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
        hookScoreboard: hookPick.scored,
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
        hookScore: hookPick.scored.find((entry) => entry.chosen)?.score,
        hookContenders: hookPick.contenders,
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
     * @returns {Promise<object>} a draft, carrying needsReview when it did not
     *   pass; or {rejected, insight} when the story itself had nothing to
     *   say, in which case nothing was written and no rotation moved
     */
    async generate(article) {
      const { insight, rejected } = await extractInsight({
        article,
        llm,
        settings: { ...settings.insight, model: settings.reviewModel },
        shapeNames: settings.postShapes,
      });

      // Turned down before any rotation moves, so a thin story leaves no
      // trace in the variety counters.
      if (rejected) return { rejected, insight };

      const recent = await getRecent();
      const judge = (draft) => assessDraft({
        article,
        draft,
        llm,
        settings: { ...settings.quality, model: settings.reviewModel, authorContext: settings.authorContext },
        insight,
        recent,
      });

      let draft = await writeDraft(article, { insight, recent });
      let assessment = await judge(draft);

      // One retry, told exactly what was wrong. Two models disagreeing twice
      // is a signal about the story, not something more attempts will fix.
      // A rewrite is judged by the same judge, so there is no point writing
      // one while it cannot be reached.
      if (!assessment.ok && !assessment.judgeUnavailable) {
        log.warn("Rewriting after a failed assessment", { problems: assessment.problems });

        const floor = settings.quality.minDimension ?? settings.quality.minScore;
        const hookWasFine = assessment.scores?.hook >= floor
          && !assessment.problems.some((problem) => /\bhook\b|opens the same way/i.test(problem));

        draft = await writeDraft(article, {
          notes: assessment.problems,
          insight,
          recent,
          // Same shape, ending and length. Only the words change.
          choices: {
            shapeName: draft.shape,
            closerStyle: draft.closerStyle,
            lengthMood: draft.lengthMood,
            ...(hookWasFine ? { hook: draft.hook, style: draft.openingStyle, hookScoreboard: draft.hookScoreboard } : {}),
          },
        });
        assessment = await judge(draft);
      }

      draft.insight = insight;
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
