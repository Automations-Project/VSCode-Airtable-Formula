import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { directLogin } from '../src/direct-login.js';
import { setInjectedCredentials, clearInjectedCredentials } from '../src/daemon/cred-store.js';

/**
 * Phase B — browser-free direct login (impit + TOTP), replicating the
 * HAR-verified Airtable cold-login flow over HTTP:
 *   GET /login (scrape csrf, collect cookies)
 *     → POST /auth/getLoginTypeForEmail
 *     → POST /auth/login/
 *     → POST /auth/verify2faCode (only when 2FA is required)
 *   → re-scrape csrf from an authed GET /
 *
 * All network is mocked via an injected impitFactory returning canned
 * responses; NO live Airtable calls. TOTP is injected via otpFactory so the
 * generated code is deterministic and otpauth is never imported.
 */

/**
 * A scripted fake impit. `script` is an array of response descriptors consumed
 * in fetch order. Each descriptor: { status?, body?, location?, setCookies? }.
 * Exposes a WHATWG-ish response (getSetCookie() + get() + text()).
 */
function makeFakeImpit(script) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      const desc = script[i++] ?? {};
      return {
        status: desc.status ?? 200,
        headers: {
          getSetCookie: () => desc.setCookies || [],
          get: (name) => {
            const n = String(name).toLowerCase();
            if (n === 'set-cookie') return desc.setCookies || null;
            if (n === 'location') return desc.location ?? null;
            return null;
          },
        },
        text: async () => desc.body ?? '',
      };
    },
  };
}

const CREDS = { email: 'user@example.com', password: 'hunter2' };

/**
 * A real AUTHED Airtable homepage carries the signed-in user id in its bootstrap
 * as "sessionUserId":"usr…" — the only place it appears anywhere (the API's
 * getUserProperties answers with 8 feature-flag booleans and no identity at all:
 * live probes against airtable.com, 2026-07). directLogin now requires it as the
 * proof that the login completed, because a __Host-airtable-session cookie in the
 * jar proves only that Airtable set one (issue #21).
 */
const AUTHED_USER_ID = 'usrDIRECT00000000';
const authedHome = (csrfToken) =>
  `<html><script>{"csrfToken":"${csrfToken}","sessionUserId":"${AUTHED_USER_ID}"}</script></html>`;

function bodyParams(call) {
  return new URLSearchParams(call.options.body);
}

describe('directLogin — happy path WITH 2FA', () => {
  it('runs the 4 auth requests in order, threads _csrf, accumulates cookies, posts the generated TOTP', async () => {
    const impit = makeFakeImpit([
      // 1. GET /login
      { status: 200, body: '<html><script>{"csrfToken":"CSRF-1"}</script></html>', setCookies: ['brw=BRW1; Path=/; HttpOnly'] },
      // 2. getLoginTypeForEmail — password account
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      // 3. login → 2FA challenge
      { status: 302, location: '/2fa/tfaABC123', setCookies: ['__Host-airtable-session=SESS1; Path=/', '__Host-airtable-session.sig=SIG1; Path=/'] },
      // 4. verify2faCode → success, session rotated
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=SESS2; Path=/'] },
      // 5. authed GET / — fresh csrf after session rotation
      { status: 200, body: authedHome('CSRF-2') },
    ]);

    let totpArg = null;
    const out = await directLogin({
      ...CREDS,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      impitFactory: () => impit,
      otpFactory: (secret) => { totpArg = secret; return '654321'; },
    });

    // First 4 requests, in order.
    assert.match(impit.calls[0].url, /\/login$/);
    assert.equal(impit.calls[0].options.method, 'GET');

    assert.match(impit.calls[1].url, /\/auth\/getLoginTypeForEmail$/);
    assert.equal(impit.calls[1].options.method, 'POST');
    assert.equal(bodyParams(impit.calls[1]).get('_csrf'), 'CSRF-1');
    assert.equal(bodyParams(impit.calls[1]).get('email'), CREDS.email);

    assert.match(impit.calls[2].url, /\/auth\/login\/$/);
    assert.equal(bodyParams(impit.calls[2]).get('_csrf'), 'CSRF-1');
    assert.equal(bodyParams(impit.calls[2]).get('email'), CREDS.email);
    assert.equal(bodyParams(impit.calls[2]).get('password'), CREDS.password);

    assert.match(impit.calls[3].url, /\/auth\/verify2faCode$/);
    assert.equal(bodyParams(impit.calls[3]).get('_csrf'), 'CSRF-1');
    assert.equal(bodyParams(impit.calls[3]).get('twoFactorStrategyId'), 'tfaABC123');
    assert.equal(bodyParams(impit.calls[3]).get('code'), '654321');

    // TOTP secret was handed to the generator.
    assert.equal(totpArg, 'JBSWY3DPEHPK3PXP');

    // Cookie jar accumulated across every response (session rotated to SESS2).
    const jar = out.cookieHeader.split('; ').sort();
    assert.ok(jar.includes('brw=BRW1'));
    assert.ok(jar.includes('__Host-airtable-session=SESS2'));
    assert.ok(jar.includes('__Host-airtable-session.sig=SIG1'));

    // csrf re-scraped from the authed GET /.
    assert.equal(out.csrfToken, 'CSRF-2');
    // …and so is the signed-in user, which is what auth.userId now reports in
    // direct-login mode instead of leaving it null.
    assert.equal(out.userId, AUTHED_USER_ID);
  });
});

