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

import { structuralProblems, assessDraft, inventedNumbers, FILLER_CLOSERS } from '../src/content-engine/quality.js';
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

test('a judge that cannot be reached holds the post instead of passing it', async () => {
  const llm = { chatJson: async () => { throw new Error('rate limited'); } };

  const result = await assessDraft({
    article: { title: 'Acme Ships Thing' },
    draft: { parts: {}, text: 'Acme shipped a thing.\n\nIt will break by Friday.' },
    llm,
    settings: { useLlmJudge: true, minScore: 3 },
  });

  assert.equal(result.ok, false, 'an unreviewed post never goes out');
  assert.equal(result.judgeUnavailable, true, 'and the caller can tell it was the judge, not the post');
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

/* --- the new free checks, on posts that were really written --------------- */

const POCKET_FM = {
  title: 'India’s Pocket FM doubles revenue run rate to $500M as AI powers 93% of audio content',
  summary: 'AI powers 93% of the catalog and 99% of new content.',
  body: 'The company makes content 80x cheaper and publishes 100 hours a day.',
};

test('numbers the story never gave are caught', () => {
  // The real terminal-log post was dated 2023 for a 2026 story. The 99% in it
  // was real (the story gives both 93% and 99%); a rounded 90% would not be.
  const problems = structuralProblems({
    article: POCKET_FM,
    draft: {
      parts: { closer: 'Creativity is not measured in dollars.' },
      text: 'Pocket FM fuels growth with AI.\n\n[DEBUG] 2023-09-10 12:45:20 - AI models: 99% of new content.\n[INFO] Revenue run rate = $500M, 90% AI\n\nCreativity is not measured in dollars.',
    },
  });

  const numbers = problems.find((p) => p.includes('not in the story'));
  assert.ok(numbers, `expected an invented-number problem, got: ${problems.join(' | ')}`);
  assert.match(numbers, /2023/);
  assert.match(numbers, /90%/);
  assert.doesNotMatch(numbers, /99%/, 'a number the story gave is fine');
  assert.doesNotMatch(numbers, /\$500M/, 'in any spelling');
});

test('the same number in different spellings is not invented', () => {
  const invented = inventedNumbers('400k listeners, $0.5 billion, 80x cheaper, 93%', {
    title: 'x', summary: 'It has 400,000 listeners.', body: 'Worth 0.5 billion, 80x cheaper, 93% AI.',
  });

  assert.deepEqual(invented, []);
});

test('a filler ending is caught however the shape ended', () => {
  // The rant ended on a line field, not a "closer", so the old check never saw it.
  for (const text of [
    'Agents are now tattling.\n\nGood luck keeping anything private.',
    'OpenAI bought a camera company.\n\nNext step? Good luck with that.',
    'Relay shut down.\n\nWelcome to the future.',
    'Pocket FM is 93% AI.\n\nThis is the direction we\'re headed.',
  ]) {
    const problems = structuralProblems({ article: { title: 'Acme Ships Thing' }, draft: { parts: {}, text } });
    assert.ok(problems.some((p) => p.includes('says nothing')), `missed the ending of: ${text}`);
  }
});

test('a line cut in half is caught', () => {
  // Shipped exactly like this: one sentence split across two paragraphs.
  const problems = structuralProblems({
    article: { title: 'Microsoft’s new AI code of conduct' },
    draft: { parts: {}, text: 'Microsoft wrote an AI code of conduct.\n\nMicrosoft\'s new AI code of conduct is just a\n\n‘please don’t break things’ guide.' },
  });

  assert.ok(problems.some((p) => p.includes('cut off mid-sentence')));
});

test('a post that keeps asking questions is caught', () => {
  const problems = structuralProblems({
    article: { title: 'Microsoft’s new AI code of conduct' },
    draft: { parts: {}, text: 'Writing a Microsoft AI code of conduct?\n\nCan we really trust these models?\n\nAI will do what it wants.' },
  });

  assert.ok(problems.some((p) => p.includes('questions in one post')));
});

test('a generic hook is caught before the judge is paid', () => {
  const problems = structuralProblems({
    article: { title: 'Early Anthropic hire raises $40M to rein in rogue AI agents' },
    draft: { hook: 'Looks like we need a timeout for rogue AIs.', parts: {}, text: 'Looks like we need a timeout for rogue AIs.\n\nAnthropic alumni want a babysitter job.' },
  });

  assert.ok(problems.some((p) => p.includes('hook is generic')));
});

test('opening or ending the way a recent post did is caught', () => {
  const recent = [{ hook: 'OpenAI just spent $300M on cameras.', ending: 'Irony in action.' }];

  const sameStart = structuralProblems({
    article: { title: 'OpenAI Buys Glass Imaging' },
    draft: { hook: 'OpenAI just spent another fortune.', parts: {}, text: 'OpenAI just spent another fortune.\n\nThis time on OpenAI hardware.' },
    recent,
  });

  assert.ok(sameStart.some((p) => p.includes('opens the same way')));
});

test('the good post still passes every new check', () => {
  // The calibration that matters most: a gate that blocks decent work gets
  // switched off. This is the terminal-log post from above, with its story.
  const problems = structuralProblems({
    article: {
      title: 'Microsoft’s new AI code of conduct tells models not to hack systems',
      summary: 'Absolute constraints forbid cyberattacks.',
      body: 'Each model has a code of conduct that overrides user preferences.',
    },
    draft: {
      shape: 'terminal-log',
      hook: '0 cyberattacks. Microsoft’s AI isn’t even allowed to be naughty.',
      parts: { closer: 'Bet you can’t find a flaw in toddler logic.' },
      text: "0 cyberattacks. Microsoft’s AI isn’t even allowed to be naughty.\n\n12:04:11 WARNING: AI attempts to initiate hacking.\n12:04:12 ERROR: Cyberattack forbidden: compliance breach.\n\nBet you can’t find a flaw in toddler logic.",
    },
    recent: [{ hook: 'Salesforce built a model for sales.', ending: 'Nobody asked.' }],
  });

  assert.deepEqual(problems, []);
});

/* --- the judge says why, and every critical dimension counts --------------- */

const PASSABLE = { parts: {}, text: 'Acme shipped a thing.\n\nIt will break by Friday.' };
const ACME = { title: 'Acme Ships Thing' };
const SETTINGS = { useLlmJudge: true, minScore: 3, minDimension: 3 };

test('a well-written summary is held, however good the average', async () => {
  // Reads fine, gets its facts right, says nothing new. The old two-question
  // judge had no way to hold this.
  const llm = {
    chatJson: async () => ({
      scores: { hook: 4, specificity: 4, insight: 2, accuracy: 5, voice: 4, coherence: 4 },
      summaryOnly: true,
      verdict: 'Rejected because the body only summarises the announcement. There is no observation of its own.',
      problems: ['"Meta launched WhatsApp Business Tools MCP server." restates the headline'],
    }),
  };

  const result = await assessDraft({ article: ACME, draft: PASSABLE, llm, settings: SETTINGS });

  assert.equal(result.ok, false, `average ${result.score} must not carry a 2 on insight`);
  assert.ok(result.score >= 3, 'the average alone would have passed it');
  assert.match(result.verdict, /summarises/, 'the verdict explains the decision');
  assert.ok(result.problems.some((p) => p.startsWith('insight 2/5')), 'the rewrite is told which bar it missed');
  assert.ok(result.problems.some((p) => p.includes('only summarises')));
  assert.ok(result.problems.some((p) => p.includes('restates the headline')), 'and the judge\'s own words come first');
});

test('an invented fact holds a post on its own', async () => {
  const llm = {
    chatJson: async () => ({
      scores: { hook: 5, specificity: 5, insight: 4, accuracy: 1, voice: 5, coherence: 5 },
      verdict: 'Rejected: the post says 90% and the story says 93%.',
      problems: [],
    }),
  };

  const result = await assessDraft({ article: ACME, draft: PASSABLE, llm, settings: SETTINGS });

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.startsWith('accuracy 1/5')));
});

