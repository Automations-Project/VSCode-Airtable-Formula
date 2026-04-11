import type { IdeId, DashboardState, IdeStatus, SettingsSnapshot, AuthState } from './types.js';

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
  | { type: 'setting:change';   key: string; value: unknown };
