/**
 * USD per 1 million tokens, so we can print what a run actually cost.
 *
 * These are list prices and they change. Update them when OpenAI updates
 * theirs; a wrong number here only affects the cost line in the logs.
 */
export const PRICE_PER_MILLION_TOKENS = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
};

/** Self-hosted models have no per-call price. The server bill is separate. */
const FREE = { input: 0, output: 0 };

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const price = PRICE_PER_MILLION_TOKENS[model] ?? FREE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
