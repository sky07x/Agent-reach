/**
 * Hashtag selection.
 *
 * The version this replaced had no memory at all. Over the first thirteen
 * posts it put #MachineLearning on eleven of them and #AIAgents on nine, left
 * five of the fifteen configured tags unused, made twelve of the thirteen
 * sets exactly three long, and shipped two pairs of posts carrying the
 * identical set reordered.
 *
 * The thing these tests guard hardest is the tension: variety must never win
 * so hard that a post ends up tagged with something it is not about.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HASHTAG_GROUPS,
  FRAME_GROUPS,
  RELEVANCE,
  normalizeTag,
  allKnownTags,
  relevantTags,
  tagUsage,
  tagsForFrame,
  chooseHashtags,
} from '../src/content-engine/hashtags.js';
import { FRAME_NAMES } from '../src/curator/frames.js';
import { createRotation } from '../src/lib/rotation.js';
import { config } from '../src/config/index.js';

const RULES = {
  min: config.content.hashtagCount.min,
  banned: config.content.bannedHashtags,
  cooldown: config.content.hashtagCooldown,
  maxShare: config.content.hashtagMaxShare,
  setCooldown: config.content.hashtagSetCooldown,
};

const choose = (options) => chooseHashtags({ count: 3, rules: RULES, ...options });

/* --- the groups themselves ------------------------------------------------ */

test('every group tag is a usable hashtag', () => {
  for (const [group, tags] of Object.entries(HASHTAG_GROUPS)) {
    for (const tag of tags) {
      assert.equal(normalizeTag(tag), tag, `${group} has an unusable tag: ${tag}`);
    }
  }
});

test('no group tag is on the banned list', () => {
  const banned = new Set(config.content.bannedHashtags.map((tag) => tag.toLowerCase()));

  for (const tag of allKnownTags()) {
    assert.ok(!banned.has(tag.toLowerCase()), `${tag} is both grouped and banned`);
  }
});

test('every story frame has hashtag groups behind it', () => {
  for (const frame of FRAME_NAMES) {
    assert.ok(FRAME_GROUPS[frame], `frame "${frame}" has no hashtag groups`);

    for (const group of FRAME_GROUPS[frame]) {
      assert.ok(HASHTAG_GROUPS[group], `frame "${frame}" names a group that does not exist: ${group}`);
    }
  }
});

test('every frame can fill a full set from relevant tags alone', () => {
  // Without this, some frame quietly falls back to core on every post.
  for (const frame of FRAME_NAMES) {
    const available = relevantTags({ frame }).size;
    assert.ok(
      available >= config.content.hashtagCount.max,
      `frame "${frame}" has only ${available} relevant tags, needs ${config.content.hashtagCount.max}`,
    );
  }
});

test('different frames actually suggest different tags', () => {
  const security = new Set(tagsForFrame('foot-gun'));
  const money = new Set(tagsForFrame('absurd-money'));

  assert.ok(security.has('#Cybersecurity'));
  assert.ok(money.has('#Startups'));
  assert.ok(!money.has('#Cybersecurity'), 'a funding story is not a security story');
});

test('an unknown frame falls back to everything, not to nothing', () => {
  assert.deepEqual(tagsForFrame('not-a-frame').sort(), allKnownTags().sort());
});

/* --- relevance ------------------------------------------------------------ */

test('the writer outranks the subject, which outranks core', () => {
  const found = relevantTags({ modelTags: ['#Rust'], text: 'A Kubernetes cluster outage' });

  assert.equal(found.get('#rust').relevance, RELEVANCE.modelChose);
  assert.equal(found.get('#gpu').relevance, RELEVANCE.subject, 'infra, because the story says so');
  assert.equal(found.get('#softwareengineering').relevance, RELEVANCE.core);
});

test('the subject comes from the story, not from its frame', () => {
  // The live failure: a "broke" story about startups folding was tagged
  // #Kubernetes, because the frame said broke and broke was mapped to infra.
  // A frame is the shape of a story and says nothing about its subject.
  const found = relevantTags({
    frame: 'broke',
    text: 'The AI graveyard: a running list of projects and startups that did not make it',
  });

  assert.ok(!found.has('#kubernetes'), 'a startup folding is not an infrastructure story');
  assert.ok(found.has('#startups'), 'it is a story about startups');
});

