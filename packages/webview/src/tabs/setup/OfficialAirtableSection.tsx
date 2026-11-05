import React from 'react';
import type { IdeId } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Disclosure } from '../../components/Disclosure.js';
import { FormField } from '../../components/FormField.js';
import { SnippetCard } from '../../components/SnippetCard.js';
import { StatusDot } from '../../components/StatusDot.js';
import { copyText } from '../../lib/clipboard.js';
import { useFlash } from '../../lib/useFlash.js';
import { useStore } from '../../store.js';
import { getOfficialAirtableSnippet } from './snippets.js';

// Editors that accept the official Airtable HTTP MCP (those with an mcpServers key; not Codex CLI).
const OFFICIAL_CLIENTS: ReadonlyArray<{ id: IdeId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Devin Desktop (Windsurf)' },
  { id: 'windsurf-next', label: 'Devin Desktop Next (Windsurf Next)' },
  { id: 'cline', label: 'Cline' },
  { id: 'amp', label: 'Amp' },
  { id: 'opencode', label: 'OpenCode' },
];

export function OfficialAirtableSection() {
  const official = useStore(s => s.officialAirtable);
  const ideStatuses = useStore(s => s.ideStatuses);
  const pending = useStore(s => s.pendingOfficialActions.size > 0);
  const saveAirtablePat = useStore(s => s.saveAirtablePat);
  const copyAirtablePat = useStore(s => s.copyAirtablePat);
  const configureOfficialAirtable = useStore(s => s.configureOfficialAirtable);
  const unconfigureOfficialAirtable = useStore(s => s.unconfigureOfficialAirtable);

  const [pat, setPat] = React.useState('');
  const [snippetClient, setSnippetClient] = React.useState<IdeId>('claude-code');
  const [copiedPat, flashCopiedPat] = useFlash(1500);

  const patSet = !!official?.patSet;
  const detected = OFFICIAL_CLIENTS.filter(c => ideStatuses.some(s => s.ideId === c.id && s.detected));
  const configuredAnywhere = Object.values(official?.ideConfigured ?? {}).some(Boolean);
  const configuredHere = detected.some(c => official?.ideConfigured[c.id]);
  // An issue is a half-finished setup: an editor points at the official server
  // with no token to authenticate, or a token is saved but nothing uses it.
  // Never having opted in is not an issue, so that case stays collapsed.
  const needsAttention = (!patSet && configuredAnywhere) || (patSet && detected.length > 0 && !configuredHere);

  const savePat = () => {
    if (!pat) return;
    saveAirtablePat(pat);
    setPat('');
  };

  return (
    <Disclosure
      id="official-airtable"
      title="Official Airtable MCP"
      forceOpen={needsAttention}
      summary={
        <span className="service-status">
          <StatusDot variant={patSet ? 'ok' : 'off'} />
          <span>{patSet ? 'Token saved' : 'No token'}</span>
        </span>
      }
    >
      <p className="section-description">
        The official Airtable MCP covers core data operations through airtable.com. Ours adds
        user-session tools it lacks, so the two complement each other. Install both for full coverage.
      </p>

      <div className="form-stack" aria-busy={pending || undefined}>
        <FormField
          label="Personal access token"
          description="Create one at airtable.com, under Account, then Developer hub. It is stored in VS Code SecretStorage and never shown here."
        >
          {control => (
            <div className="form-row">
              <input
                {...control}
                className="form-control form-control--mono"
                type="password"
                autoComplete="off"
                placeholder="Paste a new token"
                value={pat}
                onChange={e => setPat(e.target.value)}
              />
              <ActionButton variant="primary" pending={pending} disabled={!pat} onClick={savePat}>
                {patSet ? 'Update token' : 'Save token'}
              </ActionButton>
              {patSet && (
                <ActionButton
                  pending={pending}
                  onClick={() => { copyAirtablePat(); flashCopiedPat(); }}
                >
                  Copy saved token
                </ActionButton>
              )}
            </div>
          )}
        </FormField>
        {copiedPat && <span className="service-flash" role="status">Token copied</span>}

        {detected.length > 0 && (
          <ul className="official-editors" aria-label="Detected editors">
            {detected.map(client => {
              const configured = !!official?.ideConfigured[client.id];
              return (
                <li key={client.id} className="official-editor">
                  <span className="official-editor__name">{client.label}</span>
                  <span className="official-editor__state">
                    <StatusDot variant={configured ? 'ok' : 'off'} />
                    <span>{configured ? 'Configured' : 'Not configured'}</span>
                  </span>
                  {configured ? (
                    <ActionButton
                      variant="danger"
                      aria-label={`Remove ${client.label}`}
                      pending={pending}
                      onClick={() => unconfigureOfficialAirtable(client.id)}
                    >
                      Remove
                    </ActionButton>
                  ) : (
                    <ActionButton
                      variant="primary"
                      aria-label={`Configure ${client.label}`}
                      pending={pending}
                      disabled={!patSet}
                      onClick={() => configureOfficialAirtable(client.id)}
                    >
                      Configure
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {detected.length > 0 && !patSet && (
          <p className="service-note">Save your token first; Configure writes it into each editor.</p>
        )}

        <div className="form-row form-row--fields">
          <FormField label="Client">
            {control => (
              <select
                {...control}
                className="form-control"
                value={snippetClient}
                onChange={e => setSnippetClient(e.target.value as IdeId)}
              >
                {OFFICIAL_CLIENTS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </FormField>
        </div>
        <SnippetCard
          key={snippetClient}
          text={getOfficialAirtableSnippet(snippetClient)}
          language="JSON"
          onCopy={copyText}
        />
        <p className="service-note">
          Replace <code>{'{{AIRTABLE_PAT}}'}</code> with your token. Use Copy saved token above; the
          value never appears on this page.
        </p>
      </div>
    </Disclosure>
  );
}
