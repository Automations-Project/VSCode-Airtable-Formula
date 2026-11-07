#!/usr/bin/env node
/**
 * Drift check between our MCP client table
 * (packages/extension/src/auto-config/mcp-clients.ts) and its upstream,
 * neondatabase/add-mcp `src/agents.ts`, pinned by commit in
 * scripts/mcp-clients-upstream.json.
 *
 * The upstream file is parsed and hashed as TEXT, never evaluated, imported or
 * installed. Upstream computes each agent's config path in code (join(home, ...),
 * env fallbacks, platform branches), so there is no path table to diff: instead
 * the snapshot pins a SHA-256 of the helper section (everything before
 * `export const agents`) and one per agent block. A changed hash means "read
 * the diff and decide"; the decision (ported or not, under which id, why) lives
 * in the snapshot next to the hash. Code after the agents object
 * (`getAgentTypes`, prompts) is CLI plumbing, not paths or shapes, and is not
 * hashed.
 *
 * Pure functions first; the CLI (`main`) is at the bottom.
 *
 *   pnpm check:mcp-clients             offline: snapshot <-> table <-> attribution headers
 *   pnpm check:mcp-clients:upstream    network: has upstream moved past the pin?
 *   pnpm record:mcp-clients            network: re-pin (keeps our decisions, flags new agents)
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const UPSTREAM_REPO = 'neondatabase/add-mcp';
export const UPSTREAM_FILE = 'src/agents.ts';
export const SNAPSHOT_PATH = 'scripts/mcp-clients-upstream.json';
export const TABLE_PATH = 'packages/extension/src/auto-config/mcp-clients.ts';
export const ATTRIBUTED_FILES = [
  TABLE_PATH,
  'packages/extension/src/auto-config/mcp-entry-shapes.ts',
  'packages/extension/src/auto-config/opencode-layout.ts',
];
export const MIN_AGENTS = 20;

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Split agents.ts into the helper section and one block per agent. Text only.
 * Agent heads are exactly-two-space-indented keys (bare, "quoted" or 'quoted'),
 * so nested four-space keys never match.
 */
export function splitAgentsSource(text) {
  const src = text.replace(/\r\n/g, '\n');
  const at = src.indexOf('\nexport const agents');
  if (at < 0) throw new Error("no 'export const agents' in agents.ts");
  const start = at + 1;
  const helper = src.slice(0, start).trimEnd();
  const endAt = src.indexOf('\n};', start);
  const body = src.slice(start, endAt < 0 ? src.length : endAt);
  const heads = [...body.matchAll(/^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*)): \{$/gm)];
  const agents = heads.map((head, i) => ({
    id: head[1] ?? head[2] ?? head[3],
    block: body.slice(head.index, i + 1 < heads.length ? heads[i + 1].index : body.length).trimEnd(),
  }));
  if (agents.length < MIN_AGENTS) {
    throw new Error(
      `extracted ${agents.length} agents from agents.ts, expected at least ${MIN_AGENTS}: upstream reformatted? Parse by hand before re-pinning.`,
    );
  }
  return { helper, agents };
}

export function hashAgentsSource(text) {
  const { helper, agents } = splitAgentsSource(text);
  const sorted = [...agents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    helperSha256: sha256(helper),
    agents: Object.fromEntries(sorted.map(a => [a.id, sha256(a.block)])),
  };
}

const sortedIds = ids => [...ids].sort();

export function diffSnapshot(snapshot, hashed) {
  const pinned = snapshot.agents ?? {};
  const now = hashed.agents;
  return {
    added: sortedIds(Object.keys(now).filter(k => !(k in pinned))),
    removed: sortedIds(Object.keys(pinned).filter(k => !(k in now))),
    changed: sortedIds(Object.keys(now).filter(k => k in pinned && pinned[k].sha256 !== now[k])),
    helperChanged: snapshot.helperSha256 !== hashed.helperSha256,
  };
}

