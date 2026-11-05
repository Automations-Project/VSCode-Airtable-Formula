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
import type { WebviewBrowserChoice, WebviewMessage, WebviewSettingChange } from '@shared/messages.js';
import { getPersistedState, sendToExtension, setPersistedState } from './lib/vscode.js';
import { requestHostConfirmation } from './lib/confirmation.js';
import { randomId } from './lib/utils.js';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

/**
 * Scope keys for `pendingScoped` (actionId -> scope). A scope names the thing an
 * in-flight action works on, so controls derive disabled/aria-busy from the
 * store and the guard survives a tab switch or remount:
 *   session:<kind>        login, logout, check, credentials, cookie, backup, restore (mutually exclusive)
 *   browser:download:<k>  bundled Chromium install / remove
 *   browser:choice:<k>    browser selection: pick (native file dialog) / select
 *   setting:<key>         one Settings row
 *   storage:open:<id>     one storage entry being opened
 *   debug:<kind>          start / stop / export of a debug session (mutually exclusive; export opens a save dialog)
 */
/** Matches a key EXACTLY, or any scope nested under it (key + ':' ...). Never a bare string prefix:
 *  'setting:mcp.category:viewSection' must not match '...:viewSectionDestructive'. */
export function scopePending(pending: ReadonlyMap<string, string>, key: string): boolean {
  for (const scope of pending.values()) {
    if (scope === key || scope.startsWith(key + ':')) return true;
  }
  return false;
}

export function settingScope(change: WebviewSettingChange): string {
  return change.key === 'mcp.category' ? `setting:${change.key}:${change.category}` : `setting:${change.key}`;
}

interface Store extends DashboardState {
  activeTab: DashboardTabId;
  pendingActions: Set<string>;
  /** In-flight actions by scope (see `scopePending`). Cleared on every settle path. */
  pendingScoped: Map<string, string>;
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
  /** True while the Prompts editor holds edits that differ from what is saved.
   *  Lives in the store so every way of leaving the tab can consult it. */
  promptEditorDirty: boolean;
  /** A discard confirmation is open; a second request is refused, not queued. */
  promptDiscardPending: boolean;
  setPromptEditorDirty: (dirty: boolean) => void;
  /** Runs `navigate` now when nothing is unsaved, otherwise only after the host
   *  confirms discarding. Resolves true when `navigate` ran. */
  guardPromptNavigation: (navigate: () => void) => Promise<boolean>;
  setTab: (tab: Store['activeTab']) => void;
  hydratePersistedState: () => void;
  applyState: (state: DashboardState) => void;
  applyIdeStatus: (statuses: IdeStatus[]) => void;
  applyAuthState: (state: AuthState) => void;
  setupIde: (ideId: IdeId) => void;
  setupAll: () => void;
  refresh: () => void;
  /** Scoped actions return their action id, or null when refused because a
   *  conflicting action is already in flight. */
  login: () => string | null;
  logout: () => string | null;
  status: () => string | null;
  saveCredentials: (email: string, password: string, otpSecret: string) => string | null;
  saveCookie: (cookie: string) => string | null;
  clearCookie: () => string | null;
  installBrowser: () => string | null;
  removeBrowser: () => string | null;
  unconfigureIde: (ideId: IdeId) => void;
  /** Return the action id, or null when another debug action is already in flight. */
  debugStartSession: () => string | null;
  debugStopAndExport: () => string | null;
  debugExport: () => string | null;
  markActionDone: (id: string, outcome: ActionOutcome) => void;
  manualLogin: () => string | null;
  backupSession: () => string | null;
  restoreSession: () => string | null;
  selectCustomBrowser: () => string | null;
  setBrowserChoice: (choice: WebviewBrowserChoice) => string | null;
  openStoragePath: (entryId: StorageEntryId) => string | null;
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

  /** beginAction + membership in the scoped pending map. */
  const beginScoped = (id: string, scope: string, timeoutMs?: number) => {
    beginAction(id, timeoutMs);
    set(s => ({ pendingScoped: new Map(s.pendingScoped).set(id, scope) }));
  };

