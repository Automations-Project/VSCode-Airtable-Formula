import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  configureHelix,
  configureMcpToml,
  unconfigureHelix,
  unconfigureMcpToml,
  readMcpTomlEntry,
  renderTomlServer,
} from '../auto-config/lsp-config.js';

const K = 'mcp_servers';
const N = 'airtable-user-mcp';
const E = { type: 'stdio', command: 'npx', args: ['-y', 'airtable-user-mcp'] };

let dir: string;
let cfg: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-toml-'));
  cfg = path.join(dir, 'config.toml');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('unconfigureMcpToml preserves user config', () => {
  // The bug: unconfigure did `existing.slice(0, indexOf(MARKER))`, truncating the
  // file from our marker to EOF. Both configureMcpToml and `codex mcp add`
  // append at EOF, so anything the user added after Setup sat below ours.
  it('keeps a second MCP server added BELOW our block', async () => {
    await configureMcpToml(cfg, K, N, E);
    fs.appendFileSync(
      cfg,
      '\n[mcp_servers.some-other-server]\ntype = "stdio"\ncommand = "other"\nargs = ["--flag"]\n',
    );

    await unconfigureMcpToml(cfg, K, N);
    const out = fs.readFileSync(cfg, 'utf8');

    expect(out).toContain('[mcp_servers.some-other-server]');
    expect(out).toContain('command = "other"');
    expect(out).not.toContain('airtable-user-mcp');
    expect(await readMcpTomlEntry(cfg, K, N)).toBeNull();
  });

  it('keeps config that sits ABOVE our block', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\n\n[model_providers.openai]\nbase_url = "https://x"\n');
    await configureMcpToml(cfg, K, N, E);
    await unconfigureMcpToml(cfg, K, N);
    const out = fs.readFileSync(cfg, 'utf8');

    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[model_providers.openai]');
    expect(out).toContain('base_url = "https://x"');
    expect(out).not.toContain('airtable-user-mcp');
  });

  it('does not split a multi-line array whose continuation lines start with [', async () => {
    // A loose /^\s*\[/ header match would treat `[1, 2],` as a table header and
    // cut the user's value in half.
    fs.writeFileSync(cfg, 'matrix = [\n[1, 2],\n[3, 4],\n]\n');
    await configureMcpToml(cfg, K, N, E);
    await unconfigureMcpToml(cfg, K, N);
    const out = fs.readFileSync(cfg, 'utf8');

    expect(out).toContain('matrix = [');
    expect(out).toContain('[1, 2],');
    expect(out).toContain('[3, 4],');
    expect(out).not.toContain('airtable-user-mcp');
  });

  it('round-trips to an equivalent file', async () => {
    const original = 'model = "gpt-5"\n\n[model_providers.openai]\nbase_url = "https://x"\n';
    fs.writeFileSync(cfg, original);
    await configureMcpToml(cfg, K, N, E);
    expect(await readMcpTomlEntry(cfg, K, N)).not.toBeNull();
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8').trim()).toBe(original.trim());
  });

  it('is a no-op when we were never configured', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\n');
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8')).toBe('model = "gpt-5"\n');
  });
});

describe('renderTomlServer', () => {
  it('renders strings, string arrays and string maps as TOML, skipping undefined', () => {
    expect(renderTomlServer('mcp_servers', 'airtable-user-mcp', {
      command: 'node',
      args: ['C:\\Users\\u\\.airtable-user-mcp\\start.mjs'],
      env: { AIRTABLE_HEADLESS_ONLY: '1', 'WITH SPACE': 'say "hi"' },
      skipped: undefined,
    })).toBe(
      '[mcp_servers.airtable-user-mcp]\n'
      + 'command = "node"\n'
      + 'args = ["C:\\\\Users\\\\u\\\\.airtable-user-mcp\\\\start.mjs"]\n'
      + 'env = { AIRTABLE_HEADLESS_ONLY = "1", "WITH SPACE" = "say \\"hi\\"" }\n',
    );
  });

  it('renders booleans and an empty map, and refuses anything else', () => {
    expect(renderTomlServer('mcp_servers', 'x', { disabled: false, env: {} })).toBe('[mcp_servers.x]\ndisabled = false\nenv = {}\n');
    expect(() => renderTomlServer('mcp_servers', 'x', { nested: { a: { b: 1 } } })).toThrow('unsupported TOML value for "nested"');
  });
});

