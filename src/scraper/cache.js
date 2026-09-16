/**
 * Disk cache for raw feed and article responses.
 *
 * The point is development comfort and politeness: re-running the pipeline
 * ten times while tuning a prompt should not hit TechCrunch ten times.
 *
 * On Lambda this writes to /tmp, which is fine. The cache is a nice-to-have,
 * not state we depend on, so losing it between invocations costs us nothing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function createCache({ directory, ttlMinutes }) {
  const ttlMs = ttlMinutes * 60 * 1000;
  const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const root = onLambda ? path.join('/tmp', 'scrape-cache') : directory;

  function fileFor(key) {
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
    return path.join(root, `${hash}.json`);
  }

  return {
    async get(key) {
      try {
        const raw = JSON.parse(await fs.readFile(fileFor(key), 'utf8'));
        if (Date.now() - raw.savedAt > ttlMs) return null;
        return raw.body;
      } catch {
        // Missing, expired or corrupt cache all mean the same thing: refetch.
        return null;
      }
    },

    async set(key, body) {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(fileFor(key), JSON.stringify({ savedAt: Date.now(), body }));
    },
  };
}
