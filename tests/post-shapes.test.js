/**
 * Shapes decide what a post actually looks like, so the assembler is the
 * thing most likely to quietly go back to producing one skeleton for
 * everything. Pin it down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_SHAPES,
  CLOSER_STYLES,
  LENGTH_MOODS,
  fieldsFor,
  targetWords,
  getShape,
  normalizeParts,
  hasEnough,
  assemblePost,
} from '../src/content-engine/shapes.js';
import { countWords } from '../src/content-engine/index.js';
import config from '../src/config/index.js';

const HASHTAGS = ['#LLM', '#DevTools'];

test('every configured shape actually exists', () => {
  for (const name of config.content.postShapes) {
    assert.ok(POST_SHAPES[name], `config names a shape that is not defined: ${name}`);
  }
});

test('every shape declares an instruction and at least one field', () => {
  for (const [name, shape] of Object.entries(POST_SHAPES)) {
    assert.ok(shape.instruction?.length > 20, `${name} needs a real instruction`);
    assert.ok(shape.fields.length > 0, `${name} needs fields`);
    assert.equal(typeof shape.assemble, 'function', `${name} needs an assembler`);
  }
});

test('shapes do not all produce the same skeleton', () => {
  const parts = {
    body: 'line one\nline two',
    lines: ['first beat', 'second beat', 'third'],
    closer: 'and that is the whole problem',
    punchline: 'nobody read the changelog',
    logLines: ['ERROR: agent exited 137', 'at shell.run(index.js:42)'],
    reaction: 'they said this out loud, on a stage',
    beats: ['funding closed friday', 'the demo broke monday'],
  };

  const built = Object.keys(POST_SHAPES).map((name) =>
    assemblePost({ shapeName: name, hook: 'The hook.', parts, hashtags: HASHTAGS }));

  assert.equal(new Set(built).size, built.length, 'two shapes rendered identically');
});

test('a shape that forbids a question does not get one', () => {
  const text = assemblePost({
    shapeName: 'slow-burn-rant',
    hook: 'They shipped it anyway.',
    parts: { lines: ['nobody tested it.', 'nobody will.'], closer: 'it is fine.' },
    hashtags: HASHTAGS,
  });

  assert.ok(!text.includes('?'), 'the rant shape should not end on a question');
});

test('the zinger stays short', () => {
  const text = assemblePost({
    shapeName: 'two-line-zinger',
    hook: 'They gave the agent shell access.',
    parts: { punchline: 'in production.' },
    hashtags: HASHTAGS,
  });

  assert.equal(text.split('\n\n').length, 3, 'hook, punchline, hashtags and nothing else');
});

test('list fields survive a model that returns a plain string', () => {
  const parts = normalizeParts(getShape('terminal-log'), {
    logLines: 'first line\n\nsecond line\n',
    closer: 'cool.',
  });

  assert.deepEqual(parts.logLines, ['first line', 'second line']);
  assert.equal(parts.closer, 'cool.');
});

test('missing fields come back as empty, not undefined', () => {
  const parts = normalizeParts(getShape('classic-take'), {});

  assert.equal(parts.body, '');
  assert.equal(parts.closer, '');
  assert.equal(hasEnough(getShape('classic-take'), parts), false);
});

test('an unknown shape name falls back instead of throwing', () => {
  const text = assemblePost({
    shapeName: 'not-a-real-shape',
    hook: 'Hook.',
    parts: { body: 'Body.', closer: 'Closer.' },
    hashtags: HASHTAGS,
  });

  assert.ok(text.includes('Body.'));
});

test('an empty model response still produces a postable hook', () => {
  const text = assemblePost({
    shapeName: 'receipts',
    hook: 'They shipped it on a Friday.',
    parts: { beats: [], closer: '' },
    hashtags: HASHTAGS,
  });

  assert.equal(text, 'They shipped it on a Friday.\n\n#LLM #DevTools');
});

test('assembled posts never contain a triple newline', () => {
  const text = assemblePost({
    shapeName: 'quote-reaction',
    hook: '"It is not a security risk."',
    parts: { reaction: 'it was a security risk.', closer: '' },
    hashtags: HASHTAGS,
  });

  assert.ok(!/\n{3,}/.test(text));
});

test('a log block keeps its indentation', () => {
  const parts = normalizeParts(getShape('terminal-log'), {
    logLines: ['ERROR agent exited 137', '    at shell.run(index.js:42)   '],
    closer: 'cool.',
  });

  assert.deepEqual(parts.logLines, ['ERROR agent exited 137', '    at shell.run(index.js:42)']);

  const text = assemblePost({
    shapeName: 'terminal-log',
    hook: 'It ran.',
    parts,
    hashtags: HASHTAGS,
  });

  assert.ok(text.includes('\n    at shell.run'), 'stack frames must stay indented');
});

/* --- how a post ends ---------------------------------------------------- */

