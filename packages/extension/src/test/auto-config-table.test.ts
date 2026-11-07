import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'jsonc-parser';

// Mock vscode before importing modules that depend on it (index.ts reads settings).
const { mockConfig } = vi.hoisted(() => ({ mockConfig: {} as Record<string, unknown> }));
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: unknown) => (key in mockConfig ? mockConfig[key] : defaultValue),
    }),
  },
}));

import { IDE_IDS } from '@airtable-formula/shared';
import { IDE_CONFIGS, detectionPathsFor } from '../auto-config/ide-configs.js';
import { MCP_CLIENTS, MCP_CLIENT_BY_ID, resolveConfigPath, type McpClientId, type McpClientRow } from '../auto-config/mcp-clients.js';
import { readServerEntry, setServerEntry, type WriterDeps } from '../auto-config/mcp-writer.js';
import {
  buildOfficialAirtableEntry, configureLspForIde, configureMcpForIde, configureOfficialAirtableMcp, getAllIdeStatuses,
  getIdeStatus, getMcpHealth, isLspConfigured, isMcpConfigured, isOfficialAirtableConfigured, reapplyMcpForIde,
  settleByClient, unconfigureLspForIde, unconfigureMcpForIde, unconfigureOfficialAirtableMcp,
} from '../auto-config/index.js';
import { ENTRY_SHAPES } from '../auto-config/mcp-entry-shapes.js';
import { readMcpTomlEntry } from '../auto-config/lsp-config.js';

let home: string;
let deps: WriterDeps;
const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-table-'));
  // The LSP functions resolve OpenCode's file from the host context; os.homedir() reads these per call.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const script = path.join(home, '.airtable-user-mcp', 'start.mjs');
  const config = path.join(home, '.airtable-user-mcp', 'bundled-path.json');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '');
  fs.writeFileSync(config, '{}');
  deps = {
    ctx: { platform: process.platform, home, env: { APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') } },
    // Only the temp home exists: a real /Applications/Cursor.app must not make a client "detected".
    exists: (p) => p.startsWith(home) && fs.existsSync(p),
    launcher: { script, config },
  };
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(home, { recursive: true, force: true });
});