describe('configureMcpToml replaces our table', () => {
  it('configure twice leaves exactly one table, holding the second entry', async () => {
    await configureMcpToml(cfg, K, N, E);
    await configureMcpToml(cfg, K, N, { command: 'node', args: ['/s.mjs'], env: { A: '1' } });
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out.match(/\[mcp_servers\.airtable-user-mcp\]/g)).toHaveLength(1);
    expect(out).toContain('command = "node"');
    expect(out).not.toContain('npx');
  });

  it('a CRLF file keeps CRLF and never gets a second table', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\r\n');
    await configureMcpToml(cfg, K, N, E);
    await configureMcpToml(cfg, K, N, { ...E, command: 'node' });
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out.match(/\[mcp_servers\.airtable-user-mcp\]/g)).toHaveLength(1);
    expect(out).toContain('command = "node"');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('unconfigure also removes an [mcp_servers.airtable-user-mcp.env] sub-table', async () => {
    fs.writeFileSync(cfg, '[mcp_servers.airtable-user-mcp]\ncommand = "npx"\n\n[mcp_servers.airtable-user-mcp.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "x"\n');
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8')).toBe('[mcp_servers.other]\ncommand = "x"\n');
  });

  it('reads back the keys of our table, parsing the values we write', async () => {
    await configureMcpToml(cfg, K, N, { command: 'node', args: ['/s.mjs'], env: { A: '1' } });
    expect(await readMcpTomlEntry(cfg, K, N)).toEqual({ command: 'node', args: ['/s.mjs'], env: { A: '1' } });
    expect(await readMcpTomlEntry(cfg, K, 'other')).toBeNull();
    // An env sub-table reads like the inline env; a value we cannot read is true.
    fs.writeFileSync(cfg, '[mcp_servers.airtable-user-mcp]\ncommand = "npx"\nx = { n = 1.5 }\n\n[mcp_servers.airtable-user-mcp.env]\nAIRTABLE_HEADLESS_ONLY = "1"\n');
    expect(await readMcpTomlEntry(cfg, K, N)).toEqual({ command: 'npx', x: true, env: { AIRTABLE_HEADLESS_ONLY: '1' } });
    expect(await readMcpTomlEntry(path.join(dir, 'missing.toml'), K, N)).toBeNull();
  });
});

describe('configureMcpToml keeps everything that is not ours, byte for byte', () => {
  const ENV_ENTRY = { command: 'node', args: ['C:\\Users\\u\\s.mjs'], env: { A: '1' } };

  it('writes the env as an inline table that round-trips a backslash path', async () => {
    await configureMcpToml(cfg, K, N, ENV_ENTRY);
    expect((await readMcpTomlEntry(cfg, K, N))?.args).toEqual(['C:\\Users\\u\\s.mjs']);
  });

  it('a user table BELOW ours survives Update and Remove untouched', async () => {
    const below = '[mcp_servers.other]\ncommand = "x"\nargs = [\n  "a",\n  "b",\n]\n';
    fs.writeFileSync(cfg, `model = "gpt-5"\n\n${renderTomlServer(K, N, E)}\n${below}`);
    await configureMcpToml(cfg, K, N, ENV_ENTRY);
    const updated = fs.readFileSync(cfg, 'utf8');
    expect(updated).toContain(below);
    expect(updated.match(/\[mcp_servers\.airtable-user-mcp\]/g)).toHaveLength(1);
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(`model = "gpt-5"\n\n${below}`);
  });

  it('replaces a hand-written table with a .env sub-table and leaves a multi-line array alone', async () => {
    const user = 'matrix = [\n[1, 2],\n[3, 4],\n]\n\n\n[mcp_servers.keep]\ncommand = "k"\n';
    fs.writeFileSync(cfg, `${user}\n[mcp_servers.airtable-user-mcp]\ncommand = "npx"\n\n[mcp_servers.airtable-user-mcp.env]\nOLD = "1"\n`);
    await configureMcpToml(cfg, K, N, ENV_ENTRY);
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out.startsWith(user)).toBe(true);
    expect(out).not.toContain('OLD');
    expect(out).not.toContain('npx');
    expect(out.match(/\[mcp_servers\.airtable-user-mcp/g)).toHaveLength(1);
  });

  it('leaves a file with none of ours byte-identical apart from the appended table', async () => {
    const original = 'a = 1\n\n\n\n[x]\ny = 2\n';
    fs.writeFileSync(cfg, original);
    await configureMcpToml(cfg, K, N, E);
    expect(fs.readFileSync(cfg, 'utf8').startsWith(original)).toBe(true);
  });

  it('removes a CRLF file\'s table, keeps the rest as CRLF', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\r\n\r\n[mcp_servers.airtable-user-mcp]\r\ncommand = "npx"\r\n\r\n[mcp_servers.other]\r\ncommand = "x"\r\n');
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8')).toBe('model = "gpt-5"\r\n\r\n[mcp_servers.other]\r\ncommand = "x"\r\n');
  });
});