  /** Start a scoped action unless one of `conflicts` (scope prefixes) is in flight. */
  const runScoped = (
    scope: string,
    conflicts: string[],
    timeoutMs: number | undefined,
    message: (id: string) => WebviewMessage,
  ): string | null => {
    const pending = get().pendingScoped;
    if (conflicts.some(key => scopePending(pending, key))) return null;
    const id = randomId();
    beginScoped(id, scope, timeoutMs);
    sendToExtension(message(id));
    return id;
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
  pendingScoped: new Map(),
  pendingIdeActions: new Map(),
  pendingDaemonActions: new Set(),
  pendingSetupAll: new Set(),
  pendingTunnelActions: new Set(),
  pendingOfficialActions: new Set(),
  promptEditorDirty: false,
  promptDiscardPending: false,

  setPromptEditorDirty: (dirty) => {
    if (get().promptEditorDirty !== dirty) set({ promptEditorDirty: dirty });
  },

  guardPromptNavigation: async (navigate) => {
    if (!get().promptEditorDirty) {
      navigate();
      return true;
    }
    if (get().promptDiscardPending) return false;

    set({ promptDiscardPending: true });
    let confirmed = false;
    try {
      confirmed = await requestHostConfirmation('discard-prompt-edits');
    } finally {
      set({ promptDiscardPending: false });
    }
    if (!confirmed) return false;

    set({ promptEditorDirty: false });
    navigate();
    return true;
  },

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

  // Installing or removing the bundled Chromium also excludes a login: it would drive that very browser.
  // Session actions share one in-flight slot: login vs logout, restore vs backup
  // and credential saves all touch the same session files, so a second is refused.
  // Auto-login drives a real browser — can legitimately take minutes.
  login: () => runScoped('session:login', ['session', 'browser:download'], 360_000, id => ({ type: 'action:login', id })),

  logout: () => runScoped('session:logout', ['session'], undefined, id => ({ type: 'action:logout', id })),

  status: () => runScoped('session:check', ['session'], undefined, id => ({ type: 'action:status', id })),

  saveCredentials: (email, password, otpSecret) =>
    runScoped('session:credentials', ['session'], undefined, id => (
      { type: 'action:saveCredentials', id, email, password, otpSecret }
    )),

  // Cookie mutations use the same tracked action lifecycle as every other
  // host mutation; the host also refreshes auth state after completion.
  saveCookie: (cookie) =>
    runScoped('session:cookie', ['session'], undefined, id => ({ type: 'auth:saveCookie', id, cookie })),
  clearCookie: () =>
    runScoped('session:cookie', ['session'], undefined, id => ({ type: 'auth:clearCookie', id })),

  // Chromium download can take minutes on slow connections.
  installBrowser: () =>
    runScoped('browser:download:install', ['browser:download', 'session:login'], 600_000, id => (
      { type: 'action:install-browser', id }
    )),

  removeBrowser: () =>
    runScoped('browser:download:remove', ['browser:download', 'session:login'], undefined, id => (
      { type: 'action:removeBrowser', id }
    )),

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

  // Stop & Export and Export wait on a native save dialog.
  debugStartSession: () =>
    runScoped('debug:start', ['debug'], 600_000, id => ({ type: 'action:debug.startSession', id })),

  debugStopAndExport: () =>
    runScoped('debug:stop', ['debug'], 600_000, id => ({ type: 'action:debug.stopAndExport', id })),

  debugExport: () =>
    runScoped('debug:export', ['debug'], 600_000, id => ({ type: 'action:debug.export', id })),

  // Manual login waits for the user to finish in the browser (up to ~5.5m).
  manualLogin: () => runScoped('session:login', ['session', 'browser:download'], 360_000, id => ({ type: 'action:manualLogin', id })),

  // Backup and restore wait on native dialogs (restore also on a host confirmation).
  backupSession: () =>
    runScoped('session:backup', ['session'], 600_000, id => ({ type: 'action:backupSession', id })),

  restoreSession: () =>
    runScoped('session:restore', ['session'], 600_000, id => ({ type: 'action:restoreSession', id })),

  // Long timeout — the native file dialog stays open until the user acts. It
  // shares a scope with the dropdown because both change the one browser choice.
  selectCustomBrowser: () =>
    runScoped('browser:choice:pick', ['browser:choice'], 600_000, id => (
      { type: 'action:selectCustomBrowser', id }
    )),

  setBrowserChoice: (choice) =>
    runScoped('browser:choice:select', ['browser:choice'], undefined, id => (
      { type: 'action:setBrowserChoice', id, choice }
    )),

  openStoragePath: (entryId) =>
    runScoped(`storage:open:${entryId}`, [`storage:open:${entryId}`], undefined, id => (
      { type: 'action:openStoragePath', id, entryId }
    )),

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
    beginScoped(id, settingScope(change));
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
      const nextScoped = new Map(s.pendingScoped);
      nextScoped.delete(id);
      return {
        pendingActions: next,
        pendingScoped: nextScoped,
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
