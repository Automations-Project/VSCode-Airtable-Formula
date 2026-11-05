import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IdeStatus } from '@shared/types.js';
import type { ActionOutcome } from '../store.js';
import { useStore } from '../store.js';
import { Overview } from '../tabs/Overview.js';
import { Settings } from '../tabs/Settings.js';
import { Setup } from '../tabs/Setup.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

// When an action swaps the control the user just used, focus must not fall
// to <body>: a persisting slot keeps its node (only the label changes), and a
// control that legitimately disappears hands focus to the next logical control
// or the section heading.

const ALL_OK = { skills: 'ok', rules: 'ok', workflows: 'ok', agents: 'ok' } as const;
const CHROME = { id: 'chrome', found: true, channel: 'chrome', label: 'Google Chrome' } as const;
const BUNDLED = { id: 'bundled-chromium', found: true, channel: 'chromium', label: 'Bundled Chromium', downloaded: true } as const;

function ide(overrides: Partial<IdeStatus> & Pick<IdeStatus, 'ideId' | 'label'>): IdeStatus {
  return { detected: true, mcpConfigured: true, mcpServerHealthy: true, aiFiles: { ...ALL_OK }, ...overrides };
}

function seed(overrides: DashboardStateOverrides = {}, activeTab: 'overview' | 'setup' | 'settings' = 'setup'): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab });
}

function lastId(type: string): string {
  const message = vscodeApiMock.postMessage.mock.calls
    .map(([m]) => m as { type: string; id: string })
    .filter(m => m.type === type)
    .at(-1);
  if (!message) throw new Error(`no ${type} was posted`);
  return message.id;
}

/** The host answers and pushes the state the action produced, as one update. */
function hostAnswers(type: string, outcome: ActionOutcome, state: Partial<ReturnType<typeof useStore.getState>>): void {
  act(() => {
    useStore.setState(state);
    useStore.getState().markActionDone(lastId(type), outcome);
  });
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Local service lifecycle', () => {
  it('keeps focus on the lifecycle slot when Start becomes Restart', async () => {
    const user = userEvent.setup();
    seed({ daemon: { running: false, healthy: false, port: null, port_lsp: null, uptime: null } });
    render(<Setup />);

    const start = button('Start service');
    await user.click(start);
    hostAnswers('daemon:start', { ok: true }, { daemon: makeDashboardState().daemon });

    expect(button('Restart service')).toBe(start);
    expect(start).toHaveFocus();
  });

  it('moves focus to Start when the Stop button goes away', async () => {
    const user = userEvent.setup();
    seed();
    render(<Setup />);

    await user.click(button('Stop service'));
    hostAnswers('daemon:stop', { ok: true }, { daemon: { running: false, healthy: false, port: null, port_lsp: null, tunnelUrl: null, uptime: null } });

    await waitFor(() => expect(button('Start service')).toHaveFocus());
  });
});

describe('Editor card', () => {
  it('keeps focus on the primary slot when Set up becomes Update', async () => {
    const user = userEvent.setup();
    seed({ ideStatuses: [ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false })] });
    render(<Setup />);

    const setUp = button('Set up Windsurf');
    await user.click(setUp);
    hostAnswers('action:setupIde', { ok: true }, { ideStatuses: [ide({ ideId: 'windsurf', label: 'Windsurf' })] });

    expect(button('Update Windsurf')).toBe(setUp);
    expect(setUp).toHaveFocus();
  });

  it('moves focus to Set up when Remove goes away', async () => {
    const user = userEvent.setup();
    seed({ ideStatuses: [ide({ ideId: 'windsurf', label: 'Windsurf' })] });
    render(<Setup />);

    await user.click(button('Remove Windsurf configuration'));
    hostAnswers('action:unconfigureIde', { ok: true }, { ideStatuses: [ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false })] });

    await waitFor(() => expect(button('Set up Windsurf')).toHaveFocus());
  });
});

describe('Setup all', () => {
  it('moves focus to the Editors heading when Setup all goes away', async () => {
    const user = userEvent.setup();
    const needWork = [
      ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
      ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
    ];
    seed({ ideStatuses: needWork });
    render(<Setup />);

    await user.click(button('Setup all detected editors'));
    hostAnswers('action:setupAll', { ok: true }, { ideStatuses: needWork.map(s => ({ ...s, mcpConfigured: true })) });

    await waitFor(() => expect(document.getElementById('editors-heading')).toHaveFocus());
  });
});

