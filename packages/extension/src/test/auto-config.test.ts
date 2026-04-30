import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeServerEntry, removeServerEntry, getNestedKey, setNestedKey, writeConfigAtomic } from '../auto-config/ide-detection.js';

// Mock vscode before importing modules that depend on it
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    }),
  },
}));

import { buildNpxServerEntry } from '../auto-config/index.js';

describe('mergeServerEntry', () => {
  it('adds server to empty config', () => {
    const result = mergeServerEntry({}, 'mcpServers', 'airtable', { command: 'node', args: ['/path'] });
    expect(result).toEqual({ mcpServers: { airtable: { command: 'node', args: ['/path'] } } });
  });

  it('merges without overwriting existing entries', () => {
    const existing = { mcpServers: { other: { command: 'python' } } };
    const result = mergeServerEntry(existing, 'mcpServers', 'airtable', { command: 'node', args: [] });
    expect(result.mcpServers).toHaveProperty('other');
    expect(result.mcpServers).toHaveProperty('airtable');
  });

  it('overwrites existing airtable entry', () => {
    const existing = { mcpServers: { airtable: { command: 'old-node' } } };
    const result = mergeServerEntry(existing, 'mcpServers', 'airtable', { command: 'node', args: ['/new'] });
    expect(result.mcpServers.airtable.command).toBe('node');
  });

  it('handles dot-notation key (amp format)', () => {
    const result = mergeServerEntry({}, 'mcp.servers', 'airtable', { command: 'node', args: [] });
    expect(result.mcp.servers.airtable.command).toBe('node');
  });
});

describe('removeServerEntry', () => {
  it('removes the named server', () => {
    const config = { mcpServers: { airtable: { command: 'node' }, other: { command: 'python' } } };
    const result = removeServerEntry(config, 'mcpServers', 'airtable');
    expect(result.mcpServers).not.toHaveProperty('airtable');
    expect(result.mcpServers).toHaveProperty('other');
  });

  it('leaves empty servers object when last entry removed', () => {
    const config = { mcpServers: { airtable: { command: 'node' } } };
    const result = removeServerEntry(config, 'mcpServers', 'airtable');
    expect(result.mcpServers).toEqual({});
  });

  it('handles dot-notation key', () => {
    const config = { mcp: { servers: { airtable: { command: 'node' } } } };
    const result = removeServerEntry(config, 'mcp.servers', 'airtable');
    expect((result.mcp as any).servers).toEqual({});
  });

  it('is a no-op for missing server name', () => {
    const config = { mcpServers: { other: { command: 'python' } } };
    const result = removeServerEntry(config, 'mcpServers', 'airtable');
    expect(result).toEqual(config);
  });
});

describe('buildNpxServerEntry', () => {
  it('returns npx command structure', () => {
    const entry = buildNpxServerEntry();
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['-y', 'airtable-user-mcp']);
    expect((entry.env as any).AIRTABLE_HEADLESS_ONLY).toBe('1');
    expect((entry.env as any).AIRTABLE_PROFILE_DIR).toContain('.airtable-user-mcp');
  });

  it('does not include NODE_PATH', () => {
    const entry = buildNpxServerEntry();
    expect((entry.env as any).NODE_PATH).toBeUndefined();
  });
});

describe('getNestedKey / setNestedKey', () => {
  it('gets nested value by dot path', () => {
    expect(getNestedKey({ a: { b: 42 } }, 'a.b')).toBe(42);
  });
  it('returns undefined for missing path', () => {
    expect(getNestedKey({}, 'a.b')).toBeUndefined();
  });
  it('sets nested value, creating intermediate objects', () => {
    const obj = {};
    setNestedKey(obj, 'a.b.c', 99);
    expect((obj as any).a.b.c).toBe(99);
  });
});

// ─── H10 — writeConfigAtomic uses unique tmp paths ──────────────────────────
describe('writeConfigAtomic (H10)', () => {
  const sandbox = path.join(os.tmpdir(), 'airtable-atomic-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(sandbox, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('writes a fresh config file', async () => {
    const target = path.join(sandbox, 'config.json');
    await writeConfigAtomic(target, { foo: 'bar' });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ foo: 'bar' });
  });

  it('overwrites an existing file atomically', async () => {
    const target = path.join(sandbox, 'config.json');
    fs.writeFileSync(target, '{"old": true}');
    await writeConfigAtomic(target, { new: true });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ new: true });
  });

  it('concurrent writes never corrupt the target with interleaved output', async () => {
    const target = path.join(sandbox, 'config.json');
    // Before the H10 fix the two writes would share the same `.tmp` suffix
    // and one could truncate the other's output — the target could end up
    // with partial / mixed bytes. With unique tmp paths that can no longer
    // happen.
    //
    // Note: on Windows, concurrent rename() onto the same target can fail
    // with EPERM (one wins, the loser sees "file in use"). That's a Windows
    // limitation, not an H10 regression; we verify the invariant "target
    // ends up with ONE writer's payload, never a corrupted blob" via
    // allSettled rather than Promise.all.
    const results = await Promise.allSettled([
      writeConfigAtomic(target, { writer: 'a' }),
      writeConfigAtomic(target, { writer: 'b' }),
    ]);
    // At least one writer must have succeeded.
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);

    const final = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(['a', 'b']).toContain(final.writer);

    // No leftover tmp files should remain in the sandbox — the loser must
    // clean up its tmp on failure (the catch block in writeConfigAtomic).
    const lingering = fs.readdirSync(sandbox).filter(f => f.endsWith('.tmp'));
    expect(lingering).toEqual([]);
  });

  it('cleans up the tmp file when the rename fails', async () => {
    // Point at a target whose parent directory is actually a FILE, so mkdir
    // succeeds for the parent (same dir) but the subsequent rename can't
    // place the file there. Simplest reproducer: mark the target name as a
    // directory so rename clashes.
    const target = path.join(sandbox, 'target');
    fs.mkdirSync(target, { recursive: true });

    // rename(tmp, target) should fail because `target` is a non-empty dir...
    // Make it non-empty to guarantee the EISDIR/EEXIST rename error.
    fs.writeFileSync(path.join(target, 'sentinel'), 'x');

    await expect(writeConfigAtomic(target, { x: 1 })).rejects.toThrow();

    // The sandbox must not contain any lingering .tmp files.
    const lingering = fs.readdirSync(sandbox).filter(f => f.endsWith('.tmp'));
    expect(lingering).toEqual([]);
  });
});
