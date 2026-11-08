import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MCP_CLIENTS, MCP_CLIENT_BY_ID, hostPathContext, resolveConfigPath, samePath, type McpClientId, type PathContext } from '../auto-config/mcp-clients.js';

// Expected values are the pinned add-mcp agents.ts (5ae1d29) helper section and
// agents table, except the rows mcp-clients.ts marks as ours or as following a
// client's own docs/source (cline, zed, amp, windsurf-next, cursor/claude-code detection).

const W: PathContext = { platform: 'win32', home: 'C:\\Users\\u', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } };
const M: PathContext = { platform: 'darwin', home: '/Users/u', env: {} };
const L: PathContext = { platform: 'linux', home: '/home/u', env: {} };
const none = () => false;
const at = (rel: string): [string, string, string] => [`C:\\Users\\u\\${rel.replace(/\//g, '\\')}`, `/Users/u/${rel}`, `/home/u/${rel}`];
const IDS: McpClientId[] = ['cursor', 'windsurf', 'windsurf-next', 'claude-code', 'claude-desktop', 'cline', 'amp', 'opencode', 'codex-cli', 'zed', 'antigravity', 'factory-droid', 'fx', 'gemini-cli', 'github-copilot-cli', 'grok-build', 'junie', 'kilo-code', 'kimi-code', 'kiro-cli', 'mastracode', 'mcporter', 'pi'];

const PATHS: Record<McpClientId, [string, string, string]> = {
  'cursor': at('.cursor/mcp.json'),
  'windsurf': at('.codeium/windsurf/mcp_config.json'),
  'windsurf-next': at('.codeium/windsurf-next/mcp_config.json'),
  'claude-code': at('.claude.json'),
  'claude-desktop': ['C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json', '/Users/u/Library/Application Support/Claude/claude_desktop_config.json', '/home/u/.config/Claude/claude_desktop_config.json'],
  // Cline's own source (cline/cline v4.x): the extension, the CLI and JetBrains
  // read one shared file, not upstream's globalStorage path. See mcp-clients.ts.
  'cline': at('.cline/data/settings/cline_mcp_settings.json'),
  'amp': at('.config/amp/settings.json'),
  'opencode': at('.config/opencode/opencode.jsonc'),
  'codex-cli': at('.codex/config.toml'),
  'zed': ['C:\\Users\\u\\AppData\\Roaming\\Zed\\settings.json', '/Users/u/.config/zed/settings.json', '/home/u/.config/zed/settings.json'],
  'antigravity': at('.gemini/config/mcp_config.json'),
  'factory-droid': at('.factory/mcp.json'),
  'fx': at('.fx/mcp.json'),
  'gemini-cli': at('.gemini/settings.json'),
  'github-copilot-cli': at('.copilot/mcp-config.json'),
  'grok-build': at('.grok/config.toml'),
  'junie': at('.junie/mcp/mcp.json'),
  'kilo-code': at('.config/kilo/kilo.json'),
  'kimi-code': at('.kimi-code/mcp.json'),
  'kiro-cli': at('.kiro/settings/mcp.json'),
  'mastracode': at('.mastracode/mcp.json'),
  'mcporter': at('.mcporter/mcporter.json'),
  'pi': at('.pi/agent/mcp.json'),
};

const m = (upstream: string | null, key: string, format: string, shape: string) => ({ upstream, serversPath: [key], format, shape });
const META: Record<McpClientId, ReturnType<typeof m>> = {
  'cursor': m('cursor', 'mcpServers', 'json', 'standard'),
  'windsurf': m('windsurf', 'mcpServers', 'json', 'standard'),
  'windsurf-next': m(null, 'mcpServers', 'json', 'standard'),
  'claude-code': m('claude-code', 'mcpServers', 'json', 'standard'),
  'claude-desktop': m('claude-desktop', 'mcpServers', 'json', 'standard'),
  'cline': m('cline', 'mcpServers', 'json', 'cline'),
  'amp': m(null, 'amp.mcpServers', 'json', 'standard'),
  'opencode': m('opencode', 'mcp', 'jsonc', 'opencode'),
  'codex-cli': m('codex', 'mcp_servers', 'toml', 'codex'),
  'zed': m('zed', 'context_servers', 'jsonc', 'zed'),
  'antigravity': m('antigravity', 'mcpServers', 'json', 'standard'),
  'factory-droid': m('factory-droid', 'mcpServers', 'json', 'typed-stdio'),
  'fx': m('fx', 'mcp', 'json', 'fx'),
  'gemini-cli': m('gemini-cli', 'mcpServers', 'json', 'standard'),
  'github-copilot-cli': m('github-copilot-cli', 'mcpServers', 'json', 'copilot-cli'),
  'grok-build': m('grok-build', 'mcp_servers', 'toml', 'standard'),
  'junie': m('junie', 'mcpServers', 'json', 'standard'),
  'kilo-code': m('kilo-code', 'mcp', 'jsonc', 'opencode'),
  'kimi-code': m('kimi-code', 'mcpServers', 'json', 'kimi'),
  'kiro-cli': m('kiro-cli', 'mcpServers', 'json', 'standard'),
  'mastracode': m('mastracode', 'mcpServers', 'json', 'standard'),
  'mcporter': m('mcporter', 'mcpServers', 'jsonc', 'standard'),
  'pi': m('pi', 'mcpServers', 'json', 'standard'),
};

