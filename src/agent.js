/**
 * Builds the agent: one place where every module is constructed and wired.
 *
 * Nothing else in the codebase calls a constructor, so tests can build an
 * agent with a fake LLM or a fake store by passing overrides here.
 */

import { createLlmClient } from './lib/llm-client.js';
import { createLogger } from './lib/logger.js';
import { config as defaultConfig } from './config/index.js';
import { createStore } from './store/index.js';
import { createAnalytics } from './store/analytics.js';
import { createScraper } from './scraper/index.js';
import { createClassifier } from './classifier/index.js';
import { createCurator } from './curator/index.js';
import { createContentEngine } from './content-engine/index.js';
import { createHumanizer } from './humanizer/index.js';
import { createMemeGenerator } from './meme-generator/index.js';
import { createPublisher } from './publisher/index.js';

const log = createLogger('agent');

/**
 * Refuse to publish for real while writing the record to a local JSON file.
 *
 * This is the configuration that caused the whole problem. A post published
 * from a laptop was recorded in ./data, the scheduled Lambda recorded its own
 * in DynamoDB, and neither could see the other. Both rotation counters stayed
 * near zero, so both posts used the first opening style and a randomly picked
 * template out of a full pool. They came out looking like the same post.
 *
 * Worse than the repetition: the article dedupe is split too, so the same
 * story can go out twice, once from each side.
 *
 * Dry runs and the console provider are unaffected. They write drafts, and a
 * draft written locally costs nothing.
 */
export function assertStoreCanRecordLivePosts({ config, store, publisher }) {
  const willPublish = !config.dryRun && publisher.name === 'linkedin';

  if (!willPublish || store.driver !== 'json') return;

  if (config.store.allowJsonForLivePosts) {
    log.warn('Publishing live while recording to the local JSON store. Lambda cannot see these posts.');
    return;
  }

  throw new Error(
    'Refusing to publish live while STORE_DRIVER=json.\n\n'
    + 'A post published from here would be recorded in ./data, where the\n'
    + 'scheduled Lambda cannot see it. Both sides then reuse the same opening\n'
    + 'styles and meme templates, and the same story can be posted twice.\n\n'
    + 'Use the shared store:   STORE_DRIVER=dynamo\n'
    + 'Bring local history in: npm run store:migrate -- --confirm\n'
    + 'Or accept the split:    ALLOW_JSON_STORE_FOR_LIVE_POSTS=true',
  );
}

/**
 * @param {object} [overrides] swap in fakes for tests, e.g. { llm, store }
 */
export async function createAgent(overrides = {}) {
  const config = overrides.config ?? defaultConfig;

  const llm = overrides.llm ?? createLlmClient(config.llm);
  const store = overrides.store ?? createStore(config);
  await store.init();

  const publisher = overrides.publisher ?? createPublisher({ config });

  assertStoreCanRecordLivePosts({ config, store, publisher });

  const agent = {
    config,
    llm,
    store,
    publisher,
    scraper: overrides.scraper ?? createScraper({ config }),
    classifier: overrides.classifier ?? createClassifier({ config, llm }),
    curator: overrides.curator ?? createCurator({ config, llm, store }),
    contentEngine: overrides.contentEngine ?? createContentEngine({ config, llm, store }),
    humanizer: overrides.humanizer ?? createHumanizer({ config, llm }),
    memeGenerator: overrides.memeGenerator ?? createMemeGenerator({ config, store }),
    analytics: overrides.analytics ?? createAnalytics({ store, publisher }),
  };

  log.info('Agent ready', {
    store: store.driver,
    publisher: publisher.name,
    llm: `${config.llm.provider}/${config.llm.model}`,
    dryRun: config.dryRun,
  });

  return agent;
}

export default { createAgent };
