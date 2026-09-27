/**
 * The content engine end to end, against a fake model that answers by call
 * label. What these pin down is the ORDER of decisions, because that is the
 * whole change: the story is read first, the format follows from it, the
 * hook is chosen before the body is written, and a story with nothing in it
 * is turned down before anything else is spent on it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentEngine, eligibleShapes, avoidRepeat } from '../src/content-engine/index.js';
import { createPipeline } from '../src/pipeline.js';
import { config } from '../src/config/index.js';

/** Rich enough to carry every shape: a quote, a machine, several names. */
const ARTICLE = {
  id: 'a1',
  title: 'OpenAI, Anthropic and Google ship an agent that runs shell commands in production',
  url: 'https://example.test/a1',
  summary: '"We do not consider this a security risk at all," the CTO said, weeks after the first outage.',
  body: 'The agent crashed twice in 14 days, then shipped anyway to 3,000 customers.',
  curation: { angle: 'shell access is a default now', frame: 'foot-gun' },
};

const INSIGHT = {
  whatHappened: 'Three labs shipped an agent with shell access after two crashes.',
  specifics: ['crashed twice in 14 days', '3,000 customers', '"We do not consider this a security risk at all"'],
  whyItMatters: 'Shell access is becoming a default rather than a decision.',
  surprising: 'They shipped after the crashes, not before.',
  whatDevsMiss: 'The crashes were in the sandbox that is supposed to make this safe.',
  insight: 'The OpenAI sandbox is the product now, and it failed twice in 14 days before launch.',
  tension: 'Crashes in a sandbox are the sandbox working.',
  shapes: [],
  substance: 4,
  substanceReason: 'A concrete failure and a real consequence.',
};

const GOOD_SCORES = { hook: 4, specificity: 4, insight: 4, accuracy: 5, voice: 4, coherence: 4 };

/**
 * A fake model that answers each call by its label, and records the calls.
 * Override any label's answer by passing a function or an object.
 */
function fakeLlm(overrides = {}) {
  const calls = [];

  const answers = {
    insight: () => INSIGHT,
    'write-hooks': () => ({
      hooks: [
        { text: 'The agent crashed twice in 14 days. Then it shipped to 3,000 customers.', style: 'number-drop' },
        { text: 'Looks like agents need a babysitter.', style: 'blunt-claim' },
        { text: 'OpenAI gave an agent a shell. In production. On purpose.', style: 'oh-no-observation' },
      ],
    }),
    'rate-hooks': () => ({ ratings: [{ index: 0, score: 5 }, { index: 1, score: 1 }, { index: 2, score: 3 }] }),
    'write-post': () => ({
      body: 'OpenAI says the crashes were inside the sandbox, the part that is meant to make shell access safe.',
      lines: ['The OpenAI crashes were inside the sandbox.', 'That is the safe part.'],
      closer: 'The sandbox is the product now.',
      punchline: 'OpenAI sold the sandbox as the product.',
      logLines: ['openai-sandbox: exit 137', 'openai-sandbox: exit 137'],
      reaction: 'Two OpenAI crashes in the safe part.',
      beats: ['two crashes in 14 days', 'shipped to 3,000 customers'],
      hashtags: ['#AIAgents', '#AppSec'],
      memeTopText: 'A',
      memeBottomText: 'B',
    }),
    'judge-post': () => ({ scores: GOOD_SCORES, verdict: 'Specific and makes a point.', problems: [] }),
    ...overrides,
  };

  return {
    calls,
    async chatJson(options) {
      calls.push(options);
      const answer = answers[options.label];
      if (answer === undefined) throw new Error(`unexpected call: ${options.label}`);
      return typeof answer === 'function' ? answer(options, calls) : answer;
    },
    async chat() {
      throw new Error('no plain chat calls expected');
    },
  };
}

