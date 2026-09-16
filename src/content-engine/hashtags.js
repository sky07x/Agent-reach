/**
 * Which hashtags a post gets.
 *
 * The old version took whatever the model offered, topped the list up from a
 * fixed array read front to back, and stopped at three. No cooldown, no
 * memory. Over the first thirteen posts that gave:
 *
 *   #MachineLearning  11 of 13   (85%)
 *   #AIAgents          9 of 13   (69%)
 *
 * with five of the fifteen configured tags never used once, twelve of the
 * thirteen sets exactly three tags long, and two pairs of posts carrying the
 * identical set in a different order.
 *
 * Two forces have to be balanced here, and they pull against each other.
 * Variety says rotate. Relevance says an AI story really does want the AI
 * tags, every time, and a post tagged #Kubernetes because #Kubernetes was
 * next in some queue is worse than a repeated tag - it is a lie about what
 * the post is about.
 *
 * So relevance decides who is eligible and variety decides between them. A
 * tag nothing has made relevant is never chosen, however overdue it is.
 */

/**
 * Tags grouped by what they are about.
 *
 * Groups are matched to a story through the frames from curator/frames.js, so
 * the tags follow the kind of story rather than a queue.
 */
export const HASHTAG_GROUPS = {
  // Always relevant: this is a developer page, whatever the story.
  core: ['#DevTools', '#SoftwareEngineering'],
  ai: ['#LLM', '#GenAI', '#AIAgents', '#MachineLearning', '#RAG', '#PromptEngineering'],
  infra: ['#Infra', '#Kubernetes', '#GPU', '#Cloud', '#Observability'],
  security: ['#Cybersecurity', '#AppSec', '#PromptInjection'],
  code: ['#OpenSource', '#Python', '#TypeScript', '#Rust'],
  money: ['#Startups', '#VentureCapital', '#TechBusiness'],
  craft: ['#CodeQuality', '#TechnicalDebt', '#DeveloperExperience'],
};

/**
 * What the story is actually ABOUT, read from its own words.
 *
 * This is the important one, and getting here took a wrong turn worth
 * recording. The first version picked tags from the story's frame alone, and
 * live output immediately showed why that cannot work:
 *
 *   "AI startups shut down, 42% abandoned"  ->  #Kubernetes #Observability
 *   "Superhuman acquires Fathom"            ->  #Rust #TypeScript
 *
 * A frame is the emotional shape of a story - something broke, someone
 * shipped - and says nothing about its subject. "Broke" covers an outage and
 * a startup folding equally well, and those want completely different tags.
 * Shape and subject are orthogonal, and using one for the other produces
 * confident nonsense.
 *
 * So subject is matched from the title and summary, and the frame is only
 * consulted when nothing here fires.
 */
export const SUBJECT_MATCHERS = {
  infra: [
    'kubernetes', 'docker', 'container', 'cloud', 'aws', 'azure', 'datacenter',
    'data center', 'server', 'outage', 'downtime', 'latency', 'gpu', 'chip',
    'infrastructure', 'compute', 'scaling', 'uptime',
  ],
  security: [
    'security', 'breach', 'hacked', 'vulnerability', 'exploit', 'malware',
    'phishing', 'credential', 'leak', 'leaked', 'exposed', 'attack', 'rogue',
    'prompt injection', 'jailbreak', 'permission', 'unauthorized',
  ],
  money: [
    'funding', 'raises', 'raised', 'valuation', 'billion', 'million', 'acquires',
    'acquired', 'acquisition', 'ipo', 'revenue', 'investor', 'venture',
    'seed round', 'series a', 'series b', 'shuts down', 'shut down', 'startup',
    'startups', 'price', 'pricing', 'paywall',
  ],
  code: [
    'open source', 'open-source', 'open-sources', 'github', 'repository',
    'python', 'typescript', 'javascript', 'rust', 'golang', 'compiler',
    'library', 'framework', 'sdk', 'api', 'release', 'version',
  ],
  craft: [
    'deprecated', 'deprecation', 'breaking change', 'migration', 'refactor',
    'technical debt', 'legacy', 'documentation', 'docs', 'developer experience',
    'productivity', 'workflow', 'tooling', 'maintenance',
  ],
  ai: [
    'ai', 'artificial intelligence', 'llm', 'model', 'models', 'gpt', 'chatgpt',
    'openai', 'anthropic', 'claude', 'gemini', 'agent', 'agents', 'agentic',
    'inference', 'training', 'fine-tune', 'prompt', 'rag', 'hallucinat',
    'machine learning', 'neural',
  ],
};

