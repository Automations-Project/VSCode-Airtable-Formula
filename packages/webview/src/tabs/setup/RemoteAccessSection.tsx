import React from 'react';
import type { TunnelAutoDisabledReason, TunnelProviderId, TunnelStatus } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Disclosure } from '../../components/Disclosure.js';
import { Feedback } from '../../components/Feedback.js';
import { FormField } from '../../components/FormField.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { StatusDot, type DotVariant } from '../../components/StatusDot.js';
import { copyText } from '../../lib/clipboard.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useFlash } from '../../lib/useFlash.js';
import { useFocusFallback } from '../../lib/useFocusFallback.js';
import { useStore } from '../../store.js';

const PROVIDERS: ReadonlyArray<{ id: TunnelProviderId; label: string }> = [
  { id: 'cf-quick', label: 'Cloudflare Quick Tunnel' },
  { id: 'ngrok', label: 'ngrok' },
  { id: 'cf-named', label: 'Cloudflare Named Tunnel' },
];

const STATUS: Record<TunnelStatus, { text: string; dot: DotVariant }> = {
  disabled: { text: 'Disabled', dot: 'off' },
  starting: { text: 'Starting', dot: 'info' },
  active: { text: 'Active', dot: 'ok' },
  'auto-disabled': { text: 'Auto-disabled', dot: 'warn' },
  error: { text: 'Error', dot: 'err' },
};

/** Why the tripwire fired. The host may not report a window; never print "in 0s". */
function autoDisabledCause(reason: TunnelAutoDisabledReason | null | undefined): string {
  if (!reason) return 'repeated auth failures';
  const from = reason.ip ? ` from ${reason.ip}` : '';
  const within = reason.windowMs > 0 ? ` in ${reason.windowMs / 1000}s` : '';
  return `${reason.failures} auth failures${from}${within}`;
}