const fileOf = (row: McpClientRow) => resolveConfigPath(row, deps.ctx, deps.exists);
const detect = (row: McpClientRow) => fs.mkdirSync(row.detect(deps.ctx)[0], { recursive: true });
const write = (p: string, text: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const OFFICIAL_URL = 'https://mcp.airtable.com/mcp';
const OFFICIAL_IDS: McpClientId[] = ['cursor', 'windsurf', 'windsurf-next', 'claude-code', 'claude-desktop', 'cline', 'amp', 'opencode'];

it('the table ids are the contract ids minus the LSP-only editors, in order', () => {
  expect(MCP_CLIENTS.map(r => r.id)).toEqual(IDE_IDS.filter(id => id !== 'helix' && id !== 'neovim'));
  expect(Object.keys(IDE_CONFIGS)).toEqual([...IDE_IDS]);
});

it('capabilities: every row is an MCP client, OpenCode also has LSP, helix and neovim are LSP only', () => {
  for (const r of MCP_CLIENTS) expect(IDE_CONFIGS[r.id].capabilities).toContain('mcp');
  expect(IDE_CONFIGS.opencode.capabilities).toEqual(['mcp', 'lsp']);
  expect(IDE_CONFIGS.zed.capabilities).toEqual(['mcp']);
  expect(IDE_CONFIGS.helix.capabilities).toEqual(['lsp']);
  expect(IDE_CONFIGS.neovim.capabilities).toEqual(['lsp']);
  for (const id of IDE_IDS) expect(IDE_CONFIGS[id].docsUrl, id).toMatch(/^https:\/\//);
});

// Added beyond the brief: labels, docs links and detection come from the table row.
it('labels, docs links and detection paths come from the table', () => {
  for (const r of MCP_CLIENTS) {
    expect(IDE_CONFIGS[r.id]).toMatchObject({ label: r.label, docsUrl: r.docsUrl });
    expect(detectionPathsFor(r.id, deps.ctx)).toEqual(r.detect(deps.ctx));
  }
  expect(detectionPathsFor('helix', deps.ctx)).toEqual(IDE_CONFIGS.helix.detectionPaths);
  expect(IDE_CONFIGS.opencode.lspConfigPath).toBeUndefined();
  expect(IDE_CONFIGS.opencode.lspConfigFormat).toBe('json-merge');
});

it.each(MCP_CLIENTS.map(r => r.id))('%s: first-launch setup, stale-path auto-heal and remove through the public functions', async id => {
  const row = MCP_CLIENT_BY_ID[id];
  fs.mkdirSync(row.detect(deps.ctx)[0], { recursive: true });
  const entry = { command: 'node', args: [deps.launcher.script], env: { AIRTABLE_HEADLESS_ONLY: '1' } };
  let s = await getIdeStatus(id, deps);
  expect([s.detected, s.mcpConfigured]).toEqual([true, false]);            // what first-launch auto-config selects
  await configureMcpForIde(id, '/unused', entry, deps);
  s = await getIdeStatus(id, deps);
  expect([s.mcpConfigured, s.mcpServerHealthy]).toEqual([true, true]);
  // A stale path, as an older extension version left it: configured but unhealthy, and the
  // configure that auto-heal runs makes it healthy again.
  await configureMcpForIde(id, '/unused', { ...entry, args: [path.join(home, 'gone', 'dist', 'mcp', 'index.mjs')] }, deps);
  expect(await getMcpHealth(id, deps)).toEqual({ configured: true, healthy: false });
  await configureMcpForIde(id, '/unused', entry, deps);
  expect(await getMcpHealth(id, deps)).toEqual({ configured: true, healthy: true });
  fs.rmSync(deps.launcher.config);
  expect((await getIdeStatus(id, deps)).mcpServerHealthy).toBe(false);      // what auto-heal selects
  fs.writeFileSync(deps.launcher.config, '{}');
  await configureMcpForIde(id, '/unused', entry, deps);
  expect((await getIdeStatus(id, deps)).mcpServerHealthy).toBe(true);
  await unconfigureMcpForIde(id, deps);
  expect((await getIdeStatus(id, deps)).mcpConfigured).toBe(false);
});

it('configureMcpForIde is a no-op for an editor without an MCP row, and refuses an undetected client', async () => {
  await expect(configureMcpForIde('helix', '/unused', undefined, deps)).resolves.toBeUndefined();
  await expect(configureMcpForIde('gemini-cli', '/unused', { command: 'npx', args: [], env: {} }, deps)).rejects.toThrow('Gemini CLI was not found on this machine; nothing was written.');
});

// Added beyond the brief.
it('an entry with no command is refused before anything is written', async () => {
  const row = MCP_CLIENT_BY_ID.cursor;
  detect(row);
  await expect(configureMcpForIde('cursor', '/unused', { args: [] }, deps)).rejects.toThrow('the MCP server entry has no command');
  expect(fs.existsSync(fileOf(row))).toBe(false);
});

// Added beyond the brief.
it('helix and neovim have no MCP side: not configured, nothing to remove', async () => {
  for (const id of ['helix', 'neovim'] as const) {
    expect(await isMcpConfigured(id, deps)).toBe(false);
    expect(await getMcpHealth(id, deps)).toEqual({ configured: false, healthy: false });
    await expect(unconfigureMcpForIde(id, deps)).resolves.toBeUndefined();
  }
});

// Added beyond the brief: the dashboard still gets one status per contract id.
it('getAllIdeStatuses answers for all 25 ids, in contract order', async () => {
  const statuses = await getAllIdeStatuses(deps);
  expect(statuses.map(s => s.ideId)).toEqual([...IDE_IDS]);
  expect(statuses.find(s => s.ideId === 'gemini-cli')).toMatchObject({ label: 'Gemini CLI', detected: false, mcpConfigured: false });
});

it("the official Airtable entry keeps today's shapes and clients, and lands under Amp's real key", async () => {
  const auth = { Authorization: 'Bearer patX' };
  expect(buildOfficialAirtableEntry(MCP_CLIENT_BY_ID.windsurf, 'patX')).toEqual({ serverUrl: 'https://mcp.airtable.com/mcp', headers: auth });
  expect(buildOfficialAirtableEntry(MCP_CLIENT_BY_ID.cursor, 'patX')).toEqual({ type: 'http', url: 'https://mcp.airtable.com/mcp', headers: auth });
  const amp = MCP_CLIENT_BY_ID.amp;
  fs.mkdirSync(amp.detect(deps.ctx)[0], { recursive: true });
  await configureOfficialAirtableMcp('amp', 'patX', deps);
  expect(parse(fs.readFileSync(path.join(home, '.config', 'amp', 'settings.json'), 'utf8'))['amp.mcpServers'].airtable)
    .toEqual({ type: 'http', url: 'https://mcp.airtable.com/mcp', headers: auth });
  await expect(configureOfficialAirtableMcp('gemini-cli', 'patX', deps)).rejects.toThrow('Gemini CLI does not support the official Airtable server here.');
});

// The activation loops (auto-heal, first-launch auto-config) and Setup all run every client at
// once; with 23 clients, one unparsable config file must fail that client only.
describe('settleByClient: one failing client never stops the others', () => {
  it('keeps the successes in order and reports each failure with its label', async () => {
    const statuses = [
      { ideId: 'cursor', label: 'Cursor' },
      { ideId: 'zed', label: 'Zed' },
      { ideId: 'pi', label: 'Pi' },
    ] as const;
    const result = await settleByClient(statuses, async s => { if (s.ideId === 'zed') throw new Error('bad json'); });
    expect(result.ok.map(s => s.ideId)).toEqual(['cursor', 'pi']);
    expect(result.failed).toEqual([{ ideId: 'zed', label: 'Zed', message: 'bad json' }]);
  });

  it('a synchronous throw and a rejection that is not an Error are failures too', async () => {
    const statuses = [{ ideId: 'cursor', label: 'Cursor' }, { ideId: 'amp', label: 'Amp' }] as const;
    const result = await settleByClient(statuses, s => {
      if (s.ideId === 'cursor') throw new Error('sync');
      return Promise.reject('plain');
    });
    expect(result.ok).toEqual([]);
    expect(result.failed).toEqual([
      { ideId: 'cursor', label: 'Cursor', message: 'sync' },
      { ideId: 'amp', label: 'Amp', message: 'plain' },
    ]);
  });

  it('first-launch auto-config: an unparsable Cursor config fails Cursor, Claude Code is still configured', async () => {
    const entry = { command: 'node', args: [deps.launcher.script], env: {} };
    detect(MCP_CLIENT_BY_ID.cursor);
    detect(MCP_CLIENT_BY_ID['claude-code']);
    write(fileOf(MCP_CLIENT_BY_ID.cursor), '{ "mcpServers": ');
    const ready = (await getAllIdeStatuses(deps)).filter(s => s.detected && !s.mcpConfigured);
    expect(ready.map(s => s.ideId)).toEqual(['cursor', 'claude-code']);
    const { ok, failed } = await settleByClient(ready, s => configureMcpForIde(s.ideId, '/unused', entry, deps));
    expect(ok.map(s => s.label)).toEqual(['Claude Code']);
    expect(failed).toEqual([{ ideId: 'cursor', label: 'Cursor', message: expect.stringMatching(/is not valid JSON/) }]);
    expect(await getMcpHealth('claude-code', deps)).toEqual({ configured: true, healthy: true });
    expect(fs.readFileSync(fileOf(MCP_CLIENT_BY_ID.cursor), 'utf8')).toBe('{ "mcpServers": ');
  });
});

// What the activation auto-heal selects (detected, configured, unhealthy) and what it and the
// settings rewrite run (reapplyMcpForIde): an entry we cannot prove is ours is never rewritten.
describe('an entry the extension did not write is never rewritten unasked', () => {
  const HAND = { command: 'npx', args: ['-y', 'airtable-user-mcp'], env: { AIRTABLE_AUTH_MODE: 'byo', AIRTABLE_COOKIE: 'cookie-value' } };
  const ours = () => ({ command: 'node', args: [deps.launcher.script], env: { AIRTABLE_HEADLESS_ONLY: '1' } });
  const healSelects = async (id: McpClientId) => {
    const s = await getIdeStatus(id, deps);
    return s.detected && s.mcpConfigured && s.mcpServerHealthy === false;
  };

  it.each(['zed', 'factory-droid', 'kimi-code'] as const)(
    "%s: a hand-written npx entry with its own env stays byte for byte through auto-heal and a settings change",
    async id => {
      const row = MCP_CLIENT_BY_ID[id];
      detect(row);
      write(fileOf(row), JSON.stringify({ [row.serversPath[0]]: { 'airtable-user-mcp': HAND } }, null, 2) + '\n');
      const before = fs.readFileSync(fileOf(row), 'utf8');
      expect(await getMcpHealth(id, deps)).toEqual({ configured: true, healthy: true });
      expect(await healSelects(id)).toBe(false);
      expect(await reapplyMcpForIde(id, '/unused', ours(), deps)).toBe(false);
      expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(before);
    },
  );

  it.each(['zed', 'factory-droid', 'kimi-code'] as const)('%s: our own entry in an old shape and a stale path still heals', async id => {
    const row = MCP_CLIENT_BY_ID[id];
    detect(row);
    const stale = ENTRY_SHAPES.standard({ command: 'node', args: [path.join(home, 'old-ext', 'dist', 'mcp', 'index.mjs')], env: { AIRTABLE_HEADLESS_ONLY: '1' } });
    write(fileOf(row), JSON.stringify({ [row.serversPath[0]]: { 'airtable-user-mcp': stale } }, null, 2) + '\n');
    expect(await healSelects(id)).toBe(true);
    expect(await reapplyMcpForIde(id, '/unused', ours(), deps)).toBe(true);
    expect(await getMcpHealth(id, deps)).toEqual({ configured: true, healthy: true });
  });

  it("Codex: main's exact npx block is ours and heals; the same block with an env of its own is not", async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    const mainEra = '[mcp_servers.airtable-user-mcp]\ntype = "stdio"\ncommand = "npx"\nargs = ["-y", "airtable-user-mcp"]\n';
    write(fileOf(row), mainEra);
    expect(await healSelects('codex-cli')).toBe(true);
    expect(await reapplyMcpForIde('codex-cli', '/unused', ours(), deps)).toBe(true);
    expect(await getMcpHealth('codex-cli', deps)).toEqual({ configured: true, healthy: true });
    const withEnv = mainEra + '\n[mcp_servers.airtable-user-mcp.env]\nAIRTABLE_COOKIE = "c"\n';
    write(fileOf(row), withEnv);
    expect(await getMcpHealth('codex-cli', deps)).toEqual({ configured: true, healthy: true });
    expect(await reapplyMcpForIde('codex-cli', '/unused', ours(), deps)).toBe(false);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(withEnv);
  });

  it('Kilo Code: a hand-written entry in kilo.json is not moved out when kilo.jsonc becomes current', async () => {
    const row = MCP_CLIENT_BY_ID['kilo-code'];
    detect(row);
    const dir = row.detect(deps.ctx)[0];
    const theirs = JSON.stringify({ mcp: { 'airtable-user-mcp': { type: 'local', command: ['npx', '-y', 'airtable-user-mcp'], enabled: true } } }, null, 2);
    write(path.join(dir, 'kilo.json'), theirs);
    write(path.join(dir, 'kilo.jsonc'), '{}\n');
    await configureMcpForIde('kilo-code', '/unused', ours(), deps);
    expect(fs.readFileSync(path.join(dir, 'kilo.json'), 'utf8')).toBe(theirs);
    expect(await getMcpHealth('kilo-code', deps)).toEqual({ configured: true, healthy: true });
  });
});

// Writing over an entry we wrote keeps every key we do not manage.
describe('Update merges into our entry; it never drops a user key', () => {
  const ourEnv = () => ({ AIRTABLE_HEADLESS_ONLY: '1' });
  const ours = () => ({ command: 'node', args: [deps.launcher.script], env: ourEnv() });

  it("Cline: a main-era entry keeps autoApprove and timeout through auto-heal, and gains disabled: false", async () => {
    const row = MCP_CLIENT_BY_ID.cline;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { 'airtable-user-mcp': { ...ours(), autoApprove: ['list_bases', 'get_base_schema'], timeout: 120 } } }, null, 2) + '\n');
    expect(await getMcpHealth('cline', deps)).toEqual({ configured: true, healthy: false });
    expect(await reapplyMcpForIde('cline', '/unused', ours(), deps)).toBe(true);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers['airtable-user-mcp'])
      .toEqual({ ...ours(), autoApprove: ['list_bases', 'get_base_schema'], timeout: 120, disabled: false });
    expect(await getMcpHealth('cline', deps)).toEqual({ configured: true, healthy: true });
  });

  it('Cline: a server the user switched off stays off across Update and the settings rewrite', async () => {
    const row = MCP_CLIENT_BY_ID.cline;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { 'airtable-user-mcp': { ...ours(), disabled: true } } }, null, 2) + '\n');
    await configureMcpForIde('cline', '/unused', ours(), deps);
    await reapplyMcpForIde('cline', '/unused', ours(), deps);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers['airtable-user-mcp'].disabled).toBe(true);
    expect(await getMcpHealth('cline', deps)).toEqual({ configured: true, healthy: true });
  });

  it("our env keys follow the settings; the user's own env keys stay (Cursor)", async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    const env = { AIRTABLE_HEADLESS_ONLY: '1', AIRTABLE_AUTH_MODE: 'byo', HTTPS_PROXY: 'http://proxy:8080', AIRTABLE_COOKIE: 'c' };
    write(fileOf(row), JSON.stringify({ mcpServers: { 'airtable-user-mcp': { command: 'node', args: [deps.launcher.script], env, note: 'mine' } } }, null, 2) + '\n');
    await configureMcpForIde('cursor', '/unused', ours(), deps);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers['airtable-user-mcp']).toEqual({
      command: 'node', args: [deps.launcher.script], env: { AIRTABLE_HEADLESS_ONLY: '1', HTTPS_PROXY: 'http://proxy:8080', AIRTABLE_COOKIE: 'c' }, note: 'mine',
    });
  });

  it("OpenCode: main's command-string entry becomes the V1 shape; the user's env keys move to environment, enabled: false stays", async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    write(file, JSON.stringify({ mcp: { 'airtable-user-mcp': { type: 'local', command: 'node', args: [deps.launcher.script], env: { ...ourEnv(), MINE: 'x' }, enabled: false } } }, null, 2) + '\n');
    await configureMcpForIde('opencode', '/unused', ours(), deps);
    expect(parse(fs.readFileSync(file, 'utf8')).mcp['airtable-user-mcp'])
      .toEqual({ type: 'local', command: ['node', deps.launcher.script], enabled: false, environment: { ...ourEnv(), MINE: 'x' } });
  });

  it("GitHub Copilot CLI: the user's tool filter stays", async () => {
    const row = MCP_CLIENT_BY_ID['github-copilot-cli'];
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { 'airtable-user-mcp': { type: 'stdio', ...ours(), tools: ['list_bases'] } } }, null, 2) + '\n');
    await configureMcpForIde('github-copilot-cli', '/unused', ours(), deps);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers['airtable-user-mcp'].tools).toEqual(['list_bases']);
  });

  it('Codex: startup_timeout_sec, a comment and an env sub-table key survive; one env, and a second Update is a no-op', async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    const script = JSON.stringify(deps.launcher.script);
    write(fileOf(row), `model = "o3"\n\n[mcp_servers.airtable-user-mcp]\ncommand = "node"\nargs = [${script}]\n# keep me\nstartup_timeout_sec = 60\ntools = [\n  "a",\n]\n\n[mcp_servers.airtable-user-mcp.env]\nAIRTABLE_HEADLESS_ONLY = "1"\nFOO = "bar"\n\n[mcp_servers.airtable-user-mcp.tool_timeouts]\nx = 5\n`);
    await configureMcpForIde('codex-cli', '/unused', ours(), deps);
    const text = fs.readFileSync(fileOf(row), 'utf8');
    expect(text).toContain('startup_timeout_sec = 60\n');
    expect(text).toContain('# keep me\n');
    expect(text).toContain('tools = [\n  "a",\n]\n');
    expect(text).toContain('[mcp_servers.airtable-user-mcp.tool_timeouts]\nx = 5\n');
    expect(text).not.toContain('[mcp_servers.airtable-user-mcp.env]');
    expect(text.match(/^env = /gm)).toHaveLength(1);
    expect(await readMcpTomlEntry(fileOf(row), 'mcp_servers', 'airtable-user-mcp')).toMatchObject({ env: { AIRTABLE_HEADLESS_ONLY: '1', FOO: 'bar' } });
    expect(await getMcpHealth('codex-cli', deps)).toEqual({ configured: true, healthy: true });
    await configureMcpForIde('codex-cli', '/unused', ours(), deps);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(text);
  });

  it("Codex: main's block loses its stale type and keeps a user's startup_timeout_sec", async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    write(fileOf(row), '[mcp_servers.airtable-user-mcp]\ntype = "stdio"\ncommand = "npx"\nargs = ["-y", "airtable-user-mcp"]\nstartup_timeout_sec = 60\n');
    expect(await reapplyMcpForIde('codex-cli', '/unused', ours(), deps)).toBe(true);
    const text = fs.readFileSync(fileOf(row), 'utf8');
    expect(text).not.toContain('type = ');
    expect(text).toContain('startup_timeout_sec = 60\n');
  });

  it('an entry we did not write is replaced by an explicit Setup, user keys and all', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { 'airtable-user-mcp': { command: 'npx', args: [], env: { X: '1' }, note: 'theirs' } } }));
    await configureMcpForIde('cursor', '/unused', ours(), deps);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers['airtable-user-mcp']).toEqual(ours());
  });
});

