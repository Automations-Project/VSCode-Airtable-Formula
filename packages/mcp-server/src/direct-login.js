/**
 * Browser-free direct login for AIRTABLE_AUTH_MODE=direct-login (Phase B).
 *
 * Replicates the HAR-verified Airtable cold-login flow over HTTP instead of
 * driving a Chromium profile. Airtable auth is COOKIE-ONLY (no bearer/api-key):
 *   1. GET /login                     — scrape csrfToken, collect cookies
 *   2. POST /auth/getLoginTypeForEmail — detect SSO vs password accounts
 *   3. POST /auth/login/               — email + password → 302 (to /2fa/… or /)
 *   4. POST /auth/verify2faCode        — TOTP, only when a 2FA challenge is returned
 *   → re-scrape csrfToken from an authed GET / so the returned credential matches the
 *     page Airtable renders for this session (defensive refresh, not a staleness fix).
 *
 * CSRF across the 2FA step — the step-1 token is reused for steps 2-4, and that is
 * CORRECT. Airtable uses the stateless csurf scheme (token = salt + '-' +
 * b64url(sha1(salt + '-' + csrfSecret))), and the HAR shows the session cookie is
 * RE-ISSUED at both /auth/login/ and /auth/verify2faCode with the csrfSecret
 * deliberately PRESERVED — it survives even the unauthenticated → authenticated
 * transition. So the /login token still verifies at 2FA time; login does NOT rotate it.
 * A real browser posts the /2fa page's token only because it follows the 302 and
 * re-renders that page with a fresh SALT — new salt, same secret. Pinned by the
 * "CSRF token across the 2FA step" suite in test/test-direct-login.test.js, whose
 * negative control fails if Airtable ever does start rotating.
 *
 * Transport DEFAULTS to Node's built-in `fetch` (no dependency), so direct-login works out of the
 * box. impit (Chrome TLS impersonation) is used ONLY when AIRTABLE_HTTP_CLIENT=impit — for the
 * rare account whose login endpoints challenge a non-browser TLS fingerprint (PerimeterX). impit
 * and otpauth are OPTIONAL deps, lazy-loaded, and injectable (impitFactory / otpFactory) for tests
 * so NO live Airtable call or real crypto runs under `node --test`.
 *
 * Returns { cookieHeader, csrfToken } — the exact shape auth._credentials wants.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from './paths.js';
import { scrapeCsrf } from './byo-credentials.js';
import { scrapeSessionUserId } from './session-user.js';
import { getInjectedCredentials } from './daemon/cred-store.js';
import { getProxyDispatcher } from './proxy.js';

const BASE = 'https://airtable.com';

// ── Lazy optional-dependency loaders ────────────────────────────────

let _ImpitClass = null;
async function loadImpit() {
  if (_ImpitClass) return _ImpitClass;
  try {
    const mod = await import('impit');
    _ImpitClass = mod.Impit || mod.default?.Impit;
    if (!_ImpitClass) throw new Error('the `impit` module did not export `Impit`');
    return _ImpitClass;
  } catch (err) {
    throw new Error(
      'DIRECT_LOGIN_IMPIT_MISSING: AIRTABLE_AUTH_MODE=direct-login requires the optional `impit` ' +
      'package (Chrome TLS impersonation). Install it (`npm i impit`) or use AIRTABLE_AUTH_MODE=browser.\n' +
      `Original error: ${err.message}`
    );
  }
}

let _OTPAuth = null;
async function loadOtpAuth() {
  if (_OTPAuth) return _OTPAuth;
  try {
    const mod = await import('otpauth');
    _OTPAuth = mod.default?.TOTP ? mod.default : mod;
    if (!_OTPAuth?.TOTP) throw new Error('the `otpauth` module did not export TOTP/Secret');
    return _OTPAuth;
  } catch (err) {
    throw new Error(
      'DIRECT_LOGIN_OTPAUTH_MISSING: this account requires 2FA but the optional `otpauth` package ' +
      'is not installed. Install it (`npm i otpauth`) or use AIRTABLE_AUTH_MODE=browser.\n' +
      `Original error: ${err.message}`
    );
  }
}

/**
 * Build the HTTP client for the login flow.
 *
 * Default = Node's built-in `fetch` (WHATWG) — NO optional dependency needed, so direct-login
 * works out of the box. The cookie-jar/Location helpers below already speak the WHATWG Response
 * shape (getSetCookie(), headers.get(...)). We drive the exact login sequence ourselves, so the
 * fetch client is created with `redirect: 'manual'` per request.
 *
 * impit (Chrome TLS impersonation) is used ONLY when explicitly requested via
 * AIRTABLE_HTTP_CLIENT=impit — for accounts where Airtable's login endpoints challenge a
 * non-browser TLS fingerprint (PerimeterX). If requested but not installed, loadImpit throws a
 * clear DIRECT_LOGIN_IMPIT_MISSING. `impitFactory` (tests) always wins.
 */
