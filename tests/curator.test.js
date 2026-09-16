/**
 * The curator decides what the page talks about. It used to pick AI-doom
 * stories every time, because "controversy" scored highest and doom stories
 * are the most controversial thing on TechCrunch. There is no joke in human
 * extinction, so those posts came out grim instead of funny.
 *
 * These tests pin down the fix: funny beats heavy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreMemeability, extractTopics, topicOverlap } from '../src/curator/meme-score.js';
import { config } from '../src/config/index.js';

const rules = config.curator;

function article(fields) {
  return { title: '', summary: '', classification: { score: 0.9 }, ...fields };
}

test('a funny story beats a doom story', () => {
  const funny = scoreMemeability(article({
    title: 'Cloudflare outage took down half the internet for 3 hours',
    summary: 'A bad config deploy broke DNS resolution globally.',
  }), rules);

  const doom = scoreMemeability(article({
    title: 'Researcher warns self-improving AI could cause human extinction',
    summary: 'He says the existential risk is being ignored.',
  }), rules);

  assert.ok(
    funny.memeScore > doom.memeScore,
    `funny ${funny.memeScore} should beat doom ${doom.memeScore}`,
  );
});

test('heavy stories are pushed down and told why', () => {
  const { memeScore, reasons } = scoreMemeability(article({
    title: 'AI startup announces layoffs after extinction risk warning',
    summary: 'Job cuts follow the safety row.',
  }), rules);

  assert.ok(reasons.some((r) => r.startsWith('too heavy')), `reasons: ${reasons}`);
  assert.ok(memeScore < 0.4, `heavy story scored too high: ${memeScore}`);
});

test('a story with something broken scores as funny', () => {
  const { reasons } = scoreMemeability(article({
    title: 'npm accidentally deleted 400 packages overnight',
  }), rules);

  assert.ok(reasons.some((r) => r.startsWith('something to joke about')), `reasons: ${reasons}`);
});

test('a concrete number lifts the score', () => {
  const withNumber = scoreMemeability(article({
    title: 'Startup raises $4 billion with 12 engineers and no product',
  }), rules);

  const without = scoreMemeability(article({
    title: 'Startup raises money with a small team and no product',
  }), rules);

  assert.ok(withNumber.memeScore > without.memeScore);
});

test('layoffs are treated as heavy, not as good material', () => {
  const { reasons } = scoreMemeability(article({
    title: 'Big tech company announces layoffs of 5,000 staff',
  }), rules);

  assert.ok(reasons.some((r) => r.startsWith('too heavy')), 'layoffs must not be rewarded');
});

test('scores stay between 0 and 1', () => {
  const heavy = scoreMemeability(article({
    title: 'extinction death war lawsuit layoffs suicide',
  }), rules);

  const loud = scoreMemeability(article({
    title: 'OpenAI outage broke npm, deleted 400GB, leaked data, deprecated everything',
    summary: 'Google Microsoft Nvidia all crashed too, 90% failure, they said sorry.',
  }), rules);

  for (const { memeScore } of [heavy, loud]) {
    assert.ok(memeScore >= 0 && memeScore <= 1, `out of range: ${memeScore}`);
  }
});

test('repeating a recent topic lowers the score', () => {
  const story = article({ title: 'OpenAI ships a broken update' });

  const fresh = scoreMemeability(story, rules, {});
  const repeat = scoreMemeability(story, rules, { topics: extractTopics(story, rules.bigNames) });

  assert.ok(repeat.memeScore < fresh.memeScore, 'a repeated topic should score lower');
});

test('repeating a recent frame lowers the score', () => {
  // Different company, different words, same kind of story. This is the one
  // that used to slip through, because dedupe only looked at proper nouns.
  const story = article({ title: 'Relay shuts down after a broken deploy' });

  const fresh = scoreMemeability(story, rules, {});
  const repeat = scoreMemeability(story, rules, { frames: ['broke', 'broke'] });

  assert.ok(repeat.memeScore < fresh.memeScore, 'a repeated frame should score lower');
  assert.ok(repeat.reasons.some((reason) => reason.includes('already did')));
});

test('topicOverlap reports the share of shared topics', () => {
  assert.equal(topicOverlap(['openai', 'github'], ['openai']), 0.5);
  assert.equal(topicOverlap(['openai'], []), 0);
  assert.equal(topicOverlap([], ['openai']), 0);
});