export function formatDriftReport(diff, { pinned, latest }) {
  const list = ids => (ids.length ? ids.join(', ') : '-');
  return [
    `add-mcp ${UPSTREAM_FILE} changed since ${pinned.slice(0, 7)} (now ${latest.slice(0, 7)})`,
    `  added:   ${list(diff.added)}`,
    `  removed: ${list(diff.removed)}`,
    `  changed: ${list(diff.changed)}`,
    `  helper section changed: ${diff.helperChanged ? 'yes' : 'no'}`,
    `  compare: https://github.com/${UPSTREAM_REPO}/compare/${pinned}...${latest}`,
    `Review the diff, update ${TABLE_PATH}, then run pnpm record:mcp-clients.`,
  ].join('\n');
}

/** Row literals begin `{ id: '<id>', upstream: '<id>' | null,`; the format is pinned by a test on the table. */
export function extractTableRows(tsText) {
  const re = /\{\s*id:\s*'([a-z0-9-]+)',\s*upstream:\s*(?:'([a-z0-9-]+)'|null)\s*,/g;
  const rows = [...tsText.matchAll(re)].map(m => ({ id: m[1], upstream: m[2] ?? null }));
  if (rows.length === 0) throw new Error('no rows found in mcp-clients.ts');
  return rows;
}

/** Problems (one string each, naming the id) between the snapshot, the table rows and the attribution headers. */
export function checkOffline({ snapshot, rows, files }) {
  const problems = [];
  const agents = snapshot.agents ?? {};
  const oursOnly = snapshot.oursOnly ?? [];
  const rowIds = new Set(rows.map(r => r.id));

  if (!/^[0-9a-f]{40}$/.test(snapshot.ref ?? '')) problems.push(`snapshot ref '${snapshot.ref}' is not 40 lowercase hex`);
  if (!/^[0-9a-f]{64}$/.test(snapshot.helperSha256 ?? '')) problems.push('snapshot helperSha256 is not 64 lowercase hex');

  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`${r.id}: duplicate row id`);
    seen.add(r.id);
  }

  for (const [aid, a] of Object.entries(agents)) {
    if (a.ported) {
      if (!a.ourId) problems.push(`${aid}: ported but has no ourId`);
      else if (!rowIds.has(a.ourId)) problems.push(`${aid}: ourId '${a.ourId}' names no row`);
    } else if (!a.reason) {
      problems.push(`${aid}: not ported but has no reason`);
    }
  }

  for (const r of rows) {
    if (r.upstream === null) {
      if (!oursOnly.includes(r.id)) problems.push(`${r.id}: upstream is null but the id is not in oursOnly`);
      continue;
    }
    const a = agents[r.upstream];
    if (!a) problems.push(`${r.id}: upstream '${r.upstream}' is not in the snapshot`);
    else if (!a.ported) problems.push(`${r.id}: upstream '${r.upstream}' is not ported`);
    else if (a.ourId !== r.id) problems.push(`${r.id}: upstream '${r.upstream}' maps to our '${a.ourId}', not '${r.id}'`);
  }

  for (const id of oursOnly) {
    if (!rowIds.has(id)) problems.push(`${id}: listed in oursOnly but has no row`);
  }

  const needles = [UPSTREAM_REPO, snapshot.ref, 'Apache License, Version 2.0'];
  for (const path of ATTRIBUTED_FILES) {
    const text = files[path];
    if (text == null) {
      problems.push(`${path}: file is missing`);
      continue;
    }
    const head = text.replace(/\r\n/g, '\n').split('\n').slice(0, 40).join('\n');
    const lacking = needles.filter(n => !head.includes(n));
    if (lacking.length) problems.push(`${path}: attribution header (first 40 lines) lacks ${lacking.map(n => `'${n}'`).join(', ')}`);
  }

  return problems;
}

/** New snapshot from a fresh hash: keeps our decisions, replaces the pin and every hash. */
export function recordSnapshot(previous, hashed, ref) {
  const prev = previous ?? { agents: {}, oursOnly: [] };
  const agents = {};
  for (const id of Object.keys(hashed.agents).sort()) {
    const old = prev.agents?.[id];
    if (!old) {
      agents[id] = { sha256: hashed.agents[id], ported: false, reason: `added upstream at ${ref}; not reviewed` };
      continue;
    }
    agents[id] = { sha256: hashed.agents[id], ported: old.ported };
    for (const key of ['ourId', 'reason', 'note']) if (old[key] !== undefined) agents[id][key] = old[key];
  }
  return {
    upstream: UPSTREAM_REPO,
    file: UPSTREAM_FILE,
    ref,
    helperSha256: hashed.helperSha256,
    agents,
    oursOnly: prev.oursOnly ?? [],
  };
}

