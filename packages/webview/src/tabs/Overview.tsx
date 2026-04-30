import React from 'react';
import { useStore } from '../store.js';
import { StatCard } from '../components/StatCard.js';
import { StatusDot } from '../components/StatusDot.js';
import { IdeIcon } from '../components/IdeIcon.js';
import { RefreshCw, Zap, Sparkles, LogIn, AlertTriangle, Download } from 'lucide-react';

export function Overview() {
  const { ideStatuses, versions, aiFilesCount, auth, setTab, refresh, setupAll, login, installBrowser } = useStore();
  const dl = auth.browserDownload;
  const downloading = dl?.status === 'downloading';

  const configuredCount = ideStatuses.filter(ide => ide.detected && ide.mcpConfigured).length;
  const detectedCount = ideStatuses.filter(ide => ide.detected).length;
  const pendingCount = ideStatuses.filter(ide => ide.detected && !ide.mcpConfigured).length;

  return (
    <div className="stack stack-lg">

      {/* Section 1: Status */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Airtable Platform</div>
          <div className="title">Status</div>
        </div>
        <div className="list-row" style={{ marginTop: 4 }}>
          <StatusDot variant={configuredCount > 0 ? 'ok' : pendingCount > 0 ? 'warn' : 'off'} />
          <span style={{ fontSize: '0.75rem', flex: 1 }}>
            {configuredCount > 0
              ? 'Ready for MCP sessions'
              : pendingCount > 0
                ? `${pendingCount} IDE${pendingCount > 1 ? 's' : ''} need setup`
                : 'No IDEs detected yet'}
          </span>
          <span className="chip chip-info">{configuredCount} IDE{configuredCount !== 1 ? 's' : ''} configured</span>
          <span className="chip chip-muted">{aiFilesCount} AI files</span>
        </div>
        <div className="list-row" style={{ marginTop: 4 }}>
          <StatusDot variant={
            auth.status === 'valid' ? 'ok'
            : auth.status === 'chrome-missing' ? 'err'
            : auth.status === 'expired' || auth.status === 'error' ? 'warn'
            : auth.status === 'checking' || auth.status === 'logging-in' ? 'info'
            : 'off'
          } />
          <span style={{ fontSize: '0.75rem', flex: 1 }}>
            {auth.status === 'valid' ? 'Airtable session active'
              : auth.status === 'chrome-missing' ? 'Browser required for auth'
              : auth.status === 'expired' ? 'Session expired'
              : auth.status === 'error' ? 'Auth error'
              : auth.status === 'checking' ? 'Checking session...'
              : auth.status === 'logging-in' ? 'Logging in...'
              : 'Session not checked'}
          </span>
          {auth.browser?.found && auth.browser?.label && (
            <span className="chip chip-muted" style={{ fontSize: '0.58rem' }}>{auth.browser.label}</span>
          )}
          {auth.userId && <span className="chip chip-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem' }}>{auth.userId}</span>}
        </div>
      </div>

      {/* Section 2: Metrics */}
      <div className="metrics-grid">
        <StatCard value={configuredCount} label="IDEs configured" accent="blue" />
        <div className="metric-card" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--fg-muted)', letterSpacing: '0.05em' }}>Version</span>
          <span style={{ fontSize: '0.85rem' }}>Extension {versions.extension}</span>
          <span style={{ fontSize: '0.85rem' }}>MCP server {versions.mcpServerBundled} <span style={{ color: 'var(--fg-muted)', fontSize: '0.7rem' }}>bundled</span></span>
          {versions.mcpServerPublished && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>↑ update available: {versions.mcpServerPublished}</span>
          )}
        </div>
      </div>

      {/* Section 3: Quick Actions */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Quick Actions</div>
          <div className="title">Controls</div>
        </div>
        <div className="stack stack-sm">
          <button type="button" className="action-card" onClick={refresh}>
            <div className="icon-badge icon-badge-blue">
              <RefreshCw size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Refresh state</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>Re-scan IDEs and update dashboard</div>
            </div>
          </button>
          <button type="button" className="action-card" onClick={setupAll}>
            <div className="icon-badge icon-badge-green">
              <Zap size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Setup all IDEs</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>Configure MCP and AI files in all detected IDEs</div>
            </div>
          </button>
          <button type="button" className="action-card" onClick={() => setTab('setup')}>
            <div className="icon-badge icon-badge-pink">
              <Sparkles size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Install AI files</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>Manage skills, rules, workflows per IDE</div>
            </div>
          </button>
          {auth.status === 'chrome-missing' && !downloading && (
            <>
              <button type="button" className="action-card" onClick={installBrowser}>
                <div className="icon-badge icon-badge-blue">
                  <Download size={13} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Download bundled Chromium</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                    One-time ~170 MB download into extension storage — no system Chrome needed
                  </div>
                </div>
              </button>
              <a
                className="action-card"
                href="https://www.google.com/chrome/"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="icon-badge icon-badge-pink">
                  <AlertTriangle size={13} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Or install Google Chrome</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                    Use your own system browser — Edge and Chromium also work
                  </div>
                </div>
              </a>
            </>
          )}
          {auth.status === 'chrome-missing' && downloading && (
            <div className="action-card" style={{ cursor: 'default' }}>
              <div className="icon-badge icon-badge-blue">
                <Download size={13} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Downloading Chromium...</span>
                  <span>{dl?.progress ?? 0}%</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
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
            </div>
          )}
          {auth.status !== 'valid' && auth.status !== 'chrome-missing' && auth.hasCredentials && (
            <button type="button" className="action-card" onClick={login}>
              <div className="icon-badge icon-badge-green">
                <LogIn size={13} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Login to Airtable</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
                  {auth.status === 'expired' ? 'Session expired — click to re-login' : 'Authenticate for MCP access'}
                </div>
              </div>
            </button>
          )}
          {!auth.hasCredentials && (
            <button type="button" className="action-card" onClick={() => setTab('settings')}>
              <div className="icon-badge icon-badge-blue">
                <LogIn size={13} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Set Airtable credentials</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--fg-subtle)', marginTop: 1 }}>Save login details in Settings to enable auto-refresh</div>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Section 4: IDE Status */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">IDE Status</div>
          <div className="title">Detected environments</div>
        </div>
        <div className="stack stack-sm">
          {ideStatuses.filter(ide => ide.detected).map(ide => (
            <div key={ide.ideId} className="list-row">
              <IdeIcon ideId={ide.ideId} size={16} color={ide.mcpConfigured ? 'var(--fg)' : 'var(--fg-muted)'} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>{ide.label}</span>
              {ide.version && (
                <span style={{ fontSize: '0.6rem', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{ide.version}</span>
              )}
              <span className={ide.mcpConfigured ? 'chip chip-ok' : 'chip chip-warn'}>
                {ide.mcpConfigured ? 'MCP ready' : 'MCP missing'}
              </span>
            </div>
          ))}
          {detectedCount === 0 && (
            <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.72rem', border: '1px dashed var(--border)', borderRadius: 12 }}>
              No IDEs detected yet
            </div>
          )}
        </div>
      </div>

      {/* Section 5: MCP Server */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Server</div>
          <div className="title">MCP Server</div>
        </div>
        <div className="list-row">
          <IdeIcon ideId="mcp" size={18} color="var(--fg-info)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--fg-info)' }}>MCP Server</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>
              {versions.mcpServerBundled !== '—' ? `Running v${versions.mcpServerBundled}` : 'Not running'}
            </div>
          </div>
          <span className="chip chip-info" style={{ fontFamily: 'var(--font-mono)' }}>{versions.mcpServerBundled}</span>
        </div>
      </div>

    </div>
  );
}
