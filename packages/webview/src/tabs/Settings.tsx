import React from 'react';
import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';

function SettingToggle({ label, desc, value, settingKey }: { label: string; desc?: string; value: boolean; settingKey: string }) {
  const toggle = () => sendToExtension({ type: 'setting:change', key: settingKey, value: !value });
  return (
    <div className="toggle-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>{desc}</div>}
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={value} onChange={toggle} />
        <span className="toggle-track" />
      </label>
    </div>
  );
}

export function Settings() {
  const settings = useStore(s => s.settings);

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'formula.formatterVersion', value: e.target.value });
  };

  return (
    <div className="stack stack-lg">

      {/* MCP Server settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">MCP Server</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle label="Auto-configure on install" desc="Set up MCP in detected IDEs on first launch" value={settings.mcp.autoConfigureOnInstall} settingKey="mcp.autoConfigureOnInstall" />
          <SettingToggle label="Notify on MCP updates" value={settings.mcp.notifyOnUpdates} settingKey="mcp.notifyOnUpdates" />
        </div>
      </div>

      {/* AI Files settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">AI Files</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle label="Auto-install AI files" desc="Install skills, rules, workflows on first launch" value={settings.ai.autoInstallFiles} settingKey="ai.autoInstallFiles" />
          <SettingToggle label="Include agent files" desc="Install agent configs where supported" value={settings.ai.includeAgents} settingKey="ai.includeAgents" />
        </div>
      </div>

      {/* Formula Engine settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">Formula Engine</div>
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Formatter version</span>
          <select
            className="select-input"
            value={settings.formula.formatterVersion}
            onChange={handleVersionChange}
          >
            <option value="v2">v2 (default)</option>
            <option value="v1">v1 (legacy)</option>
          </select>
        </div>
      </div>

    </div>
  );
}
