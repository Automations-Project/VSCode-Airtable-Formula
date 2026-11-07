import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/vscode.js', () => ({
  sendToExtension: vi.fn(),
  onExtensionMessage: vi.fn(() => () => {}),
  getPersistedState: vi.fn(),
  setPersistedState: vi.fn(),
}));

import { scopePending, TUNNEL_ENABLE_TIMEOUT_MS, useStore } from '../store.js';
import { getPersistedState, sendToExtension, setPersistedState } from '../lib/vscode.js';

beforeEach(() => {
  useStore.setState({
    ideStatuses: [], versions: { extension: '—', mcpServerBundled: '—' }, aiSkillCount: 0, aiSkillClients: [], loading: true,
    activeTab: 'overview', pendingActions: new Set(),
    settings: {
      mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true, toolProfile: { profile: 'safe-write', enabledCount: 55, totalCount: 73, categories: { read: true, recordRead: true, tableWrite: true, tableDestructive: true, fieldWrite: true, fieldDestructive: true, recordDestructive: false, viewWrite: true, viewDestructive: true, viewSection: true, viewSectionDestructive: true, formWrite: true, extension: true, recordWrite: true, sync: false, daemon: false, localWrite: true } }, serverSource: 'bundled', daemonPort: 0, authMode: 'browser', httpClient: 'fetch', useDaemon: true, browserIdleParkMinutes: 30 },
      ai: { autoInstallFiles: true, installScope: 'global' },
      formula: { formatterVersion: 'v2' },
      script: { beautifyStyle: 'default', minifyLevel: 'standard' },
      auth: { autoRefresh: true, refreshIntervalHours: 12, loginMode: 'manual' },
      debug: { enabled: false, verboseHttp: false, bufferSize: 1000 },
    },
    auth: { status: 'unknown', hasCredentials: false },
    daemon: undefined,
  });
  vi.clearAllMocks();
});

