/**
 * Store-backed rotations, shared by everything that has to not repeat itself.
 *
 * The rule this encodes was learned the hard way. A counter kept only in the
 * store is a single point of failure: the agent ran with two separate stores
 * for a week, both counters sat near zero, and every run picked option one.
 * Two posts a day apart came out with the same opening style and the same
 * meme template.
 *
 * So a counter here is a cache, not the source of truth. When it is missing -
 * a fresh table, a migration, a store that was swapped underneath us - it is
 * rebuilt by counting the posts that actually used that rotation, and the
 * feed carries on instead of starting again from the top.
 *
 * Each rotation counts its own posts, because they do not all advance once
 * per post: the endings rotation skips shapes that end themselves, and the
 * media rotation skips posts that were published without an image.
 */

import { createLogger } from './logger.js';

const log = createLogger('rotation');

/**
 * How far back to look when a counter has to be rebuilt.
 *
 * Only the count modulo the rotation length matters, so this needs to cover
 * far more posts than any rotation is long, not the whole archive.
 */
export const SEED_LIMIT = 500;

export function createRotation({ store }) {
  return {
    /**
     * Take the next value and remember that we did.
     *
     * @param {object} options
     * @param {string} options.key      state key holding the counter
     * @param {string[]} options.names  the rotation, in order
     * @param {object} options.known    definitions, to drop names that no longer exist
     * @param {function} options.seed   given recent posts, how many used this rotation
     * @returns {Promise<string|null>}  null only if nothing in names is usable
     */
    async next({ key, names, known, seed }) {
      const usable = (names ?? []).filter((name) => !known || known[name]);
      if (!usable.length) return null;

      let index = await store.getState(key, null);

      if (index === null || index === undefined) {
        index = seed ? seed(await store.listPosts(SEED_LIMIT)) : 0;
        log.info('Counter was missing, seeded from post history', { key, index });
      }

      index = Number(index) || 0;
      await store.setState(key, index + 1);

      return usable[index % usable.length];
    },
  };
}

export default { createRotation, SEED_LIMIT };
