// One Agent-Skills folder (`airtable-formula/`) copied into every AI client's
// skills directory. The directory table is generated at build time from
// vercel-labs/skills (`agent-dirs.json`, `pnpm generate:agent-dirs`); the only
// hand-kept rows are EXTRA_AGENTS. Every function takes a SkillEnv (home,
// workspace, version, detected IDEs) instead of reading os/vscode state, so
// tests run on a temp dir.
import * as fs from 'fs';
import * as path from 'path';
import type { IdeId } from '@airtable-formula/shared';
import agentDirs from './agent-dirs.json';

// TODO(task4): import from @airtable-formula/shared
export type AiSkillStatus = 'installed' | 'outdated' | 'missing' | 'unsupported';
export interface AiSkill { status: AiSkillStatus; version?: string }
export type SkillScope = 'global' | 'project';
export interface AiSkillClient {
  id: string;
  name: string;
  ideId?: IdeId;
  dir: string;
  status: 'installed' | 'outdated' | 'missing' | 'absent';
  canonical: boolean;
}

export interface AgentDirEntry {
  id: string;
  name: string;
  project: string;                  // workspace-relative skills dir, forward slashes
  global: string | null;            // symbolic ('~/…'), null = the client has no global skills dir
  universal: boolean;               // project dir is the standard .agents/skills
  readsCanonicalGlobally: boolean;  // also reads ~/.agents/skills
}

export const SKILL_DIR_NAME = 'airtable-formula';

export interface SkillEnv {
  home: string;                       // os.homedir() at runtime
  workspaceRoot: string | null;       // first workspace folder, or null
  version: string;                    // extension version
  skillSourceDir: string;             // <extensionPath>/dist/skills/airtable-formula
  detectedIdes: readonly IdeId[];
  xdgConfigHome?: string;             // process.env.XDG_CONFIG_HOME
}

/** Clients Vercel's table lacks. Same shape as agent-dirs.json; a row here overrides a JSON row with the same id. */
export const EXTRA_AGENTS: AgentDirEntry[] = [
  { id: 'windsurf-next', name: 'Windsurf Next', project: '.windsurf/skills', global: '~/.codeium/windsurf-next/skills', universal: false, readsCanonicalGlobally: false },
];

/** Our IDE detection → the table's agent ids. IDEs not listed have no skills directory (`unsupported`). */
export const IDE_TO_AGENTS: Partial<Record<IdeId, string[]>> = {
  'cursor':        ['cursor'],
  'windsurf':      ['windsurf'],
  'windsurf-next': ['windsurf-next'],
  'cline':         ['cline'],
  'claude-code':   ['claude-code'],
  'amp':           ['amp'],
  'opencode':      ['opencode'],
  'codex-cli':     ['codex'],
  'zed':           ['zed'],
};

/** Workspace files the old per-IDE writer created. Deleted by a `project`-scope install/remove only. */
export const LEGACY_WORKSPACE_FILES: readonly string[] = [
  '.cursor/rules/airtable-formula-skill.mdc',
  '.cursor/rules/airtable-formula-rules.mdc',
  '.cursor/rules/airtable-formula-workflow.mdc',
  '.windsurf/skills/airtable-formula.md',
  '.windsurf/rules/airtable-formula.md',
  '.windsurf/workflows/airtable-formula.md',
  '.devin/skills/airtable-formula.md',
  '.devin/rules/airtable-formula.md',
  '.devin/workflows/airtable-formula.md',
  '.clinerules/airtable-formula-skill.md',
  '.clinerules/airtable-formula-rules.md',
];

// ── helpers ──────────────────────────────────────────────────────────────────

const CANONICAL_GLOBAL = '~/.agents/skills';
const CANONICAL_PROJECT = '.agents/skills';
const VERSION_PLACEHOLDER = 'version: 0.0.0-dev';
const CURSOR_POINTER_RULE = '.cursor/rules/airtable-formula.mdc';

// Every IdeId, so checkSkill answers for all of them (the Record type makes a missing id a compile error).
const ALL_IDES = Object.keys({
  'cursor': 0, 'windsurf': 0, 'windsurf-next': 0, 'claude-code': 0, 'claude-desktop': 0, 'cline': 0,
  'amp': 0, 'opencode': 0, 'codex-cli': 0, 'zed': 0, 'helix': 0, 'neovim': 0,
} satisfies Record<IdeId, 0>) as IdeId[];

const TABLE: AgentDirEntry[] = [...new Map(
  [...(agentDirs.agents as AgentDirEntry[]), ...EXTRA_AGENTS].map(a => [a.id, a]),
).values()];
const AGENT_BY_ID = new Map(TABLE.map(a => [a.id, a]));
const IDE_BY_AGENT = new Map(
  Object.entries(IDE_TO_AGENTS).flatMap(([ide, ids]) => ids.map(id => [id, ide as IdeId] as const)),
);

