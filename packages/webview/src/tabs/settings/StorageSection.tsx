import React from 'react';
import type { StorageEntry } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { useActionOutcome, useScopePending } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** One entry. The host owns its location; the webview only ever names it by id. */
function StorageEntryRow({ entry }: { entry: StorageEntry }) {
  const openStoragePath = useStore(s => s.openStoragePath);
  const opening = useScopePending(`storage:open:${entry.id}`);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const { outcome, clearOutcome } = useActionOutcome(actionId);

  return (
    <li className="storage-entry">
      <div className="storage-entry__copy">
        <span className="storage-entry__label">{entry.label}</span>
        <span className="storage-entry__meta">
          {entry.exists
            ? entry.sizeBytes !== undefined ? formatBytes(entry.sizeBytes) : null
            : 'Not created yet'}
        </span>
      </div>
      {entry.exists && (
        <ActionButton
          aria-label={`Open ${entry.label}`}
          pending={opening}
          onClick={() => {
            clearOutcome();
            setActionId(openStoragePath(entry.id));
          }}
        >
          Open
        </ActionButton>
      )}
      <OutcomeFeedback outcome={outcome} successMessage="Opened." failureMessage="It could not be opened." />
    </li>
  );
}

function SessionBackup({ canBackUp }: { canBackUp: boolean }) {
  const backupSession = useStore(s => s.backupSession);
  const restoreSession = useStore(s => s.restoreSession);
  const sessionBusy = useScopePending('session:');
  const backingUp = useScopePending('session:backup');
  const restoring = useScopePending('session:restore');
  const [action, setAction] = React.useState<{ id: string | null; kind: 'backup' | 'restore' }>({ id: null, kind: 'backup' });
  const { outcome, clearOutcome } = useActionOutcome(action.id);

  return (
    <div className="settings-subpanel">
      <p className="setting-row__description" id="session-backup-description">
        Back up exports your browser profile and session data to a zip file, with an optional password.
        Restore replaces your current session data with the backup you choose; VS Code asks you to confirm before anything is replaced.
      </p>
      <div className="settings-actions">
        <ActionButton
          aria-describedby="session-backup-description"
          pending={backingUp}
          disabled={!canBackUp || sessionBusy}
          onClick={() => {
            clearOutcome();
            setAction({ id: backupSession(), kind: 'backup' });
          }}
        >
          Back up session data
        </ActionButton>
        <ActionButton
          variant="danger"
          aria-describedby="session-backup-description"
          pending={restoring}
          disabled={sessionBusy}
          onClick={() => {
            clearOutcome();
            setAction({ id: restoreSession(), kind: 'restore' });
          }}
        >
          Restore session data
        </ActionButton>
      </div>
      <OutcomeFeedback
        outcome={outcome}
        successMessage={action.kind === 'backup' ? 'Backup finished.' : 'Restore finished.'}
        failureMessage="The session action did not complete."
      />
    </div>
  );
}

export function StorageSection() {
  const entries = useStore(s => s.storage?.entries) ?? [];

  return (
    <Section
      id="storage-settings"
      title="Storage and data"
      description="Where the extension keeps its browser profile and tool configuration."
    >
      <div className="settings-stack">
        {entries.length > 0 && (
          <ul className="storage-list" aria-label="Storage locations">
            {entries.map(entry => <StorageEntryRow key={entry.id} entry={entry} />)}
          </ul>
        )}
        <SessionBackup canBackUp={entries.some(e => e.exists)} />
      </div>
    </Section>
  );
}
