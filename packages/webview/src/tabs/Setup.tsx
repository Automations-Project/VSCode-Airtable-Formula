import React from 'react';
import { useStore } from '../store.js';
import { IdeCard } from '../components/IdeCard.js';

export function Setup() {
  const { ideStatuses, pendingActions, setupIde, setupAll } = useStore();

  const detected   = ideStatuses.filter(ide => ide.detected);
  const undetected = ideStatuses.filter(ide => !ide.detected);
  const pending    = detected.filter(ide => !ide.mcpConfigured);
  const isLoading  = pendingActions.size > 0;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Summary bar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-inset)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:12, fontWeight:600 }}>{detected.length}</span>
          <span style={{ fontSize:11, color:'var(--fg-muted)', marginLeft:4 }}>IDE{detected.length !== 1 ? 's' : ''} detected</span>
          {pending.length > 0 && (
            <span style={{ fontSize:9, marginLeft:8, color:'var(--fg-warn)' }}>· {pending.length} need setup</span>
          )}
        </div>
        {pending.length > 0 && (
          <button
            onClick={setupAll}
            disabled={isLoading}
            style={{ fontSize:11, padding:'5px 12px', borderRadius:'var(--radius-md)', background:'var(--at-blue)', color:'#fff', fontWeight:600, opacity: isLoading ? 0.6 : 1 }}
          >
            {isLoading ? 'Setting up…' : 'Setup all'}
          </button>
        )}
        {pending.length === 0 && detected.length > 0 && (
          <span style={{ fontSize:10, color:'var(--fg-ok)', fontWeight:600 }}>All configured</span>
        )}
      </div>

      {/* Detected IDEs */}
      {detected.length > 0 && (
        <div>
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--fg-muted)', marginBottom:8 }}>Detected IDEs</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {detected.map(ide => (
              <IdeCard
                key={ide.ideId}
                status={ide}
                onSetup={() => setupIde(ide.ideId)}
                loading={isLoading}
              />
            ))}
          </div>
        </div>
      )}

      {/* Undetected IDEs */}
      {undetected.length > 0 && (
        <div>
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--fg-muted)', marginBottom:8 }}>Not Detected</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {undetected.map(ide => (
              <IdeCard
                key={ide.ideId}
                status={ide}
                onSetup={() => {}}
                loading={false}
              />
            ))}
          </div>
        </div>
      )}

      {ideStatuses.length === 0 && (
        <div style={{ padding:'24px 12px', textAlign:'center', color:'var(--fg-muted)', fontSize:11, background:'var(--bg-inset)', border:'1px dashed var(--border)', borderRadius:'var(--radius-md)' }}>
          No IDE data available yet. Loading…
        </div>
      )}

    </div>
  );
}
