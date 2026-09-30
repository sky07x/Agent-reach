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
    instruction: `End on one specific question about THIS story that two informed
developers would answer differently. Name the thing it is about. Never "what do
you think?", "thoughts?" or anything that would fit under any other post.`,
    field: 'one specific question naming something from the story, never "what do you think?"',
    // A question with nothing to disagree about is "what do you think?" in a
    // costume. Only offered when the insight found a real counter-argument.
    needsTension: true,
  },
  'flat-verdict': {
    instruction: 'End on a flat verdict about this specific story. A statement, not a question. Do not soften it.',
    field: 'a flat verdict about this story, under 12 words, no question mark',
  },
  prediction: {
    instruction: `End by calling one specific, checkable thing that happens next
because of this story, stated as fact. "Things will change" is not a
prediction; "every notetaker without a CRM integration is a feature now" is.`,
    field: 'one specific, checkable consequence of this story, under 15 words, no question mark',
  },
  dare: {
    instruction: `End with a bet about this story that someone could actually
lose. Name the outcome. Not "disagree if you want", not "good luck with that".`,
    field: 'a specific bet about this story, under 15 words',
    needsTension: true,
  },
  // It used to ask for "a throwaway aside", and that is exactly what came
  // back: "Funny how that works." "Kind of ironic, isn't it?" A shrug is not
  // an aside. The good version adds one more real fact, casually: "Oh, and
  // the 12-month revenue retention rate jumped."
  aside: {
    instruction: `End on a casual aside that adds ONE more real detail from the
story, the one a reader would find telling. Lowercase is fine, but names
keep their capitals ("ChatGPT", never "chatgpt"). Not a reaction
("funny how that works", "kind of ironic"): a fact.`,
    field: 'one more telling fact from the story, said casually, under 15 words, not a reaction',
  },
  none: {
    instruction: `The post just stops after the last line. No closing line, no
question, no call to action. Do not wrap anything up.`,
    field: null,
  },
  // The line people screenshot. What makes a post worth saving is usually
  // one sentence that compresses it, stated plainly enough to repeat.
  takeaway: {
    instruction: `End on the one line a reader would copy into their notes: the
lesson of this story for someone who builds software, stated plainly. Not a
slogan, not motivation, not a question. It names the specific thing.`,
    field: 'the lesson in one plain sentence, under 18 words, names something specific, no question mark',
  },
  // "What do you think?" gets "great post". A question about the reader's own
  // setup gets an answer, because people like describing their own stack.
  'practitioner-question': {
    instruction: `End by asking the readers who build this kind of thing one
concrete question about their own practice, where the answer is a real choice
they made: "Are you pinning model versions in prod, or letting the alias
float?" Name the choice. Never "what do you think?", "thoughts?", "agree?" or
anything that would fit under another post.`,
    field: 'one question about the reader\'s own practice, naming a concrete choice, under 22 words',
  },
};

/**
 * Can this ending be used on this story?
 *
 * Endings used to rotate blind, so a story with nothing to argue about still
 * got "argument-bait" and closed on "Can any startup survive the AI tornado?".
 * An ending that needs a disagreement is only offered when the insight step
 * found one. Without an insight we cannot tell, so nothing is ruled out.
 */
export function closerFits(name, insight) {
  const style = CLOSER_STYLES[name];
  if (!style) return false;
  if (!style.needsTension || !insight) return true;
  return Boolean(String(insight.tension ?? '').trim());
}

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