const SHORT = sha => sha.slice(0, 7);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function defaultIo(root) {
  return {
    fetch: (url, init) => fetch(url, init),
    readFile: rel => readFile(resolve(root, rel), 'utf8'),
    writeFile: (rel, text) => writeFile(resolve(root, rel), text),
    log: m => console.log(m),
    error: m => console.error(m),
    env: process.env,
  };
}

async function readOrNull(io, rel) {
  try {
    return await io.readFile(rel);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function runOffline(io) {
  const snapshotText = await readOrNull(io, SNAPSHOT_PATH);
  if (snapshotText === null) {
    io.error(`✗ check-mcp-clients: ${SNAPSHOT_PATH} is missing; run pnpm record:mcp-clients`);
    return 1;
  }
  const snapshot = JSON.parse(snapshotText);
  const rows = extractTableRows((await readOrNull(io, TABLE_PATH)) ?? '');
  const files = {};
  for (const path of ATTRIBUTED_FILES) files[path] = await readOrNull(io, path);
  const problems = checkOffline({ snapshot, rows, files });
  if (problems.length) {
    io.error(`✗ check-mcp-clients:\n${problems.map(p => `  - ${p}`).join('\n')}`);
    return 1;
  }
  const all = Object.values(snapshot.agents);
  const ported = all.filter(a => a.ported).length;
  io.log(
    `✓ check-mcp-clients: ${rows.length} rows agree with add-mcp@${SHORT(snapshot.ref)} (${ported} ported, ${snapshot.oursOnly.length} ours only, ${all.length - ported} not ported)`,
  );
  return 0;
}

async function get(io, url, headers) {
  const res = await io.fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res;
}

async function resolveRef(io, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${ref}`;
  const headers = { Accept: 'application/vnd.github+json' };
  if (io.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${io.env.GITHUB_TOKEN}`;
  const { sha } = await (await get(io, url, headers)).json();
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`GET ${url} -> no commit sha in the response`);
  return sha;
}

async function runUpstream(io, argv) {
  const refArg = argv.find(a => a.startsWith('--ref='));
  const ref = refArg ? refArg.slice('--ref='.length) : 'main';
  let sha;
  let hashed;
  try {
    sha = await resolveRef(io, ref);
    hashed = hashAgentsSource(await (await get(io, `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${sha}/${UPSTREAM_FILE}`)).text());
  } catch (err) {
    io.error(`✗ check-mcp-clients: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  const snapshotText = await readOrNull(io, SNAPSHOT_PATH);

  if (argv.includes('--record')) {
    const next = recordSnapshot(snapshotText === null ? null : JSON.parse(snapshotText), hashed, sha);
    await io.writeFile(SNAPSHOT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    io.log(
      `recorded ${Object.keys(next.agents).length} agents at ${SHORT(sha)}; review any agent marked "not reviewed", update the attribution headers to the new ref, then run pnpm check:mcp-clients`,
    );
    return 0;
  }

  if (snapshotText === null) {
    io.error(`✗ check-mcp-clients: ${SNAPSHOT_PATH} is missing; run pnpm record:mcp-clients`);
    return 1;
  }
  const snapshot = JSON.parse(snapshotText);
  const diff = diffSnapshot(snapshot, hashed);
  if (diff.added.length || diff.removed.length || diff.changed.length || diff.helperChanged) {
    io.error(formatDriftReport(diff, { pinned: snapshot.ref, latest: sha }));
    return 1;
  }
  io.log(
    `✓ check-mcp-clients: add-mcp ${UPSTREAM_FILE} at ${SHORT(sha)} matches the pin ${SHORT(snapshot.ref)} (helper + ${Object.keys(hashed.agents).length} agents)`,
  );
  return 0;
}

export async function main(argv = process.argv.slice(2), io, root = ROOT) {
  io ??= defaultIo(root);
  try {
    return argv.includes('--upstream') ? await runUpstream(io, argv) : await runOffline(io);
  } catch (err) {
    io.error(`✗ check-mcp-clients: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code));
}
