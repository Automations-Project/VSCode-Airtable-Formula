import React from 'react';
import type { WebviewSettingChange } from '@shared/messages.js';
import { useActionOutcome, useScopePending } from '../lib/useActionOutcome.js';
import { settingScope, useStore, type ActionOutcome } from '../store.js';
import { Feedback } from './Feedback.js';

/** Attributes a row spreads onto its one native control. */
export interface SettingControlProps {
  id: string;
  disabled: boolean;
  'aria-describedby'?: string;
  'aria-busy'?: true;
}

interface OutcomeFeedbackProps {
  outcome: ActionOutcome | null;
  successMessage?: string;
  failureMessage?: string;
}

/**
 * The result of ONE action. The `role="status"` region is always mounted so a
 * screen reader hears the success text when it appears; the `role="alert"` error
 * mounts with the failure and carries the host's own error text. A cancelled
 * action (a dismissed dialog) says nothing.
 */
export function OutcomeFeedback({
  outcome,
  successMessage = 'Saved',
  failureMessage = 'The change could not be applied.',
}: OutcomeFeedbackProps) {
  const failure = outcome && !outcome.ok && !outcome.cancelled ? outcome : null;
  return (
    <>
      <p className="outcome-status" role="status">
        {outcome?.ok && !outcome.cancelled ? successMessage : null}
      </p>
      {failure && <Feedback variant="error">{failure.error || failureMessage}</Feedback>}
    </>
  );
}

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
  /** This row's own change is in flight. */
  pending?: boolean;
  outcome?: ActionOutcome | null;
  successMessage?: string;
  children: (control: SettingControlProps) => React.ReactNode;
}

/** One labelled setting: copy and control side by side, stacked when narrow, with its own feedback. */
export function SettingRow({
  label,
  description,
  pending = false,
  outcome = null,
  successMessage,
  children,
}: SettingRowProps) {
  const base = React.useId();
  const controlId = `${base}-control`;
  const descriptionId = `${base}-description`;

  return (
    <div className="setting-row" aria-busy={pending || undefined}>
      <div className="setting-row__copy">
        <label className="setting-row__label" htmlFor={controlId}>{label}</label>
        {description && <p id={descriptionId} className="setting-row__description">{description}</p>}
      </div>
      <div className="setting-row__control">
        {children({
          id: controlId,
          disabled: pending,
          ...(description ? { 'aria-describedby': descriptionId } : {}),
          ...(pending ? { 'aria-busy': true as const } : {}),
        })}
      </div>
      <OutcomeFeedback outcome={outcome} successMessage={successMessage} />
    </div>
  );
}

/**
 * A setting's own in-flight state. The guard is the store's scoped pending map
 * (it survives a tab switch); the action id stays local, for this row's outcome.
 */
function useSettingChange(probe: WebviewSettingChange) {
  const changeSetting = useStore(s => s.changeSetting);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const { outcome, clearOutcome } = useActionOutcome(actionId);
  const pending = useScopePending(settingScope(probe));
  const send = (change: WebviewSettingChange) => {
    clearOutcome();
    setActionId(changeSetting(change));
  };
  return { pending, outcome, send };
}

interface SettingSwitchRowProps {
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  /** Builds the typed change for the value the switch is moving to. */
  change: (next: boolean) => WebviewSettingChange;
}

export function SettingSwitchRow({ label, description, checked, change }: SettingSwitchRowProps) {
  const { pending, outcome, send } = useSettingChange(change(!checked));
  return (
    <SettingRow label={label} description={description} pending={pending} outcome={outcome}>
      {control => (
        <input
          {...control}
          className="setting-switch"
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={() => send(change(!checked))}
        />
      )}
    </SettingRow>
  );
}

interface SettingSelectRowProps {
  label: string;
  description?: React.ReactNode;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  change: (value: string) => WebviewSettingChange;
}

export function SettingSelectRow({ label, description, value, options, change }: SettingSelectRowProps) {
  const { pending, outcome, send } = useSettingChange(change(value));
  return (
    <SettingRow label={label} description={description} pending={pending} outcome={outcome}>
      {control => (
        <select
          {...control}
          className="form-control"
          value={value}
          onChange={e => send(change(e.target.value))}
        >
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </SettingRow>
  );
}
