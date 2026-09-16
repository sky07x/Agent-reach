/**
 * The shapes that get passed between pipeline stages, as JSDoc typedefs.
 *
 * This project is plain JavaScript, so these are documentation plus editor
 * autocomplete rather than compile-time checks. Use them with:
 *   \@typedef {import('../lib/types.js').Article} Article
 */

/**
 * One story as it came off the source feed.
 *
 * @typedef {object} Article
 * @property {string} id           stable hash of the URL, used for dedupe
 * @property {string} url
 * @property {string} title
 * @property {string} summary      short blurb from the feed
 * @property {string} [body]       full text, only fetched when we need it
 * @property {string[]} tags       categories the source gave us
 * @property {string} publishedAt  ISO timestamp
 * @property {string} source       e.g. "techcrunch"
 * @property {string} fetchedAt    ISO timestamp
 */

/**
 * What the classifier decided about an article.
 *
 * @typedef {object} Classification
 * @property {boolean} relevant
 * @property {number} score        0-1 confidence that this is AI/CS
 * @property {string} reason       one line, human readable
 * @property {'heuristic'|'llm'} decidedBy
 */

/**
 * What the curator decided about a classified article.
 *
 * @typedef {object} Curation
 * @property {number} memeScore    0-1, how post-worthy this is
 * @property {string} angle        the take the content engine should run with
 * @property {string} reason       why this story beat the others
 */

/**
 * A finished post, before or after publishing.
 *
 * @typedef {object} Post
 * @property {string} id
 * @property {string} articleId
 * @property {string} articleUrl
 * @property {string} text         the LinkedIn copy, hook included
 * @property {string} hook         first line, kept separately for scoring
 * @property {string[]} hashtags
 * @property {string} memeCaption
 * @property {string} [memePath]   local path to the rendered image
 * @property {string} [memeTemplate]
 * @property {'draft'|'published'|'failed'} status
 * @property {string} createdAt
 * @property {string} [publishedAt]
 * @property {string} [providerPostId]
 * @property {object} [metrics]    filled in later by the analytics step
 */

export {};