describe('store', () => {
  it('persists only the active tab', () => {
    useStore.getState().setTab('settings');

    expect(useStore.getState().activeTab).toBe('settings');
    expect(setPersistedState).toHaveBeenCalledWith({ activeTab: 'settings' });
  });

  it('hydrates the active tab from persisted webview state', () => {
    vi.mocked(getPersistedState).mockReturnValue({ activeTab: 'prompts' });

    useStore.getState().hydratePersistedState();

    expect(useStore.getState().activeTab).toBe('prompts');
  });

  it('applyState replaces dashboard data and clears loading', () => {
    const current = useStore.getState();
    useStore.getState().applyState({
      ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' }, aiSkillCount: 3, aiSkillClients: [], loading: false,
      settings: current.settings,
      auth: current.auth,
    });
    expect(useStore.getState().versions.mcpServerBundled).toBe('2.1.0');
    expect(useStore.getState().loading).toBe(false);
  });

  it('setupIde sends action:setupIde message', () => {
    useStore.getState().setupIde('cursor');
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:setupIde', ideId: 'cursor' }));
  });

  it('keeps setup-all and per-editor setup from overlapping, in both directions', () => {
    const one = useStore.getState().setupIde('cursor');
    expect(one).not.toBeNull();
    expect(useStore.getState().setupAll()).toBeNull();
    expect(useStore.getState().setupIde('cursor')).toBeNull();
    // A different editor is independent of this one.
    expect(useStore.getState().unconfigureIde('windsurf')).not.toBeNull();
    for (const id of useStore.getState().pendingIdeActions.values()) useStore.getState().markActionDone(id, { ok: true });

    const all = useStore.getState().setupAll();
    expect(all).not.toBeNull();
    expect(useStore.getState().setupAll()).toBeNull();
    expect(useStore.getState().setupIde('cursor')).toBeNull();
    expect(useStore.getState().unconfigureIde('windsurf')).toBeNull();
    expect(vi.mocked(sendToExtension).mock.calls.map(([m]) => (m as { type: string }).type))
      .toEqual(['action:setupIde', 'action:unconfigureIde', 'action:setupAll']);
  });

  it('starts with no AI skill data and nothing in flight', () => {
    expect(useStore.getInitialState()).toMatchObject({
      aiSkillCount: 0,
      aiSkillClients: [],
      pendingSkill: false,
      settings: { ai: { installScope: 'global' } },
    });
  });

  it('runs one AI skill install or remove at a time, cleared by its result', () => {
    expect(useStore.getState().pendingSkill).toBe(false);
    const install = useStore.getState().installSkill();
    expect(install).not.toBeNull();
    expect(useStore.getState().pendingSkill).toBe(true);
    expect(useStore.getState().installSkill()).toBeNull();
    expect(useStore.getState().removeSkill()).toBeNull();
    // An unrelated action settling does not release the skill slot.
    useStore.getState().markActionDone(useStore.getState().refresh(), { ok: true });
    expect(useStore.getState().pendingSkill).toBe(true);

    useStore.getState().markActionDone(install!, { ok: false, error: 'EACCES' });
    expect(useStore.getState().pendingSkill).toBe(false);
    const remove = useStore.getState().removeSkill();
    expect(remove).not.toBeNull();
    expect(useStore.getState().installSkill()).toBeNull();
    useStore.getState().markActionDone(remove!, { ok: true });
    expect(useStore.getState().pendingSkill).toBe(false);

    expect(vi.mocked(sendToExtension).mock.calls.map(([m]) => m))
      .toEqual([
        { type: 'action:installSkill', id: install },
        { type: 'action:refresh', id: expect.any(String) },
        { type: 'action:removeSkill', id: remove },
      ]);
  });

  it('refresh sends action:refresh message', () => {
    useStore.getState().refresh();
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:refresh' }));
  });

  it('manualLogin sends action:manualLogin message', () => {
    useStore.getState().manualLogin();
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:manualLogin' }));
  });

  it('backupSession sends action:backupSession message', () => {
    useStore.getState().backupSession();
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:backupSession' }));
  });

  it('restoreSession sends action:restoreSession message', () => {
    useStore.getState().restoreSession();
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:restoreSession' }));
  });

  it('opens storage by opaque id', () => {
    const id = useStore.getState().openStoragePath('tool-config');

    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({
      type: 'action:openStoragePath',
      entryId: 'tool-config',
      id,
    }));
    expect(vi.mocked(sendToExtension).mock.calls[0]?.[0]).not.toHaveProperty('path');
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(useStore.getState().pendingActions.has(id!)).toBe(true);
  });

  it('sends detected browser id without an executable', () => {
    const id = useStore.getState().setBrowserChoice({
      mode: 'detected',
      browserId: 'chrome',
    });

    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({
      type: 'action:setBrowserChoice',
      choice: { mode: 'detected', browserId: 'chrome' },
      id,
    }));
    expect(vi.mocked(sendToExtension).mock.calls[0]?.[0]).not.toHaveProperty('executablePath');
    expect(useStore.getState().pendingActions.has(id!)).toBe(true);
  });

  it('opens links by opaque id instead of sending a raw URL', () => {
    const id = useStore.getState().openLink('github');

    expect(sendToExtension).toHaveBeenCalledWith({
      type: 'action:openLink',
      id,
      link: 'github',
    });
    expect(JSON.stringify(vi.mocked(sendToExtension).mock.calls[0]?.[0])).not.toContain('https://');
  });

  it('opens IDE documentation by IDE id', () => {
    const id = useStore.getState().openIdeDocs('zed');

    expect(sendToExtension).toHaveBeenCalledWith({
      type: 'action:openIdeDocs',
      id,
      ideId: 'zed',
    });
  });

  it('wraps setting changes in the strict change DTO', () => {
    const id = useStore.getState().changeSetting({
      key: 'mcp.browserIdleParkMinutes',
      value: 45,
    });

    expect(sendToExtension).toHaveBeenCalledWith({
      type: 'setting:change',
      id,
      change: { key: 'mcp.browserIdleParkMinutes', value: 45 },
    });
    expect(useStore.getState().pendingActions.has(id!)).toBe(true);
  });

  it('tracks cookie mutations with cryptographic action ids', () => {
    const saveId = useStore.getState().saveCookie('session=value') as string;
    useStore.getState().markActionDone(saveId, { ok: true });
    const clearId = useStore.getState().clearCookie() as string;

    expect(sendToExtension).toHaveBeenNthCalledWith(1, {
      type: 'auth:saveCookie',
      id: saveId,
      cookie: 'session=value',
    });
    expect(sendToExtension).toHaveBeenNthCalledWith(2, {
      type: 'auth:clearCookie',
      id: clearId,
    });
    expect(saveId).toMatch(/^[0-9a-f]{24}$/);
    expect(clearId).toMatch(/^[0-9a-f]{24}$/);
    expect(saveId).not.toBe(clearId);
    expect(useStore.getState().pendingActions).toEqual(new Set([clearId]));
  });

  it('refuses a second session action while one is in flight and releases on settle', () => {
    const first = useStore.getState().logout() as string;

    expect(useStore.getState().login()).toBeNull();
    expect(useStore.getState().manualLogin()).toBeNull();
    expect(useStore.getState().restoreSession()).toBeNull();
    expect(useStore.getState().saveCredentials('a@b.c', 'pw', '')).toBeNull();
    expect(sendToExtension).toHaveBeenCalledTimes(1);

    useStore.getState().markActionDone(first, { ok: false });
    expect(useStore.getState().pendingScoped.size).toBe(0);
    expect(useStore.getState().login()).toMatch(/^[0-9a-f]{24}$/);
  });

  it('keeps the browser picker, bundled-Chromium and storage-entry scopes independent', () => {
    const pick = useStore.getState().selectCustomBrowser();
    expect(pick).not.toBeNull();

    expect(useStore.getState().setBrowserChoice({ mode: 'auto' })).toBeNull();
    expect(useStore.getState().selectCustomBrowser()).toBeNull();
    expect(useStore.getState().installBrowser()).not.toBeNull();
    expect(useStore.getState().removeBrowser()).toBeNull();
    // A login would drive the browser being installed, so it waits.
    expect(useStore.getState().login()).toBeNull();
    expect(useStore.getState().openStoragePath('tool-config')).not.toBeNull();
    expect(useStore.getState().openStoragePath('tool-config')).toBeNull();
    expect(useStore.getState().openStoragePath('browser-profile')).not.toBeNull();
  });

  it('matches scopes exactly or by nesting, never by bare string prefix', () => {
    const pending = new Map([['a', 'setting:mcp.category:viewSectionDestructive'], ['b', 'session:login']]);

    expect(scopePending(pending, 'setting:mcp.category:viewSectionDestructive')).toBe(true);
    expect(scopePending(pending, 'setting:mcp.category:viewSection')).toBe(false);
    expect(scopePending(pending, 'setting:mcp.category')).toBe(true);
    expect(scopePending(pending, 'session')).toBe(true);
    expect(scopePending(pending, 'sess')).toBe(false);
  });

  it('scopes a setting change to its key so only that row is pending', () => {
    const id = useStore.getState().changeSetting({ key: 'mcp.category', category: 'read', value: false });

    expect(scopePending(useStore.getState().pendingScoped, 'setting:mcp.category:read')).toBe(true);
    expect(scopePending(useStore.getState().pendingScoped, 'setting:mcp.category:sync')).toBe(false);
    expect(scopePending(useStore.getState().pendingScoped, 'setting:auth.autoRefresh')).toBe(false);
    useStore.getState().markActionDone(id, { ok: true });
    expect(useStore.getState().pendingScoped.size).toBe(0);
  });

  it('applies a parsed IDE status update without replacing dashboard state', () => {
    useStore.setState({ versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' } });
    const statuses = [{
      ideId: 'cursor' as const,
      label: 'Cursor',
      detected: true,
      mcpConfigured: false,
      aiSkill: { status: 'installed' as const, version: '2.0.10' },
    }];

    useStore.getState().applyIdeStatus(statuses);

    expect(useStore.getState().ideStatuses).toEqual(statuses);
    expect(useStore.getState().versions.extension).toBe('2.0.10');
  });
});

