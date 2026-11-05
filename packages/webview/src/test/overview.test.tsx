import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { Overview } from '../tabs/Overview.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'overview' });
}

function primaryButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button[data-variant="primary"]'));
}

function formulaOf(word: string): HTMLElement {
  return screen.getByText(word).closest('.readiness-formula') as HTMLElement;
}

function postedTypes(): unknown[] {
  return vscodeApiMock.postMessage.mock.calls.map(([message]) => (message as { type: string }).type);
}

describe('Overview readiness formula', () => {
  beforeEach(() => seed());

  it('exposes one accessible sentence for the visual formula', () => {
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByText('Session plus service plus clients equals ready')).toBeInTheDocument();
  });

  it('shows the visual terms and result', () => {
    render(<Overview navigate={vi.fn()} />);

    for (const word of ['SESSION', 'SERVICE', 'CLIENTS', 'READY']) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    expect(formulaOf('SESSION')).toHaveAttribute('data-state', 'ready');
  });

  it('keeps the visual formula out of the accessibility tree', () => {
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByText('SESSION').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the blocked result in the formula instead of READY', () => {
    seed({ auth: { status: 'expired' } });
    render(<Overview navigate={vi.fn()} />);

    expect(formulaOf('SESSION')).toHaveAttribute('data-state', 'blocked');
    expect(screen.getByText('SIGN IN')).toBeInTheDocument();
    expect(screen.queryByText('READY')).not.toBeInTheDocument();
  });
});

describe('Overview next action', () => {
  it('renders exactly one primary button for a blocked browser', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    seed({ auth: { status: 'chrome-missing', hasCredentials: false, browser: { found: false } } });
    const { container } = render(<Overview navigate={navigate} />);

    expect(primaryButtons(container)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Configure browser' }));

    expect(navigate).toHaveBeenCalledWith('settings', 'browser-settings-heading');
  });

  it('renders no primary button when ready', () => {
    seed();
    const { container } = render(<Overview navigate={vi.fn()} />);

    expect(primaryButtons(container)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Airtable is ready' })).toBeInTheDocument();
  });

  it('dispatches declared actions through the existing store senders', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    render(<Overview navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Start service' }));

    expect(postedTypes()).toEqual(['daemon:start']);
  });

  it('sets up the one editor that needs work', async () => {
    const user = userEvent.setup();
    const [cursor] = makeDashboardState().ideStatuses;
    seed({ ideStatuses: [{ ...cursor!, mcpConfigured: false }] });
    render(<Overview navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Set up Cursor' }));

    expect(vscodeApiMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'action:setupIde', ideId: 'cursor' }),
    );
  });

  it('disables the daemon action while a daemon action is in flight', async () => {
    seed({ daemon: undefined });
    useStore.getState().startDaemon();
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start service' })).toBeDisabled();
  });
});

describe('Overview transport and status', () => {
  it('renders Direct stdio, not a stopped daemon', () => {
    seed({ settings: { mcp: { useDaemon: false } }, daemon: undefined });
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getAllByText('Direct stdio').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Daemon stopped/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Local service stopped/)).not.toBeInTheDocument();
  });

  it('keeps signed-in user, browser, and last check visible', () => {
    seed({
      auth: {
        status: 'valid',
        userId: 'usr_abc',
        lastChecked: '2026-07-26T10:00:00.000Z',
        browser: { found: true, id: 'chrome', channel: 'chrome', label: 'Google Chrome' },
      },
    });
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByText('usr_abc')).toBeInTheDocument();
    expect(screen.getByText('Google Chrome')).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it('refreshes quietly without a primary style', async () => {
    const user = userEvent.setup();
    seed();
    render(<Overview navigate={vi.fn()} />);

    const refresh = screen.getByRole('button', { name: 'Refresh status' });
    expect(refresh).not.toHaveAttribute('data-variant', 'primary');
    await user.click(refresh);

    expect(postedTypes()).toEqual(['action:refresh']);
  });
});

describe('Overview clients and issues', () => {
  it('shows client counts and repair issues without duplicate metric cards', () => {
    const [cursor] = makeDashboardState().ideStatuses;
    seed({
      ideStatuses: [
        cursor!,
        { ...cursor!, ideId: 'cline', label: 'Cline', mcpConfigured: false },
        { ...cursor!, ideId: 'amp', label: 'Amp', detected: false },
      ],
    });
    const { container } = render(<Overview navigate={vi.fn()} />);

    const clients = screen.getByRole('region', { name: 'Editors' });
    expect(within(clients).getByText('1 of 2 detected editors ready')).toBeInTheDocument();
    expect(within(clients).getByText('Cursor')).toBeInTheDocument();
    expect(within(clients).getByText('Cline')).toBeInTheDocument();
    expect(within(clients).queryByText('Amp')).not.toBeInTheDocument();
    expect(screen.getByText('Cline needs setup')).toBeInTheDocument();
    expect(container.querySelector('.metric-card, .metrics-grid')).toBeNull();
  });

  it('explains the recovery when no editor is detected', () => {
    seed({ ideStatuses: [] });
    render(<Overview navigate={vi.fn()} />);

    expect(screen.getByText(/No editors detected yet.*set it up from Setup/)).toBeInTheDocument();
  });

  it('navigates from an issue to the destination heading target', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    seed({ daemon: undefined });
    render(<Overview navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    expect(navigate).toHaveBeenCalledWith('setup', 'local-service-heading');
  });

  it('changes to Setup and focuses the service heading in the real app', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    const target = document.createElement('h2');
    target.id = 'local-service-heading';
    target.tabIndex = -1;
    target.textContent = 'Local service';
    document.body.append(target);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 0;
    });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('setup'));
    expect(target).toHaveFocus();
    target.remove();
  });

  it('links to Setup, Prompts, and tool safety', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    seed();
    render(<Overview navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: /Prompts/ }));
    await user.click(screen.getByRole('button', { name: /Tool safety/ }));
    await user.click(screen.getByRole('button', { name: /Editors and local service/ }));

    expect(navigate.mock.calls.map(([tab]) => tab)).toEqual(['prompts', 'settings', 'setup']);
  });
});

describe('Overview structure', () => {
  beforeEach(() => seed({ auth: { status: 'expired' } }));

  it('drops the old catalogue, quick action, and duplicate IDE headings', () => {
    render(<Overview navigate={vi.fn()} />);

    for (const name of [/Capabilities/, /Quick actions/, /^IDE Status/, /Detected environments/, /Features/, /Controls/]) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument();
    }
  });

  it('uses no inline style attributes', () => {
    const { container } = render(<Overview navigate={vi.fn()} />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('renders the labelled heading that cross-tab links can focus', () => {
    render(<Overview navigate={vi.fn()} />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Overview' });
    expect(heading).toHaveAttribute('id', 'overview-heading');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('has no axe violations in blocked and ready states', async () => {
    const blocked = render(<Overview navigate={vi.fn()} />);
    const blockedResult = await axe.run(blocked.container, { rules: { 'color-contrast': { enabled: false } } });
    blocked.unmount();

    seed();
    const ready = render(<Overview navigate={vi.fn()} />);
    const readyResult = await axe.run(ready.container, { rules: { 'color-contrast': { enabled: false } } });

    expect(blockedResult.violations.map(violation => violation.id)).toEqual([]);
    expect(readyResult.violations.map(violation => violation.id)).toEqual([]);
  });
});
