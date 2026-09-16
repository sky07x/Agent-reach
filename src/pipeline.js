/**
 * The agent loop: perceive, reason, act, learn.
 *
 * Each stage reads what it needs from the store and writes its own result
 * back, so a run that dies halfway can be re-run without redoing the
 * expensive parts, and any single stage can be triggered on its own.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './lib/logger.js';
import { getUsage, resetUsage } from './lib/llm-client.js';

const log = createLogger('pipeline');

function newPostId() {
  return `post_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

export function createPipeline(agent) {
  const { config, store, scraper, classifier, curator, contentEngine, humanizer, memeGenerator, publisher, analytics } = agent;

  /* --- perceive ---------------------------------------------------------- */

  /** Scrape, store the new ones, classify whatever has not been classified. */
  async function perceive() {
    const scraped = await scraper.scrape();
    const fresh = await store.saveNewArticles(scraped);

    log.info('New articles stored', { scraped: scraped.length, new: fresh.length });

    // Only classify what we have not classified before. Re-runs are free.
    const all = await store.listArticles();
    const unclassified = all.filter((article) => !article.classification);

    const classified = await classifier.classifyAll(unclassified);

    for (const article of classified) {
      await store.updateArticle(article.id, { classification: article.classification });
    }

    return { scraped: scraped.length, new: fresh.length, classified: classified.length };
  }

  /* --- reason ------------------------------------------------------------ */

  /** Choose which stories deserve a post. */
  async function reason(count) {
    const candidates = await store.listPostableArticles({ maxAgeDays: config.scraper.maxArticleAgeDays });

    log.info('Candidates for curation', { count: candidates.length });

    const picked = await curator.curate(candidates, count);

    // Only fetch the full article body for the few stories we will write about.
    const enriched = await scraper.enrich(picked);

    for (const article of enriched) {
      await store.updateArticle(article.id, {
        curation: article.curation,
        topics: article.topics,
        memeScore: article.memeScore,
        body: article.body,
      });
    }

    return enriched;
  }

  /* --- act --------------------------------------------------------------- */

  /** Turn one curated article into a finished, humanized, illustrated post. */
  async function buildPost(article) {
    const draft = await contentEngine.generate(article);
    const humanized = await humanizer.humanize(draft.text, { shapeNote: draft.shapeInstruction });

    const postId = newPostId();

    const { buffer, template } = await memeGenerator.render({
      topText: draft.meme.topText,
      bottomText: draft.meme.bottomText,
      footer: config.memeGenerator.footer,
    });

    // Write the image here rather than in the publish step, so a dry run
    // leaves something you can actually open and look at. Reviewing the post
    // is the entire point of a dry run.
    const memePath = path.join(config.paths.output, `${postId}.png`);
    await fs.mkdir(config.paths.output, { recursive: true });
    await fs.writeFile(memePath, buffer);

    const post = {
      id: postId,
      articleId: article.id,
      articleUrl: article.url,
      articleTitle: article.title,
      text: humanized.text,
      hook: draft.hook,
      hashtags: draft.hashtags,
      shape: draft.shape,
      openingStyle: draft.openingStyle,
      topics: article.topics ?? [],
      memeTemplate: template,
      memePath,
      memeText: draft.meme,
      curationReason: article.curation?.reason ?? '',
      angle: article.curation?.angle ?? '',
      humanizerReport: humanized.report,
      hookScoreboard: draft.hookScoreboard,
      status: 'draft',
      createdAt: new Date().toISOString(),
    };

    await store.savePost(post);

    return { post, imageBuffer: buffer };
  }

  /** Send one finished post out. */
  async function act({ post, imageBuffer }) {
    try {
      const result = await publisher.publish({
        text: post.text,
        imageBuffer,
        imageAltText: `Meme about: ${post.articleTitle}`,
        postId: post.id,
        memePath: post.memePath,
      });

      const patch = {
        status: result.dryRun ? 'draft' : 'published',
        publishedAt: new Date().toISOString(),
        providerPostId: result.providerPostId ?? null,
        providerUrl: result.url ?? null,
        memePath: result.imagePath ?? post.memePath,
      };

      await store.updatePost(post.id, patch);

      // Mark the article used so we never post about it twice.
      await store.updateArticle(post.articleId, { usedInPostId: post.id });

      log.info('Post handled', { postId: post.id, status: patch.status, url: patch.providerUrl });
      return { ...post, ...patch };
    } catch (error) {
      await store.updatePost(post.id, { status: 'failed', error: error.message });
      log.error('Publishing failed', { postId: post.id, error: error.message });
      throw error;
    }
  }

  /* --- learn ------------------------------------------------------------- */

  /** Pull in engagement numbers and refresh what the prompts know. */
  async function learn() {
    const updated = await analytics.refreshMetrics();
    const learnings = await analytics.summarize();
    return { metricsUpdated: updated, learnings };
  }

  /* --- the whole loop ---------------------------------------------------- */

  return {
    perceive,
    reason,
    buildPost,
    act,
    learn,

    /**
     * One full cycle: usually one post, because the scheduler fires three
     * times a week rather than once with three posts.
     *
     * @param {object} [options]
     * @param {number} [options.count]     how many posts to make (default 1)
     * @param {boolean} [options.publish]  false = build it but hold it back
     */
    async run({ count = 1, publish = true } = {}) {
      const startedAt = Date.now();
      resetUsage();

      if (await store.isPaused()) {
        log.warn('Agent is paused, skipping this run');
        return { skipped: 'paused', posts: [] };
      }

      const perceived = await perceive();
      const picked = await reason(count);

      if (!picked.length) {
        log.warn('Nothing worth posting this cycle');
        return { skipped: 'no-candidates', perceived, posts: [] };
      }

      const posts = [];

      for (const article of picked) {
        const built = await buildPost(article);

        if (publish) {
          posts.push(await act(built));
        } else {
          log.info('Holding post back, publish is off', { postId: built.post.id });
          posts.push(built.post);
        }
      }

      // Learning runs last and is never allowed to fail the run.
      let learned = null;
      try {
        learned = await learn();
      } catch (error) {
        log.warn('Learning step failed', { error: error.message });
      }

      const usage = getUsage();

      log.info('Run finished', {
        posts: posts.length,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        llmCalls: usage.calls,
        costUsd: Number(usage.costUsd.toFixed(4)),
      });

      return { perceived, posts, learned, usage };
    },
  };
}

export default { createPipeline };
