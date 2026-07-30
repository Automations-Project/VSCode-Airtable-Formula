/**
 * Build one platform-specific .vsix per published target, and assert each one.
 *
 * Per target: re-vendor dist/node_modules for that target, run
 * `vsce package --target <t> --no-dependencies`, then run the artifact
 * assertions. A target that fails its assertions aborts the whole run — a
 * VSIX whose native binaries could not be verified must never reach a publish
 * step.
 *
 * WHAT THIS IS, NAMED PRECISELY: eight target artifact packaging/assertion
 * smokes. Each target is packaged and its contents verified byte-for-byte
 * against the lockfile-derived digest pins. It is NOT a runtime smoke of eight
 * native bindings — one host can only `require()` the binding built for itself,
 * so only the host target's binding can ever receive a genuine runtime load.
 * That is precisely why the assertion verifies exact bytes rather than settling
 * for labels: content equality is the strongest claim a single host can make
 * about seven foreign artifacts.
 *
 * Assumes the monorepo has already been built (`pnpm build`): this script only
 * vendors, packages and verifies.
 *
 * Usage:
 *   node scripts/package-targets.mjs                       # all targets
 *   node scripts/package-targets.mjs --targets=win32-x64,linux-x64
 *   node scripts/package-targets.mjs --targets=host        # this machine only
 *   node scripts/package-targets.mjs --out-dir=artifacts
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TARGETS, hostTarget, targetConfig } from './vsix-targets.mjs';
import { assertVsix } from './assert-vsix-binaries.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const extensionRoot = join(repoRoot, 'packages', 'extension');

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const outDir = join(repoRoot, arg('out-dir', 'artifacts'));
const requested = arg('targets', 'all');

let targets;
if (requested === 'all') {
  targets = ALL_TARGETS;
} else if (requested === 'host') {
  const host = hostTarget();
  if (!host) {
    console.error(`This machine (${process.platform}-${process.arch}) is not a published target.`);
    process.exit(1);
  }
  targets = [host];
} else {
  targets = requested.split(',').map((t) => t.trim()).filter(Boolean);
}
// Fail fast on a typo or a deliberately-excluded target, before any packaging.
try {
  for (const target of targets) targetConfig(target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));

// vsce refuses to package without a README; the release workflow and
// `packx` both generate packages/extension/README.md from the root README
// (SVGs stripped — the Marketplace rejects them).
if (!existsSync(join(extensionRoot, 'README.md'))) {
  console.error(
    'packages/extension/README.md is missing (it is generated, and gitignored).\n' +
    'Generate it first — `pnpm -F airtable-formula packx:no-bump` does it, as does the release workflow.'
  );
  process.exit(1);
}

const vsceBin = join(dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');

function run(command, args, cwd) {
  console.log(`\n$ ${command === process.execPath ? 'node' : command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(outDir, { recursive: true });

const built = [];
for (const target of targets) {
  console.log(`\n${'═'.repeat(70)}\n  ${target}\n${'═'.repeat(70)}`);

  // 1. Vendor dist/node_modules for THIS target (wipes the previous target's).
  run(process.execPath, [join(__dirname, 'prepare-package-deps.mjs'), `--target=${target}`], repoRoot);

  // 2. Package. vsce names platform builds <name>-<target>-<version>.vsix;
  //    we pass --out explicitly so the name is ours and never accidentally
  //    untargeted.
  const vsix = join(outDir, `airtable-formula-${target}-${version}.vsix`);
  rmSync(vsix, { force: true });
  run(process.execPath, [vsceBin, 'package', '--no-dependencies', '--target', target, '--out', vsix], extensionRoot);

  // 3. Verify before anything downstream can publish it.
  const result = assertVsix(vsix, target);
  if (result.problems.length > 0) {
    console.error(`\n✗ ${target} artifact failed its native-binary assertions:`);
    for (const problem of result.problems) console.error(`    ${problem}`);
    process.exit(1);
  }
  console.log(`\n✓ ${target} verified:`);
  for (const v of result.verified) {
    console.log(
      `    ${v.pkg}@${v.version} → ${v.binary} (${(v.bytes / 1048576).toFixed(1)} MiB, ` +
      `magic 0x${v.magic}, sha256 ${v.sha256.slice(0, 16)}… pinned)`
    );
  }
  built.push({ target, vsix, verified: result.verified });
}

console.log(`\n${'═'.repeat(70)}\n  Artifact matrix (extension v${version})\n${'═'.repeat(70)}`);
for (const { target, vsix, verified } of built) {
  console.log(`${target.padEnd(14)} ${relative(repoRoot, vsix)}`);
  for (const v of verified) console.log(`${''.padEnd(14)}   ${v.pkg} → ${v.binary}`);
}
console.log(
  `\n✓ ${built.length} target artifact packaging/assertion smoke(s) passed — ` +
  `built in ${relative(repoRoot, outDir)}/, contents verified byte-exact against the lockfile pins.\n` +
  '  (Packaging smokes, not runtime smokes: only the host target\'s native binding can be loaded here.)'
);
