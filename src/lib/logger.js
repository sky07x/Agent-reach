/**
 * Tiny structured logger.
 *
 * Every module logs the same way, so CloudWatch (or your terminal) shows one
 * consistent shape. We print JSON on Lambda because CloudWatch indexes it, and
 * readable lines locally because humans read them.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const useJson = process.env.LOG_FORMAT === 'json' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function write(level, scope, message, details) {
  if (LEVELS[level] < minLevel) return;

  const time = new Date().toISOString();

  if (useJson) {
    console.log(JSON.stringify({ time, level, scope, message, ...details }));
    return;
  }

  const extra = details && Object.keys(details).length ? ' ' + JSON.stringify(details) : '';
  console.log(`${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}`);
}

/**
 * Make a logger bound to one module, e.g. createLogger('scraper').
 */
export function createLogger(scope) {
  return {
    debug: (message, details) => write('debug', scope, message, details),
    info: (message, details) => write('info', scope, message, details),
    warn: (message, details) => write('warn', scope, message, details),
    error: (message, details) => write('error', scope, message, details),

    /** Child logger for a sub-step, e.g. log.child('rss') -> "scraper:rss". */
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export default { createLogger };
