import React from 'react';
import type { IdeStatus } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { AgentMark } from '../../components/AgentMark.js';
import { EditorCard } from '../../components/EditorCard.js';
import { Section } from '../../components/Section.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useFocusFallback } from '../../lib/useFocusFallback.js';
import { summarizeClients } from '../../selectors/readiness.js';
import { useStore } from '../../store.js';

export function EditorsSection() {
  const ideStatuses = useStore(s => s.ideStatuses);
  const pendingIdeActions = useStore(s => s.pendingIdeActions);
  const setupAllPending = useStore(s => s.pendingSetupAll.size > 0);
  const setupIde = useStore(s => s.setupIde);
  const setupAll = useStore(s => s.setupAll);
  const unconfigureIde = useStore(s => s.unconfigureIde);
  const openIdeDocs = useStore(s => s.openIdeDocs);
  const installSkill = useStore(s => s.installSkill);
  const [setupAllId, setSetupAllId] = React.useState<string | null>(null);
  const setupAllOutcome = useActionOutcome(setupAllId);
  // A successful setup-all usually leaves at most one editor needing work, which removes the button.
  const setupAllFallback = useFocusFallback<HTMLButtonElement>(() => document.getElementById('editors-heading'));

  const detected = ideStatuses.filter(ide => ide.detected);
  const undetected = ideStatuses
    .filter(ide => !ide.detected)
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const needWork = summarizeClients(detected).filter(client => client.state !== 'ready').length;

  const description = ideStatuses.length === 0
    ? undefined
    : detected.length === 0
      ? 'No supported editors detected yet.'
      : `${detected.length} detected, ${needWork} ${needWork === 1 ? 'needs' : 'need'} setup`;

  const renderCard = (status: IdeStatus) => (
    <li key={status.ideId}>
      <EditorCard
        status={status}
        // Only this editor's own action, or a setup-all rewriting every editor,
        // holds its card; unrelated work never does.
        loading={pendingIdeActions.has(status.ideId)}
        locked={setupAllPending}
        onSetup={() => setupIde(status.ideId)}
        onUnconfigure={() => unconfigureIde(status.ideId)}
        onInstallSkill={installSkill}
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
          ref={setupAllFallback}
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
              <summary>{`${undetected.length} more supported ${undetected.length === 1 ? 'client' : 'clients'}`}</summary>
              <ul className="skill-chips disclosure__body" aria-label="More supported clients">
                {undetected.map(({ ideId, label }) => (
                  <li key={ideId} className="skill-chip">
                    <AgentMark client={{ id: ideId, name: label, ideId }} />
                    <span>{label}</span>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Docs for ${label}`}
                      onClick={() => openIdeDocs(ideId)}
                    >
                      Docs
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Section>
  );
}
