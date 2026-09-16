/**
 * The humanizer is the module that keeps posts from reading like a language
 * model wrote them. If it silently stops stripping a phrase, nothing errors,
 * the posts just get worse. Hence these tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripBannedPhrases,
  limitEmDashes,
  useContractions,
  detectAiTells,
  applyRules,
} from '../src/humanizer/rules.js';
import { splitOffHashtags, reattachHashtags } from '../src/humanizer/index.js';

test('banned phrases are removed and reported', () => {
  const { text, removed } = stripBannedPhrases('Exciting news! This is a game-changer for developers.');

  assert.ok(!/exciting news/i.test(text), `still present: ${text}`);
  assert.ok(!/game-changer/i.test(text), `still present: ${text}`);
  assert.equal(removed.length, 2);
  assert.ok(removed.every((entry) => entry.reason), 'every removal should carry a reason');
});

test('phrases with a replacement are swapped, not deleted', () => {
  const { text } = stripBannedPhrases('Teams leverage this to delve into the data.');

  assert.match(text, /use/);
  assert.match(text, /looks at/);
  assert.ok(!/leverage|delve/i.test(text));
});

test('generic engagement bait is stripped', () => {
  const { text } = stripBannedPhrases('Shipping is hard. What do you think? Let me know in the comments.');

  assert.ok(!/what do you think/i.test(text));
  assert.ok(!/let me know in the comments/i.test(text));
  assert.match(text, /Shipping is hard/);
});

test('influencer emoji are dropped', () => {
  const { text } = stripBannedPhrases('Shipped it 🚀🔥');

  assert.ok(!/[🚀🔥]/u.test(text));
  assert.match(text, /Shipped it/);
});

test('clean text is left alone', () => {
  const input = "The model hit 92% on the benchmark. Nobody can reproduce it.";
  const { text, removed } = stripBannedPhrases(input);

  assert.equal(text, input);
  assert.equal(removed.length, 0);
});

test('deleting a phrase does not leave double spaces or stray punctuation', () => {
  const { text } = stripBannedPhrases('Moreover, the latency doubled.');

  assert.ok(!/\s{2,}/.test(text), `double space in: "${text}"`);
  assert.ok(!/^[,;:]/.test(text), `stray punctuation in: "${text}"`);
  assert.match(text, /latency doubled/);
});

test('em-dashes are limited to the configured maximum', () => {
  const input = 'One — two — three — four.';
  const { text, replaced } = limitEmDashes(input, 1);

  assert.equal((text.match(/[—–]/g) ?? []).length, 0, 'em-dashes should all be rewritten');
  assert.equal(replaced, 2);
});

test('em-dash zero maximum removes every one of them', () => {
  const { text } = limitEmDashes('A — B — C', 0);
  assert.ok(!/[—–]/.test(text));
});

test('contractions are applied', () => {
  const { text, applied } = useContractions('It is not ready and we are not shipping it.');

  assert.equal(text, "It's not ready and we aren't shipping it.");
  assert.ok(applied > 0);
});

test('a contraction at a sentence start keeps its capital letter', () => {
  const { text } = useContractions('It is broken. That is fine.');

  assert.equal(text, "It's broken. That's fine.");
});

test('detectAiTells finds what the rules have not fixed', () => {
  const issues = detectAiTells('Moreover — this is a game-changer — furthermore it is great.', { maxEmDashes: 1 });

  const types = issues.map((issue) => issue.type);

  assert.ok(types.includes('banned-phrase'), 'should flag banned phrases');
  assert.ok(types.includes('em-dash'), 'should flag the extra em-dash');
});

test('detectAiTells flags three bullets of near-identical length', () => {
  const issues = detectAiTells([
    'Here is the deal:',
    '- The first point about the thing',
    '- The second point about the thing',
    '- The third point about the thing',
  ].join('\n'));

  assert.ok(issues.some((issue) => issue.type === 'symmetrical-list'));
});

test('detectAiTells flags repeated sentence openers', () => {
  const issues = detectAiTells('This is one. This is two. This is three.');

  assert.ok(issues.some((issue) => issue.type === 'repeated-openers'));
});

test('detectAiTells returns nothing for text that reads human', () => {
  const issues = detectAiTells("Shipped at 3am. It broke. We rolled back and went to bed.");

  assert.deepEqual(issues, []);
});

test('applyRules runs every pass and reports what it changed', () => {
  const { text, changes } = applyRules(
    'Exciting news! It is a game-changer — moreover, teams leverage it. What do you think?',
    { maxEmDashes: 0 },
  );

  assert.ok(!/exciting news/i.test(text));
  assert.ok(!/[—–]/.test(text));
  assert.ok(changes.bannedPhrasesRemoved.length >= 3);
  assert.ok(changes.contractionsApplied >= 1);
  assert.ok(Array.isArray(changes.remainingTells));
});

test('sentences still start with a capital after the cleanup', () => {
  const { text } = applyRules('Moreover, it is broken. Furthermore, it is slow.', { maxEmDashes: 1 });

  for (const sentence of text.split(/(?<=[.!?])\s+/).filter(Boolean)) {
    assert.match(sentence.trim(), /^[A-Z"'(]/, `sentence not capitalised: "${sentence}"`);
  }
});

/* --- hashtag preservation -------------------------------------------------
 * The LLM editor pass used to eat the hashtag line roughly half the time,
 * which silently broke the "3-5 hashtags" rule. Hashtags are now held aside
 * for the whole process, so no pass can touch them.
 */

