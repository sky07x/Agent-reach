/**
 * Posts to a personal LinkedIn profile through the official API.
 *
 * You picked this option, so here is what it needs, in order:
 *   1. A LinkedIn developer app with the "Share on LinkedIn" and
 *      "Sign In with LinkedIn using OpenID Connect" products enabled.
 *   2. A member access token carrying the `w_member_social` scope.
 *   3. Your member id, which is the `sub` field from /v2/userinfo.
 *
 * Member tokens expire (60 days by default), so a failed publish that returns
 * 401 almost always means the token needs refreshing, not that the code broke.
 * The README has the refresh steps.
 *
 * Publishing an image is three calls: register an upload, PUT the bytes, then
 * create the post referencing the returned image urn.
 */

import { request } from '../lib/http-client.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('publisher:linkedin');

const API = 'https://api.linkedin.com';

/**
 * LinkedIn's commentary field treats a handful of characters as markup, so
 * they have to be backslash-escaped or the post is rejected. `#` is left
 * alone on purpose, otherwise hashtags stop being hashtags.
 */
export function escapeCommentary(text) {
  return String(text).replace(/([\\|{}@[\]()<>*_~])/g, '\\$1');
}

export function createLinkedInProvider({ settings }) {
  const author = `urn:li:person:${settings.memberId}`;

  function headers(extra = {}) {
    return {
      Authorization: `Bearer ${settings.accessToken}`,
      'LinkedIn-Version': settings.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      ...extra,
    };
  }

  /** Step 1: ask LinkedIn where to put the image. */
  async function initializeImageUpload() {
    const response = await request(`${API}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      minGapMs: 0,
    });

    const body = await response.json();
    return { uploadUrl: body.value.uploadUrl, imageUrn: body.value.image };
  }

  /** Step 2: send the bytes. */
  async function uploadImageBytes(uploadUrl, buffer) {
    await request(uploadUrl, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'image/png' }),
      body: buffer,
      minGapMs: 0,
    });
  }

  return {
    name: 'linkedin',

    /** Confirm the token works and tell us which account it belongs to. */
    async verify() {
      const response = await request(`${API}/v2/userinfo`, { headers: headers(), minGapMs: 0 });
      const profile = await response.json();

      return {
        ok: true,
        memberId: profile.sub,
        name: profile.name,
        matchesConfig: profile.sub === settings.memberId,
      };
    },

    /**
     * Publish one post, with an optional image.
     *
     * @param {object} post
     * @param {string} post.text
     * @param {Buffer} [post.imageBuffer]
     * @param {string} [post.imageAltText]
     */
    async publish({ text, imageBuffer, imageAltText }) {
      if (!settings.accessToken) throw new Error('LINKEDIN_ACCESS_TOKEN is not set');
      if (!settings.memberId) throw new Error('LINKEDIN_MEMBER_ID is not set');

      // Turn LinkedIn's two most common failures into advice instead of a
      // stack trace, because both have a specific, boring fix.
      const explain = (error) => {
        if (error.message.includes('NONEXISTENT_VERSION')) {
          return new Error(`LinkedIn has retired API version ${settings.apiVersion}. `
            + 'Set a newer LINKEDIN_API_VERSION in .env. Not every month is active, so try a few.');
        }
        if (error.message.startsWith('401')) {
          return new Error('LinkedIn rejected the token. It has probably expired. Run: npm run linkedin:auth');
        }
        return error;
      };

      let content;

      try {
        if (imageBuffer) {
          const { uploadUrl, imageUrn } = await initializeImageUpload();
          await uploadImageBytes(uploadUrl, imageBuffer);

          content = { media: { id: imageUrn, altText: imageAltText || 'Meme about the linked story' } };
          log.debug('Image uploaded', { imageUrn });
        }
      } catch (error) {
        throw explain(error);
      }

      let response;

      try {
        response = await request(`${API}/rest/posts`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          minGapMs: 0,
          body: JSON.stringify({
            author,
            commentary: escapeCommentary(text),
            visibility: 'PUBLIC',
            distribution: {
              feedDistribution: 'MAIN_FEED',
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            content,
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
          }),
        });
      } catch (error) {
        throw explain(error);
      }

      // The new post's urn comes back in a header, not the body.
      const postId = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id') ?? null;

      log.info('Published to LinkedIn', { postId });
      return { providerPostId: postId, url: postId ? `https://www.linkedin.com/feed/update/${postId}` : null };
    },

    /**
     * Read engagement numbers back for the learning loop.
     *
     * Note: socialActions is available to the post's author. If your app does
     * not have access, this returns nulls and Stage 8 simply has less to work
     * with rather than failing the run.
     */
    async getMetrics(providerPostId) {
      if (!providerPostId) return null;

      try {
        const response = await request(
          `${API}/rest/socialActions/${encodeURIComponent(providerPostId)}`,
          { headers: headers(), minGapMs: 0, retries: 1 },
        );

        const body = await response.json();

        return {
          likes: body.likesSummary?.totalLikes ?? null,
          comments: body.commentsSummary?.aggregatedTotalComments ?? null,
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        log.warn('Could not read metrics', { providerPostId, error: error.message });
        return null;
      }
    },
  };
}

export default { createLinkedInProvider, escapeCommentary };
