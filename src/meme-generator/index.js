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
import { createRotation } from '../lib/rotation.js';
import { MEDIA_TREATMENTS, getTreatment, isTextOnly, pickTemplate } from './media.js';

const log = createLogger('meme-generator');

/** Fall back to something sensible when the model gives us nothing. */
function withFallback(text, fallback) {
  const cleaned = String(text ?? '').trim();
  return cleaned || fallback;
}

export function createMemeGenerator({ config, store }) {
  const settings = config.memeGenerator;
  const rotation = createRotation({ store });

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
   * Choose a template that suits the post and has not been seen lately.
   *
   * Both halves of "lately" matter. The old version tracked the template name
   * only, so hot-take followed by red-alert counted as variety when they are
   * the same classic layout in different colours - a third of the library is
   * that one layout.
   */
  async function choose({ preferLayouts = [] } = {}) {
    const templates = await getTemplates();
    const recent = await store.listRecentAttempted(settings.templateHistory);

    const { template, scored } = pickTemplate(templates, {
      recentTemplates: recent.map((post) => post.memeTemplate).filter(Boolean),
      recentLayouts: recent.map((post) => post.memeLayout).filter(Boolean),
      cooldown: settings.templateCooldown,
      preferLayouts,
      weights: settings.selectionWeights,
    });

    log.debug('Template chosen', {
      picked: template.name,
      layout: template.layout,
      runnerUp: scored[1]?.name,
      affine: scored[0]?.affine,
    });

    return template;
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
     * @param {string} [input.footer]         small credit line, e.g. the source
     * @param {string} [input.templateName]   force a specific template
     * @param {string} [input.treatment]      which media treatment to render at
     * @param {string[]} [input.preferLayouts] layouts that suit this post
     * @returns {Promise<{buffer: Buffer, template: string, layout: string, treatment: string}|null>}
     *   null when the treatment is text-only, which is a real choice and not
     *   a failure - callers must handle a post with no picture.
     */
    async render({ topText, bottomText, footer, templateName, treatment = 'meme-square', preferLayouts }) {
      if (isTextOnly(treatment)) {
        log.info('Text-only post, no image rendered', { treatment });
        return null;
      }

      const templates = await getTemplates();
      const { width, height } = getTreatment(treatment);

      const template = templateName
        ? templates.find((candidate) => candidate.name === templateName)
        : await choose({ preferLayouts });

      if (!template) throw new Error(`No meme template named "${templateName}"`);

      const svg = renderSvg({
        template,
        width,
        height,
        topText: withFallback(topText, 'ANOTHER DAY'),
        bottomText: withFallback(bottomText, 'ANOTHER MODEL'),
        footer,
      });

      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

      log.info('Meme rendered', {
        template: template.name,
        layout: template.layout,
        treatment,
        size: `${width}x${height}`,
        bytes: buffer.length,
      });

      return { buffer, template: template.name, layout: template.layout, treatment };
    },

    /** Render and write to disk. Returns null for a text-only post. */
    async renderToFile(input, filePath) {
      const rendered = await this.render(input);
      if (!rendered) return null;

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, rendered.buffer);

      return { ...rendered, path: filePath };
    },

    /**
     * Which media treatment this post gets.
     *
     * Same store-backed rotation as the writing side, so it survives a cold
     * Lambda and rebuilds itself from post history if the counter is lost.
     * It counts posts that recorded a treatment, so the older posts from
     * before this existed do not skew the position.
     */
    async nextTreatment(names) {
      return (await rotation.next({
        key: 'mediaRotationIndex',
        names,
        known: MEDIA_TREATMENTS,
        seed: (posts) => posts.filter((post) => post.mediaTreatment).length,
      })) ?? 'meme-square';
    },
  };
}

export default { createMemeGenerator };
