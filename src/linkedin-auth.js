/**
 * One-time LinkedIn OAuth helper.
 *
 *   npm run linkedin:auth
 *
 * Walks the authorization-code flow, then writes LINKEDIN_ACCESS_TOKEN and
 * LINKEDIN_MEMBER_ID straight into .env so you never copy a token by hand.
 *
 * It does this:
 *   1. opens LinkedIn's consent page in your browser
 *   2. catches the redirect on a throwaway local server
 *   3. swaps the code for an access token
 *   4. calls /v2/userinfo to find your member id
 *   5. updates .env, leaving every other line untouched
 *
 * Member tokens last 60 days. When posting starts returning 401, run this
 * again - that is the whole refresh procedure.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

// openid + profile let us read the member id. w_member_social is the one that
// actually allows posting.
const SCOPES = 'openid profile w_member_social';

/* ------------------------------------------------------------------ */
/* .env handling                                                       */
/* ------------------------------------------------------------------ */

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {};

  const values = {};

  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }

  return values;
}

/**
 * Update keys in .env in place. Existing lines are rewritten where they sit,
 * new ones are appended, and comments and spacing survive untouched.
 */
function updateEnvFile(updates) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const remaining = { ...updates };

  const rewritten = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !(match[1] in remaining)) return line;

    const key = match[1];
    const value = remaining[key];
    delete remaining[key];
    return `${key}=${value}`;
  });

  for (const [key, value] of Object.entries(remaining)) {
    rewritten.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_FILE, rewritten.join('\n'));
  // The file now holds a live posting token, so tighten the permissions.
  fs.chmodSync(ENV_FILE, 0o600);
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';

  try {
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The callback server                                                 */
/* ------------------------------------------------------------------ */

function page(title, message, ok) {
  return `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<div style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1.5rem">
  <h1 style="font-size:1.4rem;color:${ok ? '#15803d' : '#b91c1c'}">${title}</h1>
  <p style="color:#444;line-height:1.6">${message}</p>
</div>`;
}

/**
 * Serve exactly one request: the redirect back from LinkedIn.
 * Resolves with the authorization code, or rejects with what went wrong.
 */
function waitForCallback({ port, callbackPath, expectedState }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname !== callbackPath) {
        res.writeHead(404).end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      const finish = (status, body, outcome) => {
        res.writeHead(status, { 'Content-Type': 'text/html' }).end(body);
        server.close();
        outcome();
      };

      if (error) {
        const description = url.searchParams.get('error_description') ?? error;
        finish(400, page('Authorization refused', description, false),
          () => reject(new Error(`LinkedIn said: ${description}`)));
        return;
      }

      // Guards against another site tricking your browser into hitting this
      // callback with a code of its own. A stale tab from an earlier run
      // trips it too, which is why we stop rather than keep listening.
      if (state !== expectedState) {
        finish(400, page('State did not match',
          'This is usually a leftover tab from an earlier run. Close it and run the command again.', false),
          () => reject(new Error('State did not match, so nothing was saved. Close any old LinkedIn tabs and retry.')));
        return;
      }

      if (!code) {
        finish(400, page('No code returned', 'LinkedIn redirected without an authorization code.', false),
          () => reject(new Error('No authorization code in the callback')));
        return;
      }

      finish(200, page('Connected', 'Your token has been written to .env. You can close this tab.', true),
        () => resolve(code));
    });

    server.on('error', (err) => {
      reject(err.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is busy. Stop whatever is using it (npm run dev?) and try again.`)
        : err);
    });

    server.listen(port);

    // Don't hang forever if the browser never comes back.
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes waiting for the browser'));
    }, 5 * 60 * 1000).unref();
  });
}

/* ------------------------------------------------------------------ */
/* LinkedIn calls                                                      */
/* ------------------------------------------------------------------ */

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${body.error_description ?? JSON.stringify(body)}`);
  }

  return body;
}

async function fetchMemberProfile(accessToken) {
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Could not read your profile (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const env = readEnvFile();

  const clientId = process.env.LINKEDIN_CLIENT_ID || env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || env.LINKEDIN_REDIRECT_URI
    || 'http://localhost:4000/callback';

  if (!clientId || !clientSecret) {
    console.error(`
Missing LinkedIn app credentials.

Add these to .env, from https://www.linkedin.com/developers/apps
(your app -> Auth tab):

  LINKEDIN_CLIENT_ID=...
  LINKEDIN_CLIENT_SECRET=...

On that same Auth tab, add this exact redirect URL:

  ${redirectUri}

And on the Products tab, add "Share on LinkedIn" and "Sign In with LinkedIn
using OpenID Connect". Both are self-serve and usually instant.
`);
    process.exit(1);
  }

  const parsed = new URL(redirectUri);
  const port = Number(parsed.port || 80);
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES,
  })}`;

  console.log(`\nListening on ${redirectUri}`);
  console.log('Opening LinkedIn in your browser...\n');
  console.log(`If it does not open, paste this in yourself:\n\n${authUrl}\n`);

  // Start listening BEFORE opening the browser, or a fast redirect races us.
  const codePromise = waitForCallback({ port, callbackPath: parsed.pathname, expectedState: state });
  openBrowser(authUrl);

  const code = await codePromise;
  console.log('Got the authorization code. Exchanging it for a token...');

  const token = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri });
  const profile = await fetchMemberProfile(token.access_token);

  const updates = {
    LINKEDIN_ACCESS_TOKEN: token.access_token,
    LINKEDIN_MEMBER_ID: profile.sub,
  };

  // Only some apps are granted refresh tokens. Keep it if we got one.
  if (token.refresh_token) updates.LINKEDIN_REFRESH_TOKEN = token.refresh_token;

  updateEnvFile(updates);

  const expiresAt = new Date(Date.now() + Number(token.expires_in ?? 0) * 1000);
  const grantedScopes = (token.scope ?? '').split(/[, ]+/).filter(Boolean);

  console.log(`
Done. .env updated (permissions set to 600).

  Account    ${profile.name ?? '(name not shared)'}
  Member id  ${profile.sub}
  Scopes     ${grantedScopes.join(', ') || '(none reported)'}
  Expires    ${expiresAt.toDateString()} (in ${Math.round((token.expires_in ?? 0) / 86400)} days)
`);

  if (!grantedScopes.includes('w_member_social')) {
    console.warn(`WARNING: w_member_social was not granted, so posting will fail
with a 403. Add the "Share on LinkedIn" product to your app and run this again.
`);
  }

  console.log(`Next, to go live:

  1. Set PUBLISHER=linkedin and DRY_RUN=false in .env
  2. npm run run:once

Until you change those two, nothing is published.
`);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
