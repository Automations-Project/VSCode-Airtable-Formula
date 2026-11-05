import React from 'react';
import type { PromptDef } from '@shared/types.js';
import { useStore } from '../store.js';
import { PromptEditor, type PromptExit, type PromptStatus } from './prompts/PromptEditor.js';
import { PromptList } from './prompts/PromptList.js';
import { PromptReconnectDisclosure } from './prompts/PromptReconnectDisclosure.js';

const NEW_PROMPT_BUTTON_ID = 'new-prompt-button';
const NO_STATUS: PromptStatus = { text: '', busy: false };

const EXIT_TEXT = {
  save: 'Prompt saved',
  delete: 'Prompt deleted',
  reset: 'Prompt reset to default',
} as const;

interface Editing {
  prompt: PromptDef;
  isNew: boolean;
}

function emptyPrompt(): PromptDef {
  return { name: '', description: '', arguments: [], template: '', isBuiltin: false, isModified: false };
}

export function Prompts() {
  const prompts = useStore(s => s.prompts?.prompts ?? []);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  // One always-mounted live region for the whole tab, so a result is announced
  // even though the editor that produced it is already gone.
  const [status, setStatus] = React.useState<PromptStatus>(NO_STATUS);
  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const returnFocusId = React.useRef<string | null>(null);

  // Back on the list: focus the row that was edited, or New prompt when there
  // is no such row (a new or deleted prompt).
  React.useEffect(() => {
    const id = returnFocusId.current;
    if (editing !== null || id === null) return;
    returnFocusId.current = null;
    requestAnimationFrame(() => {
      (document.getElementById(id) ?? document.getElementById(NEW_PROMPT_BUTTON_ID))?.focus();
    });
  }, [editing]);

  const open = (prompt: PromptDef, isNew: boolean) => {
    setStatus(NO_STATUS);
    setEditing({ prompt, isNew });
  };

  const exit = React.useCallback((result: PromptExit) => {
    const current = editingRef.current;
    const rowId = current && !current.isNew ? `prompt-row-${result.kind === 'back' ? current.prompt.name : result.name}` : null;
    if (result.kind === 'back') {
      setStatus(NO_STATUS);
      returnFocusId.current = rowId ?? NEW_PROMPT_BUTTON_ID;
    } else {
      setStatus({ text: EXIT_TEXT[result.kind], busy: false });
      returnFocusId.current = result.kind === 'delete' ? NEW_PROMPT_BUTTON_ID : rowId ?? NEW_PROMPT_BUTTON_ID;
    }
    setEditing(null);
  }, []);

  return (
    <section className="tab-stack" aria-labelledby="prompts-heading">
      <h1 id="prompts-heading" className="tab-heading" tabIndex={-1}>Prompts</h1>
      <div className="prompt-status" role="status" aria-busy={status.busy || undefined}>{status.text}</div>
      {editing ? (
        <PromptEditor
          initial={editing.prompt}
          isNew={editing.isNew}
          existingNames={prompts.map(prompt => prompt.name)}
          onStatus={setStatus}
          onExit={exit}
        />
      ) : (
        <PromptList
          prompts={prompts}
          onEdit={prompt => open(prompt, false)}
          onNew={() => open(emptyPrompt(), true)}
        />
      )}
      <PromptReconnectDisclosure />
    </section>
  );
}
