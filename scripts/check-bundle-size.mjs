#!/usr/bin/env node
/**
 * No-growth gate on the webview bundle.
 *
 * Sums the gzip size of every .js file under the webview dist directory and
 * compares it to the committed baseline (packages/webview/bundle-baseline.json).
 * Summing every chunk keeps the gate immune to chunk renames and to code moving
 * between chunks. Fails when the total grows past baseline + tolerance.
 *
 *   node scripts/check-bundle-size.mjs            # check
 *   node scripts/check-bundle-size.mjs --record   # rewrite the baseline (deliberate increase)
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DEFAULT_DIST = resolve(ROOT, 'packages/extension/dist/webview');
const DEFAULT_BASELINE = resolve(ROOT, 'packages/webview/bundle-baseline.json');
const TOLERANCE_BYTES = 1024;

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

export function checkBundleSize({
  distDir = DEFAULT_DIST,
  baselinePath = DEFAULT_BASELINE,
  record = false,
} = {}) {
  const files = jsFiles(distDir);
  if (files.length === 0) throw new Error(`no .js files found under ${distDir}; run the webview build first`);
  const gzipBytes = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);

  if (record) {
    const baseline = {
      gzipJsBytes: gzipBytes,
      toleranceBytes: TOLERANCE_BYTES,
      recordedAt: new Date().toISOString(),
      note: 'sum of gzip sizes of every .js under packages/extension/dist/webview; regenerate with pnpm bundle:record',
    };
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    return { ok: true, message: `Recorded bundle baseline: ${gzipBytes} gzip bytes across ${files.length} file(s).`, gzipBytes, baselineBytes: gzipBytes };
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    return { ok: false, message: `Cannot read bundle baseline ${baselinePath} (${err.message}). Run pnpm bundle:record.`, gzipBytes, baselineBytes: undefined };
  }
  const baselineBytes = baseline.gzipJsBytes;
  const tolerance = baseline.toleranceBytes ?? TOLERANCE_BYTES;
  if (!Number.isFinite(baselineBytes) || !Number.isFinite(tolerance)) {
    return { ok: false, message: `Bundle baseline ${baselinePath} is malformed. Run pnpm bundle:record.`, gzipBytes, baselineBytes: undefined };
  }

  const delta = gzipBytes - baselineBytes;
  if (gzipBytes <= baselineBytes + tolerance) {
    return { ok: true, message: `Bundle size OK: ${gzipBytes} gzip bytes (baseline ${baselineBytes}, delta ${delta >= 0 ? '+' : ''}${delta}, tolerance ${tolerance}).`, gzipBytes, baselineBytes };
  }
  return {
    ok: false,
    message: `Webview bundle grew: ${gzipBytes} gzip bytes vs baseline ${baselineBytes} (delta +${delta}, tolerance ${tolerance}). If the increase is deliberate, run pnpm bundle:record and commit packages/webview/bundle-baseline.json.`,
    gzipBytes,
    baselineBytes,
  };
}

function main() {
  const result = checkBundleSize({ record: process.argv.includes('--record') });
  console.log(result.message);
  if (!result.ok) process.exit(1);
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
