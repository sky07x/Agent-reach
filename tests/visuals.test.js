/**
 * Planned visuals: what the planner is allowed to put on a card, and that
 * every type actually draws. A chart is the most believable thing a post can
 * carry, so most of this is about numbers that are not in the story.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkVisual, createVisualPlanner } from '../src/content-engine/visual-planner.js';
import { renderVisualSvg, VISUAL_TYPES } from '../src/meme-generator/visuals.js';
import { displayIsInArticle } from '../src/content-engine/insight.js';
import { hasNumbers } from '../src/content-engine/shapes.js';
import { structuralProblems } from '../src/content-engine/quality.js';
import { stripBannedPhrases } from '../src/humanizer/rules.js';
import { config } from '../src/config/index.js';

const ARTICLE = {
  title: 'Pocket FM doubles revenue run rate to $500M as AI powers 93% of audio content',
  summary: 'Production is about 80x cheaper.',
  body: 'Seven in 10 listeners stay. Revenue run rate hit $500 million, up from $250 million. Retention rose to 76% from 44%.',
};

const has = (problems, text) => problems.some((problem) => problem.includes(text));

/* --- numbers ---------------------------------------------------------------- */

test('a figure counts as in the story however it is spelled', () => {
  assert.ok(displayIsInArticle('$500M', ARTICLE));
  assert.ok(displayIsInArticle('93%', ARTICLE));
  assert.ok(displayIsInArticle('80x', ARTICLE));
  assert.ok(!displayIsInArticle('65%', ARTICLE));
  assert.ok(!displayIsInArticle('5', ARTICLE), '"5" inside "$500" is not a 5');
});

test('a chart with a number the story never gave is refused', () => {
  const { visual, problems } = checkVisual({
    type: 'chart', title: 'Run rate',
    bars: [{ label: 'before', value: 250, display: '$250M' }, { label: 'after', value: 600, display: '$600M' }],
  }, { article: ARTICLE });

  assert.equal(visual, null);
  assert.ok(has(problems, '$600M'));
});

test('a chart that mixes units is refused', () => {
  const { problems } = checkVisual({
    type: 'chart', title: 'Pocket FM',
    bars: [{ label: 'run rate', value: 500, display: '$500M' }, { label: 'AI share', value: 93, display: '93%' }],
  }, { article: ARTICLE });

  assert.ok(has(problems, 'mix units'));
});

test('a good chart passes, with exactly one bar highlighted', () => {
  const { visual } = checkVisual({
    type: 'chart', title: 'Run rate doubled',
    bars: [{ label: 'before', value: 250, display: '$250M' }, { label: 'now', value: 500, display: '$500M' }],
  }, { article: ARTICLE });

  assert.ok(visual);
  assert.equal(visual.bars.filter((bar) => bar.highlight).length, 1);
});

test('a stat is a bare figure, and arithmetic on the story counts as the story', () => {
  assert.ok(has(checkVisual({ type: 'stat', title: 't', stats: [{ display: 'seven in 10', label: 'stay' }] }, { article: ARTICLE }).problems, 'bare figure'));
  assert.ok(checkVisual({ type: 'stat', title: 't', stats: [{ display: '70%', label: 'stay' }] }, { article: ARTICLE }).visual, '"seven in 10" is 70%');
});

test('a checklist of three is the tidy triple and is refused', () => {
  const { problems } = checkVisual({ type: 'checklist', title: 't', items: ['a', 'b', 'c'] }, { article: ARTICLE });
  assert.ok(has(problems, 'triple'));
});

test('"none" is an answer, not a failure', () => {
  assert.deepEqual(checkVisual({ type: 'none' }), { visual: null, problems: [] });
});

/* --- drawing ---------------------------------------------------------------- */

const SAMPLES = {
  chart: { bars: [{ label: 'a', value: 1, display: '1', highlight: true }, { label: 'b', value: 2, display: '2' }] },
  stat: { stats: [{ display: '93%', label: 'of new audio' }] },
  flow: { steps: [{ label: 'one', detail: 'first' }, { label: 'two' }] },
  comparison: { left: { heading: 'before', points: ['x'] }, right: { heading: 'after', points: ['y'] } },
  checklist: { items: ['one', 'two'] },
  code: { lines: ['const a = 1;', 'return a;'], highlight: [2] },
  terminal: { lines: ['$ npm test', 'ok'] },
  quote: { quote: 'We are not going to let it happen.', who: 'someone' },
};

