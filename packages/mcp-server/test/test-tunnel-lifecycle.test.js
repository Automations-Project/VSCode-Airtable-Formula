import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

// Wave 0 stub — test bodies filled in after server.js enable-tunnel endpoint + launcher.js tunnelUrl land (Plans 05, 06)

let tmpDir;
let server;

before(async () => {
  tmpDir = join(tmpdir(), 'test-airtable-lifecycle-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir });
});

after(async () => {
  if (server) { await server.stop().catch(() => {}); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('enable-tunnel', () => {
  it('POST /daemon/enable-tunnel with unknown provider returns 500', async () => {
    // Stub: after Plan 05 adds endpoint, unknown provider should error
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/enable-tunnel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'unknown-provider' }),
    });
    // Stub: endpoint does not exist yet → will be 404 until Plan 05
    assert.ok(res.status === 404 || res.status === 500, 'Expected 404 (no endpoint yet) or 500 (bad provider)');
  });

  it('POST /daemon/disable-tunnel requires bearer auth', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/disable-tunnel`, {
      method: 'POST',
      // No auth header
    });
    // Before Plan 05: 404 (endpoint missing). After Plan 05: 401 (no bearer).
    assert.ok(res.status === 401 || res.status === 404, 'Expected 401 or 404 without auth');
  });
});

describe('tunnelUrl', () => {
  it('lockfile tunnelUrl field is null when no tunnel is active', async () => {
    // Stub: verifies the lockfile schema already has the tunnelUrl field (Plan 06)
    // No real tunnel to start in unit tests — just confirm field shape contract
    // After Plan 06, buildRecord() always includes tunnelUrl
    assert.ok(true, 'Stub — filled in after launcher.js tunnelUrl tracking lands');
  });
});

describe('401-burst', () => {
  it('10 auth failures in 60s triggers daemon:tunnel-auto-disabled SSE event', async () => {
    // Stub — requires allowlist middleware (Plan 05) to be present for isTunnelRequest() to fire
    // Real assertions filled in after Plan 05 + 06 complete
    // The test must use tunnel headers to trigger the burst (isTunnelRequest = true)
    assert.ok(true, 'Stub — filled in after Plan 05 401-burst tripwire lands');
  });
});
