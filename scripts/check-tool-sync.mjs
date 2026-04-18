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

// 1. Import the authoritative TOOL_CATEGORIES from the mcp-server source.
const mcpToolConfigUrl = pathToFileURL(
  resolve(ROOT, 'packages/mcp-server/src/tool-config.js')
).href;
const { TOOL_CATEGORIES: mcpCategories } = await import(mcpToolConfigUrl);

// 2. Parse the extension's mirror from source (TypeScript — extract via regex,
//    not a TS transpile, to keep this script dependency-free).
const extTs = await readFile(
  resolve(ROOT, 'packages/extension/src/mcp/tool-profile.ts'),
  'utf8'
);
const tableMatch = extTs.match(/export const TOOL_CATEGORIES[^=]*=\s*{([\s\S]*?)};/);
if (!tableMatch) die('Could not locate TOOL_CATEGORIES block in tool-profile.ts');
const extCategories = {};
for (const line of tableMatch[1].split('\n')) {
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

const expected = {
  'read-only':  countByCats(['read']),
  'safe-write': countByCats(['read', 'table-write', 'field-write', 'view-write']),
  full:         countByCats(['read', 'table-write', 'table-destructive', 'field-write', 'field-destructive', 'view-write', 'view-destructive', 'extension']),
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

ok(`${Object.keys(mcpCategories).length} tools in sync; profile counts (${expected['read-only']}/${expected['safe-write']}/${expected.full}) match package.json.`);
