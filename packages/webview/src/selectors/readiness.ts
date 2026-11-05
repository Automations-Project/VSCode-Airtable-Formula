import type {
  AuthState,
  DaemonStatusInfo,
  DashboardTabId,
  IdeId,
  IdeStatus,
  SettingsSnapshot,
  TunnelState,
} from '@shared/types.js';

export type ReadinessState = 'loading' | 'blocked' | 'degraded' | 'ready';
export type ReadinessTermState =
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'degraded'
  | 'inactive';

export interface ReadinessTerm {
  key: 'session' | 'service' | 'clients';
  state: ReadinessTermState;
  shortLabel: string;
  longLabel: string;
  accent: 'session' | 'service' | 'clients' | 'neutral';
}

export interface ReadinessAction {
  kind: 'open-tab' | 'dispatch';
  label: string;
  tab?: DashboardTabId;
  dispatchType?:
    | 'action:login'
    | 'action:install-browser'
    | 'daemon:start'
    | 'action:setupIde'
    | 'action:setupAll'
    | 'action:status';
  ideId?: IdeId;
  focusTargetId?: string;
}

export interface ReadinessIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  tab: DashboardTabId;
  focusTargetId?: string;
}

/** Why the model is in its state. Consumers key behavior on this, never on display text. */
export type ReadinessReason =
  | 'loading'
  | 'browser-missing'
  | 'session-checking'
  | 'session-signing-in'
  | 'session-unchecked'
  | 'session-invalid'
  | 'service-starting'
  | 'service-stopped'
  | 'service-unhealthy'
  | 'no-clients'
  | 'repair'
  | 'ready';

export interface ReadinessModel {
  state: ReadinessState;
  reason: ReadinessReason;
  transportMode: 'daemon' | 'stdio';
  terms: {
    session: ReadinessTerm;
    service: ReadinessTerm;
    clients: ReadinessTerm;
  };
  /** Word shown in the result slot of the formula (READY, SIGN IN, ...). */
  resultLabel: string;
  headline: string;
  detail: string;
  nextAction: ReadinessAction | null;
  issues: ReadinessIssue[];
  usableClientCount: number;
}

/** The slice of DashboardState the selector reads. */
export interface ReadinessInput {
  loading: boolean;
  auth: AuthState;
  settings: {
    mcp: Pick<SettingsSnapshot['mcp'], 'useDaemon' | 'authMode'>;
    ai: Pick<SettingsSnapshot['ai'], 'includeAgents'>;
  };
  daemon?: DaemonStatusInfo;
  tunnel?: TunnelState;
  ideStatuses: IdeStatus[];
}

// Focus targets are headings owned by the destination tab.
const FOCUS = {
  browser: 'browser-settings-heading',
  account: 'account-settings-heading',
  service: 'local-service-heading',
  editors: 'editors-heading',
  remote: 'remote-access-heading',
} as const;

/** Every heading id the readiness model can send focus to (a test resolves each). */
export const READINESS_FOCUS_TARGET_IDS: readonly string[] = Object.values(FOCUS);

const LSP_ONLY_EDITORS = new Set<IdeId>(['zed', 'helix', 'neovim']);
// Editors that install skills/rules/workflow files (mirrors the Setup editor card).
const AI_FILE_EDITORS = new Set<IdeId>(['cursor', 'windsurf', 'windsurf-next', 'cline', 'claude-code']);

export type ClientProblem = 'mcp-missing' | 'server-path' | 'lsp-missing' | 'ai-files';

export interface ClientSummary {
  ideId: IdeId;
  label: string;
  version?: string;
  usable: boolean;
  state: 'ready' | 'partial' | 'needs-setup';
  problem?: ClientProblem;
}

function summarizeClient(ide: IdeStatus, includeAgents: boolean): ClientSummary {
  const base = { ideId: ide.ideId, label: ide.label, version: ide.version };

  if (LSP_ONLY_EDITORS.has(ide.ideId)) {
    return ide.lspConfigured === true
      ? { ...base, usable: true, state: 'ready' }
      : { ...base, usable: false, state: 'needs-setup', problem: 'lsp-missing' };
  }
  if (!ide.mcpConfigured) {
    return { ...base, usable: false, state: 'needs-setup', problem: 'mcp-missing' };
  }
  if (ide.mcpServerHealthy === false) {
    return { ...base, usable: false, state: 'needs-setup', problem: 'server-path' };
  }
  if (ide.lspConfigured === false) {
    return { ...base, usable: true, state: 'partial', problem: 'lsp-missing' };
  }
  if (AI_FILE_EDITORS.has(ide.ideId)) {
    const files = [ide.aiFiles.skills, ide.aiFiles.rules, ide.aiFiles.workflows];
    if (includeAgents) files.push(ide.aiFiles.agents);
    if (files.some(status => status !== 'ok')) {
      return { ...base, usable: true, state: 'partial', problem: 'ai-files' };
    }
  }
  return { ...base, usable: true, state: 'ready' };
}

