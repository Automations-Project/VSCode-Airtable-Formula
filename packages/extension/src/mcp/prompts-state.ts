/**
 * One merge of built-in prompts with the user's ~/.airtable-user-mcp/prompts.json.
 * Shared by the dashboard (DashboardProvider) and the skill installer so both
 * show the same list. Pure apart from the single file read; depends only on
 * fs/promises and path.
 */
import * as fsP from 'fs/promises';
import * as path from 'path';
import { isPromptDef, type PromptDef } from '@airtable-formula/shared';
import { BUILTIN_PROMPT_DEFS } from './prompt-defs.js';

export type PromptRecipe = Pick<PromptDef, 'name' | 'description' | 'arguments' | 'template'>;

export interface PromptsConfig {
  overrides: Record<string, unknown>;
  custom: unknown[];
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * prompts.json as written by hand or by an older version: a non-object becomes empty,
 * and `overrides` / `custom` of the wrong shape are reset. Other top-level keys are kept,
 * so a save never drops what it does not understand.
 */
export function normalizePromptsConfig(raw: unknown): PromptsConfig {
  const cfg = isPlainObject(raw) ? raw : {};
  return {
    ...cfg,
    overrides: isPlainObject(cfg.overrides) ? cfg.overrides : {},
    custom: Array.isArray(cfg.custom) ? cfg.custom : [],
  };
}

/**
 * The entry cut down to the four recipe fields (arguments to their three), accepted only if
 * the result passes the dashboard's own `isPromptDef`. Anything the contract would reject
 * (a null argument, an uppercase name, a missing `required`) is skipped here, because one bad
 * entry reaching the dashboard drops the whole state:update, and the renderer cannot print it.
 */
function toPromptDef(entry: unknown, isBuiltin: boolean, isModified: boolean): PromptDef | null {
  if (!isPlainObject(entry) || !Array.isArray(entry.arguments)) { return null; }
  const projected = {
    name: entry.name,
    description: entry.description,
    arguments: entry.arguments.map((a: unknown) => (
      isPlainObject(a) ? { name: a.name, description: a.description, required: a.required } : a
    )),
    template: entry.template,
    isBuiltin,
    isModified,
  };
  return isPromptDef(projected) ? projected : null;
}

export function mergePrompts(builtins: readonly PromptRecipe[], config: unknown): PromptDef[] {
  const { overrides, custom } = normalizePromptsConfig(config);

  const out: PromptDef[] = builtins.map(b => {
    const override = Object.hasOwn(overrides, b.name) ? overrides[b.name] : undefined;
    // An override filed under one name but carrying another would rename the built-in: keep the built-in.
    const def = isPlainObject(override) && override.name === b.name ? toPromptDef(override, true, true) : null;
    return def ?? { ...b, isBuiltin: true, isModified: false };
  });

  // First entry with a name wins, like the server's renderPrompt (`find`); built-in names are taken.
  const taken = new Set(builtins.map(b => b.name));
  for (const c of custom) {
    const name = isPlainObject(c) ? c.name : undefined;
    if (typeof name !== 'string' || taken.has(name)) { continue; }
    taken.add(name);
    const def = toPromptDef(c, false, false);
    if (def) { out.push(def); }
  }
  return out;
}

export function promptsConfigPath(home: string): string {
  return path.join(home, '.airtable-user-mcp', 'prompts.json');
}

export async function readMergedPrompts(home: string): Promise<PromptDef[]> {
  let config: unknown;
  try {
    config = JSON.parse(await fsP.readFile(promptsConfigPath(home), 'utf8'));
  } catch { /* missing or unparsable counts as empty */ }
  return mergePrompts(BUILTIN_PROMPT_DEFS, config);
}
