import { create } from 'zustand';
import type {
  AuthState,
  DashboardState,
  DashboardTabId,
  IdeId,
  IdeStatus,
  PromptDef,
  SettingsSnapshot,
  StorageEntryId,
  TunnelProviderId,
  WebviewLinkId,
} from '@shared/types.js';
import type { WebviewBrowserChoice, WebviewSettingChange } from '@shared/messages.js';
import { getPersistedState, sendToExtension, setPersistedState } from './lib/vscode.js';
import { randomId } from './lib/utils.js';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

interface Store extends DashboardState {
  activeTab: DashboardTabId;
  pendingActions: Set<string>;
  pendingIdeActions: Map<string, string>; // ideId → actionId
  /** Daemon start/stop/restart in flight — daemon controls disable on THIS,
   *  not on the global pendingActions, so an unrelated slow action (e.g. an
   *  open file dialog) can't lock the user out of stopping the daemon. */
  pendingDaemonActions: Set<string>;
  /** Setup-all in flight, wherever it was started (Overview or Setup). Lives in
   *  the store so the guard survives tab switches and spans both entry points. */
  pendingSetupAll: Set<string>;
  /** Tunnel enable/disable/token-save in flight. Held here (not in component
   *  state) so the duplicate-action guard survives a tab switch. */
  pendingTunnelActions: Set<string>;
  /** Official Airtable MCP work (PAT save/copy, per-editor configure/remove) in flight. */
  pendingOfficialActions: Set<string>;
  setTab: (tab: Store['activeTab']) => void;
  hydratePersistedState: () => void;
  applyState: (state: DashboardState) => void;
  applyIdeStatus: (statuses: IdeStatus[]) => void;
  applyAuthState: (state: AuthState) => void;
  setupIde: (ideId: IdeId) => void;
  setupAll: () => void;
  refresh: () => void;
  login: () => void;
  logout: () => void;
  status: () => void;
  saveCredentials: (email: string, password: string, otpSecret: string) => void;
  saveCookie: (cookie: string) => string;
  clearCookie: () => string;
  installBrowser: () => void;
  removeBrowser: () => void;
  unconfigureIde: (ideId: IdeId) => void;
  debugStartSession: () => void;
  debugStopAndExport: () => void;
  debugExport: () => void;
  markActionDone: (id: string, outcome: ActionOutcome) => void;
  manualLogin: () => void;
  backupSession: () => void;
  restoreSession: () => void;
  selectCustomBrowser: () => void;
  setBrowserChoice: (choice: WebviewBrowserChoice) => string;
  openStoragePath: (entryId: StorageEntryId) => string;
  openLink: (link: WebviewLinkId) => string;
  openIdeDocs: (ideId: IdeId) => string;
  openToolConfig: () => string;
  changeSetting: (change: WebviewSettingChange) => string;
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
  /** Prompt actions return their action id so callers can await completion
   *  (via pendingActions + consumeActionResult) before navigating away. */
  savePrompt: (prompt: PromptDef) => string;
  deletePrompt: (name: string) => string;
  resetPrompt: (name: string) => string;
  /** Read and clear the bounded outcome recorded by markActionDone. Undefined
   *  when no result was recorded (e.g. id unknown). */
  consumeActionResult: (id: string) => ActionOutcome | undefined;
}

