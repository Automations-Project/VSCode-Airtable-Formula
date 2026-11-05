import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import { AirtableLogo } from './AirtableLogo.js';
import { DashboardTabs } from './DashboardTabs.js';

interface AppShellProps {
  tabs: readonly { id: DashboardTabId; label: string }[];
  activeTab: DashboardTabId;
  onRequestSelect: (id: DashboardTabId) => boolean | Promise<boolean>;
  status: string;
  announceStatus?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  tabs,
  activeTab,
  onRequestSelect,
  status,
  announceStatus = true,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-identity">
          <AirtableLogo className="airtable-logo--header" />
          <span className="app-title">Airtable Control</span>
        </div>
        <span
          className="app-status"
          role={announceStatus ? 'status' : undefined}
          aria-live={announceStatus ? 'polite' : undefined}
        >
          {status}
        </span>
      </header>
      <DashboardTabs
        tabs={tabs}
        activeTab={activeTab}
        onRequestSelect={onRequestSelect}
      />
      {/* role="tabpanel" on <main> itself would replace the main landmark, so the panel sits inside it. */}
      <main className="app-panel-host">
        <div
          id={`dashboard-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`dashboard-tab-${activeTab}`}
          className="app-panel"
          tabIndex={-1}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
