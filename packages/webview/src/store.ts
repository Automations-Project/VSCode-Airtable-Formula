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
 *   prompt:<kind>:<name>  save / delete / reset of one prompt. Every prompt action conflicts with every
 *                         other one: the host rewrites the single prompts.json read-modify-write, so two
 *                         in flight could lose one update. Nothing outside Prompts conflicts with them.
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
  /** An AI skill install or remove in flight, wherever it was started. One flag for
   *  both: they rewrite the same skill folders, so a second is refused. */
  pendingSkill: boolean;
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
  /** Editor actions return their id, or null when refused: one editor's own action, or
   *  setup-all against any per-editor action (in both directions), is already in flight. */
  setupIde: (ideId: IdeId) => string | null;
  setupAll: () => string | null;
  /** Scope-wide skill actions; null when a skill action is already in flight. */
  installSkill: () => string | null;
  removeSkill: () => string | null;
  refresh: () => string;
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
  unconfigureIde: (ideId: IdeId) => string | null;
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
  /** Setup actions return their id (for per-control outcomes), or null when refused
   *  because a conflicting action of the same kind is already in flight. */
  enableTunnel: (provider: TunnelProviderId, authtoken?: string, domain?: string) => string | null;
  disableTunnel: () => string | null;
  setNgrokAuthtoken: (authtoken: string) => string | null;
  startDaemon: () => string | null;
  stopDaemon: () => string | null;
  restartDaemon: () => string | null;
  copyBearerToken: () => string;
  rotateToken: () => string | null;
  saveAirtablePat: (pat: string) => string | null;
  copyAirtablePat: () => string | null;
  configureOfficialAirtable: (ideId: IdeId) => string | null;
  unconfigureOfficialAirtable: (ideId: IdeId) => string | null;
  /** Prompt actions return their action id so callers can await completion
   *  (via pendingActions + consumeActionResult) before navigating away, or null
   *  when refused: another prompt action, or a discard confirmation, is in flight. */
  savePrompt: (prompt: PromptDef) => string | null;
  deletePrompt: (name: string) => string | null;
  resetPrompt: (name: string) => string | null;
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
      enabledCount: 55,
      totalCount:   73,
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
  ai:      { autoInstallFiles: true, installScope: 'global' },
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
// First-time tunnel enable downloads cloudflared or runs the named-tunnel wizard.
export const TUNNEL_ENABLE_TIMEOUT_MS = 360_000;
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
  const beginTunnelAction = (id: string, timeoutMs?: number) => {
    beginAction(id, timeoutMs);
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

  /** One editor's setup/update/remove, unless that editor or a setup-all is in flight. */
  const runIdeAction = (ideId: IdeId, message: (id: string) => WebviewMessage): string | null => {
    const { pendingIdeActions, pendingSetupAll } = get();
    if (pendingIdeActions.has(ideId) || pendingSetupAll.size > 0) return null;
    const id = randomId();
    beginAction(id);
    set(s => ({ pendingIdeActions: new Map(s.pendingIdeActions).set(ideId, id) }));
    sendToExtension(message(id));
    return id;
  };

  /** Start an action in one exclusive pending set, unless that set already holds one. */
  const runExclusive = (
    held: () => ReadonlySet<string>,
    begin: (id: string) => void,
    message: (id: string) => WebviewMessage,
  ): string | null => {
    if (held().size > 0) return null;
    const id = randomId();
    begin(id);
    sendToExtension(message(id));
    return id;
  };

  const runTunnelAction = (message: (id: string) => WebviewMessage, timeoutMs?: number) =>
    runExclusive(() => get().pendingTunnelActions, id => beginTunnelAction(id, timeoutMs), message);

  const runOfficialAction = (message: (id: string) => WebviewMessage) =>
    runExclusive(() => get().pendingOfficialActions, beginOfficialAction, message);

  const runDaemonAction = (timeoutMs: number | undefined, message: (id: string) => WebviewMessage) =>
    runExclusive(() => get().pendingDaemonActions, id => beginDaemonAction(id, timeoutMs), message);

  /** A prompt action, unless another prompt action or a discard confirmation is in flight. */
  const runPromptAction = (scope: string, message: (id: string) => WebviewMessage): string | null =>
    get().promptDiscardPending ? null : runScoped(scope, ['prompt'], undefined, message);

  /** The id behind `pendingSkill`, so markActionDone clears the flag on that action's result only. */
  let skillActionId: string | null = null;
  const runSkillAction = (message: (id: string) => WebviewMessage): string | null => {
    if (get().pendingSkill) return null;
    const id = randomId();
    skillActionId = id;
    beginAction(id);
    set({ pendingSkill: true });
    sendToExtension(message(id));
    return id;
  };

  return ({
  ideStatuses: [],
  versions: { extension: '—', mcpServerBundled: '—' },
  aiSkillCount: 0,
  aiSkillClients: [],
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
  pendingSkill: false,
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

  setupIde: (ideId) => runIdeAction(ideId, id => ({ type: 'action:setupIde', id, ideId })),

  // Setup-all rewrites every detected editor, so it never overlaps a per-editor action.
  setupAll: () => {
    const { pendingSetupAll, pendingIdeActions } = get();
    if (pendingSetupAll.size > 0 || pendingIdeActions.size > 0) return null;
    const id = randomId();
    beginSetupAllAction(id);
    sendToExtension({ type: 'action:setupAll', id });
    return id;
  },

  installSkill: () => runSkillAction(id => ({ type: 'action:installSkill', id })),

  removeSkill: () => runSkillAction(id => ({ type: 'action:removeSkill', id })),

  refresh: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'action:refresh', id });
    return id;
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

  unconfigureIde: (ideId) => runIdeAction(ideId, id => ({ type: 'action:unconfigureIde', id, ideId })),

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
  enableTunnel: (provider, authtoken, domain) =>
    runTunnelAction(id => ({ type: 'tunnel:enable', id, provider, authtoken, domain }), TUNNEL_ENABLE_TIMEOUT_MS),

  disableTunnel: () => runTunnelAction(id => ({ type: 'tunnel:disable', id })),

  setNgrokAuthtoken: (authtoken) =>
    runTunnelAction(id => ({ type: 'tunnel:set-ngrok-authtoken', id, authtoken })),

  startDaemon: () => runDaemonAction(undefined, id => ({ type: 'daemon:start', id })),

  // Graceful wait (10s) + kill escalation (3s) can exceed the default expiry.
  stopDaemon: () => runDaemonAction(30_000, id => ({ type: 'daemon:stop', id })),

  restartDaemon: () => runDaemonAction(45_000, id => ({ type: 'daemon:restart', id })),

  copyBearerToken: () => {
    const id = randomId();
    beginAction(id);
    sendToExtension({ type: 'daemon:copy-bearer-token', id });
    return id;
  },

  // Daemon-scoped: rotating invalidates connected clients, so daemon
  // controls should reflect the in-flight rotation too.
  rotateToken: () => runDaemonAction(undefined, id => ({ type: 'daemon:rotate-token', id })),

  // Official-Airtable actions share one in-flight slot: they all touch the same
  // PAT / editor config files, so overlapping ones are dropped.
  saveAirtablePat: (pat) => runOfficialAction(id => ({ type: 'action:save-airtable-pat', id, pat })),

  copyAirtablePat: () => runOfficialAction(id => ({ type: 'action:copy-airtable-pat', id })),

  configureOfficialAirtable: (ideId) =>
    runOfficialAction(id => ({ type: 'action:configure-official-airtable', id, ideId })),

  unconfigureOfficialAirtable: (ideId) =>
    runOfficialAction(id => ({ type: 'action:unconfigure-official-airtable', id, ideId })),

  savePrompt: (prompt) =>
    runPromptAction(`prompt:save:${prompt.name}`, id => ({ type: 'action:save-prompt', id, prompt })),

  deletePrompt: (name) =>
    runPromptAction(`prompt:delete:${name}`, id => ({ type: 'action:delete-prompt', id, name })),

  resetPrompt: (name) =>
    runPromptAction(`prompt:reset:${name}`, id => ({ type: 'action:reset-prompt', id, name })),

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
    const skillSettled = id === skillActionId;
    if (skillSettled) skillActionId = null;
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
        pendingSkill: skillSettled ? false : s.pendingSkill,
      };
    });
  },
  });
});
