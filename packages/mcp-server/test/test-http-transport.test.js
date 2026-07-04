import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpTransport } from '../src/http-transport.js';

/**
 * Phase 1 transport core. HttpTransport routes an Airtable API call through
 * direct node HTTP (fetch by default, impit as an opt-in fingerprinting
 * fallback) instead of an in-page page.evaluate(fetch). Its return shape must
 * mirror the old in-page fetch EXACTLY so auth._wrapResponse and the _apiCall
 * backoff loop stay untouched:
 *   success → { status, body }
 *   throw   → { status: 0, body: '', error }
 */

// A recording fake fetch. `response` may be a value or a (url, options) => value fn.
function fakeFetch(recorder, response) {
  return async (url, options) => {
    recorder.url = url;
    recorder.options = options;
    return typeof response === 'function' ? response(url, options) : response;
  };
}

describe('HttpTransport — client selection', () => {
  it('defaults to the fetch client', () => {
    assert.equal(new HttpTransport().client, 'fetch');
  });
  it('treats undefined / empty env value as fetch', () => {
    assert.equal(new HttpTransport({ client: undefined }).client, 'fetch');
    assert.equal(new HttpTransport({ client: '' }).client, 'fetch');
    assert.equal(new HttpTransport({ client: 'bogus' }).client, 'fetch');
  });
  it('honours client: "impit"', () => {
    assert.equal(new HttpTransport({ client: 'impit' }).client, 'impit');
  });
});

describe('HttpTransport — fetch client', () => {
  it('passes method/url/headers/body through and returns {status, body} on 200', async () => {
    const rec = {};
    const t = new HttpTransport({ fetchImpl: fakeFetch(rec, { status: 200, text: async () => 'OK' }) });
    const out = await t.request({
      method: 'POST',
      url: 'https://airtable.com/v0.3/x',
      headers: { Cookie: 'a=b', 'x-test': '1' },
      body: 'foo=bar',
    });
    assert.deepEqual(out, { status: 200, body: 'OK' });
    assert.equal(rec.url, 'https://airtable.com/v0.3/x');
    assert.equal(rec.options.method, 'POST');
    assert.equal(rec.options.headers.Cookie, 'a=b');
    assert.equal(rec.options.headers['x-test'], '1');
    assert.equal(rec.options.body, 'foo=bar');
  });

  it('does not attach a body on GET', async () => {
    const rec = {};
    const t = new HttpTransport({ fetchImpl: fakeFetch(rec, { status: 200, text: async () => '{}' }) });
    await t.request({ method: 'GET', url: 'https://airtable.com/v0.3/y', headers: {}, body: null });
    assert.equal('body' in rec.options, false);
  });

  it('passes a non-2xx status (500) straight through with its body', async () => {
    const rec = {};
    const t = new HttpTransport({ fetchImpl: fakeFetch(rec, { status: 500, text: async () => 'boom' }) });
    const out = await t.request({ method: 'GET', url: 'u', headers: {} });
    assert.deepEqual(out, { status: 500, body: 'boom' });
  });

  it('maps a network throw to { status: 0, body: "", error } (old page.evaluate catch shape)', async () => {
    const t = new HttpTransport({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const out = await t.request({ method: 'GET', url: 'u', headers: {} });
    assert.deepEqual(out, { status: 0, body: '', error: 'ECONNREFUSED' });
  });

  it('falls back to a monkeypatched global fetch when no seam is given', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 201, text: async () => 'created' });
    try {
      const out = await new HttpTransport().request({ method: 'POST', url: 'u', headers: {}, body: 'x=1' });
      assert.deepEqual(out, { status: 201, body: 'created' });
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('HttpTransport — impit client', () => {
  it('uses the impit factory seam and returns {status, body}', async () => {
    let seen;
    const t = new HttpTransport({
      client: 'impit',
      impitFactory: async () => ({
        fetch: async (url, options) => { seen = { url, options }; return { status: 200, text: async () => 'impit-ok' }; },
      }),
    });
    const out = await t.request({
      method: 'POST',
      url: 'https://airtable.com/z',
      headers: { Cookie: 'c=d' },
      body: 'k=v',
    });
    assert.deepEqual(out, { status: 200, body: 'impit-ok' });
    assert.equal(seen.options.headers.Cookie, 'c=d');
    assert.equal(seen.options.body, 'k=v');
    assert.equal(seen.options.method, 'POST');
  });

  it('maps an impit network throw to { status: 0, body: "", error }', async () => {
    const t = new HttpTransport({
      client: 'impit',
      impitFactory: async () => ({ fetch: async () => { throw new Error('tls fail'); } }),
    });
    const out = await t.request({ method: 'GET', url: 'u', headers: {} });
    assert.deepEqual(out, { status: 0, body: '', error: 'tls fail' });
  });

  it('throws a clear "install impit" error when impit is absent (or works when present)', async () => {
    // impit is an OPTIONAL dependency and is not installed in this workspace,
    // so the real dynamic import fails → the transport must surface a clear,
    // actionable error rather than a cryptic module-not-found. Guarded so the
    // test stays correct even if a developer later installs impit locally.
    let impitInstalled = true;
    try { await import('impit'); } catch { impitInstalled = false; }
    const t = new HttpTransport({ client: 'impit' });
    if (!impitInstalled) {
      await assert.rejects(
        () => t.request({ method: 'GET', url: 'https://airtable.com/', headers: {} }),
        /impit/i,
      );
    } else {
      // impit present → a bad host must surface the network-error shape, never
      // the install error.
      const out = await t.request({ method: 'GET', url: 'http://127.0.0.1:0/', headers: {} });
      assert.equal(out.status, 0);
    }
  });
});
