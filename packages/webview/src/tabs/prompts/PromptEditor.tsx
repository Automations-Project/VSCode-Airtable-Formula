import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { PromptArg, PromptDef } from '@shared/types.js';
import { MAX_PROMPT_ARGUMENTS } from '@shared/webview-contract.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Feedback } from '../../components/Feedback.js';
import { FormField } from '../../components/FormField.js';
import { Section } from '../../components/Section.js';
import { useScopePending } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';
import { hasPromptDraftErrors, validatePromptDraft } from './validation.js';

const MAX_ACTION_ERROR_LENGTH = 300;
const DEFAULT_ACTION_ERROR =
  'The change did not apply. Check the VS Code notifications for details, then try again.';

export type PromptActionKind = 'save' | 'delete' | 'reset';

export type PromptExit =
  | { kind: 'back' }
  | { kind: PromptActionKind; name: string };

export interface PromptStatus {
  text: string;
  busy: boolean;
}

interface InFlight {
  id: string;
  kind: PromptActionKind;
  /** The name the host acted on, kept for focus return after the editor unmounts. */
  name: string;
}

const PENDING_TEXT: Record<PromptActionKind, string> = {
  save: 'Saving prompt…',
  delete: 'Deleting prompt…',
  reset: 'Resetting prompt…',
};

const CANCELLED_TEXT: Record<PromptActionKind, string> = {
  save: 'Save cancelled',
  delete: 'Delete cancelled',
  reset: 'Reset cancelled',
};

interface PromptEditorProps {
  initial: PromptDef;
  isNew: boolean;
  /** Names already in use, so a new or renamed prompt cannot silently overwrite one. */
  existingNames: readonly string[];
  onStatus: (status: PromptStatus) => void;
  onExit: (exit: PromptExit) => void;
}

/** The comparable part of a draft: what the user can edit. */
function editableKey(prompt: Pick<PromptDef, 'name' | 'description' | 'arguments' | 'template'>): string {
  return JSON.stringify([prompt.name, prompt.description, prompt.arguments, prompt.template]);
}

