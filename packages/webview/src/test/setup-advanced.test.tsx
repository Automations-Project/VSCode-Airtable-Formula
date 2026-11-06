import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Disclosure } from '../components/Disclosure.js';
import { FormField } from '../components/FormField.js';
import { Setup } from '../tabs/Setup.js';
import { getMcpSnippet, getLspSnippet, getOfficialAirtableSnippet } from '../tabs/setup/snippets.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'setup' });
}

function posted(type: string): Array<Record<string, unknown>> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.type === type);
}

function remote(): HTMLElement {
  return screen.getByRole('region', { name: 'Remote access' });
}

function manual(): HTMLElement {
  return screen.getByRole('region', { name: 'Manual configuration' });
}

function official(): HTMLElement {
  return screen.getByRole('region', { name: 'Official Airtable MCP' });
}

function toggle(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function visibleSnippets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('pre code'));
}

describe('Setup section order and focus targets', () => {
  beforeEach(() => seed());

  it('renders the six sections in the locked order', () => {
    render(<Setup navigate={vi.fn()} />);

    const names = screen.getAllByRole('region').map(r => r.getAttribute('aria-labelledby'));
    expect(names).toEqual([
      'setup-heading',
      'local-service-heading',
      'editors-heading',
      'ai-skill-heading',
      'remote-access-heading',
      'manual-config-heading',
      'official-airtable-heading',
    ]);
  });

  it('exposes a focusable remote-access-heading for the Overview readiness link', () => {
    render(<Setup navigate={vi.fn()} />);

    const heading = document.getElementById('remote-access-heading');
    expect(heading).not.toBeNull();
    expect(heading).toHaveAttribute('tabindex', '-1');
    heading?.focus();
    expect(document.activeElement).toBe(heading);
    expect(within(remote()).getByRole('heading', { name: 'Remote access' })).toBe(heading);
  });
});