/** Just enough store for the engine and the pipeline. */
function memoryStore({ posts = [], articles = [] } = {}) {
  const state = {};
  const byId = new Map(articles.map((article) => [article.id, { ...article }]));

  return {
    state,
    posts,
    driver: 'memory',
    async getState(key, fallback = null) { return key in state ? state[key] : fallback; },
    async setState(key, value) { state[key] = value; return value; },
    async listPosts(limit = 20) { return posts.slice(0, limit); },
    async listRecentAttempted(limit = 10) { return posts.slice(0, limit); },
    async listRecentPublished() { return []; },
    async savePost(post) { posts.unshift(post); },
    async updatePost() {},
    async getArticle(id) { return byId.get(id); },
    async updateArticle(id, patch) { byId.set(id, { ...byId.get(id), ...patch }); },
    async listPostableArticles() {
      return [...byId.values()].filter((article) => !article.usedInPostId && !article.rejectedForPost);
    },
    async isPaused() { return false; },
    async saveNewArticles() { return []; },
    async listArticles() { return [...byId.values()]; },
  };
}

const labels = (llm) => llm.calls.map((call) => call.label);

/* --- the order of decisions ------------------------------------------------ */

test('the story is read, then hooks are written and rated, then the body is written around one', async () => {
  const llm = fakeLlm();
  const engine = createContentEngine({ config, llm, store: memoryStore() });

  const draft = await engine.generate(ARTICLE);

  assert.deepEqual(labels(llm), ['insight', 'write-hooks', 'rate-hooks', 'write-post', 'judge-post']);
  assert.equal(draft.needsReview, false);
  assert.equal(draft.insight.insight, INSIGHT.insight, 'the point travels with the post for review');

  // The body prompt is given the hook that actually runs, and the point.
  const bodyPrompt = llm.calls.find((call) => call.label === 'write-post').user;
  assert.ok(bodyPrompt.includes(draft.hook), 'the body is written around the chosen first line');
  assert.ok(bodyPrompt.includes(INSIGHT.insight), 'and around the point of the post');
});

test('the best-rated, story-anchored hook wins, and the generic one never does', async () => {
  for (let i = 0; i < 5; i += 1) {
    const engine = createContentEngine({ config, llm: fakeLlm(), store: memoryStore() });
    const draft = await engine.generate(ARTICLE);

    assert.notEqual(draft.hook, 'Looks like agents need a babysitter.');
    assert.equal(draft.hook, 'The agent crashed twice in 14 days. Then it shipped to 3,000 customers.');
    assert.equal(draft.openingStyle, 'number-drop', 'the style comes from the winning candidate');
  }
});

test('the writer is shown the recent posts so it stops repeating them', async () => {
  const llm = fakeLlm();
  const store = memoryStore({ posts: [{ hook: 'Good luck, OpenAI.', text: 'Good luck, OpenAI.\n\nIrony in action.', shape: 'receipts' }] });

  await createContentEngine({ config, llm, store }).generate(ARTICLE);

  const hookPrompt = llm.calls.find((call) => call.label === 'write-hooks').user;
  assert.match(hookPrompt, /Good luck, OpenAI\./);
  assert.match(hookPrompt, /Irony in action\./);
});

/* --- thin stories ---------------------------------------------------------- */

test('a story with nothing to add is turned down before anything is written', async () => {
  const llm = fakeLlm({ insight: { ...INSIGHT, substance: 2, substanceReason: 'a press release with a logo on it' } });
  const store = memoryStore();

  const result = await createContentEngine({ config, llm, store }).generate(ARTICLE);

  assert.match(result.rejected, /substance 2\/5: a press release/);
  assert.deepEqual(labels(llm), ['insight'], 'no hooks, no body, no judge');
  assert.deepEqual(store.state, {}, 'no rotation moved for a post that was never written');
});

test('a story with no observation at all is turned down whatever it scores', async () => {
  const llm = fakeLlm({ insight: { ...INSIGHT, insight: '', substance: 4 } });
  const result = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.ok(result.rejected);
});

