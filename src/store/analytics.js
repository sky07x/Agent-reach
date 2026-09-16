/**
 * Stage 8 - Learn.
 *
 * Pull engagement numbers back in, work out what has been doing well, and
 * write a short plain-English summary into the store. The curator and the
 * content engine both read that summary into their prompts, which is how the
 * agent's taste shifts over time instead of staying frozen at day one.
 *
 * No LLM call here on purpose. Averaging a few numbers does not need one.
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('analytics');

/** Likes plus weighted comments. Comments are harder to earn, so worth more. */
export function engagementScore(metrics) {
  if (!metrics) return null;
  return (metrics.likes ?? 0) + (metrics.comments ?? 0) * 3;
}

/** Average score for each value of one field, e.g. which opening style wins. */
export function averageBy(posts, field) {
  const groups = new Map();

  for (const post of posts) {
    const key = post[field];
    const score = engagementScore(post.metrics);
    if (!key || score === null) continue;

    const group = groups.get(key) ?? { total: 0, count: 0 };
    group.total += score;
    group.count += 1;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({ key, average: group.total / group.count, posts: group.count }))
    .sort((a, b) => b.average - a.average);
}

export function createAnalytics({ store, publisher }) {
  return {
    /**
     * Refresh metrics for posts that are old enough to have settled.
     * A post less than a day old has not finished collecting engagement.
     */
    async refreshMetrics({ minAgeHours = 24, limit = 20 } = {}) {
      const posts = await store.listRecentPublished(limit);
      const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;
      let updated = 0;

      for (const post of posts) {
        if (!post.providerPostId) continue;
        if (new Date(post.publishedAt).getTime() > cutoff) continue;

        const metrics = await publisher.getMetrics(post.providerPostId);
        if (!metrics) continue;

        await store.updatePost(post.id, { metrics });
        updated += 1;
      }

      log.info('Metrics refreshed', { checked: posts.length, updated });
      return updated;
    },

    /**
     * Turn the numbers into a few lines the prompts can actually use.
     * Stored under the "learnings" state key.
     */
    async summarize({ limit = 20 } = {}) {
      const posts = (await store.listRecentPublished(limit)).filter((post) => post.metrics);

      if (posts.length < 3) {
        log.info('Not enough measured posts to learn from yet', { measured: posts.length });
        return null;
      }

      const scored = posts
        .map((post) => ({ ...post, score: engagementScore(post.metrics) }))
        .sort((a, b) => b.score - a.score);

      const best = scored.slice(0, 3);
      const worst = scored.slice(-2);

      const byShape = averageBy(posts, 'shape');
      const byStyle = averageBy(posts, 'openingStyle');
      const byTemplate = averageBy(posts, 'memeTemplate');

      const lines = [];

      if (byShape.length > 1) {
        lines.push(`Post shapes that land: ${byShape.slice(0, 2).map((entry) => entry.key).join(', ')}. Weakest: ${byShape.at(-1).key}.`);
      }

      if (byStyle.length > 1) {
        lines.push(`Opening styles that land: ${byStyle.slice(0, 2).map((entry) => entry.key).join(', ')}. Weakest: ${byStyle.at(-1).key}.`);
      }

      if (byTemplate.length > 1) {
        lines.push(`Meme templates that land: ${byTemplate.slice(0, 2).map((entry) => entry.key).join(', ')}.`);
      }

      lines.push(`Best performing hooks recently:\n${best.map((post) => `  "${post.hook}"`).join('\n')}`);

      if (worst.length) {
        lines.push(`Weakest recently (avoid lines like these):\n${worst.map((post) => `  "${post.hook}"`).join('\n')}`);
      }

      const topTopics = [...new Set(best.flatMap((post) => post.topics ?? []))].slice(0, 5);
      if (topTopics.length) lines.push(`Topics that did well: ${topTopics.join(', ')}.`);

      const learnings = {
        summary: lines.join('\n'),
        measuredPosts: posts.length,
        updatedAt: new Date().toISOString(),
      };

      await store.setState('learnings', learnings);
      log.info('Learnings updated', { measuredPosts: posts.length });

      return learnings;
    },
  };
}

export default { createAnalytics, engagementScore, averageBy };
