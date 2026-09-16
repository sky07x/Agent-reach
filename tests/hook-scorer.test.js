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
