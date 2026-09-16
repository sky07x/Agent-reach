/**
 * The classifier decides what the whole agent is allowed to talk about, so a
 * silent drift here means the feed quietly fills with the wrong stories.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreArticle, isAmbiguous } from '../src/classifier/heuristics.js';
import { config } from '../src/config/index.js';

const rules = config.classifier;

function article(fields) {
  return { title: '', summary: '', body: '', tags: [], ...fields };
}

test('an AI story with the keyword in the title scores high', () => {
  const { score } = scoreArticle(article({
    title: 'OpenAI ships a new large language model for agents',
    summary: 'The model handles tool use and long context.',
  }), rules);

  assert.ok(score >= rules.minScoreToKeep, `expected a keeper, got ${score}`);
});

test('an unrelated story scores near zero', () => {
  const { score } = scoreArticle(article({
    title: 'This e-bike startup raised a Series B for its new scooter',
    summary: 'The company sells electric scooters in three cities.',
  }), rules);

  assert.ok(score < rules.minScoreToKeep, `expected a reject, got ${score}`);
});

test('exclude keywords pull a keyword-stuffed story back down', () => {
  const stuffed = article({
    title: 'AI-powered e-bike company announces IPO',
    summary: 'The e-bike maker uses machine learning for route planning.',
  });

  const clean = article({
    title: 'AI-powered route planning gets a new open source library',
    summary: 'The library uses machine learning for route planning.',
  });

  assert.ok(
    scoreArticle(stuffed, rules).score < scoreArticle(clean, rules).score,
    'the excluded story should score lower than the clean one',
  );
});

test('"ai" does not match inside other words', () => {
  const { matched } = scoreArticle(article({
    title: 'A chair company sent an email about its retail plans',
    summary: 'Nothing technical happens here at all.',
  }), rules);

  assert.deepEqual(matched, [], `matched unexpectedly: ${matched.join(', ')}`);
});

test('a tag match counts even when the title says nothing', () => {
  const { score, matched } = scoreArticle(article({
    title: 'The company shared its quarterly update',
    summary: 'A short note from the team.',
    tags: ['machine learning'],
  }), rules);

  assert.ok(matched.some((entry) => entry.startsWith('tag:')), 'expected a tag match');
  assert.ok(score > 0, 'tag matches should contribute to the score');
});

test('supporting keywords alone cannot carry an article', () => {
  const { score } = scoreArticle(article({
    title: 'A cloud company updated its api documentation',
    summary: 'Developers can now read the docs more easily.',
  }), rules);

  assert.ok(score < rules.minScoreToKeep, `supporting-only should not pass, got ${score}`);
});

test('scores are clamped to 0..1', () => {
  const { score } = scoreArticle(article({
    title: 'AI machine learning LLM GPT neural network deep learning transformer',
    summary: 'openai anthropic claude gemini llama mistral inference embedding',
  }), rules);

  assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`);
});

test('isAmbiguous only fires inside the configured band', () => {
  const { min, max } = rules.ambiguousRange;

  assert.equal(isAmbiguous(min, rules.ambiguousRange), true);
  assert.equal(isAmbiguous(max, rules.ambiguousRange), true);
  assert.equal(isAmbiguous(min - 0.01, rules.ambiguousRange), false);
  assert.equal(isAmbiguous(max + 0.01, rules.ambiguousRange), false);
});