test('an insight that names nothing from the story gets one retry, then the story is turned down', async () => {
  // "Shell access is a default now" would fit under a dozen stories.
  const llm = fakeLlm({ insight: { ...INSIGHT, insight: 'Shell access is a default now, not a decision.', substance: 4 } });
  const result = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.deepEqual(labels(llm), ['insight', 'insight'], 'asked once more, then gave up');
  assert.match(llm.calls[1].user, /names nothing from this story/, 'the retry is told why');
  assert.match(result.rejected, /no story-specific point/);
});

test('an insight that the retry grounds in the story is used', async () => {
  let asked = 0;
  const llm = fakeLlm({
    insight: () => {
      asked += 1;
      return asked === 1 ? { ...INSIGHT, insight: 'Shell access is a default now.' } : INSIGHT;
    },
  });

  const draft = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);
  assert.equal(draft.insight.insight, INSIGHT.insight);
  assert.equal(draft.rejected, undefined);
});

test('an unreachable insight step does not stop the run', async () => {
  const llm = fakeLlm({ insight: () => { throw new Error('rate limited'); } });
  const draft = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.equal(draft.rejected, undefined);
  assert.ok(draft.text.length > 0, 'it falls back to the curator angle, as it always did');
  assert.equal(draft.insight, null);
});

/* --- story first, rotation second ----------------------------------------- */

test('the shapes the story suits are the only ones the rotation can reach', async () => {
  const llm = fakeLlm({ insight: { ...INSIGHT, shapes: ['terminal-log', 'slow-burn-rant'] } });
  const store = memoryStore();
  const engine = createContentEngine({ config, llm, store });

  const seen = new Set();
  for (let i = 0; i < 8; i += 1) {
    const draft = await engine.generate(ARTICLE);
    seen.add(draft.shape);
    store.posts.unshift({ shape: draft.shape, hook: `hook ${i}`, text: `hook ${i}\n\nend ${i}` });
  }

  assert.deepEqual([...seen].sort(), ['slow-burn-rant', 'terminal-log'], 'story fit decides who is eligible');
});

test('a suggested shape the story cannot physically carry is still declined', () => {
  // The insight step names quote-reaction, but there is no quote to lead with.
  const noQuote = { title: 'Acme ships a model', summary: 'It is faster.' };
  const eligible = eligibleShapes({ names: config.content.postShapes, article: noQuote, insight: { shapes: ['quote-reaction'] } });

  assert.ok(!eligible.includes('quote-reaction'));
  assert.ok(eligible.length > 0, 'falls back to what the story can carry, never to nothing');
});

test('two posts in a row never share a skeleton when the story allows another', () => {
  assert.equal(avoidRepeat('terminal-log', ['terminal-log', 'receipts'], 'terminal-log'), 'receipts');
  assert.equal(avoidRepeat('terminal-log', ['terminal-log'], 'terminal-log'), 'terminal-log', 'unless it is the only fit');
  assert.equal(avoidRepeat('receipts', ['terminal-log', 'receipts'], 'terminal-log'), 'receipts');
});

test('an ending that needs a disagreement only runs on a story that has one', async () => {
  const llm = fakeLlm({ insight: { ...INSIGHT, tension: '', shapes: ['classic-take'] } });
  const store = memoryStore();
  const engine = createContentEngine({ config, llm, store });

  for (let i = 0; i < 12; i += 1) {
    const draft = await engine.generate(ARTICLE);
    assert.ok(!['argument-bait', 'dare'].includes(draft.closerStyle), `got ${draft.closerStyle} with nothing to argue about`);
  }
});

test('every shape still builds a post through the new flow', async () => {
  for (const shape of config.content.postShapes) {
    const llm = fakeLlm({ insight: { ...INSIGHT, shapes: [shape] } });
    const draft = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

    assert.equal(draft.shape, shape);
    assert.ok(draft.text.startsWith(draft.hook), `${shape} leads with its hook`);
    assert.ok(draft.text.split('\n\n').length >= 2, `${shape} has a body`);
  }
});

/* --- the rewrite ----------------------------------------------------------- */

