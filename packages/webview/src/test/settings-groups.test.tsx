import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCategories } from '@shared/types.js';
import { Settings } from '../tabs/Settings.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

const GROUPS = [
  'Account and authentication',
  'Browser',
  'Tool safety',
  'Formula and scripting',
  'Storage and session backup',
  'Diagnostics',
  'Advanced runtime',
  'Support and About',
];

const CATEGORY_LABELS: Record<keyof ToolCategories, string> = {
  read: 'Read / Inspect',
  recordRead: 'Record Read',
  tableWrite: 'Table Write',
  tableDestructive: 'Table Destructive',
  fieldWrite: 'Field Write',
  fieldDestructive: 'Field Destructive',
  viewWrite: 'View Write',
  viewDestructive: 'View Destructive',
  viewSection: 'View Sections',
  viewSectionDestructive: 'View Sections (destructive)',
  formWrite: 'Form Metadata',
  extension: 'Extension Management',
  recordWrite: 'Record Write',
  recordDestructive: 'Record Destructive',
  sync: 'Sync',
  localWrite: 'Local File Write',
  daemon: 'Daemon Control',
};

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'settings' });
}

function posted(type: string): Array<Record<string, unknown>> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.type === type);
}

function lastChange(): Record<string, unknown> {
  return posted('setting:change').at(-1)?.change as Record<string, unknown>;
}

function settle(id: unknown, outcome: { ok: boolean; error?: string; cancelled?: boolean }): void {
  act(() => useStore.getState().markActionDone(String(id), outcome));
}

const toolSafety = () => screen.getByRole('region', { name: 'Tool safety' });
const formulaScripting = () => screen.getByRole('region', { name: 'Formula and scripting' });
const diagnostics = () => screen.getByRole('region', { name: 'Diagnostics' });
const advanced = () => screen.getByRole('region', { name: 'Advanced runtime' });

async function open(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name }));
  return user;
}

beforeEach(() => seed());

