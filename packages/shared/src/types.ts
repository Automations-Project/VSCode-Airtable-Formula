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

export type AiSkillStatus = 'installed' | 'outdated' | 'missing' | 'unsupported';
export type SkillScope = 'global' | 'project';

export type AuthStatus =
  | 'unknown'
  | 'checking'
  | 'valid'
  | 'expired'
  | 'error'
  | 'logging-in'
  | 'chrome-missing';

export type BrowserChannel = 'chrome' | 'msedge' | 'chromium';
export type BrowserId =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'brave'
  | 'bundled-chromium'
  | 'custom-browser';
export type DetectedBrowserId = Exclude<BrowserId, 'custom-browser'>;
export type StorageEntryId = 'browser-profile' | 'tool-config' | 'bundled-chromium';
export type WebviewLinkId = 'docs' | 'changelog' | 'github' | 'chrome';
export type DashboardTabId = 'overview' | 'setup' | 'prompts' | 'settings';

export type BrowserInfo =
  | { found: false }
  | {
      found: true;
      id: DetectedBrowserId;
      channel: BrowserChannel;
      label: string;
      downloaded?: boolean;
    };

export type BrowserChoiceSummary =
  | { mode: 'auto' }
  | { mode: 'detected'; browserId: DetectedBrowserId; label: string }
  | { mode: 'custom'; label: string };

export type BrowserDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export interface BrowserDownloadState {
  status:    BrowserDownloadStatus;
  progress?: number; // 0–100
  error?:    string;
}

export interface StorageEntry {
  id:         StorageEntryId;
  label:      string;
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
  /** True when a byo session cookie is stored in the OS keychain (authMode='byo'). */
  hasCookie?:         boolean;
  browser?:           BrowserInfo;
  browserDownload?:   BrowserDownloadState;
  availableBrowsers?: BrowserInfo[];
  browserChoice?:     BrowserChoiceSummary;
}

export interface AiSkill {
  status:   AiSkillStatus;
  version?: string;
}

export interface AiSkillClient {
  id:        string;
  name:      string;
  ideId?:    IdeId;
  dir:       string;
  status:    'installed' | 'outdated' | 'missing' | 'absent';
  canonical: boolean;
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
  aiSkill:           AiSkill;
}

export type ToolProfileName = 'read-only' | 'safe-write' | 'full' | 'custom';

export interface ToolCategories {
  read:                    boolean;
  recordRead:              boolean;
  tableWrite:              boolean;
  tableDestructive:        boolean;
  fieldWrite:              boolean;
  fieldDestructive:        boolean;
  recordDestructive:       boolean;
  viewWrite:               boolean;
  viewDestructive:         boolean;
  viewSection:             boolean;
  viewSectionDestructive:  boolean;
  formWrite:               boolean;
  extension:               boolean;
  recordWrite:             boolean;
  sync:                    boolean;
  daemon:                  boolean;
  localWrite:              boolean;
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
    daemonPort:             number;
    authMode:               'browser' | 'byo' | 'direct-login';
    httpClient:             'fetch' | 'impit';
    useDaemon:              boolean;
    browserIdleParkMinutes: number;
  };
  ai:      { autoInstallFiles: boolean; installScope: SkillScope };
  formula: { formatterVersion: 'v1' | 'v2' };
  script:  {
    beautifyStyle: 'default' | 'compact' | 'singleQuote' | 'tabIndent' | 'semicolonFree';
    minifyLevel: 'safe' | 'standard' | 'aggressive' | 'extreme';
  };
  auth:    {
    autoRefresh: boolean;
    refreshIntervalHours: number;
    loginMode: 'manual' | 'auto';
    browserChoice?: BrowserChoiceSummary;
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
  /** Hostname from an existing cloudflared-named.yml, or null when no named
   *  tunnel has been configured yet. Lets the UI show what "reuse the
   *  already-configured tunnel" actually points at. */
  namedTunnelHostname?: string | null;
}

export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;         // result of /daemon/health HTTP check
  port:      number | null;   // MCP HTTP port
  port_lsp:  number | null;   // LSP TCP port — null when LSP not started
  tunnelUrl: string | null;   // active tunnel URL or null
  uptime:    number | null;   // milliseconds since daemon startedAt, or null
  starting?: boolean;         // true while start/restart is in progress
  // bearerToken intentionally excluded — must never reach webview (D-07, T-08-01)
  // pid intentionally excluded — not needed in webview (T-08-02)
}

export interface PromptArg {
  name:        string;
  description: string;
  required:    boolean;
}

export interface PromptDef {
  name:        string;
  description: string;
  arguments:   PromptArg[];
  template:    string;
  isBuiltin:   boolean;
  isModified:  boolean; // true when a built-in has a user override
}

export interface PromptsState {
  prompts: PromptDef[];
}

export interface OfficialAirtableMcpState {
  /** True when a Personal Access Token is stored in VS Code SecretStorage. */
  patSet: boolean;
  /** Per-IDE: whether the 'airtable' key already exists in that IDE's MCP config. */
  ideConfigured: Partial<Record<IdeId, boolean>>;
}

export interface DashboardState {
  ideStatuses:      IdeStatus[];
  versions:         VersionInfo;
  aiSkillCount:     number;
  aiSkillClients:   AiSkillClient[];
  loading:          boolean;
  settings:         SettingsSnapshot;
  auth:             AuthState;
  debug?:           DebugState;
  storage?:         StorageInfo;
  tunnel?:          TunnelState;           // undefined when daemon is not running
  daemon?:          DaemonStatusInfo;      // undefined when daemon is not running
  officialAirtable?: OfficialAirtableMcpState;
  prompts?:          PromptsState;
}
