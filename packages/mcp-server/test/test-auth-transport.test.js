import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';

/**
 * Phase 1 transport core — auth side.
 *
 * _rawApiCall now builds the request headers (identical to the old in-page
 * fetch) + a Cookie header + (_csrf on form POSTs) from a captured credential
 * snapshot, then hands the request to an injectable HttpTransport instead of
 * page.evaluate(). These tests exercise the REAL _rawApiCall over a fake
 * transport (not a stubbed _rawApiCall), proving the header/cookie/_csrf
 * construction AND that the untouched _apiCall backoff/recovery loop still
 * fires over the new path.
 */

function fakeTransport() {
  return {
    calls: [],
    next: null, // a response value, or (req, n) => response
    async request(req) {
      this.calls.push(req);
      const r = typeof this.next === 'function' ? this.next(req, this.calls.length) : this.next;
      return r || { status: 200, body: '{}' };
    },
  };
}

describe('auth._rawApiCall → HttpTransport', () => {
  let auth, transport;
  beforeEach(() => {
    auth = new AirtableAuth();
    transport = fakeTransport();
    auth._httpTransport = transport;
    auth._credentials = { cookieHeader: 'brw=1; sess=2', csrfToken: 'CSRF-XYZ' };
    auth.context = {};
    auth.isLoggedIn = true;
    auth.page = { url: () => 'https://airtable.com/' };
  });

  it('form POST: sends Cookie, the standard headers, and a urlencoded body with _csrf', async () => {
    transport.next = { status: 200, body: '{"ok":true}' };
    const out = await auth._rawApiCall('POST', '/v0.3/column/x/create', { name: 'Foo Bar' }, 'appABC123', 'form');
    assert.equal(out.status, 200);
    const req = transport.calls[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://airtable.com/v0.3/column/x/create');
    assert.equal(req.headers.Cookie, 'brw=1; sess=2');
    assert.equal(req.headers['x-airtable-inter-service-client'], 'webClient');
    assert.equal(req.headers['x-requested-with'], 'XMLHttpRequest');
    assert.equal(req.headers['x-user-locale'], 'en');
    assert.ok(req.headers['x-airtable-page-load-id']?.startsWith('pgl'));
    assert.equal(req.headers['x-airtable-application-id'], 'appABC123');
    assert.match(req.headers['Content-Type'], /x-www-form-urlencoded/);
    const params = new URLSearchParams(req.body);
    assert.equal(params.get('name'), 'Foo Bar');
    assert.equal(params.get('_csrf'), 'CSRF-XYZ');
  });

  it('GET: no body, no _csrf, still sends Cookie + the standard headers', async () => {
    transport.next = { status: 200, body: '{}' };
    await auth._rawApiCall('GET', '/v0.3/getUserProperties', null, 'appABC123', 'form');
    const req = transport.calls[0];
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.Cookie, 'brw=1; sess=2');
    assert.equal(req.headers['x-airtable-application-id'], 'appABC123');
    assert.equal(req.body === null || req.body === undefined, true);
    assert.equal('Content-Type' in req.headers, false);
  });

  it('json POST: application/json Content-Type, JSON body, Cookie, and the current _csrf injected', async () => {
    transport.next = { status: 200, body: '{}' };
    await auth._rawApiCall('POST', '/v0.3/attachments/urlUpload', { a: 1, b: 'x' }, 'appABC123', 'json');
    const req = transport.calls[0];
    assert.equal(req.headers['Content-Type'], 'application/json');
    assert.equal(req.headers.Cookie, 'brw=1; sess=2');
    // _rawApiCall injects _csrf into every JSON body at send time (mirrors the
    // form-encoded branch), so callers never need to (and can't accidentally
    // ship a stale one — see the dedicated race test below).
    assert.deepEqual(JSON.parse(req.body), { a: 1, b: 'x', _csrf: 'CSRF-XYZ' });
  });

  it('json POST: overwrites a stale _csrf baked into the body with the CURRENT token at send time', async () => {
    transport.next = { status: 200, body: '{}' };
    // Simulate a caller (e.g. addAttachmentByUrl) that built its body earlier,
    // baking in whatever csrfToken existed then...
    const bodyBuiltEarlier = { url: 'https://example.com/f.png', _csrf: 'STALE-CSRF-FROM-BEFORE' };
    // ...then a concurrent session recovery re-mints the token before this
    // request actually reaches the wire.
    auth._credentials.csrfToken = 'FRESH-CSRF-AFTER-RECOVERY';
    auth.csrfToken = 'FRESH-CSRF-AFTER-RECOVERY';
    await auth._rawApiCall('POST', '/v0.3/attachments/urlUpload', bodyBuiltEarlier, 'appABC123', 'json');
    const sent = JSON.parse(transport.calls[0].body);
    assert.equal(sent._csrf, 'FRESH-CSRF-AFTER-RECOVERY');
  });

  it('builds an absolute URL only for path inputs, leaving full URLs intact', async () => {
    transport.next = { status: 200, body: '{}' };
    await auth._rawApiCall('GET', 'https://airtable.com/v0.3/already/full');
    assert.equal(transport.calls[0].url, 'https://airtable.com/v0.3/already/full');
  });

  it('passes the transport status straight through (500)', async () => {
    transport.next = { status: 500, body: 'err' };
    const out = await auth._rawApiCall('GET', '/v0.3/x');
    assert.deepEqual(out, { status: 500, body: 'err' });
  });

  it('surfaces the transport network-error shape ({status:0, error})', async () => {
    transport.next = { status: 0, body: '', error: 'boom' };
    const out = await auth._rawApiCall('GET', '/v0.3/x');
    assert.equal(out.status, 0);
    assert.equal(out.error, 'boom');
  });
});

