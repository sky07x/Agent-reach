/**
 * The hook is the only line most people read. This is the rule set that picks
 * it out of the model's candidates, so it is worth pinning down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreHook, pickBestHook } from '../src/content-engine/hook-scorer.js';

test('a short specific hook beats a long vague one', () => {
  const sharp = scoreHook('OpenAI just deprecated the thing you shipped last week.');
  const vague = scoreHook('In today\'s fast-paced world, artificial intelligence is truly a game-changer for every single business out there.');

  assert.ok(sharp.score > vague.score, `${sharp.score} should beat ${vague.score}`);
});

test('cliches are penalised and named', () => {
  const { score, notes } = scoreHook('This is a game-changer for the future of work.');

  assert.ok(score < 0.5);
  assert.ok(notes.some((note) => note.startsWith('cliche')));
});

test('a hook that reads like a news summary is penalised', () => {
  const newsy = scoreHook('According to TechCrunch, the company released a new model.');

  assert.ok(newsy.notes.includes('reads like a news summary'));
});

test('a concrete number helps', () => {
  const withNumber = scoreHook('They burned $12M of GPU time on a benchmark.');
  const without = scoreHook('They burned a lot of GPU time on a benchmark.');

  assert.ok(withNumber.score > without.score);
});

test('hooks past the truncation limit are punished', () => {
  const long = 'x'.repeat(200);

  assert.ok(scoreHook(long, 140).notes.includes('too long, will be truncated'));
});

test('em-dashes in a hook are flagged', () => {
  assert.ok(scoreHook('The model shipped — and then it broke.').notes.includes('em-dash'));
});

test('hedging is flagged', () => {
  assert.ok(scoreHook('This might potentially be important for developers.').notes.includes('hedging'));
});

test('an empty hook scores zero', () => {
  assert.equal(scoreHook('').score, 0);
  assert.equal(scoreHook(undefined).score, 0);
});

test('pickBestHook returns the winner and the full scoreboard', () => {
  const { best, scored } = pickBestHook([
    'In today\'s fast-paced world, AI is a game-changer.',
    'They shipped an agent with shell access. On purpose.',
    '',
  ]);

  assert.equal(best, 'They shipped an agent with shell access. On purpose.');
  assert.equal(scored.length, 2, 'empty candidates are dropped');
  assert.ok(scored[0].score >= scored[1].score, 'scoreboard should be sorted');
});

test('pickBestHook copes with no usable candidates', () => {
  assert.deepEqual(pickBestHook([]), { best: '', scored: [] });
  assert.deepEqual(pickBestHook(undefined), { best: '', scored: [] });
});

/* --- jitter -------------------------------------------------------------- */

// Four candidates that all score the same, which is the normal case: the
// scorer cannot tell good lines apart, only obviously bad ones.
const TIED = [
  'They shipped an agent with shell access.',
  'The agent got shell access in production.',
  'Production now has an agent with a shell.',
  'Shell access, in production, on purpose.',
];

test('without jitter, only a top scorer can win', () => {
  const hooks = [...TIED, 'In today\'s fast-paced world, this is a game-changer.'];

  for (let i = 0; i < 20; i += 1) {
    assert.ok(TIED.includes(pickBestHook(hooks).best), 'a lower scorer must never win');
  }
});

test('an exact tie is broken at random even without jitter', () => {
  // A tie is exactly the case where this scorer has no opinion, so always
  // taking the first is just shipping whatever the model listed first.
  assert.equal(pickBestHook(TIED, { random: () => 0.99 }).best, TIED[3]);
  assert.equal(pickBestHook(TIED, { random: () => 0 }).best, TIED[0]);
});

test('jitter lets a near-tie win', () => {
  // random() near 1 picks the last contender rather than the first.
  const { best, contenders } = pickBestHook(TIED, { jitter: 0.12, random: () => 0.99 });

  assert.equal(contenders, 4, 'all four are within the band');
  assert.equal(best, TIED[3]);
});

test('jitter never reaches a hook outside the band', () => {
  const hooks = [
    'They shipped an agent with shell access.',
    'In today\'s fast-paced world, this is a total game-changer for everyone.',
  ];

  // Even asking for the last contender, the cliche is not one.
  const { best, contenders } = pickBestHook(hooks, { jitter: 0.12, random: () => 0.99 });

  assert.equal(contenders, 1);
  assert.equal(best, hooks[0]);
});

test('the scoreboard marks which hook actually ran', () => {
  const { best, scored } = pickBestHook(TIED, { jitter: 0.12, random: () => 0.99 });

  const chosen = scored.filter((entry) => entry.chosen);

  assert.equal(chosen.length, 1, 'exactly one hook is marked');
  assert.equal(chosen[0].hook, best);
});

test('a random source that returns 1 does not fall off the end', () => {
  const { best } = pickBestHook(TIED, { jitter: 0.12, random: () => 1 });

  assert.ok(TIED.includes(best), 'should still be a real hook');
});

test('jitter still respects the character limit', () => {
  const hooks = ['Short and sharp.', 'x'.repeat(200)];

  const { best } = pickBestHook(hooks, { maxChars: 140, jitter: 0.12, random: () => 0.99 });

  assert.equal(best, hooks[0], 'a truncated hook is never a contender');
});
