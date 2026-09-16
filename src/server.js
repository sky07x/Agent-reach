/**
 * Local entry point: starts the admin API and the cron scheduler.
 *
 * On Lambda this file is not used. See src/lambda.js.
 */

import { createLogger } from './lib/logger.js';
import { createAgent } from './agent.js';
import { createPipeline } from './pipeline.js';
import { createScheduler } from './scheduler/index.js';
import { createApp } from './app.js';

const log = createLogger('server');

const agent = await createAgent();
const pipeline = createPipeline(agent);
const scheduler = createScheduler({ config: agent.config, pipeline });
const app = createApp({ agent, pipeline, scheduler });

scheduler.start();

const server = app.listen(agent.config.server.port, () => {
  log.info('Admin API listening', {
    port: agent.config.server.port,
    health: `http://localhost:${agent.config.server.port}/health`,
  });

  if (!agent.config.server.adminApiKey) {
    log.warn('ADMIN_API_KEY is empty, so every admin route returns 503. Set it in .env.');
  }
});

/** Shut down cleanly so an in-flight run is not cut off mid-publish. */
function shutdown(signal) {
  log.info('Shutting down', { signal });
  scheduler.stop();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
