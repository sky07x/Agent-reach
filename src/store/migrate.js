/**
 * Move the local JSON store into the real one, without losing anything.
 *
 * The agent kept two separate memories: local runs wrote ./data/*.json, and
 * Lambda wrote DynamoDB. Neither knew the other existed, so both rotation
 * counters sat near zero and both picked option one. That is how two posts a
 * day apart came out with the same opening style and the same meme template.
 *
 * The rules here all follow from one idea: a migration must never make the
 * agent forget something it already knew.
 *
 *   articles and posts   copied if missing. An existing row wins, because the
 *                        target is the live store and it may well be ahead.
 *   rotation counters    the HIGHEST of the two, never the newest. A counter
 *                        going backwards replays a stretch of the rotation,
 *                        which is the exact bug we are here to fix.
 *   everything else      the most recently updated wins.
 *
 * All of which makes it safe to run twice.
 */

import { createLogger } from '../lib/logger.js';
import { COLLECTIONS } from './index.js';

const log = createLogger('store-migrate');

/**
 * State keys that count upwards and must never go down.
 *
 * Matched by suffix rather than listed one by one, so a rotation added later
 * is protected without anyone having to remember this file exists.
 */
export const COUNTER_SUFFIX = 'RotationIndex';

export function isCounter(key) {
  return String(key).endsWith(COUNTER_SUFFIX);
}

/**
 * Decide what a single state row should become.
 *
 * @returns {{value: *, reason: string}}
 */
export function mergeStateRow(key, source, target) {
  if (!target) return { value: source.value, reason: 'not in target' };
  if (!source) return { value: target.value, reason: 'not in source' };

  if (isCounter(key)) {
    const from = Number(source.value) || 0;
    const to = Number(target.value) || 0;

    // Deliberately not "newest wins". A stale local counter of 12 against a
    // fresh remote 0 must land on 12: replaying twelve posts of the rotation
    // is exactly the repetition this whole exercise is about.
    return from > to
      ? { value: from, reason: `counter raised ${to} -> ${from}` }
      : { value: to, reason: `counter already at ${to}` };
  }

  const sourceAt = String(source.updatedAt ?? '');
  const targetAt = String(target.updatedAt ?? '');

  return sourceAt > targetAt
    ? { value: source.value, reason: 'source is newer' }
    : { value: target.value, reason: 'target is newer or equal' };
}

/**
 * Copy one collection of plain records across, skipping anything already there.
 *
 * @returns {Promise<{copied: number, skipped: number}>}
 */
async function migrateRecords(collection, source, target, { apply }) {
  const rows = await source.list(collection);
  let copied = 0;
  let skipped = 0;

  for (const row of rows) {
    if (await target.get(collection, row.id)) {
      skipped += 1;
      continue;
    }

    if (apply) await target.put(collection, row);
    copied += 1;
  }

  return { copied, skipped };
}

/**
 * Merge the local store into the target store.
 *
 * @param {object} options
 * @param {object} options.source  driver to read from, usually json
 * @param {object} options.target  driver to write to, usually dynamo
 * @param {boolean} [options.apply]  false only reports what it would do
 */
export async function migrateStore({ source, target, apply = false }) {
  await source.init();
  await target.init();

  const articles = await migrateRecords(COLLECTIONS.articles, source, target, { apply });
  const posts = await migrateRecords(COLLECTIONS.posts, source, target, { apply });

  const sourceState = await source.list(COLLECTIONS.state);
  const state = [];

  for (const row of sourceState) {
    const existing = await target.get(COLLECTIONS.state, row.id);
    const { value, reason } = mergeStateRow(row.id, row, existing);

    const changed = !existing || JSON.stringify(existing.value) !== JSON.stringify(value);

    if (changed && apply) {
      await target.put(COLLECTIONS.state, {
        id: row.id,
        value,
        updatedAt: new Date().toISOString(),
      });
    }

    state.push({
      key: row.id,
      from: row.value,
      to: value,
      changed,
      reason,
    });
  }

  const summary = { apply, articles, posts, state };

  log.info(apply ? 'Migration applied' : 'Migration preview', {
    articles: `${articles.copied} copied, ${articles.skipped} already there`,
    posts: `${posts.copied} copied, ${posts.skipped} already there`,
    stateChanged: state.filter((row) => row.changed).length,
  });

  return summary;
}

export default { migrateStore, mergeStateRow, isCounter };
