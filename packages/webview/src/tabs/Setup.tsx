import React from 'react';
import { useStore } from '../store.js';
import { EditorsSection } from './setup/EditorsSection.js';
import { LocalServiceSection } from './setup/LocalServiceSection.js';
import { getLspSnippet, getMcpSnippet, getOfficialAirtableSnippet } from './setup/snippets.js';

// ---------------------------------------------------------------------------
// Module-level constants — defined outside component to avoid re-creation per render
// ---------------------------------------------------------------------------

const MCP_IDE_TABS = [
  { id: 'claude-code',    label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor',         label: 'Cursor' },
  { id: 'windsurf',       label: 'Devin Desktop (Windsurf)' },
  { id: 'cline',          label: 'Cline' },
] as const;

// IDEs that support the official Airtable HTTP MCP (those with mcpServersKey, excluding codex-cli)
const OFFICIAL_MCP_IDES = [
  { id: 'claude-code',    label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor',         label: 'Cursor' },
  { id: 'windsurf',       label: 'Devin Desktop (Windsurf)' },
  { id: 'windsurf-next',  label: 'Devin Desktop Next (Windsurf Next)' },
  { id: 'cline',          label: 'Cline' },
  { id: 'amp',            label: 'Amp' },
  { id: 'opencode',       label: 'OpenCode' },
] as const;

const MCP_VARIANT_TABS = [
  { id: 'http',  label: 'HTTP (daemon)' },
  { id: 'stdio', label: 'stdio (npx)' },
] as const;

const LSP_IDE_TABS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'opencode',    label: 'OpenCode' },
  { id: 'zed',         label: 'Zed' },
  { id: 'neovim',      label: 'Neovim' },
] as const;

const LSP_VARIANT_TABS = [
  { id: 'tcp',   label: 'TCP (daemon)' },
  { id: 'stdio', label: 'stdio' },
] as const;

