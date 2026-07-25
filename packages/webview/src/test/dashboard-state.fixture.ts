import type {
  AuthState,
  DaemonStatusInfo,
  DashboardState,
  IdeStatus,
  SettingsSnapshot,
  TunnelState,
} from '@shared/types.js';

type SettingsOverride = Omit<Partial<SettingsSnapshot>, 'mcp' | 'ai' | 'formula' | 'script' | 'auth' | 'debug'> & {
  mcp?: Partial<SettingsSnapshot['mcp']> & { toolProfile?: Partial<SettingsSnapshot['mcp']['toolProfile']> };
  ai?: Partial<SettingsSnapshot['ai']>;
  formula?: Partial<SettingsSnapshot['formula']>;
  script?: Partial<SettingsSnapshot['script']>;
  auth?: Partial<SettingsSnapshot['auth']>;
  debug?: Partial<SettingsSnapshot['debug']>;
};

export interface DashboardStateOverrides extends Omit<Partial<DashboardState>, 'settings' | 'auth' | 'daemon' | 'tunnel' | 'ideStatuses'> {
  settings?: SettingsOverride;
  auth?: Partial<AuthState>;
  daemon?: Partial<DaemonStatusInfo> | undefined;
  tunnel?: Partial<TunnelState> | undefined;
  ideStatuses?: IdeStatus[];
}

export function makeDashboardState(overrides: DashboardStateOverrides = {}): DashboardState {
  const settings: SettingsSnapshot = {
    mcp: {
      autoConfigureOnInstall: true, notifyOnUpdates: true,
      toolProfile: {
        profile: 'safe-write', enabledCount: 54, totalCount: 71,
        categories: {
          read: true, recordRead: true, tableWrite: true, tableDestructive: true,
          fieldWrite: true, fieldDestructive: true, recordDestructive: false,
          viewWrite: true, viewDestructive: true, viewSection: true,
          viewSectionDestructive: true, formWrite: true, extension: true,
          recordWrite: true, sync: false,
        },
      },
      serverSource: 'bundled', daemonPort: 8723, authMode: 'browser', httpClient: 'fetch',
    },
    ai: { autoInstallFiles: true, includeAgents: false },
    formula: { formatterVersion: 'v2' },
    script: { beautifyStyle: 'default', minifyLevel: 'standard' },
    auth: { autoRefresh: true, refreshIntervalHours: 12, loginMode: 'manual' },
    debug: { enabled: false, verboseHttp: false, bufferSize: 1000 },
  };
  const auth: AuthState = { status: 'valid', userId: 'usr_test', hasCredentials: true, hasCookie: true };
  const daemon: DaemonStatusInfo = { running: true, healthy: true, port: 8723, port_lsp: 8724, tunnelUrl: null, uptime: 60_000 };
  const tunnel: TunnelState = { status: 'disabled', url: null, provider: 'cf-quick', ngrokAuthtokenSet: false, autoDisabledReason: null };
  const ideStatuses: IdeStatus[] = [{
    ideId: 'cursor', label: 'Cursor', detected: true, version: '1.0.0',
    mcpConfigured: true, mcpServerHealthy: true,
    aiFiles: { skills: 'ok', rules: 'ok', workflows: 'ok', agents: 'ok' },
  }];

  return {
    ideStatuses: overrides.ideStatuses ?? ideStatuses,
    versions: { extension: '2.1.32', mcpServerBundled: '2.4.15', ...overrides.versions },
    aiFilesCount: overrides.aiFilesCount ?? 4,
    loading: overrides.loading ?? false,
    settings: {
      ...settings,
      ...overrides.settings,
      mcp: { ...settings.mcp, ...overrides.settings?.mcp, toolProfile: { ...settings.mcp.toolProfile, ...overrides.settings?.mcp?.toolProfile } },
      ai: { ...settings.ai, ...overrides.settings?.ai },
      formula: { ...settings.formula, ...overrides.settings?.formula },
      script: { ...settings.script, ...overrides.settings?.script },
      auth: { ...settings.auth, ...overrides.settings?.auth },
      debug: { ...settings.debug, ...overrides.settings?.debug },
    },
    auth: { ...auth, ...overrides.auth },
    daemon: Object.hasOwn(overrides, 'daemon') ? overrides.daemon === undefined ? undefined : { ...daemon, ...overrides.daemon } : daemon,
    tunnel: Object.hasOwn(overrides, 'tunnel') ? overrides.tunnel === undefined ? undefined : { ...tunnel, ...overrides.tunnel } : tunnel,
    debug: overrides.debug,
    storage: overrides.storage,
    officialAirtable: overrides.officialAirtable,
    prompts: overrides.prompts ?? { prompts: [] },
  };
}
