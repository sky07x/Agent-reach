/**
 * Is this post actually worth posting?
 *
 * Everything else in this pipeline checks structure: word counts, em-dashes,
 * banned phrases, hashtag relevance, whether two posts share a skeleton. All
 * of it is necessary and none of it can tell whether a post says anything.
 *
 * A post went out that proved the point. It passed every structural check and
 * meant nothing:
 *
 *   "But reasoning has always been something that we've relied on the
 *    frontier model providers for." - Jayesh Govindarajan
 *
 *   Salesforce just gave spreadsheets a reason to take over.
 *   This should be interesting.
 *
 * The story was that Salesforce built a reasoning model called Koa on
 * Nvidia's Nemotron. The post never mentions Koa, Nvidia, or what the thing
 * does. Salesforce is not a spreadsheet company. The closing line says
 * nothing. No regex was ever going to catch that.
 *
 * So there are two gates here. The free one catches the mechanical tells. The
 * paid one - a single cheap call - reads the post against the story and says
 * whether it is worth anyone's time. A post that fails is held back rather
 * than published, because a gate that only logs is not a gate.
 */

import { createLogger } from '../lib/logger.js';
import { GENERIC_HOOKS } from './hook-scorer.js';

const log = createLogger('quality');

/**
 * Closing lines that occupy space without saying anything.
 *
 * These are the sound of a model filling a required field. "This should be
 * interesting" is the one that shipped.
 */
export const FILLER_CLOSERS = [
  'this should be interesting',
  'interesting times',
  'time will tell',
  'we shall see',
  'we will see',
  'only time will tell',
  'stay tuned',
  'watch this space',
  'let that sink in',
  'make of that what you will',
  'draw your own conclusions',
  'the future is here',
  'buckle up',
  'here we go',
  'what a time to be alive',
  // Found in the first twenty-two posts. Every one of them ended a post, and
  // every one would have ended any other post equally well.
  'good luck with that',
  'good luck',
  'just a thought',
  'irony in action',
  'welcome to the future',
  'this is the direction were headed',
  'the future is exciting',
  'things are changing fast',
  'what do you think',
  'thoughts',
  'what could go wrong',
  'and so it begins',
  'you cant make this up',
  'now thats a',
  'just something to keep in mind',
  'something to keep in mind',
  'something to think about',
  'food for thought',
];

/**
 * The analyst-report voice. The first run after the insight step fixed the
 * puns and swapped them for this: "This acquisition shows just how tough the
 * competition is in productivity tools and the challenges startups face in a
 * crowded landscape." Every word accurate, nobody reads past it.
 *
 * One of these can be fine. Two in a post is a report.
 */
export const REPORT_VOICE = [
  /\b(?:this|that|it|which) (?:shows|highlights|underscores|signals|demonstrates|showcases|emphasizes|emphasises|illustrates|reveals|reflects)\b/i,
  /\bhighlight(?:s|ing)? (?:the|a|how)\b/i,
  /\bunderscor(?:es|ing)\b/i,
  /\ba strategic (?:shift|move|bet)\b/i,
  /\bin a crowded (?:market|space|landscape)\b/i,
  /\b(?:the )?(?:ai|tech|competitive|evolving) landscape\b/i,
  /\bit'?s crucial\b/i,
  /\bpav(?:e|es|ing) the way\b/i,
  /\b(?:reshap|redefin)(?:e|es|ing)\b/i,
  /\bsignals a\b/i,
];

/** Ordinary words that are capitalised only because a headline starts with them. */
const SENTENCE_STARTERS = new Set([
  'everyone', 'everybody', 'why', 'how', 'what', 'when', 'where', 'who', 'the', 'a', 'an', 'this', 'these',
  'here', 'meet', 'inside', 'only', 'early', 'former', 'new', 'after', 'with', 'without', 'rival', 'some',
  'most', 'many', 'all', 'as', 'at', 'in', 'on', 'for', 'from', 'our', 'your', 'its', 'it', 'we', 'you',
]);

/** A line that opens by announcing what something shows. */
const NARRATED_LINE = /^(?:this|that|it) (?:just )?(?:shows|highlights|underscores|signals|demonstrates|showcases|emphasizes|emphasises|illustrates|reveals|reflects|suggests|indicates|proves)\b/i;

/** The last line of prose, whichever field the shape put it in. */
function lastProseLine(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#[A-Za-z]/.test(line))
    .at(-1) ?? '';
}

/** A line that stops on a word no sentence ends on was cut in half. */
const DANGLING_END = /\b(a|an|the|of|to|and|or|but|is|are|just|with|for|from|that|like)$/i;

/**
 * Numbers in the post that the story never mentions.
 *
 * The first posts had fake logs stamped 2023 for a story from 2026, and a
 * post can just as easily round 93% to 90%. A wrong number under your own name
 * is worse than no number. Only checked when there is real source text to
 * check against, and only for the numbers that do damage when they are wrong:
 * anything with a unit, anything of three digits or more. Small plain numbers
 * ("2 beats", "0 cyberattacks") and clock times are left alone.
 */
