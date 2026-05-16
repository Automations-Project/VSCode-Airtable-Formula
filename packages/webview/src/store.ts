import { create } from 'zustand';
import type { DashboardState, IdeStatus, SettingsSnapshot, AuthState, TunnelProviderId, PromptDef } from '@shared/types.js';
import { sendToExtension } from './lib/vscode.js';
import { randomId } from './lib/utils.js';

interface Store extends DashboardState {
  activeTab: 'overview' | 'setup' | 'prompts' | 'settings';
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
  unconfigureIde: (ideId: string) => void;
  debugStartSession: () => void;
  debugStopAndExport: () => void;
  debugExport: () => void;
  markActionDone: (id: string, ok: boolean) => void;
  manualLogin: () => void;
  backupSession: () => void;
  restoreSession: () => void;
  selectCustomBrowser: () => void;
  setBrowserChoice: (choice: import('@shared/types.js').BrowserChoice) => void;
  openStoragePath: (path: string) => void;
  enableTunnel: (provider: TunnelProviderId, authtoken?: string, domain?: string) => void;
  disableTunnel: () => void;
  setNgrokAuthtoken: (authtoken: string) => void;
  startDaemon: () => void;
  stopDaemon: () => void;
  restartDaemon: () => void;
  copyBearerToken: () => void;
  rotateToken: () => void;
  saveAirtablePat: (pat: string) => void;
  copyAirtablePat: () => void;
  configureOfficialAirtable: (ideId: import('@shared/types.js').IdeId) => void;
  unconfigureOfficialAirtable: (ideId: import('@shared/types.js').IdeId) => void;
  savePrompt: (prompt: PromptDef) => void;
  deletePrompt: (name: string) => void;
  resetPrompt: (name: string) => void;
}

const defaultSettings: SettingsSnapshot = {
  mcp:     {
    autoConfigureOnInstall: true,
    notifyOnUpdates:        true,
    toolProfile: {
      profile:      'safe-write',
      enabledCount: 48,
      totalCount:   62,
      categories: {
        read: true, tableWrite: true, tableDestructive: true,
        fieldWrite: true, fieldDestructive: true,
        viewWrite: true, viewDestructive: true,
        viewSection: true, viewSectionDestructive: true,
        formWrite: true, extension: true,
      },
    },
    serverSource: 'bundled' as const,
  },
  ai:      { autoInstallFiles: true, includeAgents: false },
  formula: { formatterVersion: 'v2' },
  script:  { beautifyStyle: 'default', minifyLevel: 'standard' },
  auth:    { autoRefresh: true, refreshIntervalHours: 12, loginMode: 'manual' as const, browserChoice: undefined },
  debug:   { enabled: false, verboseHttp: false, bufferSize: 1000 },
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
    // Auth merge rules:
    //   1. hasCredentials is STICKY — once true, it stays true until an
    //      explicit logout (auth:state channel with hasCredentials:false).
    //      This prevents a stale state:update (e.g. during extension cold
    //      start, before AuthManager.init() finishes) from clobbering a
    //      known-good credential state.
    //   2. The auth:state channel is authoritative for status/userId/browser
    //      — if s.auth.status !== 'unknown' we already have a richer state
    //      than what state:update can provide, so keep it.
    const incomingAuth = state.auth ?? defaultAuth;
    const currentAuth = s.auth ?? defaultAuth;
    const auth =
      currentAuth.status !== 'unknown'
        ? currentAuth
        : { ...incomingAuth, hasCredentials: currentAuth.hasCredentials || incomingAuth.hasCredentials };
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

  unconfigureIde: (ideId) => {
    const id = randomId();
    set(s => {
      const nextPending = new Set([...s.pendingActions, id]);
      const nextIde = new Map(s.pendingIdeActions);
      nextIde.set(ideId, id);
      return { pendingActions: nextPending, pendingIdeActions: nextIde };
    });
    sendToExtension({ type: 'action:unconfigureIde', id, ideId: ideId as any });
  },

  debugStartSession: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:debug.startSession', id });
  },

  debugStopAndExport: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:debug.stopAndExport', id });
  },

  debugExport: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:debug.export', id });
  },

  manualLogin: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:manualLogin', id });
  },

  backupSession: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:backupSession', id });
  },

  restoreSession: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:restoreSession', id });
  },

  selectCustomBrowser: () => {
    const id = randomId();
    sendToExtension({ type: 'action:selectCustomBrowser', id });
  },

  setBrowserChoice: (choice) => {
    const id = randomId();
    sendToExtension({ type: 'action:setBrowserChoice', id, choice });
  },

  openStoragePath: (p) => {
    const id = randomId();
    sendToExtension({ type: 'action:openStoragePath', id, path: p });
  },

  enableTunnel: (provider, authtoken, domain) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'tunnel:enable', id, provider, authtoken, domain });
  },

  disableTunnel: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'tunnel:disable', id });
  },

  setNgrokAuthtoken: (authtoken) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'tunnel:set-ngrok-authtoken', id, authtoken });
  },

  startDaemon: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'daemon:start', id });
  },

  stopDaemon: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'daemon:stop', id });
  },

  restartDaemon: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'daemon:restart', id });
  },

  copyBearerToken: () => {
    const id = randomId();
    sendToExtension({ type: 'daemon:copy-bearer-token', id });
  },

  rotateToken: () => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'daemon:rotate-token', id });
  },

  saveAirtablePat: (pat) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:save-airtable-pat', id, pat });
  },

  copyAirtablePat: () => {
    const id = randomId();
    sendToExtension({ type: 'action:copy-airtable-pat', id });
  },

  configureOfficialAirtable: (ideId) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:configure-official-airtable', id, ideId });
  },

  unconfigureOfficialAirtable: (ideId) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:unconfigure-official-airtable', id, ideId });
  },

  savePrompt: (prompt) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:save-prompt', id, prompt });
  },

  deletePrompt: (name) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:delete-prompt', id, name });
  },

  resetPrompt: (name) => {
    const id = randomId();
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    sendToExtension({ type: 'action:reset-prompt', id, name });
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