describe('MCP client table', () => {
  it('has the 23 version-1 rows in order', () => {
    expect(MCP_CLIENTS.map(r => r.id)).toEqual(IDS);
    expect(Object.keys(MCP_CLIENT_BY_ID).sort()).toEqual([...IDS].sort());
    for (const r of MCP_CLIENTS) expect(MCP_CLIENT_BY_ID[r.id]).toBe(r);
  });

  it.each(IDS)('%s: upstream id, servers path, format and shape', id => {
    const r = MCP_CLIENT_BY_ID[id];
    expect({ upstream: r.upstream, serversPath: r.serversPath, format: r.format, shape: r.shape }).toEqual(META[id]);
  });

  it.each(IDS)('%s: global config path on win32, darwin and linux', id => {
    expect([W, M, L].map(ctx => resolveConfigPath(MCP_CLIENT_BY_ID[id], ctx, none))).toEqual(PATHS[id]);
  });

  it.each(IDS)('%s: detection paths are absolute, and the first lies under home', id => {
    for (const ctx of [W, M, L]) {
      const paths = MCP_CLIENT_BY_ID[id].detect(ctx);
      const p = ctx.platform === 'win32' ? path.win32 : path.posix;
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) expect(p.isAbsolute(d), d).toBe(true);
      expect(paths[0].startsWith(ctx.home), paths[0]).toBe(true);
    }
  });

  it('keeps the detection paths we already had', () => {
    expect(MCP_CLIENT_BY_ID.cursor.detect(M)).toEqual(['/Users/u/.cursor', '/Applications/Cursor.app']);
    expect(MCP_CLIENT_BY_ID.cursor.detect(W)).toEqual(['C:\\Users\\u\\.cursor', 'C:\\Users\\u\\AppData\\Local\\Programs\\cursor']);
    expect(MCP_CLIENT_BY_ID.cursor.detect(L)).toEqual(['/home/u/.cursor']);
    expect(MCP_CLIENT_BY_ID['claude-code'].detect(L)).toEqual(['/home/u/.claude', '/home/u/.claude.json']);
    expect(MCP_CLIENT_BY_ID.zed.detect(M)).toEqual(['/Users/u/.config/zed', '/Users/u/Library/Application Support/Zed', '/Applications/Zed.app']);
    expect(MCP_CLIENT_BY_ID['kilo-code'].detect(L)).toEqual(['/home/u/.config/kilo', '/home/u/.config/Code/User/globalStorage/kilocode.kilo-code']);
    expect(MCP_CLIENT_BY_ID.cline.detect(L)).toEqual(['/home/u/.cline', '/home/u/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings']);
  });

  it('detection paths of the upstream-only rows, on linux', () => {
    const d = (id: McpClientId) => MCP_CLIENT_BY_ID[id].detect(L);
    expect(d('windsurf')).toEqual(['/home/u/.codeium/windsurf']);
    expect(d('windsurf-next')).toEqual(['/home/u/.codeium/windsurf-next']);
    expect(d('claude-desktop')).toEqual(['/home/u/.config/Claude']);
    expect(d('amp')).toEqual(['/home/u/.config/amp']);
    expect(d('opencode')).toEqual(['/home/u/.config/opencode']);
    expect(d('codex-cli')).toEqual(['/home/u/.codex']);
    expect(d('zed')).toEqual(['/home/u/.config/zed']);
    expect(d('antigravity')).toEqual(['/home/u/.gemini/config']);
    expect(d('factory-droid')).toEqual(['/home/u/.factory']);
    expect(d('fx')).toEqual(['/home/u/.fx']);
    expect(d('gemini-cli')).toEqual(['/home/u/.gemini']);
    expect(d('github-copilot-cli')).toEqual(['/home/u/.copilot']);
    expect(d('grok-build')).toEqual(['/home/u/.grok']);
    expect(d('junie')).toEqual(['/home/u/.junie']);
    expect(d('kimi-code')).toEqual(['/home/u/.kimi-code']);
    expect(d('kiro-cli')).toEqual(['/home/u/.kiro']);
    expect(d('mastracode')).toEqual(['/home/u/.mastracode']);
    expect(d('mcporter')).toEqual(['/home/u/.mcporter']);
    expect(d('pi')).toEqual(['/home/u/.pi/agent']);
  });

  it('Zed detection on win32 is the config dir only', () => {
    expect(MCP_CLIENT_BY_ID.zed.detect(W)).toEqual(['C:\\Users\\u\\AppData\\Roaming\\Zed']);
  });

  it('only Amp and Codex CLI declare legacy locations', () => {
    expect(MCP_CLIENTS.filter(r => r.legacy).map(r => r.id)).toEqual(['amp', 'codex-cli']);
    expect(MCP_CLIENT_BY_ID.amp.legacy!(L)).toEqual([{ path: '/home/u/.config/amp/settings.json', serversPath: ['mcp', 'servers'] }]);
    expect(MCP_CLIENT_BY_ID['codex-cli'].legacy!(L)).toEqual([{ path: '/home/u/.codex/config.toml', serversPath: ['mcp_servers'] }]);
  });

  it('the Codex legacy location ignores CODEX_HOME: it is where we wrote before', () => {
    expect(MCP_CLIENT_BY_ID['codex-cli'].legacy!({ ...L, env: { CODEX_HOME: '/x/codex' } })).toEqual([{ path: '/home/u/.codex/config.toml', serversPath: ['mcp_servers'] }]);
  });

  it('the official Airtable entry stays on the eight clients that have it today', () => {
    expect(MCP_CLIENTS.filter(r => r.official).map(r => [r.id, r.official])).toEqual([
      ['cursor', 'url'], ['windsurf', 'serverUrl'], ['windsurf-next', 'serverUrl'], ['claude-code', 'url'],
      ['claude-desktop', 'url'], ['cline', 'url'], ['amp', 'url'], ['opencode', 'url'],
    ]);
  });

  it('only OpenCode chooses its write location per file', () => {
    expect(MCP_CLIENTS.filter(r => r.layout).map(r => r.id)).toEqual(['opencode']);
  });

  it('only OpenCode, Kilo Code and MCPorter prefer an existing file', () => {
    expect(MCP_CLIENTS.filter(r => r.preferExisting).map(r => r.id)).toEqual(['opencode', 'kilo-code', 'mcporter']);
  });

  it.each([W, M, L])('no two rows share a config file on $platform', ctx => {
    const paths = MCP_CLIENTS.map(r => [r.id, resolveConfigPath(r, ctx, none)] as const);
    for (const [i, [a, pa]] of paths.entries()) {
      for (const [b, pb] of paths.slice(i + 1)) expect(samePath(ctx, pa, pb), `${a} and ${b}: ${pa}`).toBe(false);
    }
  });

  it('labels are the ones the UI shows today, plus the new rows', () => {
    expect(MCP_CLIENTS.map(r => r.label)).toEqual([
      'Cursor', 'Devin Desktop (Windsurf)', 'Devin Desktop Next (Windsurf Next)', 'Claude Code', 'Claude Desktop', 'Cline', 'Amp', 'OpenCode', 'Codex CLI', 'Zed',
      'Antigravity', 'Factory Droid', 'fx', 'Gemini CLI', 'GitHub Copilot CLI', 'Grok Build', 'Junie', 'Kilo Code', 'Kimi Code', 'Kiro CLI', 'Mastra Code', 'MCPorter', 'Pi',
    ]);
  });

  it('every row has an https docs link', () => {
    for (const r of MCP_CLIENTS) expect(r.docsUrl, r.id).toMatch(/^https:\/\//);
  });

  it('carries the Apache-2.0 attribution header naming the pin', () => {
    const head = fs.readFileSync(new URL('../auto-config/mcp-clients.ts', import.meta.url), 'utf8').split('\n').slice(0, 15).join('\n');
    expect(head).toContain('neondatabase/add-mcp');
    expect(head).toContain('5ae1d29a406568b1dedbaa4bd3b8a6fd7ef2195c');
    expect(head).toContain('Apache License, Version 2.0');
  });

  it('every row literal starts with id then upstream on one line (the drift script reads the file as text)', () => {
    const src = fs.readFileSync(new URL('../auto-config/mcp-clients.ts', import.meta.url), 'utf8');
    const heads = [...src.matchAll(/\{ id: '([^']+)', upstream: (?:'([^']+)'|null),/g)].map(x => [x[1], x[2] ?? null]);
    expect(heads).toEqual(MCP_CLIENTS.map(r => [r.id, r.upstream]));
  });
});

