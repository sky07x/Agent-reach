/**
 * "Would devs actually have an opinion about this?" - scored without an LLM.
 *
 * This is a shortlist filter, not the final decision. It is cheap, so it runs
 * on everything the classifier kept; the model then ranks only the top few.
 */

import { guessFrame, UNKNOWN_FRAME } from './frames.js';

/**
 * Whole-word match.
 *
 * Plain `includes()` is a trap here: "bill" (a law) matches inside "billion",
 * so every story about money looked like heavy political news. Word
 * boundaries stop that. It also means list entries must be whole words, not
 * stems, which is why the lists spell out "hallucinating" and "hallucinated"
 * separately.
 */
function mentions(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/** Pull the words we treat as a story's topic, for repetition checks. */
export function extractTopics(article, bigNames) {
  const text = `${article.title} ${article.summary ?? ''}`.toLowerCase();

  const names = bigNames.filter((name) => text.includes(name));

  // Capitalised words in the title are usually product or company names.
  const properNouns = (article.title.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !['the', 'and', 'for', 'with', 'says', 'this'].includes(word));

  return [...new Set([...names, ...properNouns])].slice(0, 6);
}

/**
 * How heavily a frame has been leaned on lately (0-1).
 *
 * Unlike topics, one repeat already matters. Two "something failed" posts in
 * a row is exactly the pattern we are trying to break, even when the two
 * stories share no companies at all.
 */
export function frameFatigue(frame, recentFrames) {
  // An unclear frame is not evidence of repetition, it is an absence of
  // evidence. Penalising it would push stories off the list for the crime of
  // not matching a keyword.
  if (!frame || frame === UNKNOWN_FRAME || !recentFrames.length) return 0;

  const used = recentFrames.filter((recent) => recent === frame).length;
  return Math.min(1, used / Math.min(recentFrames.length, 3));
}

/** How much this story overlaps with what we posted recently (0-1). */
export function topicOverlap(topics, recentTopics) {
  if (!topics.length || !recentTopics.length) return 0;

  const recent = new Set(recentTopics);
  const shared = topics.filter((topic) => recent.has(topic));

  return shared.length / topics.length;
}

/**
 * Score one article for post-worthiness.
 *
 * @param {object} article        classified article
 * @param {object} settings       config.curator
 * @param {object} [recent]
 * @param {string[]} [recent.topics]  topics from the last N published posts
 * @param {string[]} [recent.frames]  frames from the last N published posts
 */
export function scoreMemeability(article, settings, recent = {}) {
  const recentTopics = recent.topics ?? [];
  const recentFrames = recent.frames ?? [];
  const title = article.title ?? '';
  const text = `${title} ${article.summary ?? ''}`.toLowerCase();
  const signals = settings.memeSignals;
  const reasons = [];

  let score = 0;

  // The main signal. Something broke, or is absurd, or is ironic. These are
  // the stories a developer will laugh at, which is what this page is for.
  const funnyHits = settings.funnyWords.filter((word) => mentions(text, word));
  if (funnyHits.length) {
    score += signals.funny;
    reasons.push(`something to joke about (${funnyHits.slice(0, 2).join(', ')})`);
  }

  // A concrete number is the best defence against a vague, AI-ish post.
  if (/\$?\d[\d,.]*\s*(%|billion|million|x|k\b|b\b|gb|ms|tokens?|params?)/i.test(text)) {
    score += signals.hasNumber;
    reasons.push('has a concrete number');
  }

  if (settings.noveltyWords.some((word) => mentions(text, word))) {
    score += signals.novelty;
    reasons.push('genuinely new');
  }

  if (settings.bigNames.some((name) => mentions(text, name))) {
    score += signals.bigName;
    reasons.push('big name involved');
  }

  if (/["\u201c\u201d']/.test(title) || /\bsaid\b|\bsays\b/.test(text)) {
    score += signals.hasQuote;
    reasons.push('has a quote');
  }

  if (settings.controversyWords.some((word) => mentions(text, word))) {
    score += signals.controversy;
    reasons.push('people will argue');
  }

  // Counterweight. Everything above this line rewards something going wrong -
  // funnyWords is almost entirely outage, broke, crash, deleted, hacked - so
  // without a signal for things that went right, the feed ends up being one
  // long obituary. A good story is funny too, just in a different way.
  if (settings.positiveWords.some((word) => mentions(text, word))) {
    score += signals.positive;
    reasons.push('something actually went right');
  }

  // Heavy news: extinction, layoffs, death, lawsuits. Important, but there is
  // no joke in it, and forcing one reads badly. Push these down hard.
  const heavyHits = settings.heavyWords.filter((word) => mentions(text, word));
  if (heavyHits.length) {
    score -= settings.heavyPenalty;
    reasons.push(`too heavy to joke about (${heavyHits.slice(0, 2).join(', ')})`);
  }

  // The classifier's confidence feeds in, so a borderline story needs more
  // going for it to make the shortlist.
  score += (article.classification?.score ?? 0) * 0.2;

  // Repeating last week's topic is the fastest way to bore a feed.
  const topics = extractTopics(article, settings.bigNames);
  const overlap = topicOverlap(topics, recentTopics);

  if (overlap > 0) {
    score -= overlap * 0.5;
    reasons.push(`overlaps recent posts (${Math.round(overlap * 100)}%)`);
  }

  // Same idea one level up: not the same companies, the same kind of story.
  const { frame, confident } = guessFrame(article);
  const fatigue = frameFatigue(frame, recentFrames);

  if (fatigue > 0) {
    // A guess we are unsure of should not push a story off the list on its
    // own, so an uncertain frame counts for less.
    score -= fatigue * settings.framePenalty * (confident ? 1 : 0.5);
    reasons.push(`recent posts already did "${frame}"`);
  }

  return {
    memeScore: Number(Math.min(1, Math.max(0, score)).toFixed(3)),
    topics,
    guessedFrame: frame,
    frameConfident: confident,
    reasons,
  };
}

export default { scoreMemeability, extractTopics, topicOverlap };
