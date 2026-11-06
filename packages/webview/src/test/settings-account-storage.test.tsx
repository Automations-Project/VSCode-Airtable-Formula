import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../tabs/Settings.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

const CHROME = { id: 'chrome', found: true, channel: 'chrome', label: 'Google Chrome' } as const;
const EDGE = { id: 'edge', found: true, channel: 'msedge', label: 'Microsoft Edge' } as const;

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'settings' });
}

function lastPostedMessage(): Record<string, unknown> {
  return vscodeApiMock.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function posted(type: string): Array<Record<string, unknown>> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.type === type);
}

function settle(id: unknown, outcome: { ok: boolean; error?: string; cancelled?: boolean }): void {
  act(() => useStore.getState().markActionDone(String(id), outcome));
}

const account = () => screen.getByRole('region', { name: 'Account and authentication' });
const browserSection = () => screen.getByRole('region', { name: 'Browser' });
const storageSection = () => screen.getByRole('region', { name: 'Storage and session backup' });

beforeEach(() => seed());

describe('Settings focus targets', () => {
  it('exposes focusable Account, Browser and Storage headings for navigate() landings', () => {
    render(<Settings navigate={vi.fn()} />);

    for (const id of ['account-settings-heading', 'browser-settings-heading', 'storage-settings-heading']) {
      const heading = document.getElementById(id);
      expect(heading, id).not.toBeNull();
      expect(heading).toHaveAttribute('tabindex', '-1');
      heading?.focus();
      expect(document.activeElement).toBe(heading);
    }
    expect(screen.getByRole('heading', { name: 'Account and authentication' })).toHaveAttribute('id', 'account-settings-heading');
    expect(screen.getByRole('heading', { name: 'Browser' })).toHaveAttribute('id', 'browser-settings-heading');
  });

  it('keeps the Browser heading present when the connection mode does not use a browser', () => {
    seed({ settings: { mcp: { authMode: 'byo' } } });

    render(<Settings navigate={vi.fn()} />);

    expect(document.getElementById('browser-settings-heading')).toHaveAttribute('tabindex', '-1');
    expect(within(browserSection()).getByText(/not used/i)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Browser selection' })).not.toBeInTheDocument();
  });
});

describe('Browser selection', () => {
  it('offers auto and detected browser ids while custom path stays host-owned', async () => {
    const user = userEvent.setup();
    seed({ auth: { status: 'valid', hasCredentials: true, availableBrowsers: [CHROME, EDGE] } });

    render(<Settings navigate={vi.fn()} />);

    const browser = screen.getByRole('combobox', { name: 'Browser selection' });
    expect(within(browser).getByRole('option', { name: 'Automatic' })).toHaveValue('auto');
    expect(within(browser).getByRole('option', { name: 'Google Chrome' })).toHaveValue('chrome');
    expect(within(browser).getByRole('option', { name: 'Microsoft Edge' })).toHaveValue('edge');
    expect(within(browser).queryByRole('option', { name: /custom path/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose custom browser executable' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:selectCustomBrowser' });
    expect(JSON.stringify(lastPostedMessage())).not.toMatch(/path|executable"/i);
  });

  it('posts a detected browser id, and auto, as the choice', async () => {
    const user = userEvent.setup();
    seed({ auth: { availableBrowsers: [CHROME, EDGE] } });

    render(<Settings navigate={vi.fn()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Browser selection' }), 'edge');

    expect(lastPostedMessage()).toMatchObject({
      type: 'action:setBrowserChoice',
      choice: { mode: 'detected', browserId: 'edge' },
    });
    expect(lastPostedMessage()).not.toHaveProperty('executablePath');
    settle(lastPostedMessage().id, { ok: true });

    seed({
      auth: { availableBrowsers: [CHROME, EDGE] },
      settings: { auth: { browserChoice: { mode: 'detected', browserId: 'edge', label: 'Microsoft Edge' } } },
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Browser selection' }), 'auto');
    expect(lastPostedMessage()).toMatchObject({ type: 'action:setBrowserChoice', choice: { mode: 'auto' } });
  });

  it('keeps a selected custom browser visible by its host label, not a path', () => {
    seed({
      auth: { availableBrowsers: [CHROME] },
      settings: { auth: { browserChoice: { mode: 'custom', label: 'Brave Browser' } } },
    });

    render(<Settings navigate={vi.fn()} />);

    const select = screen.getByRole('combobox', { name: 'Browser selection' });
    expect(select).toHaveDisplayValue('Brave Browser (custom)');
  });

  it('keeps a remembered browser that is no longer detected selectable', () => {
    seed({
      auth: { availableBrowsers: [CHROME] },
      settings: { auth: { browserChoice: { mode: 'detected', browserId: 'edge', label: 'Microsoft Edge' } } },
    });

    render(<Settings navigate={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: 'Browser selection' })).toHaveDisplayValue('Microsoft Edge (not detected)');
  });

  it('announces a missing browser as an alert and routes Chrome help through the link id', async () => {
    const user = userEvent.setup();
    seed({ auth: { status: 'chrome-missing', browser: { found: false }, availableBrowsers: [] } });

    render(<Settings navigate={vi.fn()} />);

    expect(within(browserSection()).getByRole('alert')).toHaveTextContent(/No Chromium-based browser/);
    await user.click(screen.getByRole('button', { name: 'Get Google Chrome' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:openLink', link: 'chrome' });
    expect(JSON.stringify(lastPostedMessage())).not.toContain('https://');
    expect(document.querySelector('a[href]')).toBeNull();
  });

  it('downloads the bundled Chromium, showing native progress and a failure alert', async () => {
    const user = userEvent.setup();
    seed({ auth: { browser: { found: false }, availableBrowsers: [] } });
    const view = render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Download bundled Chromium' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:install-browser' });
    expect(screen.getByRole('button', { name: 'Download bundled Chromium' })).toHaveAttribute('aria-busy', 'true');
    // Pending keeps the clicked button focusable: aria-disabled, and a second click posts nothing.
    expect(screen.getByRole('button', { name: 'Download bundled Chromium' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Download bundled Chromium' }));
    expect(posted('action:install-browser')).toHaveLength(1);

    seed({
      auth: { browser: { found: false }, availableBrowsers: [], browserDownload: { status: 'downloading', progress: 42 } },
    });
    view.rerender(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: /Downloading Chromium/ })).toHaveAttribute('value', '42');

    seed({
      auth: { browser: { found: false }, availableBrowsers: [], browserDownload: { status: 'error', error: 'ECONNRESET' } },
    });
    view.rerender(<Settings navigate={vi.fn()} />);
    expect(within(browserSection()).getAllByRole('alert').some(a => /Download failed/.test(a.textContent ?? ''))).toBe(true);
  });

  it('removes an installed bundled Chromium with a named action', async () => {
    const user = userEvent.setup();
    seed({
      auth: {
        browser: { ...CHROME, id: 'bundled-chromium', label: 'Bundled Chromium', downloaded: true },
        availableBrowsers: [{ ...CHROME, id: 'bundled-chromium', label: 'Bundled Chromium', downloaded: true }],
      },
    });

    render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Remove bundled Chromium' }));

    expect(lastPostedMessage()).toMatchObject({ type: 'action:removeBrowser' });
  });

  it('a slow custom-browser picker disables only the browser choice, and survives a remount', async () => {
    const user = userEvent.setup();
    seed({ auth: { availableBrowsers: [CHROME] }, storage: { entries: [{ id: 'tool-config', label: 'Tool Config', exists: true }] } });
    const first = render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Choose custom browser executable' }));
    const picker = screen.getByRole('button', { name: 'Choose custom browser executable' });
    expect(picker).toHaveAttribute('aria-disabled', 'true');
    expect(picker).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('combobox', { name: 'Browser selection' })).toBeDisabled();
    // Nothing else is locked out by the open file dialog.
    expect(screen.getByRole('button', { name: 'Check Airtable session' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back up session data' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Connection mode' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Include agent files' })).toBeEnabled();

    const id = lastPostedMessage().id;
    first.unmount();
    render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose custom browser executable' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Choose custom browser executable' }));
    expect(posted('action:selectCustomBrowser')).toHaveLength(1);

    settle(id, { ok: true, cancelled: true });
    expect(screen.getByRole('button', { name: 'Choose custom browser executable' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Browser selection' })).toBeEnabled();
  });

  it('keeps a login and a bundled-Chromium install from running at once, in both directions', async () => {
    const user = userEvent.setup();
    seed({ auth: { browser: { found: false }, availableBrowsers: [] } });
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Download bundled Chromium' }));
    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).toBeDisabled();
    settle(lastPostedMessage().id, { ok: true });

    await user.click(screen.getByRole('button', { name: 'Log in to Airtable in browser' }));
    expect(screen.getByRole('button', { name: 'Download bundled Chromium' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Get Google Chrome' })).toBeEnabled();
  });

  it('reports a failed browser choice with the host error', async () => {
    const user = userEvent.setup();
    seed({ auth: { availableBrowsers: [CHROME, EDGE] } });
    render(<Settings navigate={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Browser selection' }), 'chrome');
    settle(lastPostedMessage().id, { ok: false, error: 'Browser could not be saved' });

    expect(await within(browserSection()).findByRole('alert')).toHaveTextContent('Browser could not be saved');
  });
});

describe('Account and session', () => {
  it('keeps session status and the primary login and logout actions open', async () => {
    const user = userEvent.setup();
    seed({ auth: { status: 'valid', userId: 'usr_test' } });

    render(<Settings navigate={vi.fn()} />);

    expect(within(account()).getByText('Active')).toBeVisible();
    expect(within(account()).getByText('usr_test')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Log in to Airtable in browser' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:manualLogin' });
  });

  it('uses the automatic login action when login mode is automatic', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { loginMode: 'auto' } } });

    render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Log in to Airtable' }));

    expect(lastPostedMessage()).toMatchObject({ type: 'action:login' });
  });

  it('validates stored credentials in direct-login mode and has no login in cookie mode', () => {
    seed({ settings: { mcp: { authMode: 'direct-login' } } });
    const direct = render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Validate Airtable credentials' })).toBeVisible();
    direct.unmount();

    seed({ settings: { mcp: { authMode: 'byo' } } });
    render(<Settings navigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Log in to Airtable|Validate Airtable credentials/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Airtable session' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log out of Airtable' })).toBeVisible();
  });

  it('checks and logs out through tracked actions', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Check Airtable session' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:status' });
    settle(lastPostedMessage().id, { ok: true });
    await user.click(screen.getByRole('button', { name: 'Log out of Airtable' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:logout' });
  });

  it('shows an auth error with friendly text in the account section', () => {
    seed({ auth: { status: 'error', error: 'ENOTFOUND airtable.com' } });

    render(<Settings navigate={vi.fn()} />);

    expect(within(account()).getByRole('alert')).toHaveTextContent('Network error');
  });

  it('disables login while a logout is in flight and busies only the logout button', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Log out of Airtable' }));

    expect(screen.getByRole('button', { name: 'Log out of Airtable' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Check Airtable session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore session data' })).toBeDisabled();
    // A double click cannot dispatch a second session action.
    await user.click(screen.getByRole('button', { name: 'Log in to Airtable in browser' }));
    expect(posted('action:manualLogin')).toHaveLength(0);
    expect(posted('action:logout')).toHaveLength(1);
  });

  it('keeps the session guard across a remount and clears it on every settle path', async () => {
    const user = userEvent.setup();
    const first = render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Log out of Airtable' }));
    const id = lastPostedMessage().id;
    first.unmount();

    const second = render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).toBeDisabled();
    settle(id, { ok: false, error: 'Logout failed' });
    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).toBeEnabled();
    expect(useStore.getState().pendingScoped.size).toBe(0);
    second.unmount();

    // The auto-expiry path settles through markActionDone as well.
    render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Check Airtable session' }));
    settle(lastPostedMessage().id, { ok: false });
    expect(screen.getByRole('button', { name: 'Check Airtable session' })).toBeEnabled();
  });

  it('also locks the session actions while the session is being checked or logged in', () => {
    seed({ auth: { status: 'logging-in' } });

    render(<Settings navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Log in to Airtable in browser' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Log out of Airtable' })).toBeDisabled();
  });

  it('describes that changing the connection mode restarts the active transport', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    expect(within(account()).getByText(/restarts or reprovisions the active transport/i)).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Connection mode' }), 'byo');
    expect(lastPostedMessage()).toMatchObject({
      type: 'setting:change',
      change: { key: 'mcp.authMode', value: 'byo' },
    });
  });

  it('switches login mode with a stable switch name', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    const toggle = screen.getByRole('switch', { name: 'Automatic login' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(lastPostedMessage()).toMatchObject({
      type: 'setting:change',
      change: { key: 'auth.loginMode', value: 'auto' },
    });
  });
});

describe('Credentials and cookie', () => {
  async function openCredentials(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Update credentials' }));
  }

  it('saves direct-login credentials and clears the secrets only after a confirmed result', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'direct-login' } } });
    render(<Settings navigate={vi.fn()} />);

    await openCredentials(user);
    await user.type(screen.getByLabelText('Airtable email'), 'me@example.com');
    await user.type(screen.getByLabelText('Airtable password'), 'hunter2');
    await user.type(screen.getByLabelText('Two-factor secret (optional)'), 'JBSWY3DP');
    await user.click(screen.getByRole('button', { name: 'Save credentials to keychain' }));

    expect(lastPostedMessage()).toMatchObject({
      type: 'action:saveCredentials',
      email: 'me@example.com',
      password: 'hunter2',
      otpSecret: 'JBSWY3DP',
    });
    // Pending: nothing cleared yet, controls locked.
    expect(screen.getByLabelText('Airtable password')).toHaveValue('hunter2');
    expect(screen.getByRole('button', { name: 'Save credentials to keychain' })).toHaveAttribute('aria-disabled', 'true');

    settle(lastPostedMessage().id, { ok: true });

    expect(await screen.findByRole('button', { name: 'Update credentials' })).toBeVisible();
    expect(screen.queryByLabelText('Airtable password')).not.toBeInTheDocument();
    await openCredentials(user);
    expect(screen.getByLabelText('Airtable email')).toHaveValue('');
    expect(screen.getByLabelText('Airtable password')).toHaveValue('');
    expect(screen.getByLabelText('Two-factor secret (optional)')).toHaveValue('');
  });

  it('keeps the typed credentials and announces the host error when saving fails', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'direct-login' } } });
    render(<Settings navigate={vi.fn()} />);

    await openCredentials(user);
    await user.type(screen.getByLabelText('Airtable email'), 'me@example.com');
    await user.type(screen.getByLabelText('Airtable password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save credentials to keychain' }));
    settle(lastPostedMessage().id, { ok: false, error: 'Keychain is locked' });

    expect(await within(account()).findByRole('alert')).toHaveTextContent('Keychain is locked');
    expect(screen.getByLabelText('Airtable email')).toHaveValue('me@example.com');
    expect(screen.getByLabelText('Airtable password')).toHaveValue('hunter2');
    expect(screen.getByRole('button', { name: 'Save credentials to keychain' })).toBeEnabled();
  });

  it('cancels the credentials form without sending anything and drops the typed secrets', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'direct-login' } } });
    render(<Settings navigate={vi.fn()} />);

    await openCredentials(user);
    await user.type(screen.getByLabelText('Airtable password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(posted('action:saveCredentials')).toHaveLength(0);
    await openCredentials(user);
    expect(screen.getByLabelText('Airtable password')).toHaveValue('');
  });

  it('offers credentials in browser mode only when login mode is automatic', () => {
    render(<Settings navigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /credentials$/i })).not.toBeInTheDocument();
  });

  it('saves the BYO cookie, keeping it on failure and clearing it on a confirmed save', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'byo' } }, auth: { hasCookie: false } });
    render(<Settings navigate={vi.fn()} />);

    const field = screen.getByLabelText('Airtable session cookie');
    await user.type(field, 'brw=1; session=2');
    await user.click(screen.getByRole('button', { name: 'Save cookie to keychain' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'auth:saveCookie', cookie: 'brw=1; session=2' });

    settle(lastPostedMessage().id, { ok: false, error: 'Cookie rejected' });
    expect(await within(account()).findByRole('alert')).toHaveTextContent('Cookie rejected');
    expect(field).toHaveValue('brw=1; session=2');

    await user.click(screen.getByRole('button', { name: 'Save cookie to keychain' }));
    settle(lastPostedMessage().id, { ok: true });
    await act(async () => undefined);
    expect(field).toHaveValue('');
  });

  it('clears a saved BYO cookie by a named action', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'byo' } }, auth: { hasCookie: true } });
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Clear saved cookie' }));

    expect(lastPostedMessage()).toMatchObject({ type: 'auth:clearCookie' });
  });
});

