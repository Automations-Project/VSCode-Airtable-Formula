import type {
  DetectedBrowserId,
  DashboardState,
  IdeId,
  IdeStatus,
  AuthState,
  PromptDef,
  StorageEntryId,
  ToolCategories,
  ToolProfileName,
  TunnelProviderId,
  WebviewLinkId,
} from './types.js';

export type ActionId = string;
export type ConfirmationKind = 'discard-prompt-edits';

export type WebviewSettingChange =
  | { key: 'auth.autoRefresh'; value: boolean }
  | { key: 'auth.refreshIntervalHours'; value: number }
  | { key: 'auth.loginMode'; value: 'manual' | 'auto' }
  | { key: 'mcp.autoConfigureOnInstall'; value: boolean }
  | { key: 'mcp.notifyOnUpdates'; value: boolean }
  | { key: 'mcp.authMode'; value: 'browser' | 'byo' | 'direct-login' }
  | { key: 'mcp.httpClient'; value: 'fetch' | 'impit' }
  | { key: 'mcp.serverSource'; value: 'bundled' | 'npx' }
  | { key: 'mcp.daemonPort'; value: number }
  | { key: 'mcp.browserIdleParkMinutes'; value: number }
  | { key: 'mcp.toolProfile'; value: ToolProfileName }
  | { key: 'mcp.category'; category: keyof ToolCategories; value: boolean }
  | { key: 'formula.formatterVersion'; value: 'v1' | 'v2' }
  | {
      key: 'script.beautifyStyle';
      value: 'default' | 'compact' | 'singleQuote' | 'tabIndent' | 'semicolonFree';
    }
  | {
      key: 'script.minifyLevel';
      value: 'safe' | 'standard' | 'aggressive' | 'extreme';
    }
  | { key: 'ai.autoInstallFiles'; value: boolean }
  | { key: 'ai.includeAgents'; value: boolean }
  | { key: 'debug.enabled'; value: boolean }
  | { key: 'debug.verboseHttp'; value: boolean }
  | { key: 'debug.bufferSize'; value: number };

export type WebviewBrowserChoice =
  | { mode: 'auto' }
  | { mode: 'detected'; browserId: DetectedBrowserId };

// Extension → Webview
export type ExtensionMessage =
  | { type: 'state:update'; payload: DashboardState }
  | { type: 'ide:status'; payload: IdeStatus[] }
  | { type: 'auth:state'; payload: AuthState }
  | {
      type: 'action:result';
      id: ActionId;
      ok: boolean;
      error?: string;
      cancelled?: boolean;
    }
  | {
      type: 'confirmation:result';
      id: ActionId;
      confirmed: boolean;
    };

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'action:setupIde'; id: ActionId; ideId: IdeId }
  | { type: 'action:setupAll'; id: ActionId }
  | { type: 'action:refresh'; id: ActionId }
  | { type: 'action:login'; id: ActionId }
  | { type: 'action:logout'; id: ActionId }
  | { type: 'action:status'; id: ActionId }
  | {
      type: 'action:saveCredentials';
      id: ActionId;
      email: string;
      password: string;
      otpSecret: string;
    }
  | { type: 'auth:saveCookie'; id: ActionId; cookie: string }
  | { type: 'auth:clearCookie'; id: ActionId }
  | { type: 'action:install-browser'; id: ActionId }
  | { type: 'action:removeBrowser'; id: ActionId }
  | { type: 'action:openToolConfig'; id: ActionId }
  | { type: 'action:unconfigureIde'; id: ActionId; ideId: IdeId }
  | { type: 'action:debug.startSession'; id: ActionId }
  | { type: 'action:debug.stopAndExport'; id: ActionId }
  | { type: 'action:debug.export'; id: ActionId }
  | { type: 'setting:change'; id: ActionId; change: WebviewSettingChange }
  | { type: 'action:manualLogin'; id: ActionId }
  | { type: 'action:openLink'; id: ActionId; link: WebviewLinkId }
  | { type: 'action:openIdeDocs'; id: ActionId; ideId: IdeId }
  | { type: 'action:openStoragePath'; id: ActionId; entryId: StorageEntryId }
  | { type: 'action:backupSession'; id: ActionId }
  | { type: 'action:restoreSession'; id: ActionId }
  | { type: 'action:selectCustomBrowser'; id: ActionId }
  | { type: 'action:setBrowserChoice'; id: ActionId; choice: WebviewBrowserChoice }
  | {
      type: 'tunnel:enable';
      id: ActionId;
      provider: TunnelProviderId;
      authtoken?: string;
      domain?: string;
    }
  | { type: 'tunnel:disable'; id: ActionId }
  | { type: 'tunnel:set-ngrok-authtoken'; id: ActionId; authtoken: string }
  | { type: 'daemon:start'; id: ActionId }
  | { type: 'daemon:stop'; id: ActionId }
  | { type: 'daemon:restart'; id: ActionId }
  | { type: 'daemon:copy-bearer-token'; id: ActionId }
  | { type: 'daemon:rotate-token'; id: ActionId }
  | { type: 'action:save-airtable-pat'; id: ActionId; pat: string }
  | { type: 'action:copy-airtable-pat'; id: ActionId }
  | { type: 'action:configure-official-airtable'; id: ActionId; ideId: IdeId }
  | { type: 'action:unconfigure-official-airtable'; id: ActionId; ideId: IdeId }
  | { type: 'action:save-prompt'; id: ActionId; prompt: PromptDef }
  | { type: 'action:delete-prompt'; id: ActionId; name: string }
  | { type: 'action:reset-prompt'; id: ActionId; name: string }
  | { type: 'confirmation:request'; id: ActionId; kind: ConfirmationKind };
