/**
 * The safe provider: writes the post to disk and prints it, publishes nothing.
 *
 * This is the default (PUBLISHER=console) and it is what DRY_RUN falls back
 * to, so nothing reaches LinkedIn until you deliberately switch it over.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('publisher:console');

export function createConsoleProvider({ outputDirectory }) {
  return {
    name: 'console',

    async verify() {
      return { ok: true, memberId: 'dry-run', name: 'console provider', matchesConfig: true };
    },

    async publish({ text, imageBuffer, postId, memePath }) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = `${stamp}-${postId ?? 'post'}`;

      await fs.mkdir(outputDirectory, { recursive: true });

      const textPath = path.join(outputDirectory, `${baseName}.txt`);
      await fs.writeFile(textPath, text);

      // The pipeline already wrote the image, so point at that rather than
      // saving a second identical copy next to it.
      const imagePath = memePath ?? null;

      console.log(`\n${'='.repeat(64)}\nWOULD POST TO LINKEDIN\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}\n`);
      log.info('Saved instead of publishing', { textPath, imagePath });

      return { providerPostId: null, url: null, textPath, imagePath, dryRun: true };
    },

    async getMetrics() {
      return null;
    },
  };
}

export default { createConsoleProvider };
