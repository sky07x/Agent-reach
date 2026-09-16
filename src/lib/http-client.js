/**
 * Shared fetch helper: retries, backoff, timeouts and a polite rate limit.
 *
 * Everything that talks to the outside world (TechCrunch, OpenAI, LinkedIn)
 * goes through here, so we only have to get the retry rules right once.
 */

import { createLogger } from './logger.js';

const log = createLogger('http');

/** Wait for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keeps one host from being hammered. We remember the last request time per
 * host and simply wait out the difference before the next one.
 */
const lastRequestAt = new Map();

async function waitForTurn(url, minGapMs) {
  if (!minGapMs) return;

  const host = new URL(url).host;
  const previous = lastRequestAt.get(host) ?? 0;
  const waitFor = previous + minGapMs - Date.now();

  if (waitFor > 0) await sleep(waitFor);
  lastRequestAt.set(host, Date.now());
}

/** 429 and 5xx are worth retrying. A 404 or 401 is not going to fix itself. */
function isRetryable(status) {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * fetch() with timeout, retries and exponential backoff.
 *
 * @param {string} url
 * @param {object} [options]            standard fetch options
 * @param {number} [options.retries]    how many extra attempts (default 3)
 * @param {number} [options.timeoutMs]  per-attempt timeout (default 15000)
 * @param {number} [options.minGapMs]   minimum gap between calls to this host
 */
export async function request(url, options = {}) {
  const {
    retries = 3,
    timeoutMs = 15000,
    minGapMs = 1000,
    ...fetchOptions
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await waitForTurn(url, minGapMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });

      if (response.ok) return response;

      if (!isRetryable(response.status)) {
        const body = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText} from ${url} ${body.slice(0, 300)}`);
      }

      lastError = new Error(`${response.status} ${response.statusText} from ${url}`);
    } catch (error) {
      // An abort is a timeout; anything else is a network/DNS style failure.
      lastError = error.name === 'AbortError' ? new Error(`Timed out after ${timeoutMs}ms: ${url}`) : error;

      // Non-retryable HTTP errors were thrown above with a status prefix.
      if (/^[45]\d\d /.test(error.message) && !isRetryable(Number(error.message.slice(0, 3)))) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      const backoffMs = 500 * 2 ** attempt;
      log.warn('Request failed, retrying', { url, attempt: attempt + 1, backoffMs, error: lastError.message });
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

/** Same as request(), but gives you the body as text. */
export async function getText(url, options = {}) {
  const response = await request(url, options);
  return response.text();
}

/** Same as request(), but gives you the parsed JSON body. */
export async function getJson(url, options = {}) {
  const response = await request(url, options);
  return response.json();
}

export default { request, getText, getJson, sleep };
