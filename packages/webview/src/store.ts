import { create } from 'zustand';
import type { DashboardState, IdeStatus, SettingsSnapshot, AuthState } from '@shared/types.js';
import { sendToExtension } from './lib/vscode.js';
import { randomId } from './lib/utils.js';

interface Store extends DashboardState {
  activeTab: 'overview' | 'setup' | 'settings';
  pendingActions: Set<string>;
  pendingIdeActions: Map<string, string>; // ideId → actionId
  setTab: (tab: Store['activeTab']) => void;
  applyState: (state: DashboardState) => void;
  applyAuthState: (state: AuthState) => void;
  setupIde: (ideId: string) => void;
  setupAll: () => void;
  refresh: () => void;
  login: () => void;
  logout: () => void;
  status: () => void;
  saveCredentials: (email: string, password: string, otpSecret: string) => void;
  installBrowser: () => void;
  removeBrowser: () => void;
  markActionDone: (id: string, ok: boolean) => void;
}

const defaultSettings: SettingsSnapshot = {
  mcp:     {
    autoConfigureOnInstall: true,
    notifyOnUpdates:        true,
    toolProfile: {
      profile:      'full',
      enabledCount: 32,
      totalCount:   32,
      categories: {
        read: true, fieldWrite: true, fieldDestructive: true,
        viewWrite: true, viewDestructive: true, extension: true,
      },
    },
  },
  ai:      { autoInstallFiles: true, includeAgents: false },
  formula: { formatterVersion: 'v2' },
  auth:    { autoRefresh: true, refreshIntervalHours: 12 },
};

const defaultAuth: AuthState = {
  status: 'unknown',
  hasCredentials: false,
};

export const useStore = create<Store>((set, get) => ({
  ideStatuses: [],
  versions: { extension: '—', mcpServerBundled: '—' },
  aiFilesCount: 0,
  loading: true,
  settings: defaultSettings,
  auth: defaultAuth,
  activeTab: 'overview',
  pendingActions: new Set(),
  pendingIdeActions: new Map(),

  setTab: (tab) => set({ activeTab: tab }),
  applyState: (state) => set(s => {
    // Preserve auth from the dedicated auth:state channel if the incoming
    // state has default/stale auth (e.g. hasCredentials false when we already
    // know credentials are saved). The auth:state message is the authority.
    const auth = s.auth.status !== 'unknown' ? s.auth : state.auth;
    return { ...state, auth, loading: false };
  }),
  applyAuthState: (state) => set({ auth: state }),

  setupIde: (ideId) => {
    const id = randomId();
    set(s => {
      const nextPending = new Set([...s.pendingActions, id]);
      const nextIde = new Map(s.pendingIdeActions);
      nextIde.set(ideId, id);
      return { pendingActions: nextPending, pendingIdeActions: nextIde };
    });
    sendToExtension({ type: 'action:setupIde', id, ideId: ideId as any });
  },

  setupAll: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:setupAll', id });
  },

  refresh: () => {
    const id = randomId();
    sendToExtension({ type: 'action:refresh', id });
  },

  login: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:login', id });
  },

  logout: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:logout', id });
  },

  status: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:status', id });
  },

  saveCredentials: (email, password, otpSecret) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:saveCredentials', id, email, password, otpSecret });
  },

  installBrowser: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:install-browser', id });
  },

  removeBrowser: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:removeBrowser', id });
  },

  markActionDone: (id, _ok) => {
    set(s => {
      const next = new Set(s.pendingActions);
      next.delete(id);
      const nextIde = new Map(s.pendingIdeActions);
      for (const [ideId, actionId] of nextIde) {
        if (actionId === id) { nextIde.delete(ideId); break; }
      }
      return { pendingActions: next, pendingIdeActions: nextIde };
    });
  },
}));
