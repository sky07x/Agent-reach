/**
 * What is this story actually saying? Decided before a word of the post is
 * written.
 *
 * The writer used to get the headline, the summary and a one-line "angle"
 * the curator wrote after reading 300 characters of summary, and it was told
 * that a post which is not funny has failed. So it did the obvious thing: it
 * restated the headline and put a pun on the end.
 *
 *   OpenAI buys Glass Imaging for $300M
 *   -> "I thought I was a wizard with filters... Now that's a clear shot."
 *
 * The article itself said the interesting part: Glass Imaging does not edit
 * photos after the fact, it trains networks on each phone's camera hardware
 * so the image is better when the shutter clicks. That is a hardware bet, not
 * a filter. Nothing in the old pipeline ever read far enough to find it.
 *
 * So one call reads the full article first and answers the questions a good
 * writer asks before starting: what happened, what is specific about it, why
 * it matters, what most developers will miss, and what the one point of the
 * post should be. It also says honestly whether there is enough here to say
 * anything at all, because some stories are a press release with a logo on
 * it, and forcing a post out of one is how a feed fills up with filler.
 */

import { createLogger } from '../lib/logger.js';
import { POST_SHAPES } from './shapes.js';
import { GENERIC_CONCLUSIONS } from './quality.js';

const log = createLogger('insight');

/*
 * The second version of this step, written after the first one worked and
 * still produced bland posts. It found real specifics, and then the writer
 * attached a conclusion that would end any AI post:
 *
 *   "Qualcomm's Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-
 *    parameter model locally. Mobile developers gotta rethink AI
 *    integrations now."
 *
 * STORY -> FACTS -> GENERIC CONCLUSION. What was missing was the middle: why
 * the facts are interesting, what follows from them, and the one thing the
 * reader should take away. So the step now works through those in order, and
 * the point has to pass a "so what?" test before anything is written.
 */
const INSIGHT_PROMPT = `You prepare tech stories for a developer who posts on
LinkedIn. They only post when they have a point: something the reader would
not get from the headline. Your job is to find that point, or to say honestly
that there is not one. You do not write the post.

Work through these in order. Each builds on the one before.

  whatHappened       one plain sentence. Who did what. No adjectives.
  keyEvidence        the facts a post could stand on, 2 to 6 of them, each
                     with the exact words from the article that support it:
                     [{"fact": "short statement", "quote": "words copied exactly from the article"}]
                     Only what the article states. Never invent or round.
  whyInteresting     what about these facts is non-obvious, surprising, or at
                     odds with what people assume. Not "this is big news".
  implication        what changes, for whom, because of this. This is
                     interpretation unless the article says it, so write it
                     as one: "may", "probably", "likely".
  point              THE ONE THING THE READER SHOULD TAKE AWAY. One sentence,
                     a claim a smart reader could disagree with. Its reasoning
                     must depend on the evidence: swap in another company and
                     the argument should break, not just the nouns.
  audienceRelevance  why a developer or technical professional should care:
                     what they might build, choose, avoid or expect
                     differently. Concrete.
  comparison         {"supported": true or false, "basis": "..."}
                     true only if the article itself compares this to another
                     company or product, or gives the evidence for one. Two
                     products in the same news cycle are not a rivalry.
  tension            the best counter-argument to the point, or "".
  commonRead         what a developer skimming only the headline would
                     conclude, in one sentence, IF a detail in the article
                     points somewhere else. "" if the headline is fair.
  mechanism          how the thing actually works, as 2 to 5 short steps in
                     the order they happen, ONLY as far as the article
                     explains it. [] if the article does not say how it
                     works. Never fill gaps with how such things usually work.
  numbers            the telling figures, 0 to 6 of them, each copied from
                     the article: [{"label": "what it counts, 2-6 words",
                     "value": 500000000, "display": "$500M",
                     "quote": "the exact words from the article"}]
                     value is a plain number for charting. Skip dates and
                     years. Only numbers that are comparable belong together.
  builderAngle       one sentence: what someone building software should do,
                     check or avoid differently because of this story. "" if
                     nothing.
  soWhat             the test that decides whether this story gets a post:
                     {"readerLearns": "what the reader knows afterwards that the headline did not tell them",
                      "sameForAnotherStory": "your point, rewritten for an unrelated AI launch by swapping only the names and numbers",
                      "stillMakesSense": true ONLY if the rewritten point is just as
                      TRUE and just as INTERESTING for most other AI launches,
                      i.e. your point is really a trend statement}
                     Nearly any sharp point can be abstracted into a sentence
                     that is still grammatical; that is not the test. The
                     test is whether the insight came from this story's
                     specifics. "Generative AI used before the shot, as pose
                     choreography, instead of editing after it" came from the
                     story: false. "Enterprises want AI agents to be safe"
                     would be true of anything: true.
  shapes             the post formats below that would genuinely suit this
                     story, best first, at most three. Use the exact names.
  substance          1-5, how much MATERIAL the article gives a writer beyond
                     the headline: specifics, numbers, a mechanism, a quote, a
                     consequence. It scores the story, not how original your
                     point is.
                       1  a press release. Nothing to add.
                       2  one thin detail. Any post would be the headline again.
                       3  a real detail and a real consequence.
                       4  several telling specifics, or a mechanism explained,
                          and a non-obvious point they support.
                       5  a genuinely surprising story with a clear argument.
                     These stories were already picked as the best of the
                     week, so 3 is ordinary here. A story with several
                     specific numbers or a described mechanism is at least 3.
  substanceReason    one sentence explaining the score.

THESE ARE NOT POINTS. They are true of almost every AI story:
  "developers need to rethink X"      "this could change how we build apps"
  "the competition is heating up"     "X is reshaping the industry"
  "this is a big step for AI"         "AI agents are creating new risks"

A point sounds like: "Running a 30B model on the phone moves the cost of an
AI feature from the developer's inference bill to the user's battery, which
changes which features are worth building." It depends on the facts. (That
is an example of the form only. Derive the point from THIS story.)

If there is no story-specific point, return "point": "" and a substance of 1
or 2. Holding a story back is a good outcome. A forced post is a bad one.

POST FORMATS
{{shapes}}

Reply as JSON with exactly those keys.`;

