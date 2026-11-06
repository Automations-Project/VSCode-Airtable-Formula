#!/usr/bin/env node
/**
 * Generate packages/extension/src/skills/agent-dirs.json: the table of AI-client
 * skill directories the extension installs into.
 *
 * The data source is vercel-labs/skills `src/agents.ts` at a pinned commit,
 * fetched from raw GitHub and parsed as TEXT (never executed). Bumping
 * SKILLS_REF is a deliberate, reviewed act: regenerate, read the diff, commit.
 *
 *   node scripts/generate-agent-dirs.mjs           # (re)write the JSON
 *   node scripts/generate-agent-dirs.mjs --check   # fail if the committed JSON is stale
 *
 * ponytail: this hand-rolled text parse exists because `skills` is not a
 * dependency. When the extension can depend on it, delete this script and read
 * `import('skills').getSupportedAgents()` instead.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix, win32 } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_FILE = resolve(ROOT, 'packages/extension/src/skills/agent-dirs.json');

export const SKILLS_REF = 'd3701c11b1101251af14c9d148f026e1a47ebe17';
// Agents whose global dir is computed at runtime (env/platform dependent) and so
// cannot be tabulated. The set is pinned: any other skip means the parser drifted.
export const EXPECTED_SKIPPED = ['openclaw', 'reasonix'];
export const MIN_AGENTS = 70;

const SOURCE_URL = `https://raw.githubusercontent.com/vercel-labs/skills/${SKILLS_REF}/src/agents.ts`;
const SOURCE_LABEL = `vercel-labs/skills@${SKILLS_REF} src/agents.ts`;
const UNIVERSAL_PROJECT_DIR = '.agents/skills';

function str(block, key) {
  const m = block.match(new RegExp(String.raw`\b${key}:\s*(?:'([^']*)'|"([^"]*)")`));
  return m ? (m[1] ?? m[2]) : null;
}

/** Base-directory identifiers declared at the top of agents.ts, as `~`-relative paths. */
function parseBases(text) {
  const bases = { home: '~', configHome: '~/.config' };
  const envHome = /^const (\w+) = process\.env\.\w+\?\.trim\(\) \|\| join\(home, '([^']+)'\);$/gm;
  for (const m of text.matchAll(envHome)) bases[m[1]] = `~/${m[2]}`;
  return bases;
}

/** `{ path }` for a parsed expression, `{ expr }` (the offending text) when unparseable. */
function parseGlobalDir(block, bases) {
  const m = block.match(/\bglobalSkillsDir:[ \t]*([^\r\n]*)/);
  if (!m) return { expr: '<missing>' };
  const rest = m[1].trim();
  if (/^undefined\b/.test(rest)) return { path: null };
  const join = rest.match(/^join\((\w+)((?:\s*,\s*'[^']*')+)\s*\)/);
  if (join && join[1] in bases) {
    const segments = [...join[2].matchAll(/'([^']*)'/g)].map(s => s[1]);
    return { path: [bases[join[1]], ...segments].join('/') };
  }
  const call = rest.match(/^\w+\([^)]*\)/);
  return { expr: call ? call[0] : rest.replace(/[\s,}]+$/, '') };
}

export function parseAgentsSource(text) {
  const bases = parseBases(text);
  const start = text.indexOf('export const agents');
  if (start < 0) throw new Error("no 'export const agents' object found");
  const end = text.indexOf('\n};', start);
  const body = text.slice(start, end < 0 ? text.length : end);

  const heads = [...body.matchAll(/(?<![\w.])name: '([^']+)',/g)];
  const agents = [];
  const skipped = [];
  heads.forEach((head, i) => {
    const id = head[1];
    const block = body.slice(head.index, i + 1 < heads.length ? heads[i + 1].index : body.length);
    const name = str(block, 'displayName');
    const project = str(block, 'skillsDir');
    if (name === null || project === null) throw new Error(`entry '${id}' has no displayName/skillsDir`);
    const dir = parseGlobalDir(block, bases);
    if ('expr' in dir) {
      skipped.push({ id, reason: `unparsed globalSkillsDir: ${dir.expr}` });
      return;
    }
    const universal = project === UNIVERSAL_PROJECT_DIR;
    agents.push({
      id,
      name,
      project,
      global: dir.path,
      universal,
      readsCanonicalGlobally: universal && !block.includes('globalReadsCanonical: false'),
    });
  });
  agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { agents, skipped };
}

export function assertExpectedShape({ agents, skipped }) {
  const got = skipped.map(s => s.id).sort();
  const want = [...EXPECTED_SKIPPED].sort();
  if (got.join(',') !== want.join(',')) {
    throw new Error(`skipped ids [${got.join(', ')}] != expected [${want.join(', ')}]`);
  }
  if (agents.length < MIN_AGENTS) {
    throw new Error(`${agents.length} agents parsed, expected at least ${MIN_AGENTS}`);
  }
  // The installer joins `project` onto the workspace and expands `global` from ~: anything else would write elsewhere.
  for (const { id, project, global } of agents) {
    if (!project || posix.isAbsolute(project) || win32.isAbsolute(project) || project.split(/[\/]/).includes('..')) {
      throw new Error(`agent '${id}' project dir '${project}' must be a non-empty workspace-relative path without '..'`);
    }
    if (global !== null && !global.startsWith('~/')) {
      throw new Error(`agent '${id}' global dir '${global}' must be null or start with '~/'`);
    }
  }
}

function die(msg) {
  console.error(`\x1b[31m✗ generate-agent-dirs: ${msg}\x1b[0m`);
  process.exit(1);
}

export async function main(argv = process.argv.slice(2)) {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) die(`GET ${SOURCE_URL} -> HTTP ${res.status}`);
  const parsed = parseAgentsSource(await res.text());
  try {
    assertExpectedShape(parsed);
  } catch (err) {
    die(err.message);
  }
  const json = `${JSON.stringify({ source: SOURCE_LABEL, agents: parsed.agents, skipped: parsed.skipped }, null, 2)}\n`;

  if (argv.includes('--check')) {
    // Tolerate CRLF checkouts (autocrlf) when comparing against the LF output.
    const committed = (await readFile(OUT_FILE, 'utf8').catch(() => null))?.replace(/\r\n/g, '\n');
    if (committed !== json) die('packages/extension/src/skills/agent-dirs.json is stale; run `pnpm generate:agent-dirs`');
    console.log(`\x1b[32m✓ generate-agent-dirs: ${parsed.agents.length} agents up to date\x1b[0m`);
    return;
  }
  await writeFile(OUT_FILE, json);
  console.log(`generate-agent-dirs: wrote ${parsed.agents.length} agents, ${parsed.skipped.length} skipped -> ${OUT_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => die(err.message));
}
