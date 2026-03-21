import React, { useEffect } from 'react';
import { useStore } from './store.js';
import { onExtensionMessage, sendToExtension } from './lib/vscode.js';
import type { ExtensionMessage } from '@shared/messages.js';
import { Overview } from './tabs/Overview.js';
import { Setup } from './tabs/Setup.js';
import { Settings } from './tabs/Settings.js';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'setup'    as const, label: 'Setup' },
  { id: 'settings' as const, label: 'Settings' },
];

export function App() {
  const { activeTab, setTab, applyState, markActionDone } = useStore();

  useEffect(() => {
    const off = onExtensionMessage((msg: ExtensionMessage) => {
      if (msg.type === 'state:update') applyState(msg.payload);
      if (msg.type === 'action:result') markActionDone(msg.id, msg.ok);
    });
    sendToExtension({ type: 'ready' });
    return off;
  }, []);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', borderTop:'2px solid var(--at-blue)', background:'var(--bg)' }}>
      <div style={{ background:'var(--bg-nav)', padding:'0 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, height:44 }}>
          <div id="at-logo" style={{ width:24, height:24, borderRadius:3, background:'var(--at-blue)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'#fff', flexShrink:0 }}>A</div>
          <span style={{ fontSize:13, fontWeight:600 }}>Airtable Formula</span>
          <span style={{ width:3, height:3, borderRadius:'50%', background:'var(--at-gray600)' }} />
          <span style={{ fontSize:11, color:'var(--fg-muted)' }}>VSCode</span>
          <div style={{ flex:1 }} />
          <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--fg-muted)', background:'var(--bg-subtle)', padding:'2px 6px', borderRadius:3, border:'1px solid var(--border)' }}>v2.0.0</span>
        </div>
        <div style={{ display:'flex' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:'8px 14px 9px', fontSize:11, fontWeight: activeTab===t.id ? 600 : 500,
              color: activeTab===t.id ? 'var(--fg)' : 'var(--fg-muted)',
              borderBottom: `2px solid ${activeTab===t.id ? 'var(--at-blue)' : 'transparent'}`,
              transition:'color var(--ease-std) 120ms, border-color var(--ease-std) 120ms',
              whiteSpace:'nowrap',
            }}>{t.label}</button>
          ))}
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 20px' }}>
        {activeTab === 'overview' && <Overview />}
        {activeTab === 'setup'    && <Setup />}
        {activeTab === 'settings' && <Settings />}
      </div>
      <div style={{ padding:'8px 16px 10px', borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:8, flexShrink:0 }}>
        {['Docs','Changelog','GitHub'].map((l,i) => (
          <React.Fragment key={l}>
            {i > 0 && <span style={{ width:1, height:10, background:'var(--border)', alignSelf:'center' }} />}
            <span style={{ fontSize:9, color:'var(--fg-muted)', cursor:'pointer' }}>{l}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
