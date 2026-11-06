import React from 'react';
import { ActionButton } from '../../components/ActionButton.js';
import { Feedback } from '../../components/Feedback.js';
import { Section } from '../../components/Section.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { StatusDot, type DotVariant } from '../../components/StatusDot.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useFlash } from '../../lib/useFlash.js';
import { useFocusFallback } from '../../lib/useFocusFallback.js';
import { useStore } from '../../store.js';
import { formatUptime } from './snippets.js';

interface ServiceStatus {
  text: string;
  dot: DotVariant;
}

type LifecycleKind = 'start' | 'restart' | 'stop';
type TokenKind = 'copy' | 'rotate';

// Start and restart are accepted by the host before the service is up; the
// status line above reports when it actually is.
const LIFECYCLE_DONE: Record<LifecycleKind, string> = {
  start: 'Service start requested.',
  restart: 'Service restart requested.',
  stop: 'Service stopped.',
};

const TOKEN_DONE: Record<TokenKind, string> = {
  copy: 'Token copied to the clipboard.',
  rotate: 'Token rotated. Connected clients need the new token.',
};

export function LocalServiceSection() {
  const useDaemon = useStore(s => s.settings.mcp.useDaemon);
  const daemon = useStore(s => s.daemon);
  const pendingDaemonActions = useStore(s => s.pendingDaemonActions);
  const startDaemon = useStore(s => s.startDaemon);
  const stopDaemon = useStore(s => s.stopDaemon);
  const restartDaemon = useStore(s => s.restartDaemon);
  const copyBearerToken = useStore(s => s.copyBearerToken);
  const rotateToken = useStore(s => s.rotateToken);

  const [copiedUrl, flashCopiedUrl] = useFlash(1500);
  const [lifecycle, setLifecycle] = React.useState<{ id: string | null; kind: LifecycleKind }>({ id: null, kind: 'start' });
  const [tokenAction, setTokenAction] = React.useState<{ id: string | null; kind: TokenKind }>({ id: null, kind: 'copy' });
  const lifecycleOutcome = useActionOutcome(lifecycle.id);
  const tokenOutcome = useActionOutcome(tokenAction.id);
  // Start and Restart are one slot (one node, the label changes); when Stop
  // goes away with the service, focus lands on that slot.
  const lifecycleSlot = React.useRef<HTMLButtonElement>(null);
  const stopFallback = useFocusFallback<HTMLButtonElement>(() => lifecycleSlot.current);

  const runLifecycle = (kind: LifecycleKind, start: () => string | null) => {
    lifecycleOutcome.clearOutcome();
    setLifecycle({ id: start(), kind });
  };
  const runToken = (kind: TokenKind, start: () => string | null) => {
    tokenOutcome.clearOutcome();
    setTokenAction({ id: start(), kind });
  };

  if (!useDaemon) {
    return (
      <Section
        id="local-service"
        title="Local service"
        description="Each editor starts its own Airtable MCP process, so there is no shared service to manage."
      >
        <p className="service-status" role="status">
          <StatusDot variant="info" />
          <span>Direct stdio mode</span>
        </p>
        <p className="service-note">
          In this mode each client owns its own process and browser session. Enable the
          airtableFormula.mcp.useDaemon setting to run one shared service for every editor.
        </p>
      </Section>
    );
  }

  // Daemon controls disable on daemon-specific pending state only: an unrelated
  // slow action must not lock the user out of stopping the service.
  const busy = pendingDaemonActions.size > 0 || !!daemon?.starting;
  const running = !!daemon?.running;
  const unhealthy = running && !daemon?.healthy;

  const status: ServiceStatus = daemon?.starting
    ? { text: 'Starting…', dot: 'info' }
    : running
      ? daemon?.healthy
        ? { text: 'Running and healthy', dot: 'ok' }
        : { text: 'Running, not healthy', dot: 'warn' }
      : { text: 'Stopped', dot: 'off' };

  return (
    <Section
      id="local-service"
      title="Local service"
      description="One shared MCP and language server that your editors connect to."
      busy={busy}
      actions={(
        <>
          <ActionButton
            ref={lifecycleSlot}
            variant={running ? 'secondary' : 'primary'}
            pending={busy}
            onClick={() => (running ? runLifecycle('restart', restartDaemon) : runLifecycle('start', startDaemon))}
          >
            {running ? 'Restart service' : 'Start service'}
          </ActionButton>
          {running && (
            <ActionButton ref={stopFallback} variant="danger" pending={busy} onClick={() => runLifecycle('stop', stopDaemon)}>
              Stop service
            </ActionButton>
          )}
        </>
      )}
    >
      <p className="service-status" role="status">
        <StatusDot variant={status.dot} />
        <span>{status.text}</span>
      </p>
      <OutcomeFeedback
        outcome={lifecycleOutcome.outcome}
        successMessage={LIFECYCLE_DONE[lifecycle.kind]}
        failureMessage="The service action did not complete."
      />

      {unhealthy && (
        <Feedback variant="error">
          The service is running but failed its health check. Restart it, and check the Airtable
          Formula output channel if the problem continues.
        </Feedback>
      )}

      {running && (
        <>
          <dl className="service-details">
            {daemon?.port != null && (
              <div className="service-detail">
                <dt>MCP port</dt>
                <dd>{daemon.port}</dd>
              </div>
            )}
            {daemon?.port_lsp != null && (
              <div className="service-detail">
                <dt>LSP port</dt>
                <dd>{daemon.port_lsp}</dd>
              </div>
            )}
            {daemon?.uptime != null && (
              <div className="service-detail">
                <dt>Uptime</dt>
                <dd>{formatUptime(daemon.uptime)}</dd>
              </div>
            )}
            {daemon?.tunnelUrl && (
              <div className="service-detail">
                <dt>Tunnel URL</dt>
                <dd className="service-detail__url" title={daemon.tunnelUrl}>{daemon.tunnelUrl}</dd>
                <ActionButton
                  aria-label="Copy tunnel URL"
                  onClick={() => {
                    if (!daemon.tunnelUrl) return;
                    navigator.clipboard.writeText(daemon.tunnelUrl).catch(() => undefined);
                    flashCopiedUrl();
                  }}
                >
                  {copiedUrl ? 'Copied' : 'Copy'}
                </ActionButton>
              </div>
            )}
          </dl>

          {/* The token value stays in the extension host; the webview only requests actions. */}
          <details className="disclosure">
            <summary>Safety</summary>
            <div className="disclosure__body">
              <p className="service-note">
                Clients that use the HTTP service authenticate with a bearer token. The token never
                leaves the extension host; Copy places it on your clipboard. Rotating it
                disconnects every client until it uses the new token.
              </p>
              <div className="service-token-actions">
                <ActionButton
                  disabled={busy}
                  onClick={() => runToken('copy', copyBearerToken)}
                >
                  Copy token
                </ActionButton>
                <ActionButton
                  pending={busy}
                  onClick={() => runToken('rotate', rotateToken)}
                >
                  Rotate token
                </ActionButton>
              </div>
              {/* Said only once the host confirms: a failed rotation never reads as rotated. */}
              <OutcomeFeedback
                outcome={tokenOutcome.outcome}
                successMessage={TOKEN_DONE[tokenAction.kind]}
                failureMessage="The token action did not complete."
              />
            </div>
          </details>
        </>
      )}
    </Section>
  );
}