test('every visual type draws at both sizes, with text escaped', () => {
  for (const type of VISUAL_TYPES) {
    for (const [width, height] of [[1080, 1350], [1200, 1200]]) {
      const svg = renderVisualSvg({ visual: { type, title: 'Tom & Jerry <3', kicker: 'k', ...SAMPLES[type] }, width, height, handle: 'me', source: 'src' });
      assert.match(svg, /^<svg[^>]+width="\d+"/, type);
      assert.ok(svg.includes('Tom &amp; Jerry &lt;3'), `${type} escapes its title`);
    }
  }
});

/* --- the planner ------------------------------------------------------------ */

const store = { listRecentAttempted: async () => [{ visualType: 'flow' }] };

test('the planner retries once with the reasons, then gives up to the meme card', async () => {
  const calls = [];
  const llm = { chatJson: async (options) => { calls.push(options); return { type: 'stat', title: 't', stats: [{ display: '12%', label: 'invented' }] }; } };
  const planner = createVisualPlanner({ config, llm, store });

  const visual = await planner.plan({ article: ARTICLE, draft: { shape: 'numbers', text: 'post' }, insight: null, treatment: 'meme-square' });

  assert.equal(visual, null);
  assert.equal(calls.length, 2);
  assert.match(calls[1].user, /REJECTED[\s\S]*12%/);
  assert.match(calls[0].user, /The last posts used: flow/, 'it is told what ran recently');
});

test('a planner that cannot be reached never fails the post', async () => {
  const planner = createVisualPlanner({ config, llm: { chatJson: async () => { throw new Error('429'); } }, store });
  assert.equal(await planner.plan({ article: ARTICLE, draft: { shape: 'numbers', text: 'post' }, treatment: 'meme-square' }), null);
});

/* --- the writing checks that came with this --------------------------------- */

test('a story needs two real figures to carry a numbers post', () => {
  assert.ok(hasNumbers(ARTICLE));
  assert.ok(!hasNumbers({ title: 'Acme ships a model in 2026', summary: 'It is faster.' }), 'a year is not a figure');
});

test('two "it isn\'t X, it\'s Y" contrasts in one post are caught, one is not', () => {
  const draft = (text) => ({ text, hook: text.split('\n')[0] });
  const two = 'Pocket FM looks less like AI replacing creators and more like AI fixing throughput.\n\nThe change isn\'t the model. It\'s the pipeline.';
  const one = 'Pocket FM isn\'t replacing writers. It\'s replacing the studio.\n\nRetention rose to 76%.';

  assert.ok(has(structuralProblems({ article: ARTICLE, draft: draft(two) }), 'contrasts'));
  assert.ok(!has(structuralProblems({ article: ARTICLE, draft: draft(one) }), 'contrasts'));
});

test('announcing the point is deleted, leaving the point', () => {
  assert.equal(stripBannedPhrases('The key detail is that humans still write the ideas.').text, 'Humans still write the ideas.');
});

test('an abbreviation does not start a new sentence', () => {
  assert.equal(stripBannedPhrases('For U.S. vendor picks, it matters.').text, 'For U.S. vendor picks, it matters.');
});

test('a phrase from two of the last four posts is refused, a fresh one is not', () => {
  const recent = [
    { hook: 'a', ending: 'b', text: 'If you build agents, log the tool calls.' },
    { hook: 'c', ending: 'd', text: 'My read is the moat is distribution. If your roadmap assumes cheap GPUs, plan again.' },
    { hook: 'e', ending: 'f', text: 'Nothing like that here.' },
  ];
  const draft = (text) => ({ text, hook: text.split('\n')[0] });

  assert.ok(has(structuralProblems({ article: ARTICLE, draft: draft('Pocket FM hit $500M.\n\nIf you build audio tools, retention is the number.'), recent }), 'reuses a move'));
  assert.ok(!has(structuralProblems({ article: ARTICLE, draft: draft('Pocket FM hit $500M.\n\nMy read is the catalogue did it.'), recent }), 'reuses a move'), 'once in four is fine');
});

test('two "if you build" lines in one post are one too many', () => {
  const text = 'Pocket FM hit $500M.\n\nIf you build audio tools, watch retention.\n\nIf your team ships TTS, the 80x matters.';
  assert.ok(has(structuralProblems({ article: ARTICLE, draft: { text, hook: 'Pocket FM hit $500M.' } }), 'Keep one at most'));
});
