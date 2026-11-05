import React from 'react';
import { useStore } from '../store.js';
import type { WebviewSettingChange } from '@shared/messages.js';
import type { ToolCategories } from '@shared/types.js';
import { SettingSelectRow, SettingSwitchRow } from '../components/SettingRow.js';
import { useScopePending } from '../lib/useActionOutcome.js';
import { AccountSection } from './settings/AccountSection.js';
import { BrowserSection } from './settings/BrowserSection.js';
import { StorageSection } from './settings/StorageSection.js';
import { SupportAboutSection } from './settings/SupportAboutSection.js';
import { Sliders, FileJson } from 'lucide-react';

type BooleanSettingKey =
  | 'auth.autoRefresh'
  | 'mcp.autoConfigureOnInstall'
  | 'mcp.notifyOnUpdates'
  | 'ai.autoInstallFiles'
  | 'ai.includeAgents'
  | 'debug.enabled'
  | 'debug.verboseHttp';

function SettingToggle({
  label,
  desc,
  value,
  settingKey,
  category,
}: {
  label: string;
  desc?: string;
  value: boolean;
  settingKey?: BooleanSettingKey;
  category?: keyof ToolCategories;
}) {
  return (
    <SettingSwitchRow
      label={label}
      description={desc}
      checked={value}
      change={next => (category
        ? { key: 'mcp.category', category, value: next }
        : { key: settingKey!, value: next }) as WebviewSettingChange}
    />
  );
}

