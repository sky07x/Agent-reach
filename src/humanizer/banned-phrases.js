/**
 * The list of AI tells we actively hunt for.
 *
 * This list is meant to grow. Every time a post goes out and something in it
 * reads like a language model wrote it, add the phrase here. That is cheaper
 * and more reliable than trying to prompt the tell away.
 *
 * Each rule has:
 *   pattern     what to look for (case-insensitive regex)
 *   replaceWith what to swap it for, or null when it should just be deleted
 *   reason      shows up in the dry-run report so you can see what changed
 */

export const BANNED_PHRASES = [
  // Corporate LinkedIn voice
  { pattern: /\bexciting news\b[!.]?/gi, replaceWith: null, reason: 'influencer opener' },
  { pattern: /\bthrilled to (?:share|announce)\b/gi, replaceWith: null, reason: 'influencer opener' },
  { pattern: /\bgame[- ]chang(?:er|ing)\b/gi, replaceWith: 'a big deal', reason: 'cliche' },
  { pattern: /\bin today's (?:fast[- ]paced |rapidly evolving )?world\b[,]?/gi, replaceWith: null, reason: 'cliche opener' },
  { pattern: /\bthe future of\b/gi, replaceWith: 'where', reason: 'cliche' },
  { pattern: /\brevolutioniz(?:e|es|ing|ed)\b/gi, replaceWith: 'changes', reason: 'marketing word' },
  { pattern: /\bcutting[- ]edge\b/gi, replaceWith: 'new', reason: 'marketing word' },
  { pattern: /\bseamless(?:ly)?\b/gi, replaceWith: null, reason: 'marketing word' },
  { pattern: /\bleverag(?:e|es|ing)\b/gi, replaceWith: 'use', reason: 'marketing word' },
  { pattern: /\bunlock(?:s|ing)? the (?:power|potential)\b/gi, replaceWith: null, reason: 'marketing word' },
  { pattern: /\bdelve(?:s|d)? into\b/gi, replaceWith: 'looks at', reason: 'classic LLM word' },
  { pattern: /\ba testament to\b/gi, replaceWith: 'proof of', reason: 'classic LLM phrase' },
  { pattern: /\bin the (?:realm|landscape) of\b/gi, replaceWith: 'in', reason: 'classic LLM phrase' },
  { pattern: /\bnavigating the\b/gi, replaceWith: 'dealing with the', reason: 'classic LLM phrase' },

  // Essay-bot connectives
  { pattern: /\bmoreover\b[,]?/gi, replaceWith: null, reason: 'essay connective' },
  { pattern: /\bfurthermore\b[,]?/gi, replaceWith: null, reason: 'essay connective' },
  { pattern: /\badditionally\b[,]?/gi, replaceWith: 'also', reason: 'essay connective' },
  { pattern: /\bin conclusion\b[,]?/gi, replaceWith: null, reason: 'essay connective' },
  { pattern: /\bit'?s worth noting that\b/gi, replaceWith: null, reason: 'hedge' },
  { pattern: /\bthat (?:being|said)[,]? said\b[,]?/gi, replaceWith: 'still,', reason: 'essay connective' },
  { pattern: /\bwhen it comes to\b/gi, replaceWith: 'with', reason: 'filler' },
  { pattern: /\bat the end of the day\b[,]?/gi, replaceWith: null, reason: 'filler' },

  // Hedging that drains the opinion out of a take
  { pattern: /\bit could be argued that\b/gi, replaceWith: null, reason: 'hedge' },
  { pattern: /\bone might say\b[,]?/gi, replaceWith: null, reason: 'hedge' },
  { pattern: /\bsome would argue\b[,]?/gi, replaceWith: null, reason: 'hedge' },

  // Generic engagement bait
  { pattern: /\bwhat are your thoughts\?/gi, replaceWith: null, reason: 'generic CTA' },
  { pattern: /\bwhat do you think\?/gi, replaceWith: null, reason: 'generic CTA' },
  { pattern: /\blet me know in the comments\b[.!]?/gi, replaceWith: null, reason: 'generic CTA' },
  { pattern: /\bdrop a comment\b[.!]?/gi, replaceWith: null, reason: 'generic CTA' },
  { pattern: /\bfollow me for more\b[.!]?/gi, replaceWith: null, reason: 'generic CTA' },
  { pattern: /\bagree\?$/gim, replaceWith: null, reason: 'generic CTA' },

  // Emoji that scream LinkedIn influencer
  { pattern: /🚀|🔥|💡|🎯|✨|👇|🙌/g, replaceWith: null, reason: 'influencer emoji' },
];

/**
 * Contractions a person types and a model often does not.
 *
 * Matching is case-insensitive at apply time and the original capitalisation
 * is put back, so "It is broken" becomes "It's broken" rather than
 * "it's broken".
 */
export const CONTRACTIONS = [
  [/\bit is\b/g, "it's"],
  [/\bthat is\b/g, "that's"],
  [/\bthere is\b/g, "there's"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bdo not\b/g, "don't"],
  [/\bdid not\b/g, "didn't"],
  [/\bis not\b/g, "isn't"],
  [/\bare not\b/g, "aren't"],
  [/\bwas not\b/g, "wasn't"],
  [/\bwill not\b/g, "won't"],
  [/\bcannot\b/g, "can't"],
  [/\bcan not\b/g, "can't"],
  [/\bcould not\b/g, "couldn't"],
  [/\bwould not\b/g, "wouldn't"],
  [/\bshould not\b/g, "shouldn't"],
  [/\bhave not\b/g, "haven't"],
  [/\bhas not\b/g, "hasn't"],
  [/\byou are\b/g, "you're"],
  [/\bthey are\b/g, "they're"],
  [/\bwe are\b/g, "we're"],
  [/\byou will\b/g, "you'll"],
  [/\bwe will\b/g, "we'll"],
  [/\bthey will\b/g, "they'll"],
  [/\byou have\b/g, "you've"],
  [/\bwe have\b/g, "we've"],
];

export default { BANNED_PHRASES, CONTRACTIONS };
