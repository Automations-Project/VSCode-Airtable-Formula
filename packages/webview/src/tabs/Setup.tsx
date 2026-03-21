import React from 'react';
import { useStore } from '../store.js';
import { IdeCard } from '../components/IdeCard.js';

export function Setup() {
  const { ideStatuses, pendingActions, setupIde, setupAll } = useStore();

  const detected = ideStatuses.filter(ide => ide.detected);
  const undetected = ideStatuses.filter(ide => !ide.detected);
  const pending = detected.filter(ide => !ide.mcpConfigured);
  const isLoading = pendingActions.size > 0;

  return (
    <div className="stack stack-lg">

      {/* Summary header */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">IDE Configuration</div>
          <div className="title">Setup</div>
          <div className="detail">
            {detected.length} IDE{detected.length !== 1 ? 's' : ''} detected
            {pending.length > 0 && <> &middot; <span style={{ color: 'var(--fg-warn)' }}>{pending.length} need setup</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {pending.length > 0 && (
            <button className="btn btn-primary" onClick={setupAll} disabled={isLoading} style={{ opacity: isLoading ? 0.6 : 1 }}>
              {isLoading ? 'Setting up...' : 'Setup all'}
            </button>
          )}
          {pending.length === 0 && detected.length > 0 && (
            <span className="chip chip-ok">All configured</span>
          )}
        </div>
      </div>

      {/* Detected IDEs */}
      {detected.length > 0 && (
        <div className="glass-panel">
          <div className="section-header">
            <div className="eyebrow">Detected</div>
            <div className="title">Available IDEs</div>
          </div>
          <div className="stack stack-sm">
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
        <div className="glass-panel">
          <div className="section-header">
            <div className="eyebrow">Not detected</div>
            <div className="title">Other supported IDEs</div>
          </div>
          <div className="stack stack-sm">
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
        <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.72rem', padding: '24px 12px' }}>
          No IDE data available yet. Loading...
        </div>
      )}

    </div>
  );
}
