/**
 * Regressions from the second review: posts that were specific and accurate
 * and still had no reason to exist. Most of these are the six real posts from
 * that run, verbatim. Each failure mode is pinned twice where it can be: once
 * by the free checks, which cost nothing, and once by the judge's rules, so a
 * model that notices the problem can hold the post even when no regex does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { structuralProblems, pointProblems, assessDraft, judgementFailures } from '../src/content-engine/quality.js';
import { pointFailures, normalizeInsight, extractInsight, quoteIsInArticle } from '../src/content-engine/insight.js';
import { config } from '../src/config/index.js';

const SETTINGS = { useLlmJudge: true, minScore: 3, minDimension: 3 };
const GOOD = { hook: 4, specificity: 4, insight: 4, accuracy: 5, voice: 4, coherence: 4, point: 4, implication: 4, informationValue: 4, nonGeneric: 4, evidence: 4 };
const judgeSays = (extra) => ({ chatJson: async () => ({ scores: GOOD, verdict: 'x', problems: [], ...extra }) });
const has = (problems, text) => problems.some((problem) => problem.includes(text));

const QUALCOMM = {
  title: 'Qualcomm launches two new smartphone chips with emphasis on AI',
  summary: 'The Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-parameter model locally.',
  body: 'The Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-parameter model locally, with a new accelerator.',
};
const MUSE_DOWNLOADS = {
  title: 'Meta’s Muse is outpacing ChatGPT’s early mobile launch',
  summary: 'In 12 days Muse had 1.8 million downloads.',
  body: 'Muse racked up 1.8 million downloads in 12 days, compared with 1.3 million for ChatGPT. Muse launched on iOS and Android.',
};
const SHIPT = { title: 'Shipt adds an AI shopping assistant', summary: 'Ask Shipt builds carts.', body: 'Ask Shipt builds a cart from a prompt.' };

/* 1. Generic implication ---------------------------------------------------- */

test('1. a specific fact followed by a generic implication is caught', () => {
  const problems = structuralProblems({
    article: QUALCOMM,
    draft: { parts: {}, text: 'Qualcomm’s Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-parameter model locally. Mobile developers gotta rethink AI integrations now.' },
  });

  assert.ok(has(problems, 'generic conclusion'), problems.join(' | '));
});

/* 2. No clear point --------------------------------------------------------- */

test('2. a post the judge cannot sum up in one sentence is held', async () => {
  const result = await assessDraft({ article: QUALCOMM, draft: { parts: {}, text: 'Qualcomm has a chip.\n\nIt runs a 30-billion-parameter model.' }, llm: judgeSays({ thesis: '' }), settings: SETTINGS });

  assert.equal(result.ok, false);
  assert.ok(has(result.problems, 'this post argues that'));
});

test('2b. a point that is not there stops the story before anything is written', () => {
  const insight = normalizeInsight({ point: '', keyEvidence: [] }, undefined, QUALCOMM);
  assert.deepEqual(pointFailures(insight, QUALCOMM), ['there is no point to make beyond the headline']);
});

/* 3. Unsupported causal claim ----------------------------------------------- */

test('3. a cause the story never establishes is caught, a hedged one is not', () => {
  const stated = pointProblems({ text: "Muse's growth links directly to being on both iOS and Android.", article: MUSE_DOWNLOADS });
  assert.ok(has(stated, 'states a cause as fact'));

  const hedged = pointProblems({ text: 'Muse launched on iOS and Android at once, which may explain part of the gap.', article: MUSE_DOWNLOADS });
  assert.ok(!has(hedged, 'states a cause'), 'honest interpretation is allowed');
});

test('3b. the judge can hold interpretation stated as fact', async () => {
  const text = 'Muse got 1.8 million downloads.\n\nPeople clearly prefer Meta now.';
  const result = await assessDraft({ article: MUSE_DOWNLOADS, draft: { parts: {}, text }, llm: judgeSays({ unsupportedClaims: ['People clearly prefer Meta now.'] }), settings: SETTINGS });

  assert.equal(result.ok, false);
  assert.ok(has(result.problems, 'states interpretation as fact'));
});

