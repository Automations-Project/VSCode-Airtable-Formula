import { describe, expect, it } from 'vitest';
import type { IdeStatus } from '@shared/types.js';
import { makeDashboardState } from './dashboard-state.fixture.js';
import { selectReadiness, summarizeClients } from '../selectors/readiness.js';

const cursor = makeDashboardState().ideStatuses[0] as IdeStatus;

function client(overrides: Partial<IdeStatus> = {}): IdeStatus {
  return { ...cursor, ...overrides };
}

describe('selectReadiness', () => {
  it('prioritizes a missing browser before session, service, and clients', () => {
    const model = selectReadiness(makeDashboardState({
      auth: {
        status: 'chrome-missing',
        hasCredentials: false,
        browser: { found: false },
      },
      daemon: undefined,
      ideStatuses: [],
    }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Install a browser to start a session');
    expect(model.nextAction).toMatchObject({
      kind: 'open-tab',
      label: 'Configure browser',
      tab: 'settings',
      focusTargetId: 'browser-settings-heading',
    });
    expect(model.resultLabel).toBe('BROWSER');
  });

  it('does not call stdio a stopped daemon', () => {
    const state = makeDashboardState({
      settings: {
        mcp: { useDaemon: false },
      },
      daemon: undefined,
    });

    const model = selectReadiness(state);

    expect(model.transportMode).toBe('stdio');
    expect(model.terms.service.state).toBe('inactive');
    expect(model.terms.service.longLabel).toBe('Direct stdio');
    expect(model.issues.map(issue => issue.title)).not.toContain('Local service stopped');
    expect(model.state).toBe('ready');
  });

  it('blocks on an unhealthy required daemon before clients', () => {
    const model = selectReadiness(makeDashboardState({
      daemon: {
        running: true,
        healthy: false,
        port: 8723,
        port_lsp: null,
        tunnelUrl: null,
        uptime: 1000,
      },
      ideStatuses: [],
    }));

    expect(model.headline).toBe('Repair the local service');
    expect(model.nextAction).toMatchObject({
      tab: 'setup',
      focusTargetId: 'local-service-heading',
    });
  });

  it('is degraded when one client works and another is partial', () => {
    const state = makeDashboardState({
      ideStatuses: [
        cursor,
        {
          ideId: 'claude-code',
          label: 'Claude Code',
          detected: true,
          mcpConfigured: false,
          aiFiles: {
            skills: 'partial',
            rules: 'missing',
            workflows: 'missing',
            agents: 'missing',
          },
        },
      ],
    });

    const model = selectReadiness(state);

    expect(model.state).toBe('degraded');
    expect(model.usableClientCount).toBe(1);
    expect(model.nextAction).toMatchObject({
      kind: 'dispatch',
      dispatchType: 'action:setupIde',
      ideId: 'claude-code',
    });
  });

  it('is ready with a valid session, usable transport, and one usable client', () => {
    const model = selectReadiness(makeDashboardState());

    expect(model.state).toBe('ready');
    expect(model.headline).toBe('Airtable is ready');
    expect(model.nextAction).toBeNull();
    expect(model.issues).toEqual([]);
    expect(model.resultLabel).toBe('READY');
    expect(model.terms.session).toMatchObject({ state: 'ready', accent: 'session' });
    expect(model.terms.service).toMatchObject({ state: 'ready', accent: 'service', longLabel: 'Daemon on :8723' });
    expect(model.terms.clients).toMatchObject({ state: 'ready', accent: 'clients', shortLabel: '1' });
  });
});

describe('selectReadiness priority and branches', () => {
  it('reports loading until the host delivers state, with no action', () => {
    const model = selectReadiness(makeDashboardState({ loading: true, auth: { status: 'expired' } }));

    expect(model.state).toBe('loading');
    expect(model.nextAction).toBeNull();
    expect(model.terms.session.state).toBe('loading');
    expect(model.resultLabel).toBe('CHECKING');
  });

  it.each([
    ['checking', 'Checking your Airtable session'],
    ['logging-in', 'Signing in to Airtable'],
  ] as const)('treats a %s session as loading, not an error', (status, headline) => {
    const model = selectReadiness(makeDashboardState({ auth: { status } }));

    expect(model.state).toBe('loading');
    expect(model.headline).toBe(headline);
    expect(model.nextAction).toBeNull();
    expect(model.issues).toEqual([]);
  });

  it('offers a status check when the session has not been checked', () => {
    const model = selectReadiness(makeDashboardState({ auth: { status: 'unknown' } }));

    expect(model.state).toBe('blocked');
    expect(model.nextAction).toMatchObject({ kind: 'dispatch', dispatchType: 'action:status' });
  });

  it.each(['expired', 'error'] as const)('blocks on a %s session and signs in when credentials exist', status => {
    const model = selectReadiness(makeDashboardState({ auth: { status, hasCredentials: true } }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Sign in to Airtable');
    expect(model.nextAction).toMatchObject({ kind: 'dispatch', dispatchType: 'action:login' });
    expect(model.resultLabel).toBe('SIGN IN');
  });

  it('sends a signed-out user without credentials to account settings', () => {
    const model = selectReadiness(makeDashboardState({
      auth: { status: 'expired', hasCredentials: false },
    }));

    expect(model.nextAction).toMatchObject({
      kind: 'open-tab',
      tab: 'settings',
      focusTargetId: 'account-settings-heading',
    });
  });

  it('sends an expired byo session to account settings instead of a browser login', () => {
    const model = selectReadiness(makeDashboardState({
      settings: { mcp: { authMode: 'byo' } },
      auth: { status: 'expired', hasCredentials: true, hasCookie: true },
    }));

    expect(model.nextAction).toMatchObject({ kind: 'open-tab', tab: 'settings' });
  });

  it('puts a session problem ahead of a stopped service', () => {
    const model = selectReadiness(makeDashboardState({
      auth: { status: 'expired' },
      daemon: undefined,
    }));

    expect(model.headline).toBe('Sign in to Airtable');
    expect(model.issues.map(issue => issue.id)).toEqual(['session-expired', 'service-stopped']);
  });

  it('starts a stopped required daemon', () => {
    const model = selectReadiness(makeDashboardState({ daemon: undefined }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Start the local service');
    expect(model.nextAction).toMatchObject({ kind: 'dispatch', dispatchType: 'daemon:start' });
    expect(model.issues.map(issue => issue.title)).toContain('Local service stopped');
    expect(model.terms.service.longLabel).toBe('Daemon stopped');
  });

  it('treats a daemon that is starting as loading without offering Start again', () => {
    const model = selectReadiness(makeDashboardState({
      daemon: { running: false, healthy: false, starting: true, port: null },
    }));

    expect(model.state).toBe('loading');
    expect(model.headline).toBe('Starting the local service');
    expect(model.nextAction).toBeNull();
    expect(model.terms.service.state).toBe('loading');
  });

  it('asks to set up the only detected editor when none is usable', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [client({ mcpConfigured: false })],
    }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Connect an editor');
    expect(model.nextAction).toMatchObject({
      kind: 'dispatch',
      dispatchType: 'action:setupIde',
      ideId: 'cursor',
      label: 'Set up Cursor',
    });
  });

  it('sets up all detected editors when several need work and none is usable', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [
        client({ mcpConfigured: false }),
        client({ ideId: 'cline', label: 'Cline', mcpConfigured: false }),
      ],
    }));

    expect(model.nextAction).toMatchObject({ kind: 'dispatch', dispatchType: 'action:setupAll' });
  });

  it('points to Setup when no editor is detected', () => {
    const model = selectReadiness(makeDashboardState({ ideStatuses: [] }));

    expect(model.state).toBe('blocked');
    expect(model.nextAction).toMatchObject({
      kind: 'open-tab',
      tab: 'setup',
      focusTargetId: 'editors-heading',
    });
    expect(model.terms.clients.state).toBe('blocked');
  });

  it('ignores editors that are not detected', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [client({ detected: false })],
    }));

    expect(model.usableClientCount).toBe(0);
    expect(model.state).toBe('blocked');
  });

  it('does not count an MCP client whose server path is missing as usable', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [client({ mcpServerHealthy: false })],
    }));

    expect(model.usableClientCount).toBe(0);
    expect(model.state).toBe('blocked');
  });

  it.each(['zed', 'helix', 'neovim'] as const)('counts %s as usable through LSP only', ideId => {
    const usable = selectReadiness(makeDashboardState({
      ideStatuses: [client({ ideId, label: ideId, mcpConfigured: false, lspConfigured: true })],
    }));
    const unusable = selectReadiness(makeDashboardState({
      ideStatuses: [client({ ideId, label: ideId, mcpConfigured: true, lspConfigured: false })],
    }));

    expect(usable.usableClientCount).toBe(1);
    expect(unusable.usableClientCount).toBe(0);
  });

  it('keeps a usable client usable while reporting incomplete AI files as a repair', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [client({
        aiFiles: { skills: 'ok', rules: 'partial', workflows: 'missing', agents: 'missing' },
      })],
    }));

    expect(model.usableClientCount).toBe(1);
    expect(model.state).toBe('degraded');
    expect(model.issues.map(issue => issue.id)).toEqual(['client-ai-files:cursor']);
    expect(model.nextAction).toMatchObject({ dispatchType: 'action:setupIde', ideId: 'cursor' });
  });

  it('only expects agent files when agents are enabled', () => {
    const missingAgents = { skills: 'ok', rules: 'ok', workflows: 'ok', agents: 'missing' } as const;
    const off = selectReadiness(makeDashboardState({
      settings: { ai: { includeAgents: false } },
      ideStatuses: [client({ aiFiles: missingAgents })],
    }));
    const on = selectReadiness(makeDashboardState({
      settings: { ai: { includeAgents: true } },
      ideStatuses: [client({ aiFiles: missingAgents })],
    }));

    expect(off.state).toBe('ready');
    expect(on.state).toBe('degraded');
  });

  it('does not expect AI files from editors that never install them', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [client({
        ideId: 'claude-desktop',
        label: 'Claude Desktop',
        aiFiles: { skills: 'missing', rules: 'missing', workflows: 'missing', agents: 'missing' },
      })],
    }));

    expect(model.state).toBe('ready');
  });

  it('repairs several editors with one action only when more than one needs work', () => {
    const model = selectReadiness(makeDashboardState({
      ideStatuses: [
        cursor,
        client({ ideId: 'cline', label: 'Cline', mcpConfigured: false }),
        client({ ideId: 'claude-code', label: 'Claude Code', mcpConfigured: false }),
      ],
    }));

    expect(model.state).toBe('degraded');
    expect(model.nextAction).toMatchObject({ dispatchType: 'action:setupAll' });
  });

  it.each(['error', 'auto-disabled'] as const)('degrades on a %s tunnel and links to remote access', status => {
    const model = selectReadiness(makeDashboardState({
      tunnel: { status, url: null },
    }));

    expect(model.state).toBe('degraded');
    expect(model.issues.map(issue => issue.id)).toEqual(['tunnel-attention']);
    expect(model.nextAction).toMatchObject({
      kind: 'open-tab',
      tab: 'setup',
      focusTargetId: 'remote-access-heading',
    });
  });

  it('keeps a blocked state blocked when a tunnel also has an error', () => {
    const model = selectReadiness(makeDashboardState({
      auth: { status: 'expired' },
      tunnel: { status: 'error' },
    }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Sign in to Airtable');
  });

  it('is deterministic for identical input', () => {
    const state = makeDashboardState({ auth: { status: 'expired' }, daemon: undefined });

    expect(selectReadiness(state)).toEqual(selectReadiness(state));
  });
});

