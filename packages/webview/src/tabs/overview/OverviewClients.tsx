import React from 'react';
import type { IdeStatus } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import type { NavigateFn } from '../../components/NextAction.js';
import { Section } from '../../components/Section.js';
import { summarizeClients, type ClientSummary } from '../../selectors/readiness.js';

const STATE_LABELS: Record<ClientSummary['state'], string> = {
  ready: 'Ready',
  partial: 'Partial',
  'needs-setup': 'Needs setup',
};

interface OverviewClientsProps {
  statuses: IdeStatus[];
  navigate: NavigateFn;
}

export function OverviewClients({ statuses, navigate }: OverviewClientsProps) {
  const clients = summarizeClients(statuses);
  const usable = clients.filter(client => client.usable).length;
  const noun = clients.length === 1 ? 'editor' : 'editors';

  return (
    <Section
      id="overview-editors"
      title="Editors"
      description={clients.length > 0 ? `${usable} of ${clients.length} detected ${noun} ready` : undefined}
      actions={(
        <ActionButton onClick={() => navigate('setup', 'editors-heading')}>
          Manage editors
        </ActionButton>
      )}
    >
      {clients.length === 0 ? (
        <p className="empty-note">
          No editors detected yet. Install a supported editor, then set it up from Setup.
        </p>
      ) : (
        <ul className="client-list">
          {clients.map(client => (
            <li key={client.ideId} className="client-row" data-state={client.state}>
              <span className="client-row__name">{client.label}</span>
              {client.version && <span className="client-row__version">{client.version}</span>}
              <span className="client-row__state">{STATE_LABELS[client.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