test('a rewrite keeps the format and the hook the judge had no problem with', async () => {
  let judged = 0;
  const llm = fakeLlm({
    'judge-post': () => {
      judged += 1;
      return judged === 1
        ? { scores: { ...GOOD_SCORES, insight: 2 }, summaryOnly: true, verdict: 'Only summarises.', problems: ['the body retells the article'] }
        : { scores: GOOD_SCORES, verdict: 'Better.', problems: [] };
    },
  });

  const draft = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.equal(draft.needsReview, false);
  assert.deepEqual(labels(llm), ['insight', 'write-hooks', 'rate-hooks', 'write-post', 'judge-post', 'write-post', 'judge-post'],
    'the hook was fine, so only the body is rewritten');

  const retry = llm.calls.filter((call) => call.label === 'write-post')[1].user;
  assert.match(retry, /the body retells the article/, 'the retry is told what was wrong');
  assert.match(retry, /insight 2\/5/, 'including which bar it missed');
});

test('a rewrite writes new hooks when the hook was the problem', async () => {
  let judged = 0;
  const llm = fakeLlm({
    'judge-post': () => {
      judged += 1;
      return { scores: { ...GOOD_SCORES, hook: judged === 1 ? 2 : 4 }, verdict: 'The hook is flat.', problems: ['the hook restates the headline'] };
    },
  });

  await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.equal(labels(llm).filter((label) => label === 'write-hooks').length, 2);
});

test('a post that fails twice is held, with the reason attached', async () => {
  const llm = fakeLlm({
    'judge-post': () => ({ scores: { ...GOOD_SCORES, specificity: 2 }, verdict: 'Rejected: vague, names no specifics.', problems: [] }),
  });

  const draft = await createContentEngine({ config, llm, store: memoryStore() }).generate(ARTICLE);

  assert.equal(draft.needsReview, true);
  assert.match(draft.quality.verdict, /vague/);
  assert.ok(draft.quality.problems.some((problem) => problem.startsWith('specificity 2/5')));
});

/* --- the pipeline uses a spare when a story is thin ------------------------- */

test('a thin story is skipped, marked, and the next pick is written instead', async () => {
  const thin = { ...ARTICLE, id: 'thin', title: 'Acme announces a partnership' };
  const rich = { ...ARTICLE, id: 'rich' };
  const store = memoryStore({ articles: [thin, rich] });

  const llm = fakeLlm({
    insight: (options) => (options.user.includes('Acme announces')
      ? { ...INSIGHT, substance: 1, substanceReason: 'a press release' }
      : INSIGHT),
  });

  let asked = 0;
  const agent = {
    config,
    store,
    scraper: { scrape: async () => [], enrich: async (articles) => articles },
    classifier: { classifyAll: async () => [] },
    curator: { curate: async (candidates, count) => { asked = count; return [thin, rich].slice(0, count); } },
    contentEngine: createContentEngine({ config, llm, store }),
    humanizer: { humanize: async (text) => ({ text, report: {} }) },
    memeGenerator: { nextTreatment: async () => 'text-only', render: async () => null },
    publisher: { publish: async () => ({ dryRun: true }) },
    analytics: { refreshMetrics: async () => 0, summarize: async () => null },
  };

  const pipeline = createPipeline(agent);
  const result = await pipeline.run({ count: 1, publish: false });

  assert.equal(asked, 1 + config.content.insight.spareStories, 'spares are ranked as well');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].articleId, 'rich', 'the spare stood in');
  assert.equal(result.rejected[0].title, thin.title);
  assert.match(result.rejected[0].reason, /press release/);

  const postable = await store.listPostableArticles({ maxAgeDays: 7 });
  assert.ok(!postable.some((article) => article.id === 'thin'), 'a turned-down story is not offered again');
});