export function Setup() {
  const { ideStatuses, pendingActions, tunnel, enableTunnel, disableTunnel, setNgrokAuthtoken, daemon, copyBearerToken, officialAirtable, saveAirtablePat, copyAirtablePat, configureOfficialAirtable, unconfigureOfficialAirtable } = useStore();

  const isLoading = pendingActions.size > 0;
  // Derive tunnel pending state from store pendingActions (consistent with IDE actions)
  const isTunnelPending = pendingActions.size > 0;

  const [selectedProvider, setSelectedProvider] = React.useState<'cf-quick' | 'ngrok' | 'cf-named'>('cf-quick');
  const [ngrokAuthtokenInput, setNgrokAuthtokenInput] = React.useState('');
  const [ngrokDomainInput, setNgrokDomainInput] = React.useState('');
  const [namedHostnameInput, setNamedHostnameInput] = React.useState('');
  const [editNgrokToken, setEditNgrokToken] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);
  const [copiedToken, setCopiedToken] = React.useState(false);
  const [patInput, setPatInput] = React.useState('');
  const [copiedPat, setCopiedPat] = React.useState(false);

  // MCP snippet state
  const [mcpActiveIde, setMcpActiveIde] = React.useState('claude-code');
  const [mcpActiveVariant, setMcpActiveVariant] = React.useState<'http' | 'stdio'>('http');
  // LSP snippet state (used by Plan 05 — declared here to co-locate all tab state)
  const [lspActiveIde, setLspActiveIde] = React.useState('claude-code');
  const [lspActiveVariant, setLspActiveVariant] = React.useState<'tcp' | 'stdio'>('tcp');
  // Shared copy state for all snippet copy buttons
  const [copiedKeys, setCopiedKeys] = React.useState<Record<string, boolean>>({});
  // Official Airtable MCP snippet IDE selector
  const [officialSnippetIde, setOfficialSnippetIde] = React.useState('claude-code');

  const tunnelProviderInitialized = React.useRef(false);
  React.useEffect(() => {
    if (!tunnelProviderInitialized.current && tunnel?.provider) {
      tunnelProviderInitialized.current = true;
      setSelectedProvider(tunnel.provider as 'cf-quick' | 'ngrok' | 'cf-named');
    }
  }, [tunnel?.provider]);

  const handleEnableTunnel = () => {
    // Pass authtoken inline so the extension stores and uses it atomically,
    // eliminating the race between tunnel:set-ngrok-authtoken and tunnel:enable.
    const authtoken = (selectedProvider === 'ngrok' && ngrokAuthtokenInput)
      ? ngrokAuthtokenInput
      : undefined;
    const domain =
      selectedProvider === 'cf-named' ? (namedHostnameInput.trim() || undefined)
      : selectedProvider === 'ngrok' ? (ngrokDomainInput.trim() || undefined)
      : undefined;
    enableTunnel(selectedProvider, authtoken, domain);
  };

  const handleDisableTunnel = () => {
    disableTunnel();
  };

  const handleCopyUrl = () => {
    if (tunnel?.url) {
      navigator.clipboard.writeText(tunnel.url).catch(() => undefined);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }
  };

  const handleCopyToken = () => {
    copyBearerToken();
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 1500);
  };

  const handleCopyPat = () => {
    copyAirtablePat();
    setCopiedPat(true);
    setTimeout(() => setCopiedPat(false), 1500);
  };

  const handleCopySnippet = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedKeys(k => ({ ...k, [key]: true }));
    setTimeout(() => setCopiedKeys(k => ({ ...k, [key]: false })), 1500);
  };

  const mcpPort = daemon?.port ?? '{MCP_PORT}';
  const lspPort = daemon?.port_lsp ?? '{LSP_PORT}';
  // When tunnel is active, HTTP snippets should point at the public tunnel URL
  const mcpHttpEndpoint = (mcpActiveVariant === 'http' && tunnel?.status === 'active' && tunnel?.url)
    ? tunnel.url
    : mcpPort;

  const tunnelDetail = tunnel?.status === 'active'
    ? 'Your MCP server is publicly accessible'
    : tunnel?.status === 'auto-disabled'
    ? 'Tunnel disabled after repeated auth failures'
    : tunnel?.status === 'error'
    ? 'Tunnel failed to start — check the Output panel'
    : 'Expose your local MCP server via a public HTTPS URL';

  return (
    <section className="tab-stack" aria-labelledby="setup-heading">
      <h1 id="setup-heading" className="tab-heading" tabIndex={-1}>Setup</h1>
      <LocalServiceSection />
      <EditorsSection />

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
          <label htmlFor="tunnel-provider" className="uppercase-label" style={{ display: 'block', marginBottom: 4 }}>
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

        {/* ngrok inputs — token entry until stored, then a Replace flow; domain always */}
        {selectedProvider === 'ngrok' && (
          <div style={{ marginBottom: 8 }}>
            {(!tunnel?.ngrokAuthtokenSet || editNgrokToken) ? (
              <>
                <label htmlFor="ngrok-authtoken" className="uppercase-label" style={{ display: 'block', marginBottom: 4 }}>
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
                    padding: '6px 10px',
                    color: 'var(--fg)',
                    marginBottom: 4,
                  }}
                />
                <div id="ngrok-authtoken-helper" style={{ fontSize: '0.7rem', color: 'var(--fg-subtle)' }}>
                  Stored securely in VS Code SecretStorage
                </div>
                {editNgrokToken && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!ngrokAuthtokenInput.trim() || isLoading}
                      onClick={() => {
                        setNgrokAuthtoken(ngrokAuthtokenInput.trim());
                        setNgrokAuthtokenInput('');
                        setEditNgrokToken(false);
                      }}
                    >
                      Save token
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setNgrokAuthtokenInput(''); setEditNgrokToken(false); }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div style={{ fontSize: '0.7rem', color: 'var(--fg-subtle)', marginTop: 4, marginBottom: 8 }}>
                  ngrok tunnels must be manually re-enabled after daemon restarts (authtoken stored in VS Code SecretStorage is not accessible to the daemon at startup).
                </div>
              </>
            ) : (
              <div className="list-row" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="chip chip-ok">Auth token stored</span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditNgrokToken(true)}
                  title="Replace the stored ngrok auth token"
                >
                  Replace…
                </button>
              </div>
            )}
            <label htmlFor="ngrok-domain" className="uppercase-label" style={{ display: 'block', marginBottom: 4 }}>
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
                padding: '6px 10px',
                color: 'var(--fg)',
              }}
            />
          </div>
        )}

        {/* Cloudflare named tunnel — hostname is required for first-time setup */}
        {selectedProvider === 'cf-named' && (
          <div style={{ marginBottom: 8 }}>
            {tunnel?.namedTunnelHostname && (
              <div className="list-row" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="chip chip-ok">Configured</span>
                <span
                  title={tunnel.namedTunnelHostname}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}
                >
                  {tunnel.namedTunnelHostname}
                </span>
              </div>
            )}
            <label htmlFor="cf-named-hostname" className="uppercase-label" style={{ display: 'block', marginBottom: 4 }}>
              {tunnel?.namedTunnelHostname ? 'New Hostname (optional)' : 'Hostname'}
            </label>
            <input
              id="cf-named-hostname"
              type="text"
              placeholder={tunnel?.namedTunnelHostname ?? 'mcp.your-domain.com'}
              aria-describedby="cf-named-hostname-helper"
              value={namedHostnameInput}
              onChange={e => setNamedHostnameInput(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 10px',
                color: 'var(--fg)',
                marginBottom: 4,
              }}
            />
            <div id="cf-named-hostname-helper" style={{ fontSize: '0.7rem', color: 'var(--fg-subtle)' }}>
              {tunnel?.namedTunnelHostname
                ? <>Leave empty to reuse <strong>{tunnel.namedTunnelHostname}</strong>, or enter a different Cloudflare-managed hostname to reconfigure.</>
                : <>A domain you manage in Cloudflare (the tunnel gets a permanent URL there).
                   Required the first time — setup opens a one-time Cloudflare login in your browser.</>}
            </div>
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

      {/* MCP Config Snippets — D-06, D-07, D-08, D-12, D-13 */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Config Snippets</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="title">MCP Server</div>
            {tunnel?.status === 'active' && mcpActiveVariant === 'http' && (
              <span className="chip chip-ok" style={{ fontSize: '0.6rem' }}>via tunnel</span>
            )}
          </div>
          <div className="detail">Paste the server entry block into your IDE&apos;s MCP config file</div>
        </div>

        {/* Outer IDE tab bar — primary visual anchor (D-12) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
          {MCP_IDE_TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mcpActiveIde === tab.id}
              onClick={() => setMcpActiveIde(tab.id)}
              style={{
                padding: '8px 12px', fontSize: '0.7rem',
                fontWeight: mcpActiveIde === tab.id ? 600 : 500,
                color: mcpActiveIde === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${mcpActiveIde === tab.id ? 'var(--at-blue)' : 'transparent'}`,
                background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Inner variant sub-tab bar (D-13) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
          {MCP_VARIANT_TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mcpActiveVariant === tab.id}
              onClick={() => setMcpActiveVariant(tab.id as 'http' | 'stdio')}
              style={{
                padding: '4px 8px', fontSize: '0.7rem',
                fontWeight: mcpActiveVariant === tab.id ? 600 : 500,
                color: mcpActiveVariant === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${mcpActiveVariant === tab.id ? 'var(--at-blue)' : 'transparent'}`,
                background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Snippet code block — changes with active outer+inner tab */}
        <div role="tabpanel">
          {(() => {
            const snippetText = getMcpSnippet(mcpActiveIde, mcpActiveVariant, mcpHttpEndpoint);
            const copyKey = `mcp-${mcpActiveIde}-${mcpActiveVariant}`;
            return (
              <>
                <div style={{ position: 'relative' }}>
                  <pre style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)', padding: '8px 12px',
                    fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.5,
                    color: 'var(--fg)', overflowX: 'auto', whiteSpace: 'pre', margin: 0,
                  }}>
                    <code>{snippetText}</code>
                  </pre>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopySnippet(snippetText, copyKey)}
                    aria-label={`Copy ${mcpActiveIde} ${mcpActiveVariant} snippet`}
                    style={{ position: 'absolute', top: 8, right: 8 }}
                  >
                    {copiedKeys[copyKey] ? 'Copied!' : 'Copy snippet'}
                  </button>
                </div>
                {mcpActiveVariant === 'http' && (
                  <div className="list-row" style={{ marginTop: 8, alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', flex: 1 }}>
                      Replace <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', background: 'var(--bg-input)', padding: '1px 4px', borderRadius: 3 }}>{'{'}{'{'}'BEARER_TOKEN{'}'}{'}'}</code> with your daemon token — the access password the daemon generates so only your own tools can call it
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleCopyToken}
                      disabled={!daemon?.running}
                      title={daemon?.running ? 'Copy bearer token to clipboard (token never leaves the extension host)' : 'Start the daemon first'}
                      style={{ opacity: daemon?.running ? 1 : 0.4, whiteSpace: 'nowrap' }}
                    >
                      {copiedToken ? 'Copied!' : 'Copy Token'}
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* LSP Config Snippets — D-09, D-10, D-12, D-13 */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Config Snippets</div>
          <div className="title">LSP Server</div>
          <div className="detail">Paste into your editor&apos;s LSP config to enable Airtable formula intelligence</div>
        </div>

        {/* Outer IDE tab bar — primary visual anchor (D-12) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
          {LSP_IDE_TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={lspActiveIde === tab.id}
              onClick={() => setLspActiveIde(tab.id)}
              style={{
                padding: '8px 12px', fontSize: '0.7rem',
                fontWeight: lspActiveIde === tab.id ? 600 : 500,
                color: lspActiveIde === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${lspActiveIde === tab.id ? 'var(--at-blue)' : 'transparent'}`,
                background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Inner variant sub-tab bar (D-13) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
          {LSP_VARIANT_TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={lspActiveVariant === tab.id}
              onClick={() => setLspActiveVariant(tab.id as 'tcp' | 'stdio')}
              style={{
                padding: '4px 8px', fontSize: '0.7rem',
                fontWeight: lspActiveVariant === tab.id ? 600 : 500,
                color: lspActiveVariant === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${lspActiveVariant === tab.id ? 'var(--at-blue)' : 'transparent'}`,
                background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Snippet code block — changes with active outer+inner tab */}
        <div role="tabpanel">
          {(() => {
            const snippetText = getLspSnippet(lspActiveIde, lspActiveVariant, lspPort);
            const copyKey = `lsp-${lspActiveIde}-${lspActiveVariant}`;
            return (
              <div style={{ position: 'relative' }}>
                <pre style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', padding: '8px 12px',
                  fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.5,
                  color: 'var(--fg)', overflowX: 'auto', whiteSpace: 'pre', margin: 0,
                }}>
                  <code>{snippetText}</code>
                </pre>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleCopySnippet(snippetText, copyKey)}
                  aria-label={`Copy ${lspActiveIde} ${lspActiveVariant} snippet`}
                  style={{ position: 'absolute', top: 8, right: 8 }}
                >
                  {copiedKeys[copyKey] ? 'Copied!' : 'Copy snippet'}
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Official Airtable MCP — https://mcp.airtable.com/mcp */}
      <div className="glass-panel">
        <div className="section-header">
          <div className="eyebrow">Official Integration</div>
          <div className="title">Airtable Cloud MCP</div>
          <div className="detail">
            The official Airtable MCP provides core data operations via airtable.com.
            Our MCP adds user-session tools the official one lacks — install both for full coverage.
          </div>
        </div>

        {/* PAT status chip */}
        <div style={{ marginBottom: 8 }}>
          {officialAirtable?.patSet
            ? <span className="chip chip-ok">PAT saved</span>
            : <span className="chip chip-muted">No PAT</span>}
        </div>

        {/* PAT input */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="airtable-pat" className="uppercase-label" style={{ display: 'block', marginBottom: 4 }}>
            Personal Access Token
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              id="airtable-pat"
              type="password"
              placeholder={officialAirtable?.patSet ? '••••••••••••••••••••••••••' : 'patXXXXXXXXXXXXXX.xxxxxxxxxxxxxxx'}
              value={patInput}
              onChange={e => setPatInput(e.target.value)}
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '6px 10px',
                color: 'var(--fg)',
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { if (patInput) { saveAirtablePat(patInput); setPatInput(''); } }}
              disabled={!patInput || isLoading}
            >
              {officialAirtable?.patSet ? 'Update' : 'Save'}
            </button>
            {officialAirtable?.patSet && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleCopyPat}
                disabled={isLoading}
                title="Copy saved PAT to clipboard"
              >
                {copiedPat ? 'Copied!' : 'Copy PAT'}
              </button>
            )}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', marginTop: 4 }}>
            Create a PAT at <strong>airtable.com → Account → Developer hub</strong>. Stored securely in VS Code SecretStorage.
          </div>
        </div>

        {/* Per-IDE configure rows — only detected MCP-capable IDEs */}
        {(() => {
          const detectedOfficial = OFFICIAL_MCP_IDES.filter(ide =>
            ideStatuses.find(s => s.ideId === ide.id && s.detected)
          );
          if (detectedOfficial.length === 0) return null;
          return (
            <div style={{ marginBottom: 12 }}>
              <div className="uppercase-label" style={{ color: 'var(--fg-muted)', marginBottom: 6 }}>
                Detected IDEs
              </div>
              <div className="stack stack-sm">
                {detectedOfficial.map(ide => {
                  const configured = officialAirtable?.ideConfigured[ide.id as import('@shared/types.js').IdeId] ?? false;
                  return (
                    <div key={ide.id} className="list-row" style={{ alignItems: 'center' }}>
                      <span style={{ flex: 1, fontSize: '0.78rem' }}>{ide.label}</span>
                      {configured
                        ? <span className="chip chip-ok" style={{ fontSize: '0.62rem' }}>Configured</span>
                        : <span className="chip chip-muted" style={{ fontSize: '0.62rem' }}>Not configured</span>}
                      {configured ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => unconfigureOfficialAirtable(ide.id as import('@shared/types.js').IdeId)}
                          disabled={isLoading}
                          style={{ marginLeft: 8, color: 'var(--fg-err)' }}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => configureOfficialAirtable(ide.id as import('@shared/types.js').IdeId)}
                          disabled={isLoading || !officialAirtable?.patSet}
                          title={!officialAirtable?.patSet ? 'Save your PAT first' : undefined}
                          style={{ marginLeft: 8, opacity: !officialAirtable?.patSet ? 0.5 : 1 }}
                        >
                          Configure
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Official Airtable MCP snippet */}
        <div>
          <div className="uppercase-label" style={{ color: 'var(--fg-muted)', marginBottom: 6 }}>
            Config Snippet
          </div>

          {/* IDE tab bar for official snippet */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
            {OFFICIAL_MCP_IDES.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={officialSnippetIde === tab.id}
                onClick={() => setOfficialSnippetIde(tab.id)}
                style={{
                  padding: '4px 8px', fontSize: '0.7rem',
                  fontWeight: officialSnippetIde === tab.id ? 600 : 500,
                  color: officialSnippetIde === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
                  borderBottom: `2px solid ${officialSnippetIde === tab.id ? 'var(--at-blue)' : 'transparent'}`,
                  background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
                  cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
                  transition: 'color 120ms ease, border-color 120ms ease',
                }}
              >{tab.label}</button>
            ))}
          </div>

          {(() => {
            const snippetText = getOfficialAirtableSnippet(officialSnippetIde);
            const copyKey = `official-${officialSnippetIde}`;
            return (
              <>
                <div style={{ position: 'relative' }}>
                  <pre style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)', padding: '8px 12px',
                    fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.5,
                    color: 'var(--fg)', overflowX: 'auto', whiteSpace: 'pre', margin: 0,
                  }}>
                    <code>{snippetText}</code>
                  </pre>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopySnippet(snippetText, copyKey)}
                    style={{ position: 'absolute', top: 8, right: 8 }}
                  >
                    {copiedKeys[copyKey] ? 'Copied!' : 'Copy snippet'}
                  </button>
                </div>
                <div className="list-row" style={{ marginTop: 6, alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', flex: 1 }}>
                    Replace <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', background: 'var(--bg-input)', padding: '1px 4px', borderRadius: 3 }}>{'{'}{'{'}'AIRTABLE_PAT{'}'}{'}'}</code> with your token
                  </span>
                  {officialAirtable?.patSet && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleCopyPat}
                      title="Copy saved PAT to clipboard"
                    >
                      {copiedPat ? 'Copied!' : 'Copy PAT'}
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </div>

    </section>
  );
}