test('every configured ending actually exists', () => {
  for (const name of config.content.closerStyles) {
    assert.ok(CLOSER_STYLES[name], `config names an ending that is not defined: ${name}`);
  }
});

test('the "none" ending drops the closer field entirely', () => {
  const fields = fieldsFor(getShape('classic-take'), 'none');

  assert.ok(!fields.some((field) => field.key === 'closer'), 'nothing should ask for a closer');
  assert.ok(fields.some((field) => field.key === 'body'), 'the rest of the shape is untouched');
});

test('the chosen ending rewrites what the closer field asks for', () => {
  const asQuestion = fieldsFor(getShape('classic-take'), 'argument-bait');
  const asVerdict = fieldsFor(getShape('classic-take'), 'flat-verdict');

  const describe = (fields) => fields.find((field) => field.key === 'closer').description;

  assert.notEqual(describe(asQuestion), describe(asVerdict));
  assert.match(describe(asVerdict), /no question mark/);
});

test('shapes that end themselves ignore the ending rotation', () => {
  for (const name of ['two-line-zinger', 'slow-burn-rant']) {
    const shape = getShape(name);

    assert.equal(shape.closer, 'own');
    assert.deepEqual(fieldsFor(shape, 'none'), shape.fields, `${name} should keep its own fields`);
  }
});

test('a post with no ending is still a complete post', () => {
  const text = assemblePost({
    shapeName: 'classic-take',
    hook: 'They shipped it on a Friday.',
    parts: { body: 'nobody tested it.', closer: '' },
    hashtags: HASHTAGS,
  });

  assert.equal(text, 'They shipped it on a Friday.\n\nnobody tested it.\n\n#LLM #DevTools');
});

test('every ending except "none" asks for something', () => {
  for (const [name, style] of Object.entries(CLOSER_STYLES)) {
    assert.ok(style.instruction?.length > 20, `${name} needs a real instruction`);

    if (name === 'none') assert.equal(style.field, null);
    else assert.ok(style.field?.length > 10, `${name} needs a field description`);
  }
});

test('a volunteered closer is ignored when the ending is "none"', () => {
  // Models hand back keys nobody asked for. If we read that back, the post
  // that was supposed to stop dead gets its closing line anyway.
  const parts = normalizeParts(getShape('classic-take'), {
    body: 'nobody tested it.',
    closer: 'so what do you think?',
  }, 'none');

  assert.equal(parts.closer, undefined);

  const text = assemblePost({
    shapeName: 'classic-take',
    hook: 'They shipped it on a Friday.',
    parts,
    hashtags: HASHTAGS,
  });

  assert.ok(!text.includes('what do you think'), 'the post should just stop');
});

test('a volunteered closer is kept when the ending wants one', () => {
  const parts = normalizeParts(getShape('classic-take'), {
    body: 'nobody tested it.',
    closer: 'it ships anyway.',
  }, 'flat-verdict');

  assert.equal(parts.closer, 'it ships anyway.');
});

/* --- how long a post runs ------------------------------------------------ */

test('every configured length mood actually exists', () => {
  for (const name of config.content.lengthMoods) {
    assert.ok(LENGTH_MOODS[name], `config names a length mood that is not defined: ${name}`);
  }
});

test('every shape declares a sane word range', () => {
  for (const [name, shape] of Object.entries(POST_SHAPES)) {
    assert.ok(shape.words, `${name} needs a word range`);
    assert.ok(shape.words.min > 0, `${name} min must be positive`);
    assert.ok(shape.words.max > shape.words.min, `${name} max must beat min`);
    assert.ok(shape.words.max <= config.content.maxWords, `${name} exceeds the global ceiling`);
  }
});

test('the mood moves the target across the shape range', () => {
  const shape = getShape('classic-take');

  const tight = targetWords(shape, 'tight').target;
  const full = targetWords(shape, 'full').target;

  assert.equal(tight, shape.words.min);
  assert.equal(full, shape.words.max);
  assert.ok(targetWords(shape, 'mid').target > tight);
  assert.ok(targetWords(shape, 'mid').target < full);
});

test('a zinger at its longest is still shorter than a classic take at its shortest', () => {
  const zinger = targetWords(getShape('two-line-zinger'), 'full').target;
  const classic = targetWords(getShape('classic-take'), 'tight').target;

  assert.ok(zinger < classic, `${zinger} should be under ${classic}`);
});

test('the global ceiling caps the shape range, never raises it', () => {
  const shape = getShape('classic-take');

  assert.equal(targetWords(shape, 'full', 40).max, 40);
  assert.equal(targetWords(shape, 'full', 5000).max, shape.words.max);
});

test('an unknown mood falls back instead of throwing', () => {
  const { target } = targetWords(getShape('receipts'), 'not-a-mood');

  assert.ok(Number.isFinite(target));
});

test('hashtags do not count towards the word count', () => {
  assert.equal(countWords('two words here #LLM #DevTools #AIAgents'), 3);
});