describe('directLogin — happy path WITHOUT 2FA', () => {
  it('login 302s straight to / and verify2faCode is never called', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-A"}', setCookies: ['brw=B1; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=SESSA; Path=/', '__Host-airtable-session.sig=SIGA; Path=/'] },
      { status: 200, body: authedHome('CSRF-B') },
    ]);

    const out = await directLogin({ ...CREDS, impitFactory: () => impit });

    // Exactly 4 requests: GET /login, getLoginType, login, re-scrape GET /.
    assert.equal(impit.calls.length, 4);
    assert.ok(!impit.calls.some((c) => /verify2faCode/.test(c.url)));
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=SESSA'));
    assert.equal(out.csrfToken, 'CSRF-B');
  });
});

describe('directLogin — a non-2xx final GET / is not a signed-out verdict', () => {
  // This client does NOT follow redirects, so a perfectly good login whose final
  // GET / answers 302 hands us an empty body — which scrapes to null, the same
  // value a genuinely signed-out 200 page produces. Gating on that failed a
  // SUCCESSFUL login and, through _recoverSession, fed the dead-session breaker
  // that aborts long unattended records jobs. Only a 2xx page we actually read
  // can say "nobody is signed in". Every other fixture in this file returns
  // 200-with-sessionUserId, which is exactly why the suite once passed with this
  // regression in the tree.
  for (const final of [
    { status: 302, body: 'Found. Redirecting to /workspaces', label: '302 redirect' },
    { status: 429, body: '', label: '429 throttle' },
    { status: 503, body: '<html>upstream unavailable</html>', label: '503 interstitial' },
  ]) {
    it(`${final.label} → login succeeds, userId is left unknown`, async () => {
      const impit = makeFakeImpit([
        { status: 200, body: '{"csrfToken":"CSRF-A"}', setCookies: ['brw=B1; Path=/'] },
        { status: 200, body: JSON.stringify({ loginType: 'password' }) },
        { status: 302, location: '/', setCookies: ['__Host-airtable-session=SESSA; Path=/', '__Host-airtable-session.sig=SIGA; Path=/'] },
        final,
      ]);

      const out = await directLogin({ ...CREDS, impitFactory: () => impit });

      assert.ok(out.cookieHeader.includes('__Host-airtable-session=SESSA'));
      // The login-flow csrf survives — the re-scrape is best-effort, not a gate.
      assert.equal(out.csrfToken, 'CSRF-A');
      assert.equal(out.userId, null);
    });
  }

  it('a 2xx page that really carries no signed-in user still throws', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-A"}', setCookies: ['brw=B1; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=SESSA; Path=/', '__Host-airtable-session.sig=SIGA; Path=/'] },
      { status: 200, body: '<html><script>{"csrfToken":"CSRF-B"}</script></html>' },
    ]);

    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_UNVERIFIED/,
    );
  });
});