describe('auth._apiCall backoff/recovery over the real _rawApiCall → transport path', () => {
  let auth, transport;
  beforeEach(() => {
    auth = new AirtableAuth();
    transport = fakeTransport();
    auth._httpTransport = transport;
    auth._credentials = { cookieHeader: 'c=1', csrfToken: 'z' };
    auth.context = {};
    auth.isLoggedIn = true;
    auth.page = { url: () => 'https://airtable.com/' };
    auth._rlSleep = async () => {}; // no real backoff waits
  });

  it('429 then 200 → backs off and retries on the same session (no recovery)', async () => {
    let recovered = false;
    auth._recoverSession = async () => { recovered = true; };
    let n = 0;
    transport.next = () => (++n === 1 ? { status: 429, body: '' } : { status: 200, body: '{"ok":true}' });
    const res = await auth._apiCall('GET', '/v0.3/x', null, 'app1');
    assert.equal(res.status, 200);
    assert.equal(n, 2);
    assert.equal(recovered, false);
  });

  it('403 (throttle) then 200 → backs off, no relaunch', async () => {
    let n = 0;
    transport.next = () => (++n === 1 ? { status: 403, body: '' } : { status: 200, body: '{}' });
    const res = await auth._apiCall('GET', '/v0.3/x', null, 'app1');
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  });

  it('401 → triggers _recoverSession, then succeeds', async () => {
    let recovered = false;
    auth._recoverSession = async () => { recovered = true; };
    let n = 0;
    transport.next = () => (++n === 1 ? { status: 401, body: '' } : { status: 200, body: '{}' });
    const res = await auth._apiCall('GET', '/v0.3/x', null, 'app1');
    assert.equal(recovered, true);
    assert.equal(res.status, 200);
  });

  it('a transport network error ({status:0, error}) triggers _recoverSession', async () => {
    let recovered = false;
    auth._recoverSession = async () => { recovered = true; };
    let n = 0;
    transport.next = () => (++n === 1 ? { status: 0, body: '', error: 'net down' } : { status: 200, body: '{}' });
    const res = await auth._apiCall('GET', '/v0.3/x', null, 'app1');
    assert.equal(recovered, true);
    assert.equal(res.status, 200);
  });
});

