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

export const POST_SHAPES = {
  /**
   * The original shape. Still the best one for a story with a real argument
   * in it, which is why it stays in the rotation rather than being deleted.
   */
  'classic-take': {
    instruction: `Hook, then two or three short lines making your case, then a
closing line that starts an argument. Every line earns its place.`,
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
that lands the punch. Under 25 words total. Do not add context, do not explain,
do not ask a question. Trust the reader.`,
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
      blocks(hook, ...parts.lines, parts.closer, tagLine(hashtags)),
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
    instruction: `Tell what actually happened as a short sequence of beats,
one per line, each starting with a lowercase word or a bare fact. Use two or
four beats, never three, and make them different lengths. No bullet
characters, no numbering, no parallel sentence structure. Then one line of
verdict.`,
    fields: [
      {
        key: 'beats',
        type: 'string[]',
        description: 'two or four beats, one per line, uneven lengths, no bullets or numbers',
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
 */
export function normalizeParts(shape, result) {
  const parts = {};

  for (const field of shape.fields) {
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
