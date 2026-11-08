import * as fs from 'fs';
import * as path from 'path';
import { withFileLock, writeTextAtomic } from './atomic-write.js';
import { parseJsonc, pruneEmptyObjects, readTextIfExists, setJsoncValue } from './jsonc-config.js';
import { configureMcpToml, readMcpTomlEntry, unconfigureMcpToml } from './lsp-config.js';
import {
  MCP_CLIENTS, pathKey, resolveConfigPath, samePath, type LegacyLocation, type McpClientRow, type PathContext,
} from './mcp-clients.js';
import { ENTRY_SHAPES, isShapeCurrent, readLaunch, type EntryShapeId, type LocalLaunch, type ShapeContext } from './mcp-entry-shapes.js';
import { openCodeEntryPaths, openCodeWritePath } from './opencode-layout.js';

/**
 * Writes, finds and removes one server entry for any row of the client table: the detection guard,
 * the current location (OpenCode's V1/V2 layouts included), the old places we wrote before the port,
 * and the health the dashboard and the activation auto-heal read. Every write is a read-modify-write
 * through writeTextAtomic, skipped when the text did not change.
 */

export const MCP_SERVER_NAME = 'airtable-user-mcp';

export interface WriterDeps {
  ctx: PathContext;
  exists: (p: string) => boolean;                  // fs.existsSync in the host
  /**
   * ~/.airtable-user-mcp/start.mjs and bundled-path.json, and the browser profile our entries put in
   * AIRTABLE_PROFILE_DIR (default: `.chrome-profile` beside the launcher, where buildServerEntry puts it).
   */
  launcher: { script: string; config: string; profileDir?: string };
  /** File identity for "one file under two names"; defaults to fs.statSync (bigint, so NTFS ids keep every bit). */
  stat?: (p: string) => { dev: number | bigint; ino: number | bigint };
}

/**
 * `readByClient`: the client may read that location. Only the row's explicit legacy locations
 * (Amp's nested key, `~/.codex` when CODEX_HOME points elsewhere) are places it never reads; a
 * sibling config file of the same client (OpenCode's opencode.json, Kilo's kilo.json, MCPorter's
 * other file) counts as read, the safe side for an entry the user wrote there.
 */
export interface FoundEntry { entry: Record<string, unknown>; legacy: boolean; native: boolean; readByClient: boolean }

/**
 * What `build` gets: the container's layout and whatever is already under the name there (in
 * TOML, our table as readMcpTomlEntry reads it). `build` may throw to refuse; nothing is written.
 */
export interface BuildContext { native: boolean; existing?: unknown }

/**
 * Which entries under a name are ours. Without one, everything under the name is (our local
 * entry has a name nobody else uses); the official 'airtable' entry passes one that matches the
 * official URL, so a user's own 'airtable' server is never read or removed as ours.
 */
export type Owns = (entry: Record<string, unknown>) => boolean;

interface Container { path: readonly string[]; native: boolean }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i]);

const hostStat = (p: string) => fs.statSync(p, { bigint: true });

/** A value under the name may be removed: anything, or with `owns` only an entry it claims. */
const removable = (v: unknown, owns: Owns | undefined): boolean => (owns ? isPlainObject(v) && owns(v) : true);

/** The TOML twin of `removable`: our table, read back, is claimed. */
async function tomlRemovable(file: string, key: string, name: string, owns: Owns | undefined): Promise<boolean> {
  if (!owns) return true;
  const entry = await readMcpTomlEntry(file, key, name);
  return entry !== null && owns(entry);
}

/**
 * One file under two names. samePath first; when both exist, the same dev+ino too, because
 * samePath is case-sensitive on darwin while APFS usually is not, and a path can be a symlink.
 * Fail safe: an inode of 0 (FAT, some network shares) or a stat that fails proves nothing, so
 * it counts as the same file. Every caller then skips the location: a missed cleanup leaves a
 * copy the next Setup can move, a wrong one would delete the entry the client reads.
 */
function sameFile(a: string, b: string, deps: WriterDeps): boolean {
  if (samePath(deps.ctx, a, b)) return true;
  if (!deps.exists(a) || !deps.exists(b)) return false;
  try {
    const stat = deps.stat ?? hostStat;
    const sa = stat(a);
    const sb = stat(b);
    if (String(sa.ino) === '0' || String(sb.ino) === '0') return true;
    return String(sa.dev) === String(sb.dev) && String(sa.ino) === String(sb.ino);
  } catch {
    return true;
  }
}

