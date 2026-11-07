import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'jsonc-parser';
import { MCP_CLIENTS, MCP_CLIENT_BY_ID, resolveConfigPath, type McpClientRow } from '../auto-config/mcp-clients.js';
import { ENTRY_SHAPES, type LocalLaunch } from '../auto-config/mcp-entry-shapes.js';
import { readMcpTomlEntry } from '../auto-config/lsp-config.js';
import {
  MCP_SERVER_NAME, configureMcpClient, isClientDetected, isOurEntry, legacyLocations, readMcpClientHealth, readServerEntry,
  setServerEntry, unconfigureMcpClient, type WriterDeps,
} from '../auto-config/mcp-writer.js';

let home: string;
let deps: WriterDeps;
let launch: LocalLaunch;
/** Both env marks our writers always set: the headless flag and our browser profile dir. */
let ourEnv: () => Record<string, string>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-mcp-'));
  const script = path.join(home, '.airtable-user-mcp', 'start.mjs');
  const config = path.join(home, '.airtable-user-mcp', 'bundled-path.json');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '');
  fs.writeFileSync(config, '{}');
  deps = {
    ctx: { platform: process.platform, home, env: { APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') } },
    exists: fs.existsSync,
    launcher: { script, config },
  };
  launch = { command: 'node', args: [script], env: { AIRTABLE_HEADLESS_ONLY: '1' } };
  ourEnv = () => ({ AIRTABLE_HEADLESS_ONLY: '1', AIRTABLE_PROFILE_DIR: path.join(home, '.airtable-user-mcp', '.chrome-profile') });
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const fileOf = (row: McpClientRow) => resolveConfigPath(row, deps.ctx, deps.exists);
const detect = (row: McpClientRow) => fs.mkdirSync(row.detect(deps.ctx)[0], { recursive: true });
const write = (p: string, text: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const json = (p: string) => parse(fs.readFileSync(p, 'utf8'));
const ROWS = MCP_CLIENTS.map(r => [r.id, r] as const);

describe('every row', () => {
  it.each(ROWS)('%s: set up, read back healthy, update, remove', async (_id, row) => {
    detect(row);
    await configureMcpClient(row, launch, deps);
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: true });
    await configureMcpClient(row, launch, deps);
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: true });
    await unconfigureMcpClient(row, deps);
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: false, healthy: false });
  });

  it.each(ROWS)('%s: an undetected client gets no file', async (_id, row) => {
    // Hermetic: only the temp home exists, so a real /Applications/Cursor.app cannot detect Cursor.
    const tempOnly: WriterDeps = { ...deps, exists: (p) => p.startsWith(home) && fs.existsSync(p) };
    await expect(configureMcpClient(row, launch, tempOnly)).rejects.toThrow(`${row.label} was not found on this machine; nothing was written.`);
    expect(fs.existsSync(fileOf(row))).toBe(false);
  });
});

