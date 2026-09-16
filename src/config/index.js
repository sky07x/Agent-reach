/**
 * Every knob this agent has, in one place.
 *
 * Section 8 of the spec: no hardcoded feed URLs, schedule times or hashtag
 * rules anywhere else in the codebase. If you want to change behaviour, you
 * change it here or in .env.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

/**
 * Where we are allowed to write files.
 *
 * On Lambda the code folder (/var/task) is read-only, and /tmp is the only
 * writable place. It is also wiped between runs, which is fine: the real
 * state lives in DynamoDB, and these are just images and cached feeds.
 */
const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const writableRoot = onLambda ? '/tmp' : projectRoot;

/** Read a boolean from env without the usual "false" === true surprise. */
function readBool(value, fallback) {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  agentName: 'linkedin-tech-meme-agent',

  paths: {
    root: projectRoot,
    // Written at runtime, so these follow writableRoot.
    data: path.join(writableRoot, 'data'),
    cache: path.join(writableRoot, 'data', 'cache'),
    output: path.join(writableRoot, 'data', 'out'),
    // Read-only, so this always stays next to the code.
    memeTemplates: path.join(projectRoot, 'assets', 'meme-templates'),
    fonts: path.join(projectRoot, 'assets', 'fonts'),
  },

  server: {
    port: readNumber(process.env.PORT, 3001),
    // The admin API can trigger real posts, so it is never open by default.
    adminApiKey: process.env.ADMIN_API_KEY || '',
  },

  /* --- Stage 1: where stories come from ---------------------------------- */
  scraper: {
    // RSS first: cheap, structured, and TechCrunch publishes it openly.
    feeds: [
      { name: 'ai', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
      { name: 'apps', url: 'https://techcrunch.com/category/apps/feed/' },
      { name: 'security', url: 'https://techcrunch.com/category/security/feed/' },
      { name: 'startups', url: 'https://techcrunch.com/category/startups/feed/' },
    ],
    userAgent: 'linkedin-tech-meme-agent/1.0 (+personal content agent; contact via repo owner)',
    // TechCrunch's robots.txt asks for 1 request per second. Be a good guest.
    minGapMs: 1200,
    // Ignore anything older than this. Stale news is bad meme material.
    maxArticleAgeDays: 7,
    // Cache raw feed responses so re-runs during development cost nothing.
    cacheTtlMinutes: 30,
    // Only pull the full article body when we actually need it (curation on).
    fetchFullBody: true,
  },

  /* --- Stage 2: what counts as AI/CS ------------------------------------- */
  classifier: {
    // Strong signals. One of these in the title is basically a yes.
    strongKeywords: [
      'ai', 'artificial intelligence', 'machine learning', 'llm', 'large language model',
      'neural network', 'deep learning', 'transformer', 'gpt', 'chatgpt', 'openai',
      'anthropic', 'claude', 'gemini', 'llama', 'mistral', 'hugging face',
      'inference', 'fine-tune', 'fine-tuning', 'rag', 'embedding', 'diffusion model',
      'agentic', 'ai agent', 'copilot', 'prompt engineering', 'multimodal',
    ],
    // Computer-science adjacent. Real, but on their own they are weaker.
    supportingKeywords: [
      'developer', 'developers', 'open source', 'github', 'api', 'sdk', 'compiler',
      'kubernetes', 'database', 'algorithm', 'quantum computing', 'cybersecurity',
      'encryption', 'programming', 'software engineering', 'devtools', 'cloud',
      'gpu', 'chip', 'semiconductor', 'data center', 'benchmark', 'latency',
    ],
    // Hard no. These kill the score even if a keyword matched.
    excludeKeywords: [
      'ipo', 'e-bike', 'scooter', 'ev charging', 'dating app', 'crypto price',
      'real estate', 'streaming show', 'smartphone review', 'earbuds', 'smartwatch',
    ],
    // Scores inside this band are genuinely unclear, so we spend an LLM call.
    // Outside it the heuristics decide for free. This is the main cost gate.
    ambiguousRange: { min: 0.35, max: 0.65 },
    // Below this we drop the article.
    minScoreToKeep: 0.5,
  },

  /* --- Stage 3: what is worth posting ------------------------------------ */
  curator: {
    // How many classified stories to hand the LLM for ranking.
    shortlistSize: 8,
    // Don't post about the same thing twice in a row.
    topicCooldownPosts: 10,

    // What makes a story good for THIS page.
    //
    // The page is meant to be funny. So we reward stories a developer can
    // laugh at, and push down heavy ones. An article about human extinction
    // is important, but there is no joke in it, and a forced joke about it
    // reads badly.
    memeSignals: {
      funny: 0.35,        // something broke, or is absurd, or is ironic
      hasNumber: 0.15,    // a real number makes a post concrete
      novelty: 0.2,       // new tool or release devs will care about
      bigName: 0.15,      // a company everyone knows
      hasQuote: 0.1,
      controversy: 0.1,   // was 0.25, and it kept picking doom stories
      positive: 0.25,     // counterweight: funnyWords is nearly all bad news
    },

    // How hard a repeated story frame is punished. Frames are tracked in
    // curator/frames.js; this is the emotional shape of a story, not the
    // companies in it, and it repeats far more visibly than a company does.
    framePenalty: 0.45,
    // Hard cap on how many of one frame can fill the shortlist. The soft
    // penalty above cannot help inside a single run: if the top eight stories
    // are all failures, the model has nothing else to pick.
    maxPerFrame: 3,

    // Things going right. Without these, every signal above rewards something
    // breaking, and the page turns into one long obituary.
    positiveWords: [
      'open-sources', 'open sources', 'open-sourced', 'free', 'faster',
      'speedup', 'speed up', 'cheaper', 'rewrote', 'rewritten', 'solved',
      'fixed', 'finally', 'ships', 'shipped', 'breakthrough', 'record',
      'beats', 'outperforms', 'smaller', 'runs locally', 'on-device',
    ],

    // Stories a developer can actually joke about. This is the main signal.
    funnyWords: [
      // Not bare "down": it matches "doubles down". Use the real phrases.
      'outage', 'went down', 'took down', 'taken down', 'downtime',
      'broke', 'broken', 'bug', 'glitch', 'crash', 'crashed',
      'deleted', 'lost', 'leak', 'leaked', 'exposed', 'hacked', 'breach',
      'deprecated', 'sunset', 'price hike', 'paywall', 'rug pull',
      'rewrite', 'rollback', 'reverted', 'delayed', 'vibe coding',
      'slop', 'benchmark', 'overfit', 'wrapper', 'accidentally', 'admits',
      'hallucinating', 'hallucinated', 'hallucination', 'hallucinations',
      'apologises', 'apologizes', 'apologised', 'apologized',
    ],

    // Heavy stories. Real news, wrong page. These get pushed down hard.
    heavyWords: [
      'extinction', 'existential', 'doomsday', 'apocalypse', 'end of humanity',
      'layoffs', 'laid off', 'job cuts', 'fired', 'suicide', 'death', 'died',
      'killed', 'war', 'weapon', 'military', 'abuse', 'csam', 'harassment',
      'lawsuit', 'sues', 'court', 'regulation', 'senate', 'congress',
      'legislation', 'antitrust',
    ],
    heavyPenalty: 0.5,

    controversyWords: [
      'banned', 'backlash', 'criticism', 'shut down', 'shuts down',
      'controversy', 'fails', 'failed', 'quit', 'resigns',
    ],
    noveltyWords: [
      'first', 'launches', 'unveils', 'open-sources', 'open sources', 'release',
      'breakthrough', 'now available', 'introduces', 'announces', 'ships',
    ],
    bigNames: [
      'openai', 'google', 'meta', 'microsoft', 'apple', 'nvidia', 'anthropic',
      'amazon', 'tesla', 'x.ai', 'xai', 'deepseek', 'mistral', 'github',
      'cursor', 'vercel', 'cloudflare', 'aws', 'docker', 'npm',
    ],
  },

  /* --- Stage 4/5: how the post should read -------------------------------- */
  content: {
    // A hard ceiling across every shape. The per-post target comes from the
    // shape's own range and the length mood below, and is always well under
    // this - nothing here should ever reach 200 words.
    maxWords: 200,
    // How long a post runs, rotated per post. Every post landing at the same
    // length is quieter than a repeated closing question, but a feed where
    // every entry fills the same amount of screen still reads as machine-paced.
    lengthMoods: ['tight', 'mid', 'short', 'full'],
    // LinkedIn truncates around here. The hook has to land before it.
    hookMaxChars: 140,
    hookCandidates: 4,
    // How far below the top score still counts as a contender. The scorer
    // measures length, cliches and punctuation, not whether a line is good,
    // so a 0.70 and a 0.68 are the same hook as far as it knows. Taking the
    // exact maximum every time turned that noise into a rule, and the model
    // lists its safest line first, so the safest line kept winning ties.
    // Set to 0 to consider only the exact top score. Note that an exact tie
    // is still broken at random even then, because a tie is precisely the
    // case where this scorer has no opinion.
    hookJitter: 0.12,
    // Is the post worth posting at all?
    //
    // Every other check in this pipeline is structural, and a post went out
    // that passed all of them while saying nothing: it never mentioned what
    // the story was, and closed on "This should be interesting." A semantic
    // failure needs a semantic check, so this one costs a call.
    quality: {
      useLlmJudge: true,
      // Out of 5. Three is "accurate, mildly amusing, forgettable", which is
      // the floor for something going out under your own name.
      minScore: 3,
    },

    hashtagCount: { min: 3, max: 5 },
    // How many tags a post gets, rotated like everything else. Twelve of the
    // first thirteen posts carried exactly three, which is a small tell but a
    // tell. Ordered so the count moves about rather than climbing.
    hashtagCounts: [3, 5, 4, 3, 4, 5],
    // A tag used within this many posts is barred. Stops the same two or three
    // tags riding along on every single post.
    hashtagCooldown: 3,
    // How far back fatigue is measured. Same two-horizon idea as the meme
    // templates: the cooldown bars, the history decides who is most overdue.
    hashtagHistory: 25,
    // How many recent posts an exact hashtag SET is compared against. Checking
    // only the previous post left identical sets seven posts apart, which at
    // three posts a week is close enough together to read as a copy-paste.
    hashtagSetCooldown: 10,
    // No tag may appear in more than this share of the recent window. This is
    // the one that matters: without it #MachineLearning was on 85% of posts
    // and #AIAgents on 69%, because the model reaches for them every time.
    hashtagMaxShare: 0.4,
    // The flat preferredHashtags list used to live here. It is gone rather
    // than left lying around: the tags are grouped by subject in
    // content-engine/hashtags.js now, and which ones a post can reach for
    // depends on its story frame. A flat list is what let the same three tags
    // ride along on everything.
    bannedHashtags: ['#AI', '#Technology', '#Innovation', '#Future', '#Growth', '#Motivation'],
    // The skeleton of the post, rotated one per post. Varying only the first
    // line while every post kept the same hook/body/question/hashtags frame is
    // what made the feed look templated. See content-engine/shapes.js.
    postShapes: [
      'classic-take',
      'two-line-zinger',
      'slow-burn-rant',
      'terminal-log',
      'quote-reaction',
      'receipts',
    ],
    // How a post ends, rotated separately again. 'none' is in here on purpose:
    // every post closing with a question was the loudest sign of a template.
    // Shapes that end themselves (the zinger, the rant) skip this rotation.
    closerStyles: [
      'argument-bait',
      'flat-verdict',
      'prediction',
      'dare',
      'aside',
      'none',
    ],
    // Rotate openers too.
    openingStyles: [
      'blunt-claim',
      'oh-no-observation',
      'number-drop',
      'fake-confession',
      'dry-comparison',
    ],
  },

  humanizer: {
    // Run a second cheap LLM pass as an "editor". Costs one extra call.
    useLlmEditorPass: true,
    // Cap em-dashes per post. More than this reads as machine-written.
    maxEmDashes: 1,
    // Target share of sentences that use contractions (0-1). Rough guide only.
    minContractionRatio: 0.3,
  },

  memeGenerator: {
    // What kind of media a post gets, rotated one per post. "text-only" is in
    // here on purpose: a feed where every single entry carries a matching
    // square is its own kind of obviously-automated. Sizes live in
    // meme-generator/media.js.
    //
    // Ordered so the two picture treatments are not adjacent, and text-only
    // lands roughly every third post.
    treatments: ['meme-square', 'text-only', 'meme-portrait'],

    // How the template is chosen. Selection is deterministic: every candidate
    // is scored and the best wins, so it cannot draw the same one twice by
    // chance the way the old random pick did.
    selectionWeights: {
      // Does this layout suit the post? A terminal-log post wants a terminal.
      // Worth more than freshness, because media that matches the writing is
      // the whole point of choosing rather than drawing from a hat.
      affinity: 1,
      // How long since this exact template.
      templateFreshness: 0.8,
      // How long since this LAYOUT, whatever the colours. Four of the twelve
      // templates are the classic shape, so without this two of them in a row
      // counted as variety while looking like one post recoloured.
      layoutFreshness: 0.6,
    },

    // Kept for anything that renders without a treatment.
    width: 1200,
    height: 1200,
    // Small credit line at the bottom of every meme.
    //
    // Empty string = no line at all. It is off because the image looks
    // cleaner without it. Worth knowing: the post text does not link to the
    // article either, so with this empty nothing says where the news came
    // from. Set it back to 'via TechCrunch' if you want the credit.
    footer: process.env.MEME_FOOTER ?? '',
    // Don't reuse a template until this many posts have gone out. A hard bar.
    templateCooldown: 8,
    // How far back the picker LOOKS, which is a different job from the bar
    // above. The cooldown says who is barred; this says who is most overdue.
    // With only the cooldown to go on, everything outside it looks equally
    // stale, the ranking settles into a fixed orbit, and some templates never
    // come up at all. At eight it cycled ten of the twelve and never drew the
    // other two.
    templateHistory: 40,
    format: 'png',
  },

  /* --- Stage 7: when and where it goes out -------------------------------- */
  schedule: {
    // Default: Tue/Wed/Thu 09:30 IST. Mornings on those days do well with a
    // technical LinkedIn audience in India + early Europe.
    cron: process.env.SCHEDULE_CRON || '30 9 * * 2,3,4',
    timezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Kolkata',
    postsPerWeek: readNumber(process.env.POSTS_PER_WEEK, 3),
  },

  publisher: {
    // "console" = print it, publish nothing. "linkedin" = the real thing.
    provider: process.env.PUBLISHER || 'console',
    linkedin: {
      accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
      memberId: process.env.LINKEDIN_MEMBER_ID || '',
      // LinkedIn turns off API versions after about a year, and a dead one
      // fails with "426 NONEXISTENT_VERSION". When that happens, bump this.
      // Only some months are ever active: 202608 works, 202609 does not.
      apiVersion: process.env.LINKEDIN_API_VERSION || '202608',
      // Only used by `npm run linkedin:auth`, never at posting time.
      clientId: process.env.LINKEDIN_CLIENT_ID || '',
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
      redirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:4000/callback',
    },
  },

  store: {
    driver: process.env.STORE_DRIVER || 'json',
    // Escape hatch for the guard in agent.js, which refuses to publish live
    // while recording the post to a local JSON file that Lambda cannot read.
    // Keeping two memories is what made two posts a day apart look identical.
    allowJsonForLivePosts: readBool(process.env.ALLOW_JSON_STORE_FOR_LIVE_POSTS, false),
    tableName: process.env.DYNAMO_TABLE || 'linkedin-tech-meme-agent',
    region: process.env.AWS_REGION || 'ap-south-1',
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || '',
    temperature: 0.9,
    maxTokens: 900,
  },

  // Master safety switch. While true the publisher is never called for real.
  dryRun: readBool(process.env.DRY_RUN, true),
};

export default config;
