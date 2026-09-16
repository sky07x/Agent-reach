/**
 * The admin API.
 *
 * Small on purpose: enough to debug and steer the agent without a redeploy,
 * and nothing more. Everything except /health needs the admin key, because
 * POST /run can put a real post on a real profile.
 */

import fs from 'node:fs/promises';
import express from 'express';
import { createLogger } from './lib/logger.js';
import { getUsage } from './lib/llm-client.js';

const log = createLogger('api');

/** Wrap an async route so a rejected promise becomes a 500, not a hang. */
function route(handler) {
  return (req, res) => {
    handler(req, res).catch((error) => {
      log.error('Request failed', { path: req.path, error: error.message });
      res.status(500).json({ error: error.message });
    });
  };
}

export function createApp({ agent, pipeline, scheduler }) {
  const app = express();
  app.use(express.json());

  /* --- open ------------------------------------------------------------- */

  app.get('/health', (req, res) => {
    // On Lambda the in-process cron is never started, because EventBridge is
    // the scheduler. Reporting the node-cron status there would say
    // "active: false" while the agent is in fact posting three times a week,
    // which is exactly the wrong thing to tell someone checking on it.
    const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

    res.json({
      ok: true,
      agent: agent.config.agentName,
      dryRun: agent.config.dryRun,
      publisher: agent.publisher.name,
      store: agent.store.driver,
      willPublish: !agent.config.dryRun && agent.publisher.name === 'linkedin',
      schedule: onLambda
        ? {
          runBy: 'aws-eventbridge',
          readable: 'Tue/Wed/Thu at 9:30 Asia/Kolkata (04:00 UTC)',
          note: 'Check the real state with: aws events describe-rule --name '
            + `${agent.config.agentName}-post-schedule`,
        }
        : { runBy: 'node-cron', ...scheduler.status() },
    });
  });

  /* --- everything below needs the key ----------------------------------- */

  app.use((req, res, next) => {
    const key = agent.config.server.adminApiKey;

    if (!key) {
      return res.status(503).json({ error: 'ADMIN_API_KEY is not set, admin routes are disabled' });
    }

    if (req.get('authorization') !== `Bearer ${key}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  });

  /** Trigger a cycle by hand. ?dryRun=true builds the post but holds it back. */
  app.post('/run', route(async (req, res) => {
    const holdBack = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const count = Number(req.query.count ?? req.body?.count ?? 1);

    const result = await pipeline.run({ count, publish: !holdBack });

    res.json({
      skipped: result.skipped ?? null,
      posts: result.posts.map((post) => ({
        id: post.id,
        status: post.status,
        hook: post.hook,
        text: post.text,
        url: post.providerUrl ?? null,
        article: post.articleUrl,
        why: post.curationReason,
      })),
      usage: result.usage ?? getUsage(),
    });
  }));

  /** The last N posts, newest first. */
  app.get('/posts', route(async (req, res) => {
    const limit = Number(req.query.limit ?? 10);
    res.json(await agent.store.listPosts(limit));
  }));

  /** One post in full, including the humanizer report and hook scoreboard. */
  app.get('/posts/:id', route(async (req, res) => {
    const post = await agent.store.getPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'No such post' });
    return res.json(post);
  }));

  /** The rendered meme for a post, handy for eyeballing it in a browser. */
  app.get('/posts/:id/image', route(async (req, res) => {
    const post = await agent.store.getPost(req.params.id);
    if (!post?.memePath) return res.status(404).json({ error: 'No image for this post' });

    try {
      res.type('png').send(await fs.readFile(post.memePath));
    } catch {
      res.status(404).json({ error: 'Image file is gone (Lambda disk is temporary)' });
    }
    return undefined;
  }));

  app.post('/pause', route(async (req, res) => {
    await agent.store.setPaused(true);
    log.warn('Agent paused via API');
    res.json({ paused: true });
  }));

  app.post('/resume', route(async (req, res) => {
    await agent.store.setPaused(false);
    log.info('Agent resumed via API');
    res.json({ paused: false });
  }));

  /** Check the LinkedIn token without posting anything. */
  app.get('/publisher/verify', route(async (req, res) => {
    res.json(await agent.publisher.verify());
  }));

  /**
   * Render a meme right now and return the PNG.
   *
   * This is the deployed version of `npm run templates:preview`. It exists
   * mainly to answer one question after a deploy: are the fonts working?
   * Lambda ships no fonts, and when fontconfig cannot find the bundled ones
   * sharp draws the background and silently leaves the text off. Opening
   * this in a browser tells you in one second.
   */
  app.get('/preview-meme', route(async (req, res) => {
    const { buffer, template } = await agent.memeGenerator.render({
      topText: String(req.query.top ?? 'If you can read this'),
      bottomText: String(req.query.bottom ?? 'then the fonts are working'),
      footer: agent.config.memeGenerator.footer,
      templateName: req.query.template ? String(req.query.template) : undefined,
    });

    res.set('X-Meme-Template', template).type('png').send(buffer);
  }));

  /** What the agent currently believes works. */
  app.get('/learnings', route(async (req, res) => {
    res.json(await agent.store.getState('learnings', { summary: 'Nothing learned yet.' }));
  }));

  /** Config as it is actually loaded, secrets stripped out. */
  app.get('/config', route(async (req, res) => {
    const { llm, publisher, server, ...safe } = agent.config;

    res.json({
      ...safe,
      llm: { provider: llm.provider, model: llm.model, apiKeySet: Boolean(llm.apiKey) },
      publisher: {
        provider: publisher.provider,
        linkedin: {
          memberIdSet: Boolean(publisher.linkedin.memberId),
          tokenSet: Boolean(publisher.linkedin.accessToken),
          appCredentialsSet: Boolean(publisher.linkedin.clientId && publisher.linkedin.clientSecret),
        },
      },
    });
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

export default { createApp };