/* 4. Manufactured rivalry --------------------------------------------------- */

test('4. a rivalry the story never describes is caught', () => {
  const problems = pointProblems({ text: 'Shipt is in a battle with Instacart now.', article: SHIPT });
  assert.ok(has(problems, 'frames a competition'));
});

test('4b. a comparison the story itself makes is allowed', () => {
  // Muse vs ChatGPT is the story's own framing, so saying it is honest.
  const problems = pointProblems({ text: 'Muse is outpacing ChatGPT: 1.8 million downloads to 1.3 million.', article: MUSE_DOWNLOADS });
  assert.ok(!has(problems, 'frames a competition'));
});

test('4c. the judge holds an invented framing even when the rivals are real', async () => {
  // The source did call Instinct and Muse rivals. "Speed versus flexibility"
  // was the part the post made up.
  const text = "Instinct raised $350 million.\n\nIs Instinct's speed enough to outpace Muse's flexibility?";
  const result = await assessDraft({
    article: { title: 'Rival AI agents Instinct and Muse add calls', summary: 'Instinct raised $350 million.', body: 'Instinct raised $350 million. Both rivals add calling.' },
    draft: { parts: {}, text },
    llm: judgeSays({ manufacturedNarrative: ["Is Instinct's speed enough to outpace Muse's flexibility?"] }),
    settings: SETTINGS,
  });

  assert.equal(result.ok, false);
  assert.ok(has(result.problems, 'invents a narrative'));
});

/* 5. Empty emotional reaction ---------------------------------------------- */

test('5. an empty reaction is caught, curly apostrophe and all', () => {
  const problems = pointProblems({ text: 'Meta’s Muse just dropped on Mac, and it doesn’t need a traditional UI for control. That’s creepy.', article: { title: 'Muse hits Mac' } });
  assert.ok(has(problems, 'empty reaction'));
});

test('5b. the same word carrying information is not a reaction', () => {
  // The rule is "deleting it loses nothing", not "never say creepy".
  const problems = pointProblems({ text: 'Muse asks permission before touching mail, which is less creepy than it sounds: 3 prompts per action.', article: { title: 'Muse hits Mac' } });
  assert.ok(!has(problems, 'empty reaction'));
});

/* 6. Story-independent conclusion ------------------------------------------- */

test('6. a conclusion that survives a name swap holds the post', async () => {
  const result = await assessDraft({ article: QUALCOMM, draft: { parts: {}, text: 'Qualcomm shipped a chip.\n\nThe 30-billion-parameter number stands out.' }, llm: judgeSays({ survivesNameSwap: true }), settings: SETTINGS });

  assert.equal(result.ok, false);
  assert.ok(has(result.problems, 'different company swapped in'));
});

test('6b. a point that survives a name swap stops the story at the insight step', () => {
  const insight = normalizeInsight({
    point: 'Qualcomm is making on-device AI a real option for the 30-billion-parameter class.',
    keyEvidence: [{ fact: 'runs a 30-billion-parameter model locally', quote: 'can run a 30-billion-parameter model locally' }],
    soWhat: { sameForAnotherStory: 'MediaTek is making on-device AI a real option.', stillMakesSense: true },
  }, undefined, QUALCOMM);

  assert.ok(pointFailures(insight, QUALCOMM).some((failure) => failure.includes('survives a name swap')));
});

/* 7. Fake personal experience ---------------------------------------------- */