type DirStatus = { status: 'installed' | 'outdated' | 'missing'; version?: string };
type Failure = { dir: string; message: string };
const SEVERITY = { installed: 0, outdated: 1, missing: 2 } as const;

function canonicalDir(scope: SkillScope, env: SkillEnv, ws: string): string {
  return scope === 'global' ? expandHome(CANONICAL_GLOBAL, env) : path.join(ws, CANONICAL_PROJECT);
}

/** The native skills dir an agent reads in this scope, or null when it has none. */
function agentDir(agent: AgentDirEntry, scope: SkillScope, env: SkillEnv, ws: string): string | null {
  if (scope === 'project') return path.join(ws, agent.project);
  return agent.global ? expandHome(agent.global, env) : null;
}

/** Agents mapped from the IDEs we detected (rule 2), in detection order. */
function detectedAgents(env: SkillEnv): AgentDirEntry[] {
  const ids = new Set(env.detectedIdes.flatMap(ide => IDE_TO_AGENTS[ide] ?? []));
  return [...ids].flatMap(id => AGENT_BY_ID.get(id) ?? []);
}

/**
 * Rule 3 (global scope only): the parent of the agent's skills dir exists. Skipped
 * for the standard folder itself (it exists after the first install) and when the
 * parent is ~ or ~/.config (always present).
 */
function parentExists(dir: string, canonical: string, env: SkillEnv): boolean {
  if (dir === canonical) return false;
  const parent = path.dirname(dir);
  const skip = [path.join(env.home), path.join(env.home, '.config'), env.xdgConfigHome && path.join(env.xdgConfigHome)];
  return !skip.includes(parent) && fs.existsSync(parent);
}

