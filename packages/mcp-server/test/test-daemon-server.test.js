import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';
import { rotateToken } from '../src/daemon/token.js';
import { getInjectedCredentials, clearInjectedCredentials } from '../src/daemon/cred-store.js';

let tmpDir;
let server;

before(async () => {
  tmpDir = join(tmpdir(), 'test-airtable-daemon-server-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir });
});

after(async () => {
  if (server) {
    await server.stop().catch(() => {});
    server = null;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startDaemonServer', () => {
  it('startDaemonServer is a function', () => {
    assert.strictEqual(typeof startDaemonServer, 'function');
  });

  it('binds on a port and returns object with .bearerToken getter and .stop()', () => {
    assert.ok(server, 'server should be defined');
    assert.ok(typeof server.port === 'number' && server.port > 0, `expected port > 0, got ${server.port}`);
    assert.ok(typeof server.bearerToken === 'string' && server.bearerToken.length > 0, 'bearerToken should be non-empty string');
    assert.strictEqual(typeof server.stop, 'function');
  });
});

describe('GET /daemon/health', () => {
  it('returns 200 with uptime JSON when correct bearer token provided', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/health`, {
      headers: { 'Authorization': `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.pid, process.pid);
    assert.ok(typeof body.uptimeMs === 'number', 'uptimeMs should be a number');
    // Phase 3: pageBusy snapshot is always present (idle when no auth yet).
    assert.ok(body.pageBusy && typeof body.pageBusy === 'object');
    assert.equal(typeof body.pageBusy.busy, 'boolean');
    assert.equal(typeof body.pageBusy.queued, 'number');
  });

  it('pageBusy reflects shared auth scheduler when options.auth is provided', async () => {
    const { AirtableAuth } = await import('../src/auth.js');
    const { PageScheduler } = await import('../src/page-scheduler.js');
    const tmpShared = join(tmpdir(), 'test-airtable-shared-auth-' + process.pid + '-' + Date.now());
    mkdirSync(tmpShared, { recursive: true });
    const scheduler = new PageScheduler({ maxQueue: 8 });
    const sharedAuth = new AirtableAuth({
      profileDir: join(tmpShared, 'profile'),
      idleParkMs: 0,
      scheduler,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });
    const s = await startDaemonServer({
      port: 0,
      configDir: tmpShared,
      auth: sharedAuth,
    });
    try {
      // Hold exclusive work so health can observe active tool label.
      let release;
      const gate = new Promise((r) => { release = r; });
      const work = sharedAuth._enqueue(async () => {
        await gate;
        return 'ok';
      }, 'held');
      // Ambient tool context would set real names; fallback label is fine for this test.
      await new Promise((r) => setTimeout(r, 20));
      const response = await fetch(`http://127.0.0.1:${s.port}/daemon/health`, {
        headers: { Authorization: `Bearer ${s.bearerToken}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.pageBusy.busy, true);
      assert.ok(body.pageBusy.active, 'expected active exclusive op on shared auth');
      assert.equal(body.pageBusy.active.tool, 'held');
      release();
      await work;
    } finally {
      await s.stop().catch(() => {});
      rmSync(tmpShared, { recursive: true, force: true });
    }
  });

  it('returns 401 when Authorization header is missing', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/health`);
    assert.strictEqual(response.status, 401);
    const body = await response.json();
    assert.strictEqual(body.error, 'Unauthorized');
  });

  it('accepts the token as ?token= query param (claude.ai secret-URL path)', async () => {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/daemon/health?token=${encodeURIComponent(server.bearerToken)}`
    );
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
    // Secret rode the URL — response must be uncacheable and never leak via Referer.
    assert.strictEqual(response.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(response.headers.get('cache-control'), 'no-store');
  });

  it('returns 401 when ?token= is wrong', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/health?token=wrong-token`);
    assert.strictEqual(response.status, 401);
  });
});

describe('GET /daemon/session-health', () => {
  let s2;
  let tmp2;

  before(async () => {
    tmp2 = join(tmpdir(), 'test-airtable-session-health-' + process.pid);
    mkdirSync(tmp2, { recursive: true });
    // Inject the session check so the endpoint never launches a real browser.
    s2 = await startDaemonServer({
      port: 0,
      configDir: tmp2,
      getSessionHealth: async () => ({ valid: true, userId: 'usr123' }),
    });
  });

  after(async () => {
    if (s2) await s2.stop().catch(() => {});
    rmSync(tmp2, { recursive: true, force: true });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const response = await fetch(`http://127.0.0.1:${s2.port}/daemon/session-health`);
    assert.strictEqual(response.status, 401);
  });

  it('reuses the shared browser and returns the injected session health', async () => {
    const response = await fetch(`http://127.0.0.1:${s2.port}/daemon/session-health`, {
      headers: { 'Authorization': `Bearer ${s2.bearerToken}` },
    });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.valid, true);
    assert.strictEqual(body.userId, 'usr123');
  });
});

describe('POST /daemon/release-browser', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/release-browser`, { method: 'POST' });
    assert.strictEqual(response.status, 401);
  });

  it('returns ok:true with a valid bearer token (idempotent when no browser is open)', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/release-browser`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
  });
});

