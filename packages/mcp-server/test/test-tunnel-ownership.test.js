/**
 * Single-owner tunnel handle.
 *
 * Before the fix there were TWO `activeTunnel` closures — one in server.js
 * (filled by POST /daemon/enable-tunnel) and one in launcher.js (filled by the
 * boot auto-start). Neither could see the other, so each of the three paths
 * that stop a tunnel reached only half the cases:
 *
 *   - POST /daemon/disable-tunnel was a silent no-op on a boot-started tunnel:
 *     it skipped stop(), nulled the lockfile tunnelUrl and returned {ok:true}
 *     while cloudflared kept serving the public hostname.
 *   - The 401-burst tripwire delegated to the launcher's callback, which could
 *     only stop boot-started tunnels — a dashboard-enabled tunnel survived it
 *     while the UI displayed "Auto-disabled".
 *   - enable-tunnel's stop-the-existing guard was equally blind and orphaned a
 *     second cloudflared child.
 *
 * server.adoptTunnel() gives the server the single handle; these tests pin that
 * an adopted handle is actually stopped by both revocation paths.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

const BURST_FAILURE_COUNT = 10;
const TUNNEL_HEADERS = { 'X-Forwarded-For': '203.0.113.5', 'X-Forwarded-Proto': 'https' };

/** Stand-in for a provider handle, shaped like tunnel.js's return value. */
function fakeTunnel() {
  const handle = {
    stopped: 0,
    url: 'https://example-boot-started.trycloudflare.com',
    stop: async () => { handle.stopped++; handle.url = null; },
    getState: () => ({ status: handle.stopped ? 'disabled' : 'enabled', url: handle.url }),
    waitUntilReady: Promise.resolve('https://example-boot-started.trycloudflare.com'),
  };
  return handle;
}

let tmpDir;
let server;
let autoDisableCalls;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `test-airtable-tunnel-own-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  autoDisableCalls = [];
  server = await startDaemonServer({
    port: 0,
    configDir: tmpDir,
    onTunnelAutoDisable: (info) => { autoDisableCalls.push(info); },
  });
});

afterEach(async () => {
  if (server) { await server.stop().catch(() => {}); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('tunnel ownership', () => {
  it('exposes adoptTunnel so a boot-started tunnel gets a single owner', () => {
    assert.strictEqual(typeof server.adoptTunnel, 'function');
    const t = fakeTunnel();
    server.adoptTunnel(t);
    assert.strictEqual(server.getActiveTunnel(), t, 'adopted handle must be the server-owned one');
  });

  it('POST /daemon/disable-tunnel STOPS an adopted (boot-started) tunnel', async () => {
    const t = fakeTunnel();
    server.adoptTunnel(t);

    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/disable-tunnel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.bearerToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(t.stopped, 1, 'disable-tunnel must actually stop the adopted tunnel');
    assert.strictEqual(server.getActiveTunnel(), null, 'handle must be cleared after stop');
  });

  it('the 401-burst tripwire stops the tunnel itself, not only via the callback', async () => {
    const t = fakeTunnel();
    server.adoptTunnel(t);

    for (let i = 0; i < BURST_FAILURE_COUNT; i++) {
      await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { ...TUNNEL_HEADERS, Authorization: 'Bearer wrong-token' },
      }).catch(() => undefined);
    }

    // stop() is fired without await inside the sync tracker — let it settle.
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(autoDisableCalls.length >= 1, 'auto-disable callback should still fire for bookkeeping');
    assert.strictEqual(t.stopped, 1, 'the tripwire must stop the tunnel it owns');
    assert.strictEqual(server.getActiveTunnel(), null, 'handle must be cleared after auto-disable');
  });

  it('a tunnel that was never adopted leaves disable-tunnel a safe no-op', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/daemon/disable-tunnel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(server.getActiveTunnel(), null);
  });
});
