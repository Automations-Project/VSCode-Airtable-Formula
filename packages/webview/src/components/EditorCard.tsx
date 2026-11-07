import React from 'react';
import type { AiSkillStatus, IdeId, IdeStatus } from '@shared/types.js';
import { useActionOutcome } from '../lib/useActionOutcome.js';
import { useFocusFallback } from '../lib/useFocusFallback.js';
import { summarizeClients, type ClientSummary } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { ActionButton } from './ActionButton.js';
import { AgentMark } from './AgentMark.js';
import { IdeIcon, type IdeIconTone } from './IdeIcon.js';
import { Pill } from './Pill.js';
import { OutcomeFeedback } from './SettingRow.js';

// VS Code forks: LSP is always "on" via the host extension — no separate config row.
const VSCODE_FAMILY = new Set<IdeId>(['cursor', 'windsurf', 'windsurf-next', 'cline']);

// Pure LSP editors: no MCP — the LSP config is their setup.
const LSP_EDITORS = new Set<IdeId>(['helix', 'neovim']);

// Editors the skill installer has a skills folder for (the host's IDE_TO_AGENTS keys).
const AI_SKILL_IDES = new Set<IdeId>([
  'cursor', 'windsurf', 'windsurf-next', 'cline', 'claude-code', 'amp', 'opencode', 'codex-cli', 'zed',
]);

// The skill is one scope-wide unit; the card offers it only while it needs installing or updating.
const SKILL_ACTION: Partial<Record<AiSkillStatus, string>> = { missing: 'Install skill', outdated: 'Update skill' };

const STATE_LABELS: Record<ClientSummary['state'], string> = {
  ready: 'Ready',
  partial: 'Partial',
  'needs-setup': 'Needs setup',
};

type RowTone = 'ok' | 'bad' | 'info';

const ROW_ICON_TONE: Record<RowTone, IdeIconTone> = { ok: 'ok', bad: 'bad', info: 'info' };

type CardActionKind = 'setup' | 'update' | 'remove';

interface EditorCardProps {
  status: IdeStatus;
  /** Start the action; returns its id, or null when it was refused. */
  onSetup: () => string | null;
  onUnconfigure: () => string | null;
  /** True only while THIS editor's own action is in flight. */
  loading: boolean;
  /** A conflicting action (setup-all) is rewriting every editor: hold this card's actions. */
  locked?: boolean;
  /** Installs or updates the AI skill for the whole scope, not just this editor; null when refused. */
  onInstallSkill: () => string | null;
}

function LspBadge() {
  return <span className="lsp-badge" aria-hidden="true">LSP</span>;
}