async function makeHttpClient(impitFactory) {
  if (impitFactory) return impitFactory();
  if ((process.env.AIRTABLE_HTTP_CLIENT || '').toLowerCase() === 'impit') {
    const Impit = await loadImpit();
    // followRedirects:false — we read Location ourselves rather than chase redirects.
    return new Impit({ browser: 'chrome', followRedirects: false });
  }
  // Node fetch client — redirect:'manual' so a 302 is returned, not followed.
  // Node's fetch ignores HTTP_PROXY/HTTPS_PROXY; attach the proxy dispatcher so
  // browser-free login works on a network that only reaches the internet through
  // a proxy (null when none is configured → unchanged behaviour).
  const dispatcher = await getProxyDispatcher();
  return {
    fetch: (url, options) => fetch(url, {
      ...options,
      redirect: 'manual',
      ...(dispatcher ? { dispatcher } : {}),
    }),
  };
}

async function generateTotp(secret, otpFactory) {
  if (otpFactory) return otpFactory(secret);
  const OTPAuth = await loadOtpAuth();
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate();
}

// ── Cookie-jar helpers ──────────────────────────────────────────────

/**
 * Split a combined Set-Cookie header string into individual cookie strings,
 * respecting the comma inside an `Expires=Wed, 09 Jun 2021 …` date. Battle-
 * tested char scanner (set-cookie-parser style). Only used as a fallback — real
 * impit/WHATWG responses expose getSetCookie() as an array.
 */