describe('Auto-refresh and per-row setting feedback', () => {
  it('keeps a non-preset refresh interval selected and writable', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { autoRefresh: true, refreshIntervalHours: 7 } } });
    render(<Settings navigate={vi.fn()} />);

    const interval = screen.getByRole('combobox', { name: 'Check interval' });
    expect(interval).toHaveDisplayValue('7 hours (current)');
    expect(interval).toHaveValue('7');
    await user.selectOptions(interval, '24');

    expect(lastPostedMessage()).toMatchObject({
      type: 'setting:change',
      change: { key: 'auth.refreshIntervalHours', value: 24 },
    });
  });

  it('offers the presets without a current marker when the value is a preset', () => {
    render(<Settings navigate={vi.fn()} />);

    const interval = screen.getByRole('combobox', { name: 'Check interval' });
    expect(interval).toHaveValue('12');
    expect(within(interval).queryByRole('option', { name: /current/ })).not.toBeInTheDocument();
    expect(within(interval).getByRole('option', { name: '1 week' })).toHaveValue('168');
  });

  it('writes the 7-hour value even if the user re-selects it', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { refreshIntervalHours: 7 } } });
    render(<Settings navigate={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Check interval' }), '4');
    expect(lastPostedMessage()).toMatchObject({ change: { key: 'auth.refreshIntervalHours', value: 4 } });
  });

  it('reports row success with role=status and failure with role=alert and the host error', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { loginMode: 'auto' } } });
    render(<Settings navigate={vi.fn()} />);

    const row = () => screen.getByRole('switch', { name: 'Auto-refresh session' });
    await user.click(row());
    const first = lastPostedMessage().id;

    expect(row()).toBeDisabled();
    expect(row()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('combobox', { name: 'Check interval' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Connection mode' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Include agent files' })).toBeEnabled();

    settle(first, { ok: true });
    expect(row()).toBeEnabled();
    expect(await screen.findByText('Saved')).toBeVisible();
    expect(screen.getByText('Saved').closest('[role="status"]')).not.toBeNull();

    await user.click(row());
    settle(lastPostedMessage().id, { ok: false, error: 'Settings file is read-only' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings file is read-only');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('keeps the row guard across a remount', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { loginMode: 'auto' } } });
    const first = render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: 'Auto-refresh session' }));
    first.unmount();

    render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Auto-refresh session' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Automatic login' })).toBeEnabled();
  });
});