describe('directLogin — failure branches', () => {
  it('SSO account → throws DIRECT_LOGIN_SSO_UNSUPPORTED before attempting a password login', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'sso' }) },
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_SSO_UNSUPPORTED/,
    );
    // Never reached the /auth/login/ POST.
    assert.equal(impit.calls.length, 2);
  });

  it('bad password → throws DIRECT_LOGIN_BAD_CREDENTIALS', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 401, body: 'Invalid email or password' },
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_BAD_CREDENTIALS.*401/,
    );
  });

  it('2FA required but no TOTP secret → throws DIRECT_LOGIN_2FA_REQUIRED', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/2fa/tfaZ', setCookies: ['__Host-airtable-session=S; Path=/'] },
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_2FA_REQUIRED/,
    );
  });

  it('2FA code rejected → throws DIRECT_LOGIN_2FA_REJECTED', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/2fa/tfaZ', setCookies: ['__Host-airtable-session=S; Path=/'] },
      { status: 200, body: 'Invalid two-factor code' }, // non-redirect = rejected
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, totpSecret: 'JBSWY3DPEHPK3PXP', impitFactory: () => impit, otpFactory: () => '000000' }),
      /DIRECT_LOGIN_2FA_REJECTED/,
    );
  });

  // The reporter's own "cookie presence proves nothing" bullet (issue #21):
  // jar.has('__Host-airtable-session') used to be the ONLY check here, and
  // _doInitDirectLogin then set isLoggedIn=true with no verification at all.
  it('session cookie set but the authed page serves NO signed-in user → throws DIRECT_LOGIN_UNVERIFIED', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=S; Path=/'] },
      // A cookie was set, but this is a signed-out page.
      { status: 200, body: '<html><body>Sign in</body></html>' },
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_UNVERIFIED/,
    );
  });

  // The other half of the tri-state: an UNREADABLE page is not a verdict. Reading
  // "could not fetch" as "signed out" is the exact conflation that turned a scrape
  // miss into a total outage at init, so direct-login must not repeat it — a
  // transport blip during the best-effort csrf refresh keeps the login.
  it('a failed authed GET / is NOT read as signed out — login stands, userId unknown', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=S; Path=/'] },
    ]);
    const boom = { async fetch(url, options) {
      if (new URL(url).pathname === '/' && options.method === 'GET') throw new Error('ECONNRESET');
      return impit.fetch(url, options);
    } };
    const out = await directLogin({ ...CREDS, impitFactory: () => boom });
    assert.equal(out.csrfToken, 'CSRF-1', 'keeps the login-flow token, as before');
    assert.equal(out.userId, null);
  });

  it('login completes but no session cookie was set → throws DIRECT_LOGIN_NO_SESSION', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: [] }, // no __Host-airtable-session
      { status: 200, body: '{"csrfToken":"CSRF-2"}' },
    ]);
    await assert.rejects(
      () => directLogin({ ...CREDS, impitFactory: () => impit }),
      /DIRECT_LOGIN_NO_SESSION/,
    );
  });
});

describe('directLogin — credential resolution', () => {
  const ENV = ['AIRTABLE_EMAIL', 'AIRTABLE_PASSWORD', 'AIRTABLE_TOTP_SECRET', 'AIRTABLE_USER_MCP_HOME'];
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    // Point HOME at a dir with no login.json so the file fallback misses.
    process.env.AIRTABLE_USER_MCP_HOME = '/nonexistent-airtable-home-xyz';
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it('throws DIRECT_LOGIN_CREDENTIALS_MISSING when no email/password anywhere', async () => {
    const impit = makeFakeImpit([]);
    await assert.rejects(
      () => directLogin({ impitFactory: () => impit }),
      /DIRECT_LOGIN_CREDENTIALS_MISSING/,
    );
  });

  it('reads email/password from env when params are omitted', async () => {
    process.env.AIRTABLE_EMAIL = 'env@example.com';
    process.env.AIRTABLE_PASSWORD = 'envpw';
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"C1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=S; Path=/'] },
      { status: 200, body: authedHome('C2') },
    ]);
    const out = await directLogin({ impitFactory: () => impit });
    assert.equal(bodyParams(impit.calls[1]).get('email'), 'env@example.com');
    assert.equal(bodyParams(impit.calls[2]).get('password'), 'envpw');
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=S'));
  });
});