/** The formats, as the model should read them. */
function describeShapes(names) {
  return names
    .filter((name) => POST_SHAPES[name])
    .map((name) => `  ${name}: ${POST_SHAPES[name].suits}`)
    .join('\n');
}

const text = (value) => String(value ?? '').trim();

/** Lowercase words only, for comparing a quote to the article loosely. */
const words = (value) => String(value ?? '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9$%.']+/g) ?? [];

/**
 * Is this quote really in the article?
 *
 * Exact first. Failing that, most of its words in order-free form, because
 * models tidy quotes up; but a "quote" whose words are mostly not in the
 * article was made up, and the fact resting on it goes with it.
 */
export function quoteIsInArticle(quote, article) {
  const source = words(`${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`).join(' ');
  const wanted = words(quote);

  if (!wanted.length || !source) return false;
  if (source.includes(wanted.join(' '))) return true;

  const vocabulary = new Set(source.split(' '));
  const meaningful = wanted.filter((word) => word.length > 3 || /\d/.test(word));
  if (!meaningful.length) return false;

  return meaningful.filter((word) => vocabulary.has(word)).length / meaningful.length >= 0.8;
}

/**
 * Is this figure, as displayed, in the article? "$500M" matches "$500
 * million", "93%" matches "93 percent". Compared on the digits and the
 * scale, not the spelling.
 */
