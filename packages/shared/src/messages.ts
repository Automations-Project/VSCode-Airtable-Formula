import type { IdeId, DashboardState, IdeStatus, SettingsSnapshot, AuthState, TunnelProviderId } from './types.js';

// Extension → Webview
export type ExtensionMessage =
  | { type: 'state:update';   payload: DashboardState }
  | { type: 'ide:status';     payload: IdeStatus[] }
  | { type: 'auth:state';     payload: AuthState }
  | { type: 'action:result';  id: string; ok: boolean; error?: string };

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'action:setupIde';  id: string; ideId: IdeId }
  | { type: 'action:setupAll';  id: string }
  | { type: 'action:refresh';   id: string }
  | { type: 'action:login';     id: string }
  | { type: 'action:logout';    id: string }
  | { type: 'action:status'; id: string }
  | { type: 'action:saveCredentials'; id: string; email: string; password: string; otpSecret: string }
  | { type: 'action:install-browser'; id: string }
  | { type: 'action:removeBrowser';   id: string }
  | { type: 'action:openToolConfig';  id: string }
  | { type: 'action:unconfigureIde'; id: string; ideId: IdeId }
  | { type: 'action:debug.startSession'; id: string }
  | { type: 'action:debug.stopAndExport'; id: string }
  | { type: 'action:debug.export'; id: string }
  | { type: 'setting:change';           key: string; value: unknown }
  | { type: 'action:manualLogin';        id: string }
  | { type: 'action:openStoragePath';    id: string; path: string }
  | { type: 'action:backupSession';      id: string }
  | { type: 'action:restoreSession';     id: string }
  | { type: 'action:selectCustomBrowser'; id: string }
  | { type: 'action:setBrowserChoice';   id: string; choice: import('./types.js').BrowserChoice }
  | { type: 'tunnel:enable';              id: string; provider: TunnelProviderId; authtoken?: string; domain?: string }
  | { type: 'tunnel:disable';             id: string }
  | { type: 'tunnel:set-ngrok-authtoken'; id: string; authtoken: string }
  | { type: 'daemon:start';               id: string }
  | { type: 'daemon:stop';                id: string }
  | { type: 'daemon:restart';             id: string }
  | { type: 'daemon:copy-bearer-token';   id: string }
  | { type: 'daemon:rotate-token';        id: string }
  | { type: 'action:save-airtable-pat';             id: string; pat: string }
  | { type: 'action:copy-airtable-pat';             id: string }
  | { type: 'action:configure-official-airtable';   id: string; ideId: IdeId }
  | { type: 'action:unconfigure-official-airtable'; id: string; ideId: IdeId };