describe('Storage and session backup', () => {
  const entries = [
    { id: 'tool-config' as const, label: 'Tool Config', exists: true, sizeBytes: 2048 },
    { id: 'browser-profile' as const, label: 'Browser Profile', exists: false },
  ];

  it('opens a storage entry by id and never posts its path', async () => {
    const user = userEvent.setup();
    seed({ storage: { entries } });
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open Tool Config' }));

    expect(lastPostedMessage()).toMatchObject({ type: 'action:openStoragePath', entryId: 'tool-config' });
    expect(lastPostedMessage()).not.toHaveProperty('path');
  });

  it('shows label, existence and size only, never a raw path', () => {
    seed({
      storage: {
        entries: [
          { ...entries[0]!, path: 'C:\\Users\\me\\.airtable-user-mcp\\tools-config.json' } as never,
          entries[1]!,
        ],
      },
    });
    render(<Settings navigate={vi.fn()} />);

    const region = storageSection();
    expect(within(region).getByText('Tool Config')).toBeVisible();
    expect(within(region).getByText('2.0 KB')).toBeVisible();
    expect(within(region).getByText('Not created yet')).toBeVisible();
    expect(within(region).queryByRole('button', { name: 'Open Browser Profile' })).not.toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Users|tools-config\.json|[\\/]/);
  });

  it('guards a single entry while its open is in flight, across a remount', async () => {
    const user = userEvent.setup();
    seed({ storage: { entries: [entries[0]!, { id: 'bundled-chromium', label: 'Bundled Chromium', exists: true }] } });
    const first = render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open Tool Config' }));
    expect(screen.getByRole('button', { name: 'Open Tool Config' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Open Tool Config' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Open Bundled Chromium' })).toBeEnabled();
    const id = lastPostedMessage().id;
    first.unmount();

    render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open Tool Config' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Open Tool Config' }));
    expect(posted('action:openStoragePath')).toHaveLength(1);
    settle(id, { ok: false, error: 'Could not open the folder' });
    expect(screen.getByRole('button', { name: 'Open Tool Config' })).not.toHaveAttribute('aria-disabled');
  });

  it('keeps backup and restore available and says restore replaces current session data', async () => {
    const user = userEvent.setup();
    seed({ storage: { entries } });
    render(<Settings navigate={vi.fn()} />);

    expect(within(storageSection()).getByText(/replaces your current session data/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back up session data' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:backupSession' });
    // While the backup runs, restore cannot start.
    expect(screen.getByRole('button', { name: 'Restore session data' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back up session data' })).toHaveAttribute('aria-busy', 'true');

    settle(lastPostedMessage().id, { ok: true });
    await user.click(screen.getByRole('button', { name: 'Restore session data' }));
    expect(lastPostedMessage()).toMatchObject({ type: 'action:restoreSession' });
    expect(screen.getByRole('button', { name: 'Back up session data' })).toBeDisabled();
  });

  it('reports the host failure for a restore with role=alert', async () => {
    const user = userEvent.setup();
    seed({ storage: { entries } });
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Restore session data' }));
    settle(lastPostedMessage().id, { ok: false, error: 'Restore failed: bad archive' });

    expect(await within(storageSection()).findByRole('alert')).toHaveTextContent('Restore failed: bad archive');
  });

  it('never calls window.confirm for the destructive restore', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    seed({ storage: { entries } });
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Restore session data' }));

    expect(confirm).not.toHaveBeenCalled();
  });

  it('disables backup when nothing exists to back up', () => {
    seed({ storage: { entries: [entries[1]!] } });
    render(<Settings navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Back up session data' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore session data' })).toBeEnabled();
  });
});

