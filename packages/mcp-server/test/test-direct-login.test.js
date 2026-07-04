import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
      { status: 200, body: '<html><script>{"csrfToken":"CSRF-2"}</script></html>' },
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
  });
});

describe('directLogin — happy path WITHOUT 2FA', () => {
  it('login 302s straight to / and verify2faCode is never called', async () => {
    const impit = makeFakeImpit([
      { status: 200, body: '{"csrfToken":"CSRF-A"}', setCookies: ['brw=B1; Path=/'] },
      { status: 200, body: JSON.stringify({ loginType: 'password' }) },
      { status: 302, location: '/', setCookies: ['__Host-airtable-session=SESSA; Path=/', '__Host-airtable-session.sig=SIGA; Path=/'] },
      { status: 200, body: '{"csrfToken":"CSRF-B"}' },
    ]);

    const out = await directLogin({ ...CREDS, impitFactory: () => impit });

    // Exactly 4 requests: GET /login, getLoginType, login, re-scrape GET /.
    assert.equal(impit.calls.length, 4);
    assert.ok(!impit.calls.some((c) => /verify2faCode/.test(c.url)));
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=SESSA'));
    assert.equal(out.csrfToken, 'CSRF-B');
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
      { status: 200, body: '{"csrfToken":"C2"}' },
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
      { status: 200, body: '{"csrfToken":"C2"}' },
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
      { status: 200, body: '{"csrfToken":"C2"}' },
    ]);
    const out = await directLogin({ impitFactory: () => impit });
    assert.equal(bodyParams(impit.calls[1]).get('email'), 'env@example.com');
    assert.equal(bodyParams(impit.calls[2]).get('password'), 'envpw');
    assert.ok(out.cookieHeader.includes('__Host-airtable-session=S'));
  });
});
