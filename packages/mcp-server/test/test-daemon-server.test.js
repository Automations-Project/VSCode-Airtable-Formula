import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';
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
  });

  it('returns 401 when Authorization header is missing', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/health`);
    assert.strictEqual(response.status, 401);
    const body = await response.json();
    assert.strictEqual(body.error, 'Unauthorized');
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