const defaultSettings: SettingsSnapshot = {
  mcp:     {
    autoConfigureOnInstall: true,
    notifyOnUpdates:        true,
    toolProfile: {
      profile:      'safe-write',
      enabledCount: 54,
      totalCount:   72,
      categories: {
        read: true, recordRead: true, tableWrite: true, tableDestructive: true,
        fieldWrite: true, fieldDestructive: true, recordDestructive: false,
        viewWrite: true, viewDestructive: true,
        viewSection: true, viewSectionDestructive: true,
        formWrite: true, extension: true, recordWrite: true,
        sync: false, daemon: false, localWrite: true,
      },
    },
    serverSource: 'bundled' as const,
    daemonPort:   8723,
    authMode:     'browser' as const,
    httpClient:   'fetch' as const,
    useDaemon:    true,
    browserIdleParkMinutes: 30,
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
  hasCookie: false,
};

// If the extension never answers (host crash, lost message, webview reload),
// pending actions must not keep buttons disabled forever — auto-expire them.
const PENDING_TIMEOUT_MS = 60_000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Per-action outcomes recorded by markActionDone, consumed by components that
// wait for confirmation before navigating (PromptEditor). Bounded — unclaimed
// results from fire-and-forget actions are evicted oldest-first.
const actionResults = new Map<string, ActionOutcome>();
const ACTION_RESULTS_MAX = 50;

export const useStore = create<Store>((set, get) => {
  /** Track an in-flight action and schedule its auto-expiry. */
  const beginAction = (id: string, timeoutMs = PENDING_TIMEOUT_MS) => {
    set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
    pendingTimers.set(id, setTimeout(() => {
      pendingTimers.delete(id);
      get().markActionDone(id, { ok: false });
    }, timeoutMs));
  };

  /** beginAction + membership in the daemon-specific pending set. */
  const beginDaemonAction = (id: string, timeoutMs?: number) => {
    beginAction(id, timeoutMs);
    set(s => ({ pendingDaemonActions: new Set([...s.pendingDaemonActions, id]) }));
  };

  /** beginAction + membership in the setup-all pending set. */
  const beginSetupAllAction = (id: string) => {
    beginAction(id);
    set(s => ({ pendingSetupAll: new Set([...s.pendingSetupAll, id]) }));
  };

  /** beginAction + membership in the tunnel pending set. */
  const beginTunnelAction = (id: string) => {
    beginAction(id);
    set(s => ({ pendingTunnelActions: new Set([...s.pendingTunnelActions, id]) }));
  };

  /** beginAction + membership in the official-Airtable pending set. */
  const beginOfficialAction = (id: string) => {
    beginAction(id);
    set(s => ({ pendingOfficialActions: new Set([...s.pendingOfficialActions, id]) }));
  };

  return ({
  ideStatuses: [],
  versions: { extension: '—', mcpServerBundled: '—' },
  aiFilesCount: 0,
  loading: true,
  settings: defaultSettings,
  auth: defaultAuth,
  prompts: { prompts: [] },
  activeTab: 'overview',
  pendingActions: new Set(),
  pendingIdeActions: new Map(),
  pendingDaemonActions: new Set(),
  pendingSetupAll: new Set(),
  pendingTunnelActions: new Set(),
  pendingOfficialActions: new Set(),

  setTab: (tab) => {
    set({ activeTab: tab });
    setPersistedState({ activeTab: tab });
  },
  hydratePersistedState: () => {
    const persisted = getPersistedState();
    if (persisted?.activeTab) set({ activeTab: persisted.activeTab });
  },
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
        : {
            ...incomingAuth,
            // hasCredentials AND hasCookie are both sticky — a stale state:update
            // during cold start must not clobber a known-good saved-credential flag.
            hasCredentials: currentAuth.hasCredentials || incomingAuth.hasCredentials,
            hasCookie: currentAuth.hasCookie || incomingAuth.hasCookie,
          };
    return { ...state, auth, loading: false };
  }),
  applyIdeStatus: (statuses) => set({ ideStatuses: statuses }),
  applyAuthState: (state) => set({ auth: state }),

  setupIde: (ideId) => {
    const id = randomId();
    beginAction(id);
    set(s => {
      const nextIde = new Map(s.pendingIdeActions);
      nextIde.set(ideId, id);
      return { pendingIdeActions: nextIde };
    });
    sendToExtension({ type: 'action:setupIde', id, ideId });
  },

  setupAll: () => {
    const id = randomId();
    beginSetupAllAction(id);
    sendToExtension({ type: 'action:setupAll', id });
  },

  refresh: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:refresh', id });
  },

  login: () => {
    const id = randomId();
    // Auto-login drives a real browser — can legitimately take minutes.
    beginAction(id, 360_000);
    sendToExtension({ type: 'action:login', id });
  },

  logout: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:logout', id });
  },

  status: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:status', id });
  },

  saveCredentials: (email, password, otpSecret) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:saveCredentials', id, email, password, otpSecret });
  },

  // Cookie mutations use the same tracked action lifecycle as every other
  // host mutation; the host also refreshes auth state after completion.
  saveCookie: (cookie) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'auth:saveCookie', id, cookie });
    return id;
  },
  clearCookie: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'auth:clearCookie', id });
    return id;
  },

  installBrowser: () => {
    const id = randomId();
    // Chromium download can take minutes on slow connections.
    beginAction(id, 600_000);
    sendToExtension({ type: 'action:install-browser', id });
  },

  removeBrowser: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:removeBrowser', id });
  },

  unconfigureIde: (ideId) => {
    const id = randomId();
    beginAction(id);
    set(s => {
      const nextIde = new Map(s.pendingIdeActions);
      nextIde.set(ideId, id);
      return { pendingIdeActions: nextIde };
    });
    sendToExtension({ type: 'action:unconfigureIde', id, ideId });
  },

  debugStartSession: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:debug.startSession', id });
  },

  debugStopAndExport: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:debug.stopAndExport', id });
  },

  debugExport: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:debug.export', id });
  },

  manualLogin: () => {
    const id = randomId();
    // Manual login waits for the user to finish in the browser (up to ~5.5m).
    beginAction(id, 360_000);
    sendToExtension({ type: 'action:manualLogin', id });
  },

  backupSession: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:backupSession', id });
  },

  restoreSession: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:restoreSession', id });
  },

  selectCustomBrowser: () => {
    const id = randomId();
    // Long timeout — the native file dialog stays open until the user acts.
    beginAction(id, 600_000);
    sendToExtension({ type: 'action:selectCustomBrowser', id });
  },

  setBrowserChoice: (choice) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:setBrowserChoice', id, choice });
    return id;
  },

  openStoragePath: (entryId) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:openStoragePath', id, entryId });
    return id;
  },

  openLink: (link) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:openLink', id, link });
    return id;
  },

  openIdeDocs: (ideId) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:openIdeDocs', id, ideId });
    return id;
  },

  openToolConfig: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:openToolConfig', id });
    return id;
  },

  changeSetting: (change) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'setting:change', id, change });
    return id;
  },

  // Tunnel actions are mutually exclusive: a second one while one is in flight
  // is dropped, so a double click can never start two tunnels.
  enableTunnel: (provider, authtoken, domain) => {
    if (get().pendingTunnelActions.size > 0) return;
    const id = randomId();
    beginTunnelAction(id);
    sendToExtension({ type: 'tunnel:enable', id, provider, authtoken, domain });
  },

  disableTunnel: () => {
    if (get().pendingTunnelActions.size > 0) return;
    const id = randomId();
    beginTunnelAction(id);
    sendToExtension({ type: 'tunnel:disable', id });
  },

  setNgrokAuthtoken: (authtoken) => {
    if (get().pendingTunnelActions.size > 0) return;
    const id = randomId();
    beginTunnelAction(id);
    sendToExtension({ type: 'tunnel:set-ngrok-authtoken', id, authtoken });
  },

  startDaemon: () => {
    const id = randomId();
    beginDaemonAction(id);
    sendToExtension({ type: 'daemon:start', id });
  },

  stopDaemon: () => {
    // Graceful wait (10s) + kill escalation (3s) can exceed the default expiry.
    const id = randomId();
    beginDaemonAction(id, 30_000);
    sendToExtension({ type: 'daemon:stop', id });
  },

  restartDaemon: () => {
    const id = randomId();
    beginDaemonAction(id, 45_000);
    sendToExtension({ type: 'daemon:restart', id });
  },

  copyBearerToken: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'daemon:copy-bearer-token', id });
  },

  rotateToken: () => {
    // Daemon-scoped: rotating invalidates connected clients, so daemon
    // controls should reflect the in-flight rotation too.
    const id = randomId();
    beginDaemonAction(id);
    sendToExtension({ type: 'daemon:rotate-token', id });
  },

  // Official-Airtable actions share one in-flight slot: they all touch the same
  // PAT / editor config files, so overlapping ones are dropped.
  saveAirtablePat: (pat) => {
    if (get().pendingOfficialActions.size > 0) return;
    const id = randomId();
    beginOfficialAction(id);
    sendToExtension({ type: 'action:save-airtable-pat', id, pat });
  },

  copyAirtablePat: () => {
    if (get().pendingOfficialActions.size > 0) return;
    const id = randomId();
    beginOfficialAction(id);
    sendToExtension({ type: 'action:copy-airtable-pat', id });
  },

  configureOfficialAirtable: (ideId) => {
    if (get().pendingOfficialActions.size > 0) return;
    const id = randomId();
    beginOfficialAction(id);
    sendToExtension({ type: 'action:configure-official-airtable', id, ideId });
  },

  unconfigureOfficialAirtable: (ideId) => {
    if (get().pendingOfficialActions.size > 0) return;
    const id = randomId();
    beginOfficialAction(id);
    sendToExtension({ type: 'action:unconfigure-official-airtable', id, ideId });
  },

  savePrompt: (prompt) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:save-prompt', id, prompt });
    return id;
  },

  deletePrompt: (name) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:delete-prompt', id, name });
    return id;
  },

  resetPrompt: (name) => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:reset-prompt', id, name });
    return id;
  },

  consumeActionResult: (id) => {
    const result = actionResults.get(id);
    actionResults.delete(id);
    return result;
  },

  markActionDone: (id, outcome) => {
    const timer = pendingTimers.get(id);
    if (timer) { clearTimeout(timer); pendingTimers.delete(id); }
    actionResults.set(id, outcome);
    while (actionResults.size > ACTION_RESULTS_MAX) {
      const oldest = actionResults.keys().next().value;
      if (oldest === undefined) break;
      actionResults.delete(oldest);
    }
    set(s => {
      const next = new Set(s.pendingActions);
      next.delete(id);
      const nextIde = new Map(s.pendingIdeActions);
      for (const [ideId, actionId] of nextIde) {
        if (actionId === id) { nextIde.delete(ideId); break; }
      }
      const nextDaemon = new Set(s.pendingDaemonActions);
      nextDaemon.delete(id);
      const nextSetupAll = new Set(s.pendingSetupAll);
      nextSetupAll.delete(id);
      const nextTunnel = new Set(s.pendingTunnelActions);
      nextTunnel.delete(id);
      const nextOfficial = new Set(s.pendingOfficialActions);
      nextOfficial.delete(id);
      return {
        pendingActions: next,
        pendingIdeActions: nextIde,
        pendingDaemonActions: nextDaemon,
        pendingSetupAll: nextSetupAll,
        pendingTunnelActions: nextTunnel,
        pendingOfficialActions: nextOfficial,
      };
    });
  },
  });
});