describe('auth._snapshotCredentials', () => {
  it('builds a Cookie header from airtable-domain cookies and caches the csrf token', async () => {
    const auth = new AirtableAuth();
    auth.csrfToken = 'CSRF-1';
    auth.page = {
      context: () => ({
        cookies: async () => [
          { name: 'brw', value: '1', domain: '.airtable.com' },
          { name: 'sess', value: '2', domain: 'airtable.com' },
          { name: 'other', value: 'x', domain: '.google.com' }, // must be excluded
        ],
      }),
    };
    await auth._snapshotCredentials();
    assert.equal(auth._credentials.csrfToken, 'CSRF-1');
    const jar = auth._credentials.cookieHeader.split('; ').sort();
    assert.deepEqual(jar, ['brw=1', 'sess=2']);
    assert.ok(!auth._credentials.cookieHeader.includes('other'));
  });

  it('degrades to an empty cookie header if reading cookies throws', async () => {
    const auth = new AirtableAuth();
    auth.csrfToken = 'CSRF-2';
    auth.page = { context: () => ({ cookies: async () => { throw new Error('ctx dead'); } }) };
    await auth._snapshotCredentials();
    assert.equal(auth._credentials.cookieHeader, '');
    assert.equal(auth._credentials.csrfToken, 'CSRF-2');
  });
});

describe('auth AIRTABLE_AUTH_MODE=byo', () => {
  const ENV = ['AIRTABLE_AUTH_MODE', 'AIRTABLE_COOKIE', 'AIRTABLE_CSRF'];
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of ENV) saved[k] = process.env[k];
    for (const k of ENV) delete process.env[k];
  });
  const restore = () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  };

  function byoAuth(transport) {
    // AIRTABLE_AUTH_MODE is read in the constructor, so env must be set first.
    process.env.AIRTABLE_AUTH_MODE = 'byo';
    const auth = new AirtableAuth();
    auth._httpTransport = transport;
    return auth;
  }

  it('init loads pasted creds and verifies WITHOUT launching a browser', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=byo; __Host-airtable-session=sess';
    process.env.AIRTABLE_CSRF = 'BYO-CSRF'; // avoids a network scrape
    const transport = fakeTransport();
    transport.next = { status: 200, body: JSON.stringify({ data: { userId: 'usr999' } }) };
    try {
      const auth = byoAuth(transport);
      await auth.init();
      // No browser: context/page stay null, but the session is logged in.
      assert.equal(auth.context, null);
      assert.equal(auth.page, null);
      assert.equal(auth.isLoggedIn, true);
      assert.equal(auth.userId, 'usr999');
      // The verify GET carried the byo cookie via the direct-HTTP transport.
      assert.equal(transport.calls[0].method, 'GET');
      assert.match(transport.calls[0].url, /getUserProperties/);
      assert.equal(transport.calls[0].headers.Cookie, 'brw=byo; __Host-airtable-session=sess');
    } finally {
      restore();
    }
  });

  it('a rejected cookie throws BYO_CREDENTIALS_INVALID', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=stale';
    process.env.AIRTABLE_CSRF = 'x';
    const transport = fakeTransport();
    transport.next = { status: 401, body: 'nope' };
    try {
      const auth = byoAuth(transport);
      await assert.rejects(() => auth.init(), /BYO_CREDENTIALS_INVALID.*401/);
      assert.equal(auth.isLoggedIn, false);
    } finally {
      restore();
    }
  });

  it('a subsequent _apiCall carries the byo cookie and needs no browser', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=byo2';
    process.env.AIRTABLE_CSRF = 'c2';
    const transport = fakeTransport();
    transport.next = { status: 200, body: '{"data":{}}' };
    try {
      const auth = byoAuth(transport);
      const res = await auth.get('/v0.3/x', 'appZZ');
      assert.equal(res.status, 200);
      // First call = the init verify, second = our get; both carry the cookie.
      assert.ok(transport.calls.length >= 2);
      for (const c of transport.calls) assert.equal(c.headers.Cookie, 'brw=byo2');
    } finally {
      restore();
    }
  });

  it('recovery re-loads credentials (user refreshed the cookie) and re-verifies', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=old';
    process.env.AIRTABLE_CSRF = 'c';
    const transport = fakeTransport();
    transport.next = { status: 200, body: '{"data":{"userId":"u1"}}' };
    try {
      const auth = byoAuth(transport);
      await auth.init();
      assert.equal(auth._credentials.cookieHeader, 'brw=old');
      // User pastes a fresh cookie, then a recovery fires.
      process.env.AIRTABLE_COOKIE = 'brw=fresh';
      await auth._recoverSession();
      assert.equal(auth._credentials.cookieHeader, 'brw=fresh');
      assert.equal(auth.isLoggedIn, true);
    } finally {
      restore();
    }
  });

  it('recovery with a still-invalid cookie throws BYO_CREDENTIALS_EXPIRED', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=old';
    process.env.AIRTABLE_CSRF = 'c';
    const transport = fakeTransport();
    let n = 0;
    transport.next = () => (++n === 1 ? { status: 200, body: '{"data":{}}' } : { status: 401, body: '' });
    try {
      const auth = byoAuth(transport);
      await auth.init();
      await assert.rejects(() => auth._recoverSession(), /BYO_CREDENTIALS_EXPIRED/);
    } finally {
      restore();
    }
  });

});

