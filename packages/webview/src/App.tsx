import React, { useEffect } from 'react';
import { parseExtensionMessage } from '@shared/webview-contract.js';
import type { DashboardTabId } from '@shared/types.js';
import { AppShell } from './components/AppShell.js';
import { Feedback } from './components/Feedback.js';
import { resolveHostConfirmation } from './lib/confirmation.js';
import { onExtensionMessage, sendToExtension } from './lib/vscode.js';
import { selectReadiness, type ReadinessReason } from './selectors/readiness.js';
import { useStore } from './store.js';
import { Overview } from './tabs/Overview.js';
import { Prompts } from './tabs/Prompts.js';
import { Settings } from './tabs/Settings.js';
import { Setup } from './tabs/Setup.js';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'setup' as const, label: 'Setup' },
  { id: 'prompts' as const, label: 'Prompts' },
  { id: 'settings' as const, label: 'Settings' },
];

// Header texts keyed on the typed reason, never on a display label. The header
// is a live region, so pending states say they are pending: every periodic
// session check passes through `session-checking`, and announcing "Sign in
// required" there would be a false claim to a signed-in user.
const HEADER_STATUS: Record<ReadinessReason, string> = {
  loading: 'Loading status',
  'browser-missing': 'Browser required',
  'session-checking': 'Checking session',
  'session-signing-in': 'Signing in',
  'session-unchecked': 'Sign in required',
  'session-invalid': 'Sign in required',
  'service-starting': 'Starting service',
  'service-stopped': 'Service needs attention',
  'service-unhealthy': 'Service needs attention',
  'no-clients': 'Client setup needed',
  repair: 'Needs repair',
  ready: 'Ready',
};

export function App() {
  const {
    activeTab,
    setTab,
    hydratePersistedState,
    applyState,
    applyIdeStatus,
    applyAuthState,
    markActionDone,
    guardPromptNavigation,
    loading,
    auth,
    settings,
    daemon,
    tunnel,
    ideStatuses,
  } = useStore();

  useEffect(() => {
    hydratePersistedState();
    const off = onExtensionMessage(input => {
      const parsed = parseExtensionMessage(input);
      if (!parsed.ok) {
        console.warn(
          '[airtable-formula] ignoring malformed extension message',
          { type: parsed.type, reason: parsed.reason },
        );
        return;
      }

      const message = parsed.value;
      if (message.type === 'state:update') {
        applyState(message.payload);
      } else if (message.type === 'ide:status') {
        applyIdeStatus(message.payload);
      } else if (message.type === 'auth:state') {
        applyAuthState(message.payload);
      } else if (message.type === 'action:result') {
        markActionDone(message.id, {
          ok: message.ok,
          error: message.error,
          cancelled: message.cancelled,
        });
      } else if (message.type === 'confirmation:result') {
        resolveHostConfirmation(message.id, message.confirmed);
      }
    });
    sendToExtension({ type: 'ready' });
    return off;
  }, []);

  const status = HEADER_STATUS[selectReadiness({
    loading,
    auth,
    settings,
    daemon,
    tunnel,
    ideStatuses,
  }).reason];

  // Every way out of a tab goes through guardPromptNavigation, so unsaved
  // Prompts edits are never discarded without the host confirmation.
  function requestTab(tab: DashboardTabId): boolean | Promise<boolean> {
    if (tab === activeTab) return true;
    return guardPromptNavigation(() => setTab(tab));
  }

  function navigate(tab: DashboardTabId, focusTargetId?: string): void {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const go = () => {
      setTab(tab);
      // Move focus to the requested heading, else the tab's own heading, else the
      // panel, so it never falls back to <body> when the clicked control unmounts.
      requestAnimationFrame(() => {
        const landing = (focusTargetId ? document.getElementById(focusTargetId) : null)
          ?? document.getElementById(`${tab}-heading`)
          ?? document.getElementById(`dashboard-panel-${tab}`);
        landing?.focus();
      });
    };
    if (tab === activeTab) {
      go();
      return;
    }
    void guardPromptNavigation(go).then(accepted => {
      // A refused navigation leaves focus on the control the user used.
      if (!accepted && origin?.isConnected) origin.focus();
    });
  }

  return (
    <AppShell
      tabs={TABS}
      activeTab={activeTab}
      onRequestSelect={requestTab}
      status={status}
      announceStatus={!loading}
    >
      {loading ? (
        <Feedback>Loading Airtable Control…</Feedback>
      ) : (
        <>
          {activeTab === 'overview' && <Overview navigate={navigate} />}
          {activeTab === 'setup' && <Setup />}
          {activeTab === 'prompts' && <Prompts />}
          {activeTab === 'settings' && <Settings navigate={navigate} />}
        </>
      )}
    </AppShell>
  );
}