describe('Settings structure', () => {
  it('renders the eight locked groups in order', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent?.replace(/^[▸▾]\s*/, '').trim())).toEqual(GROUPS);
  });

  it('exposes a focusable page heading and Tool safety heading for navigate() landings', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toHaveAttribute('id', 'settings-heading');
    for (const id of ['settings-heading', 'tool-safety-heading']) {
      const heading = document.getElementById(id);
      expect(heading, id).not.toBeNull();
      expect(heading).toHaveAttribute('tabindex', '-1');
      heading?.focus();
      expect(document.activeElement).toBe(heading);
    }
    expect(screen.getByRole('heading', { name: 'Tool safety' })).toHaveAttribute('id', 'tool-safety-heading');
  });

  it('keeps diagnostics and advanced runtime collapsed by default', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Diagnostics' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Advanced runtime' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: 'Debug tracing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Server source' })).not.toBeInTheDocument();
  });

  it('keeps daemon lifecycle out of Settings and links to Setup', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<Settings navigate={navigate} />);
    await user.click(screen.getByRole('button', { name: 'Advanced runtime' }));

    for (const name of [/Start service/, /Stop service/, /Restart service/, /bearer/i, /tunnel/i, /rotate/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Manage local service in Setup' }));
    expect(navigate).toHaveBeenCalledWith('setup', 'local-service-heading');
  });

  it('has no axe violations with every disclosure open and custom categories shown', async () => {
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } });
    const { container } = render(<Settings navigate={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await user.click(screen.getByRole('button', { name: 'Advanced runtime' }));

    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(',')}`)).toEqual([]);
  });
});

describe('Tool safety', () => {
  it('offers the four profiles and posts the chosen one', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    const select = within(toolSafety()).getByRole('combobox', { name: 'Active profile' });
    expect(within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value))
      .toEqual(['read-only', 'safe-write', 'full', 'custom']);
    expect(select).toHaveValue('safe-write');

    await user.selectOptions(select, 'full');
    expect(lastChange()).toEqual({ key: 'mcp.toolProfile', value: 'full' });
  });

  it('reports the enabled count and how many tools are hidden', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(within(toolSafety()).getByText('54 of 72 tools enabled')).toBeVisible();
    expect(within(toolSafety()).getByText(/18 hidden from AI agents/)).toBeVisible();
  });

  it('shows no category toggles unless the profile is custom', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(within(toolSafety()).queryByRole('switch', { name: 'Sync' })).not.toBeInTheDocument();
  });

  it('keeps every tool-category toggle under custom and posts the category DTO', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } });
    render(<Settings navigate={vi.fn()} />);

    const entries = Object.entries(CATEGORY_LABELS) as Array<[keyof ToolCategories, string]>;
    expect(entries).toHaveLength(17);
    for (const [category, label] of entries) {
      const toggle = within(toolSafety()).getByRole('switch', { name: label });
      const was = (toggle as HTMLInputElement).checked;
      await user.click(toggle);
      expect(lastChange()).toEqual({ key: 'mcp.category', category, value: !was });
    }
    expect(posted('setting:change').every(m => !JSON.stringify(m).includes('mcp.categories.'))).toBe(true);
  });

  it('guards each category by its exact scope and survives a remount', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } });
    const first = render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('switch', { name: 'View Sections' }));
    expect(screen.getByRole('switch', { name: 'View Sections' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'View Sections (destructive)' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Active profile' })).toBeEnabled();

    first.unmount();
    render(<Settings navigate={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'View Sections' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'View Sections (destructive)' })).toBeEnabled();
  });

  it('states which categories mutate or delete, in text', () => {
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } });
    render(<Settings navigate={vi.fn()} />);

    expect(within(toolSafety()).getByText(/apply mutates the destination and can delete under policy=mirror/)).toBeVisible();
    expect(within(toolSafety()).getByText(/delete_records/)).toBeVisible();
  });

  it('opens the raw tool configuration and reports a failure', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open tool-config.json' }));
    const message = posted('action:openToolConfig').at(-1)!;
    expect(message).toBeDefined();

    settle(message.id, { ok: false, error: 'No such file' });
    expect(await within(toolSafety()).findByRole('alert')).toHaveTextContent('No such file');
  });
});

describe('Formula and scripting', () => {
  it('keeps the AI file switches', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.click(within(formulaScripting()).getByRole('switch', { name: 'Auto-install AI files' }));
    expect(lastChange()).toEqual({ key: 'ai.autoInstallFiles', value: false });
    await user.click(within(formulaScripting()).getByRole('switch', { name: 'Include agent files' }));
    expect(lastChange()).toEqual({ key: 'ai.includeAgents', value: true });
  });

  it('offers formatter v1 and v2', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    const select = within(formulaScripting()).getByRole('combobox', { name: 'Formatter version' });
    expect(within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['v2', 'v1']);
    await user.selectOptions(select, 'v1');
    expect(lastChange()).toEqual({ key: 'formula.formatterVersion', value: 'v1' });
  });

  it('offers five beautify styles and four minify levels', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    const beautify = within(formulaScripting()).getByRole('combobox', { name: 'Beautify style' });
    expect(within(beautify).getAllByRole('option').map(o => (o as HTMLOptionElement).value))
      .toEqual(['default', 'compact', 'singleQuote', 'tabIndent', 'semicolonFree']);
    await user.selectOptions(beautify, 'tabIndent');
    expect(lastChange()).toEqual({ key: 'script.beautifyStyle', value: 'tabIndent' });

    const minify = within(formulaScripting()).getByRole('combobox', { name: 'Minify level' });
    expect(within(minify).getAllByRole('option').map(o => (o as HTMLOptionElement).value))
      .toEqual(['safe', 'standard', 'aggressive', 'extreme']);
    await user.selectOptions(minify, 'extreme');
    expect(lastChange()).toEqual({ key: 'script.minifyLevel', value: 'extreme' });
  });

  it('shows local failure feedback and keeps the saved selection', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.selectOptions(within(formulaScripting()).getByRole('combobox', { name: 'Formatter version' }), 'v1');
    settle(posted('setting:change').at(-1)!.id, { ok: false, error: 'Write refused' });

    expect(await within(formulaScripting()).findByRole('alert')).toHaveTextContent('Write refused');
    expect(within(formulaScripting()).getByRole('combobox', { name: 'Formatter version' })).toHaveValue('v2');
  });
});

describe('Diagnostics', () => {
  it('summarises recording state and event count while collapsed', () => {
    seed({ debug: { enabled: true, sessionActive: true, eventCount: 12, bufferCapacity: 1000, verboseHttp: false } });
    render(<Settings navigate={vi.fn()} />);

    expect(within(diagnostics()).getByRole('status')).toHaveTextContent('Recording');
    expect(within(diagnostics()).getByText(/12 of 1,000 events/)).toBeVisible();
  });

  it('reads Idle when there is no session and no host debug state yet', () => {
    render(<Settings navigate={vi.fn()} />);

    expect(within(diagnostics()).getByRole('status')).toHaveTextContent('Idle');
    expect(within(diagnostics()).getByText(/0 of 1,000 events/)).toBeVisible();
  });

  it('keeps the debug settings', async () => {
    render(<Settings navigate={vi.fn()} />);
    const user = await open('Diagnostics');

    await user.click(screen.getByRole('switch', { name: 'Debug tracing' }));
    expect(lastChange()).toEqual({ key: 'debug.enabled', value: true });
    await user.click(screen.getByRole('switch', { name: 'Verbose HTTP tracing' }));
    expect(lastChange()).toEqual({ key: 'debug.verboseHttp', value: true });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Buffer size' }), '5000');
    expect(lastChange()).toEqual({ key: 'debug.bufferSize', value: 5000 });
  });

  it('keeps a valid non-preset buffer size representable', async () => {
    seed({ settings: { debug: { bufferSize: 250 } } });
    render(<Settings navigate={vi.fn()} />);
    await open('Diagnostics');

    const select = screen.getByRole('combobox', { name: 'Buffer size' });
    expect(select).toHaveValue('250');
    expect(within(select).getByRole('option', { name: /250/ })).toBeInTheDocument();
  });

  it('posts Start Session while idle', async () => {
    seed();
    render(<Settings navigate={vi.fn()} />);
    const user = await open('Diagnostics');

    await user.click(screen.getByRole('button', { name: 'Start Session' }));
    expect(posted('action:debug.startSession')).toHaveLength(1);
  });

  it('posts Stop & Export while a session is recording', async () => {
    seed({ debug: { enabled: true, sessionActive: true, eventCount: 3, bufferCapacity: 1000, verboseHttp: false } });
    render(<Settings navigate={vi.fn()} />);
    const user = await open('Diagnostics');

    expect(screen.queryByRole('button', { name: 'Start Session' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop & Export' }));
    expect(posted('action:debug.stopAndExport')).toHaveLength(1);
  });

  it('posts Export Full Log', async () => {
    render(<Settings navigate={vi.fn()} />);
    const user = await open('Diagnostics');

    await user.click(screen.getByRole('button', { name: 'Export Full Log' }));
    expect(posted('action:debug.export')).toHaveLength(1);
  });

  it('serialises debug actions, survives a remount and reports a failure', async () => {
    const view = render(<Settings navigate={vi.fn()} />);
    const user = await open('Diagnostics');

    await user.click(screen.getByRole('button', { name: 'Export Full Log' }));
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export Full Log' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Export Full Log' }));
    expect(posted('action:debug.export')).toHaveLength(1);

    view.unmount();
    render(<Settings navigate={vi.fn()} />);
    await open('Diagnostics');
    expect(screen.getByRole('button', { name: 'Export Full Log' })).toBeDisabled();

    settle(posted('action:debug.export')[0].id, { ok: false, error: 'Disk full' });
    expect(screen.getByRole('button', { name: 'Export Full Log' })).toBeEnabled();
  });

  it('keeps focus on the toggle button when a disclosure opens and closes', async () => {
    render(<Settings navigate={vi.fn()} />);
    const user = userEvent.setup();

    for (const name of ['Diagnostics', 'Advanced runtime']) {
      const toggle = screen.getByRole('button', { name });
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(document.activeElement).toBe(toggle);
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(toggle);
    }
  });
});

describe('Advanced runtime', () => {
  it('shows the current mode read-only, with the reload copy, and never writes useDaemon', async () => {
    render(<Settings navigate={vi.fn()} />);
    await open('Advanced runtime');

    const mode = within(advanced()).getByRole('group', { name: 'Current mode' });
    expect(within(mode).getByText('Shared local service')).toBeVisible();
    expect(within(advanced()).getByText(
      'Change this in VS Code Settings, then reload the window to switch transport modes.',
    )).toBeVisible();
    expect(vscodeApiMock.postMessage.mock.calls.some(([m]) => JSON.stringify(m).includes('useDaemon'))).toBe(false);
  });

  it('shows direct stdio mode when the daemon is not used', async () => {
    seed({ settings: { mcp: { useDaemon: false } } });
    render(<Settings navigate={vi.fn()} />);
    await open('Advanced runtime');

    const mode = within(advanced()).getByRole('group', { name: 'Current mode' });
    expect(within(mode).getByText('Direct stdio')).toBeVisible();
  });

  it('says the restart impact before every control that needs a restart', async () => {
    render(<Settings navigate={vi.fn()} />);
    await open('Advanced runtime');

    const note = screen.getByText('Takes effect after the local service restarts');
    for (const name of ['Server source', 'Daemon port', 'Browser idle park', 'HTTP client']) {
      const control = name === 'Daemon port'
        ? screen.getByRole('spinbutton', { name })
        : screen.getByRole('combobox', { name });
      expect(note.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING, name).toBeTruthy();
    }
  });

  it('keeps server source, HTTP client, auto-configure and update notices', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Advanced runtime' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Server source' }), 'npx');
    expect(lastChange()).toEqual({ key: 'mcp.serverSource', value: 'npx' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'HTTP client' }), 'impit');
    expect(lastChange()).toEqual({ key: 'mcp.httpClient', value: 'impit' });
    await user.click(within(advanced()).getByRole('switch', { name: 'Auto-configure on install' }));
    expect(lastChange()).toEqual({ key: 'mcp.autoConfigureOnInstall', value: false });
    await user.click(within(advanced()).getByRole('switch', { name: 'Notify on MCP updates' }));
    expect(lastChange()).toEqual({ key: 'mcp.notifyOnUpdates', value: false });
  });

  it('moves Auto-configure out of any other group', async () => {
    render(<Settings navigate={vi.fn()} />);
    await open('Advanced runtime');

    expect(screen.getAllByRole('switch', { name: 'Auto-configure on install' })).toHaveLength(1);
  });

  it('keeps a valid non-preset browser idle park value representable and posts presets', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { browserIdleParkMinutes: 45 } } });
    render(<Settings navigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Advanced runtime' }));

    const select = screen.getByRole('combobox', { name: 'Browser idle park' });
    expect(select).toHaveValue('45');
    await user.selectOptions(select, '0');
    expect(lastChange()).toEqual({ key: 'mcp.browserIdleParkMinutes', value: 0 });
  });

  describe('Daemon port', () => {
    async function openPort() {
      render(<Settings navigate={vi.fn()} />);
      const user = await open('Advanced runtime');
      const input = screen.getByRole('spinbutton', { name: 'Daemon port' });
      return { user, input };
    }

    it('is a labelled draft input that explains 0 and posts nothing per keystroke', async () => {
      const { user, input } = await openPort();

      expect(input).toHaveValue(8723);
      expect(input).toHaveAccessibleDescription(/0.*automatic port/i);
      await user.clear(input);
      await user.type(input, '9001');
      expect(posted('setting:change')).toHaveLength(0);
    });

    it('posts a valid port on Apply and on Enter', async () => {
      const { user, input } = await openPort();

      await user.clear(input);
      await user.type(input, '9001');
      await user.click(screen.getByRole('button', { name: 'Apply Daemon port' }));
      expect(lastChange()).toEqual({ key: 'mcp.daemonPort', value: 9001 });
      settle(posted('setting:change').at(-1)!.id, { ok: true });

      await user.clear(input);
      await user.type(input, '0{Enter}');
      expect(lastChange()).toEqual({ key: 'mcp.daemonPort', value: 0 });
    });

    it.each(['', '65536', '-1', '12.5'])('never posts the invalid draft %j and explains why', async draft => {
      const { user, input } = await openPort();

      await user.clear(input);
      if (draft) await user.type(input, draft);
      await user.type(input, '{Enter}');

      expect(posted('setting:change')).toHaveLength(0);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(/whole number from 0 to 65535/);
      expect(screen.getByRole('button', { name: 'Apply Daemon port' })).toBeDisabled();
    });

    it('keeps the typed draft when the host rejects the change', async () => {
      const { user, input } = await openPort();

      await user.clear(input);
      await user.type(input, '9001');
      await user.click(screen.getByRole('button', { name: 'Apply Daemon port' }));
      settle(posted('setting:change').at(-1)!.id, { ok: false, error: 'Port in use' });

      expect(await screen.findByRole('alert')).toHaveTextContent('Port in use');
      expect(input).toHaveValue(9001);
    });

    it('follows the saved value when the host reports a new one', async () => {
      const { input } = await openPort();

      act(() => seed({ settings: { mcp: { daemonPort: 9100 } } }));
      expect(input).toHaveValue(9100);
    });

    it('disables while its own change is in flight, and only itself', async () => {
      const { user, input } = await openPort();

      await user.clear(input);
      await user.type(input, '9001');
      await user.click(screen.getByRole('button', { name: 'Apply Daemon port' }));
      expect(input).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'HTTP client' })).toBeEnabled();
    });
  });
});

describe('Support and About', () => {
  it('shows both versions and four link actions', () => {
    render(<Settings navigate={vi.fn()} />);

    const about = screen.getByRole('region', { name: 'Support and About' });
    expect(within(about).getByText('2.1.32')).toBeVisible();
    expect(within(about).getByText('2.4.15')).toBeVisible();
    expect(within(about).getAllByRole('button')).toHaveLength(4);
  });

  it('reports a link that could not be opened', async () => {
    const user = userEvent.setup();
    render(<Settings navigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open documentation' }));
    settle(posted('action:openLink').at(-1)!.id, { ok: false, error: 'Blocked' });

    const about = screen.getByRole('region', { name: 'Support and About' });
    expect(await within(about).findByRole('alert')).toHaveTextContent('Blocked');
  });
});
