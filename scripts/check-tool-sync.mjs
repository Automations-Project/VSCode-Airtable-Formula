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

ok(`${Object.keys(mcpCategories).length} tools / ${Object.keys(mcpProfiles).length} profiles / ${mcpLabelKeys.size} labels in sync; profile counts (${expected['read-only']}/${expected['safe-write']}/${expected.full}) match package.json${storeSrc ? ' + webview defaults' : ''}.`);
