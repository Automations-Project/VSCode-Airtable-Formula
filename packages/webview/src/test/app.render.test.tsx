import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { requestHostConfirmation } from '../lib/confirmation.js';
import { useStore } from '../store.js';
import { makeDashboardState } from './dashboard-state.fixture.js';
import { resetWebviewStore, vscodeApiMock } from './test-setup.js';

describe('App rendered shell', () => {
  beforeEach(() => {
    useStore.setState({ loading: true, activeTab: 'overview' });
  });

  it('renders the real loading state in a DOM', () => {
    render(<App />);

    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
  });

  it('can mutate the singleton store during a rendered test', () => {
    useStore.setState(state => ({
      settings: { ...state.settings, mcp: { ...state.settings.mcp, daemonPort: 9999 } },
      auth: { ...state.auth, status: 'error' },
    }));

    expect(useStore.getState().settings.mcp.daemonPort).toBe(9999);
  });

  it('starts each rendered test from the full initial store state', () => {
    expect(useStore.getState().settings.mcp.daemonPort).toBe(8723);
    expect(useStore.getState().auth.status).toBe('unknown');
  });

  it('supports explicitly absent daemon and tunnel fixture states', () => {
    const state = makeDashboardState({ daemon: undefined, tunnel: undefined });

    expect(state.daemon).toBeUndefined();
    expect(state.tunnel).toBeUndefined();
  });

  it('ignores a malformed extension state update', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<App />);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'state:update', payload: { ideStatuses: 'not-an-array' } },
    }));

    expect(useStore.getState().loading).toBe(true);
  });

  it('keeps host action error text for local feedback', () => {
    const id = '0123456789abcdef01234567';
    useStore.setState({
      pendingActions: new Set([id]),
    });
    render(<App />);

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'action:result',
        id,
        ok: false,
        error: 'Could not save settings',
      },
    }));

    expect(useStore.getState().consumeActionResult(id)).toEqual({
      ok: false,
      error: 'Could not save settings',
    });
  });

  it('keeps host action cancellation for local feedback', () => {
    const id = '123456789abcdef012345678';
    useStore.setState({ pendingActions: new Set([id]) });
    render(<App />);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'action:result', id, ok: false, cancelled: true },
    }));

    expect(useStore.getState().consumeActionResult(id)).toEqual({
      ok: false,
      cancelled: true,
    });
  });

  it('restores the persisted active tab when App mounts', async () => {
    vscodeApiMock.getState.mockReturnValue({ activeTab: 'prompts' });
    useStore.setState({ activeTab: 'overview', loading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Prompts' }))
        .toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Prompts');
  });

  it.each([
    ['an array', ['prompts']],
    ['a coercible object', { toString: () => 'prompts' }],
    ['a number', 42],
  ])('ignores persisted activeTab when it is %s', async (_label, activeTab) => {
    vscodeApiMock.getState.mockReturnValue({ activeTab });
    useStore.setState({ activeTab: 'overview', loading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Overview' }))
        .toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
  });

  it('routes a parsed host confirmation reply to the pending request', async () => {
    render(<App />);
    const confirmation = requestHostConfirmation('discard-prompt-edits');
    const request = vscodeApiMock.postMessage.mock.calls.find(
      ([message]) => message.type === 'confirmation:request',
    )?.[0] as { id: string };

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'confirmation:result', id: request.id, confirmed: true },
    }));

    await expect(confirmation).resolves.toBe(true);
  });

  it('opens footer links by opaque id with a pending action lifecycle', () => {
    useStore.setState({ loading: false });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub (external link)' }));

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({
      type: 'action:openLink',
      link: 'github',
    });
    expect(message.id).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(message)).not.toContain('https://');
    expect(useStore.getState().pendingActions.has(message.id)).toBe(true);
  });

  it('routes a Settings toggle through a tracked setting change', () => {
    useStore.setState({ activeTab: 'settings', loading: false });
    render(<App />);

    fireEvent.click(screen.getByRole('switch', { name: 'Auto-configure on install' }));

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({
      type: 'setting:change',
      change: { key: 'mcp.autoConfigureOnInstall', value: false },
    });
    expect(message.id).toMatch(/^[0-9a-f]{24}$/);
    expect(useStore.getState().pendingActions.has(message.id)).toBe(true);
  });

  it('sends a custom tool category using the strict category DTO', () => {
    useStore.setState(state => ({
      activeTab: 'settings',
      loading: false,
      settings: {
        ...state.settings,
        mcp: {
          ...state.settings.mcp,
          toolProfile: { ...state.settings.mcp.toolProfile, profile: 'custom' },
        },
      },
    }));
    render(<App />);

    fireEvent.click(screen.getByRole('switch', { name: 'Read / Inspect' }));

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({
      type: 'setting:change',
      change: { key: 'mcp.category', category: 'read', value: false },
    });
  });

  it('selects a detected browser by opaque browser id', () => {
    useStore.setState(state => ({
      activeTab: 'settings',
      loading: false,
      auth: {
        ...state.auth,
        availableBrowsers: [{
          found: true,
          id: 'chrome',
          channel: 'chrome',
          label: 'Chrome',
        }],
      },
    }));
    render(<App />);
    const browserSelect = screen.getAllByRole('combobox').find(
      select => within(select).queryByRole('option', { name: 'Chrome' }),
    );

    fireEvent.change(browserSelect!, { target: { value: 'chrome' } });

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({
      type: 'action:setBrowserChoice',
      choice: { mode: 'detected', browserId: 'chrome' },
    });
    expect(JSON.stringify(message)).not.toContain('executable');
  });

  it('opens a storage entry by opaque entry id', () => {
    useStore.setState({
      activeTab: 'settings',
      loading: false,
      storage: {
        entries: [{
          id: 'tool-config',
          label: 'Tool config',
          exists: true,
          sizeBytes: 12,
        }],
      },
    });
    render(<App />);

    fireEvent.click(screen.getByText('Storage & Data'));
    fireEvent.click(screen.getByRole('button', { name: 'Open ↗' }));

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({
      type: 'action:openStoragePath',
      entryId: 'tool-config',
    });
    expect(message).not.toHaveProperty('path');
  });

  it('opens tool config with a generated tracked action id', () => {
    useStore.setState({ activeTab: 'settings', loading: false });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Open tool-config\.json/ }));

    const message = vscodeApiMock.postMessage.mock.calls.at(-1)?.[0];
    expect(message).toMatchObject({ type: 'action:openToolConfig' });
    expect(message.id).toMatch(/^[0-9a-f]{24}$/);
    expect(useStore.getState().pendingActions.has(message.id)).toBe(true);
  });

  it('logs only parser metadata for malformed host input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<App />);

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'auth:state',
        payload: { status: 'valid', cookie: 'secret-session-value' },
      },
    }));

    expect(warn).toHaveBeenCalledWith(
      '[airtable-formula] ignoring malformed extension message',
      { type: 'auth:state', reason: 'auth state payload is invalid' },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-session-value');
  });

  it('keeps prompt edits and shows bounded host feedback after a failed save', async () => {
    useStore.setState({
      activeTab: 'prompts',
      loading: false,
      prompts: {
        prompts: [{
          name: 'my-prompt',
          description: 'Original description',
          arguments: [],
          template: 'Original template',
          isBuiltin: false,
          isModified: false,
        }],
      },
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /\/my-prompt/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt description' }), {
      target: { value: 'Unsaved local description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = vscodeApiMock.postMessage.mock.calls.find(
      ([message]) => message.type === 'action:save-prompt',
    )?.[0] as { id: string };

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'action:result',
        id: request.id,
        ok: false,
        error: `Could not save settings${'x'.repeat(500)}`,
      },
    }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^Could not save settings/);
    expect(alert.textContent).toHaveLength(300);
    expect(screen.getByRole('textbox', { name: 'Prompt description' }))
      .toHaveValue('Unsaved local description');
    expect(screen.getByRole('button', { name: 'Back to prompts' })).toBeInTheDocument();
  });

  it('keeps prompt edits after a cancelled save', async () => {
    useStore.setState({ activeTab: 'prompts', loading: false });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt name' }), {
      target: { value: 'new-prompt' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt template' }), {
      target: { value: 'Unsaved template' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = vscodeApiMock.postMessage.mock.calls.find(
      ([message]) => message.type === 'action:save-prompt',
    )?.[0] as { id: string };

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'action:result',
        id: request.id,
        ok: false,
        cancelled: true,
      },
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The action was cancelled.');
    expect(screen.getByRole('textbox', { name: 'Prompt template' }))
      .toHaveValue('Unsaved template');
  });

  it('reset clears real pending and completed action sidecars', async () => {
    vi.useFakeTimers();
    render(<App />);

    const completedActionId = useStore.getState().deletePrompt('completed-result');
    useStore.getState().markActionDone(completedActionId, { ok: false });
    expect(useStore.getState().consumeActionResult(completedActionId)).toEqual({ ok: false });
    useStore.getState().markActionDone(completedActionId, { ok: false });

    const pendingActionId = useStore.getState().savePrompt({
      name: 'leftover-timer', description: '', arguments: [], template: '', isBuiltin: false, isModified: false,
    });
    expect(useStore.getState().pendingActions.has(pendingActionId)).toBe(true);

    await resetWebviewStore();
    vi.advanceTimersByTime(60_000);

    expect(useStore.getState().consumeActionResult(completedActionId)).toBeUndefined();
    expect(useStore.getState().consumeActionResult(pendingActionId)).toBeUndefined();
    expect(useStore.getState().pendingActions.has(pendingActionId)).toBe(false);
  });
});
