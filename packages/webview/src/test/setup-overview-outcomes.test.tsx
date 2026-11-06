import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IdeStatus } from '@shared/types.js';
import type { ActionOutcome } from '../store.js';
import { useStore } from '../store.js';
import { Overview } from '../tabs/Overview.js';
import { Setup } from '../tabs/Setup.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

// Every host action in Setup and Overview reports its own confirmed result in
// place: role=status on success, role=alert with the host's error on failure.


function ide(overrides: Partial<IdeStatus> & Pick<IdeStatus, 'ideId' | 'label'>): IdeStatus {
  return { detected: true, mcpConfigured: true, mcpServerHealthy: true, aiSkill: { status: 'installed', version: '2.3.0' }, ...overrides };
}

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'setup' });
}

function posted(type: string): Array<Record<string, unknown> & { id: string }> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown> & { id: string })
    .filter(message => message.type === type);
}

function settleLast(type: string, outcome: ActionOutcome): void {
  const id = posted(type).at(-1)?.id;
  if (!id) throw new Error(`no ${type} was posted`);
  act(() => useStore.getState().markActionDone(id, outcome));
}

const region = (name: string) => screen.getByRole('region', { name });
const statusText = (container: HTMLElement) =>
  within(container).getAllByRole('status').map(node => node.textContent ?? '').join(' | ');

