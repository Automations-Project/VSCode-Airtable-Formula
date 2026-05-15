import React from 'react';
import { useStore } from '../store.js';
import { IdeCard } from '../components/IdeCard.js';

export function Setup() {
  const { ideStatuses, pendingActions, pendingIdeActions, setupIde, setupAll, unconfigureIde, tunnel, enableTunnel, disableTunnel, setNgrokAuthtoken } = useStore();

  const detected = ideStatuses.filter(ide => ide.detected);
  const undetected = ideStatuses.filter(ide => !ide.detected);
  const pending = detected.filter(ide => !ide.mcpConfigured);
  const isLoading = pendingActions.size > 0;

  const [selectedProvider, setSelectedProvider] = React.useState<'cf-quick' | 'ngrok' | 'cf-named'>('cf-quick');
  const [ngrokAuthtokenInput, setNgrokAuthtokenInput] = React.useState('');
  const [ngrokDomainInput, setNgrokDomainInput] = React.useState('');
  const [isTunnelPending, setIsTunnelPending] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);

  React.useEffect(() => {
    if (tunnel?.provider) setSelectedProvider(tunnel.provider);
  }, [tunnel?.provider]);

  const handleEnableTunnel = async () => {
    setIsTunnelPending(true);
    try {
      if (selectedProvider === 'ngrok' && ngrokAuthtokenInput) {
        setNgrokAuthtoken(ngrokAuthtokenInput);
      }
      enableTunnel(selectedProvider, undefined, ngrokDomainInput || undefined);
    } finally {
      setIsTunnelPending(false);
    }
  };

  const handleDisableTunnel = async () => {
    setIsTunnelPending(true);
    try {
      disableTunnel();
    } finally {
      setIsTunnelPending(false);
    }
  };

  const handleCopyUrl = () => {
    if (tunnel?.url) {
      navigator.clipboard.writeText(tunnel.url).catch(() => undefined);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }
  };

  const tunnelDetail = tunnel?.status === 'active'
    ? 'Your MCP server is publicly accessible'
    : tunnel?.status === 'auto-disabled'
    ? 'Tunnel disabled after repeated auth failures'
    : tunnel?.status === 'error'
    ? 'Tunnel failed to start — check the Output panel'
    : 'Expose your local MCP server via a public HTTPS URL';

  return (
    <div className="stack stack-lg">

      {/* Tunnel section */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Remote Access</div>
          <div className="title">Tunnel</div>
          <div className="detail">{tunnelDetail}</div>
        </div>

        {/* Status chip */}
        {tunnel && (
          <div style={{ marginBottom: 8 }}>
            {tunnel.status === 'active' && <span className="chip chip-ok">Active</span>}
            {tunnel.status === 'disabled' && <span className="chip chip-muted">Disabled</span>}
            {tunnel.status === 'starting' && <span className="chip chip-info">Starting...</span>}
            {tunnel.status === 'auto-disabled' && <span className="chip chip-warn">Auto-disabled</span>}
            {tunnel.status === 'error' && <span className="chip chip-err">Error</span>}
          </div>
        )}

        {/* 401-burst warning banner */}
        {tunnel?.status === 'auto-disabled' && tunnel.autoDisabledReason && (
          <div
            role="alert"
            style={{
              background: 'var(--bg-warn)',
              color: 'var(--fg-warn)',
              border: '1px solid rgba(255,186,5,0.2)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              marginBottom: 8,
              fontSize: '0.72rem',
            }}
          >
            Tunnel auto-disabled: {tunnel.autoDisabledReason.failures} auth failures
            {tunnel.autoDisabledReason.ip ? ` from ${tunnel.autoDisabledReason.ip}` : ''}
            {' '}in {tunnel.autoDisabledReason.windowMs / 1000}s. Re-enable when ready.
          </div>
        )}

        {/* Provider picker */}
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="tunnel-provider" style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            Provider
          </label>
          <select
            id="tunnel-provider"
            className="select-input"
            value={selectedProvider}
            disabled={tunnel?.status === 'active' || tunnel?.status === 'starting'}
            onChange={e => setSelectedProvider(e.target.value as typeof selectedProvider)}
            style={{ opacity: (tunnel?.status === 'active' || tunnel?.status === 'starting') ? 0.6 : 1 }}
          >
            <option value="cf-quick">Cloudflare Quick Tunnel</option>
            <option value="ngrok">ngrok</option>
            <option value="cf-named">Cloudflare Named Tunnel</option>
          </select>
        </div>

        {/* ngrok authtoken input (shown when ngrok selected + no token stored) */}
        {selectedProvider === 'ngrok' && !tunnel?.ngrokAuthtokenSet && (
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="ngrok-authtoken" style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              ngrok Auth Token
            </label>
            <input
              id="ngrok-authtoken"
              type="password"
              placeholder="Paste token from ngrok dashboard"
              aria-describedby="ngrok-authtoken-helper"
              value={ngrokAuthtokenInput}
              onChange={e => setNgrokAuthtokenInput(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '4px 8px',
                color: 'var(--fg)',
                marginBottom: 4,
              }}
            />
            <div id="ngrok-authtoken-helper" style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>
              Stored securely in VS Code SecretStorage
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: 4 }}>
              ngrok tunnels must be manually re-enabled after daemon restarts (authtoken stored in VS Code SecretStorage is not accessible to the daemon at startup).
            </div>
            <label htmlFor="ngrok-domain" style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, marginTop: 8 }}>
              Reserved Domain (optional)
            </label>
            <input
              id="ngrok-domain"
              type="text"
              placeholder="yourname.ngrok-free.app"
              value={ngrokDomainInput}
              onChange={e => setNgrokDomainInput(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '4px 8px',
                color: 'var(--fg)',
              }}
            />
          </div>
        )}

        {/* Tunnel URL display */}
        {tunnel?.url && (
          <div className="list-row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tunnel.url}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              aria-label="Copy tunnel URL"
              onClick={handleCopyUrl}
            >
              {copiedUrl ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {/* Enable/Disable button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {(tunnel?.status === 'active' || tunnel?.status === 'starting') ? (
            <button
              className="btn btn-ghost"
              onClick={handleDisableTunnel}
              disabled={isTunnelPending}
              aria-busy={isTunnelPending}
              style={{ opacity: isTunnelPending ? 0.6 : 1 }}
            >
              {isTunnelPending ? 'Stopping...' : 'Disable Tunnel'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleEnableTunnel}
              disabled={isTunnelPending}
              aria-busy={isTunnelPending}
              style={{ opacity: isTunnelPending ? 0.6 : 1 }}
            >
              {isTunnelPending ? 'Starting...' : 'Enable Tunnel'}
            </button>
          )}
        </div>
      </div>

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
                onUnconfigure={() => unconfigureIde(ide.ideId)}
                loading={pendingIdeActions.has(ide.ideId)}
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
                onUnconfigure={() => {}}
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
