export type IdeId =
  | 'cursor'
  | 'windsurf'
  | 'windsurf-next'
  | 'claude-code'
  | 'claude-desktop'
  | 'cline'
  | 'amp';

export type AiFileStatus = 'ok' | 'missing' | 'partial';

export interface AiFiles {
  skills:    AiFileStatus;
  rules:     AiFileStatus;
  workflows: AiFileStatus;
  agents:    AiFileStatus;
}

export interface IdeStatus {
  ideId:         IdeId;
  label:         string;
  detected:      boolean;
  version?:      string;
  mcpConfigured: boolean;
  aiFiles:       AiFiles;
}

export interface SettingsSnapshot {
  mcp:     { autoConfigureOnInstall: boolean; notifyOnUpdates: boolean };
  ai:      { autoInstallFiles: boolean; includeAgents: boolean };
  formula: { formatterVersion: 'v1' | 'v2' };
}

export interface DashboardState {
  ideStatuses:  IdeStatus[];
  mcpVersion:   string;
  aiFilesCount: number;
  loading:      boolean;
  settings:     SettingsSnapshot;
}
