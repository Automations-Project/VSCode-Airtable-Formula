import { create } from 'zustand';
import type { DashboardState, IdeStatus, SettingsSnapshot } from '@shared/types.js';
import { sendToExtension } from './lib/vscode.js';
import { randomId } from './lib/utils.js';

interface Store extends DashboardState {
  activeTab: 'overview' | 'setup' | 'settings';
  pendingActions: Set<string>;
  setTab: (tab: Store['activeTab']) => void;
  applyState: (state: DashboardState) => void;
  setupIde: (ideId: string) => void;
  setupAll: () => void;
  refresh: () => void;
  markActionDone: (id: string, ok: boolean) => void;
}

const defaultSettings: SettingsSnapshot = {
  mcp:     { autoConfigureOnInstall: true, notifyOnUpdates: true },
  ai:      { autoInstallFiles: true, includeAgents: false },
  formula: { formatterVersion: 'v2' },
};

export const useStore = create<Store>((set, get) => ({
  ideStatuses: [],
  mcpVersion: '—',
  aiFilesCount: 0,
  loading: true,
  settings: defaultSettings,
  activeTab: 'overview',
  pendingActions: new Set(),

  setTab: (tab) => set({ activeTab: tab }),
  applyState: (state) => set({ ...state, loading: false }),

  setupIde: (ideId) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
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

  markActionDone: (id, _ok) => {
    set(s => {
      const next = new Set(s.pendingActions);
      next.delete(id);
      return { pendingActions: next };
    });
  },
}));
