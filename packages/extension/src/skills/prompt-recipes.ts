// Renders the airtable-user-mcp prompts as one markdown file inside the installed
// skill (`references/prompts.md`), so clients that do not surface MCP prompts still
// get the task recipes. Pure: the installer passes the lists in.
import type { PromptRecipe } from '../mcp/prompts-state.js';

export const RECIPES_FILE = 'references/prompts.md';

const HEADER = [
  '# Airtable task recipes',
  '',
  'These are the airtable-user-mcp prompts, as recipes. Your MCP client may also show them as',
  'slash commands; the text is the same. An input is written as `{inputName}` (lowerCamelCase).',
  'Take each input from the user\'s request. If a required input is missing, ask for it before',
  'you start.',
].join('\n');

/** One line, no leading `#`: a name becomes a heading, so it must not open another one. */
function headingName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
}

function section(p: PromptRecipe): string {
  const inputs = p.arguments.length
    ? ['Inputs:', ...p.arguments.map(a => `- \`${a.name}\` (${a.required ? 'required' : 'optional'}): ${a.description}`)].join('\n')
    : 'Inputs: none';
  return [`## ${headingName(p.name)}`, p.description, inputs, 'Recipe:', p.template].join('\n\n');
}

export function renderPromptRecipes(prompts: readonly PromptRecipe[]): string {
  return `${[HEADER, ...prompts.map(section)].join('\n\n')}\n`;
}
