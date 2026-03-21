import type { IdeId, DashboardState, IdeStatus, SettingsSnapshot } from './types.js';

// Extension → Webview
export type ExtensionMessage =
  | { type: 'state:update';   payload: DashboardState }
  | { type: 'ide:status';     payload: IdeStatus[] }
  | { type: 'action:result';  id: string; ok: boolean; error?: string };

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'action:setupIde';  id: string; ideId: IdeId }
  | { type: 'action:setupAll';  id: string }
  | { type: 'action:refresh';   id: string }
  | { type: 'setting:change';   key: string; value: unknown };