describe('JSON rows', () => {
  it("writes the row's shape under its servers path", async () => {
    const row = MCP_CLIENT_BY_ID['kimi-code'];
    detect(row);
    await configureMcpClient(row, launch, deps);
    expect(json(fileOf(row)).mcpServers[MCP_SERVER_NAME]).toEqual(ENTRY_SHAPES.kimi(launch));
  });

  it("keeps the comments in Zed's settings", async () => {
    const row = MCP_CLIENT_BY_ID.zed;
    detect(row);
    write(fileOf(row), '// my settings\n{\n  "theme": "One Dark", // dark\n}\n');
    await configureMcpClient(row, launch, deps);
    const text = fs.readFileSync(fileOf(row), 'utf8');
    expect(text).toContain('// my settings');
    expect(text).toContain('// dark');
    expect(parse(text).context_servers[MCP_SERVER_NAME]).toEqual(ENTRY_SHAPES.zed(launch));
  });

  it('an unparsable file aborts and stays byte for byte', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), '{ "mcpServers": { ');
    await expect(configureMcpClient(row, launch, deps)).rejects.toThrow(/is not valid JSON/);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe('{ "mcpServers": { ');
  });

  // Added beyond the brief.
  it('an unparsable file is not configured, so it is never auto-healed, and Remove leaves it alone too', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), '{ "mcpServers": { ');
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: false, healthy: false });
    await expect(unconfigureMcpClient(row, deps)).rejects.toThrow(/is not valid JSON/);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe('{ "mcpServers": { ');
  });

  it('a file with a UTF-8 BOM is edited and keeps its BOM', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), '\uFEFF{\n  "mcpServers": {\n    "other": { "command": "x" }\n  }\n}\n');
    await configureMcpClient(row, launch, deps);
    const text = fs.readFileSync(fileOf(row), 'utf8');
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(parse(text.slice(1)).mcpServers).toEqual({ other: { command: 'x' }, [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) });
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: true });
  });

  it('a no-op Update leaves the file alone (JSON and TOML)', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    for (const row of [MCP_CLIENT_BY_ID.cursor, MCP_CLIENT_BY_ID['codex-cli']]) {
      detect(row);
      await configureMcpClient(row, launch, deps);
      fs.utimesSync(fileOf(row), past, past);
      await configureMcpClient(row, launch, deps);
      expect(fs.statSync(fileOf(row)).mtime.getTime(), row.id).toBe(past.getTime());
    }
  });

  it("Update replaces our entry and keeps the user's other servers and the official one", async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcpServers: { airtable: { url: 'u' }, [MCP_SERVER_NAME]: { command: 'node', args: ['/old/index.mjs'] }, x: { command: 'x' } } }, null, 2));
    await configureMcpClient(row, launch, deps);
    expect(json(fileOf(row)).mcpServers).toEqual({ airtable: { url: 'u' }, [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch), x: { command: 'x' } });
    await unconfigureMcpClient(row, deps);
    expect(json(fileOf(row))).toEqual({ mcpServers: { airtable: { url: 'u' }, x: { command: 'x' } } });
  });

  it('Remove leaves an emptied servers object in the current file, and creates no file', async () => {
    const row = MCP_CLIENT_BY_ID.cursor;
    await unconfigureMcpClient(row, deps);
    expect(fs.existsSync(fileOf(row))).toBe(false);
    detect(row);
    await configureMcpClient(row, launch, deps);
    await unconfigureMcpClient(row, deps);
    expect(json(fileOf(row))).toEqual({ mcpServers: {} });
  });
});

describe('setServerEntry and readServerEntry under another name', () => {
  it('writes, finds and removes the official entry without touching ours', async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    await configureMcpClient(row, launch, deps);
    await setServerEntry(row, 'airtable', () => ({ type: 'http', url: 'https://mcp.airtable.com/mcp' }), deps);
    expect(await readServerEntry(row, 'airtable', deps)).toEqual({ entry: { type: 'http', url: 'https://mcp.airtable.com/mcp' }, legacy: false, native: false, readByClient: true });
    await setServerEntry(row, 'airtable', null, deps);
    expect(await readServerEntry(row, 'airtable', deps)).toBeNull();
    expect(json(fileOf(row))).toEqual({ 'amp.mcpServers': { [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } });
  });

  it("removal also clears a legacy copy (Amp's pre-port mcp.servers.airtable) and keeps ours", async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcp: { servers: { airtable: { url: 'u' } } }, 'amp.mcpServers': { airtable: { url: 'u' }, [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } }));
    expect((await readServerEntry(row, 'airtable', deps))?.legacy).toBe(false);
    await setServerEntry(row, 'airtable', null, deps);
    expect(await readServerEntry(row, 'airtable', deps)).toBeNull();
    expect(json(fileOf(row))).toEqual({ 'amp.mcpServers': { [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } });
  });

  it("a write also clears a legacy copy: Amp's pre-port mcp.servers.airtable and its old token go", async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcp: { servers: { airtable: { url: 'u', headers: { Authorization: 'Bearer patOLD' } } } }, theme: 't' }));
    await setServerEntry(row, 'airtable', () => ({ type: 'http', url: 'u', headers: { Authorization: 'Bearer patNEW' } }), deps);
    expect(json(fileOf(row))).toEqual({ theme: 't', 'amp.mcpServers': { airtable: { type: 'http', url: 'u', headers: { Authorization: 'Bearer patNEW' } } } });
    expect(await readServerEntry(row, 'airtable', deps)).toMatchObject({ legacy: false });
  });

  it('a write parses every legacy file first: a broken one aborts with the current file untouched', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), '{ "mcp": ');
    write(path.join(dir, 'opencode.jsonc'), '{}\n');
    await expect(setServerEntry(row, 'airtable', () => ({ type: 'remote', url: 'u' }), deps)).rejects.toThrow(/opencode\.json is not valid JSON/);
    expect(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8')).toBe('{}\n');
  });

  it('refuses an undetected client with nothing written', async () => {
    const row = MCP_CLIENT_BY_ID.windsurf;
    expect(isClientDetected(row, deps)).toBe(false);
    await expect(setServerEntry(row, 'airtable', () => ({ serverUrl: 'u' }), deps))
      .rejects.toThrow('Devin Desktop (Windsurf) was not found on this machine; nothing was written.');
    expect(fs.existsSync(fileOf(row))).toBe(false);
    detect(row);
    expect(isClientDetected(row, deps)).toBe(true);
  });
});