/** Whole-word match, so "run rate" is not a run and "Shipt" is not a ship. */
function mentions(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/**
 * Is there a machine in this story, or is it people talking about one?
 *
 * This used plain includes(), and the words were short enough to hide inside
 * others: "revenue run rate" counted as a run, "Shipt" as a ship, "capital"
 * as an api. That is how a fundraising story and a grocery app both got fake
 * terminal logs with invented numbers in them. Whole words only, and no
 * "run" or "ship", which describe every business story ever written.
 */
export function hasMechanism(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''}`.toLowerCase();

  return [
    'outage', 'bug', 'bugs', 'crash', 'crashed', 'error', 'errors', 'deploy',
    'deployment', 'server', 'servers', 'api', 'apis', 'code', 'codebase',
    'model', 'models', 'agent', 'agents', 'tool', 'tools', 'build', 'latency',
    'benchmark', 'benchmarks', 'token', 'tokens', 'prompt', 'prompts',
    'database', 'cluster', 'pipeline', 'inference', 'gpu', 'gpus', 'compiler',
    'sdk', 'repo', 'mcp',
  ].some((word) => mentions(text, word));
}

/** Enough separate happenings to tell as a sequence of beats? */
export function hasSequence(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''}`;

  // Either an explicit sequence, or simply enough distinct facts to list.
  return /\b(then|after|later|first|followed|weeks|days|months)\b/i.test(text)
    || (text.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? []).length >= 4;
}

/**
 * Enough real numbers to build a post, and a chart, on? Money, percentages,
 * multiples and counts with a scale. Years and dates do not count: every
 * article has those.
 */
export function hasNumbers(article) {
  const text = `${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`;
  const withUnit = text.match(/\$\s?\d[\d,.]*\s?(?:[kmb]\b|million|billion|trillion)?|\d[\d,.]*\s?(?:%|x\b|percent|million|billion|trillion)/gi) ?? [];
  // "3,000 customers" is a telling number too; "2026" is a date.
  const counts = (text.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/g) ?? []).filter((value) => !/^(?:19|20)\d\d$/.test(value));
  return new Set([...withUnit, ...counts].map((value) => value.toLowerCase().replace(/\s+/g, ''))).size >= 2;
}

/** Strip the bullets and arrows a model adds to list items on its own. */
function unbullet(line) {
  return String(line ?? '').replace(/^\s*(?:[-*•→>]+|\d+[.)])\s*/, '').trim();
}

