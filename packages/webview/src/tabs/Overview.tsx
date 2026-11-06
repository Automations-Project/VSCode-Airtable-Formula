import React, { useMemo } from 'react';
import type { NavigateFn } from '../components/NextAction.js';
import { StatusSummary } from '../components/StatusSummary.js';
import { selectReadiness } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { OverviewClients } from './overview/OverviewClients.js';
import { OverviewHero } from './overview/OverviewHero.js';
import { OverviewLinks } from './overview/OverviewLinks.js';

interface OverviewProps {
  navigate: NavigateFn;
}

export function Overview({ navigate }: OverviewProps) {
  // Subscribe to the fields the readiness model reads, not the whole store.
  const loading = useStore(s => s.loading);
  const auth = useStore(s => s.auth);
  const daemon = useStore(s => s.daemon);
  const tunnel = useStore(s => s.tunnel);
  const ideStatuses = useStore(s => s.ideStatuses);
  const useDaemon = useStore(s => s.settings.mcp.useDaemon);
  const authMode = useStore(s => s.settings.mcp.authMode);
  const includeAgents = useStore(s => s.settings.ai.includeAgents);

  const readiness = useMemo(() => selectReadiness({
    loading,
    auth,
    daemon,
    tunnel,
    ideStatuses,
    settings: { mcp: { useDaemon, authMode }, ai: { includeAgents } },
  }), [loading, auth, daemon, tunnel, ideStatuses, useDaemon, authMode, includeAgents]);

  return (
    <section className="tab-stack" aria-labelledby="overview-heading">
      <OverviewHero readiness={readiness} navigate={navigate} />
      <StatusSummary readiness={readiness} navigate={navigate} />
      <OverviewClients statuses={ideStatuses} navigate={navigate} />
      <OverviewLinks navigate={navigate} />
    </section>
  );
}
