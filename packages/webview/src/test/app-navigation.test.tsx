import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

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
    // Pending states read as pending: a signed-in user's periodic check must not say "Sign in required".
    ['checking the session', { auth: { status: 'checking' } }, 'Checking session'],
    ['signing in', { auth: { status: 'logging-in' } }, 'Signing in'],
    ['a missing browser', { auth: { status: 'chrome-missing' } }, 'Browser required'],
    ['an expired session', { auth: { status: 'expired' } }, 'Sign in required'],
    ['an unchecked session', { auth: { status: 'unknown' } }, 'Sign in required'],
    ['a stopped service', { daemon: undefined }, 'Service needs attention'],
    ['a starting service', { daemon: { running: false, healthy: false, starting: true, port: null } }, 'Starting service'],
    ['an unhealthy service', { daemon: { running: true, healthy: false } }, 'Service needs attention'],
    ['no clients', { ideStatuses: [] }, 'Client setup needed'],
    ['an unusable client', { ideStatuses: [{ ...cursor!, mcpConfigured: false }] }, 'Client setup needed'],
    ['a repairable client', { ideStatuses: [{ ...cursor!, aiFiles: { skills: 'partial', rules: 'ok', workflows: 'ok', agents: 'ok' } }] }, 'Needs repair'],
    ['an auto-disabled tunnel', { tunnel: { status: 'auto-disabled' } }, 'Ready'],
    ['a ready workbench', {}, 'Ready'],
  ] as [string, DashboardStateOverrides, string][])('announces the pinned text for %s', (_name, overrides, text) => {
    seed(overrides);
    render(<App />);

    expect(headerStatus()).toBe(text);
  });
});

// Simulates a destination whose target heading is not rendered (yet), whatever
// headings Setup currently owns.
function dropFocusTargetBeforeFocus(id: string): void {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    setTimeout(() => {
      document.getElementById(id)?.removeAttribute('id');
      callback(0);
    }, 0);
    return 0;
  });
}

describe('App cross-tab navigation focus', () => {
  beforeEach(() => {
    // Like the browser, run the frame callback after React has committed the click.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      setTimeout(() => callback(0), 0);
      return 0;
    });
  });

  it('focuses the Local service heading when Overview links to it', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(document.getElementById('local-service-heading')).toHaveFocus());
  });

  it('lands focus inside the destination tab when the target heading does not exist yet', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    dropFocusTargetBeforeFocus('local-service-heading');
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('setup'));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.getElementById('dashboard-panel-setup')).toContainElement(document.activeElement as HTMLElement);
  });

  it('focuses the destination tab heading when navigating without any target id', async () => {
    const user = userEvent.setup();
    seed();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Prompts/ }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('prompts'));
    await waitFor(() => expect(document.getElementById('prompts-heading')).toHaveFocus());
  });

  it('prefers the destination tab heading over the panel when the target is missing', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    dropFocusTargetBeforeFocus('local-service-heading');
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    await waitFor(() => expect(document.getElementById('setup-heading')).toHaveFocus());
  });

  it('never makes the panel a positive tab stop', () => {
    seed();
    render(<App />);

    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
  });
});

describe('App navigate() and the Prompts discard guard', () => {
  function answerConfirmation(confirmed: boolean): void {
    const request = vscodeApiMock.postMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.type === 'confirmation:request')
      .at(-1) as { id: string; kind: string };
    expect(request.kind).toBe('discard-prompt-edits');
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'confirmation:result', id: request.id, confirmed },
    }));
  }

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      setTimeout(() => callback(0), 0);
      return 0;
    });
  });

  it('asks the host before a cross-surface navigate() leaves unsaved prompt edits', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    useStore.setState({ promptEditorDirty: true });
    render(<App />);
    const link = screen.getByRole('button', { name: 'Open Setup: Local service stopped' });

    await user.click(link);

    expect(vscodeApiMock.postMessage.mock.calls.filter(([m]) => m.type === 'confirmation:request')).toHaveLength(1);
    expect(useStore.getState().activeTab).toBe('overview');

    answerConfirmation(false);

    await waitFor(() => expect(link).toHaveFocus());
    expect(useStore.getState().activeTab).toBe('overview');
    expect(useStore.getState().promptEditorDirty).toBe(true);

    await user.click(link);
    answerConfirmation(true);

    await waitFor(() => expect(useStore.getState().activeTab).toBe('setup'));
    await waitFor(() => expect(document.getElementById('local-service-heading')).toHaveFocus());
    expect(useStore.getState().promptEditorDirty).toBe(false);
  });

  it('navigates without asking when no prompt edit is unsaved', async () => {
    const user = userEvent.setup();
    seed({ daemon: undefined });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Setup: Local service stopped' }));

    expect(vscodeApiMock.postMessage.mock.calls.some(([m]) => m.type === 'confirmation:request')).toBe(false);
    await waitFor(() => expect(document.getElementById('local-service-heading')).toHaveFocus());
  });
});
