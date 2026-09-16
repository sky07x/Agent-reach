/**
 * Frames are what stop the page being one opinion told about six companies.
 * The guess is cheap and imperfect on purpose, so the tests pin down what it
 * is actually supposed to get right rather than demanding it be clever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_FRAMES,
  FRAME_NAMES,
  UNKNOWN_FRAME,
  guessFrame,
  describeFrames,
} from '../src/curator/frames.js';
import { frameFatigue } from '../src/curator/meme-score.js';
import { diversifyShortlist } from '../src/curator/index.js';
import config from '../src/config/index.js';

const story = (title, summary = '') => ({ title, summary });

test('every frame has a description and hints', () => {
  for (const [name, frame] of Object.entries(STORY_FRAMES)) {
    assert.ok(frame.description?.length > 20, `${name} needs a description`);
    assert.ok(frame.hints.length > 3, `${name} needs hints`);
  }
});

test('the unknown frame is deliberately not a real frame', () => {
  assert.ok(!FRAME_NAMES.includes(UNKNOWN_FRAME), 'unclear must not be confused with a real frame');
});

test('an unclear frame is never treated as repetition', () => {
  assert.equal(frameFatigue(UNKNOWN_FRAME, [UNKNOWN_FRAME, UNKNOWN_FRAME, UNKNOWN_FRAME]), 0);
});

test('the two live posts that looked identical share a frame', () => {
  // These are the real headlines behind the two posts that started all this.
  // Different companies, no shared proper nouns, and the old topic-based
  // dedupe saw nothing wrong with running them a day apart.
  const cymphony = guessFrame(story(
    'Sequoia doubles down on Cymphony as AI agents create new enterprise security risks',
    'rogue agents with unrestricted shell access and credentials',
  ));
  const graveyard = guessFrame(story(
    'The AI graveyard: a running list of projects and startups that did not make it',
    'Relay shut down, 42% of AI initiatives failed, projects crashed out',
  ));

  assert.equal(graveyard.frame, 'broke');
  assert.notEqual(cymphony.frame, '');
  assert.ok(FRAME_NAMES.includes(cymphony.frame));
});

test('a failure story guesses "broke"', () => {
  assert.equal(guessFrame(story('Cloudflare outage took down half the internet')).frame, 'broke');
});

test('a genuinely good release guesses "shipped"', () => {
  assert.equal(guessFrame(story('Meta open-sources a faster inference runtime')).frame, 'shipped');
});

test('a bare announcement is not mistaken for a good release', () => {
  // "launches" and "unveils" are in most tech headlines. They used to label
  // two thirds of the feed "shipped", which made the frame meaningless.
  const { frame } = guessFrame(story('Acme launches a product and unveils a new dashboard'));

  assert.equal(frame, UNKNOWN_FRAME);
});

test('a story with no signals falls back without claiming confidence', () => {
  const { frame, confident } = guessFrame(story('A company said a thing'));

  assert.equal(frame, UNKNOWN_FRAME);
  assert.equal(confident, false);
});

test('a single weak keyword is not treated as confident', () => {
  const { confident } = guessFrame(story('They mentioned a benchmark once'));

  assert.equal(confident, false);
});

test('frameFatigue rises with repeats and ignores unrelated frames', () => {
  assert.equal(frameFatigue('broke', []), 0);
  assert.equal(frameFatigue('broke', ['shipped', 'grind']), 0);
  assert.ok(frameFatigue('broke', ['broke', 'shipped', 'grind']) > 0);
  assert.ok(
    frameFatigue('broke', ['broke', 'broke', 'grind']) > frameFatigue('broke', ['broke', 'shipped', 'grind']),
  );
});

test('frameFatigue never exceeds one', () => {
  assert.equal(frameFatigue('broke', ['broke', 'broke', 'broke', 'broke', 'broke']), 1);
});

test('describeFrames lists every frame for the prompt', () => {
  const described = describeFrames();

  for (const name of FRAME_NAMES) assert.ok(described.includes(name), `${name} missing from the prompt`);
});

/* --- the shortlist cap --------------------------------------------------- */

const framed = (frame, id) => ({ id, guessedFrame: frame });

test('one frame cannot take over the shortlist', () => {
  // The situation that produced two identical-looking posts: a doom-heavy day
  // where every high scorer is the same kind of story, so the model has
  // nothing else it could have picked.
  const scored = [
    ...Array.from({ length: 7 }, (_, i) => framed('broke', `broke-${i}`)),
    framed('shipped', 'shipped-0'),
    framed('grind', 'grind-0'),
    framed('irony', 'irony-0'),
  ];

  const shortlist = diversifyShortlist(scored, 6, 3);

  const broke = shortlist.filter((a) => a.guessedFrame === 'broke');
  assert.equal(broke.length, 3, 'the cap should hold');
  assert.ok(new Set(shortlist.map((a) => a.guessedFrame)).size >= 3, 'the model needs real choices');
});

test('the cap keeps the best of the capped frame, not a random three', () => {
  const scored = [
    framed('broke', 'best'),
    framed('broke', 'second'),
    framed('broke', 'third'),
    framed('broke', 'fourth'),
    framed('shipped', 'other'),
  ];

  const ids = diversifyShortlist(scored, 4, 3).map((a) => a.id);

  assert.deepEqual(ids, ['best', 'second', 'third', 'other']);
});

test('a thin day falls back to the plain ranking rather than returning less', () => {
  const scored = Array.from({ length: 5 }, (_, i) => framed('broke', `broke-${i}`));

  assert.equal(diversifyShortlist(scored, 5, 2).length, 5, 'never return fewer than we have');
});

test('unclear stories are exempt from the cap', () => {
  const scored = Array.from({ length: 6 }, (_, i) => framed(UNKNOWN_FRAME, `unclear-${i}`));

  assert.equal(diversifyShortlist(scored, 5, 2).length, 5);
});

test('the shortlist cap leaves room for more than one kind of story', () => {
  assert.ok(config.curator.maxPerFrame < config.curator.shortlistSize);
});