it('configureMcpToml rejects when the config path cannot be read, and writes nothing', async () => {
  fs.mkdirSync(cfg); // a directory at the config path: readFile fails with EISDIR
  await expect(configureMcpToml(cfg, K, N, E)).rejects.toThrow();
  expect(fs.statSync(cfg).isDirectory()).toBe(true);
  expect(fs.readdirSync(dir)).toEqual(['config.toml']);
});

// Windows editors write a UTF-8 byte order mark. Read as text it sits in front of the first
// header, so `\uFEFF[mcp_servers.airtable-user-mcp]` would not match and an Update would append
// a second table, which makes Codex reject the whole file.
describe('a config.toml with a UTF-8 BOM', () => {
  const BOM = '\uFEFF';
  const OURS = '[mcp_servers.airtable-user-mcp]\ncommand = "node"\n';

  it('our table on the first line is found, replaced (never duplicated), and the BOM stays', async () => {
    fs.writeFileSync(cfg, BOM + OURS + '\n[model_providers.x]\nname = "x"\n');
    expect(await readMcpTomlEntry(cfg, K, N)).toEqual({ command: 'node' });
    await configureMcpToml(cfg, K, N, E);
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out.startsWith(BOM + '[model_providers.x]')).toBe(true);
    expect(out.match(/\[mcp_servers\.airtable-user-mcp\]/g)).toHaveLength(1);
    expect(await readMcpTomlEntry(cfg, K, N)).toEqual(E);
  });

  it('a no-op Update leaves the file byte for byte, BOM included', async () => {
    fs.writeFileSync(cfg, BOM + renderTomlServer(K, N, E));
    const before = fs.readFileSync(cfg, 'utf8');
    await configureMcpToml(cfg, K, N, E);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(before);
  });

  it('Remove clears our table on the first line and keeps the BOM, the rest and CRLF', async () => {
    fs.writeFileSync(cfg, BOM + '[mcp_servers.airtable-user-mcp]\r\ncommand = "node"\r\n\r\n[model_providers.x]\r\nname = "x"\r\n');
    await unconfigureMcpToml(cfg, K, N);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(BOM + '[model_providers.x]\r\nname = "x"\r\n');
  });

  it('Helix: our four tables right after the BOM are removed, and the BOM and the user table stay', async () => {
    await configureHelix(cfg); // into an empty file, to get our tables exactly as Setup writes them
    const ours = fs.readFileSync(cfg, 'utf8').trim() + '\n';
    expect(ours.startsWith('[language-server.airtable-lsp]')).toBe(true);
    expect(ours.match(/^\[\[language\]\]$/gm)).toHaveLength(3);
    const user = '[[language]]\nname = "rust"\n';
    fs.writeFileSync(cfg, BOM + ours + '\n' + user);
    await unconfigureHelix(cfg);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(BOM + user);
  });

  it('Helix: Setup on a BOM file keeps the BOM, adds our tables once, and Remove restores the file', async () => {
    const user = '[[language]]\nname = "rust"\n';
    fs.writeFileSync(cfg, BOM + user);
    await configureHelix(cfg);
    await configureHelix(cfg);
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out.startsWith(BOM + user)).toBe(true);
    expect(out.match(/\[language-server\.airtable-lsp\]/g)).toHaveLength(1);
    await unconfigureHelix(cfg);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(BOM + user);
  });

  it('a BOM-only file gets our table after the BOM', async () => {
    fs.writeFileSync(cfg, BOM);
    await configureMcpToml(cfg, K, N, E);
    expect(fs.readFileSync(cfg, 'utf8')).toBe(BOM + renderTomlServer(K, N, E));
  });
});