describe('entries in old places', () => {
  it('Amp: the nested mcp.servers entry reads unhealthy, moves to amp.mcpServers, and the emptied nest is pruned', async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcp: { servers: { [MCP_SERVER_NAME]: { command: 'node', args: [deps.launcher.script] } } }, 'amp.dangerouslyAllowAll': false }, null, 2));
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: false });
    await configureMcpClient(row, launch, deps);
    expect(json(fileOf(row))).toEqual({ 'amp.dangerouslyAllowAll': false, 'amp.mcpServers': { [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } });
  });

  it('Amp: Remove clears both the current and the old key', async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcp: { servers: { [MCP_SERVER_NAME]: {}, other: { command: 'x' } } }, 'amp.mcpServers': { [MCP_SERVER_NAME]: {} } }));
    await unconfigureMcpClient(row, deps);
    expect(json(fileOf(row))).toEqual({ mcp: { servers: { other: { command: 'x' } } }, 'amp.mcpServers': {} });
  });

  // Added beyond the brief: pruning follows our removal, never the user's own empty objects.
  it("Amp: an empty nest that never held our entry is the user's and stays", async () => {
    const row = MCP_CLIENT_BY_ID.amp;
    detect(row);
    write(fileOf(row), JSON.stringify({ mcp: { servers: {} } }));
    await configureMcpClient(row, launch, deps);
    expect(json(fileOf(row))).toEqual({ mcp: { servers: {} }, 'amp.mcpServers': { [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } });
  });

  it('OpenCode: our old command-string entry reads unhealthy and is rewritten in place (V1 file)', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    write(file, JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [MCP_SERVER_NAME]: { type: 'local', command: 'node', args: [deps.launcher.script], env: launch.env } } }, null, 2));
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: false });
    await configureMcpClient(row, launch, deps);
    expect(json(file).mcp[MCP_SERVER_NAME]).toEqual({ type: 'local', command: ['node', deps.launcher.script], environment: launch.env, enabled: true });
    expect(fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'))).toBe(false);
  });

  it('OpenCode: with both files present, writes opencode.jsonc and removes ours from opencode.json', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { [MCP_SERVER_NAME]: { type: 'local', command: ['node', deps.launcher.script] } }, theme: 'x' }));
    write(path.join(dir, 'opencode.jsonc'), '{\n  // mine\n}\n');
    await configureMcpClient(row, launch, deps);
    expect(json(path.join(dir, 'opencode.json'))).toEqual({ theme: 'x' });
    expect(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8')).toContain('// mine');
    expect(json(path.join(dir, 'opencode.jsonc')).mcp[MCP_SERVER_NAME]).toEqual(ENTRY_SHAPES.opencode(launch));
  });

  it('OpenCode: a V2-only file gets the native entry, without enabled', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    write(file, JSON.stringify({ mcp: { servers: { other: { type: 'local', command: ['x'] } } } }));
    await configureMcpClient(row, launch, deps);
    expect(json(file).mcp.servers[MCP_SERVER_NAME]).toEqual(ENTRY_SHAPES.opencode(launch, { native: true }));
    expect(json(file).mcp[MCP_SERVER_NAME]).toBeUndefined();
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: true });
  });

  // Added beyond the brief.
  it('OpenCode: our entry only in opencode.json while opencode.jsonc exists reads as configured but unhealthy', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { [MCP_SERVER_NAME]: ENTRY_SHAPES.opencode(launch) } }));
    write(path.join(dir, 'opencode.jsonc'), '{}\n');
    // OpenCode merges its two files, so the copy in opencode.json is one the client reads.
    expect(await readServerEntry(row, MCP_SERVER_NAME, deps)).toEqual({ entry: ENTRY_SHAPES.opencode(launch), legacy: true, native: false, readByClient: true });
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: false });
  });

  it('OpenCode: Update drops a stray V1 copy beside the native entry', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    const old = { type: 'local', command: ['old'], environment: ourEnv() };
    write(file, JSON.stringify({ mcp: { [MCP_SERVER_NAME]: old, servers: { [MCP_SERVER_NAME]: old } } }));
    await configureMcpClient(row, launch, deps);
    expect(json(file)).toEqual({ mcp: { servers: { [MCP_SERVER_NAME]: ENTRY_SHAPES.opencode(launch, { native: true }) } } });
  });

  it('OpenCode: Remove clears both layouts in the current file and every copy in the other file', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    const ours = ENTRY_SHAPES.opencode(launch);
    write(path.join(dir, 'opencode.jsonc'), JSON.stringify({ mcp: { [MCP_SERVER_NAME]: ours, servers: { [MCP_SERVER_NAME]: ours, other: { type: 'local', command: ['x'] } } } }));
    write(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { servers: { [MCP_SERVER_NAME]: ours } }, theme: 'x' }));
    await unconfigureMcpClient(row, deps);
    expect(json(path.join(dir, 'opencode.jsonc'))).toEqual({ mcp: { servers: { other: { type: 'local', command: ['x'] } } } });
    expect(json(path.join(dir, 'opencode.json'))).toEqual({ theme: 'x' });
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: false, healthy: false });
  });

  it('OpenCode: a broken opencode.json aborts the Update with both files untouched', async () => {
    const row = MCP_CLIENT_BY_ID.opencode;
    detect(row);
    const dir = path.join(home, '.config', 'opencode');
    write(path.join(dir, 'opencode.json'), '{ "mcp": ');
    write(path.join(dir, 'opencode.jsonc'), '{}\n');
    await expect(configureMcpClient(row, launch, deps)).rejects.toThrow(/opencode\.json is not valid JSON/);
    expect(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8')).toBe('{ "mcp": ');
    expect(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8')).toBe('{}\n');
  });

  it('Kilo Code: once kilo.jsonc exists, ours moves out of kilo.json', async () => {
    const row = MCP_CLIENT_BY_ID['kilo-code'];
    detect(row);
    const dir = row.detect(deps.ctx)[0];
    write(path.join(dir, 'kilo.json'), JSON.stringify({ mcp: { [MCP_SERVER_NAME]: ENTRY_SHAPES.opencode(launch) }, model: 'm' }));
    write(path.join(dir, 'kilo.jsonc'), '{}\n');
    expect(await readMcpClientHealth(row, deps)).toEqual({ configured: true, healthy: false });
    await configureMcpClient(row, launch, deps);
    expect(json(path.join(dir, 'kilo.json'))).toEqual({ model: 'm' });
    expect(json(path.join(dir, 'kilo.jsonc')).mcp[MCP_SERVER_NAME]).toEqual(ENTRY_SHAPES.opencode(launch));
  });

  it('Codex: an entry under the old ~/.codex while CODEX_HOME is set reads unhealthy and moves', async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    const old = path.join(home, '.codex', 'config.toml');
    write(old, `[mcp_servers.airtable-user-mcp]\ncommand = "npx"\nargs = ["-y", "airtable-user-mcp"]\n\n[mcp_servers.airtable-user-mcp.env]\nAIRTABLE_HEADLESS_ONLY = "1"\nAIRTABLE_PROFILE_DIR = ${JSON.stringify(ourEnv().AIRTABLE_PROFILE_DIR)}\n\n[model_providers.x]\nname = "x"\n`);
    const moved: WriterDeps = { ...deps, ctx: { ...deps.ctx, env: { ...deps.ctx.env, CODEX_HOME: path.join(home, 'elsewhere') } } };
    expect(await readMcpClientHealth(row, moved)).toEqual({ configured: true, healthy: false });
    await configureMcpClient(row, launch, moved);
    expect(fs.readFileSync(old, 'utf8')).toBe('[model_providers.x]\nname = "x"\n');
    expect(await readMcpTomlEntry(path.join(home, 'elsewhere', 'config.toml'), 'mcp_servers', MCP_SERVER_NAME))
      .toMatchObject({ command: 'node', args: [deps.launcher.script] });
    expect(await readMcpClientHealth(row, moved)).toEqual({ configured: true, healthy: true });
  });

  it('Codex: Remove clears our table and its sub-tables, and keeps CRLF', async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    write(fileOf(row), '[mcp_servers.other]\r\ncommand = "x"\r\n\r\n[mcp_servers.airtable-user-mcp]\r\ncommand = "node"\r\n\r\n[mcp_servers.airtable-user-mcp.env]\r\nA = "1"\r\n');
    await unconfigureMcpClient(row, deps);
    expect(fs.readFileSync(fileOf(row), 'utf8')).toBe('[mcp_servers.other]\r\ncommand = "x"\r\n');
  });
});

