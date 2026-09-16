/**
 * One LLM interface for the whole agent.
 *
 * Every module calls `llm.chat(...)` and none of them import a provider SDK
 * directly, so swapping ChatGPT for a self-hosted model is a config change
 * rather than a rewrite.
 *
 * Supported providers:
 *   openai  - ChatGPT via the official API (the default, see the cost note in
 *             the agent README)
 *   ollama  - any local open-weight model exposed by Ollama
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { estimateCostUsd } from './pricing.js';

const log = createLogger('llm');

/**
 * Running total for the current process. Handy in dry runs: you can see
 * exactly what one post would have cost before you ever schedule it.
 */
const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

export function getUsage() {
  return { ...usage };
}

export function resetUsage() {
  usage.calls = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
  usage.costUsd = 0;
}

function recordUsage(model, inputTokens, outputTokens) {
  usage.calls += 1;
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.costUsd += estimateCostUsd(model, inputTokens, outputTokens);
}

/**
 * The model sometimes wraps JSON in a ```json fence even when you ask it not
 * to. Strip the fence before parsing rather than failing the whole run.
 */
function parseJsonReply(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the outermost {...} or [...] block.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!match) throw new Error(`LLM did not return JSON: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

function createOpenAiProvider(config) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    maxRetries: 2,
  });

  return async function callOpenAi({ system, user, model, temperature, maxTokens, json }) {
    const response = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: json ? { type: 'json_object' } : undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  };
}

function createOllamaProvider(config) {
  const baseUrl = config.baseUrl || 'http://localhost:11434';

  return async function callOllama({ system, user, model, temperature, maxTokens, json }) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: json ? 'json' : undefined,
        options: { temperature, num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
    }

    const body = await response.json();

    return {
      text: body.message?.content ?? '',
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
    };
  };
}

const PROVIDERS = {
  openai: createOpenAiProvider,
  ollama: createOllamaProvider,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build an LLM client.
 *
 * @param {object} config
 * @param {'openai'|'ollama'} config.provider
 * @param {string} config.model         default model for every call
 * @param {string} [config.apiKey]      required for openai
 * @param {string} [config.baseUrl]     override for proxies or Ollama
 * @param {number} [config.temperature] default creativity (0-2)
 * @param {number} [config.maxTokens]   default reply cap
 */
export function createLlmClient(config) {
  const makeProvider = PROVIDERS[config.provider];

  if (!makeProvider) {
    throw new Error(`Unknown LLM provider "${config.provider}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  if (config.provider === 'openai' && !config.apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Copy .env.example to .env and fill it in.');
  }

  const call = makeProvider(config);

  /**
   * Send one prompt and get the raw text back.
   *
   * @param {object} options
   * @param {string} options.system  the role/rules prompt
   * @param {string} options.user    the actual task
   * @param {string} [options.label] shows up in logs, e.g. "classify"
   */
  async function chat(options) {
    const model = options.model ?? config.model;
    const label = options.label ?? 'chat';
    const startedAt = Date.now();

    const result = await call({
      system: options.system,
      user: options.user,
      model,
      temperature: options.temperature ?? config.temperature ?? 0.8,
      maxTokens: options.maxTokens ?? config.maxTokens ?? 800,
      json: Boolean(options.json),
    });

    recordUsage(model, result.inputTokens, result.outputTokens);

    log.info('LLM call finished', {
      label,
      model,
      ms: Date.now() - startedAt,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      runningCostUsd: Number(usage.costUsd.toFixed(5)),
    });

    return result.text;
  }

  /** Same as chat(), but asks for JSON and hands back a parsed object. */
  async function chatJson(options) {
    const text = await chat({ ...options, json: true });
    return parseJsonReply(text);
  }

  return { chat, chatJson, getUsage, resetUsage, provider: config.provider, model: config.model };
}

export default { createLlmClient, getUsage, resetUsage };