describe('selectReadiness reason', () => {
  it.each([
    ['loading', { loading: true }, 'loading'],
    ['checking', { auth: { status: 'checking' } }, 'session-checking'],
    ['logging-in', { auth: { status: 'logging-in' } }, 'session-signing-in'],
    ['unchecked', { auth: { status: 'unknown' } }, 'session-unchecked'],
    ['browser', { auth: { status: 'chrome-missing' } }, 'browser-missing'],
    ['expired', { auth: { status: 'expired' } }, 'session-invalid'],
    ['service stopped', { daemon: undefined }, 'service-stopped'],
    ['service starting', { daemon: { running: false, healthy: false, starting: true } }, 'service-starting'],
    ['service unhealthy', { daemon: { running: true, healthy: false } }, 'service-unhealthy'],
    ['no clients', { ideStatuses: [] }, 'no-clients'],
    ['tunnel error', { tunnel: { status: 'error' } }, 'repair'],
    ['ready', {}, 'ready'],
  ] as const)('exposes a typed reason for %s independent of display labels', (_name, overrides, reason) => {
    expect(selectReadiness(makeDashboardState(overrides as never)).reason).toBe(reason);
  });
});

describe('summarizeClients', () => {
  it('lists only detected editors with a ready, partial, or needs-setup state', () => {
    const summaries = summarizeClients([
      cursor,
      client({ ideId: 'cline', label: 'Cline', mcpConfigured: false }),
      client({
        ideId: 'claude-code',
        label: 'Claude Code',
        aiFiles: { skills: 'partial', rules: 'ok', workflows: 'ok', agents: 'ok' },
      }),
      client({ ideId: 'amp', label: 'Amp', detected: false }),
    ], true);

    expect(summaries.map(item => [item.ideId, item.state])).toEqual([
      ['cursor', 'ready'],
      ['cline', 'needs-setup'],
      ['claude-code', 'partial'],
    ]);
  });
});