describe('store daemon field', () => {
  it('applyState with daemon field populates store.daemon', () => {
    const current = useStore.getState();
    useStore.getState().applyState({
      ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' },
      aiSkillCount: 0, aiSkillClients: [], loading: false,
      settings: current.settings,
      auth: current.auth,
      daemon: { running: true, healthy: true, port: 3100, port_lsp: 2087, tunnelUrl: null, uptime: 90_000 },
    });
    expect(useStore.getState().daemon?.port).toBe(3100);
    expect(useStore.getState().daemon?.healthy).toBe(true);
    expect(useStore.getState().daemon?.port_lsp).toBe(2087);
  });

  it('applyState without daemon leaves daemon undefined', () => {
    const current = useStore.getState();
    useStore.getState().applyState({
      ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' },
      aiSkillCount: 0, aiSkillClients: [], loading: false,
      settings: current.settings,
      auth: current.auth,
    });
    expect(useStore.getState().daemon).toBeUndefined();
  });
});

describe('action result confirmation (PromptEditor wait-for-result)', () => {
  it('savePrompt returns its action id and tracks it as pending', () => {
    const id = useStore.getState().savePrompt({
      name: 'my-prompt', description: 'd', arguments: [], template: 't',
      isBuiltin: false, isModified: false,
    })!;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(useStore.getState().pendingActions.has(id!)).toBe(true);
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:save-prompt', id }));
  });

  it('markActionDone records a consumable result and clears pending', () => {
    const id = useStore.getState().deletePrompt('my-prompt')!;
    useStore.getState().markActionDone(id, { ok: false, error: 'Could not delete prompt' });
    expect(useStore.getState().pendingActions.has(id!)).toBe(false);
    expect(useStore.getState().consumeActionResult(id)).toEqual({
      ok: false,
      error: 'Could not delete prompt',
    });
    // consumed — second read is undefined
    expect(useStore.getState().consumeActionResult(id)).toBeUndefined();
  });

  it('resetPrompt success result round-trips as true', () => {
    const id = useStore.getState().resetPrompt('built-in')!;
    useStore.getState().markActionDone(id, { ok: true });
    expect(useStore.getState().consumeActionResult(id)).toEqual({ ok: true });
  });

  it('keeps only the 50 most recent bounded action outcomes', () => {
    const ids = Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(24, '0'));
    for (const id of ids) {
      useStore.getState().markActionDone(id, { ok: true });
    }

    expect(useStore.getState().consumeActionResult(ids[0]!)).toBeUndefined();
    expect(useStore.getState().consumeActionResult(ids[1]!)).toEqual({ ok: true });
  });
});