/** Detected editors only, in the order the host reported them. */
export function summarizeClients(statuses: readonly IdeStatus[], includeAgents: boolean): ClientSummary[] {
  return statuses
    .filter(ide => ide.detected)
    .map(ide => summarizeClient(ide, includeAgents));
}

const PROBLEM_DETAIL: Record<ClientProblem, string> = {
  'mcp-missing': 'The Airtable MCP server is not configured for this editor.',
  'server-path': 'The configured server path is missing. Update the configuration.',
  'lsp-missing': 'The Airtable language server is not configured for this editor.',
  'ai-files': 'Some skills, rules, or workflow files are missing or incomplete.',
};

function sessionTerm(
  auth: AuthState,
  loading: boolean,
): ReadinessTerm {
  const term = (state: ReadinessTermState, shortLabel: string, longLabel: string): ReadinessTerm =>
    ({ key: 'session', state, shortLabel, longLabel, accent: 'session' });

  if (loading) return term('loading', '…', 'Checking session');
  switch (auth.status) {
    case 'valid': return term('ready', '✓', 'Signed in');
    case 'checking': return term('loading', '…', 'Checking session');
    case 'logging-in': return term('loading', '…', 'Signing in');
    case 'chrome-missing': return term('blocked', '!', 'Browser required');
    case 'expired': return term('blocked', '!', 'Session expired');
    case 'error': return term('blocked', '!', 'Session error');
    default: return term('blocked', '?', 'Not checked');
  }
}

function serviceTerm(
  useDaemon: boolean,
  daemon: DaemonStatusInfo | undefined,
  loading: boolean,
): ReadinessTerm {
  const term = (state: ReadinessTermState, shortLabel: string, longLabel: string): ReadinessTerm =>
    ({ key: 'service', state, shortLabel, longLabel, accent: 'service' });

  if (!useDaemon) return term('inactive', '—', 'Direct stdio');
  if (loading) return term('loading', '…', 'Checking service');
  if (daemon?.starting) return term('loading', '…', 'Daemon starting');
  if (!daemon?.running) return term('blocked', '!', 'Daemon stopped');
  if (!daemon.healthy) return term('blocked', '!', 'Daemon unhealthy');
  return term('ready', '✓', daemon.port ? `Daemon on :${daemon.port}` : 'Daemon running');
}

function clientsTerm(
  summaries: readonly ClientSummary[],
  usable: number,
  loading: boolean,
): ReadinessTerm {
  const term = (state: ReadinessTermState, shortLabel: string, longLabel: string): ReadinessTerm =>
    ({ key: 'clients', state, shortLabel, longLabel, accent: 'clients' });

  if (loading) return term('loading', '…', 'Checking editors');
  const detected = summaries.length;
  if (detected === 0) return term('blocked', '0', 'No editors detected');

  const noun = detected === 1 ? 'editor' : 'editors';
  const longLabel = `${usable} of ${detected} detected ${noun} ready`;
  if (usable === 0) return term('blocked', '0', longLabel);
  return term(summaries.some(item => item.state !== 'ready') ? 'degraded' : 'ready', String(usable), longLabel);
}

function clientRepairAction(
  repairs: readonly ClientSummary[],
  blocking: boolean,
): ReadinessAction | null {
  if (repairs.length === 0) return null;
  if (repairs.length > 1) {
    return {
      kind: 'dispatch',
      dispatchType: 'action:setupAll',
      label: blocking ? 'Set up all editors' : 'Repair editors',
    };
  }
  const only = repairs[0] as ClientSummary;
  return {
    kind: 'dispatch',
    dispatchType: 'action:setupIde',
    ideId: only.ideId,
    label: `${only.state === 'needs-setup' ? 'Set up' : 'Repair'} ${only.label}`,
  };
}

