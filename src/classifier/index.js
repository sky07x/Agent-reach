/**
 * Stage 2 - Classify.
 *
 * Decide whether an article is genuinely about AI or computer science.
 * TechCrunch's own tags are unreliable, so we read the content too.
 *
 * Cost control lives here: heuristics handle the clear cases for free and we
 * only pay for an LLM call when the score lands in the grey zone.
 */

import { createLogger } from '../lib/logger.js';
import { scoreArticle, isAmbiguous } from './heuristics.js';

const log = createLogger('classifier');

const SYSTEM_PROMPT = `You sort tech news into two buckets.

RELEVANT: artificial intelligence, machine learning, LLMs, AI products and
research, developer tooling, programming languages, infrastructure, security
engineering, chips and compute for AI, open source software, computer science
research.

NOT RELEVANT: consumer gadget reviews, fintech, crypto prices, e-commerce,
transport and mobility, media and entertainment, general startup funding news
with no technical substance, company IPOs.

A funding story counts as RELEVANT only if the article says something concrete
about the technology. "AI startup raises $40M" with no technical detail is NOT
relevant.

Reply as JSON: {"relevant": boolean, "score": 0-1, "reason": "one short line"}`;

export function createClassifier({ config, llm }) {
  const rules = config.classifier;

  /** Ask the model about the cases the keywords could not settle. */
  async function askLlm(article) {
    const result = await llm.chatJson({
      label: 'classify',
      temperature: 0,
      maxTokens: 150,
      system: SYSTEM_PROMPT,
      user: [
        `Title: ${article.title}`,
        `Tags: ${(article.tags ?? []).join(', ') || 'none'}`,
        `Summary: ${(article.summary ?? '').slice(0, 700)}`,
      ].join('\n'),
    });

    return {
      relevant: Boolean(result.relevant),
      score: Number(result.score) || 0,
      reason: String(result.reason ?? 'LLM decision'),
      decidedBy: 'llm',
    };
  }

  return {
    /**
     * Classify one article.
     * @returns {Promise<{relevant: boolean, score: number, reason: string, decidedBy: string}>}
     */
    async classify(article) {
      const { score, reason } = scoreArticle(article, rules);

      if (isAmbiguous(score, rules.ambiguousRange)) {
        log.debug('Heuristics unsure, asking the model', { title: article.title, score });

        try {
          return await askLlm(article);
        } catch (error) {
          // If the model is down, fall back to the keyword score rather than
          // dropping the article silently.
          log.warn('LLM classify failed, using heuristic score', { error: error.message });
        }
      }

      return {
        relevant: score >= rules.minScoreToKeep,
        score,
        reason,
        decidedBy: 'heuristic',
      };
    },

    /** Classify a batch and report how many calls we actually paid for. */
    async classifyAll(articles) {
      const results = [];
      let llmCalls = 0;

      for (const article of articles) {
        const classification = await this.classify(article);
        if (classification.decidedBy === 'llm') llmCalls += 1;
        results.push({ ...article, classification });
      }

      const kept = results.filter((article) => article.classification.relevant);
      log.info('Classification finished', { seen: articles.length, kept: kept.length, llmCalls });

      return results;
    },
  };
}

export { scoreArticle, isAmbiguous };
export default { createClassifier };
