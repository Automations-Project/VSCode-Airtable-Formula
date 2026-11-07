import { describe, it, expect } from 'vitest';
import { ENTRY_SHAPES, isShapeCurrent, readLaunch, type EntryShapeId, type LocalLaunch } from '../auto-config/mcp-entry-shapes.js';

const L: LocalLaunch = { command: 'node', args: ['/h/.airtable-user-mcp/start.mjs'], env: { AIRTABLE_HEADLESS_ONLY: '1' } };
const E: LocalLaunch = { ...L, env: {} };
const A = L.args;
const ENV = L.env;

// Each row is copied from the LOCAL branch of the upstream function named in
// mcp-entry-shapes.ts (add-mcp agents.ts @ 5ae1d29).
const CASES: Array<[EntryShapeId, Record<string, unknown>, Record<string, unknown>]> = [
  ['standard',    { command: 'node', args: A, env: ENV },                                   { command: 'node', args: A }],
  ['codex',       { command: 'node', args: A, env: ENV },                                   { command: 'node', args: A, env: {} }],
  ['zed',         { source: 'custom', command: 'node', args: A, env: ENV },                 { source: 'custom', command: 'node', args: A, env: {} }],
  ['opencode',    { type: 'local', command: ['node', ...A], environment: ENV, enabled: true }, { type: 'local', command: ['node', ...A], environment: {}, enabled: true }],
  ['fx',          { type: 'local', command: ['node', ...A], enabled: true, environment: ENV }, { type: 'local', command: ['node', ...A], enabled: true }],
  ['kimi',        { transport: 'stdio', command: 'node', args: A, env: ENV },               { transport: 'stdio', command: 'node', args: A }],
  ['typed-stdio', { type: 'stdio', command: 'node', args: A, env: ENV },                    { type: 'stdio', command: 'node', args: A }],
  ['cline',       { command: 'node', args: A, disabled: false, env: ENV },                  { command: 'node', args: A, disabled: false }],
  ['copilot-cli', { type: 'stdio', command: 'node', args: A, tools: ['*'], env: ENV },      { type: 'stdio', command: 'node', args: A, tools: ['*'] }],
];

describe('ENTRY_SHAPES', () => {
  it('covers exactly the nine shapes', () => {
    expect(Object.keys(ENTRY_SHAPES).sort()).toEqual(CASES.map(c => c[0]).sort());
  });

  it.each(CASES)('%s: fixture output, in upstream key order', (shape, withEnv, withoutEnv) => {
    const out = ENTRY_SHAPES[shape](L);
    expect(out).toEqual(withEnv);
    expect(Object.keys(out)).toEqual(Object.keys(withEnv));
    const empty = ENTRY_SHAPES[shape](E);
    expect(empty).toEqual(withoutEnv);
    expect(Object.keys(empty)).toEqual(Object.keys(withoutEnv));
  });

  it('opencode in a V2 (native) file has no enabled', () => {
    expect(ENTRY_SHAPES.opencode(L, { native: true })).toEqual({ type: 'local', command: ['node', ...A], environment: ENV });
  });

  it('never shares arrays or objects with the launch', () => {
    const out = ENTRY_SHAPES.standard(L);
    expect(out.args).not.toBe(L.args);
    expect(out.env).not.toBe(L.env);
  });
});

describe('readLaunch', () => {
  it('reads the command-plus-args form and the command-array form', () => {
    expect(readLaunch({ command: 'node', args: A, env: ENV })).toEqual(L);
    expect(readLaunch({ type: 'local', command: ['node', ...A], environment: ENV })).toEqual(L);
    expect(readLaunch({ command: 'npx' })).toEqual({ command: 'npx', args: [], env: {} });
  });

  it('ignores an env that is not a map of strings (a TOML inline-table marker)', () => {
    expect(readLaunch({ command: 'node', args: A, env: true })).toEqual(E);
  });

  it('is null for anything that is not a local launch', () => {
    for (const v of [null, 'x', [], { url: 'https://x' }, { command: '' }, { command: [] }, { command: 'node', args: 'x' }, { command: ['node', 1] }]) {
      expect(readLaunch(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe('isShapeCurrent', () => {
  it('the current output of every shape is current', () => {
    for (const [shape] of CASES) expect(isShapeCurrent(shape, ENTRY_SHAPES[shape](L)), shape).toBe(true);
    expect(isShapeCurrent('opencode', ENTRY_SHAPES.opencode(L, { native: true }), { native: true })).toBe(true);
  });

  it("our old OpenCode entry (command string + args + env) is stale", () => {
    expect(isShapeCurrent('opencode', { type: 'local', command: 'node', args: A, env: ENV })).toBe(false);
  });

  it("today's Codex table (type + npx, no env) is stale", () => {
    expect(isShapeCurrent('codex', { type: 'stdio', command: 'npx', args: ['-y', 'airtable-user-mcp'] })).toBe(false);
  });

  it('keys the user added do not make an entry stale', () => {
    expect(isShapeCurrent('cline', { ...ENTRY_SHAPES.cline(L), autoApprove: ['list_bases'] })).toBe(true);
  });

  it('an entry that is not a local launch is never current', () => {
    expect(isShapeCurrent('standard', { url: 'https://x' })).toBe(false);
  });
});
