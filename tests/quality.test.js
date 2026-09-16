/**
 * The quality gate.
 *
 * Written after a post went out that passed every structural check in the
 * codebase and still meant nothing. The story was that Salesforce built a
 * reasoning model called Koa on Nvidia's Nemotron; the post mentioned none of
 * that, misdescribed Salesforce as a spreadsheet company, and closed on "This
 * should be interesting."
 *
 * Two things these tests care about, in order:
 *   the gate catches that post
 *   the gate does NOT catch the good one
 *
 * The second matters more. A gate that blocks decent work gets turned off.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { structuralProblems, assessDraft, FILLER_CLOSERS } from '../src/content-engine/quality.js';
import { POST_SHAPES, hasUsableQuote, hasMechanism, hasSequence } from '../src/content-engine/shapes.js';
import { createRotation } from '../src/lib/rotation.js';
import { config } from '../src/config/index.js';

/* --- the post that actually shipped --------------------------------------- */

const SALESFORCE = {
  article: {
    title: 'Salesforce and Nvidia’s new reasoning model is everything the AI labs should fear',
    summary: "Salesforce Koa is built on Nvidia's open-weight Nemotron model, trained for sales and support tasks.",
  },
  draft: {
    shape: 'quote-reaction',
    parts: { closer: 'This should be interesting.' },
    text: '"But reasoning has always been something that we’ve relied on the frontier model providers for." - Jayesh Govindarajan\n\nSalesforce just gave spreadsheets a reason to take over.\n\nThis should be interesting.',
  },
};

test('the post that shipped is caught before it costs anything', () => {
  const problems = structuralProblems(SALESFORCE);

  assert.ok(problems.length >= 2, `expected several problems, got: ${problems.join(' | ')}`);
  assert.ok(problems.some((p) => p.includes('says nothing')), 'the empty closer');
  assert.ok(problems.some((p) => p.includes('fragment')), 'the mid-sentence quote');
});

test('a good post is not caught by the free checks', () => {
  // The terminal-log post, which was genuinely fine.
  const problems = structuralProblems({
    article: { title: 'Microsoft’s new AI code of conduct tells models not to hack systems' },
    draft: {
      shape: 'terminal-log',
      parts: { closer: 'Bet you can’t find a flaw in toddler logic.' },
      text: "0 cyberattacks. Microsoft’s AI isn’t even allowed to be naughty.\n\n2026-09-14 WARNING: AI attempts to initiate hacking.\n2026-09-14 ERROR: Cyberattack forbidden: compliance breach.\n\nBet you can’t find a flaw in toddler logic.",
    },
  });

  assert.deepEqual(problems, [], `a good post must pass cleanly, got: ${problems.join(' | ')}`);
});

/* --- the individual free checks ------------------------------------------- */

test('every filler closer is recognised, punctuation and all', () => {
  for (const filler of FILLER_CLOSERS) {
    const problems = structuralProblems({
      article: { title: 'Acme Ships Thing' },
      draft: { parts: { closer: `${filler[0].toUpperCase()}${filler.slice(1)}.` }, text: `Acme did it.\n\n${filler}.` },
    });

    assert.ok(problems.some((p) => p.includes('says nothing')), `missed filler: ${filler}`);
  }
});

test('a real closer is left alone', () => {
  const problems = structuralProblems({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: { closer: 'Acme will regret this by Thursday.' }, text: 'Acme shipped it.\n\nAcme will regret this by Thursday.' },
  });

  assert.deepEqual(problems, []);
});

test('a post that mentions nothing from its story is caught', () => {
  const problems = structuralProblems({
    article: { title: 'Cloudflare Outage Took Down Half The Internet' },
    draft: { parts: {}, text: 'Something happened somewhere today.\n\nThat is how it goes.' },
  });

  assert.ok(problems.some((p) => p.includes('does not mention anything')));
});

test('a post that restates its own hook is caught', () => {
  const problems = structuralProblems({
    article: { title: 'OpenAI Buys Glass Imaging' },
    draft: {
      parts: {},
      text: 'OpenAI just spent 300 million dollars on a camera startup.\n\nOpenAI just spent 300 million dollars on a camera startup, apparently.',
    },
  });

  assert.ok(problems.some((p) => p.includes('restates its own hook')));
});

/* --- shape fit ------------------------------------------------------------ */

