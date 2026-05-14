import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { acquire, read, release, replace, isStale, getLockfilePath } from '../src/daemon/lockfile.js';

let tmpDir;

before(() => {
  tmpDir = join(tmpdir(), 'test-airtable-lockfile-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides = {}) {
  return {
    pid: process.pid,
    uuid: 'test-uuid-' + Math.random().toString(36).slice(2),
    port: 49200,
    port_lsp: null,
    bearerToken: 'test-bearer-token',
    version: '1.0.0',
    startedAt: new Date().toISOString(),
    tunnelUrl: null,
    ...overrides,
  };
}

describe('acquire', () => {
  it('acquire is a function', () => {
    assert.strictEqual(typeof acquire, 'function');
  });

  it('returns true and writes lockfile on first acquire', () => {
    const lockPath = join(tmpDir, 'acquire-first.lock');
    const record = makeRecord();
    const result = acquire(record, { lockPath });
    assert.strictEqual(result, true);
    assert.ok(existsSync(lockPath), 'lockfile should exist on disk');
    const stored = read({ lockPath });
    assert.strictEqual(stored.pid, record.pid);
    assert.strictEqual(stored.uuid, record.uuid);
    assert.strictEqual(stored.port_lsp, null);
    assert.strictEqual(stored.tunnelUrl, null);
  });

  it('returns false when lockfile exists and PID is alive', () => {
    const lockPath = join(tmpDir, 'acquire-alive.lock');
    const record = makeRecord();
    assert.strictEqual(acquire(record, { lockPath }), true);
    const result = acquire(makeRecord(), { lockPath });
    assert.strictEqual(result, false);
  });

  it('reclaims stale lockfile (dead PID) and returns true', () => {
    const lockPath = join(tmpDir, 'acquire-stale.lock');
    const staleRecord = makeRecord({ pid: 99999999 });
    assert.strictEqual(acquire(staleRecord, { lockPath }), true);
    const freshRecord = makeRecord();
    const result = acquire(freshRecord, { lockPath });
    assert.strictEqual(result, true);
    const stored = read({ lockPath });
    assert.strictEqual(stored.pid, process.pid);
  });
});

describe('read', () => {
  it('read is a function', () => {
    assert.strictEqual(typeof read, 'function');
  });

  it('returns null when lockfile does not exist', () => {
    const lockPath = join(tmpDir, 'nonexistent.lock');
    assert.strictEqual(read({ lockPath }), null);
  });

  it('returns parsed DaemonLockRecord from disk', () => {
    const lockPath = join(tmpDir, 'read-test.lock');
    const record = makeRecord();
    acquire(record, { lockPath });
    const stored = read({ lockPath });
    assert.ok(stored, 'should return a record');
    assert.strictEqual(stored.pid, record.pid);
    assert.strictEqual(stored.uuid, record.uuid);
    assert.strictEqual(stored.port, record.port);
    assert.strictEqual(stored.port_lsp, null);
    assert.strictEqual(stored.bearerToken, record.bearerToken);
    assert.strictEqual(stored.version, record.version);
    assert.strictEqual(stored.tunnelUrl, null);
  });
});

describe('isStale', () => {
  it('isStale is a function', () => {
    assert.strictEqual(typeof isStale, 'function');
  });

  it('returns true for null record', () => {
    assert.strictEqual(isStale(null), true);
  });

  it('returns true for dead PID', () => {
    const record = makeRecord({ pid: 99999999 });
    assert.strictEqual(isStale(record), true);
  });

  it('returns false for live PID (process.pid)', () => {
    const record = makeRecord({ pid: process.pid });
    assert.strictEqual(isStale(record), false);
  });
});

describe('release', () => {
  it('release is a function', () => {
    assert.strictEqual(typeof release, 'function');
  });

  it('removes lockfile from disk', () => {
    const lockPath = join(tmpDir, 'release-test.lock');
    const record = makeRecord();
    acquire(record, { lockPath });
    assert.ok(existsSync(lockPath));
    const result = release({ lockPath });
    assert.strictEqual(result, true);
    assert.ok(!existsSync(lockPath), 'lockfile should be gone after release');
    assert.strictEqual(read({ lockPath }), null);
  });

  it('returns false when lockfile does not exist', () => {
    const lockPath = join(tmpDir, 'release-missing.lock');
    assert.strictEqual(release({ lockPath }), false);
  });
});

describe('replace', () => {
  it('replace is a function', () => {
    assert.strictEqual(typeof replace, 'function');
  });

  it('overwrites lockfile with new record atomically', () => {
    const lockPath = join(tmpDir, 'replace-test.lock');
    const original = makeRecord({ port: 49200 });
    acquire(original, { lockPath });
    const updated = makeRecord({ pid: process.pid, port: 49201, uuid: original.uuid });
    const result = replace(updated, { lockPath });
    assert.strictEqual(result, true);
    const stored = read({ lockPath });
    assert.strictEqual(stored.port, 49201);
  });
});

describe('getLockfilePath', () => {
  it('getLockfilePath is a function', () => {
    assert.strictEqual(typeof getLockfilePath, 'function');
  });

  it('returns a path ending in daemon.lock', () => {
    const p = getLockfilePath();
    assert.ok(p.endsWith('daemon.lock'), `expected path to end with daemon.lock, got: ${p}`);
  });
});