describe('Remote access', () => {
  async function openRemote(user: ReturnType<typeof userEvent.setup>) {
    await user.click(button('Remote access'));
  }

  it('keeps focus on the one remote-access slot when Enable becomes Disable', async () => {
    const user = userEvent.setup();
    seed();
    render(<Setup />);
    await openRemote(user);

    const enable = button('Enable remote access');
    await user.click(enable);
    hostAnswers('tunnel:enable', { ok: true }, { tunnel: { status: 'active', url: 'https://abc.trycloudflare.com', provider: 'cf-quick', ngrokAuthtokenSet: false, autoDisabledReason: null } });

    expect(button('Disable remote access')).toBe(enable);
    expect(enable).toHaveFocus();
  });

  it('moves focus into the token field on Replace, and back to Replace on Save and on Cancel', async () => {
    const user = userEvent.setup();
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: true } });
    render(<Setup />);
    await openRemote(user);

    await user.click(button('Replace token'));
    await waitFor(() => expect(screen.getByLabelText('ngrok auth token')).toHaveFocus());

    await user.click(button('Cancel'));
    await waitFor(() => expect(button('Replace token')).toHaveFocus());

    await user.click(button('Replace token'));
    await user.type(screen.getByLabelText('ngrok auth token'), 'new_tok');
    await user.click(button('Save token'));
    hostAnswers('tunnel:set-ngrok-authtoken', { ok: true }, {});

    await waitFor(() => expect(button('Replace token')).toHaveFocus());
  });
});

describe('Settings', () => {
  it('moves focus into the credentials form on open, and back to its button on Save and on Cancel', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'direct-login' } } }, 'settings');
    render(<Settings navigate={vi.fn()} />);

    await user.click(button('Update credentials'));
    await waitFor(() => expect(screen.getByLabelText('Airtable email')).toHaveFocus());

    await user.click(button('Cancel'));
    await waitFor(() => expect(button('Update credentials')).toHaveFocus());

    await user.click(button('Update credentials'));
    await user.type(screen.getByLabelText('Airtable email'), 'me@example.com');
    await user.type(screen.getByLabelText('Airtable password'), 'hunter2');
    await user.click(button('Save credentials to keychain'));
    hostAnswers('action:saveCredentials', { ok: true }, {});

    await waitFor(() => expect(button('Update credentials')).toHaveFocus());
  });

  it('moves focus to the cookie field when Clear saved cookie goes away', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { authMode: 'byo' } }, auth: { hasCookie: true } }, 'settings');
    render(<Settings navigate={vi.fn()} />);

    await user.click(button('Clear saved cookie'));
    hostAnswers('auth:clearCookie', { ok: true }, { auth: { ...useStore.getState().auth, hasCookie: false } });

    await waitFor(() => expect(screen.getByLabelText('Airtable session cookie')).toHaveFocus());
  });

  it('keeps focus on the bundled-Chromium slot from Download to Remove', async () => {
    const user = userEvent.setup();
    seed({ auth: { browser: { found: false }, availableBrowsers: [] } }, 'settings');
    render(<Settings navigate={vi.fn()} />);

    const download = button('Download bundled Chromium');
    await user.click(download);
    act(() => useStore.setState({
      auth: { ...useStore.getState().auth, browserDownload: { status: 'downloading', progress: 40 } },
    }));
    expect(download).toBeInTheDocument();
    expect(download).toHaveFocus();

    hostAnswers('action:install-browser', { ok: true }, {
      auth: { ...useStore.getState().auth, browser: BUNDLED, availableBrowsers: [BUNDLED], browserDownload: { status: 'done' } },
    });

    expect(button('Remove bundled Chromium')).toBe(download);
    expect(download).toHaveFocus();
  });

  it('moves focus to the Browser heading when the bundled-Chromium slot goes away', async () => {
    const user = userEvent.setup();
    seed({ auth: { browser: BUNDLED, availableBrowsers: [BUNDLED, CHROME] } }, 'settings');
    render(<Settings navigate={vi.fn()} />);

    await user.click(button('Remove bundled Chromium'));
    hostAnswers('action:removeBrowser', { ok: true }, {
      auth: { ...useStore.getState().auth, browser: CHROME, availableBrowsers: [CHROME] },
    });

    await waitFor(() => expect(document.getElementById('browser-settings-heading')).toHaveFocus());
  });
});

describe('Overview next action', () => {
  it('moves focus to the Overview heading when the next action resolves itself away', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined }, 'overview');
    render(<Overview navigate={vi.fn()} />);

    await user.click(button('Start service'));
    hostAnswers('daemon:start', { ok: true }, { daemon: makeDashboardState().daemon });

    expect(screen.queryByRole('button', { name: 'Start service' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('overview-heading')).toHaveFocus());
  });
});