test('the frame is consulted only when the story says nothing', () => {
  const silent = relevantTags({ frame: 'foot-gun', text: 'Something happened somewhere' });
  const speaking = relevantTags({ frame: 'foot-gun', text: 'A Kubernetes cluster fell over' });

  assert.equal(silent.get('#cybersecurity')?.relevance, RELEVANCE.frameGroup, 'the fallback fires');
  assert.ok(!speaking.has('#cybersecurity'), 'but not once the story has spoken for itself');
  assert.equal(speaking.get('#infra').relevance, RELEVANCE.subject);
});

test('a frame-only tag never outranks one the story asked for', () => {
  assert.ok(RELEVANCE.subject > RELEVANCE.frameGroup, 'a guess must not beat evidence');
});

test('a tag nothing made relevant is never chosen', () => {
  // #Kubernetes is real, but a funding story is not about Kubernetes.
  const { tags } = choose({ frame: 'absurd-money', count: 5 });

  assert.ok(!tags.includes('#Kubernetes'), 'variety must not invent a topic');
});

test('an irrelevant tag stays out even when everything else is fatigued', () => {
  // Every money and core tag used constantly. It should run short rather than
  // reach for something the post is not about.
  const hot = [...HASHTAG_GROUPS.money, ...HASHTAG_GROUPS.core, ...HASHTAG_GROUPS.ai];
  const recentSets = Array.from({ length: 10 }, () => hot);

  const { tags } = choose({ frame: 'absurd-money', recentSets, count: 5 });

  for (const tag of tags) {
    assert.ok(hot.includes(tag), `${tag} is not relevant to a funding story`);
  }
});

test('a banned tag is dropped even when the writer asks for it', () => {
  const { tags } = choose({ modelTags: ['#AI', '#Innovation', '#LLM'], frame: 'shipped' });

  assert.ok(!tags.includes('#AI'));
  assert.ok(!tags.includes('#Innovation'));
  assert.ok(tags.includes('#LLM'), 'the good one survives');
});

test('the writer\'s own picks are honoured first', () => {
  const { tags } = choose({ modelTags: ['#Rust', '#Observability'], frame: 'shipped', count: 3 });

  assert.ok(tags.includes('#Rust'));
  assert.ok(tags.includes('#Observability'), 'even from a group the frame did not ask for');
});

/* --- cooldown and share --------------------------------------------------- */

test('a tag used last post does not come straight back', () => {
  const recentSets = [['#LLM', '#GenAI', '#DevTools']];

  const { tags } = choose({ frame: 'shipped', recentSets, count: 3 });

  for (const tag of ['#LLM', '#GenAI', '#DevTools']) {
    assert.ok(!tags.includes(tag), `${tag} came straight back`);
  }
});

test('a dominant tag is barred once it passes its share', () => {
  // #MachineLearning on eight of ten posts, which is what actually happened.
  const recentSets = Array.from({ length: 10 }, (_, i) => (
    i < 8 ? ['#MachineLearning', '#Rust', '#Python'] : ['#Rust', '#Python', '#GenAI']
  ));

  const { tags } = choose({ frame: 'shipped', recentSets, count: 3 });

  assert.ok(!tags.includes('#MachineLearning'), 'over its share, so it sits this one out');
});

test('the writer cannot override the share cap on its own', () => {
  const recentSets = Array.from({ length: 10 }, () => ['#MachineLearning', '#LLM', '#GenAI']);

  const { tags } = choose({ modelTags: ['#MachineLearning'], frame: 'shipped', recentSets, count: 3 });

  assert.ok(!tags.includes('#MachineLearning'), 'relevance decides who is eligible, not who is exempt');
});

/* --- the thin case -------------------------------------------------------- */

test('a thin story gets a short honest set rather than padding', () => {
  const rules = { ...RULES, maxShare: 0 };

  // Only two tags exist at all, and both are over any share.
  const { tags } = chooseHashtags({
    modelTags: ['#Rust'],
    frame: undefined,
    recentSets: [['#Rust', '#DevTools', '#SoftwareEngineering']],
    count: 5,
    rules,
  });

  assert.ok(tags.length <= 3, 'it must not invent tags to hit a number');
  assert.ok(tags.every((tag) => allKnownTags().includes(tag) || tag === '#Rust'));
});

