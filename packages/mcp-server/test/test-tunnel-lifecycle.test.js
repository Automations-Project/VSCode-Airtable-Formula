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
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/enable-tunnel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'unknown-provider' }),
    });
    assert.strictEqual(res.status, 500, 'Unknown provider should return 500');
  });

  it('POST /daemon/disable-tunnel requires bearer auth', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/disable-tunnel`, {
      method: 'POST',
    });
    assert.strictEqual(res.status, 401, 'No bearer should return 401');
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
  it('10 auth failures in 60s from tunnel request triggers daemon:tunnel-auto-disabled SSE event', async () => {
    // Set up SSE listener for the event
    const tunnelHeaders = {
      'X-Forwarded-For': '203.0.113.5',
      'X-Forwarded-Proto': 'https',
    };

    let autoDisabledEvent = null;
    const sseAbort = new AbortController();

    // Start SSE listener (needs bearer — loopback can still connect to events)
    const sseReq = fetch(`http://127.0.0.1:${server.port}/daemon/events`, {
      headers: { Authorization: `Bearer ${server.bearerToken}` },
      signal: sseAbort.signal,
    });
    const sseRes = await sseReq;
    // Read SSE events in background
    const eventPromise = new Promise((resolve) => {
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      const read = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes('daemon:tunnel-auto-disabled')) {
            const dataLine = text.split('\n').find(l => l.startsWith('data:'));
            if (dataLine) resolve(JSON.parse(dataLine.slice(5)));
          }
        }
      };
      read().catch(() => undefined);
    });

    // Send 10 requests with bad bearer token AND tunnel headers to trigger burst.
    // Must use /mcp (not /daemon/*) because the tunnel allowlist blocks tunnel-originated
    // requests from reaching /daemon/* endpoints before requireBearer is called.
    for (let i = 0; i < 10; i++) {
      await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: {
          ...tunnelHeaders,
          Authorization: 'Bearer bad-token-intentional',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    }

    // Wait for SSE event (max 3 seconds)
    const result = await Promise.race([
      eventPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for SSE event')), 3000)),
    ]);
    sseAbort.abort();

    assert.ok(result, 'SSE event payload should be non-null');
    assert.strictEqual(result.failures, 10, 'Should report 10 failures');
    assert.strictEqual(result.windowMs, 60_000, 'Should report 60s window');
    // ip is optional (may be null in test environment)
  });
});