describe('directLogin — injected in-memory store (daemon runtime channel)', () => {
  const ENV = ['AIRTABLE_EMAIL', 'AIRTABLE_PASSWORD', 'AIRTABLE_TOTP_SECRET', 'AIRTABLE_USER_MCP_HOME'];
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.AIRTABLE_USER_MCP_HOME = '/nonexistent-airtable-home-xyz';
    clearInjectedCredentials();
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    clearInjectedCredentials();
  });

  it('resolves email/password/totpSecret from the injected store first (over env)', async () => {
    // Env is present but the injected store must win.
    process.env.AIRTABLE_EMAIL = 'env@example.com';
    process.env.AIRTABLE_PASSWORD = 'env-loses';
    process.env.AIRTABLE_TOTP_SECRET = 'ENV-SECRET-LOSES';
    setInjectedCredentials({
      authMode: 'direct-login',
      email: 'injected@example.com',
      password: 'injected-pw',
      totpSecret: 'INJECTED-TOTP-SECRET',
    });

    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"C1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/2fa/tfaINJ', setCookies: ['__Host-airtable-session=S1; Path=/'] },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=S2; Path=/'] },
      { status: 200, body: authedHome('C2') },
    ]);

    let totpArg = null;
    const out = await directLogin({
      impitFactory: () => impit,
      otpFactory: (secret) => { totpArg = secret; return '111222'; },
    });

    assert.equal(bodyParams(impit.calls[1]).get('email'), 'injected@example.com');
    assert.equal(bodyParams(impit.calls[2]).get('email'), 'injected@example.com');
    assert.equal(bodyParams(impit.calls[2]).get('password'), 'injected-pw');
    // Injected TOTP secret was handed to the generator, and its code posted.
    assert.equal(totpArg, 'INJECTED-TOTP-SECRET');
    assert.equal(bodyParams(impit.calls[3]).get('code'), '111222');
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=S2'));
  });

  it('empty injected store → falls back to env (existing behavior unchanged)', async () => {
    process.env.AIRTABLE_EMAIL = 'env@example.com';
    process.env.AIRTABLE_PASSWORD = 'envpw';
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"C1"}', setCookies: ['brw=B; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=S; Path=/'] },
      { status: 200, body: authedHome('C2') },
    ]);
    const out = await directLogin({ impitFactory: () => impit });
    assert.equal(bodyParams(impit.calls[1]).get('email'), 'env@example.com');
    assert.equal(bodyParams(impit.calls[2]).get('password'), 'envpw');
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=S'));
  });
});

// ── CSRF-token-rotation pin (Sentry Seer finding, PR #19) ─────────────────────
//
// The finding claimed: directLogin reuses the csrfToken scraped from GET /login
// for POST /auth/verify2faCode; if Airtable rotates CSRF on successful password
// auth, 2FA verification fails and is misreported as DIRECT_LOGIN_2FA_REJECTED.
//
// Verified against artifacts/AirtableLoginElectronAppSimulation.har (a real
// Electron-app cold login through the same 2FA flow, gitignored, live secrets):
//   * Airtable's CSRF is the standard csurf/`csrf` tokenizer — every observed
//     token is 36 chars of the form <8-char salt>-<27-char base64url sha1>,
//     and `salt + '-' + b64url(sha1(salt + '-' + csrfSecret))` reproduces each
//     one exactly.
//   * `csrfSecret` lives inside the `__Host-airtable-session` cookie (base64
//     JSON) and is BYTE-IDENTICAL at every step of the capture: before login,
//     after POST /auth/login/ (which only ADDS userIdPending2fa +
//     twoFactorStartTime), after POST /auth/verify2faCode (which only ADDS
//     userId + didJustLogIn), and on the post-login GET /.
//   * Consequence: the GET /login token cryptographically verifies against the
//     exact secret the session holds at verify2faCode time. Reusing it is safe.
//     The real browser posts the /2fa page's token only because it follows the
//     302 and re-renders that page with a fresh salt — same secret, not a
//     rotation.
//
// These two tests use a CSRF-AWARE fake Airtable that actually validates _csrf
// against the secret carried in the presented session cookie, so they exercise
// the rotation path instead of restating the implementation.

