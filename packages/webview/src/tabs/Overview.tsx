import React from 'react';
import { useStore } from '../store.js';
import { StatCard } from '../components/StatCard.js';
import { StatusDot } from '../components/StatusDot.js';

export function Overview() {
  const { ideStatuses, mcpVersion, aiFilesCount, setTab } = useStore();

  const configuredCount = ideStatuses.filter(ide => ide.detected && ide.mcpConfigured).length;
  const pendingCount    = ideStatuses.filter(ide => ide.detected && !ide.mcpConfigured).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Stat grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
        <StatCard value={configuredCount} label="IDEs configured" accent="blue" />
        <StatCard value={mcpVersion}      label="MCP version"     accent="green" />
        <StatCard value={aiFilesCount}    label="AI files active" accent="yellow" />
      </div>

      {/* Pending warning */}
      {pendingCount > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-warn)', border:'1px solid rgba(255,186,5,0.25)', borderRadius:'var(--radius-md)' }}>
          <StatusDot variant="warn" />
          <span style={{ fontSize:11, color:'var(--fg-warn)', flex:1 }}>
            {pendingCount} IDE{pendingCount > 1 ? 's' : ''} detected but not configured
          </span>
          <button
            onClick={() => setTab('setup')}
            style={{ fontSize:10, padding:'3px 10px', borderRadius:'var(--radius-sm)', background:'var(--at-yellow)', color:'rgb(17,18,21)', fontWeight:700 }}
          >
            Go to Setup
          </button>
        </div>
      )}

      {/* IDE list */}
      <div>
        <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--fg-muted)', marginBottom:8 }}>Detected IDEs</div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {ideStatuses.filter(ide => ide.detected).map(ide => (
            <div key={ide.ideId} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg-inset)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}>
              <StatusDot variant={ide.mcpConfigured ? 'ok' : 'warn'} />
              <span style={{ fontSize:11, fontWeight:600, flex:1 }}>{ide.label}</span>
              {ide.version && <span style={{ fontSize:9, color:'var(--fg-muted)', fontFamily:'var(--font-mono)' }}>{ide.version}</span>}
              <span style={{ fontSize:9, color: ide.mcpConfigured ? 'var(--fg-ok)' : 'var(--fg-warn)' }}>
                {ide.mcpConfigured ? 'MCP ready' : 'MCP missing'}
              </span>
            </div>
          ))}
          {ideStatuses.filter(ide => ide.detected).length === 0 && (
            <div style={{ padding:'16px 12px', textAlign:'center', color:'var(--fg-muted)', fontSize:11, background:'var(--bg-inset)', border:'1px dashed var(--border)', borderRadius:'var(--radius-md)' }}>
              No IDEs detected yet
            </div>
          )}
        </div>
      </div>

      {/* MCP status banner */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-info)', border:'1px solid rgba(22,110,225,0.18)', borderRadius:'var(--radius-md)' }}>
        <StatusDot variant={mcpVersion !== '—' ? 'ok' : 'off'} />
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--fg-info)' }}>MCP Server</div>
          <div style={{ fontSize:9, color:'var(--fg-muted)', marginTop:1 }}>
            {mcpVersion !== '—' ? `Running v${mcpVersion}` : 'Not running'}
          </div>
        </div>
        <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:9, color:'var(--fg-info)', background:'rgba(22,110,225,0.15)', padding:'2px 8px', borderRadius:3 }}>{mcpVersion}</span>
      </div>

      {/* AI callout */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-ai)', border:'1px solid rgba(221,4,168,0.15)', borderRadius:'var(--radius-md)' }}>
        <span style={{
          fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:10,
          background:'linear-gradient(90deg,rgba(221,4,168,0.7) 0%,rgba(22,110,225,0.7) 100%)',
          color:'#fff', letterSpacing:'0.05em', textTransform:'uppercase',
        }}>AI</span>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--fg-ai)' }}>AI context files</div>
          <div style={{ fontSize:9, color:'var(--fg-muted)', marginTop:1 }}>{aiFilesCount} files active across IDEs</div>
        </div>
      </div>

    </div>
  );
}
