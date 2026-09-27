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
    instruction: 'Open with a flat, confident technical claim about this story, stated as fact. No setup.',
    example: 'Your RAG pipeline is a search problem wearing an AI costume.',
  },
  'oh-no-observation': {
    instruction: 'Open by noticing the most alarming specific detail in the story, deadpan. Understate it.',
    example: 'They shipped an agent that can run shell commands. In production. On purpose.',
  },
  'number-drop': {
    instruction: 'Open with the single most telling number from the article, bare, then say what it means in a short sentence.',
    example: '$4.2 billion. For a company with 12 engineers and no product.',
    // A number-drop with no number in the story invents one.
    fits: (article) => /\d/.test(`${article?.title ?? ''} ${article?.summary ?? ''}`),
  },
  // Was "fake-confession", and the name was the problem. Its first version
  // produced "I spent a week building a feature. OpenAI just turned it into
  // an add-on" under a real person's name, about a week that never happened.
  // It is renamed so nobody reading the config thinks a made-up confession is
  // on offer, and it admits something about the work, never about the
  // author. Old posts keep the old name in their history.
  'uncomfortable-truth': {
    instruction: `Open with the uncomfortable thing this story says about how
software actually gets built, through one specific detail in it. State it
about the work, not about the author or "us". Never write "I" or "we" as if
something happened to the author, and never open with "most of us".`,
    example: 'Superhuman had 400,000 users and a product team, and still bought the notetaker.',
  },
  'dry-comparison': {
    instruction: 'Open by comparing a specific detail of the news to something mundane from a developer\'s life.',
    example: 'Fine-tuning is the new "have you tried turning it off and on again".',
  },
};

/** The opening styles a story can carry. Most fit anything. */
export function stylesFor(names, article) {
  return names.filter((name) => OPENING_STYLES[name] && (!OPENING_STYLES[name].fits || OPENING_STYLES[name].fits(article)));
}

/** The rules that apply to every post, whatever the shape or opening style. */
export const SYSTEM_PROMPT = `You write LinkedIn posts for a developer audience.
Think Fireship (the YouTube channel): fast, technically literate, dry,
allergic to filler. Real engineering knowledge behind every line.

THE JOB
Every post makes one point the reader did not have before they read it. The
reader has already seen the headline. They stay for the detail most people
skipped and what it implies. Humour is how you say it, never a substitute for
saying something: a pun is not a point.

HARD RULES
- You are given a LENGTH to hit for this specific post. Hit it. Posts are
  deliberately different lengths, so do not drift back towards a comfortable
  middle. When in doubt, come in under it.
- Paragraphs are 1-2 lines. Never a wall of text. Every line is a whole
  sentence or a deliberate fragment, never half a sentence.
- Use at least two concrete specifics from the story: a number, a product
  name, a version, a technical detail, a direct quote.
- Every number, name and quote comes from the story. Do not invent, round or
  "improve" one.

FACT, INTERPRETATION, OPINION
- A FACT is something the story states. Say it plainly.
- An INTERPRETATION is a conclusion you draw from the facts. Say it as one:
  "may", "probably", "likely", "my read is". Never state it as a fact.
- An OPINION is the author's view. It is welcome, as an opinion.
- Only say one thing caused another when the story says so. "Muse grew
  because it was on iOS and Android" is a guess; "being on both platforms may
  explain part of the gap" is honest.
- Do not invent a narrative to make the post more interesting: no rivalry,
  race, battle, trend, market shift, user reaction or developer sentiment the
  story does not describe. Two products in the same week are not a rivalry.
- Never claim the author did, built, tried, tested, learned or experienced
  anything, unless it is listed under WHAT THE AUTHOR HAS ACTUALLY DONE. "I
  bet" and "I think" are fine: those are opinions, not events.

ONE IDEA
- The post argues one thing: the point you are given. Build it as hook,
  then the evidence, then what it means, then the point. Every line either
  gives evidence, interprets it, or lands the point.
- No empty reactions. "That's creepy", "things are heating up", "that's a
  big deal" add a feeling and no information. If deleting a sentence loses
  nothing, delete it. Say what is actually interesting instead.
- Your conclusion has to depend on this story. "This could change how
  developers build AI apps" is true of every AI story, so it says nothing
  about this one.
- Do not summarise. Each line after the first adds an implication, a
  consequence, a comparison or a detail. A line that retells the article
  should be deleted.
- No sentence that would be equally true under any AI story. "AI is taking
  over", "AI's gonna do what it wants" and "things are changing fast" say
  nothing.
- At most one question in the whole post, and only where the ending asks for
  it. Rhetorical questions are the loudest tell there is.
- The SHAPE you are given decides how the post is built. Follow it exactly.
- The ENDING you are given decides how it stops. Follow that exactly too. If
  you are told not to end with a question, there is no question, and no
  softer version of one either.
- 3 to 5 hashtags, specific to the subject of the story.

NEVER DO THIS
- No "Exciting news", "game-changer", "the future of", "In today's fast-paced".
- No "Here's the thing", "But there's a catch", "This changes everything",
  "Let that sink in", "Good luck with that", "Welcome to the future", "Who
  knew", "Plot twist", "Just a thought", "Only time will tell".
- No rocket, fire or bullseye emojis. At most one emoji, and only if it lands.
- No three-point symmetrical lists. Real people don't think in tidy triples.
- No em-dashes. Use a full stop or a comma.
- No "As an AI", no hedging, no "it's worth noting".
- No analyst-report voice: "this shows", "highlights", "underscores",
  "signals", "a strategic shift", "in a crowded market", "the landscape",
  "it's crucial", "paving the way". Say the thing instead of announcing that
  something shows it.
- Do not open with "TechCrunch reports" or any variation of "according to".
- Do not explain the joke.

VOICE CHECK
Write the way a senior engineer types on their phone between meetings, to a
colleague who is sharp and busy. Not a report, not a press release, not a
teacher. Some sentences are fragments. Contractions everywhere. Confident, a
bit tired, genuinely knows the subject, dry when the facts are funny.
Specific beats clever every time.`;

