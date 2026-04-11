import React, { useState } from 'react';
import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';
import { StatusDot } from '../components/StatusDot.js';
import { LogIn, LogOut, RefreshCw, Shield, Key, Clock, Globe, AlertTriangle, Download, Trash2, Sliders, FileJson } from 'lucide-react';

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

function AuthStatusLabel({ status }: { status: string }) {
  const labels: Record<string, { text: string; variant: 'ok' | 'warn' | 'off' | 'err' | 'info' }> = {
    unknown:          { text: 'Not checked',  variant: 'off'  },
    checking:         { text: 'Checking...',   variant: 'info' },
    valid:            { text: 'Active',        variant: 'ok'   },
    expired:          { text: 'Expired',       variant: 'warn' },
    error:            { text: 'Error',         variant: 'warn' },
    'logging-in':     { text: 'Logging in...', variant: 'info' },
    'chrome-missing': { text: 'Browser missing', variant: 'err' },
  };
  const l = labels[status] || labels.unknown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <StatusDot variant={l.variant} />
      <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>{l.text}</span>
    </span>
  );
}

export function Settings() {
  const settings = useStore(s => s.settings);
  const auth = useStore(s => s.auth);
  const { saveCredentials, login, logout, checkSession, downloadBrowser, removeBrowser } = useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [showCreds, setShowCreds] = useState(false);

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'formula.formatterVersion', value: e.target.value });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'auth.refreshIntervalHours', value: Number(e.target.value) });
  };

  const handleSaveCredentials = () => {
    if (!email || !password) return;
    saveCredentials(email, password, otpSecret);
    setPassword('');
    setOtpSecret('');
    setShowCreds(false);
  };

  const isBusy = auth.status === 'checking' || auth.status === 'logging-in';
  const browserFound = auth.browser?.found ?? true; // optimistic until probe runs
  const browserLabel = auth.browser?.label;
  const browserIsDownloaded = auth.browser?.downloaded === true;
  const chromeMissing = auth.browser && auth.browser.found === false;
  const dl = auth.browserDownload;
  const downloading = dl?.status === 'downloading';
  const downloadDone = dl?.status === 'done';
  const downloadError = dl?.status === 'error';

  return (
    <div className="stack stack-lg">

      {/* Airtable Account */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Authentication</div>
          <div className="title">Airtable Account</div>
        </div>
        <div className="stack stack-sm">
          <div className="list-row">
            <Shield size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', flex: 1 }}>Credentials stored in OS keychain</span>
            <span className={auth.hasCredentials ? 'chip chip-ok' : 'chip chip-warn'}>
              {auth.hasCredentials ? 'Saved' : 'Not set'}
            </span>
          </div>

          <div className="list-row">
            <Globe size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', flex: 1 }}>
              Browser for headless auth
              <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                Uses Google Chrome, Edge, or Chromium. Falls back to a bundled Chromium you can download below.
              </span>
            </span>
            <span className={browserFound ? 'chip chip-ok' : 'chip chip-warn'}>
              {browserFound ? (browserLabel || 'Detected') : 'Missing'}
            </span>
          </div>

          {browserIsDownloaded && !downloading && (
            <div className="list-row">
              <Download size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.72rem', flex: 1 }}>
                Bundled Chromium installed
                <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                  Stored in extension global storage (~170 MB)
                </span>
              </span>
              <button
                className="btn btn-ghost"
                onClick={removeBrowser}
                style={{ fontSize: '0.68rem', padding: '4px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                title="Remove the downloaded Chromium"
              >
                <Trash2 size={11} /> Remove
              </button>
            </div>
          )}

          {chromeMissing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'rgba(220,4,59,0.08)', border: '1px solid rgba(220,4,59,0.22)', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <AlertTriangle size={14} style={{ color: 'var(--at-red)', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: '0.66rem', lineHeight: 1.4, color: 'var(--fg)' }}>
                  No Chromium-based browser found. The headless auth flow needs a real browser to drive Airtable's login page.
                  {' '}
                  <a
                    href="https://www.google.com/chrome/"
                    style={{ color: 'var(--fg-info)', textDecoration: 'underline' }}
                  >
                    Install Google Chrome
                  </a>
                  {' '}or download a bundled Chromium (~170 MB) below.
                </div>
              </div>

              {!downloading && !downloadDone && (
                <button
                  className="btn btn-primary"
                  onClick={downloadBrowser}
                  style={{ fontSize: '0.72rem', padding: '6px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                >
                  <Download size={12} /> Download bundled Chromium
                </button>
              )}

              {downloading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Downloading Chromium...</span>
                    <span>{dl?.progress ?? 0}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${dl?.progress ?? 0}%`,
                        height: '100%',
                        background: 'var(--at-blue)',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              )}

              {downloadError && (
                <div style={{ fontSize: '0.62rem', color: 'var(--fg-warn)' }}>
                  Download failed: {dl?.error}
                </div>
              )}
            </div>
          )}

          {!showCreds && (
            <div className="action-card" onClick={() => setShowCreds(true)} style={{ cursor: 'pointer' }}>
              <div className="icon-badge icon-badge-blue">
                <Key size={13} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                  {auth.hasCredentials ? 'Update credentials' : 'Set credentials'}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                  Email, password, and optional TOTP secret
                </div>
              </div>
            </div>
          )}

          {showCreds && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
              <input
                className="input-field"
                type="email"
                placeholder="Airtable email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--fg)' }}
              />
              <input
                className="input-field"
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--fg)' }}
              />
              <input
                className="input-field"
                type="password"
                placeholder="TOTP secret (optional)"
                value={otpSecret}
                onChange={e => setOtpSecret(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--fg)' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveCredentials}
                  disabled={!email || !password}
                  style={{ flex: 1, fontSize: '0.72rem', padding: '5px 12px', borderRadius: 8, cursor: email && password ? 'pointer' : 'not-allowed', opacity: email && password ? 1 : 0.5 }}
                >
                  Save to Keychain
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowCreds(false)}
                  style={{ fontSize: '0.72rem', padding: '5px 12px', borderRadius: 8, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Session Management */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Authentication</div>
          <div className="title">Session</div>
        </div>
        <div className="stack stack-sm">
          <div className="list-row">
            <AuthStatusLabel status={auth.status} />
            <div style={{ flex: 1 }} />
            {auth.userId && (
              <span className="chip chip-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>
                {auth.userId}
              </span>
            )}
          </div>

          {auth.error && (
            <div style={{ fontSize: '0.65rem', color: 'var(--fg-warn)', padding: '4px 8px', background: 'rgba(255,180,0,0.08)', borderRadius: 6 }}>
              {auth.error}
            </div>
          )}

          {(auth.lastChecked || auth.lastLogin) && (
            <div style={{ display: 'flex', gap: 12, fontSize: '0.62rem', color: 'var(--fg-muted)' }}>
              {auth.lastChecked && <span>Checked: {new Date(auth.lastChecked).toLocaleTimeString()}</span>}
              {auth.lastLogin && <span>Login: {new Date(auth.lastLogin).toLocaleTimeString()}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div className="action-card" onClick={isBusy ? undefined : login} style={{ flex: 1, minWidth: 100, cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-green" style={{ width: 22, height: 22 }}>
                <LogIn size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Login</span>
            </div>
            <div className="action-card" onClick={isBusy ? undefined : checkSession} style={{ flex: 1, minWidth: 100, cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-blue" style={{ width: 22, height: 22 }}>
                <RefreshCw size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Check</span>
            </div>
            <div className="action-card" onClick={isBusy ? undefined : logout} style={{ flex: 1, minWidth: 100, cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-pink" style={{ width: 22, height: 22 }}>
                <LogOut size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Logout</span>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-Refresh settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Authentication</div>
          <div className="title">Auto-Refresh</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle label="Auto-refresh session" desc="Periodically check and re-login when session expires" value={settings.auth.autoRefresh} settingKey="auth.autoRefresh" />
          {settings.auth.autoRefresh && (
            <div className="toggle-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={13} style={{ color: 'var(--fg-muted)' }} />
                <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Check interval</span>
              </div>
              <select
                className="select-input"
                value={settings.auth.refreshIntervalHours}
                onChange={handleIntervalChange}
              >
                <option value={1}>1 hour</option>
                <option value={4}>4 hours</option>
                <option value={8}>8 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={168}>1 week</option>
              </select>
            </div>
          )}
        </div>
      </div>

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
              onChange={e => sendToExtension({ type: 'setting:change', key: 'mcp.toolProfile', value: e.target.value })}
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
              <SettingToggle label="Read / Inspect"       desc="Schema, fields, views, formula validation (6 tools)"          value={settings.mcp.toolProfile.categories.read}             settingKey="mcp.categories.read" />
              <SettingToggle label="Field Write"          desc="Create / update / rename / duplicate fields (7 tools)"        value={settings.mcp.toolProfile.categories.fieldWrite}       settingKey="mcp.categories.fieldWrite" />
              <SettingToggle label="Field Destructive"    desc="delete_field (1 tool)"                                         value={settings.mcp.toolProfile.categories.fieldDestructive} settingKey="mcp.categories.fieldDestructive" />
              <SettingToggle label="View Write"           desc="Create / update views, filters, sorts, columns (10 tools)"    value={settings.mcp.toolProfile.categories.viewWrite}        settingKey="mcp.categories.viewWrite" />
              <SettingToggle label="View Destructive"     desc="delete_view (1 tool)"                                          value={settings.mcp.toolProfile.categories.viewDestructive}  settingKey="mcp.categories.viewDestructive" />
              <SettingToggle label="Extension Management" desc="Create / install / duplicate / remove extensions (7 tools)"   value={settings.mcp.toolProfile.categories.extension}        settingKey="mcp.categories.extension" />
            </div>
          )}

          <div className="action-card" onClick={() => sendToExtension({ type: 'action:openToolConfig', id: 'open-tool-config' })} style={{ cursor: 'pointer' }}>
            <div className="icon-badge icon-badge-blue" style={{ width: 22, height: 22 }}>
              <FileJson size={11} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>Open tool-config.json</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                Raw config at ~/.airtable-user-mcp/tools-config.json
              </div>
            </div>
          </div>
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