describe('tunnel and official pending guards', () => {
  beforeEach(() => {
    useStore.setState({ pendingTunnelActions: new Set(), pendingOfficialActions: new Set() });
  });

  const sent = (type: string) =>
    vi.mocked(sendToExtension).mock.calls.filter(([message]) => (message as { type: string }).type === type);

  it('tracks a tunnel action in its own set and drops a duplicate while it is in flight', () => {
    useStore.getState().enableTunnel('cf-quick');
    useStore.getState().enableTunnel('cf-quick');
    useStore.getState().disableTunnel();
    useStore.getState().setNgrokAuthtoken('tok');

    const [id] = [...useStore.getState().pendingTunnelActions];
    expect(useStore.getState().pendingTunnelActions.size).toBe(1);
    expect(useStore.getState().pendingActions.has(id!)).toBe(true);
    expect(sent('tunnel:enable')).toHaveLength(1);
    expect(sent('tunnel:disable')).toHaveLength(0);
    expect(sent('tunnel:set-ngrok-authtoken')).toHaveLength(0);

    useStore.getState().markActionDone(id!, { ok: true });
    expect(useStore.getState().pendingTunnelActions.size).toBe(0);
    useStore.getState().disableTunnel();
    expect(sent('tunnel:disable')).toHaveLength(1);
  });

  it('does not let an unrelated pending action block a tunnel action', () => {
    useStore.getState().refresh();
    useStore.getState().enableTunnel('ngrok', 'tok', 'me.ngrok-free.app');

    expect(sent('tunnel:enable')).toHaveLength(1);
  });

  describe('tunnel enable timeout', () => {
    it('enableTunnel stays pending past 60 s and succeeds when the host answers at 3 minutes', () => {
      vi.useFakeTimers();
      try {
        const id = useStore.getState().enableTunnel('cf-quick');
        expect(id).not.toBeNull();
        vi.advanceTimersByTime(60_001);
        expect(useStore.getState().pendingActions.has(id!)).toBe(true);
        vi.advanceTimersByTime(120_000);
        useStore.getState().markActionDone(id!, { ok: true });
        expect(useStore.getState().pendingActions.has(id!)).toBe(false);
        expect(useStore.getState().consumeActionResult(id!)).toEqual({ ok: true });
      } finally { vi.useRealTimers(); }
    });

    it('enableTunnel times out at TUNNEL_ENABLE_TIMEOUT_MS when the host never answers', () => {
      vi.useFakeTimers();
      try {
        const id = useStore.getState().enableTunnel('cf-quick')!;
        vi.advanceTimersByTime(TUNNEL_ENABLE_TIMEOUT_MS + 1);
        expect(useStore.getState().pendingActions.has(id)).toBe(false);
        expect(useStore.getState().pendingTunnelActions.has(id)).toBe(false);
        expect(useStore.getState().consumeActionResult(id)).toEqual({ ok: false });
      } finally { vi.useRealTimers(); }
    });

    it('disableTunnel keeps the default 60 s timeout', () => {
      vi.useFakeTimers();
      try {
        const id = useStore.getState().disableTunnel()!;
        vi.advanceTimersByTime(60_001);
        expect(useStore.getState().pendingActions.has(id)).toBe(false);
      } finally { vi.useRealTimers(); }
    });
  });

  it('serialises official Airtable actions and releases them on completion', () => {
    useStore.getState().saveAirtablePat('pat');
    useStore.getState().configureOfficialAirtable('cursor');
    useStore.getState().copyAirtablePat();

    expect(useStore.getState().pendingOfficialActions.size).toBe(1);
    expect(sent('action:save-airtable-pat')).toHaveLength(1);
    expect(sent('action:configure-official-airtable')).toHaveLength(0);
    expect(sent('action:copy-airtable-pat')).toHaveLength(0);

    const [id] = [...useStore.getState().pendingOfficialActions];
    useStore.getState().markActionDone(id!, { ok: false });
    expect(useStore.getState().pendingOfficialActions.size).toBe(0);
    useStore.getState().unconfigureOfficialAirtable('cursor');
    expect(sent('action:unconfigure-official-airtable')).toHaveLength(1);
  });
});
