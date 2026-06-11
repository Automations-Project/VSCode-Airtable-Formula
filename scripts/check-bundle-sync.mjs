#!/usr/bin/env node
/**
 * check-bundle-sync — warn when the channels that ship the MCP server have drifted.
 *
 * The MCP server reaches users through TWO independent channels that must stay in
 * lockstep but have no automatic coupling:
 *   • npm        — packages/mcp-server/ published as "airtable-user-mcp"
 *   • the bundle — esbuild snapshot baked into packages/extension/dist/mcp/ at build time
 *
 * They drift whenever the source changes (or npm is published) without rebuilding the
 * extension bundle — exactly the failure that left v2.4.13's whitelist fix stranded on
 * npm while extension users kept running the 2.4.12 bundle.
 *
 * This script reports (advisory only — always exits 0, silent when clean):
 *   1. version drift  — mcp-server/package.json version  ≠  bundled dist/mcp/version.json
 *   2. stale bundle    — a packages/mcp-server/src file is newer than the built bundle
 *   3. npm drift       — source version ≠ npm latest   (best-effort; set CHECK_BUNDLE_SYNC_NPM=1)
 *
 * Designed to run as a Claude Code Stop hook for this workspace. Prints a concise
 * warning block on drift so the next build/release re-syncs both channels.
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC_PKG = resolve(ROOT, 'packages/mcp-server/package.json');
const SRC_DIR = resolve(ROOT, 'packages/mcp-server/src');
const BUNDLE_VER = resolve(ROOT, 'packages/extension/dist/mcp/version.json');
const BUNDLE_IDX = resolve(ROOT, 'packages/extension/dist/mcp/index.mjs');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const warnings = [];

// --hook mode: emit a {systemMessage} JSON (surfaced by the Claude Code Stop hook)
// instead of a colored text block. In hook mode the mtime "stale bundle" check is
// skipped by default (it would fire every turn during active dev); enable it with
// CHECK_BUNDLE_SYNC_STALE=1. Manual runs always do the full report.
const HOOK = process.argv.includes('--hook');
const checkStale = !HOOK || process.env.CHECK_BUNDLE_SYNC_STALE === '1';

// ── source version (authoritative) ──────────────────────────────────────────
let sourceVersion = null;
try {
  sourceVersion = readJson(SRC_PKG).version;
} catch {
  // Not in this repo (or package missing) — nothing to check; stay silent.
  process.exit(0);
}

// ── 1 + 2: bundle version + freshness ───────────────────────────────────────
if (existsSync(BUNDLE_VER) && existsSync(BUNDLE_IDX)) {
  let bundleVersion = null;
  try {
    bundleVersion = readJson(BUNDLE_VER).mcpServer;
  } catch { /* malformed manifest — treated as a build artifact problem below */ }

  if (bundleVersion && bundleVersion !== sourceVersion) {
    warnings.push(
      `version drift — source is ${sourceVersion} but the bundle is ${bundleVersion}. ` +
      `Run \`pnpm build\` so the extension ships ${sourceVersion}.`
    );
  }

  // Stale bundle: any source file newer than the built bundle means there are
  // unbundled changes (catches same-version drift, e.g. a fix with no bump).
  if (checkStale) {
    const bundleMtime = statSync(BUNDLE_IDX).mtimeMs;
    let newest = 0;
    let newestFile = '';
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else {
          const m = statSync(full).mtimeMs;
          if (m > newest) { newest = m; newestFile = full; }
        }
      }
    };
    try { walk(SRC_DIR); } catch { /* src missing — skip */ }
    if (newest > bundleMtime) {
      warnings.push(
        `stale bundle — \`${relative(ROOT, newestFile)}\` changed since the last build. ` +
        `Run \`pnpm build\` before packaging/publishing the extension.`
      );
    }
  }
} else {
  warnings.push(
    `bundle not built — packages/extension/dist/mcp/ is missing. ` +
    `Run \`pnpm build\` before packaging the extension.`
  );
}

// ── 3: npm channel drift (best-effort, opt-in to avoid per-turn latency) ─────
if (process.env.CHECK_BUNDLE_SYNC_NPM === '1') {
  try {
    // execFileSync (no shell) with a static arg array — npm is "npm.cmd" on Windows.
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const latest = execFileSync(npmBin, ['view', 'airtable-user-mcp', 'version'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (latest && latest !== sourceVersion) {
      warnings.push(
        `npm drift — npm latest is ${latest} but source is ${sourceVersion}. ` +
        `Pull the release bump (or publish) so git, npm, and the bundle agree.`
      );
    }
  } catch {
    // offline / npm slow / not installed — skip silently
  }
}

if (warnings.length) {
  if (HOOK) {
    // Surface to the user as a non-blocking system message (Stop hook output).
    const systemMessage =
      '⚠ mcp-server channel sync:\n' + warnings.map((w) => `  • ${w}`).join('\n');
    process.stdout.write(JSON.stringify({ systemMessage }));
  } else {
    console.log('\n\x1b[33m⚠ mcp-server channel sync:\x1b[0m');
    for (const w of warnings) console.log(`  • ${w}`);
    console.log('');
  }
}
process.exit(0);
