import React, { useEffect } from 'react';
import { useStore } from './store.js';
import { onExtensionMessage, sendToExtension } from './lib/vscode.js';
import { parseExtensionMessage } from '@shared/webview-contract.js';
import { resolveHostConfirmation } from './lib/confirmation.js';
import { Overview } from './tabs/Overview.js';
import { Setup } from './tabs/Setup.js';
import { Prompts } from './tabs/Prompts.js';
import { Settings } from './tabs/Settings.js';
import { AirtableLogo } from './components/AirtableLogo.js';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'setup'    as const, label: 'Setup' },
  { id: 'prompts'  as const, label: 'Prompts' },
  { id: 'settings' as const, label: 'Settings' },
];

const BRAND_DOTS = [
  { bg: '#FCB400', delay: '0s' },
  { bg: '#18BFFF', delay: '0.18s' },
  { bg: '#F82B60', delay: '0.36s' },
] as const;

function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 16,
        animation: 'at-loader-fadein 0.4s ease both',
      }}
    >
      {/* Breathing logo */}
      <div style={{ animation: 'at-logo-breathe 2.6s ease-in-out infinite' }}>
        <AirtableLogo size={54} />
      </div>

      {/* App name + status */}
      <div style={{ textAlign: 'center', lineHeight: 1.5 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Airtable Dashboard</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', marginTop: 3 }}>Loading dashboard…</div>
      </div>

      {/* Brand-color bouncing dots */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        {BRAND_DOTS.map(({ bg, delay }) => (
          <div
            key={bg}
            style={{
              width: 7, height: 7, borderRadius: '50%', background: bg,
              animation: `at-dot-bounce 1.3s ease-in-out infinite ${delay}`,
            }}
          />
        ))}
      </div>
    </div>
  );
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
    openLink,
    versions,
    loading,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderTop: '2px solid var(--at-blue)', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

      {/* Ambient orbs */}
      <div className="orb orb-blue" />
      <div className="orb orb-pink" />

      {/* Header + tabs */}
      <div style={{ background: 'var(--bg-nav)', padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44 }}>
          <AirtableLogo size={22} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Airtable Dashboard</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--at-gray600)' }} />
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>VSCode</span>
          <div style={{ flex: 1 }} />
          <span className="chip chip-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>v{versions.extension}</span>
        </div>
        <div style={{ display: loading ? 'none' : 'flex' }} role="tablist" aria-label="Dashboard sections">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={activeTab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              aria-label={t.label}
              style={{
                padding: '8px 14px 9px', fontSize: 11, fontWeight: activeTab === t.id ? 600 : 500,
                color: activeTab === t.id ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${activeTab === t.id ? 'var(--at-blue)' : 'transparent'}`,
                transition: 'color var(--ease-std) 120ms, border-color var(--ease-std) 120ms',
                whiteSpace: 'nowrap',
              }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: loading ? 0 : '14px 16px 20px', position: 'relative', zIndex: 1 }}
        role={loading ? undefined : 'tabpanel'}
        id={loading ? undefined : `tabpanel-${activeTab}`}
        aria-label={loading ? undefined : TABS.find(t => t.id === activeTab)?.label}
      >
        {loading ? <LoadingScreen /> : (
          <>
            {activeTab === 'overview' && <Overview />}
            {activeTab === 'setup'    && <Setup />}
            {activeTab === 'prompts'  && <Prompts />}
            {activeTab === 'settings' && <Settings />}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 16px 10px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, flexShrink: 0, position: 'relative', zIndex: 1 }}>
        {([
          { id: 'docs', label: 'Docs' },
          { id: 'changelog', label: 'Changelog' },
          { id: 'github', label: 'GitHub' },
        ] as const).map((link, i) => (
          <React.Fragment key={link.label}>
            {i > 0 && <span style={{ width: 1, height: 10, background: 'var(--border)', alignSelf: 'center' }} aria-hidden="true" />}
            <button
              type="button"
              aria-label={`Open ${link.label} (external link)`}
              style={{ fontSize: 9, color: 'var(--fg-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => openLink(link.id)}
            >{link.label}</button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