describe('legacy cleanup boundaries', () => {
  it("never touches a file that is another row's current file", async () => {
    const gemini = MCP_CLIENT_BY_ID['gemini-cli'];
    const owned = fileOf(gemini);
    write(owned, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: 'npx' } } }));
    const row: McpClientRow = { ...MCP_CLIENT_BY_ID.cursor, legacy: () => [{ path: owned, serversPath: ['mcpServers'] }] };
    detect(row);
    await configureMcpClient(row, launch, deps);
    expect(json(owned).mcpServers[MCP_SERVER_NAME]).toEqual({ command: 'npx' });
  });

  it('never creates a missing legacy file', async () => {
    const row = MCP_CLIENT_BY_ID['codex-cli'];
    detect(row);
    const codexHome = path.join(home, 'elsewhere');
    const moved: WriterDeps = { ...deps, ctx: { ...deps.ctx, env: { ...deps.ctx.env, CODEX_HOME: codexHome } } };
    fs.mkdirSync(codexHome, { recursive: true });
    await configureMcpClient(row, launch, moved);
    expect(fs.existsSync(path.join(codexHome, 'config.toml'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.codex', 'config.toml'))).toBe(false);
  });

  // The legacy path and the current path can name one file (a case-insensitive APFS volume,
  // a symlink): when both exist, the same dev+ino is the same file, whatever samePath says.
  describe('one file under two names', () => {
    let OURS = '';
    const setup = () => {
      OURS = `[mcp_servers.airtable-user-mcp]\ncommand = "npx"\nenv = { AIRTABLE_HEADLESS_ONLY = "1", AIRTABLE_PROFILE_DIR = ${JSON.stringify(ourEnv().AIRTABLE_PROFILE_DIR)} }\n`;
      const row = MCP_CLIENT_BY_ID['codex-cli'];
      detect(row);
      const legacyFile = path.join(home, '.codex', 'config.toml');
      const currentFile = path.join(home, 'elsewhere', 'config.toml');
      write(legacyFile, OURS);
      write(currentFile, '');
      const ctx = { ...deps.ctx, env: { ...deps.ctx.env, CODEX_HOME: path.join(home, 'elsewhere') } };
      return { row, legacyFile, currentFile, ctx };
    };

    it('same dev and ino: the legacy location is the current one and is not cleaned', async () => {
      const { row, legacyFile, currentFile, ctx } = setup();
      const named = new Set([legacyFile, currentFile]);
      const stat = (p: string) => (named.has(p) ? { dev: 3, ino: 42 } : fs.statSync(p, { bigint: true }));
      const same: WriterDeps = { ...deps, ctx, stat };
      expect(legacyLocations(row, same)).toEqual([]);
      await configureMcpClient(row, launch, same);
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe(OURS);
      expect(await readMcpTomlEntry(currentFile, 'mcp_servers', MCP_SERVER_NAME)).not.toBeNull();
    });

    it('different files: the legacy location is cleaned', async () => {
      const { row, legacyFile, ctx } = setup();
      const real: WriterDeps = { ...deps, ctx };
      expect(legacyLocations(row, real)).toEqual([{ path: legacyFile, serversPath: ['mcp_servers'] }]);
      await configureMcpClient(row, launch, real);
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe('');
    });

    // Fail safe: when identity cannot be proven different, the file might be the current one, so
    // nothing is cleaned there. A missed cleanup leaves a copy the next Setup can move; a wrong
    // one deletes the entry the client reads.
    it('an inode of 0 (FAT, some network shares) proves nothing, so the location is skipped', async () => {
      const { row, legacyFile, ctx } = setup();
      const zero: WriterDeps = { ...deps, ctx, stat: () => ({ dev: 0, ino: 0 }) };
      expect(legacyLocations(row, zero)).toEqual([]);
      await configureMcpClient(row, launch, zero);
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe(OURS);
    });

    it('a failed stat proves nothing either, so the location is skipped', async () => {
      const { row, legacyFile, ctx } = setup();
      const failing: WriterDeps = { ...deps, ctx, stat: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } };
      expect(legacyLocations(row, failing)).toEqual([]);
      await configureMcpClient(row, launch, failing);
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe(OURS);
    });
  });
});