test('a post that clears every bar passes, with its scores kept', async () => {
  const llm = {
    chatJson: async () => ({
      scores: { hook: 4, specificity: 4, insight: 4, accuracy: 5, voice: 3, coherence: 4 },
      verdict: 'Specific and makes a point the headline does not.',
      problems: [],
    }),
  };

  const result = await assessDraft({ article: ACME, draft: PASSABLE, llm, settings: SETTINGS });

  assert.equal(result.ok, true);
  assert.equal(result.scores.insight, 4);
  assert.equal(result.score, 4);
});

test('a weak voice alone does not hold a post', async () => {
  // Voice is scored and reported, but only the critical four can sink a post
  // by themselves; a plain-sounding post that says something should run.
  const llm = { chatJson: async () => ({ scores: { hook: 4, specificity: 4, insight: 4, accuracy: 4, voice: 2, coherence: 4 }, verdict: 'plain', problems: [] }) };

  const result = await assessDraft({ article: ACME, draft: PASSABLE, llm, settings: SETTINGS });
  assert.equal(result.ok, true);
});

test('the judge is shown the article and the point, not only the headline', async () => {
  let prompt = '';
  const llm = { chatJson: async ({ user }) => { prompt = user; return { scores: { hook: 4, specificity: 4, insight: 4, accuracy: 4, voice: 4, coherence: 4 } }; } };

  await assessDraft({
    article: { title: 'Acme Ships Thing', summary: 's', body: 'THE FULL ARTICLE BODY' },
    draft: PASSABLE,
    llm,
    settings: SETTINGS,
    insight: { insight: 'THE POINT OF THE POST' },
  });

  assert.match(prompt, /THE FULL ARTICLE BODY/, 'accuracy cannot be judged without the source');
  assert.match(prompt, /THE POINT OF THE POST/);
});