test('splitOffHashtags separates a trailing hashtag line', () => {
  const { prose, hashtagLine } = splitOffHashtags('A take.\n\nA question?\n\n#LLM #DevTools');

  assert.equal(prose, 'A take.\n\nA question?');
  assert.equal(hashtagLine, '#LLM #DevTools');
});

test('splitOffHashtags leaves a post with no hashtags alone', () => {
  const { prose, hashtagLine } = splitOffHashtags('Just a take.\n\nAnd a question?');

  assert.equal(prose, 'Just a take.\n\nAnd a question?');
  assert.equal(hashtagLine, '');
});

test('splitOffHashtags does not mistake a normal last line for hashtags', () => {
  const { hashtagLine } = splitOffHashtags('We shipped it.\n\nShip #2 was worse.');

  assert.equal(hashtagLine, '', 'a sentence containing a # is not a hashtag line');
});

test('reattachHashtags puts the line back with a blank line before it', () => {
  assert.equal(reattachHashtags('A take.', '#LLM #RAG'), 'A take.\n\n#LLM #RAG');
  assert.equal(reattachHashtags('A take.', ''), 'A take.');
});

test('the rules-only humanizer keeps the hashtags', async () => {
  const { createHumanizer } = await import('../src/humanizer/index.js');

  const humanizer = createHumanizer({
    config: { humanizer: { useLlmEditorPass: false, maxEmDashes: 1 } },
    llm: null,
  });

  const { text } = await humanizer.humanize('Exciting news! It is broken.\n\nWhy?\n\n#LLM #DevTools');

  assert.match(text, /#LLM #DevTools$/, `hashtags lost: ${text}`);
  assert.ok(!/exciting news/i.test(text), 'should still strip banned phrases');
});

test('an editor pass that drops the hashtags cannot actually lose them', async () => {
  const { createHumanizer } = await import('../src/humanizer/index.js');

  // This fake editor returns text with no hashtags at all, which is exactly
  // what the real model did.
  const llm = { chat: async () => 'It is broken.\n\nWhy?' };

  const humanizer = createHumanizer({
    config: { humanizer: { useLlmEditorPass: true, maxEmDashes: 1 } },
    llm,
  });

  const { text, report } = await humanizer.humanize('It is broken.\n\nWhy?\n\n#LLM #DevTools');

  assert.match(text, /#LLM #DevTools$/, `hashtags lost: ${text}`);
  assert.equal(report.hashtagsPreserved, true);
});
