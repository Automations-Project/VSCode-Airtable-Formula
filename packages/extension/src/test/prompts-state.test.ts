import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PromptDef } from '@airtable-formula/shared';
import { mergePrompts, readMergedPrompts, isPromptRecipe } from '../mcp/prompts-state.js';
import { BUILTIN_PROMPT_DEFS } from '../mcp/prompt-defs.js';

const builtin = BUILTIN_PROMPT_DEFS[0];

describe('mergePrompts', () => {
  it('returns built-ins unmodified when there is no config', () => {
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, undefined);
    expect(out.map(p => p.name)).toEqual(BUILTIN_PROMPT_DEFS.map(p => p.name));
    expect(out.every(p => p.isBuiltin && !p.isModified)).toBe(true);
  });

  it('applies a valid override and marks it modified', () => {
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, { overrides: { [builtin.name]: { ...builtin, description: 'edited' } } });
    expect(out[0]).toMatchObject({ name: builtin.name, description: 'edited', isBuiltin: true, isModified: true });
  });

  it('skips a malformed override and keeps the built-in', () => {
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, { overrides: { [builtin.name]: { name: builtin.name, template: 42 } } });
    expect(out[0]).toMatchObject({ description: builtin.description, isModified: false });
  });

  it('appends valid custom prompts and skips malformed ones and built-in name clashes', () => {
    const custom = { name: 'my-recipe', description: 'd', arguments: [], template: 't' };
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, { custom: [custom, { name: 'broken' }, { ...custom, name: builtin.name }] });
    expect(out.slice(BUILTIN_PROMPT_DEFS.length)).toEqual([{ ...custom, isBuiltin: false, isModified: false }]);
  });

  it('treats a non-object config as empty', () => {
    expect(mergePrompts(BUILTIN_PROMPT_DEFS, 'nonsense')).toHaveLength(BUILTIN_PROMPT_DEFS.length);
  });
});

describe('isPromptRecipe', () => {
  it('requires the four fields with the right types', () => {
    expect(isPromptRecipe({ name: 'n', description: 'd', arguments: [], template: 't' })).toBe(true);
    expect(isPromptRecipe({ name: 'n', description: 'd', arguments: {}, template: 't' })).toBe(false);
    expect(isPromptRecipe(null)).toBe(false);
  });
});

describe('readMergedPrompts', () => {
  it('reads prompts.json under home and tolerates a missing or broken file', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-home-'));
    expect((await readMergedPrompts(home)).length).toBe(BUILTIN_PROMPT_DEFS.length);
    const dir = path.join(home, '.airtable-user-mcp');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts.json'), '{ not json');
    expect((await readMergedPrompts(home)).length).toBe(BUILTIN_PROMPT_DEFS.length);
    fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify({ custom: [{ name: 'x', description: 'd', arguments: [], template: 't' }] }));
    expect((await readMergedPrompts(home)).at(-1)?.name).toBe('x');
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('built-in prompts parity', () => {
  it('extension mirror equals the MCP server definitions', async () => {
    const server = await import(/* @vite-ignore */ new URL('../../../mcp-server/src/prompts.js', import.meta.url).href) as { BUILTIN_PROMPT_DEFS: unknown[] };
    const strip = (p: unknown) => {
      const { name, description, arguments: args, template } = p as PromptDef;
      return { name, description, arguments: args, template };
    };
    expect(BUILTIN_PROMPT_DEFS.map(strip)).toEqual(server.BUILTIN_PROMPT_DEFS.map(strip));
  });
});