/**
 * What every prompt about this story shares: the story itself and, when the
 * insight step ran, what the post is supposed to say about it.
 */
function storyBlock(article, insight) {
  const story = `STORY
Title: ${article.title}
URL: ${article.url}
Summary: ${(article.summary ?? '').slice(0, 800)}
Key details: ${(article.body ?? '').slice(0, 2500)}`;

  if (!insight) {
    return `${story}

THE ANGLE TO ARGUE
${article.curation?.angle || 'Find the most arguable point in this story and run with it.'}
${article.curation?.joke ? `\nWHAT IS FUNNY HERE (use it only if it serves the point)\n${article.curation.joke}` : ''}`;
  }

  const comparison = insight.comparison?.supported
    ? `Supported by the story: ${insight.comparison.basis}`
    : 'NOT supported. Do not compare this to other companies or products, and do not describe a race, rivalry or competition.';

  return `${story}

WHAT HAPPENED: ${insight.whatHappened}

EVIDENCE. Facts from the story; you may state these as fact, exactly as written:
${insight.specifics.map((detail) => `- ${detail}`).join('\n') || '- (use the article)'}

WHY IT IS INTERESTING: ${insight.whyInteresting || insight.surprising || ''}
IMPLICATION. Interpretation, so write it as one ("may", "probably"): ${insight.implication || insight.whyItMatters}
WHY THIS AUDIENCE CARES: ${insight.audienceRelevance || insight.whatDevsMiss}
COMPARISONS: ${comparison}

THIS POST ARGUES THAT:
${insight.point || insight.insight}
${insight.tension ? `\nThe best argument against it: ${insight.tension}\n` : ''}
Every line serves that point. If a line would work just as well under a
different story, it does not belong in this post.`;
}

/**
 * What the author has really done, which is the only first-person material
 * the writer may use. Empty by default, and then the writer is told so.
 */
function authorBlock(authorContext) {
  const context = String(authorContext ?? '').trim();

  return context
    ? `\nWHAT THE AUTHOR HAS ACTUALLY DONE. The only first-person experience you may mention:\n${context}\n`
    : '\nThe author has told you nothing about their own experience. Write no first-person experience at all.\n';
}

/**
 * The recent posts, shown to the writer so it stops reaching for the same
 * move. Ten posts that open "So," and end "Good luck with that." read as one
 * template with the nouns swapped, whatever the shapes say.
 */
function recentBlock(recent) {
  if (!recent?.length) return '';

  return `
RECENT POSTS ON THIS PAGE. Do not reuse their first lines, their last lines,
their sentence structures or their jokes:
${recent.map((post) => `- starts "${post.hook}" ... ends "${post.ending}"`).join('\n')}
`;
}

/**
 * Ask for the candidate first lines, and nothing else.
 *
 * Hooks used to come back in the same reply as the body, so the body was
 * written for whichever hook the model had in mind and then stapled under
 * whichever one the scorer picked. Asking for the hooks first means the body
 * can be written around the line that actually runs.
 */
