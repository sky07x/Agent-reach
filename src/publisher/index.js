/**
 * Stage 7 (second half) - Publish.
 *
 * The scheduler only ever sees this interface: publish(), verify(),
 * getMetrics(). Swapping providers is a config change.
 *
 * DRY_RUN wins over everything. If it is on, we hand back the console
 * provider no matter what PUBLISHER says, so a misconfigured env cannot post
 * something you have not read.
 */

import { createLogger } from '../lib/logger.js';
import { createLinkedInProvider } from './linkedin-provider.js';
import { createConsoleProvider } from './console-provider.js';

const log = createLogger('publisher');

export function createPublisher({ config }) {
  const consoleProvider = createConsoleProvider({ outputDirectory: config.paths.output });

  if (config.dryRun) {
    log.warn('DRY_RUN is on. Nothing will be published.');
    return consoleProvider;
  }

  if (config.publisher.provider === 'linkedin') {
    log.info('Publishing live to LinkedIn');
    return createLinkedInProvider({ settings: config.publisher.linkedin });
  }

  return consoleProvider;
}

export default { createPublisher };
