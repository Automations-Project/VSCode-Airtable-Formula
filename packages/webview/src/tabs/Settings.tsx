import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';
import { friendlyError } from '../lib/friendlyError.js';
import { StatusDot } from '../components/StatusDot.js';
import { LogIn, LogOut, RefreshCw, Shield, Key, Clock, Globe, AlertTriangle, Download, Trash2, Sliders, FileJson, FolderOpen, ChevronDown, ChevronRight, Archive, Upload } from 'lucide-react';

function SettingToggle({ label, desc, value, settingKey }: { label: string; desc?: string; value: boolean; settingKey: string }) {
  const toggle = () => sendToExtension({ type: 'setting:change', key: settingKey, value: !value });
  return (
    <div className="toggle-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>{desc}</div>}
      </div>
      <label className="toggle-switch" aria-label={`${label} toggle`}>
        <input
          type="checkbox"
          checked={value}
          onChange={toggle}
          aria-label={label}
          role="switch"
          aria-checked={value}
        />
        <span className="toggle-track" aria-hidden="true" />
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function Settings() {
  const settings = useStore(s => s.settings);
  const auth = useStore(s => s.auth);
  const debug = useStore(s => s.debug);
  const { saveCredentials, login, logout, status, installBrowser, removeBrowser, manualLogin, openStoragePath, backupSession, restoreSession, selectCustomBrowser, setBrowserChoice } = useStore();

  const [settingsPending, setSettingsPending] = useState(false);

  // Clear pending indicator when a fresh state arrives from the extension
  useEffect(() => { setSettingsPending(false); }, [settings]);

  const changeHeavySetting = useCallback((key: string, value: unknown) => {
    setSettingsPending(true);
    sendToExtension({ type: 'setting:change', key, value });
  }, []);
  const availableBrowsers = auth.availableBrowsers ?? [];
  const browserChoice = settings.auth.browserChoice;
  const debugStartSession = useStore(s => s.debugStartSession);
  const debugStopAndExport = useStore(s => s.debugStopAndExport);
  const debugExport = useStore(s => s.debugExport);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [showCreds, setShowCreds] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const storage = useStore(s => s.storage);

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'formula.formatterVersion', value: e.target.value });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'auth.refreshIntervalHours', value: Number(e.target.value) });
  };

  const resetCredsForm = () => {
    setEmail('');
    setPassword('');
    setOtpSecret('');
  };

  const handleSaveCredentials = () => {
    if (!email || !password) return;
    saveCredentials(email, password, otpSecret);
    resetCredsForm();
    setShowCreds(false);
  };

  const loginMode = settings.auth.loginMode ?? 'manual';
  const isManual = loginMode === 'manual';

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
    <div className="stack stack-lg" style={{ position: 'relative' }}>
      {settingsPending && <div className="settings-pending-bar" />}

      {/* Airtable Account */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Authentication</div>
          <div className="title">Airtable Account</div>
        </div>
        <div className="stack stack-sm">
          <div className="toggle-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Login mode</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>
                {isManual ? 'You log in through the browser — no credentials stored' : 'Automated login with stored credentials'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
              <span style={{ color: isManual ? 'var(--fg)' : 'var(--fg-muted)', fontWeight: isManual ? 600 : 400 }}>Manual</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={!isManual}
                  aria-label={isManual ? 'Switch to automatic login with stored credentials' : 'Switch to manual login in the browser'}
                  checked={!isManual}
                  onChange={() => sendToExtension({ type: 'setting:change', key: 'auth.loginMode', value: isManual ? 'auto' : 'manual' })}
                />
                <span className="toggle-track" />
              </label>
              <span style={{ color: !isManual ? 'var(--fg)' : 'var(--fg-muted)', fontWeight: !isManual ? 600 : 400 }}>Auto</span>
            </div>
          </div>

          {!isManual && (
            <div className="list-row">
              <Shield size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.72rem', flex: 1 }}>Credentials stored in OS keychain</span>
              <span className={auth.hasCredentials ? 'chip chip-ok' : 'chip chip-warn'}>
                {auth.hasCredentials ? 'Saved' : 'Not set'}
              </span>
            </div>
          )}

          <div className="list-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Globe size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', flex: 1 }}>
              Browser for authentication
              <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                {availableBrowsers.length > 0
                  ? `Detected: ${availableBrowsers.map(b => b.label).filter(Boolean).join(', ')}`
                  : 'No browsers detected'}
              </span>
            </span>
            <select
              className="select-input"
              value={
                browserChoice?.mode === 'auto' && !browserChoice.executablePath
                  ? 'auto'
                  : browserChoice?.executablePath ?? 'auto'
              }
              onChange={e => {
                const val = e.target.value;
                if (val === 'custom') {
                  selectCustomBrowser();
                } else if (val === 'auto') {
                  setBrowserChoice({ mode: 'auto' });
                } else {
                  const browser = availableBrowsers.find(b => b.executablePath === val);
                  if (browser) {
                    setBrowserChoice({
                      mode: 'auto',
                      channel: browser.channel,
                      executablePath: browser.executablePath,
                      label: browser.label,
                    });
                  }
                }
              }}
            >
              <option value="auto">Auto (pick best available)</option>
              {availableBrowsers.map(b => (
                <option key={b.executablePath} value={b.executablePath}>
                  {b.label}{b.downloaded ? ' (bundled)' : ''}
                </option>
              ))}
              <option disabled>──────</option>
              <option value="custom">Custom path...</option>
            </select>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'var(--bg-error)', border: '1px solid var(--border-error)', borderRadius: 8 }}>
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
                  onClick={installBrowser}
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

              {downloadError && (() => {
                const fe = friendlyError(dl?.error);
                return (
                  <div style={{ fontSize: '0.62rem', color: 'var(--fg-warn)' }} title={fe?.raw}>
                    Download failed: {fe?.message}
                    {fe?.hint && (
                      <span style={{ display: 'block', color: 'var(--fg-muted)', marginTop: 2 }}>{fe.hint}</span>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {!isManual && !showCreds && (
            <button type="button" className="action-card" onClick={() => setShowCreds(true)}>
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
            </button>
          )}

          {!isManual && showCreds && (
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
                placeholder="2FA secret (optional)"
                aria-label="Two-factor authentication TOTP secret, optional"
                value={otpSecret}
                onChange={e => setOtpSecret(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--fg)' }}
              />
              <div style={{ fontSize: '0.6rem', color: 'var(--fg-muted)', lineHeight: 1.4 }}>
                2FA secret: the base32 code Airtable shows when you set up an authenticator
                app (also called a TOTP secret). Leave empty if 2FA is disabled.
              </div>
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
                  onClick={() => { resetCredsForm(); setShowCreds(false); }}
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

          {auth.error && (() => {
            const fe = friendlyError(auth.error);
            return (
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-warn)', padding: '4px 8px', background: 'var(--bg-warn)', borderRadius: 6 }} title={fe?.raw}>
                {fe?.message}
                {fe?.hint && (
                  <span style={{ display: 'block', color: 'var(--fg-muted)', marginTop: 2 }}>{fe.hint}</span>
                )}
              </div>
            );
          })()}

          {(auth.lastChecked || auth.lastLogin) && (
            <div style={{ display: 'flex', gap: 12, fontSize: '0.62rem', color: 'var(--fg-muted)' }}>
              {auth.lastChecked && <span>Checked: {new Date(auth.lastChecked).toLocaleTimeString()}</span>}
              {auth.lastLogin && <span>Login: {new Date(auth.lastLogin).toLocaleTimeString()}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="action-card" onClick={isManual ? manualLogin : login} disabled={isBusy} style={{ flex: 1, minWidth: 100, opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-green" style={{ width: 22, height: 22 }}>
                <LogIn size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{isManual ? 'Login in Browser' : 'Login'}</span>
            </button>
            <button type="button" className="action-card" onClick={status} disabled={isBusy} style={{ flex: 1, minWidth: 100, opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-blue" style={{ width: 22, height: 22 }}>
                <RefreshCw size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Check</span>
            </button>
            <button type="button" className="action-card" onClick={logout} disabled={isBusy} style={{ flex: 1, minWidth: 100, opacity: isBusy ? 0.5 : 1 }}>
              <div className="icon-badge icon-badge-pink" style={{ width: 22, height: 22 }}>
                <LogOut size={11} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Storage & Data */}
      <div className="glass-panel">
        <div
          className="section-header"
          onClick={() => setStorageOpen(!storageOpen)}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div>
            <div className="eyebrow">Diagnostics</div>
            <div className="title">Storage & Data</div>
          </div>
          {storageOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        {storageOpen && (
          <div className="stack stack-sm">
            {storage?.entries?.map((entry, i) => (
              <div key={i} className="list-row" style={{ flexWrap: 'wrap' }}>
                <FolderOpen size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>{entry.label}</span>
                    {entry.exists
                      ? <span style={{ fontSize: '0.62rem', color: 'var(--fg-muted)' }}>{entry.sizeBytes != null ? formatBytes(entry.sizeBytes) : '...'}</span>
                      : <span className="chip chip-warn" style={{ fontSize: '0.58rem' }}>Missing</span>
                    }
                  </div>
                  <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: entry.exists ? 'var(--fg-subtle)' : 'var(--fg-muted)', marginTop: 1, wordBreak: 'break-all' }}>
                    {entry.path}
                  </div>
                </div>
                {entry.exists && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => openStoragePath(entry.path)}
                    style={{ fontSize: '0.62rem', padding: '2px 8px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}
                    title="Open in file explorer"
                  >
                    Open ↗
                  </button>
                )}
              </div>
            ))}

            {!isManual && (
              <div className="list-row">
                <Key size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.72rem', flex: 1 }}>OS Keychain</span>
                <span className={auth.hasCredentials ? 'chip chip-ok' : 'chip chip-warn'} style={{ fontSize: '0.58rem' }}>
                  {auth.hasCredentials ? 'Credentials: Saved' : 'Credentials: Not set'}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <button
                className="btn btn-ghost"
                onClick={backupSession}
                disabled={!storage?.entries?.some(e => e.exists)}
                style={{ flex: 1, fontSize: '0.68rem', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
              >
                <Archive size={11} /> Backup Session
              </button>
              <button
                className="btn btn-ghost"
                onClick={restoreSession}
                style={{ flex: 1, fontSize: '0.68rem', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
              >
                <Upload size={11} /> Restore Session
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Auto-Refresh settings */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Authentication</div>
          <div className="title">Auto-Refresh</div>
        </div>
        <div className="stack stack-sm">
          <SettingToggle
            label={isManual ? 'Monitor session health' : 'Auto-refresh session'}
            desc={isManual ? 'Periodically check session status and notify when expired' : 'Periodically check and re-login when session expires'}
            value={settings.auth.autoRefresh}
            settingKey="auth.autoRefresh"
          />
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
              onChange={e => changeHeavySetting('mcp.serverSource', e.target.value)}
            >
              <option value="bundled">bundled</option>
              <option value="npx">npx</option>
            </select>
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
              onChange={e => changeHeavySetting('mcp.toolProfile', e.target.value)}
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
              <SettingToggle label="Read / Inspect"       desc="Schema, fields, views, formula validation, sidebar sections, record templates (11 tools)" value={settings.mcp.toolProfile.categories.read}                   settingKey="mcp.categories.read" />
              <SettingToggle label="Record Read"          desc="query_records — snapshot read of up to 1000 rows per call (1 tool)"                            value={settings.mcp.toolProfile.categories.recordRead}             settingKey="mcp.categories.recordRead" />
              <SettingToggle label="Table Write"          desc="Tables + record templates: create / rename / update / set cells / duplicate / apply (9 tools)" value={settings.mcp.toolProfile.categories.tableWrite}             settingKey="mcp.categories.tableWrite" />
              <SettingToggle label="Table Destructive"    desc="delete_table, delete_record_template (2 tools)"                              value={settings.mcp.toolProfile.categories.tableDestructive}       settingKey="mcp.categories.tableDestructive" />
              <SettingToggle label="Field Write"          desc="Create / update / rename / duplicate fields (7 tools)"                        value={settings.mcp.toolProfile.categories.fieldWrite}             settingKey="mcp.categories.fieldWrite" />
              <SettingToggle label="Field Destructive"    desc="delete_field, delete_fields (2 tools)"                                        value={settings.mcp.toolProfile.categories.fieldDestructive}       settingKey="mcp.categories.fieldDestructive" />
              <SettingToggle label="View Write"           desc="Views, filters, sorts, columns, freezing, covers, calendar dates (19 tools)" value={settings.mcp.toolProfile.categories.viewWrite}              settingKey="mcp.categories.viewWrite" />
              <SettingToggle label="View Destructive"     desc="delete_view (1 tool)"                                                         value={settings.mcp.toolProfile.categories.viewDestructive}        settingKey="mcp.categories.viewDestructive" />
              <SettingToggle label="View Sections"        desc="Sidebar grouping: create / rename / move (3 tools)"                           value={settings.mcp.toolProfile.categories.viewSection}            settingKey="mcp.categories.viewSection" />
              <SettingToggle label="View Sections (destructive)" desc="delete_view_section (1 tool)"                                          value={settings.mcp.toolProfile.categories.viewSectionDestructive} settingKey="mcp.categories.viewSectionDestructive" />
              <SettingToggle label="Form Metadata"        desc="Edit legacy form views — public-facing (2 tools)"                             value={settings.mcp.toolProfile.categories.formWrite}              settingKey="mcp.categories.formWrite" />
              <SettingToggle label="Extension Management" desc="Create / install / duplicate / remove extensions (7 tools)"                   value={settings.mcp.toolProfile.categories.extension}              settingKey="mcp.categories.extension" />
              <SettingToggle label="Record Write"         desc="duplicate_records — bulk record duplication via pasteCells (1 tool)"                            value={settings.mcp.toolProfile.categories.recordWrite}            settingKey="mcp.categories.recordWrite" />
            </div>
          )}

          <button type="button" className="action-card" onClick={() => sendToExtension({ type: 'action:openToolConfig', id: 'open-tool-config' })}>
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
              onChange={e => sendToExtension({ type: 'setting:change', key: 'script.beautifyStyle', value: e.target.value })}
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
              onChange={e => sendToExtension({ type: 'setting:change', key: 'script.minifyLevel', value: e.target.value })}
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
              onChange={e => sendToExtension({ type: 'setting:change', key: 'debug.bufferSize', value: Number(e.target.value) })}
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

    </div>
  );
}
