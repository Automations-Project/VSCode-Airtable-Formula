import React from 'react';
import { ActionButton } from '../../components/ActionButton.js';
import { Feedback } from '../../components/Feedback.js';
import { Section } from '../../components/Section.js';
import { StatusDot, type DotVariant } from '../../components/StatusDot.js';
import { useStore } from '../../store.js';
import { formatUptime } from './snippets.js';

/** A short-lived "just happened" flag for copy/rotate confirmations. */
function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [on, () => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }];
}

interface ServiceStatus {
  text: string;
  dot: DotVariant;
}

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
  const [copiedToken, flashCopiedToken] = useFlash(1500);
  const [rotatedToken, flashRotatedToken] = useFlash(2000);

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
      actions={running ? (
        <>
          <ActionButton pending={busy} onClick={restartDaemon}>Restart service</ActionButton>
          <ActionButton variant="danger" pending={busy} onClick={stopDaemon}>Stop service</ActionButton>
        </>
      ) : (
        <ActionButton variant="primary" pending={busy} onClick={startDaemon}>Start service</ActionButton>
      )}
    >
      <p className="service-status" role="status">
        <StatusDot variant={status.dot} />
        <span>{status.text}</span>
      </p>

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
                  onClick={() => { copyBearerToken(); flashCopiedToken(); }}
                >
                  Copy token
                </ActionButton>
                <ActionButton
                  pending={busy}
                  onClick={() => { rotateToken(); flashRotatedToken(); }}
                >
                  Rotate token
                </ActionButton>
                {copiedToken && <span className="service-flash" role="status">Token copied</span>}
                {rotatedToken && <span className="service-flash" role="status">Token rotated</span>}
              </div>
            </div>
          </details>
        </>
      )}
    </Section>
  );
}