function valueAt(doc: Record<string, unknown>, jsonPath: readonly string[]): unknown {
  let cur: unknown = doc;
  for (const seg of jsonPath) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** The containers holding `name` (or, for a plain row, the one that would): OpenCode's at a row's own servers path, else that path. */
function containersAt(row: McpClientRow, serversPath: readonly string[], doc: Record<string, unknown>, name: string, file: string): Container[] {
  if (row.layout === 'opencode' && sameSegments(serversPath, row.serversPath)) return openCodeEntryPaths(doc, name, file);
  return [{ path: serversPath, native: false }];
}

function assertDetected(row: McpClientRow, deps: WriterDeps): void {
  if (!isClientDetected(row, deps)) throw new Error(`${row.label} was not found on this machine; nothing was written.`);
}

export function isClientDetected(row: McpClientRow, deps: WriterDeps): boolean {
  return row.detect(deps.ctx).some((p) => deps.exists(p));
}

/**
 * Places we wrote before that are not the current one: the row's own legacy list, plus the
 * candidate files (preferExisting and the global path) that did not win. Only existing files,
 * never the current container, and never a file another row reads as its own.
 */
export function legacyLocations(row: McpClientRow, deps: WriterDeps): LegacyLocation[] {
  const { ctx, exists } = deps;
  const current = resolveConfigPath(row, ctx, exists);
  const candidates = [...(row.preferExisting?.(ctx) ?? []), row.globalPath(ctx)]
    .map((p): LegacyLocation => ({ path: p, serversPath: row.serversPath }));
  const others = MCP_CLIENTS.filter((r) => r.id !== row.id).map((r) => resolveConfigPath(r, ctx, exists));
  const out: LegacyLocation[] = [];
  for (const loc of [...(row.legacy?.(ctx) ?? []), ...candidates]) {
    if (!exists(loc.path)) continue;
    if (sameFile(loc.path, current, deps) && sameSegments(loc.serversPath, row.serversPath)) continue;
    if (others.some((o) => sameFile(loc.path, o, deps))) continue;
    if (out.some((l) => sameFile(l.path, loc.path, deps) && sameSegments(l.serversPath, loc.serversPath))) continue;
    out.push(loc);
  }
  return out;
}

async function findAt(row: McpClientRow, loc: LegacyLocation, name: string, owns?: Owns): Promise<{ entry: Record<string, unknown>; native: boolean } | null> {
  if (row.format === 'toml') {
    const entry = await readMcpTomlEntry(loc.path, loc.serversPath[0], name);
    return entry && (!owns || owns(entry)) ? { entry, native: false } : null;
  }
  const text = await readTextIfExists(loc.path);
  if (text === null) return null;
  const doc = parseJsonc(text, row.format, loc.path);
  for (const c of containersAt(row, loc.serversPath, doc, name, loc.path)) {
    const v = valueAt(doc, [...c.path, name]);
    if (isPlainObject(v) && (!owns || owns(v))) return { entry: v, native: c.native };
  }
  return null;
}

/** Our entry at the current location first, then at a legacy one. Throws when a file does not parse. */
export async function readServerEntry(row: McpClientRow, name: string, deps: WriterDeps, owns?: Owns): Promise<FoundEntry | null> {
  const current = await findAt(row, { path: resolveConfigPath(row, deps.ctx, deps.exists), serversPath: row.serversPath }, name, owns);
  if (current) return { ...current, legacy: false, readByClient: true };
  const unread = row.legacy?.(deps.ctx) ?? [];
  for (const loc of legacyLocations(row, deps)) {
    const old = await findAt(row, loc, name, owns);
    if (!old) continue;
    const dead = unread.some((u) => sameFile(u.path, loc.path, deps) && sameSegments(u.serversPath, loc.serversPath));
    return { ...old, legacy: true, readByClient: !dead };
  }
  return null;
}

/**
 * Writes `name` at the current location (`build` gets the container's layout), or with
 * `build === null` removes it from every current container. Either way it is then removed from
 * every legacy location, so a reconfigure moves a pre-port copy (Amp's mcp.servers.airtable,
 * with its token) instead of leaving it behind. Writing needs a detected client. Removal never
 * creates a file, and prunes only at legacy locations, so a Remove leaves `mcpServers: {}` in
 * the current file. Every legacy file is parsed before the first write. With `owns`, only the
 * entries it claims are removed; the write itself still replaces whatever holds the name there.
 * Calls on one current file run one at a time (withFileLock), the OpenCode LSP writes included.
 */
export async function setServerEntry(
  row: McpClientRow,
  name: string,
  build: ((loc: BuildContext) => Record<string, unknown>) | null,
  deps: WriterDeps,
  owns?: Owns,
): Promise<void> {
  if (build) assertDetected(row, deps);
  await withFileLock(pathKey(deps.ctx, resolveConfigPath(row, deps.ctx, deps.exists)), async () => {
    const legacy = legacyLocations(row, deps);
    await assertLegacyParses(row, legacy, name);
    await editCurrent(row, name, build, deps, owns);
    for (const loc of legacy) await removeAtLegacy(row, loc, name, owns);
  });
}

async function editCurrent(
  row: McpClientRow,
  name: string,
  build: ((loc: BuildContext) => Record<string, unknown>) | null,
  deps: WriterDeps,
  owns: Owns | undefined,
): Promise<void> {
  const file = resolveConfigPath(row, deps.ctx, deps.exists);
  if (row.format === 'toml') {
    const key = row.serversPath[0];
    if (build) {
      const existing = (await readMcpTomlEntry(file, key, name)) ?? undefined;
      // Our own table keeps the user's other lines and sub-tables; build renders the managed keys.
      const carry = existing && owns?.(existing) ? { drop: STALE_KEYS[row.shape] ?? [] } : undefined;
      await configureMcpToml(file, key, name, build({ native: false, existing }), carry);
    } else if (await tomlRemovable(file, key, name, owns)) {
      await unconfigureMcpToml(file, key, name);
    }
    return;
  }
  const format = row.format;
  const text = await readTextIfExists(file);
  if (text === null && !build) return;
  const before = text ?? '';
  const doc = parseJsonc(before, format, file);
  let next = before;
  let at: Container | null = null;
  if (build) {
    at = row.layout === 'opencode' ? openCodeWritePath(doc, name, file) : { path: row.serversPath, native: false };
    const target = [...at.path, name];
    const old = valueAt(doc, target);
    const value = build({ native: at.native, existing: old });
    // An unchanged entry is not re-set, so an Update never reformats it.
    if (JSON.stringify(old) !== JSON.stringify(value)) next = setJsoncValue(next, target, value, format, file);
  }
  // A removal clears every current container. A write clears OpenCode's other layout, where a
  // copy would be a second, stale server of the same name.
  for (const c of containersAt(row, row.serversPath, doc, name, file)) {
    if (at && sameSegments(c.path, at.path)) continue;
    if (!removable(valueAt(doc, [...c.path, name]), owns)) continue;
    next = setJsoncValue(next, [...c.path, name], undefined, format, file);
  }
  if (next !== before) await writeTextAtomic(file, next);
}

/** Removes `name` at a legacy location, pruning the objects our removal emptied along its servers path. */
async function removeAtLegacy(row: McpClientRow, loc: LegacyLocation, name: string, owns: Owns | undefined): Promise<void> {
  if (row.format === 'toml') {
    if (await tomlRemovable(loc.path, loc.serversPath[0], name, owns)) await unconfigureMcpToml(loc.path, loc.serversPath[0], name);
    return;
  }
  const format = row.format;
  const text = await readTextIfExists(loc.path);
  if (text === null) return;
  const doc = parseJsonc(text, format, loc.path);
  let next = text;
  for (const c of containersAt(row, loc.serversPath, doc, name, loc.path)) {
    if (!removable(valueAt(doc, [...c.path, name]), owns)) continue;
    const removed = setJsoncValue(next, [...c.path, name], undefined, format, loc.path);
    // Prune only after our own removal: an empty object the user left there is theirs.
    if (removed !== next) next = pruneEmptyObjects(removed, c.path, format, loc.path);
  }
  if (next !== text) await writeTextAtomic(loc.path, next);
}

/** Parses every legacy JSON file before the first write, so a broken one aborts with nothing written. */
async function assertLegacyParses(row: McpClientRow, locs: readonly LegacyLocation[], name: string): Promise<void> {
  if (row.format === 'toml') return;
  for (const loc of locs) {
    const text = await readTextIfExists(loc.path);
    if (text !== null) containersAt(row, loc.serversPath, parseJsonc(text, row.format, loc.path), name, loc.path);
  }
}

/** No env, or one holding none of the keys we manage (the user added their own). */
const holdsNoManagedEnv = (env: unknown): boolean =>
  env === undefined || (isPlainObject(env) && !Object.keys(env).some((k) => MANAGED_ENV_KEYS.has(k)));

/**
 * The block main's Codex writer emitted, which carries no other mark of ours: type, command and
 * args matched exactly. Main never wrote an env, so an env of the user's own keys keeps it ours
 * (Update then keeps those keys); one setting a key we manage is the user's own configuration.
 */
function isMainEraCodexBlock(entry: Record<string, unknown>): boolean {
  const args = entry.args;
  return entry.type === 'stdio' && entry.command === 'npx'
    && Array.isArray(args) && args.length === 2 && args[0] === '-y' && args[1] === 'airtable-user-mcp'
    && holdsNoManagedEnv(entry.env) && holdsNoManagedEnv(entry.environment);
}

/** The browser profile dir our entries set in AIRTABLE_PROFILE_DIR. */
function ourProfileDir(deps: WriterDeps): string {
  const P = deps.ctx.platform === 'win32' ? path.win32 : path.posix;
  return deps.launcher.profileDir ?? P.join(P.dirname(deps.launcher.script), '.chrome-profile');
}

/**
 * Whether an entry under our name is one the extension wrote. Every entry we write (main's too)
 * sets both AIRTABLE_HEADLESS_ONLY=1 and AIRTABLE_PROFILE_DIR to our profile, or launches the
 * stable launcher, and main's Codex block is matched exactly. Anything else is the user's own (a
 * standalone npx entry with its own env, one that only copies the headless flag, an add-mcp
 * entry): health does not judge it, and nothing rewrites or moves it unasked.
 */
export function isOurEntry(entry: Record<string, unknown>, deps: WriterDeps): boolean {
  const env = isPlainObject(entry.env) ? entry.env : isPlainObject(entry.environment) ? entry.environment : {};
  if (env.AIRTABLE_HEADLESS_ONLY === '1' && typeof env.AIRTABLE_PROFILE_DIR === 'string'
    && samePath(deps.ctx, env.AIRTABLE_PROFILE_DIR, ourProfileDir(deps))) return true;
  const target = readLaunch(entry)?.args[0];
  if (target !== undefined && samePath(deps.ctx, target, deps.launcher.script)) return true;
  return isMainEraCodexBlock(entry);
}

// ── Merging into an entry we wrote ──────────────────────────────────────────

/** Every env key the extension writes (buildServerEntry / buildNpxServerEntry). The rest of an env is the user's. */
export const MANAGED_ENV_KEYS: ReadonlySet<string> = new Set([
  'AIRTABLE_HEADLESS_ONLY',
  'AIRTABLE_PROFILE_DIR',
  'AIRTABLE_BROWSER_CHANNEL',
  'AIRTABLE_BROWSER_PATH',
  'AIRTABLE_AUTH_MODE',
  'AIRTABLE_HTTP_CLIENT',
  'AIRTABLE_BROWSER_IDLE_PARK_MS',
]);

/** Keys an older shape of ours wrote and the current one does not (main's Codex `type`; OpenCode's and fx's `args`/`env`). */
const STALE_KEYS: Readonly<Partial<Record<EntryShapeId, readonly string[]>>> = {
  codex: ['type'],
  opencode: ['args', 'env'],
  fx: ['args', 'env'],
};

/** Shape keys the user may set (a server switched off in Cline, OpenCode or fx; Copilot's tool filter): their value wins. */
const USER_VALUE_KEYS: ReadonlySet<string> = new Set(['disabled', 'enabled', 'tools']);

/** Every key a shape can write, env included where an empty one is omitted. */
function shapeKeys(shape: EntryShapeId): Set<string> {
  const sample: LocalLaunch = { command: 'c', args: ['a'], env: { K: 'v' } };
  return new Set([...Object.keys(ENTRY_SHAPES[shape](sample, { native: false })), ...Object.keys(ENTRY_SHAPES[shape](sample, { native: true }))]);
}

/** Our managed env keys from `ours`, every other string key of the existing env (env or OpenCode's environment), in their order. */
function mergeEnv(existing: Record<string, unknown>, ours: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const env of [existing.env, existing.environment]) {
    if (!isPlainObject(env)) continue;
    for (const [k, v] of Object.entries(env)) {
      if (k in out) continue;
      if (MANAGED_ENV_KEYS.has(k)) { if (k in ours) out[k] = ours[k]; }
      else if (typeof v === 'string') out[k] = v;
    }
  }
  for (const [k, v] of Object.entries(ours)) if (!(k in out)) out[k] = v;
  return out;
}