describe('Disclosure', () => {
  it('exposes aria-expanded and aria-controls on its trigger and toggles the panel', async () => {
    seed();
    render(<Setup navigate={vi.fn()} />);

    for (const name of ['Remote access', 'Manual configuration', 'Official Airtable MCP']) {
      const trigger = toggle(name);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      const panelId = trigger.getAttribute('aria-controls');
      expect(panelId, name).toBeTruthy();
      expect(document.getElementById(panelId!), name).toBeInTheDocument();
      expect(document.getElementById(panelId!)).not.toBeVisible();

      await userEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(document.getElementById(panelId!)).toBeVisible();
    }
  });

  it('is a keyboard operable native button inside a heading', async () => {
    seed();
    render(<Setup navigate={vi.fn()} />);

    const trigger = toggle('Manual configuration');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.closest('h2')).toHaveAttribute('id', 'manual-config-heading');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens when forceOpen turns true after mounting', () => {
    const { rerender } = render(
      <Disclosure id="probe" title="Probe" forceOpen={false}><p>Body</p></Disclosure>,
    );
    expect(screen.getByRole('button', { name: 'Probe' })).toHaveAttribute('aria-expanded', 'false');

    rerender(<Disclosure id="probe" title="Probe" forceOpen><p>Body</p></Disclosure>);
    expect(screen.getByRole('button', { name: 'Probe' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('FormField', () => {
  it('wires label, description and error to the control', () => {
    render(
      <FormField label="Hostname" description="Your domain" error="Required" required>
        {control => <input {...control} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Hostname');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Your domain Required');
    expect(screen.getByText('Required')).toHaveAttribute('role', 'alert');
  });

  it('omits aria-invalid and the error region when there is no error', () => {
    render(<FormField label="Domain">{control => <input {...control} />}</FormField>);

    expect(screen.getByLabelText('Domain')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Remote access', () => {
  it('is collapsed when disabled and healthy', () => {
    seed();
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Remote access')).toHaveAttribute('aria-expanded', 'false');
    expect(within(remote()).getByText('Disabled')).toBeInTheDocument();
  });

  it('uses a native provider select and announces tunnel failure', () => {
    seed({
      tunnel: { status: 'error', url: null, provider: 'ngrok', ngrokAuthtokenSet: false, autoDisabledReason: null },
    });
    render(<Setup navigate={vi.fn()} />);

    // Error auto-opens the section, so no click is needed (a click would collapse it).
    expect(toggle('Remote access')).toHaveAttribute('aria-expanded', 'true');
    const select = screen.getByRole('combobox', { name: 'Tunnel provider' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toBeVisible();
    expect(select).toHaveValue('ngrok');
    expect(screen.getByRole('alert')).toHaveTextContent('Remote access could not start');
  });

  it.each([
    ['active', 'Active'],
    ['starting', 'Starting'],
  ] as const)('opens automatically when the tunnel is %s', (status, label) => {
    seed({
      tunnel: {
        status, url: status === 'active' ? 'https://x.trycloudflare.com' : null,
        provider: 'cf-quick', ngrokAuthtokenSet: false, autoDisabledReason: null,
      },
    });
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Remote access')).toHaveAttribute('aria-expanded', 'true');
    // The summary's own state line; the panel also holds per-action result regions.
    const summary = within(remote()).getAllByRole('status').find(node => node.classList.contains('service-status'));
    expect(summary).toHaveTextContent(label);
  });

  function seedAutoDisabled(windowMs: number): void {
    seed({
      tunnel: {
        status: 'auto-disabled', url: null, provider: 'cf-quick', ngrokAuthtokenSet: false,
        autoDisabledReason: { failures: 5, windowMs, ip: '1.2.3.4' },
      },
    });
  }

  it('leaves an auto-disabled tunnel collapsed: it is a note, not a repair', () => {
    seedAutoDisabled(60_000);
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Remote access')).toHaveAttribute('aria-expanded', 'false');
    expect(within(remote()).getByText('Auto-disabled')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains auto-disable as status text, never an alert re-announced on every visit', async () => {
    seedAutoDisabled(60_000);
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    const note = within(remote()).getByText(/Remote access was turned off after/);
    expect(note).toHaveTextContent('5 auth failures from 1.2.3.4 in 60s');
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('omits the duration when the host reported no window', async () => {
    seedAutoDisabled(0);
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    const note = within(remote()).getByText(/Remote access was turned off after/);
    expect(note).toHaveTextContent('Remote access was turned off after 5 auth failures from 1.2.3.4.');
    expect(note).not.toHaveTextContent(/ in \d+s/);
  });

  it('opens on demand and needs a healthy service before enabling controls', async () => {
    seed({ daemon: { running: false, healthy: false, port: null, port_lsp: null, uptime: null } });
    render(<Setup navigate={vi.fn()} />);

    await userEvent.click(toggle('Remote access'));

    expect(within(remote()).getByText(/needs the local service to be running and healthy/i)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Tunnel provider' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enable remote access' })).toBeDisabled();
  });

  it('treats a running but unhealthy service as not ready', async () => {
    seed({ daemon: { running: true, healthy: false } });
    render(<Setup navigate={vi.fn()} />);

    await userEvent.click(toggle('Remote access'));

    expect(screen.getByRole('button', { name: 'Enable remote access' })).toBeDisabled();
  });

  it('offers Cloudflare quick tunnel with no extra inputs and posts tunnel:enable', async () => {
    seed();
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    expect(screen.queryByLabelText(/auth token/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hostname')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(posted('tunnel:enable')).toEqual([
      expect.objectContaining({ provider: 'cf-quick', authtoken: undefined, domain: undefined }),
    ]);
  });

  it('collects the ngrok token and reserved domain', async () => {
    seed();
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tunnel provider' }), 'ngrok');

    const token = screen.getByLabelText('ngrok auth token');
    expect(token).toHaveAttribute('type', 'password');
    await userEvent.type(token, 'tok_123');
    await userEvent.type(screen.getByLabelText('Reserved domain (optional)'), ' me.ngrok-free.app ');
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(posted('tunnel:enable')).toEqual([
      expect.objectContaining({ provider: 'ngrok', authtoken: 'tok_123', domain: 'me.ngrok-free.app' }),
    ]);
  });

  it('shows a stored ngrok token as a status and lets it be replaced', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: true } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    expect(screen.queryByLabelText('ngrok auth token')).not.toBeInTheDocument();
    expect(within(remote()).getByText('Auth token stored')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    await userEvent.type(screen.getByLabelText('ngrok auth token'), '  new_tok ');
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));

    expect(posted('tunnel:set-ngrok-authtoken')).toEqual([expect.objectContaining({ authtoken: 'new_tok' })]);
    // The typed token stays until the host confirms it stored it, then the field closes.
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('  new_tok ');
    act(() => useStore.getState().markActionDone(posted('tunnel:set-ngrok-authtoken')[0]!.id as string, { ok: true }));
    expect(screen.queryByLabelText('ngrok auth token')).not.toBeInTheDocument();
    expect(within(remote()).getByText('Auth token stored')).toBeVisible();
  });

  it('cancels replacing the ngrok token without posting', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: true } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    await userEvent.type(screen.getByLabelText('ngrok auth token'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(posted('tunnel:set-ngrok-authtoken')).toHaveLength(0);
    expect(within(remote()).getByText('Auth token stored')).toBeVisible();
  });

  it('requires a hostname for a first-time named tunnel and posts it trimmed', async () => {
    seed({ tunnel: { provider: 'cf-named', namedTunnelHostname: null } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    const hostname = screen.getByLabelText('Hostname');
    expect(hostname).toBeRequired();
    await userEvent.type(hostname, ' mcp.example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(posted('tunnel:enable')).toEqual([
      expect.objectContaining({ provider: 'cf-named', domain: 'mcp.example.com' }),
    ]);
  });

  it('shows the configured named hostname and makes a new one optional', async () => {
    seed({ tunnel: { provider: 'cf-named', namedTunnelHostname: 'mcp.example.com' } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    expect(within(remote()).getByText('Configured')).toBeVisible();
    expect(screen.getByLabelText('New hostname (optional)')).not.toBeRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(posted('tunnel:enable')).toEqual([expect.objectContaining({ provider: 'cf-named', domain: undefined })]);
  });

  it('locks the provider and offers Disable while the tunnel is active, with URL copy', async () => {
    const user = userEvent.setup();
    seed({
      tunnel: { status: 'active', url: 'https://abc.trycloudflare.com', provider: 'cf-quick' },
    });
    render(<Setup navigate={vi.fn()} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    expect(screen.getByRole('combobox', { name: 'Tunnel provider' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Enable remote access' })).not.toBeInTheDocument();
    expect(within(remote()).getByText('https://abc.trycloudflare.com')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Copy remote access URL' }));
    expect(writeText).toHaveBeenCalledWith('https://abc.trycloudflare.com');
    expect(await screen.findByText('URL copied')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Disable remote access' }));
    expect(posted('tunnel:disable')).toHaveLength(1);
  });

  it.each([
    ['active', { running: false, healthy: false, port: null, port_lsp: null, uptime: null }],
    ['active', { running: true, healthy: false }],
    ['starting', { running: false, healthy: false, port: null, port_lsp: null, uptime: null }],
  ] as const)('keeps Disable reachable when the tunnel is %s and the service is down', async (status, daemon) => {
    seed({ tunnel: { status, url: null, provider: 'cf-quick' }, daemon });
    render(<Setup navigate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Enable remote access' })).not.toBeInTheDocument();
    const disable = screen.getByRole('button', { name: 'Disable remote access' });
    expect(disable).toBeEnabled();
    await userEvent.click(disable);

    expect(posted('tunnel:disable')).toHaveLength(1);
  });

  it('still holds Disable while its own pending action is in flight', async () => {
    seed({ tunnel: { status: 'active', url: null, provider: 'cf-quick' }, daemon: { running: false, healthy: false } });
    render(<Setup navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Disable remote access' }));

    expect(screen.getByRole('button', { name: 'Disable remote access' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Disable remote access' }));
    expect(posted('tunnel:disable')).toHaveLength(1);
  });

  it('keeps Enable disabled while the service is not ready', async () => {
    seed({ tunnel: { status: 'disabled' }, daemon: { running: false, healthy: false, port: null, port_lsp: null, uptime: null } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    expect(screen.getByRole('button', { name: 'Enable remote access' })).toBeDisabled();
  });

  it('clears the typed ngrok token once Enable succeeds, so Replace starts empty', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: false } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    const token = screen.getByLabelText('ngrok auth token');
    await userEvent.type(token, 'tok_secret');
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(posted('tunnel:enable')).toEqual([expect.objectContaining({ authtoken: 'tok_secret' })]);
    // Kept until the host answers, so a failed enable never loses the secret.
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('tok_secret');

    // Host acknowledges, tunnel stops, and the token is now stored.
    act(() => {
      for (const id of useStore.getState().pendingTunnelActions) useStore.getState().markActionDone(id, { ok: true });
      useStore.setState({ tunnel: { status: 'disabled', url: null, provider: 'ngrok', ngrokAuthtokenSet: true, autoDisabledReason: null } });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));

    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save token' })).toBeDisabled();
  });

  it('holds the pending guard in the store so it survives a remount and blocks duplicates', async () => {
    seed();
    const first = render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));

    expect(useStore.getState().pendingTunnelActions.size).toBe(1);
    expect(screen.getByRole('button', { name: 'Enable remote access' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Enable remote access' })).toHaveAttribute('aria-busy', 'true');

    // Tab switch: component-local state is lost, the store guard is not.
    first.unmount();
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));
    expect(screen.getByRole('button', { name: 'Enable remote access' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));
    expect(posted('tunnel:enable')).toHaveLength(1);
  });

  it('does not lock tunnel controls on an unrelated pending action', async () => {
    useStore.setState({ ...makeDashboardState(), activeTab: 'setup', pendingActions: new Set(['unrelated']) });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));

    expect(screen.getByRole('button', { name: 'Enable remote access' })).toBeEnabled();
  });
});

describe('Browser download progress', () => {
  it('renders browser download as native progress', () => {
    seed({
      auth: { status: 'chrome-missing', hasCredentials: false, browserDownload: { status: 'downloading', progress: 42 } },
    });
    render(<Setup navigate={vi.fn()} />);

    const bar = screen.getByRole('progressbar', { name: 'Bundled Chromium download' });
    expect(bar.tagName).toBe('PROGRESS');
    expect(bar).toHaveAttribute('value', '42');
    expect(bar).toHaveAttribute('max', '100');
    expect(bar).not.toHaveAttribute('style');
  });

  it('does not render progress when nothing is downloading', () => {
    seed({ auth: { status: 'chrome-missing', hasCredentials: false, browserDownload: { status: 'idle' } } });
    render(<Setup navigate={vi.fn()} />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('clamps out-of-range progress', () => {
    seed({ auth: { status: 'chrome-missing', hasCredentials: false, browserDownload: { status: 'downloading', progress: 180 } } });
    render(<Setup navigate={vi.fn()} />);

    expect(screen.getByRole('progressbar', { name: 'Bundled Chromium download' })).toHaveAttribute('value', '100');
  });
});

describe('Manual configuration', () => {
  beforeEach(() => seed());

  it('is collapsed by default and exposes MCP and LSP as separate disclosures', async () => {
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Manual configuration')).toHaveAttribute('aria-expanded', 'false');
    expect(visibleSnippets()).toHaveLength(0);

    await userEvent.click(toggle('Manual configuration'));
    expect(toggle('MCP server')).toHaveAttribute('aria-expanded', 'false');
    expect(toggle('LSP server')).toHaveAttribute('aria-expanded', 'false');
    expect(visibleSnippets()).toHaveLength(0);
  });

  it('uses native selects named Client and Protocol and renders one snippet', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    const client = within(manual()).getByRole('combobox', { name: 'Client' });
    const protocol = within(manual()).getByRole('combobox', { name: 'Protocol' });
    expect(client.tagName).toBe('SELECT');
    expect(protocol.tagName).toBe('SELECT');
    expect(within(manual()).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(manual()).queryByRole('tablist')).not.toBeInTheDocument();
    expect(visibleSnippets()).toHaveLength(1);
    expect(visibleSnippets()[0].textContent).toBe(getMcpSnippet('claude-code', 'http', 8723));
  });

  it('switches the MCP snippet with the selects', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    await userEvent.selectOptions(within(manual()).getByRole('combobox', { name: 'Client' }), 'cursor');
    expect(visibleSnippets()[0].textContent).toBe(getMcpSnippet('cursor', 'http', 8723));
    await userEvent.selectOptions(within(manual()).getByRole('combobox', { name: 'Protocol' }), 'stdio');
    expect(visibleSnippets()[0].textContent).toBe(getMcpSnippet('cursor', 'stdio', 8723));
    expect(visibleSnippets()).toHaveLength(1);
  });

  it('points HTTP snippets at the public tunnel URL when active', async () => {
    seed({ tunnel: { status: 'active', url: 'https://abc.trycloudflare.com' } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    expect(visibleSnippets()[0].textContent).toBe(getMcpSnippet('claude-code', 'http', 'https://abc.trycloudflare.com'));
    expect(within(manual()).getByText('via tunnel')).toBeVisible();
  });

  it('shows one snippet at a time: opening LSP closes MCP', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));
    await userEvent.click(toggle('LSP server'));

    expect(toggle('MCP server')).toHaveAttribute('aria-expanded', 'false');
    expect(toggle('LSP server')).toHaveAttribute('aria-expanded', 'true');
    expect(visibleSnippets()).toHaveLength(1);
    expect(visibleSnippets()[0].textContent).toBe(getLspSnippet('claude-code', 'tcp', 8724));
    expect(within(manual()).getByRole('combobox', { name: 'Client' })).toBeVisible();
    expect(within(manual()).getAllByRole('combobox', { name: 'Client' })).toHaveLength(1);

    await userEvent.selectOptions(within(manual()).getByRole('combobox', { name: 'Protocol' }), 'stdio');
    expect(visibleSnippets()[0].textContent).toBe(getLspSnippet('claude-code', 'stdio', 8724));
  });

  it('copies the snippet to the clipboard and announces it', async () => {
    const user = userEvent.setup();
    render(<Setup navigate={vi.fn()} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(toggle('Manual configuration'));
    await user.click(toggle('MCP server'));

    expect(within(manual()).getByRole('status')).toHaveTextContent('');
    await user.click(within(manual()).getByRole('button', { name: 'Copy configuration' }));

    expect(writeText).toHaveBeenCalledWith(getMcpSnippet('claude-code', 'http', 8723));
    expect(await within(manual()).findByText('Configuration copied')).toBeVisible();
    expect(within(manual()).getByRole('status')).toHaveTextContent('Configuration copied');
  });

  it('does not claim success when the clipboard rejects', async () => {
    const user = userEvent.setup();
    render(<Setup navigate={vi.fn()} />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(toggle('Manual configuration'));
    await user.click(toggle('LSP server'));

    await user.click(within(manual()).getByRole('button', { name: 'Copy configuration' }));

    expect(await within(manual()).findByText('Copy failed')).toBeVisible();
    expect(within(manual()).queryByText('Configuration copied')).not.toBeInTheDocument();
  });

  it('renders the snippet as a scrollable code region without inline styles', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    const pre = visibleSnippets()[0].closest('pre') as HTMLElement;
    expect(pre).toHaveClass('snippet-card__code');
    expect(pre).toHaveAttribute('tabindex', '0');
    expect(pre).toHaveAccessibleName(/JSON|configuration/i);
    expect(manual().querySelectorAll('[style]')).toHaveLength(0);
  });

  it('keeps bearer-token copy in the Local service Safety disclosure only', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    expect(within(manual()).queryByRole('button', { name: /copy token/i })).not.toBeInTheDocument();
    expect(within(manual()).getByText(/Local service/)).toBeVisible();
    expect(within(manual()).getByText('{{BEARER_TOKEN}}')).toBeVisible();
  });

  it('shows no token placeholder note for stdio snippets', async () => {
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));
    await userEvent.selectOptions(within(manual()).getByRole('combobox', { name: 'Protocol' }), 'stdio');

    expect(within(manual()).queryByText('{{BEARER_TOKEN}}')).not.toBeInTheDocument();
  });

  it('falls back to port placeholders without a daemon', async () => {
    seed({ daemon: undefined });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));

    expect(visibleSnippets()[0].textContent).toBe(getMcpSnippet('claude-code', 'http', '{MCP_PORT}'));
  });
});

describe('Official Airtable MCP', () => {
  it('is collapsed by default and labelled as complementary', async () => {
    seed();
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Official Airtable MCP')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle('Official Airtable MCP'));
    expect(within(official()).getByText(/complement/i)).toBeVisible();
  });

  it('labels the PAT field, never echoes a saved PAT, and posts Save', async () => {
    seed({ officialAirtable: { patSet: false, ideConfigured: {} } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Official Airtable MCP'));

    const field = screen.getByLabelText('Personal access token');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save token' })).toBeDisabled();
    await userEvent.type(field, 'pat123.secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));

    expect(posted('action:save-airtable-pat')).toEqual([expect.objectContaining({ pat: 'pat123.secret' })]);
    // Held until the host confirms the save (a failure must not lose it), then cleared.
    expect(field).toHaveValue('pat123.secret');
    act(() => useStore.getState().markActionDone(posted('action:save-airtable-pat')[0]!.id as string, { ok: true }));
    expect(field).toHaveValue('');
  });

  it('shows a saved PAT only as status text, with Update and Copy actions', async () => {
    seed({ officialAirtable: { patSet: true, ideConfigured: {} } });
    render(<Setup navigate={vi.fn()} />);

    // PAT saved but not applied anywhere is a configuration issue, so it opens.
    expect(toggle('Official Airtable MCP')).toHaveAttribute('aria-expanded', 'true');
    const field = screen.getByLabelText('Personal access token');
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('placeholder', expect.stringMatching(/•/));
    expect(within(official()).getByText('Token saved')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update token' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Copy saved token' }));
    expect(posted('action:copy-airtable-pat')).toHaveLength(1);
    expect(document.body.innerHTML).not.toMatch(/pat[A-Za-z0-9]{6,}\.[A-Za-z0-9]{6,}/);
  });

  it('keeps per-editor configure and remove buttons', async () => {
    seed({
      ideStatuses: [
        { ideId: 'cursor', label: 'Cursor', detected: true, mcpConfigured: true, mcpServerHealthy: true,
          aiSkill: { status: 'installed', version: '2.3.0' } },
        { ideId: 'cline', label: 'Cline', detected: true, mcpConfigured: true, mcpServerHealthy: true,
          aiSkill: { status: 'installed', version: '2.3.0' } },
        { ideId: 'amp', label: 'Amp', detected: false, mcpConfigured: false, mcpServerHealthy: false,
          aiSkill: { status: 'missing' } },
      ],
      officialAirtable: { patSet: true, ideConfigured: { cursor: true, cline: false } },
    });
    render(<Setup navigate={vi.fn()} />);
    // A saved PAT with one editor already configured is healthy, so it starts collapsed.
    expect(toggle('Official Airtable MCP')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle('Official Airtable MCP'));

    expect(within(screen.getByRole('list', { name: 'Detected editors' })).queryByText('Amp')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Configure Cline' }));
    expect(posted('action:configure-official-airtable')).toEqual([expect.objectContaining({ ideId: 'cline' })]);
    // The host acknowledges the first action before the next one may start.
    act(() => {
      for (const id of useStore.getState().pendingOfficialActions) useStore.getState().markActionDone(id, { ok: true });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cursor' }));
    expect(posted('action:unconfigure-official-airtable')).toEqual([expect.objectContaining({ ideId: 'cursor' })]);
  });

  it('disables Configure until a PAT is saved', async () => {
    seed({ officialAirtable: { patSet: false, ideConfigured: {} } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Official Airtable MCP'));

    expect(screen.getByRole('button', { name: 'Configure Cursor' })).toBeDisabled();
    expect(within(official()).getByText(/save (your|a) (token|PAT) first/i)).toBeVisible();
  });

  it('blocks duplicate configure actions through the store-held pending set', async () => {
    seed({ officialAirtable: { patSet: true, ideConfigured: { cursor: false } } });
    const first = render(<Setup navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Configure Cursor' }));
    expect(useStore.getState().pendingOfficialActions.size).toBe(1);
    expect(screen.getByRole('button', { name: 'Configure Cursor' })).toHaveAttribute('aria-disabled', 'true');

    first.unmount();
    render(<Setup navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Configure Cursor' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Configure Cursor' }));
    expect(posted('action:configure-official-airtable')).toHaveLength(1);

    act(() => {
      for (const id of useStore.getState().pendingOfficialActions) useStore.getState().markActionDone(id, { ok: true });
    });
    expect(screen.getByRole('button', { name: 'Configure Cursor' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Configure Cursor' })).not.toHaveAttribute('aria-disabled');
  });

  it('does not lock official controls on an unrelated pending action', async () => {
    useStore.setState({
      ...makeDashboardState({ officialAirtable: { patSet: true, ideConfigured: { cursor: false } } }),
      activeTab: 'setup',
      pendingActions: new Set(['unrelated']),
    });
    render(<Setup navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Configure Cursor' })).toBeEnabled();
  });

  it('selects the official snippet client with a native select and copies it', async () => {
    const user = userEvent.setup();
    seed({ officialAirtable: { patSet: false, ideConfigured: {} } });
    render(<Setup navigate={vi.fn()} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(toggle('Official Airtable MCP'));

    const client = within(official()).getByRole('combobox', { name: 'Client' });
    expect(client.tagName).toBe('SELECT');
    expect(visibleSnippets()).toHaveLength(1);
    expect(visibleSnippets()[0].textContent).toBe(getOfficialAirtableSnippet('claude-code'));

    await user.selectOptions(client, 'cursor');
    expect(visibleSnippets()[0].textContent).toBe(getOfficialAirtableSnippet('cursor'));
    await user.click(within(official()).getByRole('button', { name: 'Copy configuration' }));
    expect(writeText).toHaveBeenCalledWith(getOfficialAirtableSnippet('cursor'));
    expect(await within(official()).findByText('Configuration copied')).toBeVisible();
  });

  it('opens when a configured editor has no saved PAT', () => {
    seed({ officialAirtable: { patSet: false, ideConfigured: { cursor: true } } });
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Official Airtable MCP')).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays collapsed when a PAT is saved and an editor is configured', () => {
    seed({ officialAirtable: { patSet: true, ideConfigured: { cursor: true } } });
    render(<Setup navigate={vi.fn()} />);

    expect(toggle('Official Airtable MCP')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Narrow-width form markup', () => {
  it('uses plain wrapping form rows with no forced column roles or inline styles', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: false } });
    render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Remote access'));
    await userEvent.click(toggle('Official Airtable MCP'));

    const rows = document.querySelectorAll('.form-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveAttribute('role');
      expect(row.querySelector('table, [role="table"], [role="grid"], [role="row"], [role="columnheader"]')).toBeNull();
    }
    for (const label of document.querySelectorAll('.form-field__label')) {
      expect(label).toBeVisible();
      expect(label.textContent?.trim()).not.toBe('');
    }
    for (const region of [remote(), official()]) {
      expect(region.querySelectorAll('[style]')).toHaveLength(0);
    }
  });
});

describe('Setup accessibility', () => {
  it('has no axe violations with every disclosure open', async () => {
    seed({
      tunnel: { status: 'error', url: null, provider: 'ngrok', ngrokAuthtokenSet: false, autoDisabledReason: null },
      officialAirtable: { patSet: false, ideConfigured: {} },
      auth: { status: 'chrome-missing', hasCredentials: false, browserDownload: { status: 'downloading', progress: 10 } },
    });
    const { container } = render(<Setup navigate={vi.fn()} />);
    await userEvent.click(toggle('Manual configuration'));
    await userEvent.click(toggle('MCP server'));
    await userEvent.click(toggle('Official Airtable MCP'));

    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.html).join(' | ')}`)).toEqual([]);
  });
});
