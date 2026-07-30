/**
 * Direct-HTTP transport for Airtable API calls (Phase 1 of the transport rework).
 *
 * Every Airtable API call used to run as a `fetch()` INSIDE the Chrome page via
 * page.evaluate(); the browser was both the auth store (cookies + scraped CSRF)
 * AND the transport. A live spike fired the same request three ways — in-page
 * fetch, impit (Chrome TLS impersonation), and plain node fetch — and all three
 * returned byte-identical 200s. There is no TLS-fingerprint barrier, so we
 * demote the browser to login / credential-capture only and route API traffic
 * through this transport.
 *
 * The return shape mirrors the old in-page fetch EXACTLY so that
 * auth._wrapResponse and the _apiCall backoff/recovery loop stay untouched:
 *   success        → { status, body }
 *   thrown network → { status: 0, body: '', error }
 *
 * Clients:
 *   - 'fetch' (default): global fetch. No impersonation needed (spike-proven).
 *   - 'impit'          : opt-in Chrome TLS impersonation, behind
 *                        AIRTABLE_HTTP_CLIENT=impit. impit is an OPTIONAL
 *                        dependency, lazy-loaded like patchright/otpauth; if it
 *                        is not installed we throw a clear, actionable error.
 *
 * Proxies: Node's fetch ignores HTTP_PROXY/HTTPS_PROXY, so the fetch client
 * attaches undici's EnvHttpProxyAgent when those are set (see src/proxy.js).
 * The impit client does NOT — impit takes an explicit `proxyUrl` and defaults
 * to no proxy, and it has no NO_PROXY support to honour — so behind a proxy use
 * the default fetch client (documented as a known limitation in CHANGELOG.md).
 */

import { getProxyDispatcher, describeFetchError } from './proxy.js';

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
      'AIRTABLE_HTTP_CLIENT=impit requires the optional `impit` package, which is not installed. ' +
      'Install it (`npm i impit`) or use the default fetch client ' +
      '(unset AIRTABLE_HTTP_CLIENT or set it to "fetch").\n' +
      `Original error: ${err.message}`
    );
  }
}

export class HttpTransport {
  /**
   * @param {object} [opts]
   * @param {'fetch'|'impit'} [opts.client='fetch'] transport backend
   * @param {Function}        [opts.fetchImpl]      test seam — overrides global fetch
   * @param {Function}        [opts.impitFactory]   test seam — async () => ({ fetch })
   * @param {object}          [opts.env]            test seam — env read for proxy config
   * @param {Function}        [opts.proxyAgentFactory] test seam — async () => dispatcher
   */
  constructor({ client = 'fetch', fetchImpl, impitFactory, env, proxyAgentFactory } = {}) {
    // Only 'impit' opts into the fallback; anything else (undefined, '', a typo)
    // falls back to plain fetch.
    this.client = client === 'impit' ? 'impit' : 'fetch';
    this._fetchImpl = fetchImpl || null;
    this._impitFactory = impitFactory || null;
    this._env = env || null;
    this._proxyAgentFactory = proxyAgentFactory || null;
  }

  /** Proxy dispatcher for this call, or null when no proxy is configured. */
  async _dispatcher() {
    return getProxyDispatcher({
      ...(this._env ? { env: this._env } : {}),
      ...(this._proxyAgentFactory ? { agentFactory: this._proxyAgentFactory } : {}),
    });
  }

  /**
   * @param {{ method: string, url: string, headers: object, body?: string|null }} req
   * @returns {Promise<{ status: number, body: string, error?: string }>}
   */
  async request(req) {
    return this.client === 'impit' ? this._impitRequest(req) : this._fetchRequest(req);
  }

  async _fetchRequest({ method, url, headers, body }) {
    const fetchFn = this._fetchImpl || globalThis.fetch;
    const options = { method, headers };
    if (body !== null && body !== undefined && method !== 'GET') {
      options.body = body;
    }
    // Node's built-in fetch accepts an undici dispatcher and shares the same
    // dispatcher contract as the npm copy (verified against a CONNECT proxy).
    const dispatcher = await this._dispatcher();
    if (dispatcher) options.dispatcher = dispatcher;
    try {
      const res = await fetchFn(url, options);
      return { status: res.status, body: await res.text() };
    } catch (e) {
      // "fetch failed" alone is undiagnosable: the real reason (certificate
      // rejected, proxy unreachable, DNS) lives in e.cause.
      return { status: 0, body: '', error: describeFetchError(e, this._env ? { env: this._env } : {}) };
    }
  }

  async _impitRequest({ method, url, headers, body }) {
    // A failed import propagates as a thrown error (not a { status: 0 } result):
    // an uninstalled optional dependency is a config problem the caller must fix,
    // not a transient network failure to retry.
    let impit;
    if (this._impitFactory) {
      impit = await this._impitFactory();
    } else {
      const Impit = await loadImpit();
      impit = new Impit({ browser: 'chrome' });
    }
    const options = { method, headers };
    if (body !== null && body !== undefined && method !== 'GET') {
      options.body = body;
    }
    try {
      const res = await impit.fetch(url, options);
      return { status: res.status, body: await res.text() };
    } catch (e) {
      return { status: 0, body: '', error: e.message };
    }
  }
}