describe('environment overrides, read the way upstream reads them', () => {
  const lx = (env: Record<string, string>): PathContext => ({ ...L, env });
  const OVERRIDES = [
    ['codex-cli', { CODEX_HOME: '/x/codex' }, '/x/codex/config.toml'],
    ['grok-build', { GROK_HOME: '/x/grok' }, '/x/grok/config.toml'],
    ['github-copilot-cli', { COPILOT_HOME: '/x/copilot' }, '/x/copilot/mcp-config.json'],
    ['kimi-code', { KIMI_CODE_HOME: '/x/kimi' }, '/x/kimi/mcp.json'],
    ['junie', { JUNIE_HOME: '/x/junie' }, '/x/junie/mcp/mcp.json'],
    ['pi', { PI_CODING_AGENT_DIR: '/x/pi' }, '/x/pi/mcp.json'],
    ['cline', { CLINE_DIR: '/x/cline' }, '/x/cline/data/settings/cline_mcp_settings.json'],
    ['claude-desktop', { XDG_CONFIG_HOME: '/x/xdg' }, '/x/xdg/Claude/claude_desktop_config.json'],
    ['cline', { XDG_CONFIG_HOME: '/x/xdg' }, '/home/u/.cline/data/settings/cline_mcp_settings.json'],
    ['kilo-code', { XDG_CONFIG_HOME: '/x/xdg' }, '/x/xdg/kilo/kilo.json'],
    ['zed', { XDG_CONFIG_HOME: '/x/xdg' }, '/x/xdg/zed/settings.json'],
    ['opencode', { XDG_CONFIG_HOME: '/x/xdg' }, '/home/u/.config/opencode/opencode.jsonc'],
    ['amp', { XDG_CONFIG_HOME: '/x/xdg' }, '/home/u/.config/amp/settings.json'],
  ] as const;

  it.each(OVERRIDES)('%s with %j', (id, env, expected) => {
    expect(resolveConfigPath(MCP_CLIENT_BY_ID[id], lx(env), none)).toBe(expected);
  });

  it.each(OVERRIDES)('%s with %j set to the empty string falls back like an unset one', (id, env) => {
    const empty = Object.fromEntries(Object.keys(env).map(k => [k, '']));
    expect(resolveConfigPath(MCP_CLIENT_BY_ID[id], lx(empty), none)).toBe(PATHS[id][2]);
  });

  it('the home overrides also move detection, as upstream detects the same dir', () => {
    const d = (id: McpClientId, env: Record<string, string>) => MCP_CLIENT_BY_ID[id].detect(lx(env));
    expect(d('grok-build', { GROK_HOME: '/x/grok' })).toEqual(['/x/grok']);
    expect(d('github-copilot-cli', { COPILOT_HOME: '/x/copilot' })).toEqual(['/x/copilot']);
    expect(d('kimi-code', { KIMI_CODE_HOME: '/x/kimi' })).toEqual(['/x/kimi']);
    expect(d('junie', { JUNIE_HOME: '/x/junie' })).toEqual(['/x/junie']);
    expect(d('pi', { PI_CODING_AGENT_DIR: '/x/pi' })).toEqual(['/x/pi']);
    expect(d('kilo-code', { XDG_CONFIG_HOME: '/x/xdg' })).toEqual(['/x/xdg/kilo', '/x/xdg/Code/User/globalStorage/kilocode.kilo-code']);
    expect(d('cline', { XDG_CONFIG_HOME: '/x/xdg' })).toEqual(['/home/u/.cline', '/x/xdg/Code/User/globalStorage/saoudrizwan.claude-dev/settings']);
    expect(d('claude-desktop', { XDG_CONFIG_HOME: '/x/xdg' })).toEqual(['/x/xdg/Claude']);
    expect(d('zed', { XDG_CONFIG_HOME: '/x/xdg' })).toEqual(['/x/xdg/zed']);
  });

  it('XDG_CONFIG_HOME moves Kilo Code on macOS too, but not Claude Desktop or Zed', () => {
    const mx: PathContext = { ...M, env: { XDG_CONFIG_HOME: '/x/xdg' } };
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['kilo-code'], mx, none)).toBe('/x/xdg/kilo/kilo.json');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['claude-desktop'], mx, none)).toBe('/Users/u/Library/Application Support/Claude/claude_desktop_config.json');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID.zed, mx, none)).toBe('/Users/u/.config/zed/settings.json');
  });

  it('XDG_CONFIG_HOME moves Kilo Code on win32 too, but not Claude Desktop or Zed', () => {
    const wx: PathContext = { ...W, env: { ...W.env, XDG_CONFIG_HOME: 'D:\\xdg' } };
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['kilo-code'], wx, none)).toBe('D:\\xdg\\kilo\\kilo.json');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['claude-desktop'], wx, none)).toBe(PATHS['claude-desktop'][0]);
    expect(resolveConfigPath(MCP_CLIENT_BY_ID.zed, wx, none)).toBe(PATHS.zed[0]);
  });

  it('an empty variable falls back like an unset one', () => {
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['codex-cli'], lx({ CODEX_HOME: '' }), none)).toBe('/home/u/.codex/config.toml');
  });

  it('win32 without APPDATA uses <home>\\AppData\\Roaming', () => {
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['claude-desktop'], { ...W, env: {} }, none)).toBe('C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['claude-desktop'], { ...W, env: { APPDATA: '' } }, none)).toBe('C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  });

  it('win32 APPDATA moves Claude Desktop, Zed and the VS Code user dir', () => {
    const wa: PathContext = { ...W, env: { APPDATA: 'D:\\Roam' } };
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['claude-desktop'], wa, none)).toBe('D:\\Roam\\Claude\\claude_desktop_config.json');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID.zed, wa, none)).toBe('D:\\Roam\\Zed\\settings.json');
    expect(MCP_CLIENT_BY_ID.cline.detect(wa)).toEqual(['C:\\Users\\u\\.cline', 'D:\\Roam\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings']);
    expect(MCP_CLIENT_BY_ID['kilo-code'].detect(wa)[1]).toBe('D:\\Roam\\Code\\User\\globalStorage\\kilocode.kilo-code');
  });

  it('win32 LOCALAPPDATA moves the Cursor install detection path, and falls back when unset or empty', () => {
    expect(MCP_CLIENT_BY_ID.cursor.detect({ ...W, env: { LOCALAPPDATA: 'D:\\Local' } })[1]).toBe('D:\\Local\\Programs\\cursor');
    expect(MCP_CLIENT_BY_ID.cursor.detect({ ...W, env: {} })[1]).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\cursor');
    expect(MCP_CLIENT_BY_ID.cursor.detect({ ...W, env: { LOCALAPPDATA: '' } })[1]).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\cursor');
  });

  it('Codex detection ignores CODEX_HOME, as upstream does', () => {
    expect(MCP_CLIENT_BY_ID['codex-cli'].detect(lx({ CODEX_HOME: '/x/codex' }))).toEqual(['/home/u/.codex']);
  });
});

