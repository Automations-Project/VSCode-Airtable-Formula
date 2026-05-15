import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

// Wave 0 stub — test bodies filled in after server.js allowlist middleware lands (Plan 05)

let tmpDir;
let server;

before(async () => {
  tmpDir = join(tmpdir(), 'test-airtable-allowlist-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir });
});

after(async () => {
  if (server) { await server.stop().catch(() => {}); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

const TUNNEL_HEADERS = {
  'X-Forwarded-For': '203.0.113.5, 127.0.0.1',
  'X-Forwarded-Proto': 'https',
};

const DAEMON_PATHS = [
  { method: 'GET',  path: '/daemon/health' },
  { method: 'GET',  path: '/daemon/events' },
  { method: 'POST', path: '/daemon/heartbeat' },
  { method: 'POST', path: '/daemon/rotate-token' },
  // NOTE: /daemon/shutdown is intentionally excluded from the loop — it stops the server,
  // which would break all subsequent tests in this file. It is covered separately in the
  // daemon-server test suite. The allowlist contract for shutdown is the same as others.
  { method: 'POST', path: '/daemon/enable-tunnel' },
  { method: 'POST', path: '/daemon/disable-tunnel' },
];

describe('tunnel allowlist', () => {
  for (const { method, path } of DAEMON_PATHS) {
    it(`tunnel ${method} ${path} returns 404`, async () => {
      // Stub: will pass after allowlist middleware is added in Plan 05
      // Until then, this test is expected to fail (RED) — that is correct Wave 0 behaviour.
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        method,
        headers: { ...TUNNEL_HEADERS, Authorization: `Bearer ${server.bearerToken}` },
      });
      // Stub assertion — will be 404 after allowlist middleware exists
      assert.strictEqual(res.status, 404, `Expected 404 from tunnel on ${method} ${path}`);
    });
  }

  it('loopback request reaches /daemon/health normally', async () => {
    // No tunnel headers → should pass through allowlist → 200
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/health`, {
      headers: { Authorization: `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(res.status, 200);
  });

  it('tunnel request on /mcp is not blocked', async () => {
    // /mcp is explicitly allowed for tunnel requests
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        ...TUNNEL_HEADERS,
        Authorization: `Bearer ${server.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    // Not 404 — allowlist passes /mcp through
    assert.notStrictEqual(res.status, 404, 'Tunnel /mcp must not be blocked');
  });
});