function splitCombinedSetCookie(str) {
  const out = [];
  let pos = 0;
  const len = str.length;
  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  while (pos < len) {
    let start = pos;
    let separatorFound = false;
    while (pos < len) {
      while (pos < len && isWs(str.charAt(pos))) pos++;
      if (pos >= len) break;
      const ch = str.charAt(pos);
      if (ch === ',') {
        const lastComma = pos;
        pos += 1;
        while (pos < len && isWs(str.charAt(pos))) pos++;
        const nextStart = pos;
        while (pos < len) {
          const c = str.charAt(pos);
          if (c === '=' || c === ';' || c === ',') break;
          pos += 1;
        }
        if (pos < len && str.charAt(pos) === '=') {
          separatorFound = true;
          pos = nextStart;
          out.push(str.substring(start, lastComma));
          start = pos;
        } else {
          pos = lastComma + 1;
        }
      } else {
        pos += 1;
      }
    }
    if (!separatorFound || pos >= len) {
      out.push(str.substring(start, len));
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Robustly extract the list of raw Set-Cookie strings from a response. */
function extractSetCookies(res) {
  const h = res && res.headers;
  if (!h) return [];
  // WHATWG Headers.getSetCookie() (impit / undici) → already an array.
  if (typeof h.getSetCookie === 'function') {
    try {
      const arr = h.getSetCookie();
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through */ }
  }
  // node-fetch style raw().
  if (typeof h.raw === 'function') {
    try {
      const raw = h.raw();
      const sc = raw && (raw['set-cookie'] || raw['Set-Cookie']);
      if (Array.isArray(sc)) return sc;
      if (typeof sc === 'string') return splitCombinedSetCookie(sc);
    } catch { /* fall through */ }
  }
  // Headers.get('set-cookie') / Map.get.
  if (typeof h.get === 'function') {
    try {
      const sc = h.get('set-cookie');
      if (Array.isArray(sc)) return sc;
      if (typeof sc === 'string') return splitCombinedSetCookie(sc);
    } catch { /* fall through */ }
  }
  // Plain object.
  const sc = h['set-cookie'] ?? h['Set-Cookie'];
  if (Array.isArray(sc)) return sc;
  if (typeof sc === 'string') return splitCombinedSetCookie(sc);
  return [];
}

/** Update the jar Map(name→value) from a response's Set-Cookie header(s). */
function updateJar(jar, res) {
  for (const raw of extractSetCookies(res)) {
    if (!raw || typeof raw !== 'string') continue;
    const firstPair = raw.split(';')[0];
    const eq = firstPair.indexOf('=');
    if (eq < 0) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function jarToCookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Read a single response header case-insensitively (WHATWG or plain object). */
function getHeader(res, name) {
  const h = res && res.headers;
  if (!h) return null;
  if (typeof h.get === 'function') {
    try {
      const v = h.get(name);
      if (v != null) return v;
    } catch { /* fall through */ }
  }
  return h[name] ?? h[String(name).toLowerCase()] ?? null;
}

// ── Request helper ──────────────────────────────────────────────────

/**
 * Issue a single request through impit with the running cookie jar, then fold
 * the response's Set-Cookie header(s) back into the jar.
 * @param {'GET'|'POST'} method
 * @param {string} urlPath  path (joined to BASE) or a full URL
 * @param {object} [opts]
 * @param {Map} opts.jar
 * @param {object} [opts.form]  form-urlencoded body fields
 */
async function request(client, method, urlPath, { jar, form } = {}) {
  const url = urlPath.startsWith('http') ? urlPath : BASE + urlPath;
  const headers = {};
  const cookie = jarToCookieHeader(jar);
  if (cookie) headers['Cookie'] = cookie;
  const options = { method, headers };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    options.body = new URLSearchParams(form).toString();
  }
  const res = await client.fetch(url, options);
  updateJar(jar, res);
  return res;
}

// ── Credential resolution ───────────────────────────────────────────

function resolveCredentials({ email, password, totpSecret }) {
  // Priority: injected in-memory store (daemon runtime channel — cred-store.js)
  // → explicit params → env (AIRTABLE_EMAIL/PASSWORD/TOTP_SECRET) → login.json.
  // The injected store is in-memory only (never env/disk) and empty for stdio,
  // so the env/file path is unchanged when nothing is injected.
  const injected = getInjectedCredentials() || {};
  let e = injected.email ?? email ?? process.env.AIRTABLE_EMAIL;
  let p = injected.password ?? password ?? process.env.AIRTABLE_PASSWORD;
  let t = injected.totpSecret ?? totpSecret ?? process.env.AIRTABLE_TOTP_SECRET;

  if (!e || !p) {
    // File fallback: ~/.airtable-user-mcp/login.json { email, password, totpSecret }
    const file = path.join(getHomeDir(), 'login.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      e = e || parsed.email;
      p = p || parsed.password;
      t = t || parsed.totpSecret;
    } catch { /* no file / invalid — fall through to the missing-creds error */ }
  }

  if (!e || !p) {
    throw new Error(
      'DIRECT_LOGIN_CREDENTIALS_MISSING: AIRTABLE_AUTH_MODE=direct-login needs an email + password. ' +
      'Set AIRTABLE_EMAIL and AIRTABLE_PASSWORD (and AIRTABLE_TOTP_SECRET for 2FA accounts), ' +
      `or write ${path.join(getHomeDir(), 'login.json')} as { "email", "password", "totpSecret"? }.`
    );
  }
  return { email: e, password: p, totpSecret: t || null };
}

/**
 * Decide whether getLoginTypeForEmail's answer means this account cannot do a
 * password login (SSO / SAML / enterprise). Lenient: parse JSON when possible,
 * else sniff the raw body.
 */
function indicatesSso(body) {
  if (!body) return false;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return /\b(sso|saml)\b/i.test(body) && !/password/i.test(body);
  }
  const type = String(
    data.loginType ?? data.type ?? data.strategy ?? data.method ?? ''
  ).toLowerCase();
  if (/sso|saml|enterprise|oidc/.test(type)) return true;
  if (type === 'password') return false;
  if (data.isSso === true || data.ssoRequired === true || data.requiresSso === true) return true;
  return false;
}

// ── Main flow ───────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string}   [opts.email]        defaults to env / login.json
 * @param {string}   [opts.password]     defaults to env / login.json
 * @param {string}   [opts.totpSecret]   base32 TOTP secret (2FA accounts)
 * @param {Function} [opts.impitFactory] test seam — () => ({ fetch(url,opts) })
 * @param {Function} [opts.otpFactory]   test seam — (secret) => code
 * @returns {Promise<{ cookieHeader: string, csrfToken: string|null, userId: string|null }>}
 */
export async function directLogin({ email, password, totpSecret, impitFactory, otpFactory } = {}) {
  const creds = resolveCredentials({ email, password, totpSecret });
  const client = await makeHttpClient(impitFactory);
  const jar = new Map();

  // 1. GET /login — scrape the csrfToken, collect the initial cookies (brw, …).
  const loginPage = await request(client, 'GET', '/login', { jar });
  let csrf = scrapeCsrf(await loginPage.text());
  if (!csrf) {
    throw new Error('DIRECT_LOGIN_NO_CSRF: could not scrape a csrfToken from GET /login — Airtable may have changed the login page.');
  }

  // 2. getLoginTypeForEmail — bail early on SSO/enterprise accounts.
  const typeRes = await request(client, 'POST', '/auth/getLoginTypeForEmail', {
    jar,
    form: {
      _csrf: csrf,
      email: creds.email,
      shouldRedirectUnregisteredEmailToSignup: false,
      urlToRedirectTo: '/',
      didConsentToMarketing: false,
      didConsentToDataEnrichment: false,
    },
  });
  if (indicatesSso(await typeRes.text())) {
    throw new Error('DIRECT_LOGIN_SSO_UNSUPPORTED: this account uses SSO — use AIRTABLE_AUTH_MODE=browser');
  }

  // 3. POST /auth/login/ — expect a 302 (to /2fa/… on a 2FA account, else /).
  const loginRes = await request(client, 'POST', '/auth/login/', {
    jar,
    form: { _csrf: csrf, urlToRedirectTo: '/', email: creds.email, password: creds.password },
  });
  const isRedirect = loginRes.status === 302 || loginRes.status === 303;
  const loginLocation = getHeader(loginRes, 'location') || '';
  const twoFaMatch = loginLocation.match(/\/2fa\/([^/?#]+)/);
  // A non-redirect, or a redirect that bounces back to /login (without a 2FA
  // segment), means the email/password was rejected.
  if (!isRedirect || (/\/login/.test(loginLocation) && !twoFaMatch)) {
    throw new Error(`DIRECT_LOGIN_BAD_CREDENTIALS: email/password rejected (status ${loginRes.status})`);
  }

  // 4. 2FA, when challenged.
  if (twoFaMatch) {
    const twoFactorStrategyId = twoFaMatch[1];
    if (!creds.totpSecret) {
      throw new Error('DIRECT_LOGIN_2FA_REQUIRED: set AIRTABLE_TOTP_SECRET (base32) for this account');
    }
    const code = await generateTotp(creds.totpSecret, otpFactory);
    const verifyRes = await request(client, 'POST', '/auth/verify2faCode', {
      jar,
      form: { _csrf: csrf, twoFactorStrategyId, code },
    });
    if (verifyRes.status !== 302 && verifyRes.status !== 303) {
      throw new Error(`DIRECT_LOGIN_2FA_REJECTED: TOTP code rejected — check AIRTABLE_TOTP_SECRET/clock (status ${verifyRes.status})`);
    }
  }

  // 5. Must have a real session cookie now. NECESSARY BUT NOT SUFFICIENT — see
  //    the sessionUserId check below. A stale/partial profile cookie can still be
  //    accepted by Airtable while the sign-in never completed (that is the state
  //    issue #21's reporter hit), so cookie presence alone is not a verdict.
  if (!jar.has('__Host-airtable-session')) {
    throw new Error('DIRECT_LOGIN_NO_SESSION: login flow completed without a session cookie');
  }

  // Refresh the csrfToken from an authed GET / so the returned credential matches
  // the page Airtable renders for this session. NOT a staleness fix: login preserves
  // the csrfSecret (see the CSRF note in the module header), so the login-flow token
  // is still valid — hence best-effort, keeping that token if the re-scrape fails.
  //
  // The SAME HTML is the only place a signed-in user id ever appears (the API's
  // getUserProperties returns 8 feature-flag booleans and no identity at all —
  // live probes against airtable.com, 2026-07), so read it here for free and use
  // it as the real proof that this login completed. Tri-state on purpose:
  //   usr… → signed in;  null → the page says nobody is;  undefined → never read.
  // Only the middle case is a verdict. A transport blip must NOT be read as
  // "signed out" — confusing those two is precisely the bug that gating on an
  // unreadable page caused elsewhere.
  //
  // "Never read" therefore has to include every response we did not positively
  // serve. This client does NOT follow redirects (followRedirects:false /
  // redirect:'manual' above), so a perfectly good login whose GET / answers 302
  // hands us an empty body — which scrapes to null, not undefined. Gating on that
  // failed a SUCCESSFUL login and, via _recoverSession, fed the dead-session
  // breaker that aborts the long unattended jobs this mode exists to serve. Only
  // a 2xx page we actually read can say "nobody is signed in".
  let userId;
  try {
    const res = await request(client, 'GET', '/', { jar });
    const html = await res.text();
    const fresh = scrapeCsrf(html);
    if (fresh) csrf = fresh;
    if (res.status >= 200 && res.status < 300) userId = scrapeSessionUserId(html);
  } catch { /* keep the existing csrf; a failed read is not a login verdict */ }

  if (userId === null) {
    throw new Error(
      'DIRECT_LOGIN_UNVERIFIED: the login flow finished but airtable.com served no signed-in user — '
      + 'a session cookie alone does not prove a completed login (an SSO/2FA step may be incomplete). '
      + 'Check AIRTABLE_EMAIL / AIRTABLE_PASSWORD / AIRTABLE_TOTP_SECRET, or use AIRTABLE_AUTH_MODE=browser.'
    );
  }

  return { cookieHeader: jarToCookieHeader(jar), csrfToken: csrf, userId: userId ?? null };
}
