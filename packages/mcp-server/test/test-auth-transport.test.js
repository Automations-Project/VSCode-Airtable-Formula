import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

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

  it('json POST: application/json Content-Type, JSON body, and Cookie', async () => {
    transport.next = { status: 200, body: '{}' };
    await auth._rawApiCall('POST', '/v0.3/attachments/urlUpload', { a: 1, b: 'x' }, 'appABC123', 'json');
    const req = transport.calls[0];
    assert.equal(req.headers['Content-Type'], 'application/json');
    assert.equal(req.headers.Cookie, 'brw=1; sess=2');
    assert.deepEqual(JSON.parse(req.body), { a: 1, b: 'x' });
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
