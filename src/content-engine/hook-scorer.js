/**
 * Pick the strongest opening line out of the model's candidates.
 *
 * The first draft an LLM produces is usually its blandest, so we ask for
 * several hooks and choose between them with plain rules. No extra API call,
 * and the rules are easy to argue with and adjust.
 */

/** Phrases that instantly make a hook sound machine-written. */
const CLICHES = [
  'exciting news', 'game-changer', 'game changer', 'the future of', 'revolutionary',
  'in today\'s', 'let that sink in', 'here\'s the thing', 'buckle up', 'mind-blowing',
  'we need to talk about', 'this changes everything', 'is here to stay', 'deep dive',
  'unlock', 'leverage', 'seamless', 'cutting-edge', 'transformative',
];

/** Openers that read like a news desk instead of a person with an opinion. */
const NEWSY_OPENERS = ['techcrunch', 'according to', 'reports that', 'it was announced', 'in a recent'];

/**
 * Score a single hook from 0 to 1.
 *
 * @param {string} hook
 * @param {number} maxChars  hard limit before LinkedIn truncates
 */
export function scoreHook(hook, maxChars = 140) {
  const text = (hook ?? '').trim();
  const lower = text.toLowerCase();

  if (!text) return { score: 0, notes: ['empty'] };

  const notes = [];
  let score = 0.5;

  // Length: it has to survive the "see more" cut, and short hits harder.
  if (text.length > maxChars) {
    score -= 0.35;
    notes.push('too long, will be truncated');
  } else if (text.length <= 70) {
    score += 0.2;
    notes.push('punchy length');
  } else {
    score += 0.08;
  }

  const foundCliches = CLICHES.filter((phrase) => lower.includes(phrase));
  if (foundCliches.length) {
    score -= 0.25 * foundCliches.length;
    notes.push(`cliche: ${foundCliches.join(', ')}`);
  }

  if (NEWSY_OPENERS.some((phrase) => lower.startsWith(phrase) || lower.includes(phrase))) {
    score -= 0.3;
    notes.push('reads like a news summary');
  }

  // A concrete number is specific, and specific is what we want.
  if (/\d/.test(text)) {
    score += 0.15;
    notes.push('has a number');
  }

  if (text.includes('—') || text.includes('–')) {
    score -= 0.2;
    notes.push('em-dash');
  }

  // A question as the hook competes with the closing question. One is enough.
  if (text.endsWith('?')) {
    score -= 0.1;
    notes.push('question as hook');
  }

  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojiCount > 1) {
    score -= 0.2;
    notes.push('too many emoji');
  }

  // Hedging kills a hook. So does corporate throat-clearing.
  if (/\b(might|maybe|perhaps|arguably|it seems|potentially)\b/i.test(text)) {
    score -= 0.15;
    notes.push('hedging');
  }

  return {
    score: Number(Math.min(1, Math.max(0, score)).toFixed(3)),
    notes,
  };
}

/**
 * Rank every candidate and return the winner plus the full scoreboard, so a
 * dry run can show why one line was chosen over the others.
 */
export function pickBestHook(hooks, maxChars = 140) {
  const scored = (hooks ?? [])
    .map((hook) => ({ hook: String(hook ?? '').trim(), ...scoreHook(hook, maxChars) }))
    .filter((entry) => entry.hook)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { best: '', scored: [] };

  return { best: scored[0].hook, scored };
}

export default { scoreHook, pickBestHook, CLICHES };