describe('auth AIRTABLE_AUTH_MODE=direct-login', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.AIRTABLE_AUTH_MODE;
    process.env.AIRTABLE_AUTH_MODE = 'direct-login';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AIRTABLE_AUTH_MODE;
    else process.env.AIRTABLE_AUTH_MODE = saved;
  });

  it('_doInit calls directLogin (via the injected seam) and never launches a browser', async () => {
    const auth = new AirtableAuth();
    let called = false;
    // Inject the login minter — real directLogin would need impit + network.
    auth._directLogin = async () => {
      called = true;
      return { cookieHeader: 'brw=1; __Host-airtable-session=s', csrfToken: 'C' };
    };
    await auth.init();
    assert.equal(called, true);
    // No browser: context/page stay null, but the session is logged in.
    assert.equal(auth.context, null);
    assert.equal(auth.page, null);
    assert.equal(auth.isLoggedIn, true);
    assert.equal(auth.csrfToken, 'C');
    assert.equal(auth._credentials.cookieHeader, 'brw=1; __Host-airtable-session=s');
  });

  it('_recoverSession re-runs directLogin to mint fresh cookies', async () => {
    const auth = new AirtableAuth();
    let n = 0;
    auth._directLogin = async () => { n++; return { cookieHeader: `c=${n}`, csrfToken: `csrf${n}` }; };
    await auth.init();
    assert.equal(auth._credentials.cookieHeader, 'c=1');
    await auth._recoverSession();
    assert.equal(auth._credentials.cookieHeader, 'c=2');
    assert.equal(auth.csrfToken, 'csrf2');
    assert.equal(auth.isLoggedIn, true);
  });

  it('a subsequent _apiCall carries the minted cookie and needs no browser', async () => {
    const auth = new AirtableAuth();
    const transport = fakeTransport();
    auth._httpTransport = transport;
    auth._directLogin = async () => ({ cookieHeader: 'brw=minted', csrfToken: 'mc' });
    transport.next = { status: 200, body: '{"data":{}}' };
    const res = await auth.get('/v0.3/x', 'appZZ');
    assert.equal(res.status, 200);
    assert.equal(transport.calls[0].headers.Cookie, 'brw=minted');
  });

  it('_recoverSession surfaces a SESSION_INVALID error when the login flow fails', async () => {
    const auth = new AirtableAuth();
    auth._directLogin = async () => { throw new Error('DIRECT_LOGIN_BAD_CREDENTIALS: nope'); };
    await assert.rejects(() => auth._recoverSession(), /SESSION_INVALID.*DIRECT_LOGIN_BAD_CREDENTIALS/);
  });
});