describe('Settings accessibility and presentation', () => {
  it('has no axe violations in the account, browser and storage sections', async () => {
    seed({
      auth: { availableBrowsers: [CHROME, EDGE] },
      storage: { entries: [{ id: 'tool-config', label: 'Tool Config', exists: true, sizeBytes: 12 }] },
    });
    render(<Settings navigate={vi.fn()} />);

    for (const region of [account(), browserSection(), storageSection()]) {
      const result = await axe.run(region, { rules: { 'color-contrast': { enabled: false } } });
      expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.html).join(' | ')}`)).toEqual([]);
    }
  });

  it('adds no inline style to the migrated sections', () => {
    seed({
      auth: { availableBrowsers: [CHROME], browser: { found: false } },
      storage: { entries: [{ id: 'tool-config', label: 'Tool Config', exists: true }] },
    });
    render(<Settings navigate={vi.fn()} />);

    for (const region of [account(), browserSection(), storageSection()]) {
      expect(region.querySelectorAll('[style]')).toHaveLength(0);
    }
  });
});

describe('Scope matching is exact', () => {
  function seedCustomProfile() {
    seed();
    useStore.setState(state => ({
      settings: {
        ...state.settings,
        mcp: { ...state.settings.mcp, toolProfile: { ...state.settings.mcp.toolProfile, profile: 'custom' } },
      },
    }));
  }

  it('does not let an in-flight destructive category lock its prefix sibling, in either direction', async () => {
    const user = userEvent.setup();
    seedCustomProfile();
    render(<Settings navigate={vi.fn()} />);
    const plain = () => screen.getByRole('switch', { name: 'View Sections' });
    const destructive = () => screen.getByRole('switch', { name: 'View Sections (destructive)' });

    await user.click(destructive());
    expect(destructive()).toBeDisabled();
    expect(destructive()).toHaveAttribute('aria-busy', 'true');
    expect(plain()).toBeEnabled();
    expect(plain()).not.toHaveAttribute('aria-busy');
    settle(lastPostedMessage().id, { ok: true });

    await user.click(plain());
    expect(plain()).toBeDisabled();
    expect(destructive()).toBeEnabled();
    expect(destructive()).not.toHaveAttribute('aria-busy');
  });
});

describe('Outcome status regions stay in the accessibility tree', () => {
  it('mounts the status node before the message and the same node receives the text', async () => {
    const user = userEvent.setup();
    seed({ settings: { auth: { loginMode: 'auto' } } });
    render(<Settings navigate={vi.fn()} />);

    const row = screen.getByRole('switch', { name: 'Auto-refresh session' }).closest('.setting-row')!;
    const status = row.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole('switch', { name: 'Auto-refresh session' }));
    settle(lastPostedMessage().id, { ok: true });

    expect(await within(row as HTMLElement).findByText('Saved')).toBe(status);
    expect(row.querySelector('[role="status"]')).toBe(status);
  });
});
