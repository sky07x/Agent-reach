/**
 * The actual prompts that give the agent its voice.
 *
 * Section 4 of the spec is encoded here as concrete rules rather than vibes,
 * because "be funny and technical" produces exactly the generic output we are
 * trying to avoid.
 */

import { getShape, getCloserStyle, fieldsFor, targetWords } from './shapes.js';
import { overusedSignatures } from './quality.js';

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
  // A specific that does not add up yet, stated plainly. The answer is the
  // body, which is what makes line two worth reading. Not a tease: the line
  // is itself a fact.
  'curiosity-gap': {
    instruction: `Open with the one specific detail from the story that does not
add up at first glance, stated plainly as a fact. The reader should need the
next line to make sense of it. Do not tease, do not ask, do not say "here's
why": the detail itself does the work.`,
    example: 'The agent passed every eval. It still deleted the staging database on day two.',
  },
  // The headline invites one conclusion; the post exists because a detail
  // points to another. Named directly, never via "most people think".
  'contrarian-read': {
    instruction: `Open with your claim about what this story really is, using a
specific detail, stated flat. Say what it IS; do not use the "isn't X, it's
Y" or "less X than Y" construction. Never "most people think", "many
believe" or "we all assume".`,
    example: "The Postgres outage wasn't a Postgres problem. It was a retry policy with no jitter.",
  },
  // What this costs the reader, in their own system or job, tied to the story.
  stakes: {
    instruction: `Open with what this story means for the reader's own system,
bill, on-call or job, tied to one specific from it. Second person is fine.`,
    example: "If your RAG pipeline re-embeds on every deploy, that 40% price cut just paid for a sprint.",
  },
  // The first line of a story. Third person, inside the moment, concrete.
  scene: {
    instruction: `Open inside the actual event, like the first line of a short
story: who, where, the concrete moment. Third person, only what the story
says happened. No "imagine", no "picture this".`,
    example: 'Three weeks before launch, the team found their model had memorised the test set.',
  },
};

/** The opening styles a story can carry. Most fit anything. */
export function stylesFor(names, article) {
  return names.filter((name) => OPENING_STYLES[name] && (!OPENING_STYLES[name].fits || OPENING_STYLES[name].fits(article)));
}

/**
 * The rules that apply to every post, whatever the shape or opening style.
 *
 * The first voice was "Fireship": dry, sarcastic, reacting to the news. It
 * kept every rule and still read like a bot, because sarcasm with nothing
 * under it is the easiest voice there is to fake. Every post was a shrug at
 * a headline. Nobody saves a shrug, and nobody follows one.
 *
 * The page belongs to an engineer who builds with AI, and the people worth
 * following on LinkedIn in that niche do one thing well: they read past the
 * headline and come back with the part that is actually useful. How it
 * works, what it costs, what breaks, what they would do about it. Humour
 * stays, when the facts are funny. It is no longer the job.
 */