// Writers on one file run one at a time: two at once used to lose one entry, and on Windows the
// second rename could fail with EPERM.
describe('writes to one config file are serialized', () => {
  const ours = () => ({ command: 'node', args: [deps.launcher.script], env: { AIRTABLE_HEADLESS_ONLY: '1' } });
  const tmpLeft = (dir: string) => fs.readdirSync(dir).filter(n => n.endsWith('.tmp'));

  it('Cursor: our entry and the official entry configured at once both land, every time', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    for (let i = 0; i < 10; i++) {
      fs.rmSync(fileOf(row), { force: true });
      const results = await Promise.allSettled([
        configureMcpForIde('cursor', '/unused', ours(), deps),
        configureOfficialAirtableMcp('cursor', 'patX', deps),
      ]);
      expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(Object.keys(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers).sort()).toEqual(['airtable', 'airtable-user-mcp']);
    }
    expect(tmpLeft(path.dirname(fileOf(row)))).toEqual([]);
  });

  it('Cursor: Setup twice at once leaves one entry and no temp file', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    for (let i = 0; i < 10; i++) {
      fs.rmSync(fileOf(row), { force: true });
      const results = await Promise.allSettled([configureMcpForIde('cursor', '/unused', ours(), deps), configureMcpForIde('cursor', '/unused', ours(), deps)]);
      expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(fs.readFileSync(fileOf(row), 'utf8').match(/"airtable-user-mcp"/g)).toHaveLength(1);
    }
    expect(tmpLeft(path.dirname(fileOf(row)))).toEqual([]);
  });

  it("OpenCode: the MCP entry and the LSP entry written at once share the file", async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    for (let i = 0; i < 10; i++) {
      fs.rmSync(fileOf(row), { force: true });
      await Promise.all([configureMcpForIde('opencode', '/unused', ours(), deps), configureLspForIde('opencode')]);
      const doc = parse(fs.readFileSync(fileOf(row), 'utf8'));
      expect([!!doc.mcp?.['airtable-user-mcp'], !!doc.lsp?.['airtable-formula']]).toEqual([true, true]);
    }
  });
});