/**
 * Which groups a frame suggests, used ONLY when the story's own words say
 * nothing. A fallback, not a mapping - see the note above.
 */
export const FRAME_GROUPS = {
  broke: ['ai', 'craft'],
  'hype-check': ['ai', 'craft'],
  'absurd-money': ['money', 'ai'],
  shipped: ['ai', 'code'],
  'foot-gun': ['security', 'ai'],
  irony: ['ai', 'craft'],
  grind: ['craft', 'code'],
};

/** How relevant a tag is to this post. Higher wins; zero is never used. */
export const RELEVANCE = {
  // The model read the article. Nothing else here knows that much about it.
  modelChose: 3,
  // The story's own words say it is about this.
  subject: 2,
  // Only the frame suggested it, and only because nothing else did. Ranked
  // below subject deliberately: a frame is a guess about shape, not subject.
  frameGroup: 1.5,
  // True of every post on this page, so always safe, never exciting.
  core: 1,
};

/** Normalise to "#OneWord", or null if it cannot be one. */
export function normalizeTag(tag) {
  const cleaned = String(tag ?? '').trim();
  const withHash = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;

  return /^#[A-Za-z][A-Za-z0-9]*$/.test(withHash) ? withHash : null;
}

const key = (tag) => tag.toLowerCase();

/** Every tag we know about, deduplicated. */
export function allKnownTags() {
  return [...new Set(Object.values(HASHTAG_GROUPS).flat())];
}

/**
 * The tags worth suggesting to the writer for this kind of story.
 *
 * Shown in the prompt, so the model's own picks start from the right place
 * rather than defaulting to the same handful of AI tags for everything. It
 * falls back to the whole list when we could not frame the story, since a
 * narrower list would be a guess dressed up as a hint.
 */
export function tagsForFrame(frame) {
  const groups = FRAME_GROUPS[frame];
  if (!groups) return allKnownTags();

  return [...new Set([...groups.flatMap((group) => HASHTAG_GROUPS[group] ?? []), ...HASHTAG_GROUPS.core])];
}

/**
 * Score every candidate tag for this post.
 *
 * @param {object} options
 * @param {string[]} [options.modelTags]  what the writer suggested
 * @param {string} [options.frame]        the story frame, from the curator
 * @returns {Map<string, {tag: string, relevance: number, why: string}>}
 */
export function relevantTags({ modelTags = [], frame, text = '' }) {
  const found = new Map();
  const haystack = String(text).toLowerCase();

  const add = (rawTag, relevance, why) => {
    const tag = normalizeTag(rawTag);
    if (!tag) return;

    const existing = found.get(key(tag));

    // A tag can qualify twice. Keep the strongest reason.
    if (!existing || existing.relevance < relevance) {
      found.set(key(tag), { tag, relevance, why });
    }
  };

  // What the story says it is about, in its own words.
  const subjects = Object.entries(SUBJECT_MATCHERS)
    .filter(([, words]) => words.some((word) => haystack.includes(word)))
    .map(([group]) => group);

  for (const group of subjects) {
    for (const tag of HASHTAG_GROUPS[group] ?? []) add(tag, RELEVANCE.subject, `the story is about ${group}`);
  }

  // The frame is a fallback, not a mapping. Consulting it when the subject is
  // already known is how a story about startups folding got tagged
  // #Kubernetes: "broke" is a shape, and shapes do not pick subjects.
  if (!subjects.length) {
    for (const group of FRAME_GROUPS[frame] ?? []) {
      for (const tag of HASHTAG_GROUPS[group] ?? []) add(tag, RELEVANCE.frameGroup, `nothing clearer than a ${frame} story`);
    }
  }

  for (const tag of HASHTAG_GROUPS.core) add(tag, RELEVANCE.core, 'always relevant here');

  // Last, so it overwrites the weaker reasons above.
  for (const tag of modelTags) add(tag, RELEVANCE.modelChose, 'the writer picked it');

  return found;
}

/**
 * How heavily each tag has been leaned on lately.
 *
 * @param {string[][]} recentSets  hashtag sets, newest first
 * @returns {Map<string, {uses: number, share: number, lastUsed: number}>}
 */
