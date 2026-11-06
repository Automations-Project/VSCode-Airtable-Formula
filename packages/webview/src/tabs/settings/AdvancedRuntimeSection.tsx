import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Disclosure } from '../../components/Disclosure.js';
import { SettingNumberRow, SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { presetOptions } from '../../lib/presetOptions.js';
import { useStore } from '../../store.js';

const SERVER_SOURCES = [
  { value: 'bundled', label: 'bundled' },
  { value: 'npx', label: 'npx' },
] as const;

const HTTP_CLIENTS = [
  { value: 'fetch', label: 'Automatic (fetch)' },
  { value: 'impit', label: 'Chrome impersonation (impit)' },
] as const;

const IDLE_PARK_PRESETS = [
  { value: 0, label: 'Never (disabled)' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
];

const RESTART_NOTE = 'Takes effect after the local service restarts';

interface AdvancedRuntimeSectionProps {
  navigate: (tab: DashboardTabId, focusTargetId?: string) => void;
}

export function AdvancedRuntimeSection({ navigate }: AdvancedRuntimeSectionProps) {
  const mcp = useStore(s => s.settings.mcp);
  const mode = mcp.useDaemon ? 'Shared local service' : 'Direct stdio';

  return (
    <Disclosure id="advanced-runtime" title="Advanced runtime" summary={mode}>
      <div className="settings-group" role="group" aria-labelledby="runtime-mode-title">
        <h3 id="runtime-mode-title" className="settings-group__title">Current mode</h3>
        <p className="settings-status-line">{mode}</p>
        <p className="setting-row__description">
          Change this in VS Code Settings, then reload the window to switch transport modes.
        </p>
        <div className="settings-actions">
          <ActionButton onClick={() => navigate('setup', 'local-service-heading')}>
            Manage local service in Setup
          </ActionButton>
        </div>
      </div>

      <div className="settings-group" role="group" aria-labelledby="runtime-restart-title" aria-describedby="runtime-restart-note">
        <h3 id="runtime-restart-title" className="settings-group__title">Server and transport</h3>
        <p id="runtime-restart-note" className="setting-row__description">{RESTART_NOTE}</p>
        <SettingSelectRow
          label="Server source"
          description="bundled = extension built-in · npx = npm package (survives updates)"
          value={mcp.serverSource ?? 'bundled'}
          options={SERVER_SOURCES}
          change={value => ({ key: 'mcp.serverSource', value: value as 'bundled' | 'npx' })}
        />
        <SettingNumberRow
          label="Daemon port"
          description="Default 8723, kept fixed across restarts. 0 picks an automatic port."
          value={mcp.daemonPort ?? 8723}
          min={0}
          max={65535}
          change={value => ({ key: 'mcp.daemonPort', value })}
        />
        <SettingSelectRow
          label="Browser idle park"
          description="Idle time before the shared service closes its browser to free memory. The session keeps working and the browser reopens when needed."
          value={String(mcp.browserIdleParkMinutes)}
          options={presetOptions(IDLE_PARK_PRESETS, mcp.browserIdleParkMinutes, minutes => `${minutes} minutes`)}
          change={value => ({ key: 'mcp.browserIdleParkMinutes', value: Number(value) })}
        />
        <SettingSelectRow
          label="HTTP client"
          description="Transport for API calls. impit impersonates Chrome's TLS."
          value={mcp.httpClient ?? 'fetch'}
          options={HTTP_CLIENTS}
          change={value => ({ key: 'mcp.httpClient', value: value as 'fetch' | 'impit' })}
        />
      </div>

      <div className="settings-group" role="group" aria-labelledby="runtime-behaviour-title">
        <h3 id="runtime-behaviour-title" className="settings-group__title">Behaviour</h3>
        <SettingSwitchRow
          label="Auto-configure on install"
          description="Set up MCP in detected IDEs on first launch"
          checked={mcp.autoConfigureOnInstall}
          change={value => ({ key: 'mcp.autoConfigureOnInstall', value })}
        />
        <SettingSwitchRow
          label="Notify on MCP updates"
          checked={mcp.notifyOnUpdates}
          change={value => ({ key: 'mcp.notifyOnUpdates', value })}
        />
      </div>
    </Disclosure>
  );
}