describe('rows that prefer a file that already exists', () => {
  const only = (...names: string[]) => (p: string) => names.some(n => p.endsWith(`/${n}`));
  it('OpenCode: an existing .jsonc, else an existing .json, else .jsonc', () => {
    const r = MCP_CLIENT_BY_ID.opencode;
    expect(resolveConfigPath(r, L, only('opencode.json'))).toBe('/home/u/.config/opencode/opencode.json');
    expect(resolveConfigPath(r, L, only('opencode.json', 'opencode.jsonc'))).toBe('/home/u/.config/opencode/opencode.jsonc');
  });
  it('Kilo Code: an existing kilo.jsonc, else kilo.json', () => {
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['kilo-code'], L, only('kilo.jsonc'))).toBe('/home/u/.config/kilo/kilo.jsonc');
    expect(resolveConfigPath(MCP_CLIENT_BY_ID['kilo-code'], L, only('kilo.json'))).toBe('/home/u/.config/kilo/kilo.json');
  });
  it('MCPorter: an existing mcporter.json, else an existing mcporter.jsonc, else mcporter.json', () => {
    const r = MCP_CLIENT_BY_ID.mcporter;
    expect(resolveConfigPath(r, L, only('mcporter.jsonc'))).toBe('/home/u/.mcporter/mcporter.jsonc');
    expect(resolveConfigPath(r, L, only('mcporter.json', 'mcporter.jsonc'))).toBe('/home/u/.mcporter/mcporter.json');
  });
  it('rows without preferExisting never consult the file system', () => {
    const exists = () => { throw new Error('consulted'); };
    expect(resolveConfigPath(MCP_CLIENT_BY_ID.cursor, L, exists)).toBe('/home/u/.cursor/mcp.json');
  });
});

