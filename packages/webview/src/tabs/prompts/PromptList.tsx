import React from 'react';
import type { PromptDef } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Section } from '../../components/Section.js';

interface PromptListProps {
  prompts: readonly PromptDef[];
  onEdit: (prompt: PromptDef) => void;
  onNew: () => void;
}

export function PromptList({ prompts, onEdit, onNew }: PromptListProps) {
  return (
    <Section
      id="prompt-list"
      title="Slash commands"
      description="Available in Claude, Cursor, and other MCP clients."
      actions={<ActionButton id="new-prompt-button" onClick={onNew}>New prompt</ActionButton>}
    >
      {prompts.length === 0 ? (
        <p className="empty-note">No prompts yet. Create one with New prompt.</p>
      ) : (
        <ul className="prompt-list">
          {prompts.map(prompt => (
            <li key={prompt.name}>
              <button
                type="button"
                id={`prompt-row-${prompt.name}`}
                className="prompt-row"
                onClick={() => onEdit(prompt)}
              >
                <span className="prompt-row__head">
                  <span className="prompt-row__name">/{prompt.name}</span>
                  {prompt.isBuiltin && <span className="prompt-badge">built-in</span>}
                  {prompt.isModified && <span className="prompt-badge" data-tone="warning">modified</span>}
                </span>
                {prompt.description && <span className="prompt-row__description">{prompt.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
