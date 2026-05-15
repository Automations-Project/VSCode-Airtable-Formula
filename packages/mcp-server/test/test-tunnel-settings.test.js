import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';

// Wave 0 stub — test bodies filled in after tunnel-providers/index.js lands (Plan 04)
// readTunnelSettings / writeTunnelSettings / getTunnelProvider are exported from Plan 04

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
    // Stub — after Plan 04 ships readTunnelSettings
    // Expected: { enabled: false, provider: 'cf-quick', ngrokDomain: null }
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });

  it('writeTunnelSettings persists enabled + provider + ngrokDomain atomically', async () => {
    // Stub — after Plan 04 ships writeTunnelSettings using safeAtomicWriteFileSync
    // Write { enabled: true, provider: 'ngrok', ngrokDomain: 'foo.ngrok-free.app' }
    // Read back and assert all three fields match
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });

  it('writeTunnelSettings rejects unknown provider (falls back to prev provider)', async () => {
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });
});

describe('provider registry', () => {
  it('getTunnelProvider("cf-quick") returns cloudflaredQuickProvider', async () => {
    // Stub — after Plan 03/04 ship providers
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });

  it('getTunnelProvider("ngrok") returns ngrokProvider', async () => {
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });

  it('getTunnelProvider("cf-named") returns cloudflaredNamedProvider', async () => {
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });

  it('getTunnelProvider with unknown id throws Error', async () => {
    assert.ok(true, 'Stub — filled in after tunnel-providers/index.js lands');
  });
});