export function tagUsage(recentSets) {
  const usage = new Map();

  recentSets.forEach((set, position) => {
    for (const rawTag of set ?? []) {
      const tag = normalizeTag(rawTag);
      if (!tag) continue;

      const entry = usage.get(key(tag)) ?? { uses: 0, share: 0, lastUsed: Infinity };

      entry.uses += 1;
      entry.lastUsed = Math.min(entry.lastUsed, position);
      usage.set(key(tag), entry);
    }
  });

  for (const entry of usage.values()) {
    entry.share = recentSets.length ? entry.uses / recentSets.length : 0;
  }

  return usage;
}

/**
 * Choose the hashtags for one post.
 *
 * Eligibility is decided by two hard bars and then relaxed only as far as it
 * has to be, because a short relevant set beats a padded generic one:
 *
 *   1. everything relevant, inside both bars
 *   2. ...allowing tags over their share of recent posts
 *   3. ...allowing tags used very recently
 *
 * It never reaches past relevance. If a story genuinely only supports two
 * tags, it gets two.
 *
 * @param {object} options
 * @param {string[]} [options.modelTags]
 * @param {string} [options.frame]
 * @param {string[][]} [options.recentSets]  newest first, for fatigue
 * @param {string[]} [options.previousSet]   the last post's tags
 * @param {number} options.count             how many to aim for
 * @param {object} options.rules             config.content hashtag rules
 * @returns {{tags: string[], chosen: object[], relaxed: string|null}}
 */
export function chooseHashtags({
  modelTags = [],
  frame,
  text = "",
  recentSets = [],
  previousSet = [],
  count,
  rules,
}) {
  const banned = new Set((rules.banned ?? []).map(key));
  const usage = tagUsage(recentSets);

  const candidates = [...relevantTags({ modelTags, frame, text }).values()]
    .filter((entry) => !banned.has(key(entry.tag)));

  const stats = (entry) => usage.get(key(entry.tag)) ?? { uses: 0, share: 0, lastUsed: Infinity };

  /**
   * Relevance first, then whoever has waited longest. Ties break on the name
   * so the same inputs always give the same set - see #7, where a stable
   * tiebreak mattered more than it looked like it would.
   */
  const rank = (a, b) => (b.relevance - a.relevance)
    || (stats(b).lastUsed - stats(a).lastUsed)
    || a.tag.localeCompare(b.tag);

  const withinCooldown = (entry) => stats(entry).lastUsed < rules.cooldown;
  const overShare = (entry) => stats(entry).share > rules.maxShare;

  // Each step lets one more thing through. Stop at the first that fills up.
  const steps = [
    { name: null, allow: (entry) => !withinCooldown(entry) && !overShare(entry) },
    { name: 'share', allow: (entry) => !withinCooldown(entry) },
    { name: 'cooldown', allow: () => true },
  ];

  let picked = [];
  let relaxed = null;

  for (const step of steps) {
    const pool = candidates.filter(step.allow).sort(rank);

    picked = pool.slice(0, count);
    relaxed = step.name;

    if (picked.length >= Math.min(count, rules.min)) break;
  }

  // The identical set reads as a copy-paste even when the words are
  // completely different, so it is checked against the last several posts and
  // not only the one before. Checking one neighbour left exact repeats seven
  // posts apart, which at three posts a week is close enough to notice.
  const setKey = (tags) => [...tags].map(key).sort().join(' ');
  const recentKeys = new Set(recentSets.slice(0, rules.setCooldown ?? 0).map(setKey));

  if (previousSet.length) recentKeys.add(setKey(previousSet));

  if (recentKeys.has(setKey(picked.map((entry) => entry.tag)))) {
    const ranked = [...candidates].sort(rank);

    // Swap the weakest member for the best thing that breaks the collision.
    for (const replacement of ranked) {
      if (picked.some((entry) => key(entry.tag) === key(replacement.tag))) continue;

      const attempt = [...picked.slice(0, -1), replacement];

      if (!recentKeys.has(setKey(attempt.map((entry) => entry.tag)))) {
        picked = attempt;
        relaxed = relaxed ?? 'repeat-set';
        break;
      }
    }
  }

  return {
    tags: picked.map((entry) => entry.tag),
    chosen: picked.map((entry) => ({
      tag: entry.tag,
      why: entry.why,
      relevance: entry.relevance,
      uses: stats(entry).uses,
    })),
    relaxed,
  };
}

export default {
  HASHTAG_GROUPS,
  FRAME_GROUPS,
  SUBJECT_MATCHERS,
  tagsForFrame,
  RELEVANCE,
  normalizeTag,
  allKnownTags,
  relevantTags,
  tagUsage,
  chooseHashtags,
};