test('the analyst-report voice is caught, but one stray "shows" is not', () => {
  const report = structuralProblems({
    article: { title: 'Superhuman acquires Fathom' },
    draft: { parts: {}, text: 'Superhuman bought Fathom.\n\nThis shows how tough productivity tools are, and it highlights the challenges startups face in a crowded market.' },
  });
  assert.ok(report.some((p) => p.includes('analyst report')));

  const fine = structuralProblems({
    article: { title: 'Superhuman acquires Fathom' },
    draft: { parts: {}, text: 'Superhuman bought Fathom.\n\nThe log shows 1 million meetings and zero notes anyone reread.' },
  });
  assert.ok(!fine.some((p) => p.includes('analyst report')));
});

test('a hook the judge says would fit any story holds the post', async () => {
  const llm = { chatJson: async () => ({ scores: { hook: 3, specificity: 4, insight: 4, accuracy: 5, voice: 4, coherence: 4 }, genericHook: true, verdict: 'The hook could sit on any AI story.' }) };

  const result = await assessDraft({ article: ACME, draft: PASSABLE, llm, settings: SETTINGS });
  assert.equal(result.ok, false, 'the score said 3, the yes-or-no said generic');
  assert.ok(result.problems.some((p) => p.includes('different story')));
});

test('filler lines only count when they are really in the post', async () => {
  const quoting = (fillerLines) => ({ chatJson: async () => ({ scores: { hook: 4, specificity: 4, insight: 4, accuracy: 5, voice: 4, coherence: 4 }, fillerLines }) });

  const real = await assessDraft({ article: ACME, draft: PASSABLE, llm: quoting(['Acme shipped a thing.', 'It will break by Friday.']), settings: SETTINGS });
  assert.equal(real.ok, false, 'two real filler lines is padding');

  const imagined = await assessDraft({ article: ACME, draft: PASSABLE, llm: quoting(['A line that is not there.', 'Nor is this one.']), settings: SETTINGS });
  assert.equal(imagined.ok, true, 'a judge quoting lines that do not exist cannot hold a post');
});

test('"seven in 10" in the story makes 70% a real number, not an invented one', () => {
  const invented = inventedNumbers('70% of Americans oppose new data centers. Half of them loudly: 50%.', {
    title: 'Huang takes a call', summary: 'x', body: 'Recent Gallup polling shows that seven in 10 Americans oppose the construction, and half say so.',
  });

  assert.deepEqual(invented, []);
});

test('a reaction that narrates the point is caught, a real reaction is not', () => {
  const narrated = structuralProblems({
    article: { title: 'Microsoft code of conduct' },
    draft: { parts: {}, text: '"Absolute constraints forbid cyberattacks." - Microsoft\n\nThis highlights Microsoft\'s commitment to safety.' },
  });
  assert.ok(narrated.some((p) => p.includes('narrates the point')));

  const answered = structuralProblems({
    article: { title: 'Microsoft code of conduct' },
    draft: { parts: {}, text: '"Absolute constraints forbid cyberattacks." - Microsoft\n\nMicrosoft just wrote the one rule every model already had.' },
  });
  assert.ok(!answered.some((p) => p.includes('narrates the point')));
});
