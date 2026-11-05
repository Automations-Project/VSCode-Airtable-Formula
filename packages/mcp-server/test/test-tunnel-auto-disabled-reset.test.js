/**
 * The 401-burst tripwire persists `autoDisabled:true` + a reason. Before this
 * fix nothing ever cleared it: enable-tunnel and disable-tunnel patched only
 * `enabled`, and writeTunnelSettings carries unpatched fields forward, so the
 * dashboard reported "auto-disabled" whenever the tunnel was off — even after
 * the user re-enabled it and later turned it off normally.
 *
 * A user's explicit enable or disable is a fresh decision, so both clear the
 * flag and its reason.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';
import { getTunnelProvider, readTunnelSettings, writeTunnelSettings } from '../src/daemon/tunnel-providers/index.js';

const AUTO_DISABLED = { enabled: false, autoDisabled: true, autoDisabledReason: { failures: 10, ip: '203.0.113.5' } };

let tmpDir;
let server;
let restoreProvider;

/** Make cf-quick start without a cloudflared binary: a fake, already-ready handle. */
function stubQuickProvider() {
  const provider = getTunnelProvider('cf-quick');
  const original = { isSetupComplete: provider.isSetupComplete, start: provider.start };
  provider.isSetupComplete = async () => ({ ready: true });
  provider.start = async () => ({
    url: 'https://example-reset.trycloudflare.com',
    stop: async () => undefined,
    getState: () => ({ status: 'enabled', url: 'https://example-reset.trycloudflare.com' }),
    waitUntilReady: Promise.resolve('https://example-reset.trycloudflare.com'),
  });
  return () => Object.assign(provider, original);
}

async function post(path, body) {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.bearerToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  tmpDir = join(tmpdir(), `test-airtable-tunnel-reset-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir });
  restoreProvider = stubQuickProvider();
});

afterEach(async () => {
  restoreProvider?.();
  if (server) { await server.stop().catch(() => {}); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('autoDisabled is cleared by an explicit user decision', () => {
  it('POST /daemon/enable-tunnel clears autoDisabled and its reason', async () => {
    writeTunnelSettings(tmpDir, AUTO_DISABLED);

    const res = await post('/daemon/enable-tunnel', { provider: 'cf-quick' });

    assert.strictEqual(res.status, 200);
    const settings = readTunnelSettings(tmpDir);
    assert.strictEqual(settings.enabled, true);
    assert.strictEqual(settings.autoDisabled, false);
    assert.strictEqual(settings.autoDisabledReason, null);
  });

  it('POST /daemon/disable-tunnel clears autoDisabled and its reason', async () => {
    writeTunnelSettings(tmpDir, AUTO_DISABLED);

    const res = await post('/daemon/disable-tunnel');

    assert.strictEqual(res.status, 200);
    const settings = readTunnelSettings(tmpDir);
    assert.strictEqual(settings.enabled, false);
    assert.strictEqual(settings.autoDisabled, false);
    assert.strictEqual(settings.autoDisabledReason, null);
  });

  it('re-enable then a normal disable leaves the tunnel plainly off, not auto-disabled', async () => {
    writeTunnelSettings(tmpDir, AUTO_DISABLED);

    assert.strictEqual((await post('/daemon/enable-tunnel', { provider: 'cf-quick' })).status, 200);
    assert.strictEqual((await post('/daemon/disable-tunnel')).status, 200);

    const settings = readTunnelSettings(tmpDir);
    assert.strictEqual(settings.enabled, false);
    assert.strictEqual(settings.autoDisabled, false);
    assert.strictEqual(settings.autoDisabledReason, null);
  });
});
