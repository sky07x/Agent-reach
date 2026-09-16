/**
 * Post shapes - the architecture of a post, not its opening line.
 *
 * Rotating opening styles was never enough. Every post still came out as
 * hook / paragraph / paragraph / question / hashtags, because that shape was
 * hard-coded into the assembler. Five different first lines stapled to one
 * skeleton still reads as one template.
 *
 * So a shape owns two things: what we ask the model for, and how the pieces
 * are glued back together. Adding a new shape means adding one entry here and
 * one name in config.content.postShapes. Nothing else changes.
 *
 * How a post ENDS rotates separately, in CLOSER_STYLES below, because "always
 * finish with a question" was its own kind of sameness. A shape either takes
 * a turn of that rotation (closer: 'rotate') or ends itself (closer: 'own').
 */

/**
 * Drop the empty pieces and separate the rest with a blank line.
 *
 * A list of lines keeps its own indentation. Stack frames and log output stop
 * looking like stack frames and log output the moment you left-align them.
 */
function blocks(...pieces) {
  return pieces
    .map((piece) => (Array.isArray(piece)
      ? piece.filter((line) => line.trim()).join('\n')
      : String(piece ?? '').trim()))
    .filter((piece) => piece.trim())
    .join('\n\n');
}

/** Hashtags are optional at assembly time so a shape can leave them off. */
function tagLine(hashtags) {
  return (hashtags ?? []).join(' ');
}

/**
 * How a post ends.
 *
 * Every post used to end with a question, because the writing prompt asked
 * for one every single time. Two posts in a row closing with "how long until
 * X?" and "when will we learn Y?" is the single loudest tell that a feed is
 * coming off a production line, and it is also the most tiring thing to read.
 *
 * So the ending rotates on its own counter, and one of the options is to not
 * have one. A post that just stops reads like a person who said their piece.
 */
export const CLOSER_STYLES = {
  'argument-bait': {
    instruction: 'End on a question someone will want to argue with in the comments.',
    field: 'a specific question people will argue about, never "what do you think?"',
  },
  'flat-verdict': {
    instruction: 'End on a flat verdict. A statement, not a question. Do not soften it.',
    field: 'a flat verdict, under 10 words, no question mark',
  },
  prediction: {
    instruction: 'End by calling what happens next, stated as fact, with no hedging.',
    field: 'what happens next, stated as fact, under 15 words, no question mark',
  },
  dare: {
    instruction: 'End by daring the reader to disagree, or betting against them.',
    field: 'a dare or a bet, under 15 words',
  },
  aside: {
    instruction: `End on a throwaway aside, the way someone mutters the last
line of a story. Lowercase is fine. It should feel unplanned.`,
    field: 'a throwaway aside, lowercase, under 10 words',
  },
  none: {
    instruction: `The post just stops after the last line. No closing line, no
question, no call to action. Do not wrap anything up.`,
    field: null,
  },
};

export function getCloserStyle(name) {
  return CLOSER_STYLES[name] ?? CLOSER_STYLES['argument-bait'];
}

/**
 * How long a post runs.
 *
 * Every post landing at roughly 150 words is its own kind of sameness. It is
 * subtler than a repeated closing question, but a feed where every entry
 * occupies the same amount of screen is obviously machine-paced.
 *
 * The mood picks a point inside the shape's own word range rather than a
 * global one, because the ranges are not comparable: 'full' for a zinger is
 * still shorter than 'tight' for a classic take, and a 150-word zinger is not
 * a zinger.
 */
export const LENGTH_MOODS = {
  tight: {
    position: 0,
    instruction: 'Cut it to the bone. Every word you can delete, delete.',
  },
  short: {
    position: 0.35,
    instruction: 'Keep it brief. Say it and stop.',
  },
  mid: {
    position: 0.7,
    instruction: 'You have room to make the point properly, but do not pad it.',
  },
  full: {
    position: 1,
    instruction: `Take the space. Let it breathe, add the detail that makes it
specific. Still no filler.`,
  },
};

export function getLengthMood(name) {
  return LENGTH_MOODS[name] ?? LENGTH_MOODS.mid;
}

/**
 * The word count to aim for, given a shape and a mood.
 *
 * @returns {{target: number, max: number, instruction: string}}
 */
export function targetWords(shape, moodName, ceiling = Infinity) {
  const mood = getLengthMood(moodName);
  const { min, max } = shape.words;

  return {
    target: Math.round(min + mood.position * (max - min)),
    max: Math.min(max, ceiling),
    instruction: mood.instruction,
  };
}

/**
 * The fields to ask the model for, once the closer style is known.
 *
 * Shapes that end themselves keep their own fields. For the rest, the chosen
 * ending rewrites the closer field, or drops it entirely.
 */
export function fieldsFor(shape, closerStyleName) {
  if (shape.closer !== 'rotate') return shape.fields;

  const style = getCloserStyle(closerStyleName);

  if (!style.field) return shape.fields.filter((field) => field.key !== 'closer');

  return shape.fields.map((field) => (field.key === 'closer'
    ? { ...field, description: style.field }
    : field));
}