function collectIssues(
  input: ReadinessInput,
  summaries: readonly ClientSummary[],
  usable: number,
): ReadinessIssue[] {
  const { auth, daemon, tunnel } = input;
  const useDaemon = input.settings.mcp.useDaemon;
  const issues: ReadinessIssue[] = [];

  if (auth.status === 'chrome-missing') {
    issues.push({
      id: 'browser-missing',
      severity: 'error',
      title: 'Browser required',
      detail: 'Signing in to Airtable needs Chrome, Edge, or Chromium.',
      tab: 'settings',
      focusTargetId: FOCUS.browser,
    });
  } else if (auth.status === 'expired' || auth.status === 'error' || auth.status === 'unknown') {
    const kind = auth.status === 'expired' ? 'expired' : auth.status === 'error' ? 'error' : 'unchecked';
    issues.push({
      id: `session-${kind}`,
      severity: 'error',
      title: { expired: 'Session expired', error: 'Session error', unchecked: 'Session not checked' }[kind],
      detail: kind === 'unchecked'
        ? 'The Airtable session has not been verified yet.'
        : 'Airtable could not confirm your session. Sign in again.',
      tab: 'settings',
      focusTargetId: FOCUS.account,
    });
  }

  if (useDaemon && !daemon?.starting) {
    if (!daemon?.running) {
      issues.push({
        id: 'service-stopped',
        severity: 'error',
        title: 'Local service stopped',
        detail: 'The shared local service is not running, so editors cannot reach Airtable.',
        tab: 'setup',
        focusTargetId: FOCUS.service,
      });
    } else if (!daemon.healthy) {
      issues.push({
        id: 'service-unhealthy',
        severity: 'error',
        title: 'Local service unhealthy',
        detail: 'The local service is running but is not answering health checks.',
        tab: 'setup',
        focusTargetId: FOCUS.service,
      });
    }
  }

  if (summaries.length === 0) {
    issues.push({
      id: 'clients-none',
      severity: 'error',
      title: 'No editor detected',
      detail: 'Install a supported editor, then set it up from Setup.',
      tab: 'setup',
      focusTargetId: FOCUS.editors,
    });
  } else if (usable === 0) {
    issues.push({
      id: 'clients-unusable',
      severity: 'error',
      title: 'No editor is connected',
      detail: 'Set up at least one detected editor to use Airtable from it.',
      tab: 'setup',
      focusTargetId: FOCUS.editors,
    });
  }

  for (const item of summaries) {
    if (item.state === 'ready' || !item.problem) continue;
    const repair = item.problem === 'server-path';
    issues.push({
      id: item.problem === 'ai-files' ? `client-ai-files:${item.ideId}` : `client-setup:${item.ideId}`,
      severity: item.state === 'needs-setup' ? 'warning' : 'info',
      title: item.problem === 'ai-files'
        ? `${item.label} AI files incomplete`
        : `${item.label} ${repair ? 'needs repair' : 'needs setup'}`,
      detail: PROBLEM_DETAIL[item.problem],
      tab: 'setup',
      focusTargetId: FOCUS.editors,
    });
  }

  if (tunnel && (tunnel.status === 'error' || tunnel.status === 'auto-disabled')) {
    issues.push({
      id: 'tunnel-attention',
      severity: 'warning',
      title: 'Remote access needs attention',
      detail: tunnel.status === 'error'
        ? 'The remote tunnel failed. Local editors are not affected.'
        : 'The remote tunnel was turned off after repeated failures. Local editors are not affected.',
      tab: 'setup',
      focusTargetId: FOCUS.remote,
    });
  }

  return issues;
}

/**
 * Pure readiness model. Priority: browser, session, service (daemon mode only),
 * clients, degraded repair, ready. Pending states (loading, checking, starting)
 * never offer an action.
 */
