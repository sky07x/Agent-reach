/**
 * Story frames - the emotional shape of a story, not the companies in it.
 *
 * Dedupe used to run on proper nouns alone, which meant "Cymphony raises to
 * fix rogue agents" and "Apple's AI is late, Relay shut down" looked like two
 * unrelated stories. They are not. They are the same post: AI is failing.
 * Posted a day apart, that reads as a page with one opinion.
 *
 * A frame is the angle the story gets told from, and it is what a reader
 * actually notices repeating. Tracking it is what stops every post being a
 * different company failing in the same tone of voice.
 */

/**
 * Each frame carries a description the model reads, and hints the cheap
 * keyword guesser looks for.
 *
 * Hints are whole words or phrases, matched with word boundaries so "bill"
 * does not match inside "billion".
 */
export const STORY_FRAMES = {
  broke: {
    description: 'Something failed, crashed, was pulled, or shut down.',
    hints: [
      'outage', 'went down', 'took down', 'downtime', 'broke', 'broken',
      'crash', 'crashed', 'bug', 'glitch', 'shut down', 'shuts down',
      'shutting down', 'deleted', 'data loss', 'rollback', 'reverted',
      'failed', 'fails', 'breach', 'hacked', 'leaked', 'exposed',
    ],
  },
  'hype-check': {
    description: 'What was promised, measured against what actually shipped.',
    hints: [
      'benchmark', 'benchmarks', 'claims', 'claimed', 'overfit', 'demo',
      'wrapper', 'slop', 'hype', 'overhyped', 'reproduce', 'cherry-picked',
      'marketing', 'delayed', 'still not', 'quietly',
    ],
  },
  'absurd-money': {
    description: 'A number about money that does not survive being said out loud.',
    hints: [
      'billion', 'million', 'valuation', 'raises', 'raised', 'funding',
      'seed round', 'series a', 'series b', 'acquires', 'acquired',
      'acquisition', 'price hike', 'paywall', 'ipo',
    ],
  },
  shipped: {
    description: 'Something genuinely new landed, and it is actually good.',
    // Deliberately no "launches", "released", "introduces" or "unveils".
    // Every tech headline has one of those, so they labelled two thirds of a
    // feed "shipped" and the frame stopped meaning anything. What is left
    // says the thing is actually good, not merely announced.
    hints: [
      'open-sources', 'open sources', 'open-sourced', 'free', 'faster',
      'speedup', 'speed up', 'cheaper', 'rewrote', 'rewritten', 'breakthrough',
      'outperforms', 'beats', 'runs locally', 'on-device', 'smaller',
    ],
  },
  'foot-gun': {
    description: 'A design or a default that is going to bite somebody.',
    hints: [
      'default', 'defaults', 'shell access', 'permissions', 'autonomous',
      'agentic', 'unrestricted', 'root', 'credentials', 'api key',
      'prompt injection', 'jailbreak', 'sandbox', 'rogue',
    ],
  },
  irony: {
    description: 'The thing did the exact opposite of what it promised.',
    hints: [
      'ironic', 'irony', 'admits', 'apologises', 'apologizes', 'apologised',
      'apologized', 'hallucinating', 'hallucinated', 'hallucination',
      'hallucinations', 'accidentally', 'backfired', 'turns out',
    ],
  },
  grind: {
    description: 'Everyday developer pain: migrations, deprecations, breaking changes.',
    hints: [
      'deprecated', 'deprecation', 'breaking change', 'breaking changes',
      'migration', 'migrate', 'sunset', 'end of life', 'eol', 'rewrite',
      'refactor', 'legacy', 'docs', 'documentation', 'boilerplate',
    ],
  },
};

export const FRAME_NAMES = Object.keys(STORY_FRAMES);

/**
 * What we say when the keywords tell us nothing.
 *
 * Deliberately not one of the real frames. Guessing "shipped" for every
 * unmatched story would be claiming to know something we don't, and the
 * cooldown would then treat a pile of unrelated stories as repetitive. An
 * unclear story is exempt from both the fatigue penalty and the shortlist cap.
 */
export const UNKNOWN_FRAME = 'unclear';

/** Whole-word match, so "bill" does not fire on "billion". */
function mentions(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/**
 * A cheap keyword guess at a story's frame.
 *
 * This is deliberately not the final answer. It costs nothing and runs on
 * every shortlist candidate, purely so the shortlist we hand the model is not
 * eight versions of the same story. The model then decides the real frame,
 * and that is what gets stored and cooled down.
 *
 * @returns {{frame: string, confident: boolean}}
 */
export function guessFrame(article) {
  const text = `${article.title ?? ''} ${article.summary ?? ''}`.toLowerCase();

  const scores = FRAME_NAMES
    .map((name) => ({
      name,
      hits: STORY_FRAMES[name].hints.filter((hint) => mentions(text, hint)).length,
    }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (!scores.length) return { frame: UNKNOWN_FRAME, confident: false };

  // A tie means the keywords are not telling us much. Say so rather than
  // pretending, so callers can treat it as a weak signal.
  const tied = scores.length > 1 && scores[0].hits === scores[1].hits;

  return { frame: scores[0].name, confident: !tied && scores[0].hits > 1 };
}

/** The frames list, formatted for a prompt. */
export function describeFrames() {
  return FRAME_NAMES
    .map((name) => `  ${name}: ${STORY_FRAMES[name].description}`)
    .join('\n');
}

export default { STORY_FRAMES, FRAME_NAMES, UNKNOWN_FRAME, guessFrame, describeFrames };