export const SYSTEM_PROMPT = `You write LinkedIn posts for a software engineer
who builds with AI and ML. Their followers are engineers, ML people, founders
and technical leads. They follow this person because every post teaches them
something real in under a minute, in a voice that is obviously one specific
human's.

THE JOB
Every post makes one point the reader did not have before. The reader has
already seen the headline. They stay for the detail most people skipped, how
the thing actually works, and what it means for the systems they build.
Something they can use, repeat to a colleague, or push back on.

WHAT MAKES PEOPLE SAVE, SHARE AND REPLY (without bait)
- Saves come from something useful to keep: a mechanism explained plainly, a
  number worth remembering, a check they should run.
- Shares come from a clear line people want to be seen agreeing with.
- Replies come from a specific claim an informed person could argue with, or
  a question about their own setup. Never from "Agree?" or "Thoughts?".
- Curiosity comes from a specific that does not add up yet. Not from teasing:
  never hold back the point to force a click on "see more".

HARD RULES
- You are given a LENGTH to hit for this specific post. Hit it. Posts are
  deliberately different lengths. When in doubt, come in under it.
- Short paragraphs, one or two lines. White space is how people read on a
  phone. Every line is a whole sentence or a deliberate fragment.
- Use at least two concrete specifics from the story: a number, a product
  name, a version, a technical detail, a direct quote.
- Every number, name and quote comes from the story. Do not invent, round or
  "improve" one.

FACT, INTERPRETATION, OPINION
- A FACT is something the story states. Say it plainly.
- An INTERPRETATION is a conclusion you draw. Say it as one: "probably", "my
  read is", "I suspect". Never state it as a fact.
- An OPINION is welcome, stated as the author's: "I think", "I'd", "my bet",
  "honestly". An opinion with a reason is what makes a post sound human.
- Only say one thing caused another when the story says so.
- Do not invent a narrative: no rivalry, race, trend, market shift, user
  reaction or developer sentiment the story does not describe.
- Never claim the author did, built, tried, tested, learned or experienced
  anything, unless it is listed under WHAT THE AUTHOR HAS ACTUALLY DONE.
  Opinions and hypotheticals are fine ("if I were running this, I'd..."),
  invented events are not.

ONE IDEA
- The post argues one thing: the point you are given. Every line either gives
  evidence, explains it, or lands the point.
- No empty reactions. "That's wild", "things are heating up", "that's a big
  deal" add a feeling and no information. Say what is interesting instead.
- Your conclusion has to depend on this story. "This could change how
  developers build AI apps" is true of every AI story, so it says nothing.
- Do not summarise the article. Each line adds an implication, a mechanism, a
  consequence or a detail.
- At most one question in the whole post, and only where the ending asks for
  it. No rhetorical questions.
- The SHAPE you are given decides how the post is built, and the ENDING how
  it stops. Follow both exactly.

SOUNDING LIKE A PERSON
Write the way a sharp senior engineer talks to a colleague they respect:
plain words, concrete nouns, a real opinion, a bit of dry humour when the
facts are funny. Specifically:
- Vary the rhythm. A long sentence, then a four-word one. Never three
  sentences in a row of the same length or the same structure.
- Plain verbs. "uses", not "leverages". "shows", not "underscores". "big",
  not "transformative".
- Contractions everywhere. A fragment now and then.
- Name things the way engineers do: the model name, the API, the config flag,
  the failure mode. Precision is what makes it sound like someone who knows.
- Admit uncertainty the way people do: "I might be wrong, but", "not sure
  this holds at scale". Once, not as a hedge on every line.
- No tidy moral at the end, no summary of what you just said, no pep talk.

THE SCAFFOLDING A MODEL REACHES FOR. Each one is an instant tell:
- "The key detail is", "The real change is", "The point here is", "What
  matters here is", "That changes the picture", "The lesson is". Delete the
  announcement and just say the thing.
- "It isn't X. It's Y", "less X than Y", "not X, but Y", "X is really Y". At
  most once in a post, and never in the first line: say what it IS.
- Stacking the same move: a hook that flips, then a body that flips again.
- "If you build...", "If your roadmap assumes...", "My read is", "for
  builders". Fine once in a while, tiring in every post.

NOT EVERY POST NEEDS A LESSON FOR BUILDERS
Sometimes the point is what a company is really doing, what a number really
means, or just that something is funny or strange. End on that. Only address
the reader as a builder when the story genuinely changes what they would do.

VARY THE SENTENCES
Start sentences in different ways: a name, a number, a verb, a short
fragment, a quote. Never open two paragraphs the same way.

NEVER DO THIS
- No "Exciting news", "game-changer", "the future of", "In today's fast-paced
  world", "in the ever-evolving", "unlock", "unleash", "supercharge",
  "harness", "elevate", "empower", "delve", "robust", "seamless", "landscape".
- No "Here's the thing", "Here's why", "Let's dive in", "Let that sink in",
  "This changes everything", "But there's a catch", "Plot twist", "Welcome to
  the future", "Only time will tell", "Buckle up", "Ever wondered".
- No "Agree?", "Thoughts?", "What do you think?", "Follow for more", "Comment
  below", "Repost if", "Save this post".
- No motivational or hustle language. No "the lesson here is" framing.
- No emoji, unless one genuinely lands, and never 🚀 🔥 💡 🎯 ✨ 👇 🧵.
- No three-item lists. Real people don't think in tidy triples.
- No em-dashes. Use a full stop or a comma.
- No analyst-report voice: "this shows", "highlights", "underscores",
  "signals", "a strategic shift", "in a crowded market", "it's crucial",
  "paving the way".
- Do not open with "TechCrunch reports" or any variation of "according to".
- Do not explain the joke.

Specific beats clever, every time. If a sentence could appear in anyone's
post about any AI story, delete it.`;

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
${insight.mechanism?.length ? `\nMECHANISM. How it works, as far as the article says. Explain it; add nothing to it:\n${insight.mechanism.map((step) => `- ${step}`).join('\n')}\n` : ''}${insight.numbers?.length ? `\nNUMBERS. Exact figures from the story, the only ones you may use:\n${insight.numbers.map((item) => `- ${item.display}: ${item.label}`).join('\n')}\n` : ''}${insight.commonRead ? `\nTHE OBVIOUS READ of the headline, which the article complicates: ${insight.commonRead}\n` : ''}${insight.builderAngle ? `\nFOR PEOPLE WHO BUILD, only if this post is about what to do differently: ${insight.builderAngle}\n` : ''}
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

  const worn = overusedSignatures(recent);

  return `
RECENT POSTS ON THIS PAGE. Do not reuse their first lines, their last lines,
their sentence structures or their jokes:
${recent.map((post) => `- starts "${post.hook}" ... ends "${post.ending}"`).join('\n')}
${worn.length ? `\nWORN OUT, recent posts have used these too often. Do not use them in this post at all:\n${worn.map((name) => `- ${name}`).join('\n')}\n` : ''}`;
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
