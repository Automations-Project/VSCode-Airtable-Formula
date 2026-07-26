import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';
import { makeDashboardState } from './dashboard-state.fixture.js';
import { resetWebviewStore } from './test-setup.js';

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

  it('reset clears real pending and completed action sidecars', async () => {
    vi.useFakeTimers();
    render(<App />);

    const completedActionId = useStore.getState().deletePrompt('completed-result');
    useStore.getState().markActionDone(completedActionId, false);
    expect(useStore.getState().consumeActionResult(completedActionId)).toBe(false);
    useStore.getState().markActionDone(completedActionId, false);

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