export function buildHookPrompt({ article, insight, shape: shapeName, styles, hookCount, maxChars, recent, notes, authorContext }) {
  const shape = getShape(shapeName);

  // Some shapes own their first line: the quote in a quote-reaction is the hook.
  const guide = shape.overrideHook
    ? `Every candidate follows this rule:\n${shape.overrideHook}\nEach candidate uses a different quote or phrase if the story has more than one. Put "${styles[0] ?? 'blunt-claim'}" as the style of every candidate.`
    : `Write each candidate in one of these opening styles, and use at least three
different styles across the set:
${styles.map((name) => `  ${name}: ${OPENING_STYLES[name].instruction}\n    shape of it (never copy the content): "${OPENING_STYLES[name].example}"`).join('\n')}`;

  return `${storyBlock(article, insight)}
${authorBlock(authorContext)}${recentBlock(recent)}
THE FIRST LINE
It is all most people will read. It sets up THE POINT: it makes a developer
curious about the argument the post is going to make, using a specific from
the story. A line that is interesting but leads somewhere else is wrong.
Under ${maxChars} characters, so it survives LinkedIn's "see more" cut.

Specific curiosity, not clickbait:
- Every candidate contains a concrete detail from the story: a name, a number,
  a technical fact.
- It promises only what the post will actually say.
- It is not a question unless the question is genuinely specific.
- It could not be moved onto a different story and still make sense.

${guide}
${notes?.length ? `\nTHE LAST ATTEMPT WAS REJECTED FOR THIS\n${notes.map((note) => `- ${note}`).join('\n')}\n` : ''}
Write ${hookCount} candidates that are genuinely different from each other,
not one line reworded ${hookCount} times.

Reply as JSON:
{"hooks": [{"text": "the first line", "style": "which opening style it uses"}]}`;
}

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
 * Build the prompt for the rest of the post, once its first line is chosen.
 */
export function buildUserPrompt({
  article,
  insight,
  hook,
  shape: shapeName,
  closerStyle,
  lengthMood,
  maxWords,
  hashtagRules,
  learnings,
  recent,
  notes,
  authorContext,
}) {
  const shape = getShape(shapeName);
  const length = targetWords(shape, lengthMood, maxWords);

  // Shapes that end themselves are not given an ending to follow. A zinger
  // told to add a closing question stops being a zinger.
  const endingGuide = shape.closer === 'rotate'
    ? `\nHOW THIS POST ENDS: ${closerStyle}\n${getCloserStyle(closerStyle).instruction}\n`
    : '';

  return `${storyBlock(article, insight)}
${authorBlock(authorContext)}${recentBlock(recent)}
THE FIRST LINE, already chosen. The reader has just read it:
${hook}

Carry on from it. Do not restate it, do not rephrase it, do not begin by
summarising the headline. The rest of the post proves or explains the point
the first line set up: the evidence, what it means, and the point itself.
It is fine, and often better, to state the point in plain words near the end.

SHAPE FOR THIS POST: ${shapeName}
${shape.instruction}

LENGTH FOR THIS POST: about ${length.target} words including the first line,
${length.max} at the absolute most. Hashtags do not count.
${length.instruction}
${endingGuide}
HASHTAGS
Pick ${hashtagRules.min}-${hashtagRules.max} that describe what this story is
actually about, from this list or equally specific ones: ${hashtagRules.preferred.join(' ')}
A tag must match the subject of the story, not just the fact that it is tech.
If the story is about a company or product people follow, tag it by name
(#Salesforce, #WhatsApp, #Nvidia). Never invent a category tag.
Never use these: ${hashtagRules.banned.join(' ')}
${learnings ? `\nWHAT HAS WORKED BEFORE\n${learnings}` : ''}
${notes?.length ? `
THE LAST ATTEMPT AT THIS POST WAS REJECTED
${notes.map((note) => `- ${note}`).join('\n')}

Fix every one of those. A rewrite that repeats them is worse than the first
attempt, because it means you did not read this.
` : ''}
Reply as JSON, without the first line (it is already written):
{
${fieldSchema(shape, closerStyle)},
  "hashtags": ["#Example"],
  "memeTopText": "top line of the meme image, under 40 chars, all caps works",
  "memeBottomText": "punchline, under 50 chars",
  "memeFormat": "which meme energy this is, a few words"
}`;
}

export default { SYSTEM_PROMPT, OPENING_STYLES, stylesFor, buildHookPrompt, buildUserPrompt };