/**
 * What a story has to offer before a shape can be used on it.
 *
 * A rotation that ignores this produces posts about nothing. The real case:
 * quote-reaction came up for a story whose only quotes were bland corporate
 * statements. The shape leads with a quote and allows one line of reaction,
 * so it led with "But reasoning has always been something that we've relied
 * on the frontier model providers for" - a sentence fragment starting with a
 * conjunction - and the actual joke the curator had already found never made
 * it into the post at all.
 *
 * So a shape can decline a story, and the rotation walks only what fits.
 */

/** Does the article contain a quote long enough to be worth reacting to? */
export function hasUsableQuote(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`;

  // Curly or straight quotes around something substantial. Short fragments
  // are product names in quotes, not somebody saying a thing.
  const quotes = text.match(/["“]([^"”]{25,200})["”]/g) ?? [];

  return quotes.some((quote) => {
    const inner = quote.slice(1, -1).trim();

    // A quote that opens on a conjunction is a fragment lifted out of the
    // middle of a sentence, and reads as one.
    return !/^(but|and|so|which|that|because)\b/i.test(inner) && inner.split(/\s+/).length >= 6;
  });
}

/** Is there a machine in this story, or is it people talking about one? */
export function hasMechanism(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''}`.toLowerCase();

  return [
    'outage', 'bug', 'crash', 'error', 'deploy', 'server', 'api', 'code',
    'model', 'agent', 'tool', 'build', 'run', 'ship', 'release', 'latency',
    'benchmark', 'token', 'prompt', 'database', 'cluster', 'pipeline',
  ].some((word) => text.includes(word));
}

/** Enough separate happenings to tell as a sequence of beats? */
export function hasSequence(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''}`;

  // Either an explicit sequence, or simply enough distinct facts to list.
  return /\b(then|after|later|first|followed|weeks|days|months)\b/i.test(text)
    || (text.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? []).length >= 4;
}

export const POST_SHAPES = {
  /**
   * The original shape. Still the best one for a story with a real argument
   * in it, which is why it stays in the rotation rather than being deleted.
   */
  'classic-take': {
    instruction: `Hook, then two or three short lines making your case, then a
closing line. Every line earns its place.`,
    closer: 'rotate',
    words: { min: 55, max: 155 },
    // No strong affinity: an argument can be illustrated any number of ways.
    layouts: [],
    // The fallback shape. Every story can carry an argument, which is why
    // this one must never decline: something has to be able to run.
    fits: () => true,
    fields: [
      {
        key: 'body',
        type: 'string',
        description: 'two or three short lines after the hook, no hashtags, no closing question',
      },
      {
        key: 'closer',
        type: 'string',
        description: 'the last line, a take or a question people will want to argue with',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.body, parts.closer, tagLine(hashtags)),
  },

  /**
   * Two lines and out. The scroll-stopper. Works when the story is absurd
   * enough that explaining it would ruin it.
   */
  'two-line-zinger': {
    instruction: `Two lines. That is the whole post. The hook, then one line
that lands the punch. Do not add context, do not explain, do not ask a
question. Trust the reader.`,
    // Owns its ending: a zinger with anything after it is not a zinger.
    closer: 'own',
    words: { min: 14, max: 30 },
    // Big bold type for a line meant to stop a thumb.
    layouts: ['classic'],
    // A zinger needs one absurd fact, which any story worth curating has.
    fits: () => true,
    fields: [
      {
        key: 'punchline',
        type: 'string',
        description: 'one single line under 15 words that lands the joke, no question mark',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.punchline, tagLine(hashtags)),
  },

  /**
   * A short rant that stops dead instead of asking permission to comment.
   * The missing question is the point: it reads like someone who was annoyed
   * enough to type, not like a content calendar.
   *
   * Every line gets its own paragraph. On a phone that reads as a staircase
   * rather than a block, which is the whole visual difference from
   * classic-take - same words in one paragraph would look like the same post.
   */
  'slow-burn-rant': {
    instruction: `A short rant. Hook, then three or four lines that build,
each one its own paragraph. Sentences get shorter as you go. End on a flat
statement, not a question. Never ask the reader anything. The last line should
feel like you put the phone down after typing it.`,
    // Owns its ending: stopping dead is the whole point of the shape.
    closer: 'own',
    words: { min: 40, max: 105 },
    // A rant is someone talking, so give it a voice on the image too.
    layouts: ['chat', 'classic'],
    // You can only rant about something that actually does something.
    fits: hasMechanism,
    fields: [
      {
        key: 'lines',
        type: 'string[]',
        description: 'three or four separate lines that build, each shorter than the last',
      },
      {
        key: 'closer',
        type: 'string',
        description: 'a flat final statement, under 10 words, absolutely no question mark',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, ...(parts.lines ?? []), parts.closer, tagLine(hashtags)),
  },

  /**
   * Fake terminal output. Visually unmistakable in a feed of prose, and the
   * monospace block survives LinkedIn's formatting because it is just text.
   */
  'terminal-log': {
    instruction: `One line of setup, then a short block of fake terminal or log
