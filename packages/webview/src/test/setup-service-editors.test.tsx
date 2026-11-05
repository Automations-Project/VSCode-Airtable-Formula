import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdeStatus } from '@shared/types.js';
import { Overview } from '../tabs/Overview.js';
import { Setup } from '../tabs/Setup.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

const ALL_OK = { skills: 'ok', rules: 'ok', workflows: 'ok', agents: 'ok' } as const;

function ide(overrides: Partial<IdeStatus> & Pick<IdeStatus, 'ideId' | 'label'>): IdeStatus {
  return { detected: true, mcpConfigured: true, mcpServerHealthy: true, aiFiles: { ...ALL_OK }, ...overrides };
}

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'setup' });
}

function service(): HTMLElement {
  return screen.getByRole('region', { name: 'Local service' });
}

function editors(): HTMLElement {
  return screen.getByRole('region', { name: 'Editors' });
}

function card(label: string): HTMLElement {
  return screen.getByRole('article', { name: label });
}

function posted(type: string): Array<Record<string, unknown>> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.type === type);
}

describe('Setup focus targets', () => {
  beforeEach(() => seed());

  it('exposes focusable headings for every navigate() landing', () => {
    render(<Setup />);

    for (const id of ['setup-heading', 'local-service-heading', 'editors-heading']) {
      const heading = document.getElementById(id);
      expect(heading, id).not.toBeNull();
      expect(heading).toHaveAttribute('tabindex', '-1');
      heading?.focus();
      expect(document.activeElement).toBe(heading);
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Setup' })).toHaveAttribute('id', 'setup-heading');
    expect(screen.getByRole('heading', { name: 'Local service' })).toHaveAttribute('id', 'local-service-heading');
    expect(screen.getByRole('heading', { name: 'Editors' })).toHaveAttribute('id', 'editors-heading');
  });
});

describe('Local service transport', () => {
  it('does not render daemon lifecycle controls in direct stdio mode', () => {
    seed({ settings: { mcp: { useDaemon: false } }, daemon: undefined });

    render(<Setup />);

    expect(screen.getByRole('heading', { name: 'Local service' })).toBeVisible();
    expect(screen.getByText('Direct stdio mode')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop service' })).not.toBeInTheDocument();
    expect(within(service()).queryByText(/stopped/i)).not.toBeInTheDocument();
    expect(within(service()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains that each client owns its process in stdio mode', () => {
    seed({ settings: { mcp: { useDaemon: false } }, daemon: undefined });

    render(<Setup />);

    expect(within(service()).getByText(/each (editor|client)[^.]*own process/i)).toBeVisible();
  });

  it('reports a healthy running service with role=status', () => {
    seed();

    render(<Setup />);

    expect(within(service()).getByRole('status')).toHaveTextContent('Running and healthy');
    expect(within(service()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an unhealthy running service with role=alert', () => {
    seed({ daemon: { running: true, healthy: false } });

    render(<Setup />);

    expect(within(service()).getByRole('alert')).toHaveTextContent(/failed (its )?health check/i);
    expect(within(service()).getByRole('status')).toHaveTextContent('Running, not healthy');
  });

  it('offers Start only when stopped and posts daemon:start', async () => {
    seed({ daemon: { running: false, healthy: false, port: null, port_lsp: null, uptime: null } });

    render(<Setup />);

    expect(within(service()).getByRole('status')).toHaveTextContent('Stopped');
    expect(screen.queryByRole('button', { name: 'Restart service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop service' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start service' }));
    expect(posted('daemon:start')).toHaveLength(1);
  });

  it('offers Restart and Stop when running', async () => {
    seed();

    render(<Setup />);

    expect(screen.queryByRole('button', { name: 'Start service' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restart service' }));
    expect(posted('daemon:restart')).toHaveLength(1);
    // The in-flight restart now holds the lifecycle controls (focusable, inert).
    expect(screen.getByRole('button', { name: 'Stop service' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Stop service' }));
    expect(posted('daemon:stop')).toHaveLength(0);
  });

  it('posts daemon:stop from Stop service', async () => {
    seed();

    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Stop service' }));
    expect(posted('daemon:stop')).toHaveLength(1);
  });

  it('shows ports and uptime only when present', () => {
    seed({ daemon: { port: 8723, port_lsp: null, uptime: null } });

    render(<Setup />);

    expect(within(service()).getByText('MCP port')).toBeVisible();
    expect(within(service()).getByText('8723')).toBeVisible();
    expect(within(service()).queryByText('LSP port')).not.toBeInTheDocument();
    expect(within(service()).queryByText('Uptime')).not.toBeInTheDocument();
  });

  it('shows LSP port and uptime when the daemon reports them', () => {
    seed({ daemon: { port: 8723, port_lsp: 8724, uptime: 2 * 3_600_000 + 15 * 60_000 } });

    render(<Setup />);

    expect(within(service()).getByText('LSP port')).toBeVisible();
    expect(within(service()).getByText('8724')).toBeVisible();
    expect(within(service()).getByText('2h 15m')).toBeVisible();
  });

  it('disables only daemon controls during a daemon action', () => {
    useStore.setState({
      ...makeDashboardState(),
      activeTab: 'setup',
      pendingDaemonActions: new Set(['abc123']),
      pendingActions: new Set(['abc123']),
    });

    render(<Setup />);

    expect(screen.getByRole('button', { name: 'Restart service' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Stop service' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Update Cursor' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Update Cursor' })).not.toHaveAttribute('aria-disabled');
    expect(service()).toHaveAttribute('aria-busy', 'true');
  });

  it('does not lock daemon controls on an unrelated pending action', () => {
    useStore.setState({
      ...makeDashboardState(),
      activeTab: 'setup',
      pendingActions: new Set(['unrelated']),
    });

    render(<Setup />);

    expect(screen.getByRole('button', { name: 'Restart service' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop service' })).toBeEnabled();
    expect(service()).not.toHaveAttribute('aria-busy');
  });

  it('keeps bearer-token copy and rotation behind a Safety disclosure', async () => {
    seed();

    render(<Setup />);

    const safety = within(service()).getByText('Safety');
    expect(safety.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(safety);
    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate token' }));
    expect(posted('daemon:copy-bearer-token')).toHaveLength(1);
    expect(posted('daemon:rotate-token')).toHaveLength(1);
  });
});

describe('Editors section', () => {
  it('lists detected editors before undetected editors', () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
        ide({ ideId: 'cursor', label: 'Cursor' }),
      ],
    });

    render(<Setup />);

    const cursor = within(editors()).getByRole('heading', { name: 'Cursor' });
    const zed = within(editors()).getByRole('heading', { name: 'Zed' });
    expect(cursor.compareDocumentPosition(zed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts undetected editors behind a Show available editors disclosure', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor' }),
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    const summary = within(editors()).getByText('Show available editors');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
  });

  it('offers Setup all detected editors when more than one needs work', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
        ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Setup all detected editors' }));
    expect(posted('action:setupAll')).toHaveLength(1);
  });

  it('blocks a duplicate Setup all while its own action is in flight', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
        ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    const button = screen.getByRole('button', { name: 'Setup all detected editors' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(posted('action:setupAll')).toHaveLength(1);

    const { id } = posted('action:setupAll')[0] as { id: string };
    act(() => useStore.getState().markActionDone(id, { ok: true }));

    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('keeps Setup all guarded across an unmount and remount', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
        ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
      ],
    });

    const first = render(<Setup />);
    await userEvent.click(screen.getByRole('button', { name: 'Setup all detected editors' }));
    first.unmount();
    render(<Setup />);

    const button = screen.getByRole('button', { name: 'Setup all detected editors' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(posted('action:setupAll')).toHaveLength(1);

    const { id } = posted('action:setupAll')[0] as { id: string };
    act(() => useStore.getState().markActionDone(id, { ok: true }));
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('guards the Setup button when setup-all was started from the Overview next action', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
        ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
      ],
    });

    const overview = render(<Overview navigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up all editors' }));
    expect(screen.getByRole('button', { name: 'Set up all editors' })).toHaveAttribute('aria-disabled', 'true');
    overview.unmount();

    render(<Setup />);
    expect(screen.getByRole('button', { name: 'Setup all detected editors' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Setup all detected editors' }));
    expect(posted('action:setupAll')).toHaveLength(1);

    const { id } = posted('action:setupAll')[0] as { id: string };
    act(() => useStore.getState().markActionDone(id, { ok: true }));
    expect(screen.getByRole('button', { name: 'Setup all detected editors' })).not.toHaveAttribute('aria-disabled');
  });

  it('keeps the Overview setup-all action blocked while a per-editor action is pending', async () => {
    const ideStatuses = [
      ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
      ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
    ];
    seed({ ideStatuses });
    const view = render(<Overview navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Set up all editors' })).toBeEnabled();
    view.unmount();

    useStore.setState({
      pendingIdeActions: new Map([['cursor', 'abc123']]),
      pendingActions: new Set(['abc123']),
    });
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Set up all editors' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Set up all editors' }));
    expect(posted('action:setupAll')).toHaveLength(0);
  });

  it('does not lock Setup all on an unrelated pending action', () => {
    useStore.setState({
      ...makeDashboardState({
        ideStatuses: [
          ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
          ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
        ],
      }),
      activeTab: 'setup',
      pendingActions: new Set(['unrelated']),
    });

    render(<Setup />);

    expect(screen.getByRole('button', { name: 'Setup all detected editors' })).toBeEnabled();
  });

  it('hides Setup all detected editors when at most one editor needs work', () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
        ide({ ideId: 'windsurf', label: 'Windsurf' }),
      ],
    });

    render(<Setup />);

    expect(screen.queryByRole('button', { name: 'Setup all detected editors' })).not.toBeInTheDocument();
  });

  it('routes an undetected editor Docs action through openIdeDocs', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor' }),
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    await userEvent.click(within(editors()).getByText('Show available editors'));
    await userEvent.click(screen.getByRole('button', { name: 'Docs for Zed' }));
    expect(posted('action:openIdeDocs')).toEqual([expect.objectContaining({ ideId: 'zed' })]);
    expect(document.querySelector('a[href]')).toBeNull();
  });

  it('labels each state with literal text', () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', lspConfigured: true }),
        ide({ ideId: 'claude-code', label: 'Claude Code', mcpConfigured: false }),
        ide({ ideId: 'cline', label: 'Cline', lspConfigured: false }),
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    expect(within(card('Cursor')).getByText('Ready')).toBeVisible();
    expect(within(card('Claude Code')).getByText('Needs setup')).toBeVisible();
    expect(within(card('Cline')).getByText('Partial')).toBeVisible();
    expect(within(card('Zed')).getByText('Not detected')).toBeInTheDocument();
  });

  it('spells out partial MCP, LSP and AI file states without relying on colour', () => {
    seed({
      ideStatuses: [
        ide({
          ideId: 'opencode',
          label: 'OpenCode',
          mcpConfigured: true,
          lspConfigured: false,
        }),
        ide({
          ideId: 'claude-code',
          label: 'Claude Code',
          aiFiles: { skills: 'ok', rules: 'partial', workflows: 'missing', agents: 'ok' },
        }),
      ],
    });

    render(<Setup />);

    const opencode = within(card('OpenCode'));
    expect(opencode.getByText('MCP configured')).toBeVisible();
    expect(opencode.getByText('LSP not configured')).toBeVisible();
    const claude = within(card('Claude Code'));
    expect(claude.getByText('Partial')).toBeVisible();
    expect(claude.getByText('skills: ready')).toBeVisible();
    expect(claude.getByText('rules: partial')).toBeVisible();
    expect(claude.getByText('workflows: missing')).toBeVisible();
  });

  it('exposes Server path missing when the MCP server path is stale', () => {
    seed({
      ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor', mcpServerHealthy: false })],
    });

    render(<Setup />);

    expect(within(card('Cursor')).getByText('Server path missing')).toBeVisible();
    expect(within(card('Cursor')).getByText('Needs setup')).toBeVisible();
  });

  it('keeps setup, update and remove behaviour per editor', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor' }),
        ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    expect(screen.queryByRole('button', { name: 'Remove Windsurf configuration' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up Windsurf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cursor configuration' }));
    expect(posted('action:setupIde').map(message => message.ideId)).toEqual(['windsurf']);
    expect(posted('action:unconfigureIde').map(message => message.ideId)).toEqual(['cursor']);
  });

  it('posts setupIde from Update for a configured editor', async () => {
    seed({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor' })] });

    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Update Cursor' }));
    expect(posted('action:setupIde').map(message => message.ideId)).toEqual(['cursor']);
  });

  it('disables only the editor whose own action is pending', () => {
    useStore.setState({
      ...makeDashboardState({
        ideStatuses: [
          ide({ ideId: 'cursor', label: 'Cursor' }),
          ide({ ideId: 'windsurf', label: 'Windsurf' }),
        ],
      }),
      activeTab: 'setup',
      pendingIdeActions: new Map([['cursor', 'abc123']]),
      pendingActions: new Set(['abc123']),
    });

    render(<Setup />);

    expect(screen.getByRole('button', { name: 'Update Cursor' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Update Windsurf' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Update Windsurf' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Restart service' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Restart service' })).toBeEnabled();
  });

  it('shows a static scanning note, not a skeleton, while no editors are known', () => {
    seed({ ideStatuses: [] });

    render(<Setup />);

    expect(within(editors()).getByText('Scanning for installed editors…')).toBeVisible();
  });
});

describe('Setup service and editors markup', () => {
  it('renders no inline style attributes outside vendor icon artwork', () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', lspConfigured: true }),
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
      ],
    });

    render(<Setup />);

    for (const region of [service(), editors()]) {
      expect(region.querySelectorAll('[style]')).toHaveLength(0);
    }
  });

  it('has no axe violations', async () => {
    seed({
      ideStatuses: [
        ide({ ideId: 'cursor', label: 'Cursor', lspConfigured: true }),
        ide({ ideId: 'zed', label: 'Zed', detected: false, mcpConfigured: false }),
      ],
    });
    render(<Setup />);

    // Scoped to the migrated sections; the remaining Setup content moves in later tasks.
    for (const region of [service(), editors()]) {
      const result = await axe.run(region, { rules: { 'color-contrast': { enabled: false } } });
      expect(result.violations.map(violation => violation.id)).toEqual([]);
    }
  });
});
