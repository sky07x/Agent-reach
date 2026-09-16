/**
 * Dedupe is what stops the agent posting about the same story twice. It fails
 * quietly when it breaks, which is exactly why it is tested.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { articleIdFromUrl, createStore } from '../src/store/index.js';

/** A store backed by a throwaway temp directory. */
async function makeStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));

  const store = createStore({
    store: { driver: 'json' },
    paths: { data: directory },
  });

  await store.init();
  return { store, directory };
}

test('the same URL always produces the same id', () => {
  const url = 'https://techcrunch.com/2026/01/02/openai-ships-something/';
  assert.equal(articleIdFromUrl(url), articleIdFromUrl(url));
});

test('tracking params and trailing slashes do not create a new id', () => {
  const base = 'https://techcrunch.com/2026/01/02/openai-ships-something';

  assert.equal(articleIdFromUrl(base), articleIdFromUrl(`${base}/`));
  assert.equal(articleIdFromUrl(base), articleIdFromUrl(`${base}?utm_source=twitter`));
  assert.equal(articleIdFromUrl(base), articleIdFromUrl(base.toUpperCase()));
});

test('different URLs produce different ids', () => {
  assert.notEqual(
    articleIdFromUrl('https://techcrunch.com/a'),
    articleIdFromUrl('https://techcrunch.com/b'),
  );
});

test('saving the same article twice stores it once', async () => {
  const { store } = await makeStore();

  const article = {
    id: articleIdFromUrl('https://techcrunch.com/story-one'),
    url: 'https://techcrunch.com/story-one',
    title: 'Story one',
    publishedAt: new Date().toISOString(),
  };

  const first = await store.saveNewArticles([article]);
  const second = await store.saveNewArticles([article]);

  assert.equal(first.length, 1, 'first save should be new');
  assert.equal(second.length, 0, 'second save should be skipped');
  assert.equal((await store.listArticles()).length, 1);
});

test('saveNewArticles returns only the genuinely new ones', async () => {
  const { store } = await makeStore();

  const make = (slug) => ({
    id: articleIdFromUrl(`https://techcrunch.com/${slug}`),
    url: `https://techcrunch.com/${slug}`,
    title: slug,
    publishedAt: new Date().toISOString(),
  });

  await store.saveNewArticles([make('a'), make('b')]);
  const fresh = await store.saveNewArticles([make('b'), make('c')]);

  assert.deepEqual(fresh.map((item) => item.title), ['c']);
});

test('an article already turned into a post is not offered again', async () => {
  const { store } = await makeStore();

  const article = {
    id: articleIdFromUrl('https://techcrunch.com/used'),
    url: 'https://techcrunch.com/used',
    title: 'Already posted',
    publishedAt: new Date().toISOString(),
    classification: { relevant: true, score: 0.9 },
  };

  await store.saveNewArticles([article]);

  assert.equal((await store.listPostableArticles({ maxAgeDays: 7 })).length, 1);

  await store.updateArticle(article.id, { usedInPostId: 'post_123' });

  assert.equal((await store.listPostableArticles({ maxAgeDays: 7 })).length, 0);
});

test('articles older than the window drop out of the candidate list', async () => {
  const { store } = await makeStore();

  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  await store.saveNewArticles([{
    id: articleIdFromUrl('https://techcrunch.com/ancient'),
    url: 'https://techcrunch.com/ancient',
    title: 'Ancient news',
    publishedAt: old,
    classification: { relevant: true, score: 0.9 },
  }]);

  assert.equal((await store.listPostableArticles({ maxAgeDays: 7 })).length, 0);
});

test('updateArticle merges fields instead of replacing the row', async () => {
  const { store } = await makeStore();

  const id = articleIdFromUrl('https://techcrunch.com/merge');

  await store.saveNewArticles([{ id, url: 'https://techcrunch.com/merge', title: 'Keep me', publishedAt: new Date().toISOString() }]);
  await store.updateArticle(id, { classification: { relevant: true, score: 0.8 } });

  const saved = await store.getArticle(id);

  assert.equal(saved.title, 'Keep me');
  assert.equal(saved.classification.score, 0.8);
});