/**
 * Our entry, written over one we wrote before: the shape's keys are set in place, stale keys of
 * ours go, every other key stays, and a user's `disabled` / `enabled` / `tools` value wins over
 * the shape's default. Key order is the existing entry's, new keys last.
 */
export function mergeOurEntry(shape: EntryShapeId, existing: Record<string, unknown>, launch: LocalLaunch, ctx: ShapeContext): Record<string, unknown> {
  const fresh = ENTRY_SHAPES[shape]({ ...launch, env: mergeEnv(existing, launch.env) }, ctx);
  const managed = new Set([...shapeKeys(shape), ...(STALE_KEYS[shape] ?? [])]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (!managed.has(k) || USER_VALUE_KEYS.has(k)) out[k] = v;
    else if (k in fresh) out[k] = fresh[k];
  }
  for (const [k, v] of Object.entries(fresh)) if (!(k in out)) out[k] = v;
  return out;
}

/** Only a caller that obtained explicit replacement consent may clear foreign duplicates. */
export interface McpConfigureOptions { replaceForeign?: boolean }

/**
 * Setup writes our entry in the row's shape. Over an entry we wrote it merges (mergeOurEntry; in
 * TOML the shape's keys with the merged env, and the writer carries the user's other lines over);
 * over anything else it replaces. Secondary/legacy cleanup moves only copies we wrote,
 * unless the caller explicitly opted into replacing foreign duplicates after user confirmation.
 */