export function displayIsInArticle(display, article) {
  const source = `${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`.replace(/,/g, '');
  const digits = String(display ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!digits) return false;
  return new RegExp(`(^|[^\\d.])${digits[0].replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(source);
}

/**
 * Coerce whatever the model sent into the shape the rest of the engine uses.
 * A model that returns a string where a list was asked for is a normal
 * Tuesday, so cope rather than throw.
 *
 * Both vocabularies are read: the new one (keyEvidence, implication, point)
 * and the first one (specifics, whyItMatters, insight), so nothing that
 * reads an older insight breaks. The old names are filled in from the new
 * ones, because the prompts and the review output still use them.
 */
export function normalizeInsight(raw, shapeNames = Object.keys(POST_SHAPES), article = null) {
  const list = (value) => (Array.isArray(value) ? value : text(value).split('\n'))
    .filter((item) => item !== null && item !== undefined && item !== '');

  // Invented shape names are dropped. The rotation only ever sees real ones.
  const shapes = list(raw?.shapes).map(text).filter((name) => shapeNames.includes(name));

  const evidence = list(raw?.keyEvidence ?? raw?.specifics)
    .map((item) => (typeof item === 'string'
      ? { fact: text(item), quote: text(item) }
      : { fact: text(item?.fact), quote: text(item?.quote ?? item?.fact) }))
    .filter((item) => item.fact)
    .map((item) => ({ ...item, verified: article ? quoteIsInArticle(item.quote, article) : true }));

  // Only evidence the article actually contains goes forward. The rest is
  // kept visible for review, but nothing is written on top of it.
  const keyEvidence = evidence.filter((item) => item.verified).slice(0, 6);

  const point = text(raw?.point ?? raw?.insight);
  const implication = text(raw?.implication ?? raw?.whyItMatters);
  const audienceRelevance = text(raw?.audienceRelevance ?? raw?.whatDevsMiss);
  const whyInteresting = text(raw?.whyInteresting ?? raw?.surprising);

  // A figure is only kept when its words are in the article AND its value
  // can actually be found there. A chart is the most believable thing a post
  // can carry, which makes a wrong number on one the most damaging.
  const numbers = list(raw?.numbers)
    .map((item) => ({
      label: text(item?.label),
      value: Number(item?.value),
      display: text(item?.display ?? item?.value),
      quote: text(item?.quote),
    }))
    .filter((item) => item.label && Number.isFinite(item.value) && item.display)
    .filter((item) => !article || (quoteIsInArticle(item.quote || item.display, article) && displayIsInArticle(item.display, article)))
    .slice(0, 6);

  return {
    whatHappened: text(raw?.whatHappened),
    keyEvidence,
    unverifiedEvidence: evidence.filter((item) => !item.verified).map((item) => item.fact),
    whyInteresting,
    implication,
    point,
    audienceRelevance,
    comparison: {
      supported: raw?.comparison?.supported === true,
      basis: text(raw?.comparison?.basis),
    },
    tension: text(raw?.tension),
    commonRead: text(raw?.commonRead),
    mechanism: list(raw?.mechanism).map(text).filter(Boolean).slice(0, 5),
    numbers,
    builderAngle: text(raw?.builderAngle),
    soWhat: {
      readerLearns: text(raw?.soWhat?.readerLearns),
      sameForAnotherStory: text(raw?.soWhat?.sameForAnotherStory),
      stillMakesSense: raw?.soWhat?.stillMakesSense === true,
    },
    shapes: [...new Set(shapes)].slice(0, 3),
    substance: Number(raw?.substance) || 0,
    substanceReason: text(raw?.substanceReason),

    // The first version's names, kept for everything that still reads them.
    insight: point,
    specifics: keyEvidence.map((item) => item.fact),
    whyItMatters: implication,
    surprising: whyInteresting,
    whatDevsMiss: audienceRelevance,
  };
}

/**
 * The "so what?" test, on the point itself, before anything is written.
 *
 * @returns {string[]} what is wrong with the point, empty if it stands up
 */
export function pointFailures(insight, article, { minEvidence = 1 } = {}) {
  const failures = [];

  if (!insight.point) return ['there is no point to make beyond the headline'];

  const generic = GENERIC_CONCLUSIONS.find((pattern) => pattern.test(insight.point));
  if (generic) failures.push(`the point is a generic conclusion: "${insight.point}"`);

  // A point that names nothing from the story is a trend statement.
  if (!isAnchored(insight.point, article, insight)) {
    failures.push(`the point names nothing from this story, so it would fit under a dozen others: "${insight.point}"`);
  }

  // The model's own swap test. Asked to rewrite the point for an unrelated
  // story, it says the result still makes sense: then it was never about
  // this story. It only counts if the model really did swap: on the first
  // real run it handed back the Qualcomm point unchanged, names and all, and
  // then reported that it "still made sense", which tests nothing.
  const swapped = insight.soWhat.sameForAnotherStory
    && !isAnchored(insight.soWhat.sameForAnotherStory, article, insight);
  if (insight.soWhat.stillMakesSense && swapped) {
    failures.push(`the point survives a name swap ("${insight.soWhat.sameForAnotherStory}"): its reasoning does not depend on this story`);
  }

  if (insight.keyEvidence.length < minEvidence) {
    failures.push('none of the evidence could be found in the article, so the point rests on nothing');
  }

  return failures;
}

/**
 * Is there enough in this story to post about?
 *
 * @returns {string|null} why not, or null if it is fine
 */
export function thinStoryReason(insight, { minSubstance }) {
  if (!insight.insight) return 'there is no observation to make beyond the headline';

  if (insight.substance < minSubstance) {
    return `substance ${insight.substance}/5: ${insight.substanceReason || 'nothing to add beyond the headline'}`;
  }

  return null;
}

/**
 * Read one story and decide what a post about it should say.
 *
 * @returns {Promise<{insight: object|null, rejected: string|null}>}
 *   insight is null when the step is off or the model could not be reached;
 *   the writer then falls back to the curator's angle, as it always did.
 */
export async function extractInsight({ article, llm, settings, shapeNames }) {
  if (!settings?.enabled) return { insight: null, rejected: null };

  const ask = (user) => llm.chatJson({
    label: 'insight',
    model: settings.model || undefined,
    temperature: 0.4,
    maxTokens: 1600,
    system: INSIGHT_PROMPT.replace('{{shapes}}', describeShapes(shapeNames)),
    user,
  });

  try {
    const first = await ask(storyPrompt(article, settings));
    let insight = normalizeInsight(first, shapeNames, article);
    let failures = pointFailures(insight, article, settings);

    // One more attempt, told exactly why the first point did not stand up. If
    // the second cannot find a point either, there is not one to find.
    if (failures.length && insight.point) {
      const retry = await ask(`${storyPrompt(article, settings)}

Your first answer's point was "${insight.point}". It does not stand up:
${failures.map((failure) => `- ${failure}`).join('\n')}

Find a point whose reasoning depends on this story's evidence, or return
"point": "" if there is not one. Saying there is no point is a good answer.`);

      // Models answer a retry with only the part they changed, usually just
      // a new point. Anything the retry left out keeps its first answer, or a
      // missing evidence list reads as "none of the evidence is real".
      // The first answer's swap test was about the first point, so it only
      // carries over when the point did not change.
      const samePoint = !retry?.point || retry.point === first?.point;
      insight = normalizeInsight({ ...first, ...retry, soWhat: retry?.soWhat ?? (samePoint ? first?.soWhat : undefined) }, shapeNames, article);

      failures = pointFailures(insight, article, settings);
    }

    const rejected = failures.length
      ? `no story-specific point: ${failures.join('; ')}`
      : thinStoryReason(insight, settings);

    log[rejected ? 'warn' : 'info']('Story read', {
      title: article.title,
      substance: insight.substance,
      point: insight.point,
      evidence: insight.keyEvidence.length,
      unverified: insight.unverifiedEvidence.length,
      shapes: insight.shapes,
      rejected,
    });

    return { insight, rejected };
  } catch (error) {
    // Like the judge: a step that cannot be reached must not stop the run.
    log.warn('Insight step unavailable, writing from the curator angle', { error: error.message });
    return { insight: null, rejected: null };
  }
}

function storyPrompt(article, settings) {
  return `Title: ${article.title}
Summary: ${text(article.summary).slice(0, 600)}
${article.curation?.angle ? `The curator's first guess at an angle: ${article.curation.angle}\n` : ''}
Article:
${text(article.body || article.summary).slice(0, settings.maxBodyChars ?? 4000)}`;
}

/** Does this line name something that belongs to this story? */
export function isAnchored(line, article, insight) {
  const lower = String(line ?? '').toLowerCase();

  return storyAnchors(article, insight).some((anchor) => {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
  });
}

/**
 * The concrete things a hook can be anchored to: numbers and names from the
 * story, and the specifics the insight step pulled out.
 *
 * A hook that contains none of these could sit on top of any post about any
 * company. "Looks like we need a timeout for rogue AIs" is the real example.
 */
export function storyAnchors(article, insight) {
  const source = [
    article?.title,
    article?.summary,
    ...(insight?.specifics ?? []),
  ].map(text).join(' ');

  const numbers = source.match(/\d[\d,.]*/g) ?? [];

  // Capitalised words that are not just the start of a sentence are the
  // names. A few very common ones say nothing about this particular story.
  const names = (source.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? [])
    .filter((word) => !COMMON_CAPITALS.has(word.toLowerCase()));

  return [...new Set([...numbers, ...names].map((anchor) => anchor.toLowerCase().replace(/[.,]+$/, '')))]
    .filter((anchor) => anchor.length >= 2);
}

const COMMON_CAPITALS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'what', 'when', 'how', 'why',
  'new', 'now', 'its', 'his', 'her', 'their', 'says', 'said', 'report',
  'but', 'not', 'you', 'your', 'our', 'are', 'was', 'has', 'have',
]);

export default { extractInsight, normalizeInsight, displayIsInArticle, pointFailures, quoteIsInArticle, thinStoryReason, storyAnchors, isAnchored };
