import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { ensureToken, readToken, rotateToken, getTokenPath, generateBearerToken } from '../src/daemon/token.js';

let tmpDir;

before(() => {
  tmpDir = join(tmpdir(), 'test-airtable-token-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateBearerToken', () => {
  it('returns a 43-character base64url string', () => {
    const token = generateBearerToken();
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 43, `expected 43 chars (base64url of 32 bytes), got ${token.length}`);
  });

  it('returns different values on successive calls', () => {
    const a = generateBearerToken();
    const b = generateBearerToken();
    assert.notStrictEqual(a, b);
  });
});

describe('ensureToken', () => {
  it('ensureToken is a function', () => {
    assert.strictEqual(typeof ensureToken, 'function');
  });

  it('creates daemon.token on first call with valid bearerToken field', () => {
    const tokenPath = join(tmpDir, 'ensure-first.token');
    const record = ensureToken({ tokenPath });
    assert.ok(existsSync(tokenPath), 'token file should exist on disk');
    assert.strictEqual(typeof record.bearerToken, 'string');
    assert.ok(record.bearerToken.length > 0);
    assert.strictEqual(record.version, 1);
    assert.ok(record.createdAt);
    assert.ok(record.rotatedAt);
  });

  it('returns existing token on second call without changing it', () => {
    const tokenPath = join(tmpDir, 'ensure-idempotent.token');
    const first = ensureToken({ tokenPath });
    const second = ensureToken({ tokenPath });
    assert.strictEqual(first.bearerToken, second.bearerToken);
    assert.strictEqual(first.version, second.version);
    assert.strictEqual(first.createdAt, second.createdAt);
  });
});

describe('rotateToken', () => {
  it('rotateToken is a function', () => {
    assert.strictEqual(typeof rotateToken, 'function');
  });

  it('writes new token with incremented version', () => {
    const tokenPath = join(tmpDir, 'rotate-version.token');
    const initial = ensureToken({ tokenPath });
    assert.strictEqual(initial.version, 1);
    const rotated = rotateToken({ tokenPath });
    assert.strictEqual(rotated.version, 2);
  });

  it('bearerToken differs after rotation', () => {
    const tokenPath = join(tmpDir, 'rotate-token.token');
    const initial = ensureToken({ tokenPath });
    const rotated = rotateToken({ tokenPath });
    assert.notStrictEqual(initial.bearerToken, rotated.bearerToken);
  });

  it('preserves original createdAt across rotation', () => {
    const tokenPath = join(tmpDir, 'rotate-createdat.token');
    const initial = ensureToken({ tokenPath });
    const rotated = rotateToken({ tokenPath });
    assert.strictEqual(rotated.createdAt, initial.createdAt);
  });
});

describe('readToken', () => {
  it('readToken is a function', () => {
    assert.strictEqual(typeof readToken, 'function');
  });

  it('returns null when token file does not exist', () => {
    const tokenPath = join(tmpDir, 'nonexistent.token');
    assert.strictEqual(readToken({ tokenPath }), null);
  });

  it('returns the persisted record', () => {
    const tokenPath = join(tmpDir, 'read-existing.token');
    const created = ensureToken({ tokenPath });
    const read = readToken({ tokenPath });
    assert.deepStrictEqual(read, created);
  });
});

describe('getTokenPath', () => {
  it('getTokenPath is a function', () => {
    assert.strictEqual(typeof getTokenPath, 'function');
  });

  it('returns a path ending in daemon.token', () => {
    const p = getTokenPath();
    assert.ok(p.endsWith('daemon.token'), `expected path ending in daemon.token, got: ${p}`);
  });
});
