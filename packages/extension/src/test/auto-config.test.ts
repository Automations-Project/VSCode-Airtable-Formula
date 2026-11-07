import { describe, it, expect, vi, afterEach } from 'vitest';

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

import { buildNpxServerEntry, buildServerEntry, isLspConfigured, IDE_CONFIGS } from '../auto-config/index.js';
import { MANAGED_ENV_KEYS } from '../auto-config/mcp-writer.js';

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

  it('every env key the extension writes is one the writer manages (and may replace)', () => {
    mockConfig['mcp.authMode'] = 'byo';
    mockConfig['mcp.httpClient'] = 'impit';
    mockConfig['auth.browserChoice'] = { mode: 'custom', channel: 'chrome', executablePath: '/x/chrome' };
    for (const entry of [buildNpxServerEntry(), buildServerEntry('/x/dist/mcp/index.mjs')]) {
      const keys = Object.keys(entry.env as object);
      expect(keys).toContain('AIRTABLE_BROWSER_PATH');
      for (const k of keys) expect(MANAGED_ENV_KEYS.has(k), k).toBe(true);
    }
  });

  it('browserIdleParkMinutes=0 disables parking via env 0', () => {
    mockConfig['mcp.browserIdleParkMinutes'] = 0;
    const env = buildNpxServerEntry().env as any;
    expect(env.AIRTABLE_BROWSER_IDLE_PARK_MS).toBe('0');
  });
});

describe('Zed is an MCP client again, with no LSP', () => {
  it('has MCP and no LSP config', async () => {
    expect(IDE_CONFIGS.zed.capabilities).toEqual(['mcp']);
    expect(IDE_CONFIGS.zed.lspConfigPath).toBeUndefined();
    expect(await isLspConfigured('zed')).toBe(false);
  });
});