test('relaxation is reported, so a thin run is visible rather than silent', () => {
  // Genuinely exhausted: every tag this frame can reach, used on every recent
  // post. Only then should it bend a rule, and it should say that it did.
  const everything = [...relevantTags({ frame: 'absurd-money' }).values()].map((entry) => entry.tag);
  const recentSets = Array.from({ length: 6 }, () => everything);

  const { relaxed, tags } = chooseHashtags({
    frame: 'absurd-money',
    recentSets,
    count: 5,
    rules: { ...RULES, maxShare: 0.1 },
  });

  assert.ok(relaxed, 'a run that had to bend a rule should say so');
  assert.ok(tags.every((tag) => everything.includes(tag)), 'and it still must not bend relevance');
});

test('nothing is relaxed while fresh relevant tags remain', () => {
  // The other half of the rule. Only the money and core tags are tired here,
  // and the ai group is untouched, so there is no reason to bend anything.
  const recentSets = Array.from({ length: 6 }, () => [...HASHTAG_GROUPS.core, ...HASHTAG_GROUPS.money]);

  const { relaxed } = chooseHashtags({
    frame: 'absurd-money',
    recentSets,
    count: 5,
    rules: { ...RULES, maxShare: 0.1 },
  });

  assert.equal(relaxed, null, 'there were plenty of fresh relevant tags left');
});

test('it still returns something usable when there is no history at all', () => {
  const { tags } = choose({ modelTags: ['#LLM'], frame: 'irony', count: 4 });

  assert.equal(tags.length, 4);
  assert.equal(new Set(tags).size, 4, 'no duplicates');
});

/* --- consecutive sets ----------------------------------------------------- */

test('a set is never identical to the one before it', () => {
  const previousSet = ['#LLM', '#GenAI', '#DevTools'];

  const { tags } = chooseHashtags({
    modelTags: previousSet,
    frame: 'irony',
    recentSets: [],
    previousSet,
    count: 3,
    rules: { ...RULES, cooldown: 0, maxShare: 1 },
  });

  const same = tags.length === previousSet.length && tags.every((tag) => previousSet.includes(tag));
  assert.ok(!same, `repeated the previous set exactly: ${tags.join(' ')}`);
});

test('selection is deterministic', () => {
  const input = { modelTags: ['#LLM'], frame: 'broke', recentSets: [['#GPU']], count: 4 };

  const runs = Array.from({ length: 10 }, () => choose(input).tags.join(' '));

  assert.equal(new Set(runs).size, 1);
});

/* --- distribution over a long run ---------------------------------------- */

test('no tag dominates the feed over fifty posts', () => {
  // The real failure reproduced: an AI page where the writer reaches for the
  // same three AI tags every time.
  const modelFavourites = ['#MachineLearning', '#AIAgents', '#GenAI'];
  const frames = FRAME_NAMES;

  const history = [];
  const counts = new Map();
  const posts = 50;

  for (let i = 0; i < posts; i += 1) {
    const { tags } = chooseHashtags({
      modelTags: modelFavourites,
      frame: frames[i % frames.length],
      recentSets: history,
      previousSet: history[0] ?? [],
      count: config.content.hashtagCounts[i % config.content.hashtagCounts.length],
      rules: RULES,
    });

    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);

    history.unshift(tags);
    history.length = Math.min(history.length, config.content.hashtagHistory);
  }

  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = worst[1] / posts;

  assert.ok(share <= 0.5, `${worst[0]} appeared on ${Math.round(share * 100)}% of posts`);
  assert.ok(counts.size >= 12, `only ${counts.size} distinct tags used across ${posts} posts`);
});

test('consecutive posts never carry the same set over a long run', () => {
  const history = [];

  for (let i = 0; i < 50; i += 1) {
    const { tags } = chooseHashtags({
      modelTags: ['#MachineLearning', '#AIAgents'],
      frame: FRAME_NAMES[i % FRAME_NAMES.length],
      recentSets: history,
      previousSet: history[0] ?? [],
      count: config.content.hashtagCounts[i % config.content.hashtagCounts.length],
      rules: RULES,
    });

    if (history[0]) {
      const same = tags.length === history[0].length && tags.every((tag) => history[0].includes(tag));
      assert.ok(!same, `post ${i} repeated the previous set: ${tags.join(' ')}`);
    }

    history.unshift(tags);
    history.length = Math.min(history.length, config.content.hashtagHistory);
  }
});