describe('Editors outcomes', () => {
  const twoNeedWork = [
    ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false }),
    ide({ ideId: 'windsurf', label: 'Windsurf', mcpConfigured: false }),
  ];

  it('reports a failed setup-all with the host error', async () => {
    seed({ ideStatuses: twoNeedWork });
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Setup all detected editors' }));
    settleLast('action:setupAll', { ok: false, error: 'EACCES: Cursor settings are read-only' });

    expect(within(region('Editors')).getByRole('alert')).toHaveTextContent('EACCES: Cursor settings are read-only');
  });

  it('confirms setup-all only on success, and keeps saying so after its button goes away', async () => {
    seed({ ideStatuses: twoNeedWork });
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Setup all detected editors' }));
    expect(statusText(region('Editors'))).not.toMatch(/set up/i);

    act(() => useStore.setState({ ideStatuses: twoNeedWork.map(s => ({ ...s, mcpConfigured: true })) }));
    settleLast('action:setupAll', { ok: true });

    expect(screen.queryByRole('button', { name: 'Setup all detected editors' })).not.toBeInTheDocument();
    expect(statusText(region('Editors'))).toContain('All detected editors set up.');
  });

  it('reports a per-editor failure on that editor card only', async () => {
    seed({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor' }), ide({ ideId: 'windsurf', label: 'Windsurf' })] });
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Update Cursor' }));
    settleLast('action:setupIde', { ok: false, error: 'ENOENT: mcp.json' });

    expect(within(screen.getByRole('article', { name: 'Cursor' })).getByRole('alert')).toHaveTextContent('ENOENT: mcp.json');
    expect(within(screen.getByRole('article', { name: 'Windsurf' })).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confirms set up and remove on the card that ran them', async () => {
    seed({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor', mcpConfigured: false })] });
    render(<Setup />);
    const cursor = () => screen.getByRole('article', { name: 'Cursor' });

    await userEvent.click(screen.getByRole('button', { name: 'Set up Cursor' }));
    act(() => useStore.setState({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor' })] }));
    settleLast('action:setupIde', { ok: true });
    expect(statusText(cursor())).toContain('Cursor set up.');

    await userEvent.click(screen.getByRole('button', { name: 'Remove Cursor configuration' }));
    settleLast('action:unconfigureIde', { ok: true });
    expect(statusText(cursor())).toContain('Cursor configuration removed.');
  });

  it('reports a skill install on the card that started it, and confirms an update after its button goes away', async () => {
    seed({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor', aiSkill: { status: 'missing' } })] });
    render(<Setup />);
    const cursor = () => screen.getByRole('article', { name: 'Cursor' });

    await userEvent.click(screen.getByRole('button', { name: 'Install skill' }));
    settleLast('action:installSkill', { ok: false, error: 'EACCES: ~/.cursor/skills' });
    expect(within(cursor()).getByRole('alert')).toHaveTextContent('EACCES: ~/.cursor/skills');

    act(() => useStore.setState({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor', aiSkill: { status: 'outdated' } })] }));
    await userEvent.click(screen.getByRole('button', { name: 'Update skill' }));
    act(() => useStore.setState({ ideStatuses: [ide({ ideId: 'cursor', label: 'Cursor' })] }));
    settleLast('action:installSkill', { ok: true });
    expect(screen.queryByRole('button', { name: 'Update skill' })).not.toBeInTheDocument();
    expect(statusText(cursor())).toContain('AI skill updated.');
    expect(within(cursor()).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Local service outcomes', () => {
  it('reports a failed stop with the host error', async () => {
    seed();
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Stop service' }));
    settleLast('daemon:stop', { ok: false, error: 'Daemon did not exit.' });

    expect(within(region('Local service')).getByRole('alert')).toHaveTextContent('Daemon did not exit.');
  });

  it('confirms a restart request only once the host accepts it', async () => {
    seed();
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Restart service' }));
    expect(statusText(region('Local service'))).not.toMatch(/requested/);
    settleLast('daemon:restart', { ok: true });

    expect(statusText(region('Local service'))).toContain('Service restart requested.');
  });

  it('says "Token rotated" only after the host confirms, and shows a failed rotation', async () => {
    seed();
    render(<Setup />);
    await userEvent.click(within(region('Local service')).getByText('Safety'));

    await userEvent.click(screen.getByRole('button', { name: 'Rotate token' }));
    expect(screen.queryByText(/Token rotated/)).not.toBeInTheDocument();
    settleLast('daemon:rotate-token', { ok: false, error: 'HTTP 401' });

    expect(within(region('Local service')).getByRole('alert')).toHaveTextContent('HTTP 401');
    expect(screen.queryByText(/Token rotated/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Rotate token' }));
    settleLast('daemon:rotate-token', { ok: true });
    expect(screen.getByText(/Token rotated/)).toBeInTheDocument();
    expect(within(region('Local service')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says "Token copied" only after the host copied it', async () => {
    seed();
    render(<Setup />);
    await userEvent.click(within(region('Local service')).getByText('Safety'));

    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(screen.queryByText(/Token copied/)).not.toBeInTheDocument();
    settleLast('daemon:copy-bearer-token', { ok: false, error: 'Token not found' });
    expect(within(region('Local service')).getByRole('alert')).toHaveTextContent('Token not found');
    expect(screen.queryByText(/Token copied/)).not.toBeInTheDocument();
  });
});

describe('Remote access outcomes', () => {
  it('reports a failed disable with the host error', async () => {
    seed({ tunnel: { status: 'active', url: 'https://abc.trycloudflare.com', provider: 'cf-quick' } });
    render(<Setup />);

    await userEvent.click(screen.getByRole('button', { name: 'Disable remote access' }));
    settleLast('tunnel:disable', { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:8723' });

    expect(within(region('Remote access')).getByRole('alert')).toHaveTextContent('connect ECONNREFUSED 127.0.0.1:8723');
  });

  it('keeps the typed ngrok token through a failed enable, and clears it on success', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: false } });
    render(<Setup />);
    await userEvent.click(screen.getByRole('button', { name: 'Remote access' }));
    await userEvent.type(screen.getByLabelText('ngrok auth token'), 'tok_secret');

    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('tok_secret');
    settleLast('tunnel:enable', { ok: false, error: 'ERR_NGROK_105: authtoken invalid' });

    expect(within(region('Remote access')).getByRole('alert')).toHaveTextContent('ERR_NGROK_105: authtoken invalid');
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('tok_secret');

    await userEvent.click(screen.getByRole('button', { name: 'Enable remote access' }));
    settleLast('tunnel:enable', { ok: true });
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('');
    expect(statusText(region('Remote access'))).toContain('Remote access enabled.');
  });

  it('keeps a replacement ngrok token through a failed save and closes the field on success', async () => {
    seed({ tunnel: { provider: 'ngrok', ngrokAuthtokenSet: true } });
    render(<Setup />);
    await userEvent.click(screen.getByRole('button', { name: 'Remote access' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    await userEvent.type(screen.getByLabelText('ngrok auth token'), 'new_tok');

    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    settleLast('tunnel:set-ngrok-authtoken', { ok: false, error: 'SecretStorage is unavailable' });

    expect(within(region('Remote access')).getByRole('alert')).toHaveTextContent('SecretStorage is unavailable');
    expect(screen.getByLabelText('ngrok auth token')).toHaveValue('new_tok');

    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    settleLast('tunnel:set-ngrok-authtoken', { ok: true });
    expect(screen.queryByLabelText('ngrok auth token')).not.toBeInTheDocument();
    expect(statusText(region('Remote access'))).toContain('ngrok token saved.');
  });
});

describe('Official Airtable MCP outcomes', () => {
  async function openOfficial(): Promise<void> {
    if (screen.getByRole('button', { name: 'Official Airtable MCP' }).getAttribute('aria-expanded') !== 'true') {
      await userEvent.click(screen.getByRole('button', { name: 'Official Airtable MCP' }));
    }
  }

  it('keeps the typed PAT through a failed save and reports the host error', async () => {
    seed({ officialAirtable: { patSet: false, ideConfigured: {} } });
    render(<Setup />);
    await openOfficial();
    const field = screen.getByLabelText('Personal access token');

    await userEvent.type(field, 'pat123.secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(field).toHaveValue('pat123.secret');
    settleLast('action:save-airtable-pat', { ok: false, error: 'SecretStorage is unavailable' });

    expect(within(region('Official Airtable MCP')).getByRole('alert')).toHaveTextContent('SecretStorage is unavailable');
    expect(screen.getByLabelText('Personal access token')).toHaveValue('pat123.secret');
    expect(within(region('Official Airtable MCP')).getByText('No token')).toBeInTheDocument();
  });

  it('clears the typed PAT only once the host saved it', async () => {
    seed({ officialAirtable: { patSet: false, ideConfigured: {} } });
    render(<Setup />);
    await openOfficial();

    await userEvent.type(screen.getByLabelText('Personal access token'), 'pat123.secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    settleLast('action:save-airtable-pat', { ok: true });

    expect(screen.getByLabelText('Personal access token')).toHaveValue('');
    expect(statusText(region('Official Airtable MCP'))).toContain('Token saved.');
  });

  it('reports a failed per-editor remove with the host error on that editor', async () => {
    seed({ officialAirtable: { patSet: true, ideConfigured: { cursor: true } } });
    render(<Setup />);
    await openOfficial();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Cursor' }));
    settleLast('action:unconfigure-official-airtable', { ok: false, error: 'EPERM: settings.json' });

    const row = within(screen.getByRole('list', { name: 'Detected editors' })).getByText('Cursor').closest('li') as HTMLElement;
    expect(within(row).getByRole('alert')).toHaveTextContent('EPERM: settings.json');
  });

  it('says "Token copied" only after the host copied the saved PAT', async () => {
    seed({ officialAirtable: { patSet: true, ideConfigured: { cursor: true } } });
    render(<Setup />);
    await openOfficial();

    await userEvent.click(screen.getByRole('button', { name: 'Copy saved token' }));
    expect(screen.queryByText(/Token copied/)).not.toBeInTheDocument();
    settleLast('action:copy-airtable-pat', { ok: true });
    expect(screen.getByText(/Token copied/)).toBeInTheDocument();
  });
});

describe('Overview outcomes', () => {
  function seedOverview(overrides: DashboardStateOverrides): void {
    useStore.setState({ ...makeDashboardState(overrides), activeTab: 'overview' });
  }

  it('reports a failed next action with the host error', async () => {
    seedOverview({ daemon: undefined });
    render(<Overview navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start service' }));
    settleLast('daemon:start', { ok: false, error: 'Daemon manager unavailable' });

    expect(screen.getByRole('alert')).toHaveTextContent('Daemon manager unavailable');
  });

  it('keeps the confirmation after the next action resolves itself away', async () => {
    seedOverview({ auth: { status: 'expired', hasCredentials: true } });
    render(<Overview navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    act(() => useStore.setState({ auth: { ...useStore.getState().auth, status: 'valid' } }));
    settleLast('action:login', { ok: true });

    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').some(node => node.textContent === 'Sign-in finished.')).toBe(true);
  });

  it('confirms or reports Refresh status', async () => {
    seedOverview({});
    render(<Overview navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    settleLast('action:refresh', { ok: false, error: 'Host is busy' });
    expect(within(region('Status')).getByRole('alert')).toHaveTextContent('Host is busy');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    settleLast('action:refresh', { ok: true });
    expect(statusText(region('Status'))).toContain('Status refreshed.');
  });
});