test('7. an invented personal experience is caught, an opinion is not', () => {
  for (const line of ['I spent three weeks building a notetaker.', 'I learned this the hard way.', "I've been testing Muse all week.", 'When I built my first agent, it broke.']) {
    assert.ok(has(pointProblems({ text: line, article: { title: 'x' } }), 'personal experience'), line);
  }

  assert.ok(!has(pointProblems({ text: 'I bet Muse ships voice calling first.', article: { title: 'x' } }), 'personal experience'));
});

test('7b. an experience the author actually provided is allowed', () => {
  const authorContext = 'I built a meeting notetaker at my last job and it took three months.';
  const problems = pointProblems({ text: 'I built a meeting notetaker once, three months of edge cases.', article: { title: 'x' }, authorContext });

  assert.ok(!has(problems, 'personal experience'));
});

test('7c. the opening style can no longer be called "fake-confession"', () => {
  assert.ok(!config.content.openingStyles.includes('fake-confession'));
  assert.ok(config.content.openingStyles.includes('uncomfortable-truth'));
});

/* 8. Fact-heavy post with no insight ---------------------------------------- */

test('8. facts in a row with no insight are held as "specific but no takeaway"', () => {
  const failures = judgementFailures({ score: 3.6, scores: { ...GOOD, point: 2, informationValue: 2 } }, SETTINGS);
  assert.ok(failures[0].includes('specific, but it has no meaningful takeaway'), failures.join(' | '));
});

/* 9. Hook/body mismatch ----------------------------------------------------- */

test('9. a hook that does not set up the point holds the post', async () => {
  // "Building in a vacuum?" over download numbers was the real one.
  const result = await assessDraft({ article: MUSE_DOWNLOADS, draft: { parts: {}, text: 'Building in a vacuum?\n\nMuse got 1.8 million downloads in 12 days.' }, llm: judgeSays({ hookMatchesPoint: false }), settings: SETTINGS });

  assert.equal(result.ok, false);
  assert.ok(has(result.problems, 'does not set up the point'));
});

/* 10. Accurate but boring --------------------------------------------------- */

test('10. accurate but boring is a reason to hold, in those words', () => {
  const failures = judgementFailures({ score: 3.7, scores: { ...GOOD, informationValue: 2 } }, SETTINGS);
  assert.ok(failures[0].startsWith('accurate but boring'));
});

test('10b. "facts correct, conclusion generic" is named too', () => {
  const failures = judgementFailures({ score: 3.8, scores: { ...GOOD, nonGeneric: 2 } }, SETTINGS);
  assert.equal(failures[0], 'the facts are correct, but the conclusion is generic');
});

/* 11. Multiple unrelated ideas ---------------------------------------------- */

test('11. several unrelated ideas hold the post', () => {
  const failures = judgementFailures({ score: 4, scores: GOOD, multipleIdeas: true }, SETTINGS);
  assert.ok(failures.some((failure) => failure.includes('several unrelated ideas')));
});

/* 12. Generic industry conclusion ------------------------------------------- */

test('12. a generic industry conclusion is caught in the post and in the point', () => {
  assert.ok(has(pointProblems({ text: 'Half the cost and better accuracy could really change the game in AI dev tools.', article: QUALCOMM }), 'generic conclusion'));
  assert.ok(has(pointProblems({ text: 'The competition’s really heating up.', article: SHIPT }), 'generic conclusion'));

  const insight = normalizeInsight({ point: 'Qualcomm is reshaping the industry.', keyEvidence: ['can run a 30-billion-parameter model locally'] }, undefined, QUALCOMM);
  assert.ok(pointFailures(insight, QUALCOMM).some((failure) => failure.includes('generic conclusion')));
});

test('12b. a generic thesis holds the post even when the scores look fine', () => {
  const failures = judgementFailures({ score: 4, scores: GOOD, thesis: 'this could change how developers build AI apps' }, SETTINGS);
  assert.ok(failures.some((failure) => failure.includes("argument is generic")));
});

/* --- evidence has to be in the article ------------------------------------- */