/** csurf/`csrf` tokenizer: token = salt + '-' + b64url(sha1(salt + '-' + secret)). */
function csrfTokenize(secret, salt) {
  const hash = crypto.createHash('sha1').update(`${salt}-${secret}`, 'ascii').digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${salt}-${hash}`;
}

/** Server-side check: does `token` derive from `secret`? */
function csrfVerify(secret, token) {
  if (typeof secret !== 'string' || typeof token !== 'string') return false;
  const dash = token.indexOf('-');
  if (dash < 0) return false;
  return csrfTokenize(secret, token.slice(0, dash)) === token;
}

const SESSION_COOKIE = '__Host-airtable-session';

/** Encode a session cookie the way Airtable does: base64(JSON) incl. csrfSecret. */
function sessionCookie(payload) {
  const value = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure`;
}

/** Read the csrfSecret out of the session cookie the client presented. */
function presentedSecret(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const s = part.trim();
    if (!s.startsWith(`${SESSION_COOKIE}=`)) continue;
    try {
      const json = Buffer.from(s.slice(SESSION_COOKIE.length + 1), 'base64').toString('utf8');
      return JSON.parse(json).csrfSecret ?? null;
    } catch { return null; }
  }
  return null;
}

function fakeResponse({ status = 200, body = '', location = null, setCookies = [] } = {}) {
  return {
    status,
    headers: {
      getSetCookie: () => setCookies,
      get: (name) => {
        const n = String(name).toLowerCase();
        if (n === 'set-cookie') return setCookies.length ? setCookies : null;
        if (n === 'location') return location;
        return null;
      },
    },
    text: async () => body,
  };
}

/**
 * A route-driven fake Airtable that enforces CSRF exactly like the real one:
 * every POST's `_csrf` is validated against the csrfSecret inside the session
 * cookie the client presents, and each HTML page embeds a freshly SALTED token
 * derived from the secret that session currently holds.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.rotateSecretAtPasswordAuth=false]
 *   false → HAR-observed reality: POST /auth/login/ keeps the same csrfSecret.
 *   true  → the counterfactual world the Seer finding assumes.
 */
function makeCsrfAwareAirtable({ rotateSecretAtPasswordAuth = false } = {}) {
  const ANON_SECRET = 'anon-session-csrf-secret';
  const POST_LOGIN_SECRET = rotateSecretAtPasswordAuth ? 'rotated-csrf-secret' : ANON_SECRET;
  const tokens = {
    loginPage: csrfTokenize(ANON_SECRET, 'saltLOGN'),
    twoFaPage: csrfTokenize(POST_LOGIN_SECRET, 'salt2FAP'),
    home: csrfTokenize(POST_LOGIN_SECRET, 'saltHOME'),
  };
  const page = (token) => `<html><script>window.__init={"csrfToken":"${token}"}</script></html>`;
  const calls = [];

  return {
    calls,
    tokens,
    secrets: { anon: ANON_SECRET, postLogin: POST_LOGIN_SECRET },
    async fetch(url, options) {
      const { pathname } = new URL(url);
      const form = options.body ? new URLSearchParams(options.body) : new URLSearchParams();
      const posted = form.get('_csrf');
      const secret = presentedSecret(options.headers?.Cookie);
      calls.push({ pathname, method: options.method, posted, presentedSecret: secret });
      const csrfOk = () => csrfVerify(secret, posted);

      switch (pathname) {
        case '/login':
          // Anonymous session carrying the secret that backs the page's token.
          return fakeResponse({
            body: page(tokens.loginPage),
            setCookies: ['brw=BRW1; Path=/', sessionCookie({ sessionId: 'sess-1', csrfSecret: ANON_SECRET })],
          });
        case '/auth/getLoginTypeForEmail':
          if (!csrfOk()) return fakeResponse({ status: 403, body: 'invalid csrf token' });
          return fakeResponse({ body: JSON.stringify({ loginType: 'password' }) });
        case '/auth/login/':
          if (!csrfOk()) return fakeResponse({ status: 403, body: 'invalid csrf token' });
          // HAR: the session cookie VALUE changes here (userIdPending2fa +
          // twoFactorStartTime are added) while sessionId and csrfSecret stay put.
          return fakeResponse({
            status: 302,
            location: '/2fa/tfaSEER1',
            setCookies: [sessionCookie({
              sessionId: 'sess-1',
              csrfSecret: POST_LOGIN_SECRET,
              userIdPending2fa: 'usrTEST',
              twoFactorStartTime: 1,
            })],
          });
        case '/2fa/tfaSEER1':
          // The page a real BROWSER renders after following the 302. directLogin
          // does not follow redirects, so it never fetches this.
          return fakeResponse({ body: page(tokens.twoFaPage) });
        case '/auth/verify2faCode':
          if (!csrfOk()) return fakeResponse({ status: 403, body: 'invalid csrf token' });
          if (form.get('code') !== '654321') return fakeResponse({ body: 'Invalid two-factor code' });
          return fakeResponse({
            status: 302,
            location: '/',
            setCookies: [sessionCookie({
              sessionId: 'sess-1',
              csrfSecret: POST_LOGIN_SECRET,
              userId: 'usrTEST',
              didJustLogIn: true,
            })],
          });
        case '/':
          // Authed homepage: carries the signed-in user id, as a real one does.
          return fakeResponse({ body: authedHome(tokens.home) });
        default:
          throw new Error(`fake Airtable: unexpected request ${options.method} ${pathname}`);
      }
    },
  };
}