/** Every agent found in this scope that has a dir in it: rule 2 in detection order, then rule 3 in table order. */
function foundAgents(scope: SkillScope, env: SkillEnv, ws: string): AgentDirEntry[] {
  const found = detectedAgents(env).filter(a => agentDir(a, scope, env, ws));
  if (scope === 'global') {
    const canonical = canonicalDir(scope, env, ws);
    for (const agent of TABLE) {
      const dir = agentDir(agent, scope, env, ws);
      if (dir && !found.includes(agent) && parentExists(dir, canonical, env)) found.push(agent);
    }
  }
  return found;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `<dir>/airtable-formula/SKILL.md` once per dir; the version comes from the frontmatter only. */
function statusReader(version: string): (dir: string) => DirStatus {
  const cache = new Map<string, DirStatus>();
  return dir => {
    let hit = cache.get(dir);
    if (!hit) {
      hit = readStatus(dir, version);
      cache.set(dir, hit);
    }
    return hit;
  };
}

function readStatus(dir: string, version: string): DirStatus {
  let text: string;
  try { text = fs.readFileSync(path.join(dir, SKILL_DIR_NAME, 'SKILL.md'), 'utf8'); } catch { return { status: 'missing' }; }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const found = /^\s+version:\s*["']?([^"'\s]+)/m.exec(frontmatter)?.[1];
  if (!found) return { status: 'outdated' };
  return { status: found === version ? 'installed' : 'outdated', version: found };
}

const TMP_PREFIX = `.${SKILL_DIR_NAME}.tmp-`;

/** Best-effort removal of every `.airtable-formula.tmp-*` in `target`, whichever process (or crash) left it. */
function clearTmpDirs(target: string): void {
  let names: string[];
  try { names = fs.readdirSync(target); } catch { return; }
  for (const name of names.filter(n => n.startsWith(TMP_PREFIX))) {
    try { fs.rmSync(path.join(target, name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** Copy the skill into `<target>/.airtable-formula.tmp-<pid>`, stamp the version, then swap it in. */
function installInto(target: string, env: SkillEnv): void {
  const final = path.join(target, SKILL_DIR_NAME);
  const tmp = path.join(target, `${TMP_PREFIX}${process.pid}`);
  try {
    clearTmpDirs(target);
    fs.rmSync(tmp, { recursive: true, force: true });   // strict for our own: never copy into a leftover
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(env.skillSourceDir, tmp, { recursive: true });
    const skillMd = path.join(tmp, 'SKILL.md');
    fs.writeFileSync(skillMd, fs.readFileSync(skillMd, 'utf8').replace(VERSION_PLACEHOLDER, `version: ${env.version}`));
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort; the next install clears it */ }
    throw err;
  }
}

function cursorPointerRule(version: string): string {
  return [
    '---',
    'description: "Airtable formulas: use the airtable-formula skill"',
    'globs: ["**/*.formula"]',
    'alwaysApply: false',
    '---',
    '',
    'When working on Airtable formulas (`.formula`, `.min.formula`, `.ultra-min.formula` files), read',
    '`.agents/skills/airtable-formula/SKILL.md` and follow it, opening the files in its `references/` folder as it directs.',
    `Written by the Airtable Formula extension ${version}; every skill install rewrites this file.`,
    '',
  ].join('\n');
}

/** Deletes `files` that exist; records what went and what could not. */
function removeFiles(files: string[], removed: string[], failed: Failure[]): void {
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { recursive: true, force: true });
      removed.push(file);
    } catch (err) {
      failed.push({ dir: file, message: messageOf(err) });
    }
  }
}

function legacyFiles(ws: string): string[] {
  return LEGACY_WORKSPACE_FILES.map(rel => path.join(ws, rel));
}

/**
 * Project scope writes and deletes inside a repository the user did not author,
 * and fs calls follow symbolic links (junctions on Windows), so a committed
 * `.cursor/rules -> ~/.ssh` would redirect us outside the workspace. Walks `abs`
 * from the workspace root one component at a time; returns the refusal message
 * when an existing component is a link, else null. Global scope never calls this.
 */
function symlinkRefusal(ws: string, abs: string): string | null {
  const rel = path.relative(ws, abs);
  let cur = ws;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    let isLink: boolean;
    try { isLink = fs.lstatSync(cur).isSymbolicLink(); } catch { return null; }   // missing: nothing below it exists
    if (isLink) return `refused: ${rel.split(path.sep).join('/')} contains a symbolic link`;
  }
  return null;
}

/** `files` minus the ones symlinkRefusal rejects; rejections are recorded when `failed` is given. */
function withoutSymlinks(ws: string, files: string[], failed?: Failure[]): string[] {
  return files.filter(file => {
    const refused = symlinkRefusal(ws, file);
    if (refused && failed) failed.push({ dir: file, message: refused });
    return !refused;
  });
}

// ── exports ──────────────────────────────────────────────────────────────────

/** `~` → home; a leading `~/.config` → XDG_CONFIG_HOME when set (mirrors xdg-basedir). Native separators. */
export function expandHome(p: string, env: Pick<SkillEnv, 'home' | 'xdgConfigHome'>): string {
  if (env.xdgConfigHome && /^~\/\.config(\/|$)/.test(p)) return path.join(env.xdgConfigHome, p.slice('~/.config'.length));
  if (p === '~' || p.startsWith('~/')) return path.join(env.home, p.slice(1));
  return path.join(p);
}

/**
 * `targets`: the skills dirs install writes (canonical first). `byIde`: for every
 * mapped IDE, detected or not, the dirs its agents read in this scope.
 */
export function resolveTargets(scope: SkillScope, env: SkillEnv): { targets: string[]; byIde: Partial<Record<IdeId, string[]>> } {
  const ws = env.workspaceRoot;
  if (scope === 'project' && !ws) return { targets: [], byIde: {} };
  const base = ws ?? '';
  const dirs = foundAgents(scope, env, base).flatMap(a => agentDir(a, scope, env, base) ?? []);
  const targets = [...new Set([canonicalDir(scope, env, base), ...dirs])];
  const byIde: Partial<Record<IdeId, string[]>> = {};
  for (const [ide, ids] of Object.entries(IDE_TO_AGENTS) as [IdeId, string[]][]) {
    const read = ids.flatMap(id => {
      const agent = AGENT_BY_ID.get(id);
      return (agent && agentDir(agent, scope, env, base)) ?? [];
    });
    if (read.length) byIde[ide] = [...new Set(read)];
  }
  return { targets, byIde };
}

type InstallResult = { written: string[]; failed: Failure[]; noWorkspace?: true };
let inflight: Promise<InstallResult> | null = null;

/**
 * Installs into every target, continuing past failures. One run at a time per
 * process: a call made while one is running gets that run's result.
 */
export async function installSkill(scope: SkillScope, env: SkillEnv): Promise<InstallResult> {
  if (!inflight) inflight = runInstall(scope, env).finally(() => { inflight = null; });
  return inflight;
}

async function runInstall(scope: SkillScope, env: SkillEnv): Promise<InstallResult> {
  const ws = env.workspaceRoot;
  if (scope === 'project' && !ws) return { written: [], failed: [], noWorkspace: true };
  const written: string[] = [];
  const failed: Failure[] = [];
  for (const target of resolveTargets(scope, env).targets) {
    const final = path.join(target, SKILL_DIR_NAME);
    const refused = scope === 'project' && ws ? symlinkRefusal(ws, final) : null;
    if (refused) { failed.push({ dir: target, message: refused }); continue; }
    try {
      installInto(target, env);
      written.push(final);
    } catch (err) {
      failed.push({ dir: target, message: messageOf(err) });
    }
  }
  if (scope === 'project' && ws) {
    if (env.detectedIdes.includes('cursor')) {
      const rule = path.join(ws, CURSOR_POINTER_RULE);
      const refused = symlinkRefusal(ws, rule);
      if (refused) failed.push({ dir: path.dirname(rule), message: refused });
      else {
        try {
          fs.mkdirSync(path.dirname(rule), { recursive: true });
          fs.writeFileSync(rule, cursorPointerRule(env.version), 'utf8');
        } catch (err) {
          failed.push({ dir: path.dirname(rule), message: messageOf(err) });
        }
      }
    }
    removeFiles(withoutSymlinks(ws, legacyFiles(ws)), [], failed);
  }
  return { written, failed };
}

/** Per-IDE status: worst of its agents' dirs; IDEs with no mapping are `unsupported`. Never writes. */
export async function checkSkill(scope: SkillScope, env: SkillEnv): Promise<Record<IdeId, AiSkill>> {
  const noWorkspace = scope === 'project' && !env.workspaceRoot;
  const { byIde } = resolveTargets(scope, env);
  const read = statusReader(env.version);
  const result = {} as Record<IdeId, AiSkill>;
  for (const ide of ALL_IDES) {
    const dirs = byIde[ide];
    if (noWorkspace && IDE_TO_AGENTS[ide]) { result[ide] = { status: 'missing' }; continue; }
    if (!dirs) { result[ide] = { status: 'unsupported' }; continue; }
    const worst = dirs.map(read).reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a));
    result[ide] = worst.version ? { status: worst.status, version: worst.version } : { status: worst.status };
  }
  return result;
}

