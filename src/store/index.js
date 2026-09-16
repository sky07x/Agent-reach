/**
 * The agent's memory.
 *
 * Every stage talks to the store instead of passing giant objects around, so
 * each stage stays independently testable and a crashed run can be resumed.
 *
 * Collections:
 *   articles  raw + classified + curated stories, keyed by URL hash
 *   posts     everything we generated, published or not
 *   state     small key/value bag (paused flag, style rotation, learnings)
 */

import crypto from 'node:crypto';
import { createJsonDriver } from './json-driver.js';

export const COLLECTIONS = {
  articles: 'articles',
  posts: 'posts',
  state: 'state',
};

/**
 * Stable id for an article. The same URL always gives the same id, so re-runs
 * never create a duplicate. This is the whole dedupe mechanism.
 */
export function articleIdFromUrl(url) {
  // Drop tracking params and the trailing slash, so the same story shared two
  // different ways still collapses to one id.
  const cleaned = String(url).split('?')[0].replace(/\/+$/, '').toLowerCase();
  return crypto.createHash('sha1').update(cleaned).digest('hex').slice(0, 16);
}

export function createStore(config) {
  const driverName = config.store.driver === 'dynamo' ? 'dynamo' : 'json';

  // Built once by init(). The DynamoDB driver is imported only when it is
  // actually used, so local runs and tests never load the AWS SDK.
  let db = null;

  async function open() {
    if (db) return db;

    if (driverName === 'dynamo') {
      const { createDynamoDriver } = await import('./dynamo-driver.js');
      db = createDynamoDriver({ tableName: config.store.tableName, region: config.store.region });
    } else {
      db = createJsonDriver({ directory: config.paths.data });
    }

    await db.init();
    return db;
  }

  /** Newest first. Used everywhere we care about "recent". */
  function byNewest(a, b) {
    return String(b.createdAt ?? b.fetchedAt ?? '').localeCompare(String(a.createdAt ?? a.fetchedAt ?? ''));
  }

  return {
    driver: driverName,

    async init() {
      await open();
    },

    /* --- articles ------------------------------------------------------- */

    /** True if we have already seen this URL in a previous run. */
    async hasArticle(url) {
      return Boolean(await (await open()).get(COLLECTIONS.articles, articleIdFromUrl(url)));
    },

    async getArticle(id) {
      return (await open()).get(COLLECTIONS.articles, id);
    },

    /**
     * Save new articles and skip the ones we already have.
     * Returns only the articles that were genuinely new.
     */
    async saveNewArticles(articles) {
      const store = await open();
      const fresh = [];

      for (const article of articles) {
        if (await store.get(COLLECTIONS.articles, article.id)) continue;
        fresh.push(article);
      }

      if (fresh.length) await store.putMany(COLLECTIONS.articles, fresh);
      return fresh;
    },

    /** Merge extra fields (classification, curation, usedInPostId) onto one. */
    async updateArticle(id, patch) {
      return (await open()).put(COLLECTIONS.articles, { id, ...patch });
    },

    async listArticles() {
      return (await (await open()).list(COLLECTIONS.articles)).sort(byNewest);
    },

    /** Relevant, not yet turned into a post, and still recent enough. */
    async listPostableArticles({ maxAgeDays }) {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

      return (await this.listArticles()).filter((article) => (
        article.classification?.relevant
        && !article.usedInPostId
        && new Date(article.publishedAt).getTime() >= cutoff
      ));
    },

    /* --- posts ---------------------------------------------------------- */

    async savePost(post) {
      return (await open()).put(COLLECTIONS.posts, post);
    },

    async updatePost(id, patch) {
      return (await open()).put(COLLECTIONS.posts, { id, ...patch });
    },

    async getPost(id) {
      return (await open()).get(COLLECTIONS.posts, id);
    },

    async listPosts(limit = 20) {
      return (await (await open()).list(COLLECTIONS.posts)).sort(byNewest).slice(0, limit);
    },

    /**
     * Used by the curator to avoid repeating a topic, and by the meme
     * generator to avoid repeating a template.
     */
    async listRecentPublished(limit = 10) {
      const posts = await (await open()).list(COLLECTIONS.posts);
      return posts.filter((post) => post.status === 'published').sort(byNewest).slice(0, limit);
    },

    /* --- state ---------------------------------------------------------- */

    async getState(key, fallback = null) {
      const row = await (await open()).get(COLLECTIONS.state, key);
      return row ? row.value : fallback;
    },

    async setState(key, value) {
      await (await open()).put(COLLECTIONS.state, { id: key, value, updatedAt: new Date().toISOString() });
      return value;
    },

    async isPaused() {
      return Boolean(await this.getState('paused', false));
    },

    async setPaused(paused) {
      return this.setState('paused', Boolean(paused));
    },
  };
}

export default { createStore, articleIdFromUrl, COLLECTIONS };