// ── Carried from the Task 6 review ──────────────────────────────────────────

describe('the official entry is written, read and removed on the eight official rows only', () => {
  it('the official rows are exactly the eight that had it before the port', () => {
    expect(MCP_CLIENTS.filter(r => r.official).map(r => r.id)).toEqual(OFFICIAL_IDS);
    expect(buildOfficialAirtableEntry(MCP_CLIENT_BY_ID['windsurf-next'], 'p')).toEqual({ serverUrl: OFFICIAL_URL, headers: { Authorization: 'Bearer p' } });
  });

  it.each(OFFICIAL_IDS)('%s: configure, read back, remove, and our local entry stays', async id => {
    const row = MCP_CLIENT_BY_ID[id];
    detect(row);
    await configureMcpForIde(id, '/unused', { command: 'node', args: [deps.launcher.script], env: {} }, deps);
    expect(await isOfficialAirtableConfigured(id, deps)).toBe(false);
    await configureOfficialAirtableMcp(id, 'patX', deps);
    expect(await isOfficialAirtableConfigured(id, deps)).toBe(true);
    expect((await readServerEntry(row, 'airtable', deps))?.entry).toEqual(buildOfficialAirtableEntry(row, 'patX'));
    await unconfigureOfficialAirtableMcp(id, deps);
    expect(await isOfficialAirtableConfigured(id, deps)).toBe(false);
    expect(await getMcpHealth(id, deps)).toEqual({ configured: true, healthy: true });
  });

  it.each(MCP_CLIENTS.filter(r => !r.official).map(r => r.id))(
    "%s: a user's own 'airtable' entry is never read, replaced or removed as the official one",
    async id => {
      const row = MCP_CLIENT_BY_ID[id];
      detect(row);
      await setServerEntry(row, 'airtable', () => ({ command: 'my-airtable', args: ['--mine'] }), deps);
      const before = fs.readFileSync(fileOf(row), 'utf8');
      expect(await isOfficialAirtableConfigured(id, deps)).toBe(false);
      await unconfigureOfficialAirtableMcp(id, deps);
      await expect(configureOfficialAirtableMcp(id, 'patX', deps)).rejects.toThrow(`${row.label} does not support the official Airtable server here.`);
      expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(before);
    },
  );

  it('Codex: a hand-written [mcp_servers.airtable] survives a Remove of the official entry byte for byte', async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    const text = '[mcp_servers.airtable]\r\nurl = "https://mcp.airtable.com/mcp"\r\nbearer_token_env_var = "AIRTABLE_PAT"\r\n';
    write(fileOf(row), text);
    await unconfigureOfficialAirtableMcp('codex-cli', deps);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(text);
  });

  // Only an 'airtable' entry pointing at the official URL is ours.
  it.each(['cursor', 'claude-code'] as const)("%s: a user's own 'airtable' server with another url is not ours: not configured, never removed", async id => {
    const row = MCP_CLIENT_BY_ID[id];
    detect(row);
    const mine = { type: 'http', url: 'https://example.test/my-airtable-proxy/mcp', headers: { Authorization: 'Bearer mine' } };
    write(fileOf(row), JSON.stringify({ mcpServers: { airtable: mine, other: { command: 'x' } } }, null, 2));
    const before = fs.readFileSync(fileOf(row), 'utf8');
    expect(await isOfficialAirtableConfigured(id, deps)).toBe(false);
    await unconfigureOfficialAirtableMcp(id, deps);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(before);
  });

  it("Cursor: Configure refuses to replace a user's own 'airtable' server and writes nothing; our stale copy is still replaced", async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { airtable: { type: 'http', url: 'https://example.test/mcp' }, other: { command: 'x' } } }, null, 2));
    const before = fs.readFileSync(fileOf(row), 'utf8');
    await expect(configureOfficialAirtableMcp('cursor', 'patX', deps))
      .rejects.toThrow('Cursor already has an "airtable" MCP server that is not Airtable\'s official one; rename it first');
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe(before);
    write(fileOf(row), JSON.stringify({ mcpServers: { airtable: { url: OFFICIAL_URL } } }));
    await configureOfficialAirtableMcp('cursor', 'patX', deps);
    expect(parse(fs.readFileSync(fileOf(row), 'utf8')).mcpServers.airtable).toEqual(buildOfficialAirtableEntry(row, 'patX'));
  });

  it('helix and neovim: no official entry to read or remove, and configuring it is refused', async () => {
    for (const id of ['helix', 'neovim'] as const) {
      expect(await isOfficialAirtableConfigured(id, deps)).toBe(false);
      await expect(unconfigureOfficialAirtableMcp(id, deps)).resolves.toBeUndefined();
      await expect(configureOfficialAirtableMcp(id, 'patX', deps)).rejects.toThrow(`${IDE_CONFIGS[id].label} does not support the official Airtable server here.`);
    }
  });
});

