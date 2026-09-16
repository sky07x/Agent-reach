/**
 * Stage 7 (first half) - Schedule.
 *
 * Locally this is node-cron. On Lambda it is EventBridge, and this file is
 * not used at all: AWS calls the handler directly on the same cron
 * expression. Both read the schedule from config, so there is one source of
 * truth for when posts go out.
 *
 * Default is Tue/Wed/Thu 09:30 Asia/Kolkata, which is three posts a week.
 */

import cron from 'node-cron';
import { createLogger } from '../lib/logger.js';

const log = createLogger('scheduler');

/** Turn "30 9 * * 2,3,4" into something a person can read in a log line. */
export function describeCron(expression) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [minute, hour, , , weekdays] = expression.split(/\s+/);

  if (weekdays === '*') return `every day at ${hour}:${minute.padStart(2, '0')}`;

  const days = weekdays.split(',').map((day) => dayNames[Number(day) % 7] ?? day).join('/');
  return `${days} at ${hour}:${minute.padStart(2, '0')}`;
}

export function createScheduler({ config, pipeline }) {
  let task = null;
  let running = false;
  let lastRun = null;

  /**
   * Run one cycle, guarding against overlap. A slow run must never have a
   * second run start on top of it.
   */
  async function runOnce(reason) {
    if (running) {
      log.warn('Previous run still going, skipping this trigger', { reason });
      return { skipped: 'already-running' };
    }

    running = true;

    try {
      log.info('Run triggered', { reason });
      const result = await pipeline.run({ count: 1 });
      lastRun = { at: new Date().toISOString(), reason, posts: result.posts.length, skipped: result.skipped ?? null };
      return result;
    } catch (error) {
      lastRun = { at: new Date().toISOString(), reason, error: error.message };
      log.error('Run failed', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      running = false;
    }
  }

  return {
    runOnce,

    start() {
      if (task) return;

      if (!cron.validate(config.schedule.cron)) {
        throw new Error(`SCHEDULE_CRON is not a valid cron expression: "${config.schedule.cron}"`);
      }

      // node-cron v4 starts the task as soon as it is created.
      task = cron.schedule(
        config.schedule.cron,
        () => { runOnce('cron').catch(() => {}); },
        { timezone: config.schedule.timezone, name: 'post-cycle' },
      );

      log.info('Scheduler started', {
        cron: config.schedule.cron,
        readable: describeCron(config.schedule.cron),
        timezone: config.schedule.timezone,
        postsPerWeek: config.schedule.postsPerWeek,
        nextRun: task.getNextRun()?.toISOString() ?? null,
      });
    },

    stop() {
      task?.stop();
      task?.destroy();
      task = null;
      log.info('Scheduler stopped');
    },

    status() {
      return {
        active: Boolean(task),
        running,
        nextRun: task?.getNextRun()?.toISOString() ?? null,
        cron: config.schedule.cron,
        readable: describeCron(config.schedule.cron),
        timezone: config.schedule.timezone,
        postsPerWeek: config.schedule.postsPerWeek,
        lastRun,
      };
    },
  };
}

export default { createScheduler, describeCron };
