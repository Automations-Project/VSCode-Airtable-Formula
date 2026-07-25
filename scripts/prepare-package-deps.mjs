/**
 * Copy patchright + patchright-core + otpauth from the mcp-server workspace
 * package's node_modules into dist/node_modules/ so the VSIX ships with
 * browser automation support.
 *
 * In the pnpm workspace layout, patchright is installed as a symlink under
 * `packages/mcp-server/node_modules/patchright` pointing into the .pnpm
 * virtual store. We must `dereference: true` when copying so the VSIX
 * receives real files, not broken symlinks.
 *
 * We resolve each package directly via `require.resolve(<pkg>/package.json)`
 * using the mcp-server root as a paths hint, which transparently walks the
 * symlinked store and returns the real on-disk path.
 *
 * TARGETED OUTPUT. The tree this produces is specific to ONE vsce target,
 * selected with `--target=<t>` (or `VSIX_TARGET`, defaulting to this machine's
 * platform). `impit` and `@ngrok/ngrok` keep their native binary in separate
 * per-platform packages, and only the target's are vendored — see
 * `vsix-targets.mjs`. Run this once per target before each `vsce package
 * --target <t>`; `package-targets.mjs` does exactly that.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ALL_TARGETS, hostTarget, isPlatformPackage, targetConfig } from './vsix-targets.mjs';
import { vendorPlatformPackagesForTarget } from './vendor-platform-packages.mjs';
import { assertSafeSymlinks } from './safe-symlinks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Target selection ───────────────────────────────────────────────────────
const targetArg = process.argv.find((a) => a.startsWith('--target='))?.slice('--target='.length);
const target = targetArg || process.env.VSIX_TARGET || hostTarget();
if (!target) {
  console.error(
    `Cannot determine a vsce target for ${process.platform}-${process.arch}: it is not a ` +
    'published target. Pass one explicitly, e.g. --target=linux-x64.\n' +
    `Published targets: ${ALL_TARGETS.join(', ')}`
  );
  process.exit(1);
}
try {
  targetConfig(target); // rejects unknown targets and deliberately-excluded ones
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`→ Preparing dist/node_modules for vsce target: ${target}`);

// Anchor: mcp-server workspace package root
const mcpPkgPath = require.resolve('airtable-user-mcp/package.json');
const mcpRoot = dirname(mcpPkgPath);

const extensionNodeModules = join(__dirname, '..', 'packages', 'extension', 'dist', 'node_modules');

const packagesToCopy = ['patchright', 'patchright-core', 'otpauth', '@ngrok/ngrok', 'impit'];

rmSync(extensionNodeModules, { recursive: true, force: true });
mkdirSync(extensionNodeModules, { recursive: true });

/**
 * Find a package's root directory by resolving it from mcp-server's scope.
 * Handles two cases:
 *   1. Package exposes `./package.json` in its exports map → direct resolution.
 *   2. Package has strict exports (e.g. otpauth) → resolve main entry, then
 *      walk up until we find the package.json whose "name" matches.
 */
function resolvePackageRoot(packageName) {
  // Case 1
  try {
    const resolved = require.resolve(`${packageName}/package.json`, { paths: [mcpRoot] });
    return dirname(resolved);
  } catch { /* fall through */ }

  // Case 2 — resolve main entry, walk up
  try {
    const entry = require.resolve(packageName, { paths: [mcpRoot] });
    let dir = dirname(entry);
    // Walk up at most 6 levels looking for a package.json whose name matches
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
          if (pkg.name === packageName) return dir;
        } catch { /* malformed package.json, keep walking */ }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* ignore */ }

  return undefined;
}

// The symlink-escape guard `copyPackage` applies before every dereferencing
// copy now lives in `safe-symlinks.mjs`, so the foreign-platform vendoring path
// (`vendor-platform-packages.mjs`) applies the identical check.

/**
 * Resolve + safety-check + copy a single package into dist/node_modules.
 * Returns true on success, false if the package could not be resolved
 * (logged as a warning, not fatal — callers decide whether that's expected).
 */
