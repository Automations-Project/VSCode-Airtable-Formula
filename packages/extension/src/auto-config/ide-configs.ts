import * as os from 'os';
import * as path from 'path';
import type { IdeId } from '@airtable-formula/shared';

export type IdeCapability = 'mcp' | 'lsp';

export interface IdeConfig {
  label:           string;
  /** What this IDE supports for auto-configuration. */
  capabilities:    IdeCapability[];
  detectionPaths:  string[];

  // ── MCP (AI-client IDEs) ────────────────────────────────────────────────
  mcpConfigPath?:  string;
  mcpServersKey?:  string;
  /** Extra fields merged into the MCP server entry (e.g. { type: 'local' } for OpenCode). */
  mcpEntryExtras?: Record<string, unknown>;

  // ── LSP (code-editor IDEs) ──────────────────────────────────────────────
  lspConfigPath?:  string;
  lspConfigFormat?: 'json-merge' | 'toml-append' | 'lua-write';
  /** Shown in the UI — a manual step required after auto-config (e.g. Neovim). */
  lspManualStep?:  string;
}

const home    = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');

export const IDE_CONFIGS: Record<IdeId, IdeConfig> = {
  // ── VS Code family (MCP auto-config; LSP implicit via extension) ─────────
  'cursor': {
    label: 'Cursor',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.cursor', 'mcp.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [
      path.join(home, '.cursor'),
      '/Applications/Cursor.app',
      path.join(localAppData, 'Programs', 'cursor'),
    ],
  },
  // Windsurf was rebranded to "Devin Desktop" (2026-06-02, in-place OTA rename).
  // The `.codeium/windsurf*` paths are unchanged per the vendor docs, so the
  // MCP config + detection paths stay; only the display label updates.
  'windsurf': {
    label: 'Devin Desktop (Windsurf)',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [path.join(home, '.codeium', 'windsurf')],
  },
  'windsurf-next': {
    label: 'Devin Desktop Next (Windsurf Next)',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.codeium', 'windsurf-next', 'mcp_config.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [path.join(home, '.codeium', 'windsurf-next')],
  },
  'cline': {
    label: 'Cline',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [path.join(home, '.cline')],
  },

  // ── AI-client tools (MCP only) ──────────────────────────────────────────
  'claude-code': {
    label: 'Claude Code',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.claude.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [path.join(home, '.claude.json'), path.join(home, '.claude')],
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    capabilities: ['mcp'],
    mcpConfigPath: process.platform === 'win32'
      ? path.join(appData, 'Claude', 'claude_desktop_config.json')
      : path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    mcpServersKey:  'mcpServers',
    detectionPaths: [
      path.join(appData, 'Claude'),
      path.join(home, 'Library', 'Application Support', 'Claude'),
    ],
  },
  'amp': {
    label: 'Amp',
    capabilities: ['mcp'],
    mcpConfigPath:  path.join(home, '.config', 'amp', 'settings.json'),
    mcpServersKey:  'mcp.servers',
    detectionPaths: [path.join(home, '.config', 'amp')],
  },
  'opencode': {
    label: 'OpenCode',
    capabilities: ['mcp', 'lsp'],
    mcpConfigPath:   path.join(home, '.config', 'opencode', 'opencode.json'),
    mcpServersKey:   'mcp',
    mcpEntryExtras:  { type: 'local' },
    lspConfigPath:   path.join(home, '.config', 'opencode', 'opencode.json'),
    lspConfigFormat: 'json-merge',
    detectionPaths: [path.join(home, '.config', 'opencode')],
  },
  'codex-cli': {
    label: 'Codex CLI',
    capabilities: ['mcp'],
    // TOML format — handled by configureMcpForIde via lspConfigFormat: 'toml-append'
    // Reusing lspConfigPath/format here; mcpConfigPath is absent so the JSON path is skipped.
    mcpConfigPath:  path.join(home, '.codex', 'config.toml'),
    mcpServersKey:  '',   // unused for TOML; section key embedded in toml-append logic
    detectionPaths: [path.join(home, '.codex')],
  },

  // ── Code editors (LSP only) ─────────────────────────────────────────────
  'zed': {
    label: 'Zed',
    capabilities: ['lsp'],
    lspConfigPath: process.platform === 'win32'
      ? path.join(appData, 'Zed', 'settings.json')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Zed', 'settings.json')
        : path.join(home, '.config', 'zed', 'settings.json'),
    lspConfigFormat: 'json-merge',
    detectionPaths: [
      path.join(home, '.config', 'zed'),
      path.join(home, 'Library', 'Application Support', 'Zed'),
      path.join(appData, 'Zed'),
      '/Applications/Zed.app',
    ],
  },
  'helix': {
    label: 'Helix',
    capabilities: ['lsp'],
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
