import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';
import { makeDashboardState } from './dashboard-state.fixture.js';

describe('App rendered shell', () => {
  let completedActionId: string;
  let pendingActionId: string;

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

  it('leaves completed and pending prompt actions for the rendered-test harness to clean up', () => {
    vi.useFakeTimers();
    render(<App />);

    completedActionId = useStore.getState().deletePrompt('leftover-result');
    useStore.getState().markActionDone(completedActionId, false);
    pendingActionId = useStore.getState().savePrompt({
      name: 'leftover-timer', description: '', arguments: [], template: '', isBuiltin: false, isModified: false,
    });
  });

  it('cannot observe action sidecars left by a prior rendered test', () => {
    render(<App />);
    vi.advanceTimersByTime(60_000);

    expect(useStore.getState().consumeActionResult(completedActionId)).toBeUndefined();
    expect(useStore.getState().consumeActionResult(pendingActionId)).toBeUndefined();
    expect(useStore.getState().pendingActions.has(pendingActionId)).toBe(false);
  });
});