export function EditorCard({
  status,
  onSetup,
  onUnconfigure,
  loading,
  locked = false,
  onInstallSkill,
}: EditorCardProps) {
  const { ideId, label } = status;
  const headingId = `editor-${ideId}-heading`;
  const isLspEditor = LSP_EDITORS.has(ideId);
  const isVscodeFamily = VSCODE_FAMILY.has(ideId);
  // lspConfigured is only defined for detected IDEs with LSP capability.
  const hasLspStatus = status.lspConfigured !== undefined;
  const hasAiSkill = AI_SKILL_IDES.has(ideId);
  const skill = status.aiSkill;
  const skillVersion = skill.status === 'installed' && skill.version ? `v${skill.version}` : '';
  const skillAction = SKILL_ACTION[skill.status];
  const primaryConfigured = isLspEditor ? !!status.lspConfigured : status.mcpConfigured;

  // Same derivation as the Overview, so both tabs always agree on the state.
  const summary = status.detected ? summarizeClients([status])[0] : undefined;
  const state = summary?.state;
  const stateLabel = summary ? STATE_LABELS[summary.state] : 'Not detected';

  const mcpTone: RowTone = status.mcpConfigured ? 'ok' : 'bad';
  const lspTone: RowTone = status.lspConfigured ? 'ok' : 'bad';
  const lspRowText = `LSP ${status.lspConfigured ? 'configured' : 'not configured'}`;

  const [action, setAction] = React.useState<{ id: string | null; kind: CardActionKind }>({ id: null, kind: 'setup' });
  const { outcome, clearOutcome } = useActionOutcome(action.id);
  const run = (kind: CardActionKind, start: () => string | null) => {
    clearOutcome();
    setAction({ id: start(), kind });
  };
  const done: Record<CardActionKind, string> = {
    setup: `${label} set up.`,
    update: `${label} updated.`,
    remove: `${label} configuration removed.`,
  };

  // Set up and Update are one slot (one node, the label changes); when Remove
  // goes away with the configuration, focus lands on that slot.
  const primarySlot = React.useRef<HTMLButtonElement>(null);
  const removeFallback = useFocusFallback<HTMLButtonElement>(() => primarySlot.current);
  const primaryKind: CardActionKind = primaryConfigured ? 'update' : 'setup';
  const primaryText = primaryConfigured ? 'Update' : 'Set up';
  const primaryBusyText = primaryConfigured ? 'Updating…' : 'Setting up…';
  // While Remove runs, the primary slot is held but does not claim to be updating.
  const primaryLabel = loading && action.kind !== 'remove' ? primaryBusyText : primaryText;

  // Any skill install or remove in flight, from any card or Settings, holds this button.
  const skillPending = useStore(s => s.pendingSkill);
  const [skillRun, setSkillRun] = React.useState<{ id: string | null; update: boolean }>({ id: null, update: false });
  const skillOutcome = useActionOutcome(skillRun.id);
  // Install / Update goes away once the skill is current; focus lands on the primary slot.
  const skillFallback = useFocusFallback<HTMLButtonElement>(() => primarySlot.current);

  return (
    <article
      className="editor-card"
      aria-labelledby={headingId}
      data-detected={status.detected}
      data-state={state ?? 'not-detected'}
    >
      <header className="editor-card__header">
        <AgentMark client={{ id: ideId, name: label, ideId }} />
        <h3 id={headingId} className="editor-card__name">{label}</h3>
        {status.version && <span className="editor-card__version">{status.version}</span>}
        <span className="editor-card__state">{stateLabel}</span>
      </header>

      {status.detected && (
        <ul className="editor-card__rows">
          {!isLspEditor && (
            <li className="editor-row" data-tone={mcpTone}>
              <IdeIcon ideId="mcp" size={13} tone={ROW_ICON_TONE[mcpTone]} />
              <span className="editor-row__text">
                MCP {status.mcpConfigured ? 'configured' : 'not configured'}
              </span>
            </li>
          )}

          {isVscodeFamily && (
            <li className="editor-row" data-tone="ok">
              <LspBadge />
              <span className="editor-row__text">Formula · Script · Automation</span>
              <span className="editor-row__note">Via extension</span>
            </li>
          )}

          {(hasLspStatus || isLspEditor) && (
            <li className="editor-row" data-tone={lspTone}>
              <LspBadge />
              <span className="editor-row__text">{lspRowText}</span>
            </li>
          )}

          {isLspEditor && status.lspConfigured && status.lspManualStep && (
            <li className="editor-row editor-row--note" data-tone="info">
              <span className="editor-row__text">{status.lspManualStep}</span>
            </li>
          )}

          {status.mcpConfigured && status.mcpServerHealthy === false && (
            <li className="editor-row editor-row--note" data-tone="warn">
              <span className="editor-row__text">
                <strong>Server path missing</strong>
                {' '}The configured server could not be found. Choose Update to repair it.
              </span>
            </li>
          )}

          {hasAiSkill && (
            <li className="editor-row editor-row--skill">
              <span className="editor-row__text">AI skill</span>
              <Pill label={skillVersion} status={skill.status} />
              {skillAction && (
                <ActionButton
                  ref={skillFallback}
                  pending={skillPending}
                  onClick={() => {
                    skillOutcome.clearOutcome();
                    setSkillRun({ id: onInstallSkill(), update: skill.status === 'outdated' });
                  }}
                >
                  {skillAction}
                </ActionButton>
              )}
            </li>
          )}
        </ul>
      )}

      <div className="editor-card__actions">
        {status.detected && (
          <ActionButton
            ref={primarySlot}
            variant={primaryConfigured ? 'secondary' : 'primary'}
            pending={loading}
            disabled={locked}
            aria-label={`${primaryText} ${label}`}
            onClick={() => run(primaryKind, onSetup)}
          >
            {primaryLabel}
          </ActionButton>
        )}
        {status.detected && primaryConfigured && (
          <ActionButton
            ref={removeFallback}
            variant="danger"
            pending={loading}
            disabled={locked}
            aria-label={`Remove ${label} configuration`}
            onClick={() => run('remove', onUnconfigure)}
          >
            Remove
          </ActionButton>
        )}
      </div>
      <OutcomeFeedback
        outcome={outcome}
        successMessage={done[action.kind]}
        failureMessage={`The ${label} configuration did not change.`}
      />
      <OutcomeFeedback
        outcome={skillOutcome.outcome}
        successMessage={skillRun.update ? 'AI skill updated.' : 'AI skill installed.'}
        failureMessage="The AI skill did not change."
      />
    </article>
  );
}
