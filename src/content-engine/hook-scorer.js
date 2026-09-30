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

/**
 * Hooks that sound finished and say nothing. Each of these shipped, or is on
 * the list of things that make a reader scroll past a post, because a line
 * that would fit on top of any AI story gives nobody a reason to read the
 * second one.
 *
 * Patterns rather than phrases, because the model varies the wording: "Looks
 * like we need a timeout for rogue AIs", "Looks like OpenAI did it again".
 */
export const GENERIC_HOOKS = [
  { pattern: /\b(is|are) changing the way\b/i, name: 'X is changing the way we...' },
  { pattern: /\bnobody(?:'s| is) talking about\b/i, name: 'nobody is talking about' },
  { pattern: /\bhere'?s what (?:nobody|no one|you)\b/i, name: "here's what nobody..." },
  { pattern: /\bthe future of\b.*\bis here\b|\bthe future is here\b/i, name: 'the future is here' },
  { pattern: /\bchanges everything\b/i, name: 'changes everything' },
  { pattern: /^looks like\b/i, name: 'opens on "looks like"' },
  { pattern: /^guess (?:who|what)\b/i, name: 'opens on "guess who"' },
  { pattern: /\bwho knew\b/i, name: 'who knew' },
  { pattern: /\bwelcome to the\b/i, name: 'welcome to the...' },
  { pattern: /\bplot twist\b/i, name: 'plot twist' },
  { pattern: /\bjust got (?:a lot )?(?:more )?(?:interesting|real|weird)\b/i, name: 'just got interesting' },
  { pattern: /\.{3}\s*interesting\b|\binteresting\.$/i, name: 'ends on "interesting"' },
  { pattern: /\bnew (?:security )?headache\b/i, name: 'the new headache' },
  { pattern: /^so,? /i, name: 'opens on "so"' },
  { pattern: /^(?:ai|artificial intelligence)(?:'s| is| are| just| has| will)\b/i, name: 'AI as the subject of a generic claim' },
  // The template the honest "confession" style fell into on its first real
  // run: six of sixteen hook sets had a "Most of us think X. Y proves
  // otherwise." A shared experience nobody in particular had is still filler.
  { pattern: /^(?:most|many|a lot|some|all) of us\b/i, name: '"most of us..." template' },
  { pattern: /^(?:we|many|people|everyone) (?:all |often |usually |still )?(?:think|thought|believe|assume)\b/i, name: '"we all think..." template' },
  { pattern: /^many believe\b/i, name: '"many believe..." template' },
  { pattern: /^it'?s (?:like|a lot like|basically)\b/i, name: 'a comparison with no subject' },
  // The LinkedIn-creator openers. Every one of them is a promise of content
  // rather than content, and readers have learned to scroll past all of them.
  { pattern: /^(?:ever wondered|have you ever|imagine (?:a|if|this)|picture this|in a world where)\b/i, name: 'creator-course opener' },
  { pattern: /^(?:let'?s talk about|let'?s dive|we need to talk|big news|breaking|unpopular opinion|hot take|psa)\b/i, name: 'announces a take instead of making it' },
  { pattern: /\bhere'?s (?:why|how|what)(?: it matters| this matters| you need to know)?[.:]?$/i, name: 'ends on "here\'s why"' },
  { pattern: /\bthread\b|🧵|🚨|👇/i, name: 'thread/alarm bait' },
];

/** Openers that read like a news desk instead of a person with an opinion. */
const NEWSY_OPENERS = ['techcrunch', 'according to', 'reports that', 'it was announced', 'in a recent'];

/**
 * Score a single hook from 0 to 1.
 *
 * @param {string} hook
 * @param {number} maxChars  hard limit before LinkedIn truncates
 * @param {object} [options]
 * @param {string[]} [options.anchors]  names and numbers from the story, in
 *   lowercase. When given, a hook that contains none of them is marked down:
 *   it could sit on top of a post about anything.
 */
export function scoreHook(hook, maxChars = 140, { anchors } = {}) {
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

  const generic = GENERIC_HOOKS.filter((rule) => rule.pattern.test(text));
  if (generic.length) {
    score -= 0.3 * generic.length;
    notes.push(`generic: ${generic.map((rule) => rule.name).join(', ')}`);
  }

  // The rule the old scorer could not express: is there anything in this
  // line that belongs to THIS story? Short and punchy with no specific in it
  // used to score best of all, which is how "Looks like we need a timeout
  // for rogue AIs" won.
  if (anchors?.length) {
    const anchored = anchors.some((anchor) => mentionsAnchor(lower, anchor));

    if (anchored) {
      score += 0.1;
      notes.push('anchored in the story');
    } else {
      score -= 0.3;
      notes.push('nothing specific from the story');
    }
  }

  return {
    score: Number(Math.min(1, Math.max(0, score)).toFixed(3)),
    notes,
  };
}

/** Whole-word, so the anchor "meta" does not fire inside "metadata". */
function mentionsAnchor(text, anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/** Is this hook generic enough that it should never ship? */
export function isGenericHook(hook) {
  return GENERIC_HOOKS.some((rule) => rule.pattern.test(String(hook ?? '').trim()));
}

const RATER_PROMPT = `You choose the first line of a LinkedIn post for a
developer audience. The first line is all most people read. It has to give a
developer a specific reason to read the second line.

You get the story, the point the post will make, and several candidate first
lines. Rate each one 1-5:

  1  generic. Would fit on top of a post about any AI story. Or clickbait:
     promises something the post cannot deliver.
  2  on topic but flat. Names the subject, gives no reason to keep reading.
  3  specific. A concrete detail from the story, and some reason to continue.
  4  specific curiosity. A concrete detail that makes a developer want the
     explanation, and it leads straight into the point of the post.
  5  the line people screenshot. Specific, surprising, and true to the story.
     It opens a question the reader now needs answered, and it sounds like
     a person said it out loud, not like a headline or a course ad.

Most candidates you see are 2s and 3s. Be stingy with 4 and 5.

A line that would still make sense on a different story, once you swap the
company name, is at most a 2. So is a line that is interesting but does not
lead to the point of the post: the hook sets up the argument, it is not a
separate one. Templates are a 1 however they are dressed up:
  "Most of us think X. [Company] proves otherwise."
  "It's like [analogy]." with no subject
  "[Company] just did X. That's... interesting."

Mark down, hard: made-up personal anecdotes ("I spent two days..."), puns
standing in for a point, rhetorical questions with obvious answers, anything
that overstates what the story says, and lines that just restate the headline.

The reason is required: name what is specific about the line, or what is
missing from it.

Reply as JSON:
{"ratings": [{"index": 0, "score": 1-5, "reason": "a few words, blunt"}]}`;

/**
 * Ask the model to rate the candidates against the story and the point of the
 * post. The rules above catch the obvious failures; they cannot tell whether
 * a line creates any curiosity, and that is most of what a hook is for.
 *
 * Never throws. A rater that cannot be reached leaves the rules to decide on
 * their own, the way they always did.
 *
 * @returns {Promise<Array<{score: number, reason: string}>|null>} aligned with hooks
 */
export async function rateHooks({ hooks, article, insight, llm, model }) {
  const lines = (hooks ?? []).map((hook) => String(hook?.text ?? hook ?? '').trim());
  if (lines.length < 2) return null;

  try {
    const result = await llm.chatJson({
      label: 'rate-hooks',
      model: model || undefined,
      temperature: 0.2,
      maxTokens: 400,
      system: RATER_PROMPT,
      user: `STORY: ${article.title}
What happened: ${insight?.whatHappened || article.summary || ''}
The point of the post: ${insight?.insight || article.curation?.angle || '(not given)'}

CANDIDATES
${lines.map((line, index) => `${index}: ${line}`).join('\n')}`,
    });

    const ratings = lines.map(() => null);

    for (const entry of result?.ratings ?? []) {
      const index = Number(entry?.index);
      if (!Number.isInteger(index) || index < 0 || index >= lines.length) continue;

      ratings[index] = {
        score: Math.min(5, Math.max(1, Number(entry.score) || 1)),
        reason: String(entry.reason ?? '').trim(),
      };
    }

    return ratings.some(Boolean) ? ratings : null;
  } catch {
    return null;
  }
}

/**
 * Rank every candidate and pick one, plus the full scoreboard so a dry run
 * can show what it was choosing between.
 *
 * Not a strict argmax. The rules above are crude - they measure length,
 * clichés and punctuation, not whether a line is any good - so a 0.70 and a
 * 0.68 are the same hook as far as this function actually knows. Taking the
 * exact maximum every time turned that noise into a rule, and since the model
 * lists its safest line first, the safest line kept winning ties. Four
 * candidates scoring identically is normal; always shipping the first one is
 * how a page ends up with one voice.
 *
 * So anything within `jitter` of the top is a real contender and one is
 * picked at random. `random` is injectable to keep the tests deterministic.
 *
 * Two scores go into the ranking when both are available. The rules measure
 * what can be measured - length, clichés, whether anything in the line
 * belongs to this story - and the rater judges what cannot, which is whether
 * it makes anyone want to read on. The rater gets the larger share, because
 * that is the question that matters; the rules still sink anything generic.
 *
 * @param {Array<string|{text: string, style?: string}>} hooks
 * @param {object} [options]
 * @param {number} [options.maxChars]  hard limit before LinkedIn truncates
 * @param {number} [options.jitter]    how far below the top still counts
 * @param {function} [options.random]  0-1 source, for tests
 * @param {string[]} [options.anchors] see scoreHook
 * @param {Array} [options.ratings]    from rateHooks, aligned with hooks
 * @param {string} [options.avoidStyle] the last post's opening style, marked
 *   down a little so two posts in a row do not open the same way
 */
export function pickBestHook(hooks, {
  maxChars = 140,
  jitter = 0,
  random = Math.random,
  anchors,
  ratings,
  avoidStyle,
} = {}) {
  const scored = (hooks ?? [])
    .map((hook, index) => {
      const text = String(hook?.text ?? hook ?? '').trim();
      const style = hook?.style ? String(hook.style) : undefined;
      const rules = scoreHook(text, maxChars, { anchors });
      const rating = ratings?.[index] ?? null;
      const notes = [...rules.notes];

      let score = rules.score;

      if (rating) {
        score = 0.4 * rules.score + 0.6 * ((rating.score - 1) / 4);
        notes.push(`rated ${rating.score}/5${rating.reason ? `: ${rating.reason}` : ''}`);
      }

      if (avoidStyle && style === avoidStyle) {
        score -= 0.05;
        notes.push('same opening style as the last post');
      }

      return {
        hook: text,
        ...(style ? { style } : {}),
        score: Number(Math.min(1, Math.max(0, score)).toFixed(3)),
        ...(rating ? { rating: rating.score } : {}),
        notes,
      };
    })
    .filter((entry) => entry.hook)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { best: '', scored: [] };

  // The list is sorted, so the contenders are always a prefix of it.
  const cutoff = scored[0].score - jitter;
  const contenders = scored.filter((entry) => entry.score >= cutoff);

  // Math.random() can return values that floor to the length on some engines,
  // so clamp rather than trust it.
  const index = Math.min(contenders.length - 1, Math.floor(random() * contenders.length));

  return {
    best: contenders[index].hook,
    style: contenders[index].style,
    scored: scored.map((entry, position) => ({ ...entry, chosen: position === index })),
    contenders: contenders.length,
  };
}

export default { scoreHook, pickBestHook, rateHooks, isGenericHook, CLICHES, GENERIC_HOOKS };
