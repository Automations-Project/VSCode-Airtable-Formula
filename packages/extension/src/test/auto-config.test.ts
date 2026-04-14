import { describe, it, expect, vi } from 'vitest';
import { mergeServerEntry, removeServerEntry, getNestedKey, setNestedKey } from '../auto-config/ide-detection.js';

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
