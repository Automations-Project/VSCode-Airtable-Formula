import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab: 'overview' });
}

function headerStatus(): string {
  return document.querySelector('.app-status')?.textContent ?? '';
}

describe('App header status', () => {
  const [cursor] = makeDashboardState().ideStatuses;

  it.each([
    ['loading', { loading: true }, 'Loading status'],
    ['checking the session', { auth: { status: 'checking' } }, 'Sign in required'],
    ['signing in', { auth: { status: 'logging-in' } }, 'Sign in required'],
    ['a missing browser', { auth: { status: 'chrome-missing' } }, 'Browser required'],
    ['an expired session', { auth: { status: 'expired' } }, 'Sign in required'],
    ['an unchecked session', { auth: { status: 'unknown' } }, 'Sign in required'],
    ['a stopped service', { daemon: undefined }, 'Service needs attention'],
    ['a starting service', { daemon: { running: false, healthy: false, starting: true, port: null } }, 'Service needs attention'],
    ['an unhealthy service', { daemon: { running: true, healthy: false } }, 'Service needs attention'],
    ['no clients', { ideStatuses: [] }, 'Client setup needed'],
    ['an unusable client', { ideStatuses: [{ ...cursor!, mcpConfigured: false }] }, 'Client setup needed'],
    ['a repairable client', { ideStatuses: [{ ...cursor!, aiFiles: { skills: 'partial', rules: 'ok', workflows: 'ok', agents: 'ok' } }] }, 'Needs repair'],
    ['a ready workbench', {}, 'Ready'],
  ] as [string, DashboardStateOverrides, string][])('announces the pinned text for %s', (_name, overrides, text) => {
    seed(overrides);
    render(<App />);

    expect(headerStatus()).toBe(text);
  });
});

describe('App cross-tab navigation focus', () => {
  beforeEach(() => {
    // Like the browser, run the frame callback after React has committed the click.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      setTimeout(() => callback(0), 0);
      return 0;
    });
  });

  afterEach(() => {
    document.getElementById('setup-heading')?.remove();
  });

  it('lands focus inside the destination tab when the target heading does not exist yet', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('setup'));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.getElementById('dashboard-panel-setup')).toContainElement(document.activeElement as HTMLElement);
  });

  it('focuses the panel when navigating without any target id', async () => {
    const user = userEvent.setup();
    seed();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Prompts/ }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('prompts'));
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveFocus());
  });

  it('prefers the destination tab heading over the panel when the target is missing', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    const heading = document.createElement('h1');
    heading.id = 'setup-heading';
    heading.tabIndex = -1;
    document.body.append(heading);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('never makes the panel a positive tab stop', () => {
    seed();
    render(<App />);

    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
  });
});
