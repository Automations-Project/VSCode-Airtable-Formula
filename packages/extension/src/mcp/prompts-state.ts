/**
 * One merge of built-in prompts with the user's ~/.airtable-user-mcp/prompts.json.
 * Shared by the dashboard (DashboardProvider) and the skill installer so both
 * show the same list. Pure apart from the single file read; depends only on
 * fs/promises and path.
 */
import * as fsP from 'fs/promises';
import * as path from 'path';
import type { PromptDef } from '@airtable-formula/shared';
import { BUILTIN_PROMPT_DEFS } from './prompt-defs.js';

export type PromptRecipe = Pick<PromptDef, 'name' | 'description' | 'arguments' | 'template'>;

export function isPromptRecipe(value: unknown): value is PromptRecipe {
  if (typeof value !== 'object' || value === null) { return false; }
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string'
    && typeof v.description === 'string'
    && typeof v.template === 'string'
    && Array.isArray(v.arguments);
}

export function mergePrompts(builtins: readonly PromptRecipe[], config: unknown): PromptDef[] {
  const cfg = (typeof config === 'object' && config !== null ? config : {}) as { overrides?: unknown; custom?: unknown };
  const overrides = (typeof cfg.overrides === 'object' && cfg.overrides !== null ? cfg.overrides : {}) as Record<string, unknown>;
  const names = new Set(builtins.map(b => b.name));

  const out: PromptDef[] = builtins.map(b => {
    const override = overrides[b.name];
    return isPromptRecipe(override)
      ? { ...override, isBuiltin: true, isModified: true }
      : { ...b, isBuiltin: true, isModified: false };
  });

  if (Array.isArray(cfg.custom)) {
    for (const c of cfg.custom) {
      if (isPromptRecipe(c) && !names.has(c.name)) {
        out.push({ ...c, isBuiltin: false, isModified: false });
      }
    }
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