// Added beyond the brief: OpenCode's LSP entry now goes through the comment-preserving editor,
// into whichever file the MCP writer resolves.
describe("OpenCode's LSP entry shares the MCP entry's file", () => {
  const LSP = { command: ['npx', '-y', 'airtable-user-lsp', '--stdio'], extensions: ['.formula', '.ats', '.ata'] };

  it('opencode.jsonc: set up, read, remove; comments and our MCP entry stay', async () => {
    expect(os.homedir()).toBe(home);
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    write(file, '{\n  // mine\n  "theme": "x",\n}\n');
    await configureMcpForIde('opencode', '/unused', { command: 'node', args: [deps.launcher.script], env: {} }, deps);
    await configureLspForIde('opencode');
    expect(await isLspConfigured('opencode')).toBe(true);
    expect((await getIdeStatus('opencode', deps)).lspConfigured).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('// mine');
    expect(parse(fs.readFileSync(file, 'utf8')).lsp).toEqual({ 'airtable-formula': LSP });
    await unconfigureLspForIde('opencode');
    expect(await isLspConfigured('opencode')).toBe(false);
    const after = parse(fs.readFileSync(file, 'utf8'));
    expect(after.lsp).toBeUndefined();
    expect(after.theme).toBe('x');
    expect(await getMcpHealth('opencode', deps)).toEqual({ configured: true, healthy: true });
  });

  it("a pre-port opencode.json keeps getting the entry while it is the file OpenCode's MCP entry uses", async () => {
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    write(file, JSON.stringify({ lsp: { other: { command: ['x'] } } }, null, 2));
    await configureLspForIde('opencode');
    expect(parse(fs.readFileSync(file, 'utf8')).lsp).toEqual({ other: { command: ['x'] }, 'airtable-formula': LSP });
    expect(fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'))).toBe(false);
    await unconfigureLspForIde('opencode');
    expect(parse(fs.readFileSync(file, 'utf8'))).toEqual({ lsp: { other: { command: ['x'] } } });
  });

  it('with both opencode.json and opencode.jsonc, the LSP entry lives only in the current one', async () => {
    const dir = path.join(home, '.config', 'opencode');
    const json = path.join(dir, 'opencode.json');
    const jsonc = path.join(dir, 'opencode.jsonc');
    const prePort = { lsp: { 'airtable-formula': LSP, other: { command: ['x'] } }, theme: 'x' };
    write(json, JSON.stringify(prePort, null, 2) + '\n');
    write(jsonc, '{\n  // mine\n}\n');
    expect(await isLspConfigured('opencode')).toBe(false);
    await configureLspForIde('opencode');
    expect(parse(fs.readFileSync(json, 'utf8'))).toEqual({ lsp: { other: { command: ['x'] } }, theme: 'x' });
    expect(parse(fs.readFileSync(jsonc, 'utf8')).lsp).toEqual({ 'airtable-formula': LSP });
    expect(fs.readFileSync(jsonc, 'utf8')).toContain('// mine');
    expect(await isLspConfigured('opencode')).toBe(true);
    write(json, JSON.stringify(prePort, null, 2) + '\n');
    await unconfigureLspForIde('opencode');
    expect(parse(fs.readFileSync(json, 'utf8'))).toEqual({ lsp: { other: { command: ['x'] } }, theme: 'x' });
    expect(parse(fs.readFileSync(jsonc, 'utf8')).lsp).toBeUndefined();
  });

  it('a broken opencode.json beside opencode.jsonc aborts the LSP Setup with both files untouched', async () => {
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), '{ "lsp": ');
    write(path.join(dir, 'opencode.jsonc'), '{}\n');
    await expect(configureLspForIde('opencode')).rejects.toThrow(/opencode\.json is not valid JSON/);
    expect(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8')).toBe('{}\n');
  });

  it('a file that does not parse is left alone, and Remove creates no file', async () => {
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    await unconfigureLspForIde('opencode');
    expect(fs.existsSync(path.join(home, '.config', 'opencode'))).toBe(false);
    write(file, '{ "lsp": ');
    await expect(configureLspForIde('opencode')).rejects.toThrow(/is not valid JSON/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "lsp": ');
    expect(await isLspConfigured('opencode')).toBe(false);
  });
});

// OpenCode knows `local` and `remote` servers only; add-mcp's transformOpenCodeConfig remote branch.
describe("OpenCode's official entry is a remote server", () => {
  const AUTH = { Authorization: 'Bearer patX' };
  const dir = () => path.join(home, '.config', 'opencode');

  it('a V1 file gets type remote with enabled; a V2-only file gets it under mcp.servers without enabled', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    expect(buildOfficialAirtableEntry(row, 'patX')).toEqual({ type: 'remote', url: OFFICIAL_URL, headers: AUTH, enabled: true });
    expect(buildOfficialAirtableEntry(row, 'patX', { native: true })).toEqual({ type: 'remote', url: OFFICIAL_URL, headers: AUTH });
    detect(row);
    await configureOfficialAirtableMcp('opencode', 'patX', deps);
    const v1 = path.join(dir(), 'opencode.jsonc');
    expect(parse(fs.readFileSync(v1, 'utf8')).mcp.airtable).toEqual({ type: 'remote', url: OFFICIAL_URL, headers: AUTH, enabled: true });
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(true);
    write(v1, JSON.stringify({ mcp: { servers: { other: { type: 'local', command: ['x'] } } } }));
    await configureOfficialAirtableMcp('opencode', 'patX', deps);
    expect(parse(fs.readFileSync(v1, 'utf8')).mcp.servers.airtable).toEqual({ type: 'remote', url: OFFICIAL_URL, headers: AUTH });
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(true);
  });

  it("today's type http copy is a stale official entry: not configured, replaced on Configure, removed by Remove", async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(dir(), 'opencode.json');
    write(file, JSON.stringify({ mcp: { airtable: { type: 'http', url: OFFICIAL_URL, headers: { Authorization: 'Bearer patOLD' } } } }, null, 2));
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(false);
    await configureOfficialAirtableMcp('opencode', 'patX', deps);
    expect(parse(fs.readFileSync(file, 'utf8')).mcp).toEqual({ airtable: { type: 'remote', url: OFFICIAL_URL, headers: AUTH, enabled: true } });
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(true);
    write(file, JSON.stringify({ mcp: { airtable: { type: 'http', url: OFFICIAL_URL, headers: AUTH }, servers: { airtable: { type: 'remote', url: OFFICIAL_URL, headers: AUTH } } } }));
    await unconfigureOfficialAirtableMcp('opencode', deps);
    expect(parse(fs.readFileSync(file, 'utf8'))).toEqual({ mcp: { servers: {} } });
  });
});