describe('samePath', () => {
  it('win32 ignores case and separator style', () => {
    expect(samePath(W, 'C:\\Users\\u\\.cursor\\mcp.json', 'c:/users/U/.cursor/./MCP.json')).toBe(true);
    expect(samePath(W, 'C:\\Users\\u\\.cursor\\mcp.json', 'C:\\Users\\u\\.cursor\\mcp.jsonc')).toBe(false);
  });
  it('posix is case-sensitive but normalizes', () => {
    expect(samePath(L, '/home/u/.config/amp/settings.json', '/home/u/.config/x/../amp//settings.json')).toBe(true);
    expect(samePath(M, '/Users/u/.cursor/mcp.json', '/Users/u/.cursor/MCP.json')).toBe(false);
  });
});

describe('hostPathContext', () => {
  it('is this process: platform, home dir and environment', () => {
    const ctx = hostPathContext();
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.home).toBe(os.homedir());
    expect(ctx.env).toBe(process.env);
  });
});


describe('Cline MCP path override precedence', () => {
  it.each(['linux', 'darwin', 'win32'] as const)('%s follows settings file > data directory > Cline directory', platform => {
    const P = platform === 'win32' ? path.win32 : path.posix;
    const home = platform === 'win32' ? 'C:\\Users\\u' : '/home/u';
    const root = platform === 'win32' ? 'D:\\custom' : '/custom';
    const settings = P.join(root, 'chosen.json');
    const data = P.join(root, 'data');
    const cline = P.join(root, 'cline');
    const resolve = (env: Record<string, string>) => resolveConfigPath(MCP_CLIENT_BY_ID.cline, { platform, home, env }, none);
    expect(resolve({ CLINE_MCP_SETTINGS_PATH: settings, CLINE_DATA_DIR: data, CLINE_DIR: cline })).toBe(settings);
    expect(resolve({ CLINE_MCP_SETTINGS_PATH: '', CLINE_DATA_DIR: data, CLINE_DIR: cline })).toBe(P.join(data, 'settings', 'cline_mcp_settings.json'));
    expect(resolve({ CLINE_MCP_SETTINGS_PATH: '  ', CLINE_DATA_DIR: '  ', CLINE_DIR: '  ' + cline + '  ' })).toBe(P.join(cline, 'data', 'settings', 'cline_mcp_settings.json'));
    expect(resolve({ CLINE_MCP_SETTINGS_PATH: '  ' + settings + '  ', CLINE_DATA_DIR: data })).toBe(settings);
    expect(resolve({ CLINE_DATA_DIR: '  ' + data + '  ' })).toBe(P.join(data, 'settings', 'cline_mcp_settings.json'));
    expect(resolve({ CLINE_MCP_SETTINGS_PATH: '', CLINE_DATA_DIR: '', CLINE_DIR: '' })).toBe(P.join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json'));
  });
});


describe('Cline custom root detection paths', () => {
  it.each([L, M, W])('$platform preserves default paths and recognizes a trimmed custom root', ctx => {
    const row = MCP_CLIENT_BY_ID.cline;
    const root = ctx.platform === 'win32' ? 'D:\\custom-cline' : '/custom-cline';
    const defaults = row.detect(ctx);
    expect(row.detect({ ...ctx, env: { ...ctx.env, CLINE_DIR: `  ${root}  ` } })).toEqual([root, ...defaults]);
    expect(row.detect({ ...ctx, env: { ...ctx.env, CLINE_DIR: '   ' } })).toEqual(defaults);
    expect(row.detect({ ...ctx, env: { ...ctx.env, CLINE_DIR: defaults[0] } })).toEqual(defaults);
  });
});