test('evidence the article does not contain is dropped before anything rests on it', () => {
  assert.ok(quoteIsInArticle('can run a 30-billion-parameter model locally', QUALCOMM));
  assert.ok(!quoteIsInArticle('Qualcomm expects 40% of apps to go on-device by 2027', QUALCOMM));

  const insight = normalizeInsight({
    point: 'The Qualcomm chip moves inference cost to the device.',
    keyEvidence: [{ fact: '40% of apps on-device', quote: 'Qualcomm expects 40% of apps to go on-device by 2027' }],
  }, undefined, QUALCOMM);

  assert.equal(insight.keyEvidence.length, 0);
  assert.deepEqual(insight.unverifiedEvidence, ['40% of apps on-device']);
  assert.ok(pointFailures(insight, QUALCOMM).some((failure) => failure.includes('rests on nothing')));
});

test('a story with no defensible point is turned down after one retry', async () => {
  const llm = {
    calls: 0,
    async chatJson() {
      this.calls += 1;
      return { point: 'Developers need to rethink AI integrations.', keyEvidence: ['can run a 30-billion-parameter model locally'], substance: 4 };
    },
  };

  const { rejected } = await extractInsight({ article: QUALCOMM, llm, settings: { enabled: true, minSubstance: 3 }, shapeNames: config.content.postShapes });

  assert.equal(llm.calls, 2, 'told why, asked once more');
  assert.match(rejected, /no story-specific point/);
});

/* --- and a good post still passes ----------------------------------------- */

test('a post with a story-specific point, honest about what is inference, passes the free checks', () => {
  const problems = structuralProblems({
    article: QUALCOMM,
    draft: {
      hook: 'The Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-parameter model locally.',
      parts: { closer: 'The cost of an AI feature may move from your inference bill to the battery.' },
      text: 'The Snapdragon 8 Elite Extreme Gen 6 can run a 30-billion-parameter model locally.\n\nThat is the size class most teams send to a cloud endpoint today.\n\nThe cost of an AI feature may move from your inference bill to the battery.',
    },
  });

  assert.deepEqual(problems, []);
});

test('a retry that only sends back a new point keeps the evidence from the first answer', async () => {
  let calls = 0;
  const llm = {
    async chatJson() {
      calls += 1;
      return calls === 1
        ? { point: 'Developers need to rethink AI integrations.', keyEvidence: [{ fact: '30B locally', quote: 'can run a 30-billion-parameter model locally' }], substance: 4 }
        : { point: 'A 30-billion-parameter model on the Snapdragon 8 Elite Extreme Gen 6 moves inference cost from the developer to the device.' };
    },
  };

  const { insight, rejected } = await extractInsight({ article: QUALCOMM, llm, settings: { enabled: true, minSubstance: 3 }, shapeNames: config.content.postShapes });

  assert.equal(rejected, null, rejected);
  assert.equal(insight.keyEvidence.length, 1, 'the evidence survived the retry');
});

test('a "swap test" that did not actually swap the names is not counted', () => {
  const point = 'The Snapdragon 8 Elite Extreme Gen 6 running a 30-billion-parameter model locally moves inference cost to the device.';
  const insight = normalizeInsight({
    point,
    keyEvidence: [{ fact: '30B locally', quote: 'can run a 30-billion-parameter model locally' }],
    soWhat: { sameForAnotherStory: point, stillMakesSense: true },
  }, undefined, QUALCOMM);

  assert.deepEqual(pointFailures(insight, QUALCOMM), []);
});

/* --- the misses from the first dry run of this version ----------------------- */

const SOL = {
  title: 'OpenAI launches GPT-6 Sol and Luna, boasting lower cost and fewer mistakes',
  summary: 'Sol and Luna cost half as much as the 5.6 series.',
  body: 'OpenAI says the Sol and Luna models are available at half the cost of the 5.6 series and make about half as many mistakes.',
};