describe('directLogin — CSRF token across the 2FA step (Sentry Seer PR #19 finding)', () => {
  it('reuses the GET /login token for POST /auth/verify2faCode and Airtable ACCEPTS it, because password auth does not rotate csrfSecret (HAR-verified)', async () => {
    const airtable = makeCsrfAwareAirtable({ rotateSecretAtPasswordAuth: false });

    // Resolves ⇒ the CSRF-enforcing fake returned 302 for verify2faCode ⇒ the
    // reused /login token passed a REAL salt-hash check against the secret the
    // session holds at 2FA time. This is the protocol assertion and it survives
    // any future defensive re-scrape.
    const out = await directLogin({
      ...CREDS,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      impitFactory: () => airtable,
      otpFactory: () => '654321',
    });

    const verify = airtable.calls.find((c) => c.pathname === '/auth/verify2faCode');
    assert.ok(verify, 'verify2faCode must have been called');

    // Behavioural pin: today the token posted to 2FA is the one scraped from
    // GET /login — NOT one re-scraped after the login POST. If a defensive
    // re-scrape is ever added, update this pin deliberately (see
    // .superpowers/sdd/PLAN/task-6-report.md).
    assert.equal(verify.posted, airtable.tokens.loginPage,
      'verify2faCode should carry the GET /login token (current, HAR-safe behavior)');
    assert.notEqual(verify.posted, airtable.tokens.twoFaPage,
      'the /2fa page token is never fetched — directLogin does not follow the 302');

    // …and that reused token really is valid for the post-login session secret.
    assert.equal(csrfVerify(airtable.secrets.postLogin, verify.posted), true,
      'the /login token must verify against the csrfSecret held after password auth');
    assert.equal(airtable.secrets.anon, airtable.secrets.postLogin,
      'no rotation: this is the HAR-observed protocol');

    // Redirects are manual (fetch redirect:"manual" / impit followRedirects:false),
    // so the 2FA page is never GET-ed and its token is never available to scrape.
    assert.ok(!airtable.calls.some((c) => c.pathname.startsWith('/2fa/')),
      'directLogin must not follow the login 302 into the 2FA page');

    // Final credential still comes from the authed GET / re-scrape.
    assert.equal(out.csrfToken, airtable.tokens.home);
  });

  it('negative control: if Airtable DID rotate csrfSecret at password auth, the reused /login token is rejected and surfaces as DIRECT_LOGIN_2FA_REJECTED', async () => {
    const airtable = makeCsrfAwareAirtable({ rotateSecretAtPasswordAuth: true });

    // Sanity: the failure below must be caused by token staleness, not a broken
    // mock — the token a browser WOULD have scraped from /2fa is still valid.
    assert.equal(csrfVerify(airtable.secrets.postLogin, airtable.tokens.twoFaPage), true);
    assert.equal(csrfVerify(airtable.secrets.postLogin, airtable.tokens.loginPage), false);

    await assert.rejects(
      () => directLogin({
        ...CREDS,
        totpSecret: 'JBSWY3DPEHPK3PXP',
        impitFactory: () => airtable,
        otpFactory: () => '654321',
      }),
      /DIRECT_LOGIN_2FA_REJECTED.*403/,
      'a rotating server would produce exactly the misleading error the Seer finding described',
    );
  });
});