/* --- usage bookkeeping ---------------------------------------------------- */

test('usage counts and positions are measured newest-first', () => {
  const usage = tagUsage([['#LLM'], ['#GenAI'], ['#LLM']]);

  assert.equal(usage.get('#llm').uses, 2);
  assert.equal(usage.get('#llm').lastUsed, 0, 'used in the most recent post');
  assert.equal(usage.get('#genai').lastUsed, 1);
  assert.ok(Math.abs(usage.get('#llm').share - 2 / 3) < 0.001);
});

test('junk in the stored history does not break the count', () => {
  const usage = tagUsage([['#LLM', 'not a tag', '', null], undefined]);

  assert.equal(usage.get('#llm').uses, 1);
  assert.equal(usage.size, 1);
});

/* --- state, the same as every other rotation ----------------------------- */

/** Writes through to the object passed in, so a swap can share the state. */
function memoryStore(state = {}, posts = []) {
  return {
    getState: async (key, fallback = null) => (key in state ? state[key] : fallback),
    setState: async (key, value) => { state[key] = value; },
    listPosts: async () => posts,
  };
}

test('the count rotation walks every configured size', async () => {
  const rotation = createRotation({ store: memoryStore() });
  const names = config.content.hashtagCounts.map(String);

  const seen = [];
  for (let i = 0; i < names.length; i += 1) {
    seen.push(await rotation.next({ key: 'hashtagCountRotationIndex', names }));
  }

  assert.deepEqual(seen, names, 'in order, one per post');
  assert.ok(new Set(seen).size > 1, 'sets must not all be the same length');
});

test('the count rotation rebuilds itself from post history', async () => {
  // A cold Lambda, or the store swapped underneath us. Before #6 this
  // restarted at zero and the feed replayed from the top.
  const posts = [
    { hashtags: ['#LLM'] },
    { hashtags: ['#GenAI'] },
    { hashtags: [] },
    { noTagsAtAll: true },
  ];

  const rotation = createRotation({ store: memoryStore({}, posts) });
  const names = config.content.hashtagCounts.map(String);

  const next = await rotation.next({
    key: 'hashtagCountRotationIndex',
    names,
    seed: (all) => all.filter((post) => post.hashtags?.length).length,
  });

  assert.equal(next, names[2 % names.length], 'continues at post 3, ignoring the empty ones');
});

test('state survives a store swap, local to Lambda', async () => {
  const bag = {};
  const first = createRotation({ store: memoryStore(bag) });

  await first.next({ key: 'hashtagCountRotationIndex', names: ['3', '5', '4'] });
  await first.next({ key: 'hashtagCountRotationIndex', names: ['3', '5', '4'] });

  // Same state, brand new rotation object, as a cold container would build.
  const second = createRotation({ store: memoryStore(bag) });

  assert.equal(
    await second.next({ key: 'hashtagCountRotationIndex', names: ['3', '5', '4'] }),
    '4',
    'post 3 follows posts 1 and 2',
  );
});

test('an exact set does not come back inside the set cooldown', () => {
  // Consecutive-only was not enough: with the frame and count rotations
  // cycling, identical sets reappeared seven posts apart, which at three
  // posts a week is close enough together to read as a copy-paste.
  const window = config.content.hashtagSetCooldown;
  const history = [];
  const keyOf = (tags) => [...tags].sort().join(' ');

  for (let i = 0; i < 60; i += 1) {
    const { tags } = chooseHashtags({
      modelTags: ['#MachineLearning', '#AIAgents', '#GenAI'],
      frame: FRAME_NAMES[i % FRAME_NAMES.length],
      recentSets: history,
      count: config.content.hashtagCounts[i % config.content.hashtagCounts.length],
      rules: RULES,
    });

    const clash = history.slice(0, window).findIndex((set) => keyOf(set) === keyOf(tags));
    assert.equal(clash, -1, `post ${i} repeated the set from ${clash + 1} posts ago: ${tags.join(' ')}`);

    history.unshift(tags);
    history.length = Math.min(history.length, config.content.hashtagHistory);
  }
});