describe('health', () => {
  const row = () => MCP_CLIENT_BY_ID.cursor;
  const seed = (entry: unknown) => { detect(row()); write(fileOf(row()), JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } })); };

  it('npx is healthy', async () => {
    seed({ command: 'npx', args: ['-y', 'airtable-user-mcp'], env: { A: '1' } });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
  });
  it('the launcher is healthy only while start.mjs and bundled-path.json exist', async () => {
    seed(ENTRY_SHAPES.standard(launch));
    fs.rmSync(deps.launcher.config);
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: false });
  });
  it('a missing absolute server path is unhealthy (an older extension wrote one)', async () => {
    seed({ command: 'node', args: [path.join(home, 'gone', 'index.mjs')], env: ourEnv() });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: false });
  });
  it('a remote entry under our name is not ours to judge', async () => {
    seed({ url: 'https://example.test/mcp' });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
  });

  // Added beyond the brief.
  it('an existing absolute server path is healthy, and no args is healthy', async () => {
    const env = ourEnv();
    seed({ command: 'node', args: [deps.launcher.config], env });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
    seed({ command: 'my-airtable-wrapper', args: [], env });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
    seed({ command: 'my-airtable-wrapper', env }); // the standard shape always writes args
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: false });
  });

  it('an entry we did not write is not ours to judge: healthy, whatever its shape or target', async () => {
    seed({ command: 'node', args: [path.join(home, 'gone', 'index.mjs')], env: { A: '1' } });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
    seed({ command: 'my-airtable-wrapper' });
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: true, healthy: true });
  });

  it("isOurEntry: our env mark, the launcher, or main's exact Codex block; nothing else", () => {
    expect(isOurEntry({ command: 'npx', env: ourEnv() }, deps)).toBe(true);
    expect(isOurEntry({ type: 'local', command: ['npx'], environment: ourEnv() }, deps)).toBe(true);
    // The headless flag alone, or with another profile dir, is something a user can write too.
    expect(isOurEntry({ command: 'npx', env: { AIRTABLE_HEADLESS_ONLY: '1' } }, deps)).toBe(false);
    expect(isOurEntry({ command: 'npx', env: { AIRTABLE_HEADLESS_ONLY: '1', AIRTABLE_PROFILE_DIR: path.join(home, 'my-profile') } }, deps)).toBe(false);
    // Main's Codex block: an env of the user's own keeps it ours; one of our managed keys makes it theirs.
    const main = { type: 'stdio', command: 'npx', args: ['-y', 'airtable-user-mcp'] };
    expect(isOurEntry({ ...main, env: { MINE: 'x' } }, deps)).toBe(true);
    expect(isOurEntry({ ...main, env: { AIRTABLE_AUTH_MODE: 'byo' } }, deps)).toBe(false);
    expect(isOurEntry({ command: 'node', args: [deps.launcher.script] }, deps)).toBe(true);
    expect(isOurEntry({ type: 'local', command: ['node', deps.launcher.script] }, deps)).toBe(true);
    expect(isOurEntry({ type: 'stdio', command: 'npx', args: ['-y', 'airtable-user-mcp'] }, deps)).toBe(true);
    expect(isOurEntry({ command: 'npx', args: ['-y', 'airtable-user-mcp'], env: { AIRTABLE_AUTH_MODE: 'byo' } }, deps)).toBe(false);
    expect(isOurEntry({ command: 'npx', env: { AIRTABLE_HEADLESS_ONLY: 1 } }, deps)).toBe(false);
  });
  it('an entry in a stale shape is unhealthy (Kimi without its transport key)', async () => {
    const kimi = MCP_CLIENT_BY_ID['kimi-code'];
    detect(kimi);
    write(fileOf(kimi), JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: ENTRY_SHAPES.standard(launch) } }));
    expect(await readMcpClientHealth(kimi, deps)).toEqual({ configured: true, healthy: false });
  });
  it('a non-object under our name is not an entry', async () => {
    seed('node');
    expect(await readMcpClientHealth(row(), deps)).toEqual({ configured: false, healthy: false });
  });
});
