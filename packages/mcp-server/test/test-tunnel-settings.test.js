import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

import { readTunnelSettings, writeTunnelSettings, getTunnelProvider } from '../src/daemon/tunnel-providers/index.js';

let tmpDir;

before(() => {
  tmpDir = join(tmpdir(), 'test-airtable-settings-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('tunnel settings', () => {
  it('readTunnelSettings returns defaults when file is missing', async () => {
    const missingDir = join(tmpDir, 'missing-' + Math.random().toString(36).slice(2));
    const result = readTunnelSettings(missingDir);
    assert.deepEqual(result.enabled, false);
    assert.equal(result.provider, 'cf-quick');
    assert.equal(result.ngrokDomain, null);
  });

  it('writeTunnelSettings persists enabled + provider + ngrokDomain atomically', async () => {
    const dir = join(tmpDir, 'write-test-' + Math.random().toString(36).slice(2));
    writeTunnelSettings(dir, { enabled: true, provider: 'ngrok', ngrokDomain: 'foo.ngrok-free.app' });
    const result = readTunnelSettings(dir);
    assert.equal(result.enabled, true);
    assert.equal(result.provider, 'ngrok');
    assert.equal(result.ngrokDomain, 'foo.ngrok-free.app');
  });

  it('writeTunnelSettings rejects unknown provider (falls back to prev provider)', async () => {
    const dir = join(tmpDir, 'unknown-provider-' + Math.random().toString(36).slice(2));
    // Write initial valid settings first
    writeTunnelSettings(dir, { provider: 'cf-quick' });
    // Then patch with unknown provider — should keep 'cf-quick'
    writeTunnelSettings(dir, { provider: 'unknown' });
    const result = readTunnelSettings(dir);
    assert.equal(result.provider, 'cf-quick');
  });
});

describe('provider registry', () => {
  it('getTunnelProvider("cf-quick") returns cloudflaredQuickProvider', async () => {
    const provider = getTunnelProvider('cf-quick');
    assert.equal(provider.id, 'cf-quick');
  });

  it('getTunnelProvider("ngrok") returns ngrokProvider', async () => {
    const provider = getTunnelProvider('ngrok');
    assert.equal(provider.id, 'ngrok');
  });

  it('getTunnelProvider("cf-named") returns cloudflaredNamedProvider', async () => {
    const provider = getTunnelProvider('cf-named');
    assert.equal(provider.id, 'cf-named');
  });

  it('getTunnelProvider with unknown id throws Error', async () => {
    assert.throws(
      () => getTunnelProvider('bad'),
      { message: 'Unknown tunnel provider: bad' },
    );
  });
});
