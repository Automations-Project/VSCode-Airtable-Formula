// Ported and modified from neondatabase/add-mcp src/agents.ts
// at 5ae1d29a406568b1dedbaa4bd3b8a6fd7ef2195c (https://github.com/neondatabase/add-mcp).
// Copyright 2025 Andre Landgraf. Licensed under the Apache License, Version 2.0;
// see packages/extension/THIRD_PARTY_NOTICES.md. Changes: hand port to TypeScript, global
// config paths only, paths are pure functions of { platform, home, env }; VS Code, Goose and
// Hermes are not ported; Amp and Windsurf Next are ours; Cline's extension and CLI agents are
// one row on the file Cline ≥ 4 shares; Zed's macOS path follows Zed's docs.
// Drift against upstream: scripts/check-mcp-clients.mjs (pnpm check:mcp-clients:upstream).

import * as os from 'os';
import * as path from 'path';
import type { IdeId } from '@airtable-formula/shared';
import type { EntryShapeId } from './mcp-entry-shapes.js';

/** Everything a path depends on, so every platform can be computed on any machine. */
export interface PathContext {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

export type McpConfigFormat = 'json' | 'jsonc' | 'toml';

/** A place we wrote our entry before the port, which the writer moves from. */
export interface LegacyLocation { path: string; serversPath: readonly string[] }

/** Every contract id except the two LSP-only editors; the table has one row for each, in IdeId order. */
export type McpClientId = Exclude<IdeId, 'helix' | 'neovim'>;

export interface McpClientRow {
  id: McpClientId;
  /** add-mcp agent id; null = ours only. */
  upstream: string | null;
  label: string;
  docsUrl: string;
  format: McpConfigFormat;
  /** JSON path segments ('amp.mcpServers' is ONE segment); TOML: [table name]. */
  serversPath: readonly string[];
  shape: EntryShapeId;
  /** Write location chosen per file. */
  layout?: 'opencode';
  /** The official Airtable remote entry, and the key its URL goes under. */
  official?: 'url' | 'serverUrl';
  globalPath: (ctx: PathContext) => string;
  /** Candidates tried in order; the first that exists wins over globalPath. */
  preferExisting?: (ctx: PathContext) => readonly string[];
  detect: (ctx: PathContext) => readonly string[];
  legacy?: (ctx: PathContext) => readonly LegacyLocation[];
}

// ── Helpers: upstream's, over ctx instead of process ────────────────────────

/** The path module of ctx's platform. */
const P = (c: PathContext): path.PlatformPath => (c.platform === 'win32' ? path.win32 : path.posix);

/** `path.win32.join` on win32, else `path.posix.join`. */
const j = (c: PathContext, ...parts: string[]): string => P(c).join(...parts);

/** upstream `dirname`, on ctx's platform. */
const dirname = (c: PathContext, p: string): string => P(c).dirname(p);

/** A path under home. */
const h = (c: PathContext, ...parts: string[]): string => j(c, c.home, ...parts);

/** An environment variable; empty counts as unset, as upstream's `||` reads it. */
const E = (c: PathContext, name: string): string | undefined => c.env[name] || undefined;

/** upstream getPlatformPaths().appSupport */
function appSupport(c: PathContext): string {
  if (c.platform === 'win32') return E(c, 'APPDATA') ?? h(c, 'AppData', 'Roaming');
  if (c.platform === 'darwin') return h(c, 'Library', 'Application Support');
  return E(c, 'XDG_CONFIG_HOME') ?? h(c, '.config');
}

/** upstream getPlatformPaths().vscodePath */
const vscodeUserDir = (c: PathContext): string => j(c, appSupport(c), 'Code', 'User');

/** upstream, inline in the codex row's configPath. */
const codexHome = (c: PathContext): string => E(c, 'CODEX_HOME') ?? h(c, '.codex');

/** upstream getGrokHome */
const grokHome = (c: PathContext): string => E(c, 'GROK_HOME') ?? h(c, '.grok');

/** upstream copilotHome: "Copilot CLI reads `$COPILOT_HOME`, defaulting to `~/.copilot`. It ignores `XDG_CONFIG_HOME`." */
const copilotHome = (c: PathContext): string => E(c, 'COPILOT_HOME') ?? h(c, '.copilot');

/** upstream getKimiCodeHome */
const kimiCodeHome = (c: PathContext): string => E(c, 'KIMI_CODE_HOME') ?? h(c, '.kimi-code');

/** upstream getJunieHome: "The JetBrains IDE plugin always reads `~/.junie`; only Junie CLI honors `JUNIE_HOME`." */
const junieHome = (c: PathContext): string => E(c, 'JUNIE_HOME') ?? h(c, '.junie');

/** upstream getPiAgentDir */
const piAgentDir = (c: PathContext): string => E(c, 'PI_CODING_AGENT_DIR') ?? h(c, '.pi', 'agent');

/**
 * upstream getKiloConfigDir: "Kilo Code resolves its global config through
 * xdg-basedir on every platform, so Windows uses `~/.config/kilo` rather than `%APPDATA%`."
 */
const kiloConfigDir = (c: PathContext): string => j(c, E(c, 'XDG_CONFIG_HOME') ?? h(c, '.config'), 'kilo');

/** Cline's resolveMcpSettingsPath: explicit file > data dir > Cline dir > home; blank overrides are unset. */
const clineCliConfigPath = (c: PathContext): string =>
  c.env.CLINE_MCP_SETTINGS_PATH?.trim() || j(c,
    c.env.CLINE_DATA_DIR?.trim() || j(c, c.env.CLINE_DIR?.trim() || h(c, '.cline'), 'data'),
    'settings', 'cline_mcp_settings.json');

/** upstream clineExtensionConfigPath */
const clineExtensionConfigPath = (c: PathContext): string =>
  j(c, vscodeUserDir(c), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');

/** upstream kiloVscodeStoragePath: the Kilo Code VS Code extension's storage, "used for detection only". */
const kiloVscodeStoragePath = (c: PathContext): string => j(c, vscodeUserDir(c), 'globalStorage', 'kilocode.kilo-code');

/** ours: Zed's config dir per Zed's docs and source (see the zed row). */
function zedConfigDir(c: PathContext): string {
  if (c.platform === 'win32') return j(c, appSupport(c), 'Zed');
  if (c.platform === 'darwin') return h(c, '.config', 'zed');
  return j(c, appSupport(c), 'zed');
}

/** ours: %LOCALAPPDATA%, for the Cursor install we detected before the port. */
const localAppData = (c: PathContext): string => E(c, 'LOCALAPPDATA') ?? h(c, 'AppData', 'Local');

// ── The table ───────────────────────────────────────────────────────────────
// Every row literal begins `{ id: '<id>', upstream: '<id>' | null,` on one
// line: scripts/check-mcp-clients.mjs reads this file as text.

export const MCP_CLIENTS: readonly McpClientRow[] = [
  { id: 'cursor', upstream: 'cursor',
    label: 'Cursor', docsUrl: 'https://cursor.com/download',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard', official: 'url',
    globalPath: (c) => h(c, '.cursor', 'mcp.json'),
    // ours: upstream detects ~/.cursor only; the app installs are what we detected before the port.
    detect: (c) => [
      h(c, '.cursor'),
      ...(c.platform === 'darwin' ? ['/Applications/Cursor.app'] : []),
      ...(c.platform === 'win32' ? [j(c, localAppData(c), 'Programs', 'cursor')] : []),
    ],
  },

  // Windsurf was rebranded to "Devin Desktop" (2026-06-02, in-place OTA rename).
  // The `.codeium/windsurf*` paths are unchanged per the vendor docs; only the label changed.
  { id: 'windsurf', upstream: 'windsurf',
    label: 'Devin Desktop (Windsurf)', docsUrl: 'https://windsurf.com/download',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard', official: 'serverUrl',
    globalPath: (c) => h(c, '.codeium', 'windsurf', 'mcp_config.json'),
    detect: (c) => [h(c, '.codeium', 'windsurf')],
  },

  // ours (not in add-mcp): the windsurf row's paths with windsurf-next.
  { id: 'windsurf-next', upstream: null,
    label: 'Devin Desktop Next (Windsurf Next)', docsUrl: 'https://windsurf.com/download',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard', official: 'serverUrl',
    globalPath: (c) => h(c, '.codeium', 'windsurf-next', 'mcp_config.json'),
    detect: (c) => [h(c, '.codeium', 'windsurf-next')],
  },

  { id: 'claude-code', upstream: 'claude-code',
    label: 'Claude Code', docsUrl: 'https://docs.claude.com/en/docs/claude-code/quickstart',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard', official: 'url',
    globalPath: (c) => h(c, '.claude.json'),
    // ours: upstream detects ~/.claude only; ~/.claude.json is what we detected before the port.
    detect: (c) => [h(c, '.claude'), h(c, '.claude.json')],
  },

  // No legacy location: before the port the Linux path pointed at the macOS
  // location (~/Library/Application Support/Claude), but Linux detection never
  // matched it, so nothing was ever written there.
  { id: 'claude-desktop', upstream: 'claude-desktop',
    label: 'Claude Desktop', docsUrl: 'https://claude.ai/download',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard', official: 'url',
    globalPath: (c) => j(c, appSupport(c), 'Claude', 'claude_desktop_config.json'),
    detect: (c) => [j(c, appSupport(c), 'Claude')],
  },

  // Cline. Upstream's `cline` (the VS Code extension's globalStorage file,
  // clineExtensionConfigPath) and `cline-cli` (the shared file,
  // clineCliConfigPath) are one row here, because Cline ≥ 4 reads the shared
  // file from the extension, the CLI and JetBrains. The globalStorage folder
  // stays a detection path, next to ~/.cline, which a fresh Cline 4.x creates
  // (it no longer creates the globalStorage folder).
  // docs.cline.bot/mcp/configuring-mcp-servers, read 2026-11-07: the CLI file is
  // ~/.cline/data/settings/cline_mcp_settings.json, servers under mcpServers;
  // no path is given for the extension, which opens its file from Configure >
  // "Configure MCP Servers".
  // cline/cline source, read 2026-11-07 (main at 94eecbb and release v4.1.26;
  // present since v4.0.0): apps/vscode/src/sdk/SdkController.ts keeps MCP
  // settings in ~/.cline/data/settings/cline_mcp_settings.json, "shared across
  // VSCode, CLI, and JetBrains clients", and says not to use the globalStorage
  // settings dir; hosts/vscode/mcp-settings-legacy-migration.ts (PR #11818)
  // moves the servers of the old globalStorage file into the shared file once,
  // and a server written to globalStorage after that is never read. Cline finds
  // the file through CLINE_MCP_SETTINGS_PATH, then CLINE_DATA_DIR/settings/…,
  // then CLINE_DIR (default ~/.cline)/data/settings/… (trimmed, with blanks unset).
  // Unlike the pinned add-mcp helper, honor all three, as Cline itself does in
  // sdk/packages/shared/src/storage/paths.ts. No legacy location: a default file
  // beside an override can be a separate setup and must stay untouched.
  { id: 'cline', upstream: 'cline',
    label: 'Cline', docsUrl: 'https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev',
    format: 'json', serversPath: ['mcpServers'], shape: 'cline', official: 'url',
    globalPath: (c) => clineCliConfigPath(c),
    detect: (c) => [h(c, '.cline'), dirname(c, clineExtensionConfigPath(c))],
  },

  // ours (not in add-mcp). ampcode.com/docs/customize/mcp, read 2026-11-07:
  // servers sit under the flat key "amp.mcpServers" in the user settings file.
  // ampcode.com/docs/cli/settings, read 2026-11-07: that file is
  // ~/.config/amp/settings.json on macOS and Linux and
  // %USERPROFILE%\.config\amp\settings.json on Windows (settings.jsonc is also
  // accepted); neither page mentions XDG_CONFIG_HOME. Before the port we wrote
  // nested mcp.servers, which Amp never reads: that is the legacy location.
  { id: 'amp', upstream: null,
    label: 'Amp', docsUrl: 'https://ampcode.com/',
    format: 'json', serversPath: ['amp.mcpServers'], shape: 'standard', official: 'url',
    globalPath: (c) => h(c, '.config', 'amp', 'settings.json'),
    detect: (c) => [h(c, '.config', 'amp')],
    legacy: (c) => [{ path: h(c, '.config', 'amp', 'settings.json'), serversPath: ['mcp', 'servers'] }],
  },

  // upstream resolveOpenCodeConfigPath (global): ~/.config/opencode on every platform.
  { id: 'opencode', upstream: 'opencode',
    label: 'OpenCode', docsUrl: 'https://opencode.ai',
    format: 'jsonc', serversPath: ['mcp'], shape: 'opencode', layout: 'opencode', official: 'url',
    globalPath: (c) => h(c, '.config', 'opencode', 'opencode.jsonc'),
    preferExisting: (c) => [h(c, '.config', 'opencode', 'opencode.jsonc'), h(c, '.config', 'opencode', 'opencode.json')],
    detect: (c) => [h(c, '.config', 'opencode')],
  },

  // upstream `codex`. Detection ignores CODEX_HOME, as upstream does. Legacy:
  // before the port we wrote ~/.codex/config.toml whatever CODEX_HOME said.
  { id: 'codex-cli', upstream: 'codex',
    label: 'Codex CLI', docsUrl: 'https://github.com/openai/codex',
    format: 'toml', serversPath: ['mcp_servers'], shape: 'codex',
    globalPath: (c) => j(c, codexHome(c), 'config.toml'),
    detect: (c) => [h(c, '.codex')],
    legacy: (c) => [{ path: h(c, '.codex', 'config.toml'), serversPath: ['mcp_servers'] }],
  },

  // Upstream `zed` uses <appSupport>/Zed on macOS, ~/Library/Application Support/Zed.
  // zed.dev/docs/configuring-zed, read 2026-11-07: the user file is shown as
  // ~/.config/zed/settings.json, with no per-platform list. Zed's source,
  // crates/paths/src/paths.rs config_dir() (read 2026-11-07 at b5cd310):
  // RoamingAppData\Zed on Windows; $XDG_CONFIG_HOME/zed, else ~/.config/zed, on
  // Linux (FLATPAK_XDG_CONFIG_HOME first; not read here, nor upstream); and
  // ~/.config/zed on macOS, where XDG_CONFIG_HOME is not read. We follow Zed.
  // Upstream's macOS folder is Zed's data dir there; it stays a detection path.
  { id: 'zed', upstream: 'zed',
    label: 'Zed', docsUrl: 'https://zed.dev/download',
    format: 'jsonc', serversPath: ['context_servers'], shape: 'zed',
    globalPath: (c) => j(c, zedConfigDir(c), 'settings.json'),
    detect: (c) => (c.platform === 'darwin'
      ? [zedConfigDir(c), h(c, 'Library', 'Application Support', 'Zed'), '/Applications/Zed.app']
      : [zedConfigDir(c)]),
  },

  // docs link checked 2026-11-07: live, the Google Antigravity homepage.
  { id: 'antigravity', upstream: 'antigravity',
    label: 'Antigravity', docsUrl: 'https://antigravity.google/',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => h(c, '.gemini', 'config', 'mcp_config.json'),
    detect: (c) => [h(c, '.gemini', 'config')],
  },

  { id: 'factory-droid', upstream: 'factory-droid',
    label: 'Factory Droid', docsUrl: 'https://docs.factory.ai/cli/configuration/mcp',
    format: 'json', serversPath: ['mcpServers'], shape: 'typed-stdio',
    globalPath: (c) => h(c, '.factory', 'mcp.json'),
    detect: (c) => [h(c, '.factory')],
  },

  // upstream: "fx reads MCP config only from its trusted global profile".
  { id: 'fx', upstream: 'fx',
    label: 'fx', docsUrl: 'https://fx.sh/docs/capabilities/mcp',
    format: 'json', serversPath: ['mcp'], shape: 'fx',
    globalPath: (c) => h(c, '.fx', 'mcp.json'),
    detect: (c) => [h(c, '.fx')],
  },

  { id: 'gemini-cli', upstream: 'gemini-cli',
    label: 'Gemini CLI', docsUrl: 'https://github.com/google-gemini/gemini-cli',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => h(c, '.gemini', 'settings.json'),
    detect: (c) => [h(c, '.gemini')],
  },

  // docs link checked 2026-11-07: live, the github/copilot-cli repository.
  { id: 'github-copilot-cli', upstream: 'github-copilot-cli',
    label: 'GitHub Copilot CLI', docsUrl: 'https://github.com/github/copilot-cli',
    format: 'json', serversPath: ['mcpServers'], shape: 'copilot-cli',
    globalPath: (c) => j(c, copilotHome(c), 'mcp-config.json'),
    detect: (c) => [copilotHome(c)],
  },

  { id: 'grok-build', upstream: 'grok-build',
    label: 'Grok Build', docsUrl: 'https://docs.x.ai/build/features/mcp-servers',
    format: 'toml', serversPath: ['mcp_servers'], shape: 'standard',
    globalPath: (c) => j(c, grokHome(c), 'config.toml'),
    detect: (c) => [grokHome(c)],
  },

  { id: 'junie', upstream: 'junie',
    label: 'Junie', docsUrl: 'https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => j(c, junieHome(c), 'mcp', 'mcp.json'),
    detect: (c) => [junieHome(c)],
  },

  // upstream resolveKiloCodeConfigPath (global): kilo.jsonc if it exists, else kilo.json.
  { id: 'kilo-code', upstream: 'kilo-code',
    label: 'Kilo Code', docsUrl: 'https://kilocode.ai/docs/features/mcp/using-mcp-in-kilo-code',
    format: 'jsonc', serversPath: ['mcp'], shape: 'opencode',
    globalPath: (c) => j(c, kiloConfigDir(c), 'kilo.json'),
    preferExisting: (c) => [j(c, kiloConfigDir(c), 'kilo.jsonc')],
    detect: (c) => [kiloConfigDir(c), kiloVscodeStoragePath(c)],
  },

  { id: 'kimi-code', upstream: 'kimi-code',
    label: 'Kimi Code', docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html',
    format: 'json', serversPath: ['mcpServers'], shape: 'kimi',
    globalPath: (c) => j(c, kimiCodeHome(c), 'mcp.json'),
    detect: (c) => [kimiCodeHome(c)],
  },

  // upstream: "Shared with the Kiro IDE, which reads the same two files."
  { id: 'kiro-cli', upstream: 'kiro-cli',
    label: 'Kiro CLI', docsUrl: 'https://kiro.dev/docs/mcp/configuration',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => h(c, '.kiro', 'settings', 'mcp.json'),
    detect: (c) => [h(c, '.kiro')],
  },

  // upstream getMastraCodeDir: ~/.mastracode, no override.
  // docs link checked 2026-11-07: live, the Mastra homepage, which names Mastra Code.
  { id: 'mastracode', upstream: 'mastracode',
    label: 'Mastra Code', docsUrl: 'https://mastra.ai',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => h(c, '.mastracode', 'mcp.json'),
    detect: (c) => [h(c, '.mastracode')],
  },

  // upstream resolveMcporterConfigPath (global): mcporter.json if it exists,
  // else mcporter.jsonc if it exists, else mcporter.json.
  // docs link checked 2026-11-07: live; GitHub redirects it (301) to github.com/openclaw/mcporter.
  { id: 'mcporter', upstream: 'mcporter',
    label: 'MCPorter', docsUrl: 'https://github.com/steipete/mcporter',
    format: 'jsonc', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => h(c, '.mcporter', 'mcporter.json'),
    preferExisting: (c) => [h(c, '.mcporter', 'mcporter.json'), h(c, '.mcporter', 'mcporter.jsonc')],
    detect: (c) => [h(c, '.mcporter')],
  },

  // docs link checked 2026-11-07: live; GitHub redirects it (301) to github.com/earendil-works/pi.
  { id: 'pi', upstream: 'pi',
    label: 'Pi', docsUrl: 'https://github.com/badlogic/pi-mono',
    format: 'json', serversPath: ['mcpServers'], shape: 'standard',
    globalPath: (c) => j(c, piAgentDir(c), 'mcp.json'),
    detect: (c) => [piAgentDir(c)],
  },
];

export const MCP_CLIENT_BY_ID: Readonly<Record<McpClientId, McpClientRow>> =
  Object.fromEntries(MCP_CLIENTS.map((r) => [r.id, r])) as Record<McpClientId, McpClientRow>;

/** The context of this process. */
export function hostPathContext(): PathContext {
  return { platform: process.platform, home: os.homedir(), env: process.env };
}

/** The first preferExisting candidate that exists, else the row's global path. */
export function resolveConfigPath(row: McpClientRow, ctx: PathContext, exists: (p: string) => boolean): string {
  return row.preferExisting?.(ctx).find(exists) ?? row.globalPath(ctx);
}

/** A path as the platform's file system compares it: normalized, and case-folded on win32. */
export function pathKey(ctx: PathContext, p: string): string {
  return ctx.platform === 'win32' ? path.win32.normalize(p).toLowerCase() : path.posix.normalize(p);
}

/** Path equality the way the platform's file system sees it: case-insensitive on win32. */
export function samePath(ctx: PathContext, a: string, b: string): boolean {
  return pathKey(ctx, a) === pathKey(ctx, b);
}
