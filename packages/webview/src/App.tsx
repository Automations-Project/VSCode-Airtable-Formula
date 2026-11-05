import React, { useEffect } from 'react';
import { parseExtensionMessage } from '@shared/webview-contract.js';
import type { DashboardTabId } from '@shared/types.js';
import { AppShell } from './components/AppShell.js';
import { Feedback } from './components/Feedback.js';
import { resolveHostConfirmation } from './lib/confirmation.js';
import { onExtensionMessage, sendToExtension } from './lib/vscode.js';
import { selectReadiness, type ReadinessModel } from './selectors/readiness.js';
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

const BLOCKED_STATUS: Record<string, string> = {
  BROWSER: 'Browser required',
  'SIGN IN': 'Sign in required',
  SERVICE: 'Service needs attention',
  'SET UP': 'Client setup needed',
};

function getAggregateStatus(readiness: ReadinessModel): string {
  switch (readiness.state) {
    case 'loading': return 'Loading status';
    case 'ready': return 'Ready';
    case 'degraded': return 'Needs repair';
    default: return BLOCKED_STATUS[readiness.resultLabel] ?? 'Needs attention';
  }
}

export function App() {
  const {
    activeTab,
    setTab,
    hydratePersistedState,
    applyState,
    applyIdeStatus,
    applyAuthState,
    markActionDone,
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

  const status = getAggregateStatus(selectReadiness({
    loading,
    auth,
    settings,
    daemon,
    tunnel,
    ideStatuses,
  }));

  function requestTab(tab: DashboardTabId): boolean {
    setTab(tab);
    return true;
  }

  function navigate(tab: DashboardTabId, focusTargetId?: string): void {
    setTab(tab);
    if (!focusTargetId) return;
    requestAnimationFrame(() => {
      document.getElementById(focusTargetId)?.focus();
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
          {activeTab === 'settings' && <Settings />}
        </>
      )}
    </AppShell>
  );
}
