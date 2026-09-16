/**
 * Free, deterministic relevance scoring.
 *
 * This runs on every scraped article, which is exactly why it must not call
 * an LLM. Only the handful of articles this cannot decide get escalated.
 *
 * Scoring, in plain terms:
 *   a strong AI keyword in the title is almost decisive
 *   the same keyword in the body is weaker evidence
 *   CS-adjacent words help but never carry an article on their own
 *   an exclude word pulls the score down hard
 */

const WEIGHTS = {
  strongInTitle: 0.45,
  strongInBody: 0.18,
  strongInTags: 0.25,
  supportingInTitle: 0.12,
  supportingInBody: 0.05,
  excludePenalty: 0.4,
};

/** Cap how much any one category can contribute, so keyword spam can't win. */
const CAPS = {
  strong: 0.75,
  supporting: 0.3,
};

/** Word-boundary match, so "ai" does not match "email" or "chair". */
function mentions(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Score one article for AI/CS relevance.
 *
 * @returns {{score: number, matched: string[], reason: string}}
 */
export function scoreArticle(article, rules) {
  const title = (article.title ?? '').toLowerCase();
  const body = `${article.summary ?? ''} ${article.body ?? ''}`.toLowerCase();
  const tags = (article.tags ?? []).join(' ').toLowerCase();

  const matched = [];
  let strongScore = 0;
  let supportingScore = 0;
  let penalty = 0;

  for (const keyword of rules.strongKeywords) {
    if (mentions(title, keyword)) {
      strongScore += WEIGHTS.strongInTitle;
      matched.push(`title:${keyword}`);
    } else if (mentions(tags, keyword)) {
      strongScore += WEIGHTS.strongInTags;
      matched.push(`tag:${keyword}`);
    } else if (mentions(body, keyword)) {
      strongScore += WEIGHTS.strongInBody;
      matched.push(`body:${keyword}`);
    }
  }

  for (const keyword of rules.supportingKeywords) {
    if (mentions(title, keyword)) {
      supportingScore += WEIGHTS.supportingInTitle;
      matched.push(`title:${keyword}`);
    } else if (mentions(body, keyword)) {
      supportingScore += WEIGHTS.supportingInBody;
      matched.push(`body:${keyword}`);
    }
  }

  for (const keyword of rules.excludeKeywords) {
    if (mentions(title, keyword) || mentions(tags, keyword)) {
      penalty += WEIGHTS.excludePenalty;
      matched.push(`exclude:${keyword}`);
    }
  }

  const score = clamp(
    Math.min(strongScore, CAPS.strong)
    + Math.min(supportingScore, CAPS.supporting)
    - penalty,
  );

  const reason = matched.length
    ? `Matched ${matched.slice(0, 4).join(', ')}`
    : 'No AI or CS keywords found';

  return { score: Number(score.toFixed(3)), matched, reason };
}

/** True when the heuristics are not confident either way. */
export function isAmbiguous(score, range) {
  return score >= range.min && score <= range.max;
}

export default { scoreArticle, isAmbiguous };