export async function configureMcpClient(row: McpClientRow, launch: LocalLaunch, deps: WriterDeps, options: McpConfigureOptions = {}): Promise<void> {
  const ours = (e: Record<string, unknown>) => isOurEntry(e, deps);
  await setServerEntry(row, MCP_SERVER_NAME, ({ native, existing }) => {
    if (!isPlainObject(existing) || !ours(existing)) return ENTRY_SHAPES[row.shape](launch, { native });
    if (row.format === 'toml') return ENTRY_SHAPES[row.shape]({ ...launch, env: mergeEnv(existing, launch.env) }, { native });
    return mergeOurEntry(row.shape, existing, launch, { native });
  }, deps, options.replaceForeign === true ? undefined : ours);
}

export async function unconfigureMcpClient(row: McpClientRow, deps: WriterDeps): Promise<void> {
  await setServerEntry(row, MCP_SERVER_NAME, null, deps);
}

/**
 * configured: an entry under our name exists somewhere we look. healthy: it is where and how this
 * row reads it, and what it launches is there. Only an entry we wrote (isOurEntry) is judged; any
 * other is healthy ("not ours to judge"), so the activation auto-heal never rewrites it. Any error
 * (a file that does not parse) is not-configured, so an unparsable file is never auto-healed.
 */
export async function readMcpClientHealth(row: McpClientRow, deps: WriterDeps): Promise<{ configured: boolean; healthy: boolean }> {
  try {
    const found = await readServerEntry(row, MCP_SERVER_NAME, deps);
    if (!found) return { configured: false, healthy: false };
    // The user's own entry is not ours to judge, but one where the client never looks is no setup.
    if (!isOurEntry(found.entry, deps)) return found.readByClient ? { configured: true, healthy: true } : { configured: false, healthy: false };
    if (found.legacy) return { configured: true, healthy: false };
    const launch = readLaunch(found.entry);
    if (!launch) return { configured: true, healthy: true };
    if (!isShapeCurrent(row.shape, found.entry, { native: found.native })) return { configured: true, healthy: false };
    if (launch.command === 'npx') return { configured: true, healthy: true };
    const target = launch.args[0];
    if (target === undefined) return { configured: true, healthy: true };
    if (samePath(deps.ctx, target, deps.launcher.script)) {
      return { configured: true, healthy: deps.exists(deps.launcher.script) && deps.exists(deps.launcher.config) };
    }
    return { configured: true, healthy: deps.exists(target) };
  } catch {
    return { configured: false, healthy: false };
  }
}
