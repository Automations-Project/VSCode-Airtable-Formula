import React from 'react';
import type { IdeStatus } from '@shared/types.js';
import { StatusDot } from './StatusDot.js';
import { Pill } from './Pill.js';

interface IdeCardProps { status: IdeStatus; onSetup: () => void; loading: boolean; }

export function IdeCard({ status, onSetup, loading }: IdeCardProps) {
  const dotVariant = !status.detected ? 'off' : status.mcpConfigured ? 'ok' : 'warn';
  const allReady = status.mcpConfigured && Object.values(status.aiFiles).every(s => s === 'ok');
  const cardStyle: React.CSSProperties = {
    background: allReady ? 'var(--bg-blue-selected)' : 'var(--bg)',
    border: `1px solid ${allReady ? 'rgba(22,110,225,0.3)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-md)',
    opacity: status.detected ? 1 : 0.5,
    borderStyle: status.detected ? 'solid' : 'dashed',
    overflow: 'hidden',
    transition: `border-color var(--ease-std) 150ms`,
  };

  return (
    <div style={cardStyle}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px' }}>
        <StatusDot variant={dotVariant} />
        <span style={{ fontSize:12, fontWeight:700, flex:1 }}>{status.label}</span>
        {status.version && <span style={{ fontSize:9, color:'var(--fg-muted)' }}>{status.version}</span>}
        {status.detected && (
          allReady
            ? <button style={{ fontSize:11, padding:'4px 10px', borderRadius:'var(--radius-md)', background:'rgba(195,212,249,0.10)', color:'var(--fg-subtle)', boxShadow:'inset 0 0 0 1px rgba(143,152,169,0.4)' }}>All set</button>
            : <button onClick={onSetup} disabled={loading} style={{ fontSize:11, padding:'4px 10px', borderRadius:'var(--radius-md)', background:'var(--at-blue)', color:'#fff', opacity: loading ? 0.6 : 1 }}>
                {loading ? '...' : 'Setup'}
              </button>
        )}
        {!status.detected && <button style={{ fontSize:9, padding:'4px 8px', color:'var(--fg-muted)', borderRadius:'var(--radius-sm)' }}>Docs</button>}
      </div>
      {status.detected && (
        <div style={{ padding:'0 14px 12px', display:'flex', flexDirection:'column', gap:6, borderTop:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:'var(--radius-sm)', background: status.mcpConfigured ? 'var(--bg-info)' : 'var(--bg-error)', border: `1px solid ${status.mcpConfigured ? 'rgba(22,110,225,0.18)' : 'rgba(220,4,59,0.2)'}`, marginTop: 8 }}>
            <span style={{ fontSize:11, fontWeight:600, color: status.mcpConfigured ? 'var(--fg-info)' : 'var(--fg-err)' }}>MCP {status.mcpConfigured ? 'configured' : 'not configured'}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:'var(--radius-sm)', background:'var(--bg-ai)', border:'1px solid rgba(221,4,168,0.15)' }}>
            <span style={{ fontSize:11, color:'var(--fg-ai)', fontWeight:600, whiteSpace:'nowrap' }}>AI files</span>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginLeft:'auto' }}>
              <Pill label="skills" status={status.aiFiles.skills} />
              <Pill label="rules" status={status.aiFiles.rules} />
              <Pill label="workflows" status={status.aiFiles.workflows} />
              <Pill label="agents" status={status.aiFiles.agents} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
