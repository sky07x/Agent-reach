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
import { countWords } from './content-engine/index.js';
import { getShape } from './content-engine/shapes.js';
import { structuralProblems } from './content-engine/quality.js';
import { applyRules, splitOffHashtags, reattachHashtags } from './humanizer/index.js';
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

  /**
   * Choose which stories deserve a post.
   *
   * A few spares are ranked as well, in order, because the content engine can
   * now turn a story down for having nothing in it. Without a stand-in, a
   * thin story would mean no post at all.
   */
  async function reason(count) {
    const candidates = await store.listPostableArticles({ maxAgeDays: config.scraper.maxArticleAgeDays });

    log.info('Candidates for curation', { count: candidates.length });

    const spares = config.content.insight?.enabled ? (config.content.insight.spareStories ?? 0) : 0;
    const picked = await curator.curate(candidates, count + spares);

    // Only fetch the full article body for the few stories we will write about.
    const enriched = await scraper.enrich(picked);

    for (const article of enriched) {
      await store.updateArticle(article.id, {
        curation: article.curation,
        topics: article.topics,
        guessedFrame: article.guessedFrame,
        memeScore: article.memeScore,
        body: article.body,
      });
    }

    return enriched;
  }

  /* --- act --------------------------------------------------------------- */

  /**
   * Turn one curated article into a finished, humanized, illustrated post.
   *
   * @returns {Promise<object|null>} null when the story was turned down as
   *   too thin to post about. It is marked so it is not offered again.
   */
  async function buildPost(article) {
    const draft = await contentEngine.generate(article);

    if (draft.rejected) {
      log.warn('Story turned down, nothing worth saying about it', { title: article.title, reason: draft.rejected });

      await store.updateArticle(article.id, {
        rejectedForPost: draft.rejected,
        insight: draft.insight ?? null,
      });

      return null;
    }

    let humanized = await humanizer.humanize(draft.text, { shapeNote: draft.shapeInstruction });

    // The editor pass runs after the quality gate, so what it changes was
    // never checked. It is a language model, and it will happily turn a
    // plain line into "This shows safety isn't always the priority." If it
    // added a problem the gated draft did not have, ship the gated draft
    // with only the mechanical rules applied.
    if (!draft.needsReview) {
      const firstLine = (text) => text.split('\n').find((line) => line.trim()) ?? '';
      const authorContext = config.content.authorContext;
      const before = new Set(structuralProblems({ article, draft, authorContext }));
      const introduced = structuralProblems({
        article,
        draft: { ...draft, text: humanized.text, hook: firstLine(humanized.text) },
        authorContext,
      }).filter((problem) => !before.has(problem));

      if (introduced.length) {
        log.warn('The editor pass broke a checked post, keeping the checked version', { introduced });

        const { prose, hashtagLine } = splitOffHashtags(draft.text);
        const ruled = applyRules(prose, { maxEmDashes: config.humanizer.maxEmDashes });

        humanized = {
          text: reattachHashtags(ruled.text, hashtagLine),
          report: { ...humanized.report, editorPass: 'reverted', editorIntroduced: introduced },
        };
      }
    }

    const postId = newPostId();

    const treatment = await memeGenerator.nextTreatment(config.memeGenerator.treatments);

    // The picture is chosen to suit the post, not drawn from a hat: a
    // terminal-log post asks for a terminal, a quote-reaction for a quote.
    const rendered = await memeGenerator.render({
      topText: draft.meme.topText,
      bottomText: draft.meme.bottomText,
      footer: config.memeGenerator.footer,
      treatment,
      preferLayouts: getShape(draft.shape).layouts,
    });

    // Null is a real answer, not a failure: this post is text-only.
    let memePath = null;

    if (rendered) {
      // Write the image here rather than in the publish step, so a dry run
      // leaves something you can actually open and look at. Reviewing the
      // post is the entire point of a dry run.
      memePath = path.join(config.paths.output, `${postId}.png`);
      await fs.mkdir(config.paths.output, { recursive: true });
      await fs.writeFile(memePath, rendered.buffer);
    }

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
      closerStyle: draft.closerStyle,
      lengthMood: draft.lengthMood,
      // Recounted after the humanizer, which is allowed to shorten the post.
      words: countWords(humanized.text),
      targetWords: draft.targetWords,
      topics: article.topics ?? [],
      frame: article.curation?.frame ?? null,
      mediaTreatment: treatment,
      memeTemplate: rendered?.template ?? null,
      memeLayout: rendered?.layout ?? null,
      memePath,
      memeText: draft.meme,
      curationReason: article.curation?.reason ?? '',
      angle: article.curation?.angle ?? '',
      // What the post was meant to say, so a reviewer can check it did.
      insight: draft.insight ?? null,
      humanizerReport: humanized.report,
      hookScoreboard: draft.hookScoreboard,
      hashtagReasons: draft.hashtagReasons,
      quality: draft.quality,
      needsReview: Boolean(draft.needsReview),
      // A post that failed the quality gate is parked, not published. A gate
      // that only logs is not a gate.
      status: draft.needsReview ? "held" : "draft",
      createdAt: new Date().toISOString(),
    };

    await store.savePost(post);

    return { post, imageBuffer: rendered?.buffer ?? undefined };
  }

  /** Send one finished post out. */
  async function act({ post, imageBuffer }) {
    // The last line of defence. A post the judge rejected does not go out on
    // a schedule; it waits for a person. This is checked here as well as at
    // the point it was written, because act() is reachable on its own.
    if (post.needsReview) {
      log.warn('Holding a post back, it did not pass the quality gate', {
        postId: post.id,
        score: post.quality?.score,
        verdict: post.quality?.verdict,
      });

      return { ...post, status: 'held' };
    }

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
        needsReview: false,
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
      const rejected = [];
      let ready = 0;

      // Picks arrive best first. Work down them until enough posts exist; the
      // spares at the end only get used when something above them was thin.
      for (const article of picked) {
        if (ready >= count) break;

        const built = await buildPost(article);

        if (!built) {
          const reread = await store.getArticle(article.id);
          rejected.push({ title: article.title, reason: reread?.rejectedForPost ?? 'too thin' });
          continue;
        }

        // Held after its one rewrite. Two failed attempts say more about the
        // story than about the writing, and in practice this is where thin
        // stories are really caught: the cheap model rates almost every story
        // as substantial, but its judge does notice when the post built on
        // one says nothing. The held post is kept for review; the story is
        // not offered again, and the next pick gets its chance instead of the
        // run publishing nothing.
        if (built.post.needsReview) {
          await store.updateArticle(article.id, { rejectedForPost: `held: ${built.post.quality?.verdict ?? 'failed the quality gate'}` });
          rejected.push({ title: article.title, reason: `written and held: ${built.post.quality?.verdict ?? ''}`, postId: built.post.id });
          posts.push(built.post);
          continue;
        }

        ready += 1;

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

      if (!ready) log.warn('Nothing worth publishing this cycle', { rejected });

      log.info('Run finished', {
        posts: posts.length,
        rejected: rejected.length,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        llmCalls: usage.calls,
        costUsd: Number(usage.costUsd.toFixed(4)),
      });

      return { perceived, posts, rejected, learned, usage };
    },
  };
}

export default { createPipeline };
