/**
 * Shapes decide what a post actually looks like, so the assembler is the
 * thing most likely to quietly go back to producing one skeleton for
 * everything. Pin it down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_SHAPES,
  getShape,
  normalizeParts,
  hasEnough,
  assemblePost,
} from '../src/content-engine/shapes.js';
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
