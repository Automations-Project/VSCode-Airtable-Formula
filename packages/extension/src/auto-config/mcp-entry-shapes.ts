// Ported and modified from neondatabase/add-mcp src/agents.ts (the local branch of every transform*Config)
// at 5ae1d29a406568b1dedbaa4bd3b8a6fd7ef2195c (https://github.com/neondatabase/add-mcp).
// Copyright 2025 Andre Landgraf. Licensed under the Apache License, Version 2.0;
// see packages/extension/THIRD_PARTY_NOTICES.md. Changes: local stdio entries only,
// rewritten as pure functions over a LocalLaunch, no timeout/autoApprove/oauth fields.

/** What we launch: the node + launcher entry, or the npx variant. */
export interface LocalLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type EntryShapeId =
  | 'standard'
  | 'codex'
  | 'zed'
  | 'opencode'
  | 'fx'
  | 'kimi'
  | 'typed-stdio'
  | 'cline'
  | 'copilot-cli';

export interface ShapeContext {
  /** OpenCode V2 file (`mcp.servers`): `enabled` is omitted, V2 uses `disabled`. */
  native?: boolean;
}

type Entry = Record<string, unknown>;
type ShapeFn = (launch: LocalLaunch, ctx?: ShapeContext) => Entry;

const hasEnv = (l: LocalLaunch): boolean => Object.keys(l.env).length > 0;

export const ENTRY_SHAPES: Readonly<Record<EntryShapeId, ShapeFn>> = {
  // upstream buildStandardLocal, reached through transformStandardConfig,
  // transformGeminiConfig, transformCursorConfig, transformGrokBuildConfig,
  // transformKiroCliConfig, transformJunieConfig, transformMastraCodeConfig,
  // transformPiConfig; transformAntigravityConfig builds the same output.
  standard: (l) => {
    const e: Entry = { command: l.command, args: [...l.args] };
    if (hasEnv(l)) e.env = { ...l.env };
    return e;
  },

  // upstream transformCodexConfig. Codex page (developers.openai.com/codex/mcp,
  // which now redirects to learn.chatgpt.com/docs/extend/mcp), read 2026-11-07:
  // a stdio server is a [mcp_servers.<name>] table with command, args, env
  // (plus env_vars, cwd); `type` is not listed for stdio. So no `type` here.
  codex: (l) => ({ command: l.command, args: [...l.args], env: { ...l.env } }),

  // upstream transformZedConfig. Zed page (zed.dev/docs/ai/mcp), read 2026-11-07:
  // the example under context_servers is { command, args, env } and never
  // mentions `source`; the page does not say the key is rejected, so we keep
  // upstream's source: "custom".
  zed: (l) => ({ source: 'custom', command: l.command, args: [...l.args], env: { ...l.env } }),

  // upstream transformOpenCodeConfig (and transformKiloCodeConfig, which calls
  // it without a context, so always non-native). OpenCode page
  // (opencode.ai/docs/mcp-servers), read 2026-11-07: V2 servers sit under
  // mcp.servers; a local server is type "local" with `command` as ONE array,
  // env under `environment`, and "Use `disabled`, not an `enabled` field".
  // ctx.native is that V2 form (no enabled); without it we keep upstream's
  // V1 `enabled: true`. Which one a file needs is the caller's call.
  opencode: (l, ctx) => {
    const e: Entry = { type: 'local', command: [l.command, ...l.args], environment: { ...l.env } };
    if (!ctx?.native) e.enabled = true;
    return e;
  },

  // upstream transformFxConfig (local branch; note enabled precedes environment).
  fx: (l) => {
    const e: Entry = { type: 'local', command: [l.command, ...l.args], enabled: true };
    if (hasEnv(l)) e.environment = { ...l.env };
    return e;
  },

  // upstream transformKimiCodeConfig (local branch).
  kimi: (l) => {
    const e: Entry = { transport: 'stdio', command: l.command, args: [...l.args] };
    if (hasEnv(l)) e.env = { ...l.env };
    return e;
  },

  // upstream transformFactoryDroidConfig (local branch: type, then buildStandardLocal).
  'typed-stdio': (l) => {
    const e: Entry = { type: 'stdio', command: l.command, args: [...l.args] };
    if (hasEnv(l)) e.env = { ...l.env };
    return e;
  },

  // upstream transformClineConfig (local branch).
  cline: (l) => {
    const e: Entry = { command: l.command, args: [...l.args], disabled: false };
    if (hasEnv(l)) e.env = { ...l.env };
    return e;
  },

  // upstream transformGitHubCopilotCliConfig (global scope, so includeTools).
  'copilot-cli': (l) => {
    const e: Entry = { type: 'stdio', command: l.command, args: [...l.args], tools: ['*'] };
    if (hasEnv(l)) e.env = { ...l.env };
    return e;
  },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Read a local launch back out of an existing entry; null when it is not one. */
export function readLaunch(entry: unknown): LocalLaunch | null {
  if (!isPlainObject(entry)) return null;

  let command: string;
  let args: string[];
  const c = entry.command;
  if (Array.isArray(c)) {
    if (c.length === 0 || !isStringArray(c) || c[0] === '') return null;
    [command, ...args] = c;
  } else if (typeof c === 'string' && c !== '') {
    if (entry.args !== undefined && !isStringArray(entry.args)) return null;
    command = c;
    args = entry.args ? [...(entry.args as string[])] : [];
  } else {
    return null;
  }

  const raw = entry.env ?? entry.environment;
  const env =
    isPlainObject(raw) && Object.values(raw).every((v) => typeof v === 'string')
      ? { ...(raw as Record<string, string>) }
      : {};
  return { command, args, env };
}

/**
 * True when `entry` already has the key set (and command form) this shape
 * writes. Values are not compared and extra user keys are allowed.
 */
export function isShapeCurrent(shape: EntryShapeId, entry: unknown, ctx?: ShapeContext): boolean {
  const launch = readLaunch(entry);
  if (!launch) return false;
  const expected = ENTRY_SHAPES[shape](launch, ctx);
  const actual = entry as Record<string, unknown>;
  return (
    Object.keys(expected).every((k) => Object.prototype.hasOwnProperty.call(actual, k)) &&
    Array.isArray(actual.command) === Array.isArray(expected.command)
  );
}
