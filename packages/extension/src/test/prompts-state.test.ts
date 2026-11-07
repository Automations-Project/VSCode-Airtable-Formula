import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isPromptDef, type PromptDef } from '@airtable-formula/shared';
import { mergePrompts, readMergedPrompts, normalizePromptsConfig } from '../mcp/prompts-state.js';
import { renderPromptRecipes } from '../skills/prompt-recipes.js';
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

  it('keeps the built-in when an override carries another name', () => {
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, { overrides: { [builtin.name]: { ...builtin, name: 'renamed', description: 'edited' } } });
    expect(out[0]).toEqual({ ...builtin, isBuiltin: true, isModified: false });
    expect(out.map(p => p.name)).not.toContain('renamed');
  });

  it('keeps the first custom prompt of a name, like the server', () => {
    const first = { name: 'twice', description: 'first', arguments: [], template: 'one' };
    const out = mergePrompts(BUILTIN_PROMPT_DEFS, { custom: [first, { ...first, description: 'second', template: 'two' }] });
    expect(out.slice(BUILTIN_PROMPT_DEFS.length)).toEqual([{ ...first, isBuiltin: false, isModified: false }]);
  });
});

// Every entry mergePrompts returns goes to the dashboard (the contract's isPromptsState drops
// the whole state:update on one bad entry) and to the skill renderer, so both are checked here.
describe('mergePrompts validates against the dashboard contract', () => {
  const arg = { name: 'formula', description: 'The formula', required: true };
  const valid = { name: 'my-recipe', description: 'd', arguments: [arg], template: 't' };
  const custom = (entry: unknown) => mergePrompts(BUILTIN_PROMPT_DEFS, { custom: [entry] }).slice(BUILTIN_PROMPT_DEFS.length);
  const override = (entry: unknown) => mergePrompts(BUILTIN_PROMPT_DEFS, { overrides: { [builtin.name]: entry } })[0];

  it.each([
    ['a null argument', { ...valid, arguments: [null] }],
    ['a string argument', { ...valid, arguments: ['formula'] }],
    ['an uppercase name with a space', { ...valid, name: 'My Recipe' }],
    ['an argument missing required', { ...valid, arguments: [{ name: 'formula', description: 'The formula' }] }],
    ['an argument whose required is not a boolean', { ...valid, arguments: [{ ...arg, required: 'yes' }] }],
    ['two arguments of one name', { ...valid, arguments: [arg, arg] }],
  ])('skips a custom prompt with %s', (_label, entry) => {
    expect(custom(entry)).toEqual([]);
  });

  it.each([
    ['a null argument', { ...builtin, arguments: [null] }],
    ['a string argument', { ...builtin, arguments: ['formula'] }],
    ['an argument missing required', { ...builtin, arguments: [{ name: 'formula', description: 'x' }] }],
  ])('skips an override with %s and keeps the built-in', (_label, entry) => {
    expect(override(entry)).toEqual({ ...builtin, isBuiltin: true, isModified: false });
  });

  it('drops an extra top-level key rather than passing it to the dashboard', () => {
    const [def] = custom({ ...valid, notes: 'mine' });
    expect(def).toEqual({ ...valid, isBuiltin: false, isModified: false });
    expect(isPromptDef(def)).toBe(true);
  });

  it('accepts an argument with extra keys, cut down to name, description and required', () => {
    const [def] = custom({ ...valid, arguments: [{ ...arg, default: 'x', hint: 'y' }] });
    expect(def.arguments).toEqual([arg]);
  });

  it('whatever the file holds, every entry passes isPromptDef (what isPromptsState checks) and renders', () => {
    const prompts = mergePrompts(BUILTIN_PROMPT_DEFS, {
      overrides: { [builtin.name]: { ...builtin, arguments: [null] }, [BUILTIN_PROMPT_DEFS[1].name]: { ...BUILTIN_PROMPT_DEFS[1], extra: 1 } },
      custom: [{ ...valid, arguments: [null] }, { ...valid, name: 'My Recipe' }, { ...valid, name: 'ok', notes: 1 }, null, 7],
    });
    expect(prompts.every(isPromptDef)).toBe(true);
    expect(() => renderPromptRecipes(prompts)).not.toThrow();
    expect(prompts.at(-1)?.name).toBe('ok');
  });
});

describe('normalizePromptsConfig', () => {
  it('starts empty from anything that is not an object', () => {
    for (const raw of [undefined, null, [], 'x', 3]) {
      expect(normalizePromptsConfig(raw)).toEqual({ overrides: {}, custom: [] });
    }
  });

  it('resets overrides and custom of the wrong shape and keeps other keys', () => {
    expect(normalizePromptsConfig({ overrides: [], custom: {}, version: 2 })).toEqual({ overrides: {}, custom: [], version: 2 });
    expect(normalizePromptsConfig({ overrides: null, custom: 'x' })).toEqual({ overrides: {}, custom: [] });
  });

  it('keeps well-formed overrides and custom as they are', () => {
    const cfg = { overrides: { a: { name: 'a' } }, custom: [{ name: 'b' }] };
    expect(normalizePromptsConfig(cfg)).toEqual(cfg);
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