test('every shape can say whether a story suits it', () => {
  for (const [name, shape] of Object.entries(POST_SHAPES)) {
    assert.equal(typeof shape.fits, 'function', `${name} must declare fits()`);
  }
});

test('at least one shape always accepts, so a run can never stall', () => {
  const nothing = { title: 'A thing happened', summary: '' };

  const accepting = Object.values(POST_SHAPES).filter((shape) => shape.fits(nothing));
  assert.ok(accepting.length > 0, 'some shape must always be usable');
});

test('quote-reaction declines a story with no quote worth reacting to', () => {
  assert.equal(hasUsableQuote({ title: 'Salesforce and Nvidia ship a reasoning model', summary: '' }), false);

  // And declines a fragment starting on a conjunction, which is what shipped.
  assert.equal(
    hasUsableQuote({ summary: '"But reasoning has always been something we relied on providers for."' }),
    false,
    'a mid-sentence fragment is not a quote',
  );

  assert.equal(
    hasUsableQuote({ summary: '"We do not see this as a security risk at all," the CTO said.' }),
    true,
  );
});

test('terminal-log declines a story with no machine in it', () => {
  assert.equal(hasMechanism({ title: 'Investors raise a new fund for AI startups', summary: '' }), false);
  assert.equal(hasMechanism({ title: 'Cloudflare outage took down half the internet', summary: '' }), true);
});

test('receipts declines a story that is a single fact', () => {
  assert.equal(hasSequence({ title: 'Acme ships thing', summary: '' }), false);
  assert.equal(hasSequence({ title: 'OpenAI, Anthropic and Google talked for weeks', summary: '' }), true);
});

test('the rotation walks only the shapes a story can carry', async () => {
  const state = {};
  const store = {
    getState: async (key, fallback = null) => (key in state ? state[key] : fallback),
    setState: async (key, value) => { state[key] = value; },
    listPosts: async () => [],
  };

  const rotation = createRotation({ store });
  const noQuote = { title: 'Salesforce ships a reasoning model', summary: '' };

  for (let i = 0; i < 10; i += 1) {
    const picked = await rotation.next({
      key: 'shapeRotationIndex',
      names: config.content.postShapes,
      known: POST_SHAPES,
      accept: (name) => POST_SHAPES[name].fits(noQuote),
    });

    assert.notEqual(picked, 'quote-reaction', 'must never pick a shape the story cannot carry');
  }
});

/* --- the gates together ---------------------------------------------------- */

const neverCalled = {
  chatJson: async () => {
    throw new Error('the judge should not have been called');
  },
};

test('a structural failure does not pay for a judgement', async () => {
  const result = await assessDraft({
    ...SALESFORCE,
    llm: neverCalled,
    settings: { useLlmJudge: true, minScore: 3 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.score, null, 'no call was made');
});

test('the judge holds a post that scores below the floor', async () => {
  const llm = { chatJson: async () => ({ score: 2, verdict: 'vague', problems: ['says nothing'] }) };

  const result = await assessDraft({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: {}, text: 'Acme shipped a thing.\n\nIt is a thing.' },
    llm,
    settings: { useLlmJudge: true, minScore: 3 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.score, 2);
});

test('the judge passes a post that clears the floor', async () => {
  const llm = { chatJson: async () => ({ score: 4, verdict: 'sharp', problems: [] }) };

  const result = await assessDraft({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: {}, text: 'Acme shipped a thing.\n\nIt will break by Friday.' },
    llm,
    settings: { useLlmJudge: true, minScore: 3 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.score, 4);
});

test('a judge that cannot be reached does not block the run', async () => {
  const llm = { chatJson: async () => { throw new Error('rate limited'); } };

  const result = await assessDraft({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: {}, text: 'Acme shipped a thing.\n\nIt will break by Friday.' },
    llm,
    settings: { useLlmJudge: true, minScore: 3 },
  });

  assert.equal(result.ok, true, 'an unreachable judge must not stop everything');
  assert.match(result.verdict, /unavailable/);
});

test('the judge can be turned off without turning off the free checks', async () => {
  const off = { useLlmJudge: false, minScore: 3 };

  const good = await assessDraft({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: {}, text: 'Acme shipped a thing.\n\nIt will break by Friday.' },
    llm: neverCalled,
    settings: off,
  });

  const bad = await assessDraft({ ...SALESFORCE, llm: neverCalled, settings: off });

  assert.equal(good.ok, true);
  assert.equal(bad.ok, false, 'the free checks still run');
});
