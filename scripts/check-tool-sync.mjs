#!/usr/bin/env node
/**
 * Verify that the extension's tool-category mirror at
 * packages/extension/src/mcp/tool-profile.ts is in sync with the
 * source-of-truth at packages/mcp-server/src/tool-config.js.
 *
 * Runs as part of the top-level build. Fails the build if:
 *   - Any tool in tool-config.js is missing from tool-profile.ts (or vice versa).
 *   - Any tool has a different category on either side (after key normalization).
 *   - Counts declared in packages/extension/package.json (profile descriptions)
 *     don't match the actual number of tools in each profile's categories.
 *
 * Output is concise by default; pass --verbose to print the full table.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const verbose = process.argv.includes('--verbose');

function die(msg) {
  console.error(`\x1b[31m✗ check-tool-sync: ${msg}\x1b[0m`);
  process.exit(1);
}
function ok(msg) {
  console.log(`\x1b[32m✓ check-tool-sync: ${msg}\x1b[0m`);
}

// 1. Import the authoritative TOOL_CATEGORIES + profiles + labels from the mcp-server source.
const mcpToolConfigUrl = pathToFileURL(
  resolve(ROOT, 'packages/mcp-server/src/tool-config.js')
).href;
const {
  TOOL_CATEGORIES: mcpCategories,
  BUILTIN_PROFILES: mcpProfiles,
  CATEGORY_LABELS: mcpLabels,
} = await import(mcpToolConfigUrl);

// 1b. Cross-check the mcp-server's OWN tool surface (index.js) against the
//     category map. tool-config.js is the authority for *gating*, but index.js is
//     where a tool actually exists — and `enabledToolNames()` iterates
//     TOOL_CATEGORIES, so a tool that is defined AND handled in index.js but absent
//     from the category map is yielded by nothing: `isToolEnabled()` returns false
//     for it in EVERY profile, `full` included. It is registered and permanently
//     uncallable.
//
//     That is exactly how `manage_daemon` shipped dead while this script printed
//     green. Every check from step 2 down walks tool-config.js and its mirrors, so
//     they compare the map against copies of itself — a tool belonging to no
//     category is invisible to all of them. This step is the only one that looks at
//     the server's real surface, so it is the only one that can catch it.
//
//     Extraction is line-anchored rather than a real JS parse: this script is
//     dependency-free, and index.js cannot simply be imported (top-level await,
//     an attach-proxy prologue, and it starts a server). Regex on source would
//     normally be too brittle to trust — but here it is fail-safe *because the
//     comparison runs in both directions*. An under-matching pattern drops tools
//     that tool-config.js still lists → reported as "no definition/handler". An
//     over-matching one invents names tool-config.js does not have → reported as
//     "in no category". Neither can produce a false PASS. The one case both
//     directions would miss is a reformat that makes a pattern match *nothing*,
//     which reads as "everything is missing" — so it is caught explicitly, and
//     loudly, before the comparison runs.
const serverSrc = await readFile(
  resolve(ROOT, 'packages/mcp-server/src/index.js'),
  'utf8'
);

// Tool definitions: entries of the top-level `const TOOLS = [...]` array. Each is
// an object literal at 2-space indent whose first key is `name` at 4-space indent.
// `manage_tools` deliberately does NOT match — it lives in its own MANAGE_TOOLS_DEF
// const at 2-space indent (see META_TOOLS below).
const definedTools = new Set(
  [...serverSrc.matchAll(/^ {4}name: '([a-z_][a-z0-9_]*)',$/gm)].map(m => m[1])
);
// Handlers: members of the top-level `const handlers = {...}` object, all of the
// form `  async <name>({...}) {` at 2-space indent.
const handlerTools = new Set(
  [...serverSrc.matchAll(/^ {2}async ([a-z_][a-z0-9_]*)\(/gm)].map(m => m[1])
);

// Meta-tools are exempt BY DESIGN, not by oversight: `manage_tools` is always
// enabled (isToolEnabled() short-circuits it) and ListTools appends its definition
// separately, so it must never appear in TOOL_CATEGORIES. Any tool added here needs
// the same deliberate always-on wiring — do not use this to silence a real failure.
const META_TOOLS = new Set(['manage_tools']);

if (definedTools.size === 0) {
  die(
    'extracted ZERO tool definitions from packages/mcp-server/src/index.js — the ' +
    "`    name: 'x',` pattern no longer matches (was the TOOLS array reformatted or renamed?). " +
    'Refusing to pass: a guard that silently matches nothing is worse than no guard. ' +
    'Fix the pattern in scripts/check-tool-sync.mjs.'
  );
}
if (handlerTools.size === 0) {
  die(
    'extracted ZERO tool handlers from packages/mcp-server/src/index.js — the ' +
    '`  async name(` pattern no longer matches (was the `handlers` object reformatted or renamed?). ' +
    'Refusing to pass: a guard that silently matches nothing is worse than no guard. ' +
    'Fix the pattern in scripts/check-tool-sync.mjs.'
  );
}

const serverProblems = [];
for (const tool of definedTools) {
  if (META_TOOLS.has(tool)) continue;
  if (!mcpCategories[tool]) {
    serverProblems.push(
      `${tool}: defined in index.js TOOLS but in NO category in tool-config.js — ` +
      'enabledToolNames() iterates TOOL_CATEGORIES, so this tool is UNCALLABLE in every profile including `full`'
    );
  }
}
for (const tool of Object.keys(mcpCategories)) {
  if (!definedTools.has(tool)) {
    serverProblems.push(`${tool}: categorized in tool-config.js but has no definition in index.js TOOLS`);
  }
  if (!handlerTools.has(tool)) {
    serverProblems.push(`${tool}: categorized in tool-config.js but has no handler in index.js \`handlers\``);
  }
}
for (const tool of handlerTools) {
  if (META_TOOLS.has(tool)) continue;
  if (!mcpCategories[tool]) {
    serverProblems.push(
      `${tool}: has a handler in index.js but is in NO category in tool-config.js — unreachable, no profile can expose it`
    );
  }
}

if (serverProblems.length) {
  console.error('\n\x1b[31mmcp-server tool surface (index.js) is out of sync with tool-config.js:\x1b[0m');
  for (const msg of serverProblems) console.error(`  - ${msg}`);
  console.error(
    '\nFix: every tool needs ALL THREE of\n' +
    '  packages/mcp-server/src/index.js       ← a TOOLS[] definition AND a handlers{} entry\n' +
    '  packages/mcp-server/src/tool-config.js ← a TOOL_CATEGORIES entry (a tool with no category is dead code)\n' +
    'then the mirrors listed in CLAUDE.md "Keeping tool categories in sync".\n'
  );
  process.exit(1);
}

// 1c. The MCP Registry manifest (packages/mcp-server/server.json) carries its own
//     `tools` array, and it is PUBLISHED — `mcp-publisher publish` reads this file,
//     so it is the tool list strangers see on registry.modelcontextprotocol.io.
//     Nothing generated it and nothing checked it, so it sat at 32 of 71 tools.
//     Only the NAME SET is guarded: the blurbs are free prose (deliberately shorter
//     than index.js's model-facing descriptions) and would produce false failures on
//     ordinary copy edits — the same "keys only" rule already used for
//     CATEGORY_LABELS below. `manage_tools` is included because the registry lists
//     what a client can actually call, and the meta-tool is always callable.
const registryManifest = JSON.parse(
  await readFile(resolve(ROOT, 'packages/mcp-server/server.json'), 'utf8')
);
const registryTools = new Set((registryManifest.tools ?? []).map(t => t.name));
const expectedRegistryTools = new Set([...Object.keys(mcpCategories), ...META_TOOLS]);

const registryProblems = [
  ...[...expectedRegistryTools].filter(t => !registryTools.has(t)).map(t => `missing from server.json: ${t}`),
  ...[...registryTools].filter(t => !expectedRegistryTools.has(t)).map(t => `listed in server.json but not a real tool: ${t}`),
];
// The published npm version and the manifest version are the same artifact; a
// manifest pinned to an older release advertises a tool list that package never had.
const mcpPkgVersion = JSON.parse(
  await readFile(resolve(ROOT, 'packages/mcp-server/package.json'), 'utf8')
).version;
for (const [label, value] of [
  ['server.json "version"', registryManifest.version],
  ['server.json packages[0].version', registryManifest.packages?.[0]?.version],
]) {
  if (value !== mcpPkgVersion) {
    registryProblems.push(`${label} is "${value}" but packages/mcp-server/package.json is "${mcpPkgVersion}"`);
  }
}

if (registryProblems.length) {
  console.error('\n\x1b[31mMCP Registry manifest (packages/mcp-server/server.json) is stale:\x1b[0m');
  for (const msg of registryProblems) console.error(`  - ${msg}`);
  console.error('\nFix: update the `tools` array and `version` fields in packages/mcp-server/server.json.\n');
  process.exit(1);
}

// 2. Parse the extension's mirror from source (TypeScript — extract via brace
//    counting, not a TS transpile, to keep this script dependency-free).
const extTs = await readFile(
  resolve(ROOT, 'packages/extension/src/mcp/tool-profile.ts'),
  'utf8'
);

function extractObjectBlock(source, declaration) {
  const startIdx = source.indexOf(declaration);
  if (startIdx === -1) return null;
  const braceIdx = source.indexOf('{', startIdx + declaration.length);
  if (braceIdx === -1) return null;

  let depth = 1;
  let i = braceIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(braceIdx + 1, i - 1);
}

const blockBody = extractObjectBlock(extTs, 'export const TOOL_CATEGORIES');
if (!blockBody) die('Could not locate TOOL_CATEGORIES block in tool-profile.ts');
const extCategories = {};
for (const line of blockBody.split('\n')) {
  // Capture:  name: 'category',     (tolerates whitespace and trailing comments)
  const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s*:\s*'([^']+)'\s*,?/i);
  if (m) extCategories[m[1]] = m[2];
}

// 3. Normalization: mcp-server uses kebab-case category keys ('field-write').
//    tool-profile.ts mixes camelCase shared-type keys ('fieldWrite') for the
//    non-destructive/non-table categories that pre-existed the table/* split,
//    and kebab-case for the rest. Since the new code switches everything to
//    kebab-case, both sides should now agree without remapping — but if a
//    future change drifts, the mismatch should surface as a diff below.
function normalize(cat) {
  return cat
    .replace(/([A-Z])/g, '-$1')   // fieldWrite → field-Write
    .toLowerCase()
    .replace(/^-/, '');
}

const allTools = new Set([...Object.keys(mcpCategories), ...Object.keys(extCategories)]);
const mismatches = [];
for (const tool of allTools) {
  const m = mcpCategories[tool];
  const e = extCategories[tool];
  if (!m)            mismatches.push({ tool, issue: `exists in extension mirror but not mcp-server`, ext: e });
  else if (!e)       mismatches.push({ tool, issue: `exists in mcp-server but not extension mirror`, mcp: m });
  else if (normalize(m) !== normalize(e))
    mismatches.push({ tool, issue: `category differs`, mcp: m, ext: e });
}

if (verbose) {
  console.log('mcp-server tools:', Object.keys(mcpCategories).length);
  console.log('extension mirror:', Object.keys(extCategories).length);
}

if (mismatches.length) {
  console.error('\n\x1b[31mTool category drift detected between extension and mcp-server:\x1b[0m');
  for (const m of mismatches) {
    console.error(`  - ${m.tool}: ${m.issue}${m.mcp ? ` (mcp=${m.mcp})` : ''}${m.ext ? ` (ext=${m.ext})` : ''}`);
  }
  console.error(
    '\nFix:\n' +
    '  packages/mcp-server/src/tool-config.js      ← authoritative\n' +
    '  packages/extension/src/mcp/tool-profile.ts  ← mirror (must match)\n' +
    '  packages/extension/package.json             ← profile descriptions + counts\n' +
    '  packages/webview/src/tabs/Settings.tsx      ← toggle UI\n' +
    '  packages/shared/src/types.ts                ← ToolCategories shape\n'
  );
  process.exit(1);
}

// 4. Validate the count strings in extension/package.json against reality.
const extPkg = JSON.parse(
  await readFile(resolve(ROOT, 'packages/extension/package.json'), 'utf8')
);
const enumDescriptions =
  extPkg?.contributes?.configuration?.properties?.['airtableFormula.mcp.toolProfile']?.enumDescriptions ?? [];

function countByCats(cats) {
  const set = new Set(cats);
  return Object.values(mcpCategories).filter(c => set.has(c)).length;
}

// Drive expected counts off mcpProfiles directly so adding a new category to
// BUILTIN_PROFILES doesn't require editing this script too.
const expected = {
  'read-only':  countByCats(mcpProfiles['read-only']?.categories ?? []),
  'safe-write': countByCats(mcpProfiles['safe-write']?.categories ?? []),
  full:         countByCats(mcpProfiles.full?.categories         ?? []),
};

const countRegex = /\((\d+)\s+tools?\)/;
const found = {
  'read-only':  Number(enumDescriptions[0]?.match(countRegex)?.[1] ?? -1),
  'safe-write': Number(enumDescriptions[1]?.match(countRegex)?.[1] ?? -1),
  full:         Number(enumDescriptions[2]?.match(countRegex)?.[1] ?? -1),
};

const countMismatches = Object.entries(expected).filter(([k, v]) => v !== found[k]);
if (countMismatches.length) {
  console.error('\n\x1b[31mProfile tool counts in extension/package.json enumDescriptions are stale:\x1b[0m');
  for (const [profile, expectedN] of countMismatches) {
    console.error(`  - ${profile}: expected (${expectedN} tools), found (${found[profile]} tools)`);
  }
  process.exit(1);
}

// 5. Validate BUILTIN_PROFILES and CATEGORY_LABELS drift between mcp-server and
//    the extension mirror. A rename or category addition in mcp-server's
//    BUILTIN_PROFILES without updating tool-profile.ts would silently break
//    the dashboard profile selector.
const profilesBlock = extractObjectBlock(extTs, 'export const BUILTIN_PROFILES');
if (!profilesBlock) die('Could not locate BUILTIN_PROFILES block in tool-profile.ts');

// Extract `name: { ..., categories: [...] }` pairs from the extension mirror.
// We only compare the category arrays, since `description` is free-form prose.
const extProfiles = {};
// Normalize the block a little for regex matching: strip comments and collapse whitespace.
const stripped = profilesBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
// Naive pattern: capture either 'name' or name followed by { ... categories: [ ... ] ... },
const profileRe = /(?:'([a-z-]+)'|([a-z-][a-z0-9-]*))\s*:\s*\{[^}]*?categories\s*:\s*\[([^\]]*)\]/gi;
let pm;
while ((pm = profileRe.exec(stripped)) !== null) {
  const name = pm[1] || pm[2];
  const cats = pm[3]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  extProfiles[name] = cats;
}

const profileMismatches = [];
for (const name of new Set([...Object.keys(mcpProfiles), ...Object.keys(extProfiles)])) {
  const mcp = mcpProfiles[name]?.categories;
  const ext = extProfiles[name];
  if (!mcp) { profileMismatches.push({ name, issue: 'exists in ext mirror but not mcp-server', ext }); continue; }
  if (!ext) { profileMismatches.push({ name, issue: 'exists in mcp-server but not ext mirror', mcp }); continue; }
  const m = [...mcp].sort().join(',');
  const e = [...ext].sort().join(',');
  if (m !== e) profileMismatches.push({ name, issue: 'category list differs', mcp, ext });
}

if (profileMismatches.length) {
  console.error('\n\x1b[31mBUILTIN_PROFILES drift between extension and mcp-server:\x1b[0m');
  for (const m of profileMismatches) {
    console.error(`  - ${m.name}: ${m.issue}`);
    if (m.mcp) console.error(`      mcp:  [${m.mcp.join(', ')}]`);
    if (m.ext) console.error(`      ext:  [${m.ext.join(', ')}]`);
  }
  process.exit(1);
}

// Labels drift — compare key sets only (label text is presentation-only).
const labelsBlock = extractObjectBlock(extTs, 'export const CATEGORY_LABELS');
if (!labelsBlock) die('Could not locate CATEGORY_LABELS block in tool-profile.ts');
const extLabels = {};
const labelStripped = labelsBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const labelRe = /'([a-z-]+)'\s*:\s*'([^']+)'/gi;
let lm;
while ((lm = labelRe.exec(labelStripped)) !== null) {
  extLabels[lm[1]] = lm[2];
}

const mcpLabelKeys = new Set(Object.keys(mcpLabels));
const extLabelKeys = new Set(Object.keys(extLabels));
const labelKeyDrift = [
  ...[...mcpLabelKeys].filter(k => !extLabelKeys.has(k)).map(k => `mcp-only: ${k}`),
  ...[...extLabelKeys].filter(k => !mcpLabelKeys.has(k)).map(k => `ext-only: ${k}`),
];
if (labelKeyDrift.length) {
  console.error('\n\x1b[31mCATEGORY_LABELS key drift between extension and mcp-server:\x1b[0m');
  for (const line of labelKeyDrift) console.error(`  - ${line}`);
  process.exit(1);
}

// 6. Validate that the webview's hard-coded default SettingsSnapshot at
//    packages/webview/src/store.ts has enabledCount / totalCount numbers that
//    match the authoritative profile counts. The webview shows these on cold
//    start before the extension's first state push; if they drift, the
//    dashboard momentarily reports an incorrect tool count.
const storeSrc = await readFile(
  resolve(ROOT, 'packages/webview/src/store.ts'),
  'utf8',
).catch(() => null);

if (storeSrc) {
  // The defaults block currently looks like:
  //   toolProfile: {
  //     profile:      'safe-write',
  //     enabledCount: 26,
  //     totalCount:   36,
  //     ...
  // We extract enabledCount / totalCount from the FIRST occurrence of that
  // block to avoid matching a future additional snapshot elsewhere in the file.
  const enabledMatch = storeSrc.match(/enabledCount:\s*(\d+)/);
  const totalMatch   = storeSrc.match(/totalCount:\s*(\d+)/);
  const webviewEnabled = enabledMatch ? Number(enabledMatch[1]) : -1;
  const webviewTotal   = totalMatch   ? Number(totalMatch[1])   : -1;

  const webviewMismatches = [];
  if (webviewEnabled !== expected['safe-write']) {
    webviewMismatches.push(
      `store.ts default enabledCount=${webviewEnabled} but safe-write profile has ${expected['safe-write']} tools`,
    );
  }
  if (webviewTotal !== expected.full) {
    webviewMismatches.push(
      `store.ts default totalCount=${webviewTotal} but full profile has ${expected.full} tools`,
    );
  }
  if (webviewMismatches.length) {
    console.error('\n\x1b[31mWebview default SettingsSnapshot is stale:\x1b[0m');
    for (const msg of webviewMismatches) console.error(`  - ${msg}`);
    console.error(
      '\nFix: update `defaultSettings.mcp.toolProfile` in packages/webview/src/store.ts.',
    );
    process.exit(1);
  }
}

// 7. Validate the human-facing counts in CLAUDE.md so the guide can't drift from
//    reality (check:tool-sync used to skip it — that's how it fell out of date).
//    Only the NUMBERS are guarded; free-form prose (the category name list) is not,
//    so keep the canonical phrasings below intact when editing the doc.
const claudeMd = await readFile(resolve(ROOT, 'CLAUDE.md'), 'utf8').catch(() => null);
if (claudeMd) {
  const totalTools = Object.keys(mcpCategories).length;
  const totalCats = mcpLabelKeys.size;
  const docChecks = [
    {
      re: /\*\*(\d+) tools\*\* across (\d+) categories/,
      want: [totalTools, totalCats],
      label: 'architecture "**N tools** across M categories"',
    },
    {
      re: /`read-only`\s*\((\d+) tools?\)\s*\/\s*`safe-write`\s*\((\d+) tools?\)\s*\/\s*`full`\s*\((\d+) tools?\)/,
      want: [expected['read-only'], expected['safe-write'], expected.full],
      label: 'mcp.toolProfile "read-only / safe-write / full" tool counts',
    },
  ];
  const docMismatches = [];
  for (const { re, want, label } of docChecks) {
    const m = claudeMd.match(re);
    if (!m) {
      docMismatches.push(`could not find ${label} — keep the canonical phrasing so the guard can validate it`);
      continue;
    }
    const got = m.slice(1, 1 + want.length).map(Number);
    if (got.join('/') !== want.join('/')) {
      docMismatches.push(`${label}: found (${got.join('/')}) but expected (${want.join('/')})`);
    }
  }
  if (docMismatches.length) {
    console.error('\n\x1b[31mCLAUDE.md tool/category counts are stale:\x1b[0m');
    for (const msg of docMismatches) console.error(`  - ${msg}`);
    console.error('\nFix: update the counts in CLAUDE.md (architecture blurb + Key Settings mcp.toolProfile line).');
    process.exit(1);
  }
}

// 8. Validate the tool-count convention ("71 Airtable tools + `manage_tools`" — see
//    CLAUDE.md "Keeping tool categories in sync") in the published READMEs (the
//    Marketplace/npm listings, copied verbatim into the packaged extension and the
//    npm tarball), the AI-skill templates baked into the extension and installed
//    into user workspaces, and the hand-authored banner/architecture SVGs embedded
//    as the first element of both READMEs (referenced by raw-GitHub URLs pinned to
//    `main`, so they go live the moment a merge lands). These are user-visible
//    surfaces CLAUDE.md's guard (#7) doesn't reach, and they're exactly where the
//    "66 tools" / "13 categories" counts had gone stale — including, previously, in
//    the SVG artwork itself even after the surrounding <img alt="…"> text was fixed.
//
//    Deliberately narrow: only the canonical anchor phrases below are guarded, one
//    or two per file. The rest of each README's prose (comparison tables, per-tool
//    highlights, etc.) legitimately varies in wording and isn't a reliable regex
//    target — see the pre-merge task-4 report for why a broader guard would produce
//    false failures on ordinary copy edits. The SVG anchors (`>N tools<` / `>N
//    categories<`) are safe to match anywhere in the file precisely because these
//    are short, fixed-label text nodes with no surrounding free-form prose to
//    collide with — unlike the READMEs, there's nothing else in these files that
//    would produce a false match.
const totalTools = Object.keys(mcpCategories).length;
const totalCats = mcpLabelKeys.size;
const profileCountsRe =
  /`read-only`\s*\((\d+) tools?\)\s*\/\s*`safe-write`\s*\((\d+) tools?\)\s*\/\s*`full`\s*\((\d+) tools?\)/;
const profileCountsWant = [expected['read-only'], expected['safe-write'], expected.full];

async function checkCanonicalCounts(relPath, checks) {
  const src = await readFile(resolve(ROOT, relPath), 'utf8').catch(() => null);
  if (src === null) return [`${relPath}: file not found`];
  const problems = [];
  for (const { re, want, label, allOccurrences } of checks) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const rx = new RegExp(re.source, flags);
    let m;
    let found = 0;
    while ((m = rx.exec(src)) !== null) {
      found++;
      const got = m.slice(1, 1 + want.length).map(Number);
      if (got.join('/') !== want.join('/')) {
        problems.push(
          `${relPath}: ${label}${allOccurrences ? ` (occurrence ${found})` : ''} — found (${got.join('/')}) but expected (${want.join('/')})`
        );
      }
      if (!allOccurrences) break;
    }
    if (found === 0) {
      problems.push(`${relPath}: could not find ${label} — keep the canonical phrasing so the guard can validate it`);
    }
  }
  return problems;
}

const docCountProblems = [
  // The root README is also the SOURCE of the Marketplace listing: `package:vsix`
  // generates packages/extension/README.md from this file (SVG <img> tags stripped)
  // and that copy is gitignored, so it must NOT be guarded directly — it does not
  // exist on a fresh clone and checking it would fail CI. Guarding the source is
  // what keeps the generated copy right. The three anchors below were unguarded and
  // had gone stale in the generated artifact at 71: the subtitle and two comparison
  // tables, none of which the two checks above reach.
  ...(await checkCanonicalCounts('README.md', [
    {
      re: /### MCP Server \((\d+) Tools \+ `manage_tools`\)/,
      want: [totalTools],
      label: '"### MCP Server (N Tools + `manage_tools`)" heading',
    },
    {
      re: profileCountsRe,
      want: profileCountsWant,
      label: 'tool-profile counts "`read-only` (N tools) / `safe-write` (N tools) / `full` (N tools)"',
    },
    {
      re: /MCP server \((\d+) tools \+ `manage_tools`\)/,
      want: [totalTools],
      label: 'subtitle "MCP server (N tools + `manage_tools`)"',
    },
    {
      // "| **Total tools** | ~17 | **73** (72 + `manage_tools`) |" — this row
      // states what a client actually lists, so it is totalTools + 1 for the
      // always-on meta-tool. Both numbers are checked so they cannot drift apart.
      re: /\*\*(\d+)\*\* \((\d+) \+ `manage_tools`\)/,
      want: [totalTools + 1, totalTools],
      label: 'comparison-table "Total tools" row "**N+1** (N + `manage_tools`)"',
    },
    {
      re: /read-only \((\d+)\) \/ safe-write \((\d+)\) \/ full \((\d+)\)/,
      want: profileCountsWant,
      label: 'comparison-table profile row "read-only (N) / safe-write (N) / full (N)"',
    },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/README.md', [
    {
      re: /## Tools \((\d+) \+ `manage_tools`\)/,
      want: [totalTools],
      label: '"## Tools (N + `manage_tools`)" heading',
    },
    {
      re: profileCountsRe,
      want: profileCountsWant,
      label: 'tool-profile counts "`read-only` (N tools) / `safe-write` (N tools) / `full` (N tools)"',
    },
  ])),
  ...(await checkCanonicalCounts('packages/extension/src/skills/templates/skillTemplates.ts', [
    {
      re: /\*\*Tools\*\*:\s*(\d+) tools across (\d+) categories/,
      want: [totalTools, totalCats],
      label: '"**Tools**: N tools across M categories" header (SKILL guide + always-on rules)',
      allOccurrences: true,
    },
  ])),
  // The MCP `serverInfo.description` string is rendered in every MCP client's
  // server-info panel and ships verbatim to npm — it is the single most-visible
  // surface this guard reaches. It previously drifted to "62 tools" and a false
  // claim that record CRUD was handled by a different server (fixed pre-merge);
  // nothing guarded it before, which is exactly how it went stale unnoticed.
  ...(await checkCanonicalCounts('packages/mcp-server/src/index.js', [
    {
      re: /(\d+) Airtable tools \+ `manage_tools`/,
      want: [totalTools],
      label: 'serverInfo.description "N Airtable tools + `manage_tools`" (shown in every MCP client\'s server-info panel)',
    },
  ])),
  // The banner/architecture SVGs are hand-authored marketing graphics — the first
  // element of both published READMEs (raw-GitHub URLs pinned to `main`, so they go
  // live the moment a merge lands). They embed the same counts as plain <tspan>/<text>
  // node content, so `>N tools<` / `>N categories<` is a reliable, narrow anchor:
  // real prose never appears immediately after `>` and before ` tools<`/` categories<`
  // in these files (unlike the READMEs, there's no free-form surrounding text to
  // collide with — every text node is a short, fixed label).
  ...(await checkCanonicalCounts('packages/mcp-server/assets/banner.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" text node (stats line + MCP SERVER card)', allOccurrences: true },
    { re: />(\d+) categories</, want: [totalCats], label: '">N categories<" text node (stats line)' },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/assets/banner-dark.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" text node (stats line + MCP SERVER card)', allOccurrences: true },
    { re: />(\d+) categories</, want: [totalCats], label: '">N categories<" text node (stats line)' },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/assets/banner-light.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" text node (stats line + MCP SERVER card)', allOccurrences: true },
    { re: />(\d+) categories</, want: [totalCats], label: '">N categories<" text node (stats line)' },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/assets/architecture.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" pill label (airtable-user-mcp tier)' },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/assets/architecture-dark.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" pill label (airtable-user-mcp tier)' },
  ])),
  ...(await checkCanonicalCounts('packages/mcp-server/assets/architecture-light.svg', [
    { re: />(\d+) tools</, want: [totalTools], label: '">N tools<" pill label (airtable-user-mcp tier)' },
  ])),
];

if (docCountProblems.length) {
  console.error('\n\x1b[31mTool-count convention ("71 Airtable tools + `manage_tools`") is stale in published docs:\x1b[0m');
  for (const msg of docCountProblems) console.error(`  - ${msg}`);
  console.error(
    '\nFix: update the counts in README.md, packages/mcp-server/README.md,\n' +
    'packages/mcp-server/src/index.js (serverInfo.description), and\n' +
    'packages/extension/src/skills/templates/skillTemplates.ts. Where a sentence describes\n' +
    'what an MCP client actually lists (tools/list), 72 is correct (71 + manage_tools) — see\n' +
    'CLAUDE.md "Keeping tool categories in sync" for the convention.'
  );
  process.exit(1);
}

// The index.js counts are named explicitly so the green line is evidence the
// cross-check actually ran on a non-empty extraction — "in sync" printed over zero
// parsed tools is the exact failure mode step 1b exists to prevent.
ok(`${Object.keys(mcpCategories).length} tools / ${Object.keys(mcpProfiles).length} profiles / ${mcpLabelKeys.size} labels in sync; index.js surface (${definedTools.size} definitions / ${handlerTools.size - META_TOOLS.size} handlers) fully categorized; server.json registry manifest (${registryTools.size} tools @ v${mcpPkgVersion}) matches; profile counts (${expected['read-only']}/${expected['safe-write']}/${expected.full}) match package.json${storeSrc ? ' + webview defaults' : ''}${claudeMd ? ' + CLAUDE.md' : ''} + published READMEs + skill templates + banner/architecture SVGs.`);