export const POST_SHAPES = {
  /**
   * How the thing actually works. The post engineers save: they came for the
   * headline and leave understanding the mechanism behind it.
   */
  breakdown: {
    instruction: `Explain how the thing in this story actually works, to an
engineer who only saw the headline. After the first line: one or two lines of
setup, then the mechanism as a few short steps, in plain words, in the order
things happen. Use only the steps the article describes (you are given them
under MECHANISM); do not invent internals. Then the part most people will miss,
and what it means, in your own voice. Steps are different lengths and never
start the same way.`,
    suits: 'a product, model, attack or technique whose inner workings the article actually describes',
    closer: 'rotate',
    words: { min: 110, max: 220 },
    layouts: [],
    visuals: ['flow', 'code', 'comparison'],
    fits: hasMechanism,
    fitsInsight: (insight) => (insight.mechanism?.length ?? 0) >= 2,
    fields: [
      { key: 'setup', type: 'string', description: 'one or two lines after the hook that say what we are looking at' },
      { key: 'steps', type: 'string[]', description: 'two to five steps of the mechanism, plain words, uneven lengths, no numbering or bullets' },
      { key: 'insight', type: 'string', description: 'one to three lines: the part most people miss and what it means' },
      { key: 'closer', type: 'string', description: 'the last line' },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.setup, (parts.steps ?? []).map((step) => `→ ${unbullet(step)}`), parts.insight, parts.closer, tagLine(hashtags)),
  },

  /**
   * The headline says one thing; a detail in the article says another. The
   * post that makes people go back and reread the story.
   */
  contrarian: {
    instruction: `The obvious read of this headline is wrong, or at least
incomplete, and a specific detail in the article shows it. The first line
already names that obvious read or the flip. Then: the detail that changes it,
quoted or stated exactly, and why it changes the picture. Then what it
means: for the company, the market, or the people building with it,
whichever is truest to this story. Never write "most people think", "many believe"
or "we all assume": say what the headline implies, then say what the article
actually shows.`,
    suits: 'the headline invites one conclusion and a detail in the article points to a different one',
    closer: 'rotate',
    words: { min: 70, max: 165 },
    layouts: ['two-panel'],
    visuals: ['comparison', 'stat', 'quote'],
    fits: () => true,
    fitsInsight: (insight) => Boolean(String(insight.commonRead ?? '').trim()),
    fields: [
      { key: 'turn', type: 'string', description: 'two to four short lines: the detail from the article that changes the obvious read' },
      { key: 'meaning', type: 'string', description: 'one to three lines: what it means, for whoever it matters to most in this story' },
      { key: 'closer', type: 'string', description: 'the last line' },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.turn, parts.meaning, parts.closer, tagLine(hashtags)),
  },

  /**
   * What this changes on Monday morning. Practical, specific, saveable.
   */
  'builder-notes': {
    instruction: `What this story changes for someone actually building with it.
After the first line: one line of context, then two or four concrete notes,
each one thing an engineer should do, check, measure or stop doing because of
this story, each naming a specific from it. Each note is ONE sentence, under
25 words: a note, not a paragraph. Not advice that would be true without this
story ("write tests", "monitor your costs"). Notes are different lengths and
built differently. Never three notes. No questions inside the notes.`,
    suits: 'a launch, change, price or failure that changes what an engineer should do, check or avoid',
    closer: 'rotate',
    words: { min: 85, max: 165 },
    layouts: [],
    visuals: ['checklist', 'code', 'comparison'],
    fits: hasMechanism,
    fields: [
      { key: 'context', type: 'string', description: 'one line of context after the hook' },
      { key: 'notes', type: 'string[]', description: 'two or four notes, each ONE sentence under 25 words, tied to this story, uneven lengths, no numbering' },
      { key: 'closer', type: 'string', description: 'the last line' },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, parts.context, (parts.notes ?? []).map((note, index) => `${index + 1}. ${unbullet(note)}`), parts.closer, tagLine(hashtags)),
  },

  /**
   * The story, told as a story. People read to the end of a story; nobody
   * reads to the end of a summary.
   */
  'story-mode': {
    instruction: `Tell it as a short story. The first line puts the reader inside
the moment. Then what happened, in order, in short paragraphs of one or two
lines, keeping the tension the facts contain: the decision, the bet, the turn.
Third person, about the people and companies in the article. Only events the
article describes; no invented scenes, dialogue, feelings or reactions. End
on what the story says, in one or two lines. A lesson for engineers only if
it is genuinely there; a good story often lands better without one.`,
    suits: 'people made a decision, a bet or a mistake and there is a turn: a pivot, a launch that backfired, a founder\'s call',
    closer: 'rotate',
    words: { min: 110, max: 210 },
    layouts: ['two-panel'],
    visuals: ['flow', 'quote', 'stat'],
    fits: hasSequence,
    fields: [
      { key: 'scenes', type: 'string[]', description: 'three to five short paragraphs telling what happened, in order' },
      { key: 'lesson', type: 'string', description: 'one or two lines on what the story says; a lesson only if it is genuinely there' },
      { key: 'closer', type: 'string', description: 'the last line' },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, ...(parts.scenes ?? []), parts.lesson, parts.closer, tagLine(hashtags)),
  },

  /**
   * Let the numbers talk. A post built on the story's own figures, and a
   * chart that shows them.
   */
  numbers: {
    instruction: `The numbers are the story. After the first line: two to four
short paragraphs, each built on one number from NUMBERS, exactly as given,
saying what it means in plain words. Put them side by side where the contrast
between them is the point. No numbers that are not in the story, and no maths
on them. Then the takeaway.`,
    suits: 'a story with two or more telling numbers whose contrast is the point',
    closer: 'rotate',
    words: { min: 70, max: 160 },
    layouts: ['classic'],
    visuals: ['chart', 'stat'],
    fits: hasNumbers,
    fitsInsight: (insight) => (insight.numbers?.length ?? 0) >= 2,
    fields: [
      { key: 'figures', type: 'string[]', description: 'two to four short paragraphs, each built on one exact number from the story' },
      { key: 'closer', type: 'string', description: 'the last line' },
    ],
    assemble: ({ hook, parts, hashtags }) =>
      blocks(hook, ...(parts.figures ?? []), parts.closer, tagLine(hashtags)),
  },

  /**
   * The original shape. Still the best one for a story with a real argument
   * in it, which is why it stays in the rotation rather than being deleted.
   */
  'classic-take': {
    instruction: `Hook, then two or three short lines making your case: the
evidence, what it means, and the point. Then a closing line. Every line
earns its place, and none of them retells the headline. One idea only.`,
    // What the insight step reads when it decides which shapes suit a story.
    suits: 'any story with a real argument in it; the safe default',
    closer: 'rotate',
    words: { min: 55, max: 155 },
    // No strong affinity: an argument can be illustrated any number of ways.
    layouts: [],
    visuals: ['comparison', 'stat', 'flow'],
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
that lands the point: a consequence of the fact, not a reaction to it. Do
not add context, do not explain, do not ask a question. Trust the reader.`,
    // Owns its ending: a zinger with anything after it is not a zinger.
    suits: 'one fact so absurd or contradictory that putting it next to its consequence is the whole point',
    closer: 'own',
    words: { min: 14, max: 30 },
    // Big bold type for a line meant to stop a thumb.
    layouts: ['classic'],
    visuals: ['stat', 'meme'],
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
each one its own paragraph. Each line is a complete sentence, never half of
one. Sentences get shorter as you go. End on a flat statement, not a question.
Never ask the reader anything, not even rhetorically. The last line should
feel like you put the phone down after typing it.`,
    suits: 'a decision, default or product that will cause specific, real developer pain',
    // Owns its ending: stopping dead is the whole point of the shape.
    closer: 'own',
    words: { min: 40, max: 105 },
    // A rant is someone talking, so give it a voice on the image too.
    layouts: ['chat', 'classic'],
    visuals: ['meme'],
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
look like real output: prefixes, exit codes, stack frames, clock times. Make
them technically plausible for the story, and use only numbers that are in the
story. No invented percentages, no dates. No more than five lines.`,
    suits: 'a system doing something: an outage, an agent, a bug, a benchmark, a model misbehaving. Never money or people.',
    closer: 'rotate',
    // The log block eats most of the budget, so the prose around it is short.
    words: { min: 35, max: 85 },
    // The obvious one. A post that is fake terminal output gets a terminal.
    layouts: ['terminal'],
    visuals: ['code'],
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
keep it to a single sentence: your answer to the quote, the thing it gives
away. Say it directly. Never narrate it ("This shows...", "This highlights...",
"This reveals..."), and never describe how it made you feel. If the story has
no usable quote, use the most revealing exact phrase from it instead.`,
    suits: 'someone said something revealing, in a real quote in the article',
    closer: 'rotate',
    words: { min: 22, max: 60 },
    layouts: ['quote'],
    visuals: ['quote'],
    // The one that went wrong. No quote, no quote-reaction.
    fits: hasUsableQuote,
    overrideHook: `The first line is the quote itself, in quotation marks,
followed by an em-dash-free attribution on the same line or the next one.
Example shape: "We don't see this as a security risk." - the CTO, last week.`,
    fields: [
      {
        key: 'reaction',
        type: 'string',
        description: 'one sentence answering the quote, under 20 words, never starting "This shows/highlights/reveals"',
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
each one lowercase, but keep names capitalised: "OpenAI", never "openai". No
bullet characters, no numbering, no two beats built the same way.

The beats are there to set up the verdict. Order them so the last one makes
the contradiction obvious, then the verdict says what it means. Beats that just
retell the article in order are a summary, not a post.`,
    suits: 'several things happened, and their order is the point: a contradiction, a reversal or an escalation',
    closer: 'rotate',
    words: { min: 25, max: 70 },
    // Beats are a sequence, and two-panel is the before/after shape.
    layouts: ['two-panel'],
    visuals: ['flow', 'comparison'],
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
