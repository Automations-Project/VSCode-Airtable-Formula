import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import { AccountSection } from './settings/AccountSection.js';
import { AdvancedRuntimeSection } from './settings/AdvancedRuntimeSection.js';
import { BrowserSection } from './settings/BrowserSection.js';
import { DiagnosticsSection } from './settings/DiagnosticsSection.js';
import { FormulaScriptingSection } from './settings/FormulaScriptingSection.js';
import { StorageSection } from './settings/StorageSection.js';
import { SupportAboutSection } from './settings/SupportAboutSection.js';
import { ToolSafetySection } from './settings/ToolSafetySection.js';

interface SettingsProps {
  navigate: (tab: DashboardTabId, focusTargetId?: string) => void;
}

export function Settings({ navigate }: SettingsProps) {
  return (
    <section className="tab-stack" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="tab-heading" tabIndex={-1}>Settings</h1>
      <AccountSection />
      <BrowserSection />
      <ToolSafetySection />
      <FormulaScriptingSection />
      <StorageSection />
      <DiagnosticsSection />
      <AdvancedRuntimeSection navigate={navigate} />
      <SupportAboutSection />
    </section>
  );
}