export function PromptEditor({ initial, isNew, existingNames, onStatus, onExit }: PromptEditorProps) {
  const savePrompt = useStore(s => s.savePrompt);
  const deletePrompt = useStore(s => s.deletePrompt);
  const resetPrompt = useStore(s => s.resetPrompt);
  // Read only to notice when this editor's own action settles; never used as a lock.
  const pendingActions = useStore(s => s.pendingActions);
  const consumeActionResult = useStore(s => s.consumeActionResult);
  const setPromptEditorDirty = useStore(s => s.setPromptEditorDirty);
  const guardPromptNavigation = useStore(s => s.guardPromptNavigation);
  // Prompt actions conflict only with prompt actions (they share one host file)
  // and with an open discard confirmation; unrelated dashboard work never holds them.
  const promptActionPending = useScopePending('prompt');
  const discardPending = useStore(s => s.promptDiscardPending);

  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [args, setArgs] = React.useState<PromptArg[]>(initial.arguments);
  const [template, setTemplate] = React.useState(initial.template);
  // The one action this editor is waiting on. Leaving happens only once the
  // host confirms it; a failure keeps the editor open with the input intact.
  const [inFlight, setInFlight] = React.useState<InFlight | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [focusArgIndex, setFocusArgIndex] = React.useState<number | null>(null);

  const draft: PromptDef = {
    name,
    description,
    arguments: args,
    template,
    isBuiltin: initial.isBuiltin,
    isModified: initial.isModified,
  };
  // Derived, not latched: typing a change and typing it back is clean again.
  const dirty = editableKey(draft) !== editableKey(initial);
  const errors = validatePromptDraft(draft);
  // The host saves by name, so any name other than this prompt's own that is
  // already in use (built-ins included) would be overwritten silently.
  const nameTaken = name !== initial.name && existingNames.includes(name);
  const nameError = name === '' || initial.isBuiltin
    ? undefined
    : nameTaken
      ? `A prompt named ${name} already exists.`
      : errors.name;
  const busy = inFlight !== null || promptActionPending || discardPending;
  const canSave = dirty && !hasPromptDraftErrors(errors) && !nameTaken && !busy;

  React.useEffect(() => {
    setPromptEditorDirty(dirty);
  }, [dirty, setPromptEditorDirty]);
  React.useEffect(() => () => setPromptEditorDirty(false), [setPromptEditorDirty]);

  // The clicked row unmounted, so land on the editor heading, never <body>.
  React.useEffect(() => {
    document.getElementById('prompt-editor-heading')?.focus();
  }, []);

  React.useEffect(() => {
    if (!inFlight || pendingActions.has(inFlight.id)) return;
    const outcome = consumeActionResult(inFlight.id);
    setInFlight(null);
    if (outcome?.ok) {
      onExit({ kind: inFlight.kind, name: inFlight.name });
      return;
    }
    if (outcome?.cancelled) {
      onStatus({ text: CANCELLED_TEXT[inFlight.kind], busy: false });
      return;
    }
    onStatus({ text: '', busy: false });
    setActionError(outcome?.error?.trim().slice(0, MAX_ACTION_ERROR_LENGTH) || DEFAULT_ACTION_ERROR);
  }, [pendingActions, inFlight, consumeActionResult, onExit, onStatus]);

  function begin(kind: PromptActionKind, targetName: string, send: () => string | null): void {
    if (busy) return;
    const id = send();
    if (id === null) return;
    setActionError(null);
    setInFlight({ id, kind, name: targetName });
    onStatus({ text: PENDING_TEXT[kind], busy: true });
  }

  function handleSave(): void {
    if (!canSave) return;
    begin('save', name, () => savePrompt({ ...draft, isModified: initial.isBuiltin }));
  }

  // Delete and reset are confirmed by the host's modal; a refusal comes back as `cancelled`.
  function handleDelete(): void {
    begin('delete', initial.name, () => deletePrompt(initial.name));
  }

  function handleReset(): void {
    begin('reset', initial.name, () => resetPrompt(initial.name));
  }

  async function handleBack(): Promise<void> {
    const accepted = await guardPromptNavigation(() => onExit({ kind: 'back' }));
    if (!accepted) document.getElementById('prompt-back-button')?.focus();
  }

  function addArgument(): void {
    setFocusArgIndex(args.length);
    setArgs(current => [...current, { name: '', description: '', required: false }]);
  }

  function updateArgument(index: number, patch: Partial<PromptArg>): void {
    setArgs(current => current.map((arg, i) => (i === index ? { ...arg, ...patch } : arg)));
  }

  function removeArgument(index: number): void {
    setFocusArgIndex(null);
    setArgs(current => current.filter((_, i) => i !== index));
    // The focused Remove button unmounts with its row; keep focus in the editor.
    requestAnimationFrame(() => document.getElementById('add-prompt-argument')?.focus());
  }

  const badges = (
    <>
      {initial.isBuiltin && <span className="prompt-badge">built-in</span>}
      {initial.isModified && <span className="prompt-badge" data-tone="warning">modified</span>}
    </>
  );

  return (
    <div className="prompt-editor">
      <div>
        <ActionButton id="prompt-back-button" onClick={() => void handleBack()}>
          <ArrowLeft size={12} aria-hidden="true" /> Back to prompts
        </ActionButton>
      </div>

      <Section
        id="prompt-editor"
        title={isNew ? 'New prompt' : `/${initial.name}`}
        actions={badges}
        busy={busy}
      >
        <div className="form-stack">
          <FormField
            label="Slash command name"
            description={<>Appears as <code>/{name || '…'}</code> in MCP clients.</>}
            error={nameError}
            required
          >
            {control => (
              <input
                {...control}
                className="form-control form-control--mono"
                value={name}
                onChange={event => setName(event.target.value)}
                disabled={initial.isBuiltin}
                placeholder="my-prompt"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </FormField>

          <FormField label="Description" error={errors.description}>
            {control => (
              <input
                {...control}
                className="form-control"
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="What this prompt does"
              />
            )}
          </FormField>

          <div className="prompt-arguments-block">
            <div className="prompt-arguments-head">
              <h3 className="prompt-subheading">Arguments</h3>
              <ActionButton
                id="add-prompt-argument"
                onClick={addArgument}
                disabled={args.length >= MAX_PROMPT_ARGUMENTS}
              >
                Add argument
              </ActionButton>
            </div>
            <p className="prompt-hint">
              Use <code>{'{argName}'}</code> in the template to insert argument values. A prompt can have up to {MAX_PROMPT_ARGUMENTS} arguments.
            </p>
            {errors.form && <p className="form-field__error" role="alert">{errors.form}</p>}
            {args.length === 0 ? (
              <p className="empty-note">No arguments. This prompt has no user-fillable slots.</p>
            ) : (
              <ul className="prompt-arguments">
                {args.map((arg, index) => {
                  const position = index + 1;
                  return (
                    <li key={index} className="prompt-argument">
                      <FormField
                        label={`Argument name ${position}`}
                        error={arg.name === '' ? undefined : errors.arguments[index]}
                        required
                      >
                        {control => (
                          <input
                            {...control}
                            className="form-control form-control--mono"
                            value={arg.name}
                            onChange={event => updateArgument(index, { name: event.target.value })}
                            autoFocus={focusArgIndex === index}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        )}
                      </FormField>
                      <FormField
                        label={`Argument description ${position}`}
                        error={errors.argumentDescriptions[index]}
                      >
                        {control => (
                          <input
                            {...control}
                            className="form-control"
                            value={arg.description}
                            onChange={event => updateArgument(index, { description: event.target.value })}
                          />
                        )}
                      </FormField>
                      <div className="prompt-argument__controls">
                        <label className="prompt-check">
                          <input
                            type="checkbox"
                            checked={arg.required}
                            onChange={event => updateArgument(index, { required: event.target.checked })}
                          />
                          <span>Argument {position} required</span>
                        </label>
                        <ActionButton onClick={() => removeArgument(index)}>
                          Remove argument {position}
                        </ActionButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <FormField label="Template" error={errors.template}>
            {control => (
              <textarea
                {...control}
                className="form-control form-control--mono prompt-template"
                value={template}
                onChange={event => setTemplate(event.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
          </FormField>

          {actionError && <Feedback variant="error">{actionError}</Feedback>}

          <div className="form-actions">
            <ActionButton
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              pending={inFlight?.kind === 'save'}
            >
              Save prompt
            </ActionButton>
            {initial.isBuiltin && initial.isModified && (
              <ActionButton onClick={handleReset} disabled={busy} pending={inFlight?.kind === 'reset'}>
                Reset to default
              </ActionButton>
            )}
            {!initial.isBuiltin && !isNew && (
              <ActionButton
                variant="danger"
                onClick={handleDelete}
                disabled={busy}
                pending={inFlight?.kind === 'delete'}
              >
                Delete prompt
              </ActionButton>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
