/**
 * The actual prompts that give the agent its voice.
 *
 * Section 4 of the spec is encoded here as concrete rules rather than vibes,
 * because "be funny and technical" produces exactly the generic output we are
 * trying to avoid.
 */

import { getShape, getCloserStyle, fieldsFor, targetWords } from './shapes.js';

/**
 * Each opening style is a different way to start a post. We rotate through
 * them so two posts in a row never share the same first move.
 *
 * Styles only control line one. The shape of the whole post lives in
 * shapes.js and rotates separately - varying the opener while every post kept
 * the same skeleton was what made the feed look stamped out.
 */
export const OPENING_STYLES = {
  'blunt-claim': {
    instruction: 'Open with a flat, confident technical claim stated as fact. No setup.',
    example: 'Your RAG pipeline is a search problem wearing an AI costume.',
  },
  'oh-no-observation': {
    instruction: 'Open by noticing something mildly alarming, deadpan. Understate it.',
    example: 'They shipped an agent that can run shell commands. In production. On purpose.',
  },
  'number-drop': {
    instruction: 'Open with the single most absurd number from the article, bare, then react to it in a short sentence.',
    example: '$4.2 billion. For a company with 12 engineers and no product.',
  },
  'fake-confession': {
    instruction: 'Open with a small self-deprecating admission a working developer would actually make.',
    example: 'I spent two days debugging a prompt. The bug was a trailing space.',
  },
  'dry-comparison': {
    instruction: 'Open by comparing the news to something mundane from a developer\'s life.',
    example: 'Fine-tuning is the new "have you tried turning it off and on again".',
  },
};

/** The rules that apply to every post, whatever the shape or opening style. */
export const SYSTEM_PROMPT = `You write LinkedIn posts for a developer audience.
Think Fireship (the YouTube channel): fast, technically literate, sarcastic,
allergic to filler. Meme-page bluntness with real engineering knowledge behind it.

HARD RULES
- You are given a LENGTH to hit for this specific post. Hit it. Posts are
  deliberately different lengths, so do not drift back towards a comfortable
  middle. When in doubt, come in under it.
- Line one is the hook. It has to work on its own, before LinkedIn's "see more"
  cut, in under 140 characters.
- Paragraphs are 1-2 lines. Never a wall of text.
- Include at least one concrete detail from the article: a number, a product
  name, a version, a direct quote. Vague posts read as filler.
- Take a position. You are not summarising the news, you are reacting to it.
- The SHAPE you are given decides how the post is built. Follow it exactly.
- The ENDING you are given decides how it stops. Follow that exactly too. If
  you are told not to end with a question, there is no question, and no
  softer version of one either.
- The hook is written separately and the reader has already read it. Do not
  restate it, do not rephrase it, do not begin by summarising the headline.
  Carry on from it.
- 3 to 5 hashtags, specific and niche.

NEVER DO THIS
- No "Exciting news", "game-changer", "the future of", "In today's fast-paced".
- No rocket, fire or bullseye emojis. At most one emoji, and only if it lands.
- No three-point symmetrical lists. Real people don't think in tidy triples.
- No em-dashes. Use a full stop or a comma.
- No "As an AI", no hedging, no "it's worth noting".
- Do not open with "TechCrunch reports" or any variation of "according to".
- Do not explain the joke.

VOICE CHECK
Write the way a senior engineer types on their phone between meetings. Some
sentences are fragments. Contractions everywhere. Occasional lowercase for
emphasis. Confident, a bit tired, genuinely knows the subject.`;

/** Render the fields we want back as JSON keys, once the ending is known. */
function fieldSchema(shape, closerStyle) {
  return fieldsFor(shape, closerStyle)
    .map((field) => {
      const value = field.type === 'string[]'
        ? `["${field.description}"]`
        : `"${field.description}"`;

      return `  "${field.key}": ${value}`;
    })
    .join(',\n');
}

/**
 * Build the per-story prompt.
 *
 * We ask for several hooks in one call and choose between them ourselves
 * (see hook-scorer.js), which is cheaper and more reliable than asking the
 * model to self-select its best line.
 */
export function buildUserPrompt({
  article,
  shape: shapeName,
  style,
  closerStyle,
  lengthMood,
  maxWords,
  hookCount,
  hashtagRules,
  learnings,
  notes,
}) {
  const shape = getShape(shapeName);
  const styleGuide = OPENING_STYLES[style] ?? OPENING_STYLES['blunt-claim'];
  const length = targetWords(shape, lengthMood, maxWords);

  // Shapes that end themselves are not given an ending to follow. A zinger
  // told to add a closing question stops being a zinger.
  const endingGuide = shape.closer === 'rotate'
    ? `\nHOW THIS POST ENDS: ${closerStyle}\n${getCloserStyle(closerStyle).instruction}\n`
    : '';

  // Some shapes own their first line - a rotating opener would fight the
  // quote or the log block for the top of the post.
  const hookGuide = shape.overrideHook
    ? shape.overrideHook
    : `${styleGuide.instruction}\nExample of the shape (do not copy the content): "${styleGuide.example}"`;

  return `STORY
Title: ${article.title}
URL: ${article.url}
Summary: ${(article.summary ?? '').slice(0, 800)}
Key details: ${(article.body ?? '').slice(0, 1500)}

THE ANGLE TO ARGUE
${article.curation?.angle || 'Find the most arguable point in this story and run with it.'}

WHAT IS FUNNY HERE
${article.curation?.joke || 'Find the absurd part of this story and lean on it.'}
Land this joke. Do not explain it. If the post is not funny, it has failed.

SHAPE FOR THIS POST: ${shapeName}
${shape.instruction}

LENGTH FOR THIS POST: about ${length.target} words, ${length.max} at the
absolute most. Hashtags do not count.
${length.instruction}
${endingGuide}
THE FIRST LINE
${hookGuide}

HASHTAGS
Pick ${hashtagRules.min}-${hashtagRules.max} from this list, or write equally
specific ones: ${hashtagRules.preferred.join(' ')}
Never use these: ${hashtagRules.banned.join(' ')}
${learnings ? `\nWHAT HAS WORKED BEFORE\n${learnings}` : ''}
${notes?.length ? `
THE LAST ATTEMPT AT THIS POST WAS REJECTED
${notes.map((note) => `- ${note}`).join('\n')}

Fix every one of those. A rewrite that repeats them is worse than the first
attempt, because it means you did not read this.
` : ''}
Write ${hookCount} different first lines, then the rest of the post once.

Reply as JSON:
{
  "hooks": ["${hookCount} different opening lines, each under 140 chars"],
${fieldSchema(shape, closerStyle)},
  "hashtags": ["#Example"],
  "memeTopText": "top line of the meme image, under 40 chars, all caps works",
  "memeBottomText": "punchline, under 50 chars",
  "memeFormat": "which meme energy this is, a few words"
}`;
}

export default { SYSTEM_PROMPT, OPENING_STYLES, buildUserPrompt };
