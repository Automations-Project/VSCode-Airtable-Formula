import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

  function formulaSentence(): string {
    return document.querySelector('.readiness-formula > .visually-hidden')?.textContent ?? '';
  }

  it('speaks the ready formula from each term and the result', () => {
    render(<Overview navigate={vi.fn()} />);

    expect(formulaSentence()).toBe(
      'Session: signed in, plus service: daemon on :8723, plus clients: 1 of 1 detected editor ready, equals ready.',
    );
  });

  it('never claims "equals ready" for a blocked formula', () => {
    seed({ auth: { status: 'expired' } });
    render(<Overview navigate={vi.fn()} />);

    expect(formulaSentence()).toBe(
      'Session: session expired, plus service: daemon on :8723, plus clients: 1 of 1 detected editor ready, equals sign in.',
    );
  });

  it('speaks a pending formula as pending', () => {
    seed({ loading: true });
    render(<Overview navigate={vi.fn()} />);

    expect(formulaSentence()).toBe(
      'Session: checking session, plus service: checking service, plus clients: checking editors, equals checking.',
    );
  });

  it('says one sentence that is read in place, not announced as a live region', () => {
    seed({ auth: { status: 'checking' } });
    render(<Overview navigate={vi.fn()} />);

    const sentence = screen.getByText(/^Session: checking session, plus service/);
    expect(document.querySelectorAll('.readiness-formula > .visually-hidden')).toHaveLength(1);
    expect(sentence.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
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

  it('does not hold Set up all on unrelated long actions', async () => {
    const [cursor] = makeDashboardState().ideStatuses;
    seed({
      ideStatuses: [
        { ...cursor!, mcpConfigured: false },
        { ...cursor!, ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false },
      ],
    });
    // A ten-minute Chromium download and an open save dialog: neither touches editors.
    useStore.getState().installBrowser();
    useStore.getState().backupSession();
    render(<Overview navigate={vi.fn()} />);
    const setupAll = screen.getByRole('button', { name: 'Set up all editors' });

    expect(setupAll).toBeEnabled();
    expect(setupAll).not.toHaveAttribute('aria-disabled');
    await userEvent.click(setupAll);
    expect(postedTypes()).toContain('action:setupAll');
  });

  it('does not hold Sign in on unrelated actions', async () => {
    seed({ auth: { status: 'expired', hasCredentials: true } });
    useStore.getState().debugExport();
    useStore.getState().openStoragePath('tool-config');
    render(<Overview navigate={vi.fn()} />);
    const signIn = screen.getByRole('button', { name: 'Sign in' });

    expect(signIn).toBeEnabled();
    expect(signIn).not.toHaveAttribute('aria-disabled');
    await userEvent.click(signIn);
    expect(postedTypes()).toContain('action:login');
  });

  it('does not hold Check session on unrelated actions', async () => {
    seed({ auth: { status: 'unknown' } });
    useStore.getState().installBrowser();
    useStore.getState().debugExport();
    render(<Overview navigate={vi.fn()} />);
    const check = screen.getByRole('button', { name: 'Check session' });

    expect(check).toBeEnabled();
    expect(check).not.toHaveAttribute('aria-disabled');
    await userEvent.click(check);
    expect(postedTypes()).toContain('action:status');
  });

  it('holds Sign in while a conflicting session or browser action is in flight', () => {
    seed({ auth: { status: 'expired', hasCredentials: true } });
    const logout = useStore.getState().logout();
    const view = render(<Overview navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    act(() => useStore.getState().markActionDone(logout!, { ok: true }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    view.unmount();

    // A login drives the very browser a bundled-Chromium install is replacing.
    useStore.getState().installBrowser();
    render(<Overview navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('holds the daemon action while a daemon action is in flight', async () => {
    seed({ daemon: undefined });
    useStore.getState().startDaemon();
    render(<Overview navigate={vi.fn()} />);
    const start = screen.getByRole('button', { name: 'Start service' });

    expect(start).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(start);
    expect(postedTypes()).toEqual(['daemon:start']);
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
