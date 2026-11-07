import * as os from 'os';
import * as path from 'path';
import type { IdeId } from '@airtable-formula/shared';
import { MCP_CLIENTS, MCP_CLIENT_BY_ID, type McpClientId, type McpClientRow, type PathContext } from './mcp-clients.js';

export type IdeCapability = 'mcp' | 'lsp';

export interface IdeConfig {
  label:           string;
  /** What this IDE supports for auto-configuration. */
  capabilities:    IdeCapability[];
  /** The page Docs opens. MCP clients take it from their table row. */
  docsUrl:         string;
  /** The LSP-only editors' detection; an MCP client is detected by its table row (detectionPathsFor). */
  detectionPaths?: string[];

  // ── LSP (code-editor IDEs) ──────────────────────────────────────────────
  /** Absent for OpenCode: its `lsp` key sits in the file its MCP entry uses, resolved per call. */
  lspConfigPath?:  string;
  lspConfigFormat?: 'json-merge' | 'toml-append' | 'lua-write';
  /** Shown in the UI — a manual step required after auto-config (e.g. Neovim). */
  lspManualStep?:  string;
}

const home    = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');

/**
 * An MCP client's config comes from its row. OpenCode also reads language servers from its config
 * file. Zed is an MCP client (context_servers) with no LSP auto-config: Zed starts only the
 * language servers that a Zed extension or a built-in adapter registers, so an `lsp` settings
 * entry is never started (zed-industries/zed#52653, closed "not planned").
 */
function fromRow(row: McpClientRow): IdeConfig {
  if (row.id === 'opencode') {
    return { label: row.label, capabilities: ['mcp', 'lsp'], docsUrl: row.docsUrl, lspConfigFormat: 'json-merge' };
  }
  return { label: row.label, capabilities: ['mcp'], docsUrl: row.docsUrl };
}

/** Every IdeId in IDE_IDS order: the client table's rows, then the LSP-only editors. */
export const IDE_CONFIGS: Record<IdeId, IdeConfig> = {
  ...(Object.fromEntries(MCP_CLIENTS.map((r) => [r.id, fromRow(r)])) as Record<McpClientId, IdeConfig>),

  // ── Code editors (LSP only) ─────────────────────────────────────────────
  'helix': {
    label: 'Helix',
    capabilities: ['lsp'],
    docsUrl: 'https://helix-editor.com',
    lspConfigPath: process.platform === 'win32'
      ? path.join(appData, 'helix', 'languages.toml')
      : path.join(home, '.config', 'helix', 'languages.toml'),
    lspConfigFormat: 'toml-append',
    detectionPaths: [
      path.join(home, '.config', 'helix'),
      path.join(appData, 'helix'),
    ],
  },
  'neovim': {
    label: 'Neovim',
    capabilities: ['lsp'],
    docsUrl: 'https://neovim.io',
    lspConfigPath: process.platform === 'win32'
      ? path.join(localAppData, 'nvim', 'lsp', 'airtable.lua')
      : path.join(home, '.config', 'nvim', 'lsp', 'airtable.lua'),
    lspConfigFormat: 'lua-write',
    lspManualStep:  "Add `vim.lsp.enable('airtable')` to your init.lua to activate",
    detectionPaths: [
      path.join(home, '.config', 'nvim'),
      path.join(localAppData, 'nvim'),
    ],
  },
};

/** The client table row of an id; undefined for the LSP-only editors. */
export function mcpRowFor(ideId: IdeId): McpClientRow | undefined {
  return (MCP_CLIENT_BY_ID as Readonly<Partial<Record<IdeId, McpClientRow>>>)[ideId];
}

/** Where an IDE is looked for: its table row's detection paths, else its static list. */
export function detectionPathsFor(ideId: IdeId, ctx: PathContext): readonly string[] {
  const row = mcpRowFor(ideId);
  return row ? row.detect(ctx) : IDE_CONFIGS[ideId].detectionPaths ?? [];
}
