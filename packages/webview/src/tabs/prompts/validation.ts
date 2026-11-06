import type { PromptDef } from '@shared/types.js';
import {
  MAX_PROMPT_ARGUMENTS,
  MAX_PROMPT_TEMPLATE_LENGTH,
  PROMPT_ARG_NAME_PATTERN,
  PROMPT_NAME_PATTERN,
} from '@shared/webview-contract.js';

/**
 * The host parser (`isPromptDef`) caps every description at 2,048 characters
 * but does not export the number; a longer one would make it drop the whole
 * save message, so the draft is rejected here with the same bound.
 */
export const MAX_PROMPT_DESCRIPTION_LENGTH = 2_048;

export interface PromptDraftErrors {
  name?: string;
  description?: string;
  template?: string;
  /** Keyed by argument index. */
  arguments: Record<number, string>;
  argumentDescriptions: Record<number, string>;
  form?: string;
}

const NAME_RULE = 'Use lowercase letters, digits, and hyphens; start with a letter.';
const ARGUMENT_RULE = 'Start with a letter; then use letters, digits, underscores, or hyphens.';
const DESCRIPTION_RULE = 'Description must be 2,048 characters or fewer.';

export function hasPromptDraftErrors(errors: PromptDraftErrors): boolean {
  return Boolean(
    errors.name
    || errors.description
    || errors.template
    || errors.form
    || Object.keys(errors.arguments).length > 0
    || Object.keys(errors.argumentDescriptions).length > 0,
  );
}

export function validatePromptDraft(prompt: PromptDef): PromptDraftErrors {
  const errors: PromptDraftErrors = { arguments: {}, argumentDescriptions: {} };
  if (!PROMPT_NAME_PATTERN.test(prompt.name)) {
    errors.name = prompt.name.length > 64 ? 'Use 64 characters or fewer.' : NAME_RULE;
  }
  if (prompt.description.length > MAX_PROMPT_DESCRIPTION_LENGTH) {
    errors.description = DESCRIPTION_RULE;
  }
  if (prompt.template.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    errors.template = 'Template must be 16,384 characters or fewer.';
  }
  if (prompt.arguments.length > MAX_PROMPT_ARGUMENTS) {
    errors.form = `A prompt can have at most ${MAX_PROMPT_ARGUMENTS} arguments.`;
  }

  const seen = new Set<string>();
  prompt.arguments.forEach((argument, index) => {
    if (!PROMPT_ARG_NAME_PATTERN.test(argument.name)) {
      errors.arguments[index] = argument.name.length > 64 ? 'Use 64 characters or fewer.' : ARGUMENT_RULE;
    } else if (seen.has(argument.name)) {
      errors.arguments[index] = 'Argument names must be unique.';
    }
    seen.add(argument.name);
    if (argument.description.length > MAX_PROMPT_DESCRIPTION_LENGTH) {
      errors.argumentDescriptions[index] = DESCRIPTION_RULE;
    }
  });
  return errors;
}
