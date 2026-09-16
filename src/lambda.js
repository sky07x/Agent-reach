/**
 * AWS Lambda entry points.
 *
 * Two handlers, because they do genuinely different things:
 *
 *   scheduled  EventBridge fires this three times a week. It runs one full
 *              cycle and exits. No cron inside the process: EventBridge is
 *              the scheduler, node-cron is not used here.
 *
 *   api        Function URL or API Gateway serves the same Express admin app.
 *
 * Both reuse the agent across warm invocations, so a warm container skips
 * setup entirely.
 */

import serverless from 'serverless-http';
import { createLogger } from './lib/logger.js';
import { createAgent } from './agent.js';
import { createPipeline } from './pipeline.js';
import { createScheduler } from './scheduler/index.js';
import { createApp } from './app.js';

const log = createLogger('lambda');

/**
 * Content types that must be sent as raw bytes.
 *
 * Without this, serverless-http hands Lambda the body as a UTF-8 string. Every
 * byte above 0x7F is then replaced with the Unicode replacement character, so
 * a PNG arrives starting EF BF BD 50 4E 47 instead of 89 50 4E 47 and no
 * image viewer will open it.
 */
const BINARY_TYPES = ['image/*', 'application/octet-stream', 'font/*'];

/** Built once per container, reused by every warm invocation. */
let cached;

async function getAgent() {
  if (!cached) {
    const agent = await createAgent();
    const pipeline = createPipeline(agent);
    const scheduler = createScheduler({ config: agent.config, pipeline });

    const app = createApp({ agent, pipeline, scheduler });

    cached = {
      agent,
      pipeline,
      scheduler,
      // Wrap once per container rather than on every request.
      handler: serverless(app, { binary: BINARY_TYPES }),
    };
  }

  return cached;
}

/** EventBridge target. One run, one post. */
export async function scheduled(event) {
  const { pipeline } = await getAgent();

  log.info('Scheduled invocation', { source: event?.source, time: event?.time });

  const result = await pipeline.run({ count: Number(event?.count ?? 1) });

  return {
    skipped: result.skipped ?? null,
    posts: result.posts.map((post) => ({ id: post.id, status: post.status, url: post.providerUrl ?? null })),
    usage: result.usage,
  };
}

/** HTTP target for the admin API. */
export async function api(event, context) {
  const { handler } = await getAgent();
  return handler(event, context);
}

export default { scheduled, api };
