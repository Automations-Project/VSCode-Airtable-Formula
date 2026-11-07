// Renders the airtable-user-mcp prompts as one markdown file inside the installed
// skill (`references/prompts.md`), so clients that do not surface MCP prompts still
// get the task recipes. Pure: the installer passes the lists in.
import type { PromptRecipe } from '../mcp/prompts-state.js';

export const RECIPES_FILE = 'references/prompts.md';

const HEADER = [
  '# Airtable task recipes',
  '',
  'These are the airtable-user-mcp prompts, as recipes. Your MCP client may also show them as',
  'slash commands. In a global install they include the user\'s own edits; a project install',
  'carries the built-in recipes only. An input is written as `{inputName}` (lowerCamelCase).',
  'Take each input from the user\'s request. If a required input is missing, ask for it before',
  'you start.',
].join('\n');

/**
 * One line, no leading `#`. The name, description and inputs come from the user's prompts.json,
 * and a line break in any of them would open a heading of its own (`\n\n## other-recipe`).
 */
function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
}

function input(a: PromptRecipe['arguments'][number]): string {
  return `- \`${singleLine(a.name)}\` (${a.required ? 'required' : 'optional'}): ${singleLine(a.description)}`;
}

function section(p: PromptRecipe): string {
  const inputs = p.arguments.length ? ['Inputs:', ...p.arguments.map(input)].join('\n') : 'Inputs: none';
  return [`## ${singleLine(p.name)}`, singleLine(p.description), inputs, 'Recipe:', p.template].join('\n\n');
}

export function renderPromptRecipes(prompts: readonly PromptRecipe[]): string {
  return `${[HEADER, ...prompts.map(section)].join('\n\n')}\n`;
}
