import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

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
