/**
 * Is this post actually worth posting?
 *
 * Everything else in this pipeline checks structure: word counts, em-dashes,
 * banned phrases, hashtag relevance, whether two posts share a skeleton. All
 * of it is necessary and none of it can tell whether a post says anything.
 *
 * A post went out that proved the point. It passed every structural check and
 * meant nothing:
 *
 *   "But reasoning has always been something that we've relied on the
 *    frontier model providers for." - Jayesh Govindarajan
 *
 *   Salesforce just gave spreadsheets a reason to take over.
 *   This should be interesting.
 *
 * The story was that Salesforce built a reasoning model called Koa on
 * Nvidia's Nemotron. The post never mentions Koa, Nvidia, or what the thing
 * does. Salesforce is not a spreadsheet company. The closing line says
 * nothing. No regex was ever going to catch that.
 *
 * So there are two gates here. The free one catches the mechanical tells. The
 * paid one - a single cheap call - reads the post against the story and says
 * whether it is worth anyone's time. A post that fails is held back rather
 * than published, because a gate that only logs is not a gate.
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('quality');

/**
 * Closing lines that occupy space without saying anything.
 *
 * These are the sound of a model filling a required field. "This should be
 * interesting" is the one that shipped.
 */
export const FILLER_CLOSERS = [
  'this should be interesting',
  'interesting times',
  'time will tell',
  'we shall see',
  'we will see',
  'only time will tell',
  'stay tuned',
  'watch this space',
  'let that sink in',
  'make of that what you will',
  'draw your own conclusions',
  'the future is here',
  'buckle up',
  'here we go',
  'what a time to be alive',
];

/** Strip punctuation so "This should be interesting." matches the list. */
function flatten(line) {
  return String(line ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The free checks. Mechanical, instant, and they catch the obvious failures
 * before we spend anything on the model.
 *
 * @returns {string[]} problems, empty if it passes
 */
export function structuralProblems({ article, draft }) {
  const problems = [];
  const text = String(draft.text ?? '');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const closer = flatten(draft.parts?.closer);
  if (closer && FILLER_CLOSERS.some((filler) => closer === filler || closer.startsWith(filler))) {
    problems.push(`the closing line "${draft.parts.closer}" says nothing`);
  }

  // A quote that opens on a conjunction was cut out of the middle of a
  // sentence and reads as one.
  if (/^["“](but|and|so|which|that|because)\b/i.test(text)) {
    problems.push('the opening quote is a fragment lifted from mid-sentence');
  }

  // The hook is written blind to the body, so the body sometimes restates it.
  if (lines.length > 1) {
    const hook = flatten(lines[0]);
    const echo = lines.slice(1).some((line) => {
      const body = flatten(line);
      return body.length > 20 && (hook.includes(body) || body.includes(hook));
    });

    if (echo) problems.push('the post restates its own hook');
  }

  // Nothing from the story in the post at all is the clearest possible sign
  // that the post is about nothing.
  const subjects = (article?.title ?? '').match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? [];
  const lowered = text.toLowerCase();

  if (subjects.length && !subjects.some((word) => lowered.includes(word.toLowerCase()))) {
    problems.push('the post does not mention anything from the story');
  }

  return problems;
}

const JUDGE_PROMPT = `You are the editor of a developer humour page, deciding
whether a post is worth publishing. You are hard to please and you have seen
everything.

You get the story the post is based on, and the post.

This is a JOKE page, not a news desk. It is not summarising the story and it
should not be scored as though it were. Judge it as a post, not as a report.

Score it 1 to 5:
  1  says nothing. The reader cannot tell what happened OR why it is funny.
  2  gestures at a topic. Names it, but any specific has been lost, and the
     joke is only a joke-shaped sentence.
  3  works. The reader can tell what happened and there is a real joke in it.
  4  good. Sharp, one concrete detail carried through, a clear point of view.
  5  excellent. Worth stopping the scroll for and arguing with.

Two questions decide it:

  Can the reader tell what happened? Obliquely is fine. A fake log, a quote, a
  list of beats all count, as long as the substance is in there somewhere. It
  does not need the company's full announcement, one real specific is enough.

  Is there a real joke or a real opinion? Not a wry tone - an actual joke, or
  a position someone could disagree with.

Both yes is a 3 or better. Only one is a 2. Neither is a 1.

Do not mark a post down for being short, for being oblique, for using a
format instead of prose, or for leaving out detail that the joke does not
need. A two-line post that lands is a 4. Do mark it down for naming a subject
and then saying nothing about it, and for lines that could be deleted with
nothing lost.

Reply as JSON:
{"score": 1-5, "verdict": "one sentence, blunt",
 "problems": ["specific, actionable, at most three"]}`;

/**
 * Read the post against its story and score it.
 *
 * One call, on the cheap model. At three posts a week this is a fraction of a
 * cent a month, which is a very low price for not publishing nonsense.
 */
export async function judgeDraft({ article, draft, llm }) {
  const result = await llm.chatJson({
    label: 'judge-post',
    temperature: 0.2,
    maxTokens: 300,
    system: JUDGE_PROMPT,
    user: `THE STORY
Title: ${article.title}
Summary: ${(article.summary ?? '').slice(0, 600)}
The angle it was meant to argue: ${article.curation?.angle || '(none given)'}
The joke it was meant to land: ${article.curation?.joke || '(none given)'}

THE POST
Format it was written to: ${draft.shape ?? "free"}

${draft.text}`,
  });

  return {
    score: Number(result.score) || 0,
    verdict: String(result.verdict ?? '').trim(),
    problems: (result.problems ?? []).map((problem) => String(problem).trim()).filter(Boolean),
  };
}

/**
 * Both gates together.
 *
 * @returns {{ok: boolean, score: number|null, problems: string[], verdict: string}}
 */
export async function assessDraft({ article, draft, llm, settings }) {
  const problems = structuralProblems({ article, draft });

  // A structural failure is certain, so do not pay to confirm it.
  if (problems.length) {
    log.warn('Draft failed the free checks', { problems });
    return { ok: false, score: null, problems, verdict: 'failed the structural checks' };
  }

  if (!settings.useLlmJudge) return { ok: true, score: null, problems: [], verdict: 'judge disabled' };

  try {
    const judged = await judgeDraft({ article, draft, llm });
    const ok = judged.score >= settings.minScore;

    log[ok ? 'info' : 'warn']('Draft judged', {
      score: judged.score,
      minimum: settings.minScore,
      verdict: judged.verdict,
    });

    return { ok, ...judged };
  } catch (error) {
    // A judge that cannot be reached must not block the run. Say so loudly
    // rather than silently waving everything through.
    log.warn('Judge unavailable, letting the draft through unjudged', { error: error.message });
    return { ok: true, score: null, problems: [], verdict: 'judge unavailable' };
  }
}

export default { assessDraft, judgeDraft, structuralProblems, FILLER_CLOSERS };
