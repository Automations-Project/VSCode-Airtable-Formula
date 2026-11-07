import { describe, it, expect, vi, afterEach } from 'vitest';
import { mergeServerEntry, removeServerEntry, getNestedKey, setNestedKey } from '../auto-config/ide-detection.js';

// Mock vscode before importing modules that depend on it. `mockConfig` (hoisted so the mock factory
// can read it) lets a test override specific settings; unset keys fall through to the default.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: {} as Record<string, unknown> }));
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: unknown) => (key in mockConfig ? mockConfig[key] : defaultValue),
    }),
  },
}));

import { buildNpxServerEntry, buildServerEntry, getAllIdeStatuses, isLspConfigured, IDE_CONFIGS } from '../auto-config/index.js';

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

describe('auto-config propagates transport/auth-mode settings', () => {
  afterEach(() => { for (const k of Object.keys(mockConfig)) delete mockConfig[k]; });

  it('default (browser + fetch) → no AIRTABLE_AUTH_MODE / AIRTABLE_HTTP_CLIENT injected', () => {
    for (const entry of [buildNpxServerEntry(), buildServerEntry('/x/dist/mcp/index.mjs')]) {
      expect((entry.env as any).AIRTABLE_AUTH_MODE).toBeUndefined();
      expect((entry.env as any).AIRTABLE_HTTP_CLIENT).toBeUndefined();
    }
  });

  it('direct-login is propagated into the generated MCP config env (the reported bug)', () => {
    mockConfig['mcp.authMode'] = 'direct-login';
    expect((buildNpxServerEntry().env as any).AIRTABLE_AUTH_MODE).toBe('direct-login');
    expect((buildServerEntry('/x/dist/mcp/index.mjs').env as any).AIRTABLE_AUTH_MODE).toBe('direct-login');
  });

  it('byo + impit are both propagated', () => {
    mockConfig['mcp.authMode'] = 'byo';
    mockConfig['mcp.httpClient'] = 'impit';
    const env = buildNpxServerEntry().env as any;
    expect(env.AIRTABLE_AUTH_MODE).toBe('byo');
    expect(env.AIRTABLE_HTTP_CLIENT).toBe('impit');
  });

  it('injects AIRTABLE_BROWSER_IDLE_PARK_MS (default 30 min)', () => {
    const env = buildNpxServerEntry().env as any;
    expect(env.AIRTABLE_BROWSER_IDLE_PARK_MS).toBe(String(30 * 60_000));
  });

  it('browserIdleParkMinutes=0 disables parking via env 0', () => {
    mockConfig['mcp.browserIdleParkMinutes'] = 0;
    const env = buildNpxServerEntry().env as any;
    expect(env.AIRTABLE_BROWSER_IDLE_PARK_MS).toBe('0');
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

// Zed starts only language servers that a Zed extension (or a built-in adapter)
// registers. The `lsp.airtable-lsp` settings entry Setup used to write was never
// started: zed-industries/zed#52653 ("not planned").
describe('Zed has no LSP auto-config', () => {
  it('is not an LSP target', async () => {
    expect(IDE_CONFIGS.zed.capabilities).toEqual([]);
    expect(IDE_CONFIGS.zed.lspConfigPath).toBeUndefined();
    expect(await isLspConfigured('zed')).toBe(false);
  });

  it('is not offered in Setup, like any editor with nothing to configure', async () => {
    const ids = (await getAllIdeStatuses()).map(status => status.ideId);
    expect(ids).not.toContain('zed');
    expect(ids).toContain('helix');
    for (const id of ids) expect(IDE_CONFIGS[id].capabilities.length).toBeGreaterThan(0);
  });
});
