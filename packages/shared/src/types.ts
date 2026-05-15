export type IdeId =
  | 'cursor'
  | 'windsurf'
  | 'windsurf-next'
  | 'claude-code'
  | 'claude-desktop'
  | 'cline'
  | 'amp'
  | 'opencode'
  | 'codex-cli'
  | 'zed'
  | 'helix'
  | 'neovim';

export type AiFileStatus = 'ok' | 'missing' | 'partial';

export type AuthStatus =
  | 'unknown'
  | 'checking'
  | 'valid'
  | 'expired'
  | 'error'
  | 'logging-in'
  | 'chrome-missing';

export interface BrowserInfo {
  found:          boolean;
  channel?:       'chrome' | 'msedge' | 'chromium';
  label?:         string;
  /** True when the active browser is a bundled Chromium we downloaded. */
  downloaded?:    boolean;
  executablePath?: string;
}

export interface BrowserChoice {
  mode:            'auto' | 'custom';
  channel?:        string;
  executablePath?: string;
  label?:          string;
}

export type BrowserDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export interface BrowserDownloadState {
  status:    BrowserDownloadStatus;
  progress?: number; // 0–100
  error?:    string;
}

export interface StorageEntry {
  label:      string;
  path:       string;
  sizeBytes?: number;
  exists:     boolean;
}

export interface StorageInfo {
  entries: StorageEntry[];
}

export interface AuthState {
  status:             AuthStatus;
  userId?:            string;
  lastChecked?:       string;
  lastLogin?:         string;
  error?:             string;
  hasCredentials:     boolean;
  browser?:           BrowserInfo;
  browserDownload?:   BrowserDownloadState;
  availableBrowsers?: BrowserInfo[];
  browserChoice?:     BrowserChoice;
}

export interface AiFiles {
  skills:    AiFileStatus;
  rules:     AiFileStatus;
  workflows: AiFileStatus;
  agents:    AiFileStatus;
}

export interface IdeStatus {
  ideId:             IdeId;
  label:             string;
  detected:          boolean;
  version?:          string;
  mcpConfigured:     boolean;
  mcpServerHealthy?: boolean;
  lspConfigured?:    boolean;
  lspManualStep?:    string;
  aiFiles:           AiFiles;
}

export type ToolProfileName = 'read-only' | 'safe-write' | 'full' | 'custom';

export interface ToolCategories {
  read:                    boolean;
  tableWrite:              boolean;
  tableDestructive:        boolean;
  fieldWrite:              boolean;
  fieldDestructive:        boolean;
  viewWrite:               boolean;
  viewDestructive:         boolean;
  viewSection:             boolean;
  viewSectionDestructive:  boolean;
  formWrite:               boolean;
  extension:               boolean;
}

export interface ToolProfileSnapshot {
  /** Active profile name */
  profile:        ToolProfileName;
  /** Number of tools currently enabled under this profile */
  enabledCount:   number;
  /** Total number of tools the MCP server supports */
  totalCount:     number;
  /** Category toggles (only meaningful when profile === 'custom') */
  categories:     ToolCategories;
}

export interface SettingsSnapshot {
  mcp:     {
    autoConfigureOnInstall: boolean;
    notifyOnUpdates:        boolean;
    toolProfile:            ToolProfileSnapshot;
    serverSource:           'bundled' | 'npx';
  };
  ai:      { autoInstallFiles: boolean; includeAgents: boolean };
  formula: { formatterVersion: 'v1' | 'v2' };
  script:  { beautifyStyle: string; minifyLevel: string };
  auth:    {
    autoRefresh: boolean;
    refreshIntervalHours: number;
    loginMode: 'manual' | 'auto';
    browserChoice?: BrowserChoice;
  };
  debug:   { enabled: boolean; verboseHttp: boolean; bufferSize: number };
}

export interface VersionInfo {
  extension: string;
  mcpServerBundled: string;
  mcpServerPublished?: string;
  bundledFromGitSha?: string;
}

export interface DebugState {
  enabled: boolean;
  sessionActive: boolean;
  eventCount: number;
  bufferCapacity: number;
  verboseHttp: boolean;
}

export type TunnelProviderId = 'cf-quick' | 'ngrok' | 'cf-named';

export type TunnelStatus = 'disabled' | 'starting' | 'active' | 'auto-disabled' | 'error';

export interface TunnelAutoDisabledReason {
  failures: number;
  windowMs: number;
  ip: string | null;
}

export interface TunnelState {
  status:             TunnelStatus;
  url:                string | null;
  provider:           TunnelProviderId;
  ngrokAuthtokenSet:  boolean;       // true when VS Code SecretStorage has a token for 'airtable-formula.ngrok.authtoken'
  autoDisabledReason: TunnelAutoDisabledReason | null;
}

export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;         // result of /daemon/health HTTP check
  port:      number | null;   // MCP HTTP port
  port_lsp:  number | null;   // LSP TCP port — null when LSP not started
  tunnelUrl: string | null;   // active tunnel URL or null
  uptime:    number | null;   // milliseconds since daemon startedAt, or null
  // bearerToken intentionally excluded — must never reach webview (D-07, T-08-01)
  // pid intentionally excluded — not needed in webview (T-08-02)
}

export interface DashboardState {
  ideStatuses:  IdeStatus[];
  versions:     VersionInfo;
  aiFilesCount: number;
  loading:      boolean;
  settings:     SettingsSnapshot;
  auth:         AuthState;
  debug?:       DebugState;
  storage?:     StorageInfo;
  tunnel?:      TunnelState;  // undefined when daemon is not running
  daemon?:      DaemonStatusInfo;  // undefined when daemon is not running
}
