/**
 * The mechanical half of humanizing: find and fix AI tells with plain rules.
 *
 * These are pure functions on strings, which makes them easy to test and easy
 * to reason about when a post comes out reading strangely.
 */

import { BANNED_PHRASES, CONTRACTIONS } from './banned-phrases.js';

/** Collapse the double spaces and stranded punctuation a deletion leaves. */
function tidy(text) {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/^[ \t]*[,;:]\s*/gm, '')
    .replace(/([.!?])\1+/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** Capitalise the first letter of a sentence we may have decapitated. */
function fixSentenceStarts(text) {
  return text.replace(/(^|[.!?]\s+|\n)([a-z])/g, (match, prefix, letter) => prefix + letter.toUpperCase());
}

/**
 * Remove or replace every banned phrase.
 *
 * @returns {{text: string, removed: Array<{phrase: string, reason: string}>}}
 */
export function stripBannedPhrases(text) {
  let output = text;
  const removed = [];

  for (const rule of BANNED_PHRASES) {
    const matches = output.match(rule.pattern);
    if (!matches) continue;

    removed.push(...matches.map((phrase) => ({ phrase: phrase.trim(), reason: rule.reason })));
    output = output.replace(rule.pattern, rule.replaceWith ?? '');
  }

  return { text: fixSentenceStarts(tidy(output)), removed };
}

/**
 * Em-dashes are the single loudest AI fingerprint. Keep at most `max` and
 * turn the rest into ordinary punctuation.
 */
export function limitEmDashes(text, max = 1) {
  const dash = /\s*[—–]\s*/g;
  let seen = 0;

  const output = text.replace(dash, (match) => {
    seen += 1;
    if (seen <= max) return ' - ';
    // Alternate between a full stop and a comma so the fix isn't itself a tell.
    return seen % 2 === 0 ? '. ' : ', ';
  });

  return { text: fixSentenceStarts(tidy(output)), replaced: Math.max(0, seen - max) };
}

/** Keep the capitalisation of whatever we replaced. */
function matchCase(original, replacement) {
  const startsUpper = /^[A-Z]/.test(original);
  return startsUpper ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

/** Swap formal forms for the contractions a person actually types. */
export function useContractions(text) {
  let output = text;
  let applied = 0;

  for (const [pattern, replacement] of CONTRACTIONS) {
    // The list is written lowercase; match either case and restore it after,
    // otherwise a sentence starting "It is" never gets contracted.
    const anyCase = new RegExp(pattern.source, 'gi');
    const matches = output.match(anyCase);
    if (!matches) continue;

    applied += matches.length;
    output = output.replace(anyCase, (match) => matchCase(match, replacement));
  }

  return { text: fixSentenceStarts(output), applied };
}

/**
 * Three bullets of near-identical length is a shape models love and people
 * rarely produce. We flag it rather than rewrite it, because fixing structure
 * mechanically usually makes things worse - the editor pass handles it.
 */
export function findSymmetricalList(text) {
  const bullets = text.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d[.)])\s+/.test(line));

  if (bullets.length < 3) return null;

  const lengths = bullets.map((line) => line.length);
  const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const spread = Math.max(...lengths) - Math.min(...lengths);

  if (spread > average * 0.35) return null;

  return { bullets: bullets.length, reason: 'three or more bullets of near-identical length' };
}

/** Several sentences in a row starting the same way reads as templated. */
export function findRepeatedOpeners(text) {
  const openers = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim().split(/\s+/)[0]?.toLowerCase())
    .filter(Boolean);

  const counts = new Map();
  for (const word of openers) counts.set(word, (counts.get(word) ?? 0) + 1);

  const repeated = [...counts.entries()].filter(([, count]) => count >= 3).map(([word]) => word);
  return repeated.length ? repeated : null;
}

/**
 * Report every tell still present, without changing anything. Used for the
 * dry-run report and as the input to the editor pass.
 */
export function detectAiTells(text, { maxEmDashes = 1 } = {}) {
  const issues = [];

  for (const rule of BANNED_PHRASES) {
    const matches = text.match(rule.pattern);
    if (matches) issues.push({ type: 'banned-phrase', detail: matches.join(', '), reason: rule.reason });
  }

  const emDashes = (text.match(/[—–]/g) ?? []).length;
  if (emDashes > maxEmDashes) {
    issues.push({ type: 'em-dash', detail: `${emDashes} found`, reason: `more than ${maxEmDashes} allowed` });
  }

  const list = findSymmetricalList(text);
  if (list) issues.push({ type: 'symmetrical-list', detail: `${list.bullets} bullets`, reason: list.reason });

  const openers = findRepeatedOpeners(text);
  if (openers) issues.push({ type: 'repeated-openers', detail: openers.join(', '), reason: 'sentences start the same way' });

  return issues;
}

/**
 * Run the whole mechanical pass.
 *
 * @returns {{text: string, changes: object}}
 */
export function applyRules(text, { maxEmDashes = 1 } = {}) {
  const stripped = stripBannedPhrases(text);
  const dashed = limitEmDashes(stripped.text, maxEmDashes);
  const contracted = useContractions(dashed.text);

  return {
    text: contracted.text,
    changes: {
      bannedPhrasesRemoved: stripped.removed,
      emDashesReplaced: dashed.replaced,
      contractionsApplied: contracted.applied,
      remainingTells: detectAiTells(contracted.text, { maxEmDashes }),
    },
  };
}

export default { stripBannedPhrases, limitEmDashes, useContractions, detectAiTells, applyRules };