describe('auth passive secretSocketId injection (postForm)', () => {
  let auth, transport;
  beforeEach(() => {
    auth = new AirtableAuth();
    transport = fakeTransport();
    auth._httpTransport = transport;
    auth._credentials = { cookieHeader: 'c=1', csrfToken: 'z' };
    auth.context = {};
    auth.isLoggedIn = true;
    // No page.goto stub on purpose — postForm must NEVER navigate to capture a
    // socketId (the blocking nav-capture was removed; live smoke proved mutations
    // succeed without it).
    auth.page = { url: () => 'https://airtable.com/' };
  });

  it('injects a passively-captured socketId into the params when one exists', async () => {
    auth._secretSocketIds.set('appABC123', 'SID-123'); // as if captured during login
    transport.next = { status: 200, body: '{"ok":true}' };
    const params = { stringifiedObjectParams: '{}', requestId: 'r1' };
    await auth.postForm('https://airtable.com/v0.3/column/x/create', params, 'appABC123');
    assert.equal(params.secretSocketId, 'SID-123');
    const body = new URLSearchParams(transport.calls[0].body);
    assert.equal(body.get('secretSocketId'), 'SID-123');
  });

  it('proceeds WITHOUT a socketId (and never navigates) when none was captured', async () => {
    let gotoCalled = false;
    auth.page.goto = async () => { gotoCalled = true; };
    transport.next = { status: 200, body: '{"ok":true}' };
    const params = { stringifiedObjectParams: '{}', requestId: 'r1' };
    const res = await auth.postForm('https://airtable.com/v0.3/column/x/create', params, 'appABC123');
    assert.equal(res.status, 200);
    assert.equal('secretSocketId' in params, false);
    assert.equal(gotoCalled, false);
  });
});

describe('AirtableClient.addAttachmentByUrl — csrf freshness end-to-end', () => {
  it('never ships a csrf token captured before a concurrent session recovery rotated it', async () => {
    const transport = fakeTransport();
    const auth = new AirtableAuth();
    auth._httpTransport = transport;
    auth._credentials = { cookieHeader: 'c=1', csrfToken: 'OLD-CSRF' };
    auth.csrfToken = 'OLD-CSRF';
    auth.userId = 'usr1';
    auth.context = {};
    auth.isLoggedIn = true;
    auth.page = { url: () => 'https://airtable.com/' };
    auth._rlSleep = async () => {};

    // Every _apiCall awaits ensureLoggedIn() before the request is actually
    // dequeued and sent (_apiCall → ensureLoggedIn → _rawApiCall). Rotating the
    // token here simulates a concurrent session recovery landing in exactly that
    // window — AFTER addAttachmentByUrl has already built its request body.
    const realEnsureLoggedIn = auth.ensureLoggedIn.bind(auth);
    auth.ensureLoggedIn = async () => {
      await realEnsureLoggedIn();
      auth.csrfToken = 'NEW-CSRF';
      auth._credentials.csrfToken = 'NEW-CSRF';
    };

    transport.next = (req) => {
      if (req.url.includes('urlUpload')) {
        return {
          status: 200,
          body: JSON.stringify({
            success: true,
            fileUploadResult: {
              propsToAddToAttachmentObj: { url: 'https://cdn/f.png' },
              filename: 'f.png',
              expiringInitialPreviewUrl: 'https://cdn/f.png?exp=1',
            },
          }),
        };
      }
      return { status: 200, body: '{"ok":true}' };
    };

    const client = new AirtableClient(auth);
    const result = await client.addAttachmentByUrl('appABC123', 'recXYZ0000000', 'fldQQQ0000000', {
      url: 'https://example.com/f.png',
    });
    assert.equal(result.ok, true, result.error);

    const uploadReq = transport.calls.find((c) => c.url.includes('urlUpload'));
    assert.ok(uploadReq, 'urlUpload request was never sent');
    const sentBody = JSON.parse(uploadReq.body);
    assert.equal(sentBody._csrf, 'NEW-CSRF');
  });
});
