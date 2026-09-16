/**
 * Stage 1 - Scrape.
 *
 * Pull TechCrunch stories from RSS (cheap and structured), and only fall back
 * to fetching the article page for the things RSS does not give us: the full
 * body text and a decent image.
 *
 * Nothing here decides what is interesting. This stage only collects.
 */

import * as cheerio from 'cheerio';
import { getText } from '../lib/http-client.js';
import { createLogger } from '../lib/logger.js';
import { articleIdFromUrl } from '../store/index.js';
import { createCache } from './cache.js';
import { isAllowed } from './robots.js';

const log = createLogger('scraper');

/** Turn "<p>Hi &amp; bye</p>" into "Hi & bye". */
function toPlainText(html) {
  if (!html) return '';
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

/** Read one <item> out of an RSS feed. */
function parseFeedItem($, element, feedName) {
  const item = $(element);
  const url = item.find('link').first().text().trim() || item.find('guid').first().text().trim();

  if (!url) return null;

  const description = item.find('description').first().text();
  const encoded = item.find('content\\:encoded').first().text();
  const publishedAt = item.find('pubDate').first().text().trim();

  return {
    id: articleIdFromUrl(url),
    url,
    title: item.find('title').first().text().trim(),
    summary: toPlainText(description).slice(0, 600),
    body: toPlainText(encoded).slice(0, 6000) || undefined,
    tags: item.find('category').map((_, tag) => $(tag).text().trim().toLowerCase()).get(),
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    source: 'techcrunch',
    feed: feedName,
    fetchedAt: new Date().toISOString(),
  };
}

export function createScraper({ config }) {
  const settings = config.scraper;
  const cache = createCache({ directory: config.paths.cache, ttlMinutes: settings.cacheTtlMinutes });

  async function fetchWithCache(url) {
    const cached = await cache.get(url);
    if (cached) {
      log.debug('Cache hit', { url });
      return cached;
    }

    if (!(await isAllowed(url, settings.userAgent))) {
      throw new Error(`robots.txt disallows ${url}`);
    }

    const body = await getText(url, {
      headers: { 'User-Agent': settings.userAgent, Accept: 'application/rss+xml, text/html' },
      minGapMs: settings.minGapMs,
    });

    await cache.set(url, body);
    return body;
  }

  /** Read one RSS feed and return its articles. */
  async function fetchFeed(feed) {
    const xml = await fetchWithCache(feed.url);
    const $ = cheerio.load(xml, { xmlMode: true });

    const articles = $('item')
      .map((_, element) => parseFeedItem($, element, feed.name))
      .get()
      .filter(Boolean);

    log.info('Feed read', { feed: feed.name, articles: articles.length });
    return articles;
  }

  /**
   * Fetch the article page for the fields RSS leaves out. We keep this
   * optional because it is the slow, impolite part of scraping.
   */
  async function enrichWithFullBody(article) {
    if (article.body && article.body.length > 1200) return article;

    try {
      const html = await fetchWithCache(article.url);
      const $ = cheerio.load(html);

      const paragraphs = $('article p, .article-content p, .entry-content p')
        .map((_, p) => $(p).text().trim())
        .get()
        .filter((text) => text.length > 40);

      const image = $('meta[property="og:image"]').attr('content');

      return {
        ...article,
        body: paragraphs.join('\n\n').slice(0, 6000) || article.body,
        imageUrl: image || article.imageUrl,
      };
    } catch (error) {
      // A failed enrichment is not fatal. The summary is usually enough.
      log.warn('Could not fetch full body', { url: article.url, error: error.message });
      return article;
    }
  }

  return {
    /**
     * Read every configured feed, drop anything too old, and return one
     * de-duplicated list. Storing is the caller's job.
     */
    async scrape() {
      const cutoff = Date.now() - settings.maxArticleAgeDays * 24 * 60 * 60 * 1000;
      const seen = new Set();
      const articles = [];

      for (const feed of settings.feeds) {
        let items = [];

        try {
          items = await fetchFeed(feed);
        } catch (error) {
          // One broken feed should not take the whole run down.
          log.error('Feed failed', { feed: feed.name, error: error.message });
          continue;
        }

        for (const article of items) {
          if (seen.has(article.id)) continue;
          if (new Date(article.publishedAt).getTime() < cutoff) continue;

          seen.add(article.id);
          articles.push(article);
        }
      }

      log.info('Scrape finished', { total: articles.length, feeds: settings.feeds.length });
      return articles;
    },

    /** Add full body text to the handful of articles we actually care about. */
    async enrich(articles) {
      if (!settings.fetchFullBody) return articles;

      const enriched = [];
      for (const article of articles) enriched.push(await enrichWithFullBody(article));
      return enriched;
    },
  };
}

export default { createScraper };