export function RemoteAccessSection() {
  const tunnel = useStore(s => s.tunnel);
  const daemon = useStore(s => s.daemon);
  const pending = useStore(s => s.pendingTunnelActions.size > 0);
  const enableTunnel = useStore(s => s.enableTunnel);
  const disableTunnel = useStore(s => s.disableTunnel);
  const setNgrokAuthtoken = useStore(s => s.setNgrokAuthtoken);

  const [provider, setProvider] = React.useState<TunnelProviderId>(tunnel?.provider ?? 'cf-quick');
  const [ngrokToken, setNgrokToken] = React.useState('');
  const [ngrokDomain, setNgrokDomain] = React.useState('');
  const [namedHostname, setNamedHostname] = React.useState('');
  const [replacingToken, setReplacingToken] = React.useState(false);
  const [copiedUrl, flashCopiedUrl] = useFlash(1500);

  // The tunnel snapshot can arrive after first render; adopt its provider once.
  const adoptedProvider = React.useRef(tunnel?.provider !== undefined);
  React.useEffect(() => {
    if (!adoptedProvider.current && tunnel?.provider) {
      adoptedProvider.current = true;
      setProvider(tunnel.provider);
    }
  }, [tunnel?.provider]);

  const status = tunnel?.status ?? 'disabled';
  const live = status === 'active' || status === 'starting';
  const serviceReady = !!daemon?.running && !!daemon.healthy;
  const locked = live || pending || !serviceReady;
  // Auto-disabled is a note, not a repair: it does not force the section open.
  const needsAttention = live || status === 'error';
  const namedHost = tunnel?.namedTunnelHostname ?? null;
  const summary = STATUS[status];

  const [tunnelAction, setTunnelAction] = React.useState<{ id: string | null; kind: 'enable' | 'disable' }>({ id: null, kind: 'enable' });
  const [tokenActionId, setTokenActionId] = React.useState<string | null>(null);
  const tunnelOutcome = useActionOutcome(tunnelAction.id);
  const tokenOutcome = useActionOutcome(tokenActionId);
  // Save and Cancel close the replace form; focus returns to Replace token.
  const replaceButton = React.useRef<HTMLButtonElement>(null);
  const replaceFormFallback = useFocusFallback<HTMLDivElement>(() => replaceButton.current);

  // A typed token leaves this component only once the host confirms it was
  // stored; a failure keeps it so nothing has to be pasted again.
  React.useEffect(() => {
    if (tunnelOutcome.outcome?.ok && tunnelAction.kind === 'enable') setNgrokToken('');
  }, [tunnelOutcome.outcome, tunnelAction.kind]);
  React.useEffect(() => {
    if (!tokenOutcome.outcome?.ok) return;
    setNgrokToken('');
    setReplacingToken(false);
  }, [tokenOutcome.outcome]);

  const runTunnel = (kind: 'enable' | 'disable', start: () => string | null) => {
    tunnelOutcome.clearOutcome();
    tokenOutcome.clearOutcome();
    setTunnelAction({ id: start(), kind });
  };

  const enable = () => {
    // The token travels with the enable request so the host stores and uses it
    // atomically; no race with a separate set-token message.
    const authtoken = provider === 'ngrok' && ngrokToken ? ngrokToken : undefined;
    const domain =
      provider === 'cf-named' ? namedHostname.trim() || undefined
      : provider === 'ngrok' ? ngrokDomain.trim() || undefined
      : undefined;
    runTunnel('enable', () => enableTunnel(provider, authtoken, domain));
  };

  const saveToken = () => {
    tunnelOutcome.clearOutcome();
    tokenOutcome.clearOutcome();
    setTokenActionId(setNgrokAuthtoken(ngrokToken.trim()));
  };

  return (
    <Disclosure
      id="remote-access"
      title="Remote access"
      forceOpen={needsAttention}
      summary={
        <span className="service-status" role="status">
          <StatusDot variant={summary.dot} />
          <span>{summary.text}</span>
        </span>
      }
    >
      <p className="section-description">
        Share this MCP service over a public HTTPS URL so a client on another machine can reach it.
      </p>

      {!serviceReady && (
        <Feedback variant="warning">
          Remote access needs the local service to be running and healthy. Start it in Local
          service above first.
        </Feedback>
      )}

      {status === 'error' && (
        <Feedback variant="error">
          Remote access could not start. Check the Airtable Formula output channel for the cause,
          then try again.
        </Feedback>
      )}

      {/* Status, not alert: a standing condition must not be re-announced on every visit. */}
      {status === 'auto-disabled' && (
        <Feedback variant="info">
          Remote access was turned off after {autoDisabledCause(tunnel?.autoDisabledReason)}.
          Enable it again when you are ready.
        </Feedback>
      )}

      <div className="form-stack" aria-busy={pending || undefined}>
        <FormField label="Tunnel provider">
          {control => (
            <select
              {...control}
              className="form-control"
              value={provider}
              disabled={locked}
              onChange={e => setProvider(e.target.value as TunnelProviderId)}
            >
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </FormField>

        {provider === 'ngrok' && (
          <>
            {tunnel?.ngrokAuthtokenSet && !replacingToken ? (
              <div className="form-row">
                <span className="form-status">
                  <StatusDot variant="ok" />
                  <span>Auth token stored</span>
                </span>
                <ActionButton ref={replaceButton} disabled={locked} onClick={() => setReplacingToken(true)}>
                  Replace token
                </ActionButton>
              </div>
            ) : (
              <>
                <FormField
                  label="ngrok auth token"
                  description="Stored in VS Code SecretStorage. ngrok tunnels must be enabled again after the service restarts, because the service cannot read that storage at startup."
                >
                  {control => (
                    <input
                      {...control}
                      className="form-control form-control--mono"
                      type="password"
                      autoComplete="off"
                      placeholder="Paste token from the ngrok dashboard"
                      value={ngrokToken}
                      disabled={locked}
                      // Replace token unmounts as the field appears: the field takes its focus.
                      autoFocus={replacingToken}
                      onChange={e => setNgrokToken(e.target.value)}
                    />
                  )}
                </FormField>
                {replacingToken && (
                  <div ref={replaceFormFallback} className="form-actions">
                    <ActionButton variant="primary" pending={pending} disabled={!ngrokToken.trim()} onClick={saveToken}>
                      Save token
                    </ActionButton>
                    <ActionButton
                      onClick={() => { setNgrokToken(''); setReplacingToken(false); tokenOutcome.clearOutcome(); }}
                    >
                      Cancel
                    </ActionButton>
                  </div>
                )}
              </>
            )}
            {/* Mounted outside the replace form, which closes when the save succeeds. */}
            <OutcomeFeedback
              outcome={tokenOutcome.outcome}
              successMessage="ngrok token saved."
              failureMessage="The ngrok token was not saved. It is still in the field."
            />
            <FormField label="Reserved domain (optional)">
              {control => (
                <input
                  {...control}
                  className="form-control form-control--mono"
                  type="text"
                  autoComplete="off"
                  placeholder="yourname.ngrok-free.app"
                  value={ngrokDomain}
                  disabled={locked}
                  onChange={e => setNgrokDomain(e.target.value)}
                />
              )}
            </FormField>
          </>
        )}

        {provider === 'cf-named' && (
          <>
            {namedHost && (
              <div className="form-row">
                <span className="form-status">
                  <StatusDot variant="ok" />
                  <span>Configured</span>
                </span>
                <code className="form-value" title={namedHost}>{namedHost}</code>
              </div>
            )}
            <FormField
              label={namedHost ? 'New hostname (optional)' : 'Hostname'}
              required={!namedHost}
              description={namedHost
                ? <>Leave empty to reuse <strong>{namedHost}</strong>, or enter a different Cloudflare-managed hostname to reconfigure.</>
                : 'A domain you manage in Cloudflare; the tunnel gets a permanent URL there. Required the first time. Setup opens a one-time Cloudflare login in your browser.'}
            >
              {control => (
                <input
                  {...control}
                  className="form-control form-control--mono"
                  type="text"
                  autoComplete="off"
                  placeholder={namedHost ?? 'mcp.your-domain.com'}
                  value={namedHostname}
                  disabled={locked}
                  onChange={e => setNamedHostname(e.target.value)}
                />
              )}
            </FormField>
          </>
        )}

        {tunnel?.url && (
          <div className="form-row">
            <code className="form-value" title={tunnel.url}>{tunnel.url}</code>
            <ActionButton
              aria-label="Copy remote access URL"
              onClick={() => {
                if (!tunnel.url) return;
                void copyText(tunnel.url).then(ok => { if (ok) flashCopiedUrl(); });
              }}
            >
              Copy
            </ActionButton>
            {copiedUrl && <span className="service-flash" role="status">URL copied</span>}
          </div>
        )}

        <div className="form-actions">
          {live ? (
            <ActionButton pending={pending} onClick={() => runTunnel('disable', disableTunnel)}>
              Disable remote access
            </ActionButton>
          ) : (
            <ActionButton variant="primary" pending={pending} disabled={!serviceReady} onClick={enable}>
              Enable remote access
            </ActionButton>
          )}
        </div>
        <OutcomeFeedback
          outcome={tunnelOutcome.outcome}
          successMessage={tunnelAction.kind === 'enable' ? 'Remote access enabled.' : 'Remote access disabled.'}
          failureMessage={tunnelAction.kind === 'enable'
            ? 'Remote access could not be enabled.'
            : 'Remote access could not be disabled.'}
        />
      </div>
    </Disclosure>
  );
}
