/**
 * A small robots.txt check.
 *
 * This is not a full parser. It reads the rules that apply to us (our own
 * user-agent block, falling back to "*") and answers one question: are we
 * allowed to fetch this path? If robots.txt is unreachable we allow the
 * request, which is the conventional behaviour.
 */

import { getText } from '../lib/http-client.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('scraper:robots');

/** host -> array of disallowed path prefixes */
const rulesByHost = new Map();

function parseRules(text, userAgent) {
  const lines = text.split('\n').map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean);

  const blocks = new Map();
  let currentAgents = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      // Consecutive user-agent lines share the rules that follow them.
      currentAgents = currentAgents.length && blocks.has(currentAgents[0]) ? [value.toLowerCase()] : [...currentAgents, value.toLowerCase()];
      for (const agent of currentAgents) if (!blocks.has(agent)) blocks.set(agent, []);
    } else if (key === 'disallow' && value) {
      for (const agent of currentAgents) blocks.get(agent).push(value);
    } else if (key === 'allow') {
      // Allow lines narrow a Disallow. We treat them as "not disallowed".
      for (const agent of currentAgents) {
        blocks.set(agent, blocks.get(agent).filter((rule) => rule !== value));
      }
      currentAgents = currentAgents.length ? currentAgents : [];
    }
  }

  const ourName = userAgent.split('/')[0].toLowerCase();
  return blocks.get(ourName) ?? blocks.get('*') ?? [];
}

/** Returns true when we are allowed to fetch this URL. */
export async function isAllowed(url, userAgent) {
  const { origin, host, pathname } = new URL(url);

  if (!rulesByHost.has(host)) {
    try {
      const text = await getText(`${origin}/robots.txt`, {
        headers: { 'User-Agent': userAgent },
        retries: 1,
        minGapMs: 0,
      });
      rulesByHost.set(host, parseRules(text, userAgent));
    } catch (error) {
      log.warn('Could not read robots.txt, allowing by default', { host, error: error.message });
      rulesByHost.set(host, []);
    }
  }

  const disallowed = rulesByHost.get(host);
  return !disallowed.some((rule) => pathname.startsWith(rule));
}

export default { isAllowed };
