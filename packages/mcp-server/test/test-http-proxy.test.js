import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { HttpTransport } from '../src/http-transport.js';
import {
  proxyEnvVars,
  proxyConfigured,
  getProxyDispatcher,
  resetProxyDispatcher,
  describeFetchError,
} from '../src/proxy.js';

/**
 * Node's global fetch ignores HTTP_PROXY/HTTPS_PROXY. Since every Airtable API
 * call moved onto it, a user behind a mandatory corporate proxy saw every tool
 * call fail with a bare "fetch failed" that the auth layer reported as
 * SESSION_INVALID — while the browser login (which uses the OS proxy) still
 * succeeded. The transport now attaches undici's EnvHttpProxyAgent when the env
 * asks for a proxy, and surfaces the real cause when a request dies.
 */

describe('proxy env detection', () => {
  beforeEach(() => resetProxyDispatcher());

  it('reports no proxy when nothing is set', () => {
    assert.deepEqual(proxyEnvVars({}), []);
    assert.equal(proxyConfigured({}), false);
  });

  it('ignores empty / whitespace-only values', () => {
    assert.deepEqual(proxyEnvVars({ HTTPS_PROXY: '', http_proxy: '   ' }), []);
    assert.equal(proxyConfigured({ HTTPS_PROXY: '' }), false);
  });

  it('detects each supported variable', () => {
    assert.deepEqual(proxyEnvVars({ HTTPS_PROXY: 'http://p:8080' }), ['HTTPS_PROXY']);
    assert.deepEqual(proxyEnvVars({ http_proxy: 'http://p:8080' }), ['http_proxy']);
    assert.deepEqual(
      proxyEnvVars({ https_proxy: 'a', HTTPS_PROXY: 'b', HTTP_PROXY: 'c' }),
      ['https_proxy', 'HTTPS_PROXY', 'HTTP_PROXY'],
    );
  });

  it('does NOT claim ALL_PROXY support (undici does not implement it)', () => {
    assert.equal(proxyConfigured({ ALL_PROXY: 'socks5://p:1080' }), false);
  });

  it('returns no dispatcher when no proxy is configured', async () => {
    assert.equal(await getProxyDispatcher({ env: {} }), null);
  });

  it('builds the dispatcher once per env and rebuilds when the env changes', async () => {
    let built = 0;
    const factory = async () => ({ id: ++built });
    const env = { HTTPS_PROXY: 'http://p:8080' };
    const a = await getProxyDispatcher({ env, agentFactory: factory });
    const b = await getProxyDispatcher({ env, agentFactory: factory });
    assert.equal(a, b, 'memoized per env');
    assert.equal(built, 1);
    const c = await getProxyDispatcher({ env: { HTTPS_PROXY: 'http://other:3128' }, agentFactory: factory });
    assert.notEqual(a, c, 'a changed proxy env must not reuse the stale agent');
  });

  it('single-flights concurrent callers onto ONE agent (no orphaned socket pool)', async () => {
    let built = 0;
    const factory = async () => { await new Promise(r => setTimeout(r, 5)); return { id: ++built }; };
    const env = { HTTPS_PROXY: 'http://p:8080' };
    const [a, b, c] = await Promise.all([
      getProxyDispatcher({ env, agentFactory: factory }),
      getProxyDispatcher({ env, agentFactory: factory }),
      getProxyDispatcher({ env, agentFactory: factory }),
    ]);
    assert.equal(built, 1, 'concurrent callers must not each build an agent');
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it('falls back to direct (null) — never throws — when the agent cannot be created', async () => {
    const d = await getProxyDispatcher({
      env: { HTTPS_PROXY: 'http://p:8080' },
      agentFactory: async () => { throw new Error('undici missing'); },
    });
    assert.equal(d, null);
  });
});

describe('HttpTransport — proxy dispatcher selection', () => {
  beforeEach(() => resetProxyDispatcher());

  it('attaches the dispatcher to the fetch options when the env asks for a proxy', async () => {
    const agent = { marker: 'proxy-agent' };
    let seen;
    const t = new HttpTransport({
      env: { HTTPS_PROXY: 'http://proxy.corp:8080' },
      proxyAgentFactory: async () => agent,
      fetchImpl: async (_url, options) => { seen = options; return { status: 200, text: async () => 'OK' }; },
    });
    const out = await t.request({ method: 'GET', url: 'https://airtable.com/v0.3/x', headers: {} });
    assert.deepEqual(out, { status: 200, body: 'OK' });
    assert.equal(seen.dispatcher, agent);
  });

  it('attaches NOTHING when no proxy is configured (unchanged default behaviour)', async () => {
    let seen;
    const t = new HttpTransport({
      env: {},
      fetchImpl: async (_url, options) => { seen = options; return { status: 200, text: async () => 'OK' }; },
    });
    await t.request({ method: 'GET', url: 'https://airtable.com/v0.3/x', headers: {} });
    assert.equal('dispatcher' in seen, false);
  });
});

// End-to-end through a real CONNECT proxy: proves Node's built-in fetch honours
// an undici dispatcher from the npm copy, and that NO_PROXY is respected.
describe('HttpTransport — real proxy round-trip', () => {
  let target, proxy, targetPort, proxyPort;
  const connects = [];
  const savedEnv = {};

  before(async () => {
    target = http.createServer((req, res) => { res.writeHead(200); res.end('origin:' + req.url); });
    await new Promise(r => target.listen(0, '127.0.0.1', r));
    targetPort = target.address().port;

    proxy = http.createServer((_req, res) => { res.writeHead(400); res.end(); });
    proxy.on('connect', (req, clientSocket, head) => {
      connects.push(req.url);
      const [host, port] = req.url.split(':');
      const upstream = net.connect(Number(port), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
    });
    await new Promise(r => proxy.listen(0, '127.0.0.1', r));
    proxyPort = proxy.address().port;

    for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    resetProxyDispatcher();
    await new Promise(r => proxy.close(r));
    await new Promise(r => target.close(r));
  });

  const undiciAvailable = async () => {
    try { const m = await import('undici'); return !!(m.EnvHttpProxyAgent || m.default?.EnvHttpProxyAgent); }
    catch { return false; }
  };

  it('routes the request through HTTP_PROXY', async (t) => {
    if (!await undiciAvailable()) return t.skip('undici (optional dependency) not installed');
    connects.length = 0;
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
    delete process.env.NO_PROXY;
    resetProxyDispatcher();

    const out = await new HttpTransport().request({
      method: 'GET', url: `http://127.0.0.1:${targetPort}/v0.3/x`, headers: {},
    });
    assert.equal(out.status, 200);
    assert.equal(out.body, 'origin:/v0.3/x');
    assert.deepEqual(connects, [`127.0.0.1:${targetPort}`], 'the proxy must have tunnelled the request');
  });

  it('honours NO_PROXY (goes direct, proxy sees nothing)', async (t) => {
    if (!await undiciAvailable()) return t.skip('undici (optional dependency) not installed');
    connects.length = 0;
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
    process.env.NO_PROXY = '127.0.0.1';
    resetProxyDispatcher();

    const out = await new HttpTransport().request({
      method: 'GET', url: `http://127.0.0.1:${targetPort}/v0.3/y`, headers: {},
    });
    assert.equal(out.status, 200);
    assert.equal(out.body, 'origin:/v0.3/y');
    assert.deepEqual(connects, [], 'NO_PROXY host must bypass the proxy');
  });
});

describe('describeFetchError — a failed call must say WHY', () => {
  it('keeps a plain message unchanged (no cause to unwrap)', () => {
    assert.equal(describeFetchError(new Error('ECONNREFUSED'), { env: { HTTPS_PROXY: 'x' } }), 'ECONNREFUSED');
  });

  it('unwraps undici\'s "fetch failed" cause chain', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    const msg = describeFetchError(err, { env: {} });
    assert.match(msg, /fetch failed/);
    assert.match(msg, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
    assert.match(msg, /NODE_EXTRA_CA_CERTS/, 'a TLS-interception failure must point at the CA fix');
  });

  it('suggests HTTPS_PROXY when the network is unreachable and no proxy is set', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    assert.match(describeFetchError(err, { env: {} }), /HTTPS_PROXY/);
  });

  it('does NOT suggest a proxy when one is already configured', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const msg = describeFetchError(err, { env: { HTTPS_PROXY: 'http://p:8080' } });
    assert.match(msg, /ECONNREFUSED/);
    assert.doesNotMatch(msg, /set HTTPS_PROXY/);
  });
});
