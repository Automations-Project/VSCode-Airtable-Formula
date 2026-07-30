import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnNamedTunnel } from '../src/daemon/tunnel-providers/cloudflared-named.js';
import {
  writeTunnelConfig,
  readNamedTunnelConfig,
} from '../src/daemon/tunnel-providers/cloudflared-named-setup.js';

/**
 * Build a fake cloudflared child process: an EventEmitter with PassThrough
 * stdout/stderr so the provider's readline interfaces fire 'line' events when
 * we write to them.
 */
function makeFakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

/**
 * Cleanly tear down a started tunnel for a fake child. The provider's stop()
 * does `await exited`, which only resolves on the child's 'exit' event — so
 * drive the exit ourselves (a real process would exit on kill), then await
 * stop(). Cross-platform: on win32 stop() taskkills (no-op for the fake pid)
 * then awaits exited too, so the explicit exit is what unblocks it.
 */
async function shutdown(tunnel, child) {
  if (child.exitCode === null) child.exitCode = 0;
  const stopped = tunnel.stop();
  child.emit('exit', 0, 'SIGTERM');
  await stopped;
}

/** Let readline flush the buffered line(s) into 'line' events. */
const flush = () => new Promise((r) => setTimeout(r, 15));

describe('spawnNamedTunnel readiness', () => {
  it('A: waits for the full HA connection count before reporting ready', async () => {
    const child = makeFakeChild();
    const tunnel = spawnNamedTunnel({
      binaryPath: 'cf',
      configPath: 'cfg',
      hostname: 'h.example.com',
      onStateChange: () => {},
      spawnImpl: () => child,
      targetConnections: 4,
      settleGraceMs: 10_000,
    });

    let url = null;
    tunnel.waitUntilReady.then((u) => {
      url = u;
    });

    // One connection — NOT ready (long settleGraceMs keeps the timer pending).
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=0 ...\n');
    await flush();
    assert.equal(url, null, 'should not be ready after a single connection');

    // Remaining three connections register → hits target → ready.
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=1 ...\n');
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=2 ...\n');
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=3 ...\n');
    await flush();

    assert.equal(await tunnel.waitUntilReady, 'https://h.example.com');
    assert.equal(url, 'https://h.example.com');

    // With all 4 registered the settle timer is already cleared; stop() also
    // clears it. Avoid dangling timers.
    await shutdown(tunnel, child);
  });

  it('B: falls back to the settle grace when fewer than target connections register', async () => {
    const child = makeFakeChild();
    const tunnel = spawnNamedTunnel({
      binaryPath: 'cf',
      configPath: 'cfg',
      hostname: 'h.example.com',
      onStateChange: () => {},
      spawnImpl: () => child,
      targetConnections: 4,
      settleGraceMs: 30,
    });

    // Only one of four connections — resolves via the ~30ms grace timer.
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=0 ...\n');

    assert.equal(await tunnel.waitUntilReady, 'https://h.example.com');

    await shutdown(tunnel, child);
  });

  it('C: clears the settle timer if the child exits before settling', async () => {
    const child = makeFakeChild();
    const tunnel = spawnNamedTunnel({
      binaryPath: 'cf',
      configPath: 'cfg',
      hostname: 'h.example.com',
      onStateChange: () => {},
      spawnImpl: () => child,
      targetConnections: 4,
      settleGraceMs: 10_000,
    });

    // One connection arms the (long) settle timer.
    child.stderr.write('2026-06-20 INF Registered tunnel connection connIndex=0 ...\n');
    await flush();

    // Exit before the grace fires — must reject (and clear the timer so no
    // stale markReady resolves later).
    child.emit('exit', 1, null);

    await assert.rejects(tunnel.waitUntilReady);
  });
});

describe('named tunnel config protocol', () => {
  it('D: serializes protocol: http2 and the config still round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-named-protocol-'));
    try {
      writeTunnelConfig({
        configDir: dir,
        uuid: 'uuid-1',
        hostname: 'h.example.com',
        port: 8723,
        credentialsPath: join(dir, 'creds.json'),
      });

      const raw = readFileSync(join(dir, 'cloudflared-named.yml'), 'utf8');
      assert.match(raw, /^protocol: http2$/m);

      const cfg = readNamedTunnelConfig(dir);
      assert.equal(cfg.port, 8723);
      assert.equal(cfg.hostname, 'h.example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