output that tells the story, then one line reacting to it. The log lines must
look like real output: prefixes, timestamps, exit codes, stack frames. Make
them technically plausible for the story. No more than five lines.`,
    closer: 'rotate',
    // The log block eats most of the budget, so the prose around it is short.
    words: { min: 35, max: 85 },
    // The obvious one. A post that is fake terminal output gets a terminal.
    layouts: ['terminal'],
    // Fake log output about a funding round is nonsense. There has to be a
    // machine in the story for a machine to be narrating.
    fits: hasMechanism,
    fields: [
      {
        key: 'logLines',
        type: 'string[]',
        description: 'three to five lines of plausible fake log or terminal output, each under 70 chars',
      },
      {
        key: 'closer',
        type: 'string',
        description: 'one line reacting to the log, dry, under 15 words',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.logLines, parts.closer, tagLine(hashtags)),
  },

  /**
   * Someone said something indefensible. Quote it, react in one line, get out.
   * The shape owns its own hook, so the opening-style rotation sits this one
   * out - a rotating opener would fight the quote for the first line.
   */
  'quote-reaction': {
    instruction: `Lead with a real quote from the story, in quotation marks,
with who said it. Then one line of reaction. The reaction does the work, so
keep it to a single sentence. If the story has no usable quote, use the most
absurd exact phrase from it instead.`,
    closer: 'rotate',
    words: { min: 22, max: 60 },
    layouts: ['quote'],
    // The one that went wrong. No quote, no quote-reaction.
    fits: hasUsableQuote,
    overrideHook: `The first line is the quote itself, in quotation marks,
followed by an em-dash-free attribution on the same line or the next one.
Example shape: "We don't see this as a security risk." - the CTO, last week.`,
    fields: [
      {
        key: 'reaction',
        type: 'string',
        description: 'one sentence reacting to the quote, under 20 words',
      },
      {
        key: 'closer',
        type: 'string',
        description: 'optional second line, or an empty string if the reaction says enough',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.reaction, parts.closer, tagLine(hashtags)),
  },

  /**
   * The sequence of events, told as beats. Deliberately an even number of
   * beats or four, never a tidy three - a symmetrical triple is the oldest
   * AI-writing tell there is.
   */
  receipts: {
    instruction: `Tell what actually happened as a short sequence of beats.

A beat is a fragment, not a sentence. Three to six words. No verb is fine.
"funding closed friday" is a beat. "Meta launched a new MCP server that lets
AI agents set up messaging" is not, that is a press release.

Use two or four beats, never three, and make them different lengths. Start
each one lowercase. No bullet characters, no numbering, no two beats built the
same way. Then one line of verdict.`,
    closer: 'rotate',
    words: { min: 25, max: 70 },
    // Beats are a sequence, and two-panel is the before/after shape.
    layouts: ['two-panel'],
    // Beats need things to have happened, plural.
    fits: hasSequence,
    fields: [
      {
        key: 'beats',
        type: 'string[]',
        description: 'two or four fragments of three to six words each, lowercase, uneven, no bullets',
      },
      {
        key: 'closer',
        type: 'string',
        description: 'the verdict, one line',
      },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.beats, parts.closer, tagLine(hashtags)),
  },
};

/** The shape we fall back to when the model returns something unusable. */
export const FALLBACK_SHAPE = 'classic-take';

export function getShape(name) {
  return POST_SHAPES[name] ?? POST_SHAPES[FALLBACK_SHAPE];
}

/**
 * Pull this shape's fields out of the model's JSON and coerce them into the
 * types the assembler expects. A model that returns a string where we wanted
 * an array is a normal Tuesday, so handle it rather than throwing.
 *
 * It reads the same field list the prompt asked for, which matters for the
 * "none" ending: we stop asking for a closer, but a model will often volunteer
 * one anyway, and reading it back would put the closing line straight back on
 * a post that is supposed to just stop.
 */
export function normalizeParts(shape, result, closerStyle) {
  const parts = {};

  for (const field of fieldsFor(shape, closerStyle)) {
    const raw = result?.[field.key];

    if (field.type === 'string[]') {
      const list = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');

      // trimEnd, not trim: leading spaces are load-bearing in a log block.
      parts[field.key] = list
        .map((line) => String(line ?? '').replace(/\s+$/, ''))
        .filter((line) => line.trim());
    } else {
      parts[field.key] = String(raw ?? '').trim();
    }
  }

  return parts;
}

/** Did the model give us enough to actually build this shape? */
export function hasEnough(shape, parts) {
  return shape.fields.some((field) => {
    const value = parts[field.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/**
 * Build the text that goes on LinkedIn.
 *
 * If the shape came back empty we fall back rather than fail the run - one
 * bland post beats a cycle that produced nothing.
 */
export function assemblePost({ shapeName, hook, parts, hashtags }) {
  const shape = getShape(shapeName);

  if (hasEnough(shape, parts)) {
    return shape.assemble({ hook, parts, hashtags }).replace(/\n{3,}/g, '\n\n').trim();
  }

  return blocks(hook, tagLine(hashtags));
}

export default { POST_SHAPES, getShape, normalizeParts, hasEnough, assemblePost, FALLBACK_SHAPE };
