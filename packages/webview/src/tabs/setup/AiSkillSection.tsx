import React from 'react';
import type { AiSkillClient } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { AgentMark } from '../../components/AgentMark.js';
import type { NavigateFn } from '../../components/NextAction.js';
import { Section } from '../../components/Section.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { StatusDot, type DotVariant } from '../../components/StatusDot.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useFocusFallback } from '../../lib/useFocusFallback.js';
import { useStore } from '../../store.js';

const STATUS_TEXT: Record<AiSkillClient['status'], string> = {
  installed: 'Installed',
  outdated: 'Outdated',
  missing: 'Not installed',
  absent: '',
};

function ClientGroup({ title, clients }: { title: string; clients: AiSkillClient[] }) {
  if (clients.length === 0) return null;
  return (
    <>
      <h3 className="skill-group__title">{`${title} (${clients.length})`}</h3>
      <ul className="skill-chips">
        {clients.map(client => (
          <li key={client.id} className="skill-chip"><AgentMark client={client} />{client.name}</li>
        ))}
      </ul>
    </>
  );
}

/** The whole-machine view of the one skill folder: where it is installed, and which clients read it. */
export function AiSkillSection({ navigate }: { navigate: NavigateFn }) {
  const clients = useStore(s => s.aiSkillClients);
  const scope = useStore(s => s.settings.ai.installScope);
  const version = useStore(s => s.versions.extension);
  const pendingSkill = useStore(s => s.pendingSkill);
  const installSkill = useStore(s => s.installSkill);
  const [run, setRun] = React.useState<{ id: string | null; update: boolean }>({ id: null, update: false });
  const runOutcome = useActionOutcome(run.id);
  // A successful install leaves every folder current, which removes the button.
  const buttonFallback = useFocusFallback<HTMLButtonElement>(() => document.getElementById('ai-skill-heading'));

  const present = clients.filter(c => c.status !== 'absent');
  const rest = clients.filter(c => c.status === 'absent');
  // Folders, not rows: clients that read the same directory (Codex and the standard
  // folder, every universal client in a project) share one folder and its status.
  const folders = new Set(present.map(c => c.dir)).size;
  const installed = new Set(present.filter(c => c.status === 'installed').map(c => c.dir)).size;
  const missing = present.some(c => c.status === 'missing');
  const outdated = present.some(c => c.status === 'outdated');
  const noWorkspace = scope === 'project' && clients.length === 0;

  const status: { dot: DotVariant; text: string } = noWorkspace
    ? { dot: 'off', text: 'Open a folder to install into a project, or switch the scope to this machine.' }
    : installed === 0
      ? { dot: 'err', text: 'Not installed' }
      : installed === folders
        ? { dot: 'ok', text: `Installed in ${installed} ${installed === 1 ? 'folder' : 'folders'} at version ${version}` }
        : { dot: 'warn', text: `Installed in ${installed} of ${folders} folders` };

  return (
    <Section
      id="ai-skill"
      title="AI skill"
      description={scope === 'global'
        ? 'One folder, installed wherever the AI clients on this machine read skills.'
        : 'One folder, installed into the open workspace for the clients detected here.'}
      actions={missing || outdated ? (
        <ActionButton
          ref={buttonFallback}
          variant={missing ? 'primary' : 'secondary'}
          pending={pendingSkill}
          onClick={() => {
            runOutcome.clearOutcome();
            setRun({ id: installSkill(), update: !missing });
          }}
        >
          {missing ? 'Install skill' : 'Update skill'}
        </ActionButton>
      ) : undefined}
    >
      <p className="service-status" role="status">
        <StatusDot variant={status.dot} />
        <span>{status.text}</span>
      </p>
      <p className="service-note">
        {scope === 'global' ? 'Scope: this machine' : 'Scope: open workspace'} ·{' '}
        <button type="button" className="link-button" onClick={() => navigate('settings', 'formula-scripting-heading')}>
          Change
        </button>
      </p>
      {/* Outside the button's condition: a successful install removes the button. */}
      <OutcomeFeedback
        outcome={runOutcome.outcome}
        successMessage={run.update ? 'Skill updated.' : 'Skill installed.'}
        failureMessage={run.update ? 'The skill was not updated.' : 'The skill was not installed.'}
      />

      {present.length > 0 && (
        <ul className="skill-clients" aria-label="AI clients">
          {present.map(client => (
            <li key={client.id} className="skill-client" data-status={client.status}>
              <AgentMark client={client} />
              <span className="skill-client__name">{client.name}</span>
              <span className="skill-client__dir">{client.dir}</span>
              <span className="skill-client__status">{STATUS_TEXT[client.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <details className="disclosure">
          <summary>{`${rest.length} more supported ${rest.length === 1 ? 'client' : 'clients'}`}</summary>
          <div className="disclosure__body">
            <ClientGroup title="Already covered by the standard folder" clients={rest.filter(c => c.canonical)} />
            <ClientGroup title="Get their own folder the next time you install" clients={rest.filter(c => !c.canonical)} />
          </div>
        </details>
      )}
    </Section>
  );
}