test('several claims that would fit under any AI story hold the post', () => {
  const problems = pointProblems({
    text: 'OpenAI says Sol makes half the mistakes of GPT-5.\n\nThis could open doors for cost-sensitive projects.\n\nQuality benchmarking matters.\n\nWe will see shifts in developer preferences.',
    article: SOL,
  });

  assert.ok(has(problems, 'would fit under any AI story'), problems.join(' | '));
});

test('one plain-words conclusion is allowed, and so are claims made from the story', () => {
  const problems = pointProblems({
    text: 'Sol and Luna cost half as much as the 5.6 series.\n\nAt half the cost, the 5.6 series may stop being the default choice for batch jobs.',
    article: SOL,
  });

  assert.ok(!has(problems, 'would fit under any AI story'), problems.join(' | '));
});

test('"should rethink", "proving" and "flip the script" are caught too', () => {
  assert.ok(has(pointProblems({ text: 'Developers should rethink how apps work with AI.', article: SOL }), 'generic conclusion'));
  assert.ok(has(pointProblems({ text: 'Instinct and Muse now handle calls, proving that user demands can flip the script.', article: SOL }), 'states a cause as fact'));
});

test('the humanizer no longer turns "the future of" into a broken sentence', async () => {
  const { stripBannedPhrases } = await import('../src/humanizer/rules.js');
  assert.equal(stripBannedPhrases('Tabby challenges the future of conventional accounting.').text, 'Tabby challenges conventional accounting.');
});

test('the bar for "has a point" can be raised without raising it for everything else', () => {
  const judged = { score: 3.5, scores: { ...GOOD, point: 3, informationValue: 3, nonGeneric: 3, voice: 3 } };

  assert.deepEqual(judgementFailures(judged, SETTINGS), [], 'passes at the default floor');

  const strict = judgementFailures(judged, { ...SETTINGS, minPointDimension: 4 });
  assert.ok(strict.some((failure) => failure.startsWith('point 3/5')));
  assert.ok(!strict.some((failure) => failure.startsWith('voice')), 'voice keeps its own floor');
});

test('sarcastic shrugs are empty reactions too', () => {
  for (const line of ['Funny how that works.', "Kind of ironic, isn't it?", "Guess that's one way to avoid bad orders."]) {
    assert.ok(has(pointProblems({ text: line, article: { title: 'x' } }), 'empty reaction'), line);
  }
});

test('"need to rethink" is generic whoever is told to do it', () => {
  assert.ok(has(pointProblems({ text: 'Retailers might need to rethink how they use AI.', article: { title: 'x' } }), 'generic conclusion'));
});

test('an invented full date and a prediction for a past year are caught', async () => {
  const { inventedNumbers } = await import('../src/content-engine/quality.js');
  const article = { title: 'AstroForge flies in 2027', summary: 'x', body: 'AstroForge plans to fly in 2027.' };
  const thisYear = new Date().getFullYear();

  const found = inventedNumbers(`INFO: Launch window opens 2027-01-15 12:00 UTC. A major shift by ${thisYear - 1}.`, article);
  assert.ok(found.includes('2027-01-15'));
  assert.ok(found.some((item) => item.includes('already past')));
  assert.deepEqual(inventedNumbers('It flies in 2027.', article), [], 'the story\'s own year is fine');
});

test('the aside ending asks for a fact, not a reaction', async () => {
  const { CLOSER_STYLES } = await import('../src/content-engine/shapes.js');
  assert.match(CLOSER_STYLES.aside.instruction, /ONE more real detail/);
});

test('a title whose only capital is its first word does not hold a post about it', () => {
  const problems = structuralProblems({
    article: { title: 'Everyone can find a reason to dislike data center construction', summary: 'Opposition is diverse and post-partisan.' },
    draft: { parts: {}, text: 'Resistance to new data centers is post-partisan.\n\nThat is the finding.' },
  });

  assert.ok(!has(problems, 'does not mention anything'));
});