/** Deletes `<target>/airtable-formula` (and, in project scope, the pointer rule and legacy files). Never the parents. */
export async function removeSkill(scope: SkillScope, env: SkillEnv): Promise<{ removed: string[]; failed: Failure[] }> {
  const removed: string[] = [];
  const failed: Failure[] = [];
  const ws = env.workspaceRoot;
  const folders = resolveTargets(scope, env).targets.map(t => path.join(t, SKILL_DIR_NAME));
  if (scope === 'global') removeFiles(folders, removed, failed);
  else if (ws) {
    removeFiles(withoutSymlinks(ws, [...folders, path.join(ws, CURSOR_POINTER_RULE)], failed), removed, failed);
    removeFiles(withoutSymlinks(ws, legacyFiles(ws)), removed, failed);
  }
  return { removed, failed };
}

/**
 * The whole-machine view (spec §8): the standard folder, then one row per client
 * that has a skills dir in this scope. Found clients carry their folder's status,
 * the rest are `absent`. `dir` is the table's symbolic form, never a native path.
 */
export async function listSkillClients(scope: SkillScope, env: SkillEnv): Promise<AiSkillClient[]> {
  const ws = env.workspaceRoot;
  if (scope === 'project' && !ws) return [];
  const base = ws ?? '';
  const read = statusReader(env.version);
  const found = foundAgents(scope, env, base);
  const detected = new Set(detectedAgents(env));

  const standard: AiSkillClient = {
    id: 'agents', name: 'Standard skills folder',
    dir: scope === 'global' ? CANONICAL_GLOBAL : CANONICAL_PROJECT,
    status: read(canonicalDir(scope, env, base)).status, canonical: true,
  };
  const row = (agent: AgentDirEntry, present: boolean): AiSkillClient => {
    const ideId = IDE_BY_AGENT.get(agent.id);
    return {
      id: agent.id, name: agent.name,
      ...(ideId ? { ideId } : {}),
      dir: scope === 'global' ? agent.global! : agent.project,
      status: present ? read(agentDir(agent, scope, env, base)!).status : 'absent',
      canonical: scope === 'global' ? agent.readsCanonicalGlobally : agent.universal,
    };
  };
  const byName = (a: AgentDirEntry, b: AgentDirEntry) => a.name.localeCompare(b.name, 'en');
  // A client with no skills dir in this scope (a null `global`) can never receive the skill here, so it gets no row.
  const absent = TABLE.filter(a => !found.includes(a) && agentDir(a, scope, env, base));
  return [
    standard,
    ...found.filter(a => detected.has(a)).map(a => row(a, true)),
    ...found.filter(a => !detected.has(a)).sort(byName).map(a => row(a, true)),
    ...absent.sort(byName).map(a => row(a, false)),
  ];
}
