import React from 'react';
import type { IdeId, IdeStatus } from '@shared/types.js';
import { Pill } from './Pill.js';
import { IdeIcon } from './IdeIcon.js';

// Install / docs URL per supported IDE, shown on undetected cards so the user
// knows where to go. Kept local because it's presentation-only state.
const IDE_DOCS_URL: Record<IdeId, string> = {
  'cursor':         'https://cursor.com/download',
  'windsurf':       'https://windsurf.com/download',
  'windsurf-next':  'https://windsurf.com/download',
  'claude-code':    'https://docs.claude.com/en/docs/claude-code/quickstart',
  'claude-desktop': 'https://claude.ai/download',
  'cline':          'https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev',
  'amp':            'https://ampcode.com/',
};

interface IdeCardProps { status: IdeStatus; onSetup: () => void; onUnconfigure: () => void; loading: boolean; }

export function IdeCard({ status, onSetup, onUnconfigure, loading }: IdeCardProps) {
  const allReady = status.mcpConfigured && Object.values(status.aiFiles).every(s => s === 'ok');

  const chipClass = !status.detected
    ? 'chip chip-muted'
    : allReady
      ? 'chip chip-ok'
      : status.mcpConfigured
        ? 'chip chip-warn'
        : 'chip chip-err';

  const chipLabel = !status.detected
    ? 'Not detected'
    : allReady
      ? 'All set'
      : status.mcpConfigured
        ? 'Partial'
        : 'Needs setup';

  const cardClass = [
    'ide-card',
    allReady ? 'ide-card-ready' : '',
    !status.detected ? 'ide-card-undetected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IdeIcon ideId={status.ideId} size={18} color={status.detected ? 'var(--fg)' : 'var(--fg-muted)'} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, flex: 1 }}>{status.label}</span>
        {status.version && (
          <span style={{ fontSize: '0.6rem', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{status.version}</span>
        )}
        <span className={chipClass}>{chipLabel}</span>
      </div>

      {/* Body — only for detected IDEs */}
      {status.detected && (
        <>
          {/* MCP status row */}
          <div className="list-row">
            <IdeIcon ideId="mcp" size={13} color={status.mcpConfigured ? 'var(--fg-info)' : 'var(--fg-err)'} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: status.mcpConfigured ? 'var(--fg-info)' : 'var(--fg-err)', flex: 1 }}>
              MCP {status.mcpConfigured ? 'configured' : 'not configured'}
            </span>
            <span className={status.mcpConfigured ? 'chip chip-ok chip' : 'chip chip-err'} style={{ fontSize: '0.6rem' }}>
              {status.mcpConfigured ? 'ready' : 'missing'}
            </span>
          </div>

          {/* Stale-path warning */}
          {status.mcpConfigured && status.mcpServerHealthy === false && (
            <div className="list-row" style={{ background: 'rgba(255,186,5,0.08)', border: '1px solid rgba(255,186,5,0.22)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--fg-warn)' }}>⚠ Server path missing — click Update</span>
            </div>
          )}

          {/* AI files row */}
          <div className="list-row" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--fg-ai)', fontWeight: 600 }}>AI files</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 'auto' }}>
              <Pill label="skills" status={status.aiFiles.skills} />
              <Pill label="rules" status={status.aiFiles.rules} />
              <Pill label="workflows" status={status.aiFiles.workflows} />
              <Pill label="agents" status={status.aiFiles.agents} />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 2 }}>
            {!status.mcpConfigured ? (
              <button className="btn btn-primary btn-sm" onClick={onSetup} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Setting up...' : 'Setup'}
              </button>
            ) : (
              <>
                {allReady && <span className="chip chip-ok" style={{ fontSize: '0.62rem' }}>All set</span>}
                <button className="btn btn-primary btn-sm" onClick={onSetup} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
                  {loading ? 'Updating...' : 'Update'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={onUnconfigure} disabled={loading} style={{ opacity: loading ? 0.6 : 1, color: 'var(--fg-err)' }}>
                  Remove
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Not detected — docs link */}
      {!status.detected && IDE_DOCS_URL[status.ideId] && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <a
            className="btn btn-ghost btn-sm"
            href={IDE_DOCS_URL[status.ideId]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            Docs
          </a>
        </div>
      )}
    </div>
  );
}