export function selectReadiness(input: ReadinessInput): ReadinessModel {
  const { auth, daemon } = input;
  const useDaemon = input.settings.mcp.useDaemon;
  const summaries = summarizeClients(input.ideStatuses, input.settings.ai.includeAgents);
  const usable = summaries.filter(item => item.usable).length;
  const repairs = summaries.filter(item => item.state !== 'ready');

  const terms = {
    session: sessionTerm(auth, input.loading),
    service: serviceTerm(useDaemon, daemon, input.loading),
    clients: clientsTerm(summaries, usable, input.loading),
  };
  const issues = input.loading ? [] : collectIssues(input, summaries, usable);

  const result = (
    state: ReadinessState,
    reason: ReadinessReason,
    resultLabel: string,
    headline: string,
    detail: string,
    nextAction: ReadinessAction | null,
  ): ReadinessModel => ({
    state,
    reason,
    transportMode: useDaemon ? 'daemon' : 'stdio',
    terms,
    resultLabel,
    headline,
    detail,
    nextAction,
    issues,
    usableClientCount: usable,
  });

  if (input.loading) {
    return result('loading', 'loading', 'CHECKING', 'Checking Airtable readiness',
      'Waiting for the extension to report status.', null);
  }

  // 1. Browser.
  if (auth.status === 'chrome-missing') {
    const downloading = auth.browserDownload?.status === 'downloading';
    return result('blocked', 'browser-missing', 'BROWSER', 'Install a browser to start a session',
      downloading
        ? `Downloading Chromium (${auth.browserDownload?.progress ?? 0}%).`
        : 'Airtable sign-in uses Chrome, Edge, or Chromium. Choose or download one in Settings.',
      { kind: 'open-tab', label: 'Configure browser', tab: 'settings', focusTargetId: FOCUS.browser });
  }

  // 2. Session.
  if (auth.status === 'checking') {
    return result('loading', 'session-checking', 'CHECKING', 'Checking your Airtable session',
      'This usually takes a few seconds.', null);
  }
  if (auth.status === 'logging-in') {
    return result('loading', 'session-signing-in', 'SIGN IN', 'Signing in to Airtable',
      'Finish signing in if a browser window opened.', null);
  }
  if (auth.status === 'unknown') {
    return result('blocked', 'session-unchecked', 'SIGN IN', 'Check your Airtable session',
      'The session has not been verified yet.',
      { kind: 'dispatch', label: 'Check session', dispatchType: 'action:status' });
  }
  if (auth.status !== 'valid') {
    // Browser-mode and direct-login can re-run the login; byo needs a fresh cookie.
    const canLogin = input.settings.mcp.authMode !== 'byo' && auth.hasCredentials;
    return result('blocked', 'session-invalid', 'SIGN IN', 'Sign in to Airtable',
      auth.status === 'expired'
        ? 'Your Airtable session expired.'
        : 'Airtable could not confirm your session.',
      canLogin
        ? { kind: 'dispatch', label: 'Sign in', dispatchType: 'action:login' }
        : { kind: 'open-tab', label: 'Open account settings', tab: 'settings', focusTargetId: FOCUS.account });
  }

  // 3. Service (daemon mode only; stdio is a valid transport, not a stopped daemon).
  if (useDaemon) {
    if (daemon?.starting) {
      return result('loading', 'service-starting', 'SERVICE', 'Starting the local service',
        'Editors can connect once it is healthy.', null);
    }
    if (!daemon?.running) {
      return result('blocked', 'service-stopped', 'SERVICE', 'Start the local service',
        'Editors connect through the shared local service, which is not running.',
        { kind: 'dispatch', label: 'Start service', dispatchType: 'daemon:start' });
    }
    if (!daemon.healthy) {
      return result('blocked', 'service-unhealthy', 'SERVICE', 'Repair the local service',
        'The local service is running but is not answering health checks.',
        { kind: 'open-tab', label: 'Review local service', tab: 'setup', focusTargetId: FOCUS.service });
    }
  }

  // 4. Clients.
  if (usable === 0) {
    const action = clientRepairAction(repairs, true)
      ?? { kind: 'open-tab' as const, label: 'Review editors', tab: 'setup' as const, focusTargetId: FOCUS.editors };
    return result('blocked', 'no-clients', 'SET UP', 'Connect an editor',
      summaries.length === 0
        ? 'No supported editor was detected on this machine.'
        : 'None of the detected editors can use Airtable yet.',
      action);
  }

  // 5. Degraded repair.
  if (issues.length > 0) {
    const tunnelIssue = issues.find(issue => issue.id === 'tunnel-attention');
    const action = clientRepairAction(repairs, false)
      ?? (tunnelIssue
        ? { kind: 'open-tab' as const, label: 'Review remote access', tab: tunnelIssue.tab, focusTargetId: tunnelIssue.focusTargetId }
        : null);
    return result('degraded', 'repair', 'REPAIR', 'Airtable is ready, with repairs available',
      `${issues.length} ${issues.length === 1 ? 'item needs' : 'items need'} attention. Working editors are unaffected.`,
      action);
  }

  // 6. Ready.
  return result('ready', 'ready', 'READY', 'Airtable is ready',
    `${usable} ${usable === 1 ? 'editor is' : 'editors are'} ready to use Airtable.`, null);
}
