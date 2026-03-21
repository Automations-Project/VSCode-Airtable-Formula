import { describe, it, expect } from 'vitest';
import { mergeServerEntry, getNestedKey, setNestedKey } from '../auto-config/ide-detection.js';

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