export function inventedNumbers(text, article) {
  const source = `${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`;
  if (!article?.summary && !article?.body) return [];

  const digits = (value) => value.replace(/,/g, '');
  const known = new Set((source.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => Number(digits(value))));

  // "Seven in 10 Americans" is the story's 70%, and a post that says 70% has
  // not invented anything. The first version held a good post for exactly
  // this. Ratios and a few fractions are converted so they count as given.
  for (const [, count, total] of source.matchAll(/\b(\w+) (?:in|out of) (\d+|ten|five|four|three)\b/gi)) {
    const n = wordNumber(count);
    const d = wordNumber(total);
    if (n && d) known.add(Math.round((n / d) * 100));
  }
  for (const [word, percent] of Object.entries({ half: 50, 'a third': 33, 'a quarter': 25, 'two thirds': 67, 'three quarters': 75 })) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(source)) known.add(percent);
  }

  // "93% AI" means "7% human". The complement of a percentage the story gave
  // is arithmetic, not invention.
  for (const [, percent] of source.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    known.add(Number((100 - Number(percent)).toFixed(1)));
  }
  const thisYear = new Date().getFullYear();

  // "400k" in the post is the "400,000" in the story, and "$300M" is its
  // "$300 million". Compare values, not spellings.
  const SCALE = { k: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
  const inStory = (value, unit) => known.has(Number(value))
    || known.has(Number(value) * (SCALE[String(unit ?? '').toLowerCase()] ?? 1));

  const found = [];

  // Clock times are decoration in a fake log, not claims. Strip them first.
  const prose = String(text ?? '').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');

  for (const match of prose.matchAll(/(\$?)(\d[\d,]*(?:\.\d+)?)\s*(%|x\b|k\b|m\b|b\b|million|billion)?/gi)) {
    const [whole, dollar, raw, unit] = match;
    const value = digits(raw);

    if (!dollar && !unit && value.length < 3) continue;

    // The current year, and the one either side, turn up in dates the story
    // implies without spelling out.
    if (/^\d{4}$/.test(value) && Math.abs(Number(value) - thisYear) <= 1 && !dollar && !unit) continue;

    if (!inStory(value, unit)) found.push(whole.trim());
  }

  // Full dates are claims, even in a fake log: "Launch window opens
  // 2027-01-15" for a story that only said "2027". And a prediction for a
  // year that has already passed is nonsense: "a major shift by 2025",
  // written in 2026.
  for (const [date] of prose.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    if (!source.includes(date)) found.push(date);
  }
  for (const [, year] of prose.matchAll(/\b(?:by|in|before|until) (\d{4})\b/gi)) {
    if (Number(year) < thisYear && !source.includes(year)) found.push(`by ${year} (already past)`);
  }

  return [...new Set(found)];
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function wordNumber(word) {
  const value = WORD_NUMBERS[String(word).toLowerCase()] ?? Number(word);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** First few words, flattened, for comparing openings between posts. */
function opening(line, words = 3) {
  return flatten(line).split(' ').slice(0, words).join(' ');
}

/** Strip punctuation so "This should be interesting." matches the list. */
function flatten(line) {
  return String(line ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Short lines that add a feeling and no information.
 *
 * The rule is not "never say creepy". It is: if deleting the sentence deletes
 * nothing the reader learns, it is filler. That is approximated here as a
 * short sentence that is only a reaction, with no number or name in it.
 * "Meta's Muse just dropped on Mac... That's creepy." is the real example.
 */
export const EMPTY_REACTIONS = [
  /^(?:that'?s|this is|it'?s|how|what a|pretty|so|wow,?)\s+(?:so |really |pretty |kinda |genuinely |actually |just )?(?:creepy|wild|insane|crazy|huge|massive|scary|terrifying|impressive|interesting|nuts|bonkers|unsettling|bold|a lot|big|a big deal|a huge deal|something|unreal|amazing|wow)\b/i,
  /^(?:things|it|the race|the competition)(?:'s| is| are)? (?:really |officially )?heating up\b/i,
  /^(?:the future is (?:here|now)|welcome to (?:the future|ai|the age|the era)|this changes everything|let that sink in|what a time)\b/i,
  /^(?:that'?s|this is|it'?s) (?:a )?(?:big|huge|major|massive) (?:change|shift|moment|win|step)\b/i,
  // The sarcastic shrug, which the "aside" ending used to ask for.
  /^(?:funny how|kind of ironic|how ironic|ironic,? (?:isn'?t it|right)|go figure|guess (?:that'?s|this is)|who would have (?:thought|guessed)|you can'?t make this up|classic\b)/i,
];

/**
 * Conclusions that are true of almost every AI story, and so say nothing
 * about this one. "Mobile developers gotta rethink AI integrations now" was
 * the whole second half of a post about a phone chip that can run a
 * 30-billion-parameter model on the device, which has a far more specific
 * implication sitting right there.
 */
export const GENERIC_CONCLUSIONS = [
  /\b(?:could|will|might|may|can) (?:really |truly )?change the game\b/i,
  /\bchang(?:e|es|ing) how (?:developers|devs|we|companies|people|teams|businesses|users) \w+/i,
  /\b(?:need to|needs to|have to|has to|must|should|gotta|got to) rethink\b/i,
  /\bflip(?:s|ped|ping)? the script\b/i,
  /\b(?:we'?ll|you'?ll|expect to) see (?:shifts|changes|more)\b/i,
  /\b(?:is|it'?s) becoming the norm\b/i,
  /\bto new heights\b/i,
  /\b(?:is|are) set to (?:change|transform|redefine|disrupt|revolutioni[sz]e)\b/i,
  /\bshows (?:just )?how important\b/i,
  /\bbecoming the new (?:standard|normal)\b/i,
  /\bgotta rethink\b/i,
  /\brethink(?:ing)? (?:everything|ai integrations?|how we)\b/i,
  /\bheating up\b/i,
  /\breshap(?:e|es|ing) (?:the|how|our)\b/i,
  /\ba (?:whole )?new era\b/i,
  /\bthe stakes are (?:high|higher)\b/i,
  /\bthis is (?:just|only) the beginning\b/i,
  /\b(?:is|are) here to stay\b/i,
  /\b(?:a )?(?:big|huge|major|giant) (?:step|leap) (?:for|in|toward|towards|forward)\b/i,
  /\bthe (?:ai|tech) (?:space|world|industry|race) (?:is|will|just)\b/i,
  /\b(?:will|could) never be the same\b/i,
];

/** Causal language strong enough to need the source's backing. */
const STRONG_CAUSE = /\b(?:links? directly to|(?:is|that'?s|which is) (?:exactly )?why|prov(?:es|ing|ed)(?: that)?|because of|thanks to|driven by|fueled by|fuelled by|led to|is the reason|caused by|as a result of|directly (?:tied|linked) to)\b/i;
const HEDGE = /\b(?:may|might|could|likely|probably|perhaps|possibly|seems|my read|i think|i suspect|part of|partly|in part)\b/i;

/** Rivalry words in the post, and the words that show the source compares. */
const RIVALRY = /\b(?:competition|competing|rivalry|arms race|the race|battle|showdown|outpace[sd]?|head[- ]to[- ]head|heating up|vs\.?|versus)\b/i;
const SOURCE_COMPARES = /\b(?:compet\w*|rival\w*|versus|vs\.?|race|outpac\w*|ahead of|compared|comparison|beat(?:s|ing)?)\b/i;

/**
 * First-person experience the author never had. "I spent a week building a
 * feature. OpenAI just turned it into an add-on" went out under a real name.
 * An opinion ("I bet", "I think") is the author's to state; an event is not
 * something the model can know happened.
 */
export const FIRST_PERSON_EXPERIENCE = [
  /\b(?:I|we) (?:just |once |recently |finally |actually )?(?:spent|built|learned|tried|tested|ran into|used|shipped|wrote|debugged|deployed|worked on|made|found|noticed|started|switched|migrated|lost|broke|fixed|hit|watched|saw)\b/i,
  /\b(?:I|we)(?:'ve| have) (?:been|spent|built|tried|tested|used|seen|shipped|learned)\b/i,
  /\bwhen I\b/i,
  /\bthe hard way\b/i,
  /\bmy (?:team|app|code|codebase|project|startup|company|photos|selfies|side project|last job|manager|boss|clients?|users|feature)\b/i,
  /\bour (?:team|app|codebase|startup|product|users)\b/i,
];

// Curly apostrophes are normalised first: "That’s creepy" and "That's
// creepy" are the same line, and the model uses both.
const sentencesOf = (text) => String(text ?? '')
  .replace(/[’‘]/g, "'")
  .split('\n')
  .filter((line) => line.trim() && !/^#[A-Za-z]/.test(line.trim()))
  .flatMap((line) => line.split(/(?<=[.!?])\s+/))
  .map((sentence) => sentence.trim())
  .filter(Boolean);

const CONTENT_WORD = /[a-z]{4,}/g;

/**
 * "Could this be about any story?", asked of one sentence.
 *
 * A claim - something could, will, should, matters, changes - that contains
 * nothing from the story: no name, no number, and fewer than two of the
 * story's own distinctive words. "Quality benchmarking matters." "We'll see
 * shifts in developer preferences." Those are the real ones. One such line
 * can be the point said in plain words; two means the post's reasoning is
 * not about this story.
 */
const CLAIM = /\b(?:could|will|would|may|might|should|must|expect|matters?|chang(?:e|es|ing)|shift(?:s|ing)?|redefin\w*|lead(?:s)? to|open(?:s)? doors|the norm|is key|is crucial|is everything)\b/i;
const COMMON_WORDS = new Set(['about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'would', 'could', 'should', 'being', 'where', 'other', 'every', 'because', 'through', 'without', 'companies', 'company', 'developers', 'people', 'users', 'really', 'things', 'something', 'anything', 'everything', 'better', 'faster', 'future', 'change', 'changes', 'models', 'intelligence', 'artificial', 'technology', 'industry', 'market']);

function storyIndependent(sentence, source, names) {
  if (!CLAIM.test(sentence) || /\d/.test(sentence)) return false;

  const lower = sentence.toLowerCase();
  if (names.some((name) => lower.includes(name))) return false;

  const shared = (lower.match(/[a-z]{6,}/g) ?? [])
    .filter((word) => !COMMON_WORDS.has(word) && source.includes(word));
  return new Set(shared).size < 2;
}

/**
 * The checks that ask whether a post has a point of its own, as opposed to
 * whether it is tidy. Shared with the insight step, which runs the same
 * generic-conclusion test on the point before a word is written.
 *
 * @returns {string[]} problems
 */
export function pointProblems({ text, article, authorContext = '' }) {
  const problems = [];
  const sentences = sentencesOf(text);
  const source = `${article?.title ?? ''} ${article?.summary ?? ''} ${article?.body ?? ''}`;

  const empty = sentences.filter((sentence) => sentence.split(/\s+/).length <= 10
    && !/\d/.test(sentence)
    && EMPTY_REACTIONS.some((pattern) => pattern.test(sentence)));
  if (empty.length) {
    problems.push(`empty reaction, adds a feeling and no information: ${empty.map((line) => `"${line}"`).join(', ')}. Say what is actually interesting instead`);
  }

  const generic = sentences.filter((sentence) => GENERIC_CONCLUSIONS.some((pattern) => pattern.test(sentence)));
  if (generic.length) {
    problems.push(`generic conclusion that would fit almost any AI story: ${generic.slice(0, 2).map((line) => `"${line}"`).join(', ')}. Say what THIS story specifically implies`);
  }

  // Only when there is a source to check against, and only when the source
  // does not use the same causal language itself.
  if (article?.body || article?.summary) {
    const causal = sentences.filter((sentence) => {
      const match = sentence.match(STRONG_CAUSE);
      return match && !HEDGE.test(sentence) && !source.toLowerCase().includes(match[0].toLowerCase());
    });
    if (causal.length) {
      problems.push(`states a cause as fact that the story does not establish: ${causal.map((line) => `"${line}"`).join(', ')}. Say it may be a factor, or cut it`);
    }

    if (!SOURCE_COMPARES.test(source)) {
      const rivalry = sentences.filter((sentence) => RIVALRY.test(sentence));
      if (rivalry.length) {
        problems.push(`frames a competition the story never describes: ${rivalry.map((line) => `"${line}"`).join(', ')}. Write about this story, not a rivalry`);
      }
    }
  }

  // Only with real source text: without it, everything looks story-free.
  if (article?.body) {
    const lowerSource = source.toLowerCase();
    const names = [...new Set((source.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? []).map((name) => name.toLowerCase()))]
      .filter((name) => !['the', 'this', 'that', 'and', 'but', 'for', 'with', 'its', 'new'].includes(name));
    const floating = sentences.filter((sentence) => storyIndependent(sentence, lowerSource, names));

    if (floating.length >= 2) {
      problems.push(`these lines would fit under any AI story, nothing in them depends on this one: ${floating.map((line) => `"${line}"`).join(', ')}. Tie the reasoning to the story's facts`);
    }
  }

  // Allowed only when it matches something the author has actually told us.
  const known = new Set(String(authorContext).toLowerCase().match(CONTENT_WORD) ?? []);
  const invented = sentences.filter((sentence) => FIRST_PERSON_EXPERIENCE.some((pattern) => pattern.test(sentence))
    && (sentence.toLowerCase().match(CONTENT_WORD) ?? []).filter((word) => known.has(word)).length < 3);
  if (invented.length) {
    problems.push(`claims a personal experience the author never had: ${invented.map((line) => `"${line}"`).join(', ')}. Never invent what the author did`);
  }

  return problems;
}

/**
 * The free checks. Mechanical, instant, and they catch the obvious failures
 * before we spend anything on the model.
 *
 * @returns {string[]} problems, empty if it passes
 */
export function structuralProblems({ article, draft, recent = [], authorContext = '' }) {
  const problems = [];
  const text = String(draft.text ?? '');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const isFiller = (line) => {
    const flat = flatten(line);
    return flat && FILLER_CLOSERS.some((filler) => flat === filler || flat.startsWith(`${filler} `));
  };

  // The closer field, and the last line however the shape ended. A rant or a
  // zinger ends on a field that is not called "closer", and "Good luck
  // keeping anything private." slipped through that gap.
  const ending = lastProseLine(text);
  const endingFlat = flatten(ending);
  const closerFlat = flatten(draft.parts?.closer);
  if (closerFlat && isFiller(draft.parts.closer)) {
    problems.push(`the closing line "${draft.parts.closer}" says nothing`);
  } else if (ending && lines.length > 1) {
    // The line, or its last sentence: "Next step? Good luck with that." is
    // a filler ending sharing a line with something else.
    const lastSentence = ending.split(/(?<=[.!?])\s+/).at(-1);
    if (isFiller(ending) || isFiller(lastSentence)) problems.push(`the closing line "${lastSentence}" says nothing`);
  }

  const hookLine = String(draft.hook ?? lines[0] ?? '');
  const generic = GENERIC_HOOKS.filter((rule) => rule.pattern.test(hookLine.trim()));
  if (generic.length) {
    problems.push(`the hook is generic (${generic.map((rule) => rule.name).join(', ')}): it would fit on top of any story`);
  }

  const invented = inventedNumbers(text, article);
  if (invented.length) {
    problems.push(`these numbers are not in the story: ${invented.join(', ')}. Use the story's own numbers or none`);
  }

  // Hashtags and log blocks aside, a line ending on "a" or "the" was split
  // mid-sentence. "Microsoft's new AI code of conduct is just a" shipped.
  const cut = lines.find((line) => !line.startsWith('#') && DANGLING_END.test(line.replace(/[\s"'”’]+$/, '')));
  if (cut) problems.push(`a line is cut off mid-sentence: "${cut}"`);

  const report = REPORT_VOICE.filter((pattern) => pattern.test(text)).map((pattern) => text.match(pattern)[0]);
  if (report.length >= 2) {
    problems.push(`reads like an analyst report (${report.map((phrase) => `"${phrase}"`).join(', ')}): say the thing, not that something shows it`);
  }

  // Once is enough when it opens a line. "This highlights Microsoft's
  // commitment to..." came back as the reaction to almost every quote: it
  // narrates the point instead of making it.
  const narrated = lines.find((line) => NARRATED_LINE.test(line));
  if (narrated && report.length < 2) {
    problems.push(`"${narrated.split(/\s+/).slice(0, 3).join(' ')}..." narrates the point instead of making it: say what it means`);
  }

  // One question is an ending. Two is a post asking instead of saying.
  const questions = (text.match(/\?(?=\s|$|["'”’])/g) ?? []).length;
  if (questions > 1) problems.push(`${questions} questions in one post: say it instead of asking it`);

  // Ten posts that open the same way are one post. Compared against the
  // recent posts rather than a list of phrases, because the model's habits
  // move and a list is always one habit behind.
  if (recent.length) {
    const hookStart = opening(hookLine);
    const sameStart = recent.find((post) => post.hook && opening(post.hook) === hookStart && hookStart.split(' ').length >= 3);
    if (sameStart) problems.push(`opens the same way as a recent post ("${sameStart.hook}")`);

    const sameEnd = recent.find((post) => post.ending && flatten(post.ending) === endingFlat && endingFlat.length > 0);
    if (sameEnd) problems.push(`ends the same way as a recent post ("${sameEnd.ending}")`);
  }

  // A quote that opens on a conjunction was cut out of the middle of a
  // sentence and reads as one.
  if (/^["“](but|and|so|which|that|because)\b/i.test(text)) {
    problems.push('the opening quote is a fragment lifted from mid-sentence');
  }

  // The hook is written blind to the body, so the body sometimes restates it.
  if (lines.length > 1) {
    const hook = flatten(lines[0]);
    const echo = lines.slice(1).some((line) => {
      const body = flatten(line);
      return body.length > 20 && (hook.includes(body) || body.includes(hook));
    });

    if (echo) problems.push('the post restates its own hook');
  }

  // Nothing from the story in the post at all is the clearest possible sign
  // that the post is about nothing. The summary counts as the story too: a
  // post about Superpose was held for not naming TikTok, because the title
  // was "Former TikTok execs built an app" and never said "Superpose".
  //
  // A first word that is an ordinary English word is skipped: it is
  // capitalised because it starts a sentence, not because it is a name.
  // "Everyone can find a reason to dislike data center construction" offered
  // only "Everyone", and a post about the story was held for not saying it.
  // A first word that is a name ("OpenAI, Anthropic and Google...") stays.
  // The summary is an ordinary sentence and the title carries the names, so
  // the summary's first word is always skipped.
  const withoutFirstWord = (value, always = false) => String(value ?? '').trim()
    .replace(/^(\S+)\s*/, (match, word) => (always || SENTENCE_STARTERS.has(word.toLowerCase().replace(/[^a-z]/g, '')) ? '' : match));
  const subjects = `${withoutFirstWord(article?.title)} ${withoutFirstWord(article?.summary, true)}`.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? [];
  const lowered = text.toLowerCase();

  if (subjects.length && !subjects.some((word) => lowered.includes(word.toLowerCase()))) {
    problems.push('the post does not mention anything from the story');
  }

  problems.push(...pointProblems({ text, article, authorContext }));

  return problems;
}

/**
 * What the judge scores, and which of those can sink a post on their own.
 *
 * The first judge asked two questions - can the reader tell what happened,
 * and is there a joke - and across the first twenty-two real posts it held
 * eleven, every one of them for "lacks a clear joke". It passed a fake log
 * dated three years before the story happened, a Salesforce post that never
 * said what Salesforce built, and a grocery-app post written as fake terminal
 * output. A wry tone and a vague subject was enough to clear it.
 *
 * So it now scores the things that actually decide whether a developer
 * stops scrolling, each on its own, and it has to say which one failed.
 */
export const JUDGE_DIMENSIONS = {
  hook: 'Does the first line give a developer a specific reason to read the second, and does it lead into the point? Generic, clickbait or a pun scores low.',
  specificity: 'Real numbers, names and technical details from the story, carried through. Vague claims that could apply to any story score low.',
  insight: 'Does the post add something beyond the source: an implication, a consequence, a detail most people missed? A summary of the announcement is a 2 at best, however well written.',
  accuracy: 'Does everything in it match the story? Invented numbers, misdescribed companies, made-up personal anecdotes and fake quotes score 1.',
  voice: 'Does it read like a person who knows the subject? Stock phrases, rhetorical questions, forced puns and "AI is taking over" lines score low.',
  coherence: 'Do the first line, the body and the ending make one point together, about this story?',
  // The second round, added when posts became specific but still bland:
  // correct facts followed by a conclusion that could end any AI post.
  point: 'Does the post have ONE clear idea, one you could state as "this post argues that ..."? A list of facts with no argument scores 1-2.',
  implication: 'Does it explain why the facts matter: what changes, for whom? "Could change the game" is not an implication.',
  informationValue: 'Does the reader come away knowing something they would not get from the headline? Accurate but unsurprising scores 2.',
  nonGeneric: 'Does the reasoning depend on this story? If you swapped the company and numbers for another AI story and the post still worked, score 1-2. Story-specific nouns do not count, story-specific reasoning does.',
  evidence: 'Are facts from the source kept apart from interpretation? Stating a guess as fact, inventing a cause, a trend, a rivalry or a user reaction the story does not support scores 1-2.',
};

/**
 * The dimensions that decide whether a post has a reason to exist. They get
 * their own floor, so the bar for "has a point" can be raised without also
 * raising it for voice or hook.
 */
export const POINT_DIMENSIONS = ['point', 'informationValue', 'nonGeneric'];

/** Any one of these below the floor holds the post, whatever the average. */
export const CRITICAL_DIMENSIONS = [
  'hook', 'specificity', 'insight', 'accuracy', 'point', 'informationValue', 'nonGeneric', 'evidence',
];

const JUDGE_PROMPT = `You are the editor of a page that posts short takes on
tech news for developers, deciding whether a post is worth publishing. You
are hard to please and you have seen every AI-written LinkedIn post there is.

You get the story the post is based on, the point it was meant to make, and
the post.

The page reacts to the news with a point of view. It is not a news desk, so
do not mark a post down for leaving out parts of the announcement it does not
need. It is also not a pun page: a joke with nothing behind it is not a post.

A post can be completely accurate and specific and still not be worth
publishing. "Accurate but boring", "specific but no meaningful takeaway" and
"the facts are right but the conclusion is generic" are all reasons to reject.

Score each of these 1 to 5:
{{dimensions}}

  1 fails outright, 2 weak, 3 acceptable, 4 good, 5 excellent.

Most posts you see are 3s. A 4 is a post you would actually stop scrolling
for. Do not hand out 4s to posts that are merely correct.

Calibration. A two-line post that lands a specific point is a 4 or 5 on
everything. Do not mark a post down for being short, for being oblique, or
for using a format like a fake log or a list of beats instead of prose. Do
not mark it down for having an opinion, as long as the opinion is presented
as one. Do mark it down for naming a subject and then saying nothing about
it, for lines that could be deleted with nothing lost, and for lines that
would fit under any other story.

Then answer these directly. They are easier to answer honestly than a score.
  thesis                 finish the sentence "This post argues that ..." in
                         a few words. If you cannot, leave it "".
  survivesNameSwap       true if the post would still work with a different
                         company and different numbers swapped in.
  genericHook            true if the first line could sit on top of a post
                         about a different company's news.
  hookMatchesPoint       true if the first line sets up the thesis.
  multipleIdeas          true if the post makes several unrelated points
                         instead of one.
  fillerLines            lines that could be deleted with nothing lost.
  emptyReactions         lines that add a feeling but no information
                         ("That's creepy", "Things are heating up").
  unsupportedClaims      lines that state an interpretation, a cause, a
                         trend or a user reaction as fact when the story does
                         not establish it.
  manufacturedNarrative  lines that invent a rivalry, race, battle or
                         comparison the story does not make or support.
Quote lines exactly as they appear in the post.

Finally explain the decision so the writer can fix it. Name the weakest part
and say exactly what is wrong with it, quoting the line. "Rejected because the
hook is generic and the body only summarises the announcement" is useful.
"Could be sharper" is not.

Reply as JSON:
{"scores": {"hook": n, "specificity": n, "insight": n, "accuracy": n, "voice": n, "coherence": n,
            "point": n, "implication": n, "informationValue": n, "nonGeneric": n, "evidence": n},
 "thesis": "...",
 "survivesNameSwap": true or false,
 "genericHook": true or false,
 "hookMatchesPoint": true or false,
 "multipleIdeas": true or false,
 "fillerLines": [], "emptyReactions": [], "unsupportedClaims": [], "manufacturedNarrative": [],
 "summaryOnly": true if the post only restates what the story says,
 "verdict": "one or two sentences: the decision and the main reason",
 "problems": ["specific and actionable, quoting the line, at most four"]}`;

/** Same line, whichever quote marks the model used when it quoted it. */
const plain = (value) => String(value ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * Read the post against its story and score it.
 *
 * One call, on the cheap model. At three posts a week this is a fraction of a
 * cent a month, which is a very low price for not publishing nonsense.
 */
export async function judgeDraft({ article, draft, llm, insight, model }) {
  const result = await llm.chatJson({
    label: 'judge-post',
    model: model || undefined,
    temperature: 0.2,
    maxTokens: 800,
    system: JUDGE_PROMPT.replace('{{dimensions}}', Object.entries(JUDGE_DIMENSIONS)
      .map(([name, question]) => `  ${name}: ${question}`)
      .join('\n')),
    user: `THE STORY
Title: ${article.title}
Summary: ${(article.summary ?? '').slice(0, 600)}
Article: ${(article.body ?? '').slice(0, 2500) || '(not available)'}

THE POINT IT WAS MEANT TO MAKE
${insight?.point || insight?.insight || article.curation?.angle || '(none given)'}

THE POST
Format it was written to: ${draft.shape ?? "free"}

${draft.text}`,
  });

  const scores = {};
  for (const name of Object.keys(JUDGE_DIMENSIONS)) {
    const value = Number(result?.scores?.[name]);
    if (Number.isFinite(value) && value > 0) scores[name] = Math.min(5, Math.max(1, value));
  }

  const values = Object.values(scores);

  // An older-style reply with one overall score is still understood, so a
  // model that ignores the rubric does not quietly score zero.
  const score = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
    : Number(result?.score) || 0;

  // Only lines that are really in the post count, so a judge quoting
  // something it imagined cannot hold a post.
  const post = plain(draft.text);
  const quoted = (key) => (Array.isArray(result?.[key]) ? result[key] : [])
    .map((line) => String(line).trim())
    .filter((line) => line && post.includes(plain(line)));

  return {
    score,
    scores,
    thesis: typeof result?.thesis === 'string' ? result.thesis.trim() : undefined,
    survivesNameSwap: result?.survivesNameSwap === true,
    genericHook: result?.genericHook === true,
    hookMatchesPoint: result?.hookMatchesPoint === false ? false : undefined,
    multipleIdeas: result?.multipleIdeas === true,
    fillerLines: quoted('fillerLines'),
    emptyReactions: quoted('emptyReactions'),
    unsupportedClaims: quoted('unsupportedClaims'),
    manufacturedNarrative: quoted('manufacturedNarrative'),
    summaryOnly: Boolean(result?.summaryOnly),
    verdict: String(result?.verdict ?? '').trim(),
    problems: (result?.problems ?? []).map((problem) => String(problem).trim()).filter(Boolean),
  };
}

/**
 * The one-line diagnosis for a bland post, in the words a reviewer would use.
 * Only for the posts the old judge let through: correct and specific, and
 * still with nothing to say.
 */
export function blandDiagnosis({ scores = {} }, floor) {
  const low = (name) => scores[name] !== undefined && scores[name] < floor;
  const solid = (scores.accuracy ?? 0) >= floor && (scores.specificity ?? 0) >= floor;

  if (!solid) return null;
  if (low('nonGeneric')) return 'the facts are correct, but the conclusion is generic';
  if (low('point')) return 'specific, but it has no meaningful takeaway';
  if (low('informationValue') || low('implication')) return 'accurate but boring: the reader learns nothing the headline did not say';
  return null;
}

/**
 * Pass or hold, from a judgement.
 *
 * The average alone let weak posts through on the strength of a tidy voice:
 * a post can read perfectly well and still say nothing. So each critical
 * dimension has to clear the floor on its own, and each of the yes-or-no
 * questions can hold a post by itself.
 *
 * @returns {string[]} why it is held, empty if it passes
 */
export function judgementFailures(judged, { minScore, minDimension = minScore, minPointDimension = minDimension }) {
  const failures = [];

  const bland = blandDiagnosis(judged, minPointDimension);
  if (bland) failures.push(bland);

  if (judged.score < minScore) failures.push(`overall ${judged.score}/5 is below ${minScore}`);

  for (const name of CRITICAL_DIMENSIONS) {
    const value = judged.scores?.[name];
    const floor = POINT_DIMENSIONS.includes(name) ? minPointDimension : minDimension;
    if (value !== undefined && value < floor) failures.push(`${name} ${value}/5: ${JUDGE_DIMENSIONS[name]}`);
  }

  // The "so what?" test. A post that cannot be summed up in one sentence has
  // no point; one whose argument would fit any AI story has none of its own.
  if (judged.thesis === '') failures.push('there is no single idea to sum the post up with: "this post argues that..." cannot be finished');
  if (judged.thesis && GENERIC_CONCLUSIONS.some((pattern) => pattern.test(judged.thesis))) {
    failures.push(`the post's argument is generic: "${judged.thesis}"`);
  }
  if (judged.survivesNameSwap) failures.push('the post still works with a different company swapped in: its reasoning does not depend on this story');
  if (judged.multipleIdeas) failures.push('several unrelated ideas instead of one: pick the point and cut the rest');
  if (judged.hookMatchesPoint === false) failures.push('the first line does not set up the point the body makes');

  if (judged.summaryOnly) failures.push('the post only summarises the story and adds nothing to it');
  if (judged.genericHook) failures.push('the first line would fit on top of a different story: tie it to a specific in this one');

  // One weak line is an edit. Two means the post is padding itself out.
  if ((judged.fillerLines?.length ?? 0) >= 2) {
    failures.push(`these lines add nothing and could sit under any story: ${judged.fillerLines.map((line) => `"${line}"`).join(', ')}`);
  }

  // These are not matters of taste: one is enough.
  if (judged.emptyReactions?.length) {
    failures.push(`empty reaction, a feeling with no information: ${judged.emptyReactions.map((line) => `"${line}"`).join(', ')}`);
  }
  if (judged.unsupportedClaims?.length) {
    failures.push(`states interpretation as fact: ${judged.unsupportedClaims.map((line) => `"${line}"`).join(', ')}. Mark it as a read ("may", "probably") or cut it`);
  }
  if (judged.manufacturedNarrative?.length) {
    failures.push(`invents a narrative the story does not support: ${judged.manufacturedNarrative.map((line) => `"${line}"`).join(', ')}`);
  }

  return failures;
}

/**
 * Both gates together.
 *
 * @returns {{ok: boolean, score: number|null, problems: string[], verdict: string}}
 */
export async function assessDraft({ article, draft, llm, settings, insight, recent }) {
  const problems = structuralProblems({ article, draft, recent, authorContext: settings.authorContext });

  // A structural failure is certain, so do not pay to confirm it.
  if (problems.length) {
    log.warn('Draft failed the free checks', { problems });
    return { ok: false, score: null, problems, verdict: 'failed the structural checks' };
  }

  if (!settings.useLlmJudge) return { ok: true, score: null, problems: [], verdict: 'judge disabled' };

  try {
    const judged = await judgeDraft({ article, draft, llm, insight, model: settings.model });
    const failures = judgementFailures(judged, settings);
    const ok = failures.length === 0;

    log[ok ? 'info' : 'warn']('Draft judged', {
      score: judged.score,
      scores: judged.scores,
      minimum: settings.minScore,
      verdict: judged.verdict,
      failures,
    });

    // The rewrite is told the judge's own words first, then which bars the
    // post missed, so it knows what to fix and not only that it failed.
    return {
      ok,
      ...judged,
      failures,
      problems: ok ? judged.problems : [...judged.problems, ...failures.filter((failure) => !judged.problems.includes(failure))],
    };
  } catch (error) {
    // A judge that cannot be reached must not block the run. Say so loudly
    // rather than silently waving everything through.
    log.warn('Judge unavailable, letting the draft through unjudged', { error: error.message });
    return { ok: true, score: null, problems: [], verdict: 'judge unavailable' };
  }
}

export default {
  assessDraft,
  judgeDraft,
  judgementFailures,
  blandDiagnosis,
  pointProblems,
  GENERIC_CONCLUSIONS,
  EMPTY_REACTIONS,
  structuralProblems,
  inventedNumbers,
  FILLER_CLOSERS,
  JUDGE_DIMENSIONS,
};