test('a post held after its rewrite hands the slot to the next pick', async () => {
  const weak = { ...ARTICLE, id: 'weak', title: 'OpenAI ships a partnership announcement' };
  const strong = { ...ARTICLE, id: 'strong' };
  const store = memoryStore({ articles: [weak, strong] });

  const llm = fakeLlm({
    // Its own first lines, or the second post is rightly held for opening
    // the same way as the first.
    'write-hooks': (options) => (options.user.includes('partnership announcement')
      ? { hooks: [{ text: 'OpenAI announced a partnership with 3,000 customers watching.', style: 'blunt-claim' }] }
      : { hooks: [{ text: 'The agent crashed twice in 14 days. Then it shipped to 3,000 customers.', style: 'number-drop' }] }),
    'judge-post': (options) => (options.user.includes('partnership announcement')
      ? { scores: { ...GOOD_SCORES, insight: 2 }, summaryOnly: true, verdict: 'Rejected: only summarises the announcement.' }
      : { scores: GOOD_SCORES, verdict: 'Specific.' }),
  });

  const agent = {
    config,
    store,
    scraper: { scrape: async () => [], enrich: async (articles) => articles },
    classifier: { classifyAll: async () => [] },
    curator: { curate: async (candidates, count) => [weak, strong].slice(0, count) },
    contentEngine: createContentEngine({ config, llm, store }),
    humanizer: { humanize: async (text) => ({ text, report: {} }) },
    memeGenerator: { nextTreatment: async () => 'text-only', render: async () => null },
    publisher: { publish: async () => ({ dryRun: true }) },
    analytics: { refreshMetrics: async () => 0, summarize: async () => null },
  };

  const result = await createPipeline(agent).run({ count: 1, publish: false });

  const statuses = result.posts.map((post) => `${post.articleId}:${post.status}`);
  assert.deepEqual(statuses, ['weak:held', 'strong:draft'], 'the held one is kept for review, the next one is written');
  assert.match(result.rejected[0].reason, /written and held: Rejected: only summarises/);

  const postable = await store.listPostableArticles({ maxAgeDays: 7 });
  assert.ok(!postable.some((article) => article.id === 'weak'), 'a story that failed twice is not offered again');
});

test('the judging calls use the review model when one is set, and only those', async () => {
  const llm = fakeLlm();
  const reviewed = { ...config, content: { ...config.content, reviewModel: 'a-bigger-model' } };

  await createContentEngine({ config: reviewed, llm, store: memoryStore() }).generate(ARTICLE);

  const byLabel = Object.fromEntries(llm.calls.map((call) => [call.label, call.model]));
  assert.equal(byLabel.insight, 'a-bigger-model');
  assert.equal(byLabel['rate-hooks'], 'a-bigger-model');
  assert.equal(byLabel['judge-post'], 'a-bigger-model');
  assert.equal(byLabel['write-hooks'], undefined, 'the writer keeps the default model');
  assert.equal(byLabel['write-post'], undefined);
});

test('an editor pass that breaks a checked post is reverted to the checked version', async () => {
  const store = memoryStore({ articles: [ARTICLE] });
  const llm = fakeLlm();

  const agent = {
    config,
    store,
    scraper: { scrape: async () => [], enrich: async (articles) => articles },
    classifier: { classifyAll: async () => [] },
    curator: { curate: async () => [ARTICLE] },
    contentEngine: createContentEngine({ config, llm, store }),
    // The editor "improves" the post by narrating it and asking twice.
    humanizer: { humanize: async (text) => ({ text: `${text.split('\n\n')[0]}\n\nThis shows OpenAI is serious?\n\nIs it though?`, report: { editorPass: true } }) },
    memeGenerator: { nextTreatment: async () => 'text-only', render: async () => null },
    publisher: { publish: async () => ({ dryRun: true }) },
    analytics: { refreshMetrics: async () => 0, summarize: async () => null },
  };

  const result = await createPipeline(agent).run({ count: 1, publish: false });
  const [post] = result.posts;

  assert.doesNotMatch(post.text, /This shows OpenAI is serious/);
  assert.equal(post.humanizerReport.editorPass, 'reverted');
  assert.ok(post.humanizerReport.editorIntroduced.length > 0, 'and it says what the editor broke');
});
