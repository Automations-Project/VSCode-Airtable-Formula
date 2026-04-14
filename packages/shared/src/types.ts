export type IdeId =
  | 'cursor'
  | 'windsurf'
  | 'windsurf-next'
  | 'claude-code'
  | 'claude-desktop'
  | 'cline'
  | 'amp';

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
  aiFiles:           AiFiles;
}

export type ToolProfileName = 'read-only' | 'safe-write' | 'full' | 'custom';

export interface ToolCategories {
  read:             boolean;
  fieldWrite:       boolean;
  fieldDestructive: boolean;
  viewWrite:        boolean;
  viewDestructive:  boolean;
  extension:        boolean;
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

export interface DashboardState {
  ideStatuses:  IdeStatus[];
  versions:     VersionInfo;
  aiFilesCount: number;
  loading:      boolean;
  settings:     SettingsSnapshot;
  auth:         AuthState;
  debug?:       DebugState;
  storage?:     StorageInfo;
}