describe('POST /daemon/auth-credentials', () => {
  const url = () => `http://127.0.0.1:${server.port}/daemon/auth-credentials`;
  const authed = (body) => ({
    method: 'POST',
    headers: { 'Authorization': `Bearer ${server.bearerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  after(() => clearInjectedCredentials());

  it('returns 401 when Authorization header is missing (and does not touch the store)', async () => {
    clearInjectedCredentials();
    const response = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authMode: 'byo', cookie: 'brw=should-not-store' }),
    });
    assert.strictEqual(response.status, 401);
    assert.equal(getInjectedCredentials(), null); // unauthorized request never stored creds
  });

  it('stores byo creds in memory and returns ok:true with a valid token', async () => {
    clearInjectedCredentials();
    const response = await fetch(url(), authed({ authMode: 'byo', cookie: 'brw=1; sess=abc', csrf: 'CSRF-99' }));
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
    // setInjectedCredentials was called with the pushed creds.
    const stored = getInjectedCredentials();
    assert.equal(stored.authMode, 'byo');
    assert.equal(stored.cookie, 'brw=1; sess=abc');
    assert.equal(stored.csrf, 'CSRF-99');
  });

  it('stores direct-login creds (email/password/totpSecret) in memory', async () => {
    clearInjectedCredentials();
    const response = await fetch(url(), authed({
      authMode: 'direct-login', email: 'u@x.com', password: 'p', totpSecret: 'JBSWY3DPEHPK3PXP',
    }));
    assert.strictEqual(response.status, 200);
    const stored = getInjectedCredentials();
    assert.equal(stored.authMode, 'direct-login');
    assert.equal(stored.email, 'u@x.com');
    assert.equal(stored.password, 'p');
    assert.equal(stored.totpSecret, 'JBSWY3DPEHPK3PXP');
  });

  it('rejects an invalid authMode with 400 (store unchanged)', async () => {
    clearInjectedCredentials();
    const response = await fetch(url(), authed({ authMode: 'browser', cookie: 'brw=x' }));
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.ok, false);
    assert.equal(getInjectedCredentials(), null); // invalid request never stored creds
  });

  it('rejects a non-string secret field with 400', async () => {
    clearInjectedCredentials();
    const response = await fetch(url(), authed({ authMode: 'byo', cookie: 12345 }));
    assert.strictEqual(response.status, 400);
    assert.equal(getInjectedCredentials(), null);
  });
});

describe('module-level rotateToken against a live server', () => {
  let s3;
  let tmp3;

  before(async () => {
    tmp3 = join(tmpdir(), 'test-airtable-token-adopt-' + process.pid);
    mkdirSync(tmp3, { recursive: true });
    s3 = await startDaemonServer({ port: 0, configDir: tmp3 });
  });

  after(async () => {
    if (s3) await s3.stop().catch(() => {});
    rmSync(tmp3, { recursive: true, force: true });
  });

  it('adopts a rotation performed through the module function, not the route', async () => {
    const before = s3.bearerToken;
    const rotated = rotateToken({ tokenPath: s3.tokenPath });
    assert.notStrictEqual(rotated.bearerToken, before, 'rotation should mint a new bearer');

    // Before the fix the server kept authenticating against `before`, so the caller
    // that just rotated could never talk to the daemon again — and getDaemonStatus,
    // whose heal path only retries with the on-disk token it already matched, was
    // stuck reporting {running:true, healthy:false} for the life of the process.
    assert.strictEqual(s3.bearerToken, rotated.bearerToken);
    const response = await fetch(`http://127.0.0.1:${s3.port}/daemon/health`, {
      headers: { Authorization: `Bearer ${rotated.bearerToken}` },
    });
    assert.strictEqual(response.status, 200);
  });

  it('stops honouring the pre-rotation bearer', async () => {
    const stale = s3.bearerToken;
    const rotated = rotateToken({ tokenPath: s3.tokenPath });
    assert.notStrictEqual(rotated.bearerToken, stale);
    const response = await fetch(`http://127.0.0.1:${s3.port}/daemon/health`, {
      headers: { Authorization: `Bearer ${stale}` },
    });
    assert.strictEqual(response.status, 401);
  });

  it('ignores a rotation of some other config dir\'s token file', async () => {
    const mine = s3.bearerToken;
    rotateToken({ tokenPath: join(tmp3, 'someone-elses.token') });
    assert.strictEqual(s3.bearerToken, mine);
  });

  it('unsubscribes on stop — a stopped server never adopts', async () => {
    const tmp4 = join(tmpdir(), 'test-airtable-token-unsub-' + process.pid);
    mkdirSync(tmp4, { recursive: true });
    const s4 = await startDaemonServer({ port: 0, configDir: tmp4 });
    const atStop = s4.bearerToken;
    await s4.stop();
    rotateToken({ tokenPath: s4.tokenPath });
    assert.strictEqual(s4.bearerToken, atStop);
    rmSync(tmp4, { recursive: true, force: true });
  });
});

describe('GET /daemon/events', () => {
  it('returns 401 when bearer token is wrong', async () => {
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/events`, {
      headers: { 'Authorization': 'Bearer wrong-token' },
      signal: controller.signal,
    }).catch((err) => {
      if (err.name === 'AbortError') return null;
      throw err;
    });
    if (response) {
      assert.strictEqual(response.status, 401);
    }
  });
});
