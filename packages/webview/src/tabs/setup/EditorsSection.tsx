import React from 'react';
import type { IdeStatus } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { EditorCard } from '../../components/EditorCard.js';
import { Section } from '../../components/Section.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { summarizeClients } from '../../selectors/readiness.js';
import { useStore } from '../../store.js';

export function EditorsSection() {
  const ideStatuses = useStore(s => s.ideStatuses);
  const pendingIdeActions = useStore(s => s.pendingIdeActions);
  const setupAllPending = useStore(s => s.pendingSetupAll.size > 0);
  const includeAgents = useStore(s => s.settings.ai.includeAgents);
  const setupIde = useStore(s => s.setupIde);
  const setupAll = useStore(s => s.setupAll);
  const unconfigureIde = useStore(s => s.unconfigureIde);
  const openIdeDocs = useStore(s => s.openIdeDocs);
  const [setupAllId, setSetupAllId] = React.useState<string | null>(null);
  const setupAllOutcome = useActionOutcome(setupAllId);

  const detected = ideStatuses.filter(ide => ide.detected);
  const undetected = ideStatuses.filter(ide => !ide.detected);
  const needWork = summarizeClients(detected, includeAgents).filter(client => client.state !== 'ready').length;

  const description = ideStatuses.length === 0
    ? undefined
    : detected.length === 0
      ? 'No supported editors detected yet.'
      : `${detected.length} detected, ${needWork} ${needWork === 1 ? 'needs' : 'need'} setup`;

  const renderCard = (status: IdeStatus) => (
    <li key={status.ideId}>
      <EditorCard
        status={status}
        includeAgents={includeAgents}
        // Only this editor's own action, or a setup-all rewriting every editor,
        // holds its card; unrelated work never does.
        loading={pendingIdeActions.has(status.ideId)}
        locked={setupAllPending}
        onSetup={() => setupIde(status.ideId)}
        onUnconfigure={() => unconfigureIde(status.ideId)}
        onDocs={() => openIdeDocs(status.ideId)}
      />
    </li>
  );

  return (
    <Section
      id="editors"
      title="Editors"
      description={description}
      actions={needWork > 1 ? (
        <ActionButton
          variant="primary"
          pending={setupAllPending || pendingIdeActions.size > 0}
          onClick={() => {
            setupAllOutcome.clearOutcome();
            setSetupAllId(setupAll());
          }}
        >
          Setup all detected editors
        </ActionButton>
      ) : undefined}
    >
      {/* Outside the button's condition: a successful setup-all usually removes the button. */}
      <OutcomeFeedback
        outcome={setupAllOutcome.outcome}
        successMessage="All detected editors set up."
        failureMessage="Setting up the detected editors did not complete."
      />
      {ideStatuses.length === 0 ? (
        <p className="empty-note" role="status" aria-busy="true">Scanning for installed editors…</p>
      ) : (
        <>
          {detected.length > 0 && <ul className="editor-list">{detected.map(renderCard)}</ul>}
          {undetected.length > 0 && (
            <details className="disclosure" open={detected.length === 0}>
              <summary>Show available editors</summary>
              <ul className="editor-list disclosure__body">{undetected.map(renderCard)}</ul>
            </details>
          )}
        </>
      )}
    </Section>
  );
}