function copyPackage(packageName) {
  const realSource = resolvePackageRoot(packageName);
  if (!realSource) {
    console.warn(`⚠ Could not resolve "${packageName}" from ${mcpRoot} — skipping`);
    return false;
  }
  if (!existsSync(realSource)) {
    console.warn(`⚠ Resolved path for "${packageName}" does not exist: ${realSource} — skipping`);
    return false;
  }

  assertSafeSymlinks(realSource);

  const target = join(extensionNodeModules, packageName);
  // dereference: true — follow symlinks and copy real files, required for
  // pnpm's symlinked store to produce a self-contained VSIX.
  cpSync(realSource, target, { recursive: true, dereference: true });
  console.log(`✓ Copied ${packageName} → dist/node_modules/${packageName}  (from ${realSource})`);
  return true;
}

/**
 * Some vendored packages (impit, @ngrok/ngrok, and potentially future
 * additions) ship their compiled NAPI (.node) binary in SEPARATE per-platform
 * packages declared as their OWN optionalDependencies (e.g.
 * impit-win32-x64-msvc, @ngrok/ngrok-darwin-arm64) — pnpm only installs the
 * variant matching the current build machine. Copying just the parent
 * package folder copies the pure-JS loader but never the native binary it
 * `require()`s at runtime, so the feature throws "Cannot find native
 * binding" in the packaged VSIX despite being selectable/enabled.
 *
 * Those platform children are deliberately NOT vendored here: copying
 * whatever the build host happens to have installed is exactly how an
 * untargeted VSIX ends up shipping one platform's binary to everyone. They
 * are vendored per target further below, from the lockfile, by
 * `vendorPlatformPackagesForTarget`.
 *
 * What this function still handles is the OTHER kind of optionalDependency:
 * genuinely optional runtime extras that are not platform-binary splits (e.g.
 * patchright declares `fsevents`, a macOS file watcher its own code already
 * handles being absent). Those are copied when resolvable from this machine —
 * harmless when they are not. The package's optionalDependencies are read from
 * dist/node_modules/<name>/package.json, which sidesteps packages with a
 * strict `exports` map (like otpauth) that don't expose ./package.json via
 * require.resolve.
 */
function vendorOptionalDependencies(packageName) {
  const pkgJsonPath = join(extensionNodeModules, packageName, 'package.json');
  if (!existsSync(pkgJsonPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    return; // malformed — nothing we can do, the parent package is still vendored
  }

  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    // Platform-split children are target-selected, never host-selected.
    if (isPlatformPackage(dep)) continue;
    copyPackage(dep);
  }
}

for (const packageName of packagesToCopy) {
  if (copyPackage(packageName)) {
    vendorOptionalDependencies(packageName);
  }
}

// ── Per-target native binaries ─────────────────────────────────────────────
// Pinned to pnpm-lock.yaml (version AND integrity) and fetched for the chosen
// target regardless of what this machine runs, so every published VSIX carries
// exactly the binaries its own platform loads.
try {
  await vendorPlatformPackagesForTarget(target, extensionNodeModules);
} catch (error) {
  // Surface the reason, not an unhandled-rejection stack — these failures
  // (integrity mismatch, unreachable registry, missing lockfile entry) all
  // carry an actionable message.
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}

// Copy @airtable-formula/language-services (workspace package — not on npm,
// so it cannot be resolved from the mcp-server scope like patchright/otpauth).
// The extension's bundled extension.js require()s it at runtime; without this
// copy the packaged VSIX fails to activate ("Cannot find module" error) and
// the dashboard webview is stuck in a permanent loading loop.
const lsSource = join(__dirname, '..', 'packages', 'language-services');
const lsTarget = join(extensionNodeModules, '@airtable-formula', 'language-services');
mkdirSync(dirname(lsTarget), { recursive: true });
cpSync(join(lsSource, 'package.json'), join(lsTarget, 'package.json'));
cpSync(join(lsSource, 'dist'), join(lsTarget, 'dist'), { recursive: true });
console.log('✓ Copied @airtable-formula/language-services → dist/node_modules/@airtable-formula/language-services');

console.log('✓ Package deps prepared');
