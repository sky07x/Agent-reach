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
 * @param {object} [overrides] swap in fakes for tests, e.g. { llm, store }
 */
export async function createAgent(overrides = {}) {
  const config = overrides.config ?? defaultConfig;

  const llm = overrides.llm ?? createLlmClient(config.llm);
  const store = overrides.store ?? createStore(config);
  await store.init();

  const publisher = overrides.publisher ?? createPublisher({ config });

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
