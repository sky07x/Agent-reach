/**
 * Stores each collection as one JSON file under data/.
 *
 * Good for local development, tests and dry runs. Not for Lambda: that disk
 * disappears between invocations, which would wipe the dedupe and post
 * history the agent relies on. Use the DynamoDB driver there.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export function createJsonDriver({ directory }) {
  /** Collections are small, so we keep them in memory and write on change. */
  const cache = new Map();

  function fileFor(collection) {
    return path.join(directory, `${collection}.json`);
  }

  async function load(collection) {
    if (cache.has(collection)) return cache.get(collection);

    let items = [];
    try {
      items = JSON.parse(await fs.readFile(fileFor(collection), 'utf8'));
    } catch (error) {
      // A missing file just means an empty collection. Anything else is real.
      if (error.code !== 'ENOENT') throw error;
    }

    cache.set(collection, items);
    return items;
  }

  async function save(collection, items) {
    cache.set(collection, items);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(fileFor(collection), JSON.stringify(items, null, 2));
  }

  return {
    name: 'json',

    async init() {
      await fs.mkdir(directory, { recursive: true });
    },

    async get(collection, id) {
      const items = await load(collection);
      return items.find((item) => item.id === id) ?? null;
    },

    async put(collection, item) {
      const items = await load(collection);
      const index = items.findIndex((existing) => existing.id === item.id);

      if (index === -1) items.push(item);
      else items[index] = { ...items[index], ...item };

      await save(collection, items);
      return item;
    },

    /**
     * Write many rows at once, overwriting rather than merging.
     *
     * This used to call put() in a loop, which merges. The DynamoDB driver
     * cannot merge in a batch write, so the two drivers quietly disagreed
     * about what putMany means. Nothing depended on it - saveNewArticles is
     * the only caller and it passes only new rows - but two drivers behind
     * one interface behaving differently is a bug waiting for a reader.
     */
    async putMany(collection, newItems) {
      const items = await load(collection);
      const byId = new Map(items.map((item) => [item.id, item]));

      for (const item of newItems) byId.set(item.id, item);

      await save(collection, [...byId.values()]);
      return newItems;
    },

    async list(collection) {
      return [...(await load(collection))];
    },

    async remove(collection, id) {
      const items = await load(collection);
      await save(collection, items.filter((item) => item.id !== id));
    },
  };
}
