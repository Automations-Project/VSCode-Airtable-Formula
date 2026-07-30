/**
 * Bring-your-own (BYO) credentials for the browser-free auth mode.
 *
 * When AIRTABLE_AUTH_MODE=byo, the server never launches Chromium. Instead the
 * user pastes a raw session Cookie header (mint it from a logged-in browser's
 * devtools) and we drive all API calls through the direct-HTTP transport with
 * that cookie. Airtable auth is COOKIE-ONLY (HAR-verified: no bearer/api-key) —
 * the essential cookies are __Host-airtable-session + .sig + brw (~3KB total).
 *
 * The CSRF token is required for form POSTs (mutations). If the user supplies it
 * we use it verbatim; otherwise we scrape it from a GET of any authed Airtable
 * page — the same token embedded in the /login HTML that the browser flow reads.
 *
 * Source order (first hit wins for the cookie):
 *   0. injected in-memory store (daemon runtime channel — see cred-store.js)
 *   1. env AIRTABLE_COOKIE (+ optional AIRTABLE_CSRF)
 *   2. file ~/.airtable-user-mcp/credentials.json  { cookie, csrf? }
 */
import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from './paths.js';
import { getInjectedCredentials } from './daemon/cred-store.js';
import { scrapeSessionUserId } from './session-user.js';

/** Path to the BYO credentials file. */
export function getCredentialsPath() {
  return path.join(getHomeDir(), 'credentials.json');
}

/**
 * Scrape a csrfToken out of an authed Airtable page's HTML using the same
 * strategies as auth._extractCsrf (which reads them from the live DOM):
 *   1. any script/window JSON blob containing "csrfToken":"…"
 *   2. <meta name="csrf-token" content="…">
 * Returns the token string, or null if none matched.
 */
export function scrapeCsrf(html) {
  if (!html || typeof html !== 'string') return null;
  // 1. Script-tag / window.* JSON: "csrfToken":"…"
  const json = html.match(/"csrfToken"\s*:\s*"([^"]+)"/);
  if (json) return json[1];
  // 2. <meta name="csrf-token" content="…"> (either attribute order)
  const metaNameFirst = html.match(/<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
  if (metaNameFirst) return metaNameFirst[1];
  const metaContentFirst = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i);
  if (metaContentFirst) return metaContentFirst[1];
  return null;
}

/**
 * Resolve a BYO cookie header + csrf token.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.fetchImpl] test seam — overrides global fetch for the
 *                                    csrf-scrape GET.
 * @returns {Promise<{cookieHeader: string, csrfToken: string|null, userId: string|null}>}
 */
export async function loadByoCredentials({ fetchImpl } = {}) {
  let cookieHeader = null;
  let csrfToken = null;
  // Advisory only, and only when the csrf scrape below actually fetches HTML —
  // that page is the sole place a signed-in user id appears (getUserProperties
  // returns 8 feature-flag booleans and no identity: live probes, 2026-07). Null
  // is normal here (a supplied csrf means no fetch happens) and must never gate.
  let userId = null;

  // 0. Injected in-memory store — the daemon's runtime credential channel
  //    (POST /daemon/auth-credentials; never env/disk). Highest priority so a
  //    freshly-pushed cookie wins over stale env/file. In-memory only.
  const injected = getInjectedCredentials();
  if (injected && typeof injected.cookie === 'string' && injected.cookie.trim()) {
    cookieHeader = injected.cookie.trim();
    if (typeof injected.csrf === 'string' && injected.csrf.trim()) csrfToken = injected.csrf.trim();
  } else if (process.env.AIRTABLE_COOKIE && process.env.AIRTABLE_COOKIE.trim()) {
    // 1. Environment.
    cookieHeader = process.env.AIRTABLE_COOKIE.trim();
    const envCsrf = process.env.AIRTABLE_CSRF;
    if (envCsrf && envCsrf.trim()) csrfToken = envCsrf.trim();
  } else {
    // 2. File.
    const file = getCredentialsPath();
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      raw = null;
    }
    if (raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `BYO credentials file ${file} is not valid JSON: ${err.message}. ` +
          'Expected { "cookie": "<Cookie header string>", "csrf"?: "<token>" }.'
        );
      }
      if (parsed && typeof parsed.cookie === 'string' && parsed.cookie.trim()) {
        cookieHeader = parsed.cookie.trim();
        if (typeof parsed.csrf === 'string' && parsed.csrf.trim()) csrfToken = parsed.csrf.trim();
      }
    }
  }

  if (!cookieHeader) {
    throw new Error(
      'BYO_CREDENTIALS_MISSING: AIRTABLE_AUTH_MODE=byo requires a session cookie, but none was found. ' +
      'Set AIRTABLE_COOKIE to a raw Cookie header string (from a logged-in browser\'s devtools), ' +
      `or write ${getCredentialsPath()} as { "cookie": "<Cookie header string>", "csrf"?: "<token>" }.`
    );
  }

  // Scrape csrf if not provided — GETs work without it, but form POSTs need it.
  if (!csrfToken) {
    const fetchFn = fetchImpl || globalThis.fetch;
    try {
      const res = await fetchFn('https://airtable.com/', { headers: { Cookie: cookieHeader } });
      const html = await res.text();
      csrfToken = scrapeCsrf(html);
      userId = scrapeSessionUserId(html);
    } catch (err) {
      console.error(`[byo] Failed to fetch airtable.com for csrf scrape: ${err.message}`);
    }
    if (!csrfToken) {
      console.error(
        '[byo] WARNING: no csrfToken (none supplied and scrape failed). GET requests will work, ' +
        'but form POSTs (mutations) may be rejected. Add "csrf" to your credentials or AIRTABLE_CSRF.'
      );
    }
  }

  return { cookieHeader, csrfToken: csrfToken ?? null, userId };
}
