import * as fs from 'fs';
import { writeTextAtomic } from './atomic-write.js';
import { parseJsonc, pruneEmptyObjects, readTextIfExists, setJsoncValue } from './jsonc-config.js';
import { configureMcpToml, readMcpTomlEntry, unconfigureMcpToml } from './lsp-config.js';
import {
  MCP_CLIENTS, resolveConfigPath, samePath, type LegacyLocation, type McpClientRow, type PathContext,
} from './mcp-clients.js';
import { ENTRY_SHAPES, isShapeCurrent, readLaunch, type LocalLaunch } from './mcp-entry-shapes.js';
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
  launcher: { script: string; config: string };    // ~/.airtable-user-mcp/start.mjs, ~/.airtable-user-mcp/bundled-path.json
  /** File identity for "one file under two names"; defaults to fs.statSync (bigint, so NTFS ids keep every bit). */
  stat?: (p: string) => { dev: number | bigint; ino: number | bigint };
}

export interface FoundEntry { entry: Record<string, unknown>; legacy: boolean; native: boolean }

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
  if (current) return { ...current, legacy: false };
  for (const loc of legacyLocations(row, deps)) {
    const old = await findAt(row, loc, name, owns);
    if (old) return { ...old, legacy: true };
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
 */
export async function setServerEntry(
  row: McpClientRow,
  name: string,
  build: ((loc: { native: boolean }) => Record<string, unknown>) | null,
  deps: WriterDeps,
  owns?: Owns,
): Promise<void> {
  if (build) assertDetected(row, deps);
  const legacy = legacyLocations(row, deps);
  await assertLegacyParses(row, legacy, name);
  await editCurrent(row, name, build, deps, owns);
  for (const loc of legacy) await removeAtLegacy(row, loc, name, owns);
}

async function editCurrent(
  row: McpClientRow,
  name: string,
  build: ((loc: { native: boolean }) => Record<string, unknown>) | null,
  deps: WriterDeps,
  owns: Owns | undefined,
): Promise<void> {
  const file = resolveConfigPath(row, deps.ctx, deps.exists);
  if (row.format === 'toml') {
    const key = row.serversPath[0];
    if (build) await configureMcpToml(file, key, name, build({ native: false }));
    else if (await tomlRemovable(file, key, name, owns)) await unconfigureMcpToml(file, key, name);
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
    next = setJsoncValue(next, [...at.path, name], build({ native: at.native }), format, file);
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

export async function configureMcpClient(row: McpClientRow, launch: LocalLaunch, deps: WriterDeps): Promise<void> {
  await setServerEntry(row, MCP_SERVER_NAME, (loc) => ENTRY_SHAPES[row.shape](launch, loc), deps);
}

export async function unconfigureMcpClient(row: McpClientRow, deps: WriterDeps): Promise<void> {
  await setServerEntry(row, MCP_SERVER_NAME, null, deps);
}

/**
 * configured: our entry exists somewhere we look. healthy: it is where and how this row reads it,
 * and what it launches is there. Any error (a file that does not parse) is not-configured, so an
 * unparsable file is never auto-healed.
 */
export async function readMcpClientHealth(row: McpClientRow, deps: WriterDeps): Promise<{ configured: boolean; healthy: boolean }> {
  try {
    const found = await readServerEntry(row, MCP_SERVER_NAME, deps);
    if (!found) return { configured: false, healthy: false };
    if (found.legacy) return { configured: true, healthy: false };
    const launch = readLaunch(found.entry);
    if (!launch) return { configured: true, healthy: true }; // not a local launch: not ours to judge
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