export function Settings() {
  const settings = useStore(s => s.settings);
  const debug = useStore(s => s.debug);
  const openToolConfig = useStore(s => s.openToolConfig);
  const changeSetting = useStore(s => s.changeSetting);

  const serverSourcePending = useScopePending('setting:mcp.serverSource');
  const toolProfilePending = useScopePending('setting:mcp.toolProfile');
  const debugStartSession = useStore(s => s.debugStartSession);
  const debugStopAndExport = useStore(s => s.debugStopAndExport);
  const debugExport = useStore(s => s.debugExport);

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    changeSetting({
      key: 'formula.formatterVersion',
      value: e.target.value as 'v1' | 'v2',
    });
  };

  return (
    <div className="stack stack-lg">
      <AccountSection />
      <BrowserSection />
      <StorageSection />

      {/* MCP Server settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">MCP Server</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle label="Auto-configure on install" desc="Set up MCP in detected IDEs on first launch" value={settings.mcp.autoConfigureOnInstall} settingKey="mcp.autoConfigureOnInstall" />
          <SettingToggle label="Notify on MCP updates" value={settings.mcp.notifyOnUpdates} settingKey="mcp.notifyOnUpdates" />
          <div className="toggle-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Server source</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>
                bundled = extension built-in · npx = npm package (survives updates)
              </div>
            </div>
            <select
              className="select-input"
              value={settings.mcp.serverSource ?? 'bundled'}
              disabled={serverSourcePending}
              onChange={e => changeSetting({
                key: 'mcp.serverSource',
                value: e.target.value as 'bundled' | 'npx',
              })}
            >
              <option value="bundled">bundled</option>
              <option value="npx">npx</option>
            </select>
          </div>
          <SettingSelectRow
            label="HTTP client"
            description="Transport for API calls. impit impersonates Chrome's TLS."
            value={settings.mcp.httpClient ?? 'fetch'}
            options={[
              { value: 'fetch', label: 'Automatic (fetch)' },
              { value: 'impit', label: 'Chrome impersonation (impit)' },
            ]}
            change={value => ({ key: 'mcp.httpClient', value: value as 'fetch' | 'impit' })}
          />
          <div className="toggle-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Daemon port</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>
                Default 8723 — stays fixed across restarts · set 0 for an automatic port · applies on daemon restart
              </div>
            </div>
            <input
              type="number"
              className="select-input"
              style={{ width: 80, textAlign: 'right' }}
              min={0}
              max={65535}
              value={settings.mcp.daemonPort ?? 8723}
              onChange={e => changeSetting({
                key: 'mcp.daemonPort',
                value: Number(e.target.value),
              })}
            />
          </div>
        </div>
      </div>

      {/* MCP Tool Access — merged from the legacy mcp-airtable-tool-manager extension */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">MCP Tool Access</div>
        </div>
        <div className="stack stack-sm">
          <div className="list-row">
            <Sliders size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', flex: 1 }}>
              Active profile
              <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                Controls which MCP tools are exposed to AI agents
              </span>
            </span>
            <select
              className="select-input"
              value={settings.mcp.toolProfile.profile}
              disabled={toolProfilePending}
              onChange={e => changeSetting({
                key: 'mcp.toolProfile',
                value: e.target.value as 'read-only' | 'safe-write' | 'full' | 'custom',
              })}
            >
              <option value="read-only">read-only</option>
              <option value="safe-write">safe-write</option>
              <option value="full">full</option>
              <option value="custom">custom</option>
            </select>
          </div>

          <div className="list-row">
            <span style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', flex: 1 }}>
              {settings.mcp.toolProfile.enabledCount} of {settings.mcp.toolProfile.totalCount} tools enabled
            </span>
            {settings.mcp.toolProfile.enabledCount < settings.mcp.toolProfile.totalCount && (
              <span className="chip chip-warn" title="Some tools are hidden from AI agents. Switch to 'full' or enable more categories below.">
                {settings.mcp.toolProfile.totalCount - settings.mcp.toolProfile.enabledCount} hidden
              </span>
            )}
            <span className={settings.mcp.toolProfile.enabledCount === 0 ? 'chip chip-warn' : 'chip chip-info'}>
              {settings.mcp.toolProfile.profile}
            </span>
          </div>

          {settings.mcp.toolProfile.profile === 'custom' && (
            <div className="stack stack-sm" style={{ paddingTop: 4, borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <SettingToggle label="Read / Inspect"       desc="Schema, fields, views, formula validation, sidebar sections, record templates (9 tools)" value={settings.mcp.toolProfile.categories.read}                    category="read" />
              <SettingToggle label="Record Read"          desc="query_records — snapshot read of up to 1000 rows per call (1 tool)"                            value={settings.mcp.toolProfile.categories.recordRead}             category="recordRead" />
              <SettingToggle label="Table Write"          desc="Tables + record templates: create / rename / update / set cells / duplicate / apply (9 tools)" value={settings.mcp.toolProfile.categories.tableWrite}             category="tableWrite" />
              <SettingToggle label="Table Destructive"    desc="delete_table, delete_record_template (2 tools)"                              value={settings.mcp.toolProfile.categories.tableDestructive}       category="tableDestructive" />
              <SettingToggle label="Field Write"          desc="Create / update / rename / duplicate fields (7 tools)"                        value={settings.mcp.toolProfile.categories.fieldWrite}             category="fieldWrite" />
              <SettingToggle label="Field Destructive"    desc="delete_field, delete_fields (2 tools)"                                        value={settings.mcp.toolProfile.categories.fieldDestructive}       category="fieldDestructive" />
              <SettingToggle label="View Write"           desc="Views, filters, sorts, columns, freezing, covers, calendar dates (19 tools)" value={settings.mcp.toolProfile.categories.viewWrite}              category="viewWrite" />
              <SettingToggle label="View Destructive"     desc="delete_view (1 tool)"                                                         value={settings.mcp.toolProfile.categories.viewDestructive}        category="viewDestructive" />
              <SettingToggle label="View Sections"        desc="Sidebar grouping: create / rename / move (3 tools)"                           value={settings.mcp.toolProfile.categories.viewSection}            category="viewSection" />
              <SettingToggle label="View Sections (destructive)" desc="delete_view_section (1 tool)"                                          value={settings.mcp.toolProfile.categories.viewSectionDestructive} category="viewSectionDestructive" />
              <SettingToggle label="Form Metadata"        desc="Edit legacy form views — public-facing (2 tools)"                             value={settings.mcp.toolProfile.categories.formWrite}              category="formWrite" />
              <SettingToggle label="Extension Management" desc="Create / install / duplicate / remove extensions (7 tools)"                   value={settings.mcp.toolProfile.categories.extension}              category="extension" />
              <SettingToggle label="Record Write"         desc="create_records, update_records, duplicate_records, upload_attachment — bulk record create / update / duplication / attachment upload (4 tools)" value={settings.mcp.toolProfile.categories.recordWrite}            category="recordWrite" />
              <SettingToggle label="Record Destructive"   desc="delete_records — batch record deletion (1 tool)"                              value={settings.mcp.toolProfile.categories.recordDestructive}      category="recordDestructive" />
              <SettingToggle label="Sync"                 desc="sync_base — plan/diff/status are read-only; apply mutates the destination and can delete under policy=mirror (1 tool)" value={settings.mcp.toolProfile.categories.sync}                   category="sync" />
              <SettingToggle label="Local File Write"     desc="download_formula_field, download_base_formulas — read formulas from Airtable and WRITE .formula files to a path the caller chooses. Not part of read-only (2 tools)" value={settings.mcp.toolProfile.categories.localWrite}             category="localWrite" />
              <SettingToggle label="Daemon Control"       desc="manage_daemon — status is read-only diagnostics; start / restart / stop / tunnel / token_rotate control the MCP server process itself (1 tool)" value={settings.mcp.toolProfile.categories.daemon}                 category="daemon" />
            </div>
          )}

          <button type="button" className="action-card" onClick={openToolConfig}>
            <div className="icon-badge icon-badge-blue" style={{ width: 22, height: 22 }}>
              <FileJson size={11} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>Open tool-config.json</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                Raw config at ~/.airtable-user-mcp/tools-config.json
              </div>
            </div>
          </button>
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

      {/* Script & Automation formatter */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Configuration</div>
          <div className="title">Script &amp; Automation</div>
        </div>
        <div className="stack stack-sm">
          <div className="toggle-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Beautify style</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>Prettier preset for Shift+Alt+F and beautify commands</div>
            </div>
            <select
              className="select-input"
              value={settings.script.beautifyStyle}
              onChange={e => changeSetting({
                key: 'script.beautifyStyle',
                value: e.target.value as 'default' | 'compact' | 'singleQuote' | 'tabIndent' | 'semicolonFree',
              })}
            >
              <option value="default">Default</option>
              <option value="compact">Compact (printWidth: 120)</option>
              <option value="singleQuote">Single Quote</option>
              <option value="tabIndent">Tab Indent</option>
              <option value="semicolonFree">Semicolon-free</option>
            </select>
          </div>
          <div className="toggle-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Minify level</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>Terser aggressiveness for minify commands</div>
            </div>
            <select
              className="select-input"
              value={settings.script.minifyLevel}
              onChange={e => changeSetting({
                key: 'script.minifyLevel',
                value: e.target.value as 'safe' | 'standard' | 'aggressive' | 'extreme',
              })}
            >
              <option value="safe">Safe (whitespace only)</option>
              <option value="standard">Standard (compress)</option>
              <option value="aggressive">Aggressive (compress + mangle)</option>
              <option value="extreme">Extreme (passes: 2)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Debug & Diagnostics */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Diagnostics</div>
          <div className="title">Debug Tracing</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle
            label="Debug tracing"
            desc="Collect extension & MCP events in a memory ring buffer"
            value={settings.debug?.enabled ?? true}
            settingKey="debug.enabled"
          />
          <SettingToggle
            label="Verbose HTTP tracing"
            desc="Include HTTP request/response events from MCP (high volume)"
            value={settings.debug?.verboseHttp ?? false}
            settingKey="debug.verboseHttp"
          />

          {/* Session status */}
          <div className="list-row">
            <span style={{ fontSize: '0.72rem', fontWeight: 600, flex: 1 }}>Session</span>
            <span className={debug?.sessionActive ? 'chip chip-warn' : 'chip chip-muted'} style={{ fontSize: '0.62rem' }}>
              {debug?.sessionActive ? '● Recording' : 'Idle'}
            </span>
          </div>

          {/* Event count */}
          <div className="list-row">
            <span style={{ fontSize: '0.72rem', flex: 1 }}>Events captured</span>
            <span className="chip chip-info" style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}>
              {debug?.eventCount ?? 0} / {debug?.bufferCapacity ?? 1000}
            </span>
          </div>

          {/* Buffer size */}
          <div className="toggle-row">
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Buffer size</span>
            <select
              className="select-input"
              value={settings.debug?.bufferSize ?? 1000}
              onChange={e => changeSetting({
                key: 'debug.bufferSize',
                value: Number(e.target.value),
              })}
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
              <option value={10000}>10,000</option>
            </select>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
            {!debug?.sessionActive ? (
              <button className="btn btn-primary btn-sm" onClick={debugStartSession} style={{ flex: 1 }}>
                ▶ Start Session
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={debugStopAndExport} style={{ flex: 1, background: 'var(--at-pink)' }}>
                ■ Stop &amp; Export
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={debugExport} style={{ flex: 1 }}>
              Export Full Log
            </button>
          </div>
        </div>
      </div>

      <SupportAboutSection />
    </div>
  );
}
