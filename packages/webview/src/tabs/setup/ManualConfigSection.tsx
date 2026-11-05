import React from 'react';
import { Disclosure } from '../../components/Disclosure.js';
import { FormField } from '../../components/FormField.js';
import { SnippetCard } from '../../components/SnippetCard.js';
import { copyText } from '../../lib/clipboard.js';
import { useStore } from '../../store.js';
import {
  getLspSnippet,
  getMcpSnippet,
  type LspSnippetVariant,
  type McpSnippetVariant,
} from './snippets.js';

const MCP_CLIENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Devin Desktop (Windsurf)' },
  { id: 'cline', label: 'Cline' },
] as const;

const MCP_PROTOCOLS: ReadonlyArray<{ id: McpSnippetVariant; label: string }> = [
  { id: 'http', label: 'HTTP (daemon)' },
  { id: 'stdio', label: 'stdio (npx)' },
];

const LSP_CLIENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'zed', label: 'Zed' },
  { id: 'neovim', label: 'Neovim' },
] as const;

const LSP_PROTOCOLS: ReadonlyArray<{ id: LspSnippetVariant; label: string }> = [
  { id: 'tcp', label: 'TCP (daemon)' },
  { id: 'stdio', label: 'stdio' },
];

type Panel = 'mcp' | 'lsp' | null;

interface Option<T extends string> { id: T; label: string }

function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label}>
      {control => (
        <select {...control} className="form-control" value={value} onChange={e => onChange(e.target.value as T)}>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
    </FormField>
  );
}

function McpPanel() {
  const daemon = useStore(s => s.daemon);
  const tunnel = useStore(s => s.tunnel);
  const [client, setClient] = React.useState<string>('claude-code');
  const [protocol, setProtocol] = React.useState<McpSnippetVariant>('http');

  // An active tunnel makes the public URL the right endpoint for HTTP snippets.
  const viaTunnel = protocol === 'http' && tunnel?.status === 'active' && !!tunnel.url;
  const endpoint = viaTunnel && tunnel?.url ? tunnel.url : daemon?.port ?? '{MCP_PORT}';
  const text = getMcpSnippet(client, protocol, endpoint);

  return (
    <>
      <p className="section-description">
        Paste the server entry into your editor&apos;s MCP configuration file.
        {viaTunnel && <> <span className="pill" data-status="ok">via tunnel</span></>}
      </p>
      <div className="form-row form-row--fields">
        <SelectField label="Client" value={client} options={MCP_CLIENTS} onChange={setClient} />
        <SelectField label="Protocol" value={protocol} options={MCP_PROTOCOLS} onChange={setProtocol} />
      </div>
      <SnippetCard key={`${client}-${protocol}`} text={text} language="JSON" onCopy={copyText} />
      {protocol === 'http' && (
        <p className="service-note">
          Replace <code>{'{{BEARER_TOKEN}}'}</code> with your service token. Copy it from Local
          service, under Safety; the token never appears on this page.
        </p>
      )}
    </>
  );
}

function LspPanel() {
  const daemon = useStore(s => s.daemon);
  const [client, setClient] = React.useState<string>('claude-code');
  const [protocol, setProtocol] = React.useState<LspSnippetVariant>('tcp');

  const text = getLspSnippet(client, protocol, daemon?.port_lsp ?? '{LSP_PORT}');

  return (
    <>
      <p className="section-description">
        Paste into your editor&apos;s language server configuration to get Airtable formula intelligence.
      </p>
      <div className="form-row form-row--fields">
        <SelectField label="Client" value={client} options={LSP_CLIENTS} onChange={setClient} />
        <SelectField label="Protocol" value={protocol} options={LSP_PROTOCOLS} onChange={setProtocol} />
      </div>
      <SnippetCard
        key={`${client}-${protocol}`}
        text={text}
        language={client === 'neovim' ? 'Lua' : 'JSON'}
        onCopy={copyText}
      />
    </>
  );
}

export function ManualConfigSection() {
  // One snippet at a time: opening one nested panel closes the other.
  const [panel, setPanel] = React.useState<Panel>(null);
  const select = (next: Exclude<Panel, null>) => (open: boolean) => setPanel(open ? next : null);

  return (
    <Disclosure id="manual-config" title="Manual configuration">
      <p className="section-description">
        For editors Setup cannot configure automatically, copy a snippet and paste it yourself.
      </p>
      <div className="form-stack">
        <Disclosure id="manual-mcp" title="MCP server" level={3} open={panel === 'mcp'} onOpenChange={select('mcp')}>
          <McpPanel />
        </Disclosure>
        <Disclosure id="manual-lsp" title="LSP server" level={3} open={panel === 'lsp'} onOpenChange={select('lsp')}>
          <LspPanel />
        </Disclosure>
      </div>
    </Disclosure>
  );
}
