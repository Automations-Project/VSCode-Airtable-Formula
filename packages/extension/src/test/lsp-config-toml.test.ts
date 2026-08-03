import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  configureMcpToml,
  unconfigureMcpToml,
  isMcpTomlConfigured,
} from '../auto-config/lsp-config.js';

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
    await configureMcpToml(cfg);
    fs.appendFileSync(
      cfg,
      '\n[mcp_servers.some-other-server]\ntype = "stdio"\ncommand = "other"\nargs = ["--flag"]\n',
    );

    await unconfigureMcpToml(cfg);
    const out = fs.readFileSync(cfg, 'utf8');

    expect(out).toContain('[mcp_servers.some-other-server]');
    expect(out).toContain('command = "other"');
    expect(out).not.toContain('airtable-user-mcp');
    expect(await isMcpTomlConfigured(cfg)).toBe(false);
  });

  it('keeps config that sits ABOVE our block', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\n\n[model_providers.openai]\nbase_url = "https://x"\n');
    await configureMcpToml(cfg);
    await unconfigureMcpToml(cfg);
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
    await configureMcpToml(cfg);
    await unconfigureMcpToml(cfg);
    const out = fs.readFileSync(cfg, 'utf8');

    expect(out).toContain('matrix = [');
    expect(out).toContain('[1, 2],');
    expect(out).toContain('[3, 4],');
    expect(out).not.toContain('airtable-user-mcp');
  });

  it('round-trips to an equivalent file', async () => {
    const original = 'model = "gpt-5"\n\n[model_providers.openai]\nbase_url = "https://x"\n';
    fs.writeFileSync(cfg, original);
    await configureMcpToml(cfg);
    expect(await isMcpTomlConfigured(cfg)).toBe(true);
    await unconfigureMcpToml(cfg);
    expect(fs.readFileSync(cfg, 'utf8').trim()).toBe(original.trim());
  });

  it('is a no-op when we were never configured', async () => {
    fs.writeFileSync(cfg, 'model = "gpt-5"\n');
    await unconfigureMcpToml(cfg);
    expect(fs.readFileSync(cfg, 'utf8')).toBe('model = "gpt-5"\n');
  });
});