describe('a reconfigure clears the copies in old places too', () => {
  it('Amp: configuring the official entry moves the pre-port mcp.servers.airtable, and its old token, out', async () => {
    const amp = MCP_CLIENT_BY_ID.amp;
    detect(amp);
    const file = path.join(home, '.config', 'amp', 'settings.json');
    const old = { type: 'http', url: OFFICIAL_URL, headers: { Authorization: 'Bearer patOLD' } };
    write(file, JSON.stringify({ mcp: { servers: { airtable: old } }, 'amp.dangerouslyAllowAll': false }, null, 2));
    // Amp never reads mcp.servers, so the copy is not a working setup: Configure is offered.
    expect(await isOfficialAirtableConfigured('amp', deps)).toBe(false);
    await configureOfficialAirtableMcp('amp', 'patNEW', deps);
    expect(await isOfficialAirtableConfigured('amp', deps)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('patOLD');
    expect(parse(text)).toEqual({
      'amp.dangerouslyAllowAll': false,
      'amp.mcpServers': { airtable: { type: 'http', url: OFFICIAL_URL, headers: { Authorization: 'Bearer patNEW' } } },
    });
  });

  it('Amp: an old-place airtable entry that points elsewhere is not ours, so Configure leaves it', async () => {
    const amp = MCP_CLIENT_BY_ID.amp;
    detect(amp);
    const file = path.join(home, '.config', 'amp', 'settings.json');
    const mine = { url: 'https://example.test/mcp' };
    write(file, JSON.stringify({ mcp: { servers: { airtable: mine } } }, null, 2));
    await configureOfficialAirtableMcp('amp', 'patX', deps);
    expect(parse(fs.readFileSync(file, 'utf8')).mcp).toEqual({ servers: { airtable: mine } });
    expect(await isOfficialAirtableConfigured('amp', deps)).toBe(true);
  });

  it('OpenCode: the official entry only in opencode.json while opencode.jsonc exists is not configured, and Configure consolidates it', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { airtable: buildOfficialAirtableEntry(row, 'patOLD') }, theme: 'x' }));
    write(path.join(dir, 'opencode.jsonc'), '{\n  // mine\n}\n');
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(false);
    await configureOfficialAirtableMcp('opencode', 'patNEW', deps);
    expect(await isOfficialAirtableConfigured('opencode', deps)).toBe(true);
    expect(parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'))).toEqual({ theme: 'x' });
    expect(parse(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8')).mcp.airtable).toEqual(buildOfficialAirtableEntry(row, 'patNEW'));
  });

  it('Amp: Setup of our local entry moves the pre-port copy and keeps a user server beside it', async () => {
    const amp = MCP_CLIENT_BY_ID.amp;
    detect(amp);
    const file = path.join(home, '.config', 'amp', 'settings.json');
    write(file, JSON.stringify({ mcp: { servers: { 'airtable-user-mcp': { command: 'node', args: ['/old/index.mjs'], env: { AIRTABLE_HEADLESS_ONLY: '1' } }, other: { command: 'x' } } } }, null, 2));
    await configureMcpForIde('amp', '/unused', { command: 'node', args: [deps.launcher.script], env: {} }, deps);
    expect(parse(fs.readFileSync(file, 'utf8'))).toEqual({
      mcp: { servers: { other: { command: 'x' } } },
      'amp.mcpServers': { 'airtable-user-mcp': { command: 'node', args: [deps.launcher.script] } },
    });
  });
});
