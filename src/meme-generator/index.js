/**
 * Stage 6 - Meme image.
 *
 * Everything is drawn locally with sharp. No image-generation API, no cost
 * per image (Section 6 and Section 8 both insist on this).
 *
 * A template is a small JSON file in assets/meme-templates/. It picks a
 * layout from layouts.js and supplies the colours, so adding a new look means
 * adding one file and nothing else.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createLogger } from '../lib/logger.js';
import { renderSvg, LAYOUTS } from './layouts.js';

const log = createLogger('meme-generator');

/** Fall back to something sensible when the model gives us nothing. */
function withFallback(text, fallback) {
  const cleaned = String(text ?? '').trim();
  return cleaned || fallback;
}

export function createMemeGenerator({ config, store }) {
  const settings = config.memeGenerator;

  /** Read every template JSON file once per process. */
  let templatesPromise;

  async function loadTemplates() {
    const files = await fs.readdir(config.paths.memeTemplates);
    const templates = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const raw = await fs.readFile(path.join(config.paths.memeTemplates, file), 'utf8');
      const template = JSON.parse(raw);

      if (!LAYOUTS[template.layout]) {
        log.warn('Skipping template with unknown layout', { file, layout: template.layout });
        continue;
      }

      templates.push(template);
    }

    if (!templates.length) throw new Error(`No usable templates in ${config.paths.memeTemplates}`);

    log.debug('Templates loaded', { count: templates.length });
    return templates;
  }

  function getTemplates() {
    if (!templatesPromise) templatesPromise = loadTemplates();
    return templatesPromise;
  }

  /**
   * Choose a template we have not used recently, so the feed does not start
   * looking repetitive.
   */
  async function pickTemplate() {
    const templates = await getTemplates();
    const recent = await store.listRecentPublished(settings.templateCooldown);
    const recentlyUsed = new Set(recent.map((post) => post.memeTemplate).filter(Boolean));

    const available = templates.filter((template) => !recentlyUsed.has(template.name));
    const pool = available.length ? available : templates;

    return pool[Math.floor(Math.random() * pool.length)];
  }

  return {
    /** Names of every template currently installed. */
    async listTemplates() {
      return (await getTemplates()).map((template) => template.name);
    },

    /**
     * Render one meme.
     *
     * @param {object} input
     * @param {string} input.topText
     * @param {string} input.bottomText
     * @param {string} [input.footer]        small credit line, e.g. the source
     * @param {string} [input.templateName]  force a specific template
     * @returns {Promise<{buffer: Buffer, template: string}>}
     */
    async render({ topText, bottomText, footer, templateName }) {
      const templates = await getTemplates();

      const template = templateName
        ? templates.find((candidate) => candidate.name === templateName)
        : await pickTemplate();

      if (!template) throw new Error(`No meme template named "${templateName}"`);

      const svg = renderSvg({
        template,
        width: settings.width,
        height: settings.height,
        topText: withFallback(topText, 'ANOTHER DAY'),
        bottomText: withFallback(bottomText, 'ANOTHER MODEL'),
        footer,
      });

      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

      log.info('Meme rendered', { template: template.name, bytes: buffer.length });
      return { buffer, template: template.name };
    },

    /** Render and write to disk. Returns the file path. */
    async renderToFile(input, filePath) {
      const { buffer, template } = await this.render(input);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);

      return { path: filePath, template };
    },
  };
}

export default { createMemeGenerator };
