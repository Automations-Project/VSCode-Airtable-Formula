import { describe, it, expect, vi } from 'vitest';

// Mock vscode bridge so Setup.tsx module-level imports do not fail
vi.mock('../lib/vscode.js', () => ({
  sendToExtension: vi.fn(),
  onExtensionMessage: vi.fn(() => () => {}),
}));

import { formatUptime, getMcpSnippet, getLspSnippet } from '../tabs/Setup.js';

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------
describe('formatUptime', () => {
  it('returns — for null', () => {
    expect(formatUptime(null)).toBe('—');
  });

  it('returns < 1m for 0ms', () => {
    expect(formatUptime(0)).toBe('< 1m');
  });

  it('returns < 1m for 30 seconds', () => {
    expect(formatUptime(30_000)).toBe('< 1m');
  });

  it('returns Nm Ss for minutes range (2m 30s)', () => {
    expect(formatUptime(2 * 60_000 + 30_000)).toBe('2m 30s');
  });

  it('returns Hh Mm for hours range (2h 15m)', () => {
    expect(formatUptime(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });

  it('returns 0h 0m for exactly 1 hour', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m');
  });
});

// ---------------------------------------------------------------------------
// getMcpSnippet — security gate: {{BEARER_TOKEN}} must be present in all HTTP variants
// ---------------------------------------------------------------------------
describe('getMcpSnippet bearer token', () => {
  const HTTP_IDES = ['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'cline'];

  for (const ide of HTTP_IDES) {
    it(`HTTP snippet for ${ide} contains {{BEARER_TOKEN}} placeholder — never a live token (T-08-01)`, () => {
      const text = getMcpSnippet(ide, 'http', 3100);
      expect(text).toContain('{{BEARER_TOKEN}}');
    });
  }
});

// ---------------------------------------------------------------------------
// getMcpSnippet — port handling
// ---------------------------------------------------------------------------
describe('getMcpSnippet mcp port', () => {
  it('HTTP snippet contains live port when daemon is running', () => {
    const text = getMcpSnippet('cursor', 'http', 3100);
    expect(text).toContain('3100');
  });

  it('HTTP snippet contains {MCP_PORT} placeholder when port is a string', () => {
    const text = getMcpSnippet('cursor', 'http', '{MCP_PORT}');
    expect(text).toContain('{MCP_PORT}');
    expect(text).not.toContain('undefined');
  });

  it('stdio snippet does not contain a localhost URL', () => {
    const text = getMcpSnippet('cursor', 'stdio', '{MCP_PORT}');
    expect(text).toContain('airtable-user-mcp');
    expect(text).not.toContain('127.0.0.1');
  });

  it('Windsurf HTTP uses serverUrl key (not url)', () => {
    const text = getMcpSnippet('windsurf', 'http', 3100);
    expect(text).toContain('serverUrl');
  });

  it('Cursor HTTP uses url key (not type: http)', () => {
    const text = getMcpSnippet('cursor', 'http', 3100);
    expect(text).not.toContain('"type": "http"');
    expect(text).toContain('"url"');
  });

  it('Claude Code HTTP uses type: http and url keys', () => {
    const text = getMcpSnippet('claude-code', 'http', 3100);
    expect(text).toContain('"type": "http"');
    expect(text).toContain('"url"');
  });
});

// ---------------------------------------------------------------------------
// getLspSnippet — port handling
// ---------------------------------------------------------------------------
describe('getLspSnippet lsp port snippet', () => {
  it('TCP snippet uses live port_lsp when daemon is running', () => {
    const text = getLspSnippet('neovim', 'tcp', 2087);
    expect(text).toContain('2087');
  });

  it('TCP snippet contains {LSP_PORT} placeholder when port is a string', () => {
    const text = getLspSnippet('neovim', 'tcp', '{LSP_PORT}');
    expect(text).toContain('{LSP_PORT}');
    expect(text).not.toContain('undefined');
  });

  it('stdio snippet contains airtable-user-lsp', () => {
    const text = getLspSnippet('claude-code', 'stdio', '{LSP_PORT}');
    expect(text).toContain('airtable-user-lsp');
  });

  it('Neovim TCP snippet uses vim.lsp.rpc.connect (D-10)', () => {
    const text = getLspSnippet('neovim', 'tcp', 2087);
    expect(text).toContain('vim.lsp.rpc.connect');
  });

  it('Neovim stdio snippet uses vim.lsp.config (D-10)', () => {
    const text = getLspSnippet('neovim', 'stdio', '{LSP_PORT}');
    expect(text).toContain('vim.lsp.config');
  });

  it('Zed TCP snippet uses binary.arguments with tcp-client', () => {
    const text = getLspSnippet('zed', 'tcp', 2087);
    expect(text).toContain('--tcp-client');
    expect(text).toContain('2087');
  });
});
