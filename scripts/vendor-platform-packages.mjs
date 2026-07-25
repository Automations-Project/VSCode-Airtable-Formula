/**
 * Vendor the per-platform native packages for ONE vsce target into a
 * `dist/node_modules` tree — including targets this machine is not.
 *
 * Why not just copy what's installed: pnpm/npm install only the optional
 * dependency matching the build host, so the host-copy approach can only ever
 * produce a correct VSIX for the host's own platform. See `vsix-targets.mjs`.
 *
 * How a foreign platform package is obtained: NAPI platform packages are plain
 * npm tarballs containing a single `.node` file plus a package.json — there is
 * nothing to compile and nothing to run. So we fetch the tarball, verify its
 * SHA-512 against the integrity hash **pnpm-lock.yaml already recorded**, and
 * unpack it. That pins the vendored bytes to the exact artifact `pnpm install`
 * resolved and the test suite ran against, not merely to a version number.
 *
 * Cached copies are re-validated against the per-binary digests in
 * `native-binary-digests.json` (themselves derived from the integrity-verified
 * tarball) on EVERY reuse, rather than trusted from the `.vendored.json` marker
 * sitting inside the directory it vouches for.
 *
 * Alternatives considered:
 *   - pnpm `supportedArchitectures` — would force-install all 21 platform
 *     packages into every developer's and every CI job's node_modules (~150 MB
 *     of binaries nobody runs), and the vendoring step would still have to
 *     filter them per target. Strictly more cost for the same result.
 *   - A CI matrix of native runners — needs arm64/alpine runners we do not
 *     have, and would fork the release job's single version-bump/commit/tag
 *     sequence across 8 jobs. Fetching tarballs on one runner avoids both.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { binaryPin, lockedPackage, targetConfig, assertPlatformVersionsMatchParents, REPO_ROOT } from './vsix-targets.mjs';
import { assertSafeSymlinks } from './safe-symlinks.mjs';

export const CACHE_ROOT = join(REPO_ROOT, '.cache', 'vsix-platform-packages');

export const registryBase = () =>
  (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/?$/, '/');

/** `@ngrok/ngrok-darwin-x64` -> `ngrok-darwin-x64` (npm tarball basename). */
export const tarballBasename = (name) => name.slice(name.lastIndexOf('/') + 1);

/** Filesystem-safe cache key for a possibly-scoped package name. */
export const cacheKey = (name, version) => `${name.replace(/[@/]/g, '_')}-${version}`;

function sha512Base64(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

export const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * `tar` is present on every platform we build from: GNU tar on Linux/macOS and
 * in Git Bash, bsdtar as `tar.exe` in System32 on Windows 10 1803+. Spawned
 * directly (no shell) so paths containing spaces need no quoting.
 *
 * Both arguments are names RELATIVE to `cwd`, never absolute. GNU tar parses an
 * absolute Windows path as a remote host spec (`C:\...` -> host `C`, "Cannot
 * connect to C: resolve failed"), so which `tar` is first on PATH would
 * otherwise decide whether packaging works — Git Bash and PowerShell resolve
 * different ones on the same machine.
 */
export function extractTarball(tarballName, destName, cwd) {
  mkdirSync(join(cwd, destName), { recursive: true });
  const result = spawnSync(
    'tar',
    ['-xzf', tarballName, '-C', destName, '--strip-components=1'],
    { cwd, encoding: 'utf8' }
  );
  if (result.error) {
    throw new Error(`Could not run \`tar\` to unpack ${tarballName}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `tar failed (exit ${result.status}) unpacking ${tarballName}:\n${result.stderr || '(no output)'}`
    );
  }
}

/**
 * Download a platform tarball and refuse to return it unless its SHA-512
 * byte-matches the `integrity` pnpm-lock.yaml already recorded. This is the
 * single trusted source every expected value downstream derives from — the
 * vendored tree, and (via `record-native-binary-digests.mjs`) the per-binary
 * digests the artifact assertions compare against.
 *
 * `hint` names the recovery path in the error, since callers differ.
 */
export async function downloadVerifiedTarball(name, version, integrity, hint) {
  const url = `${registryBase()}${name}/-/${tarballBasename(name)}-${version}.tgz`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Could not download ${name}@${version} from ${url}: ${error.message}\n` +
      (hint ?? 'This machine may be behind a proxy or an internal registry.')
    );
  }
  if (!response.ok) {
    throw new Error(`Could not download ${name}@${version}: ${response.status} ${response.statusText} (${url})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha512Base64(bytes);
  if (actual !== integrity) {
    throw new Error(
      `Integrity mismatch for ${name}@${version} — refusing to use these bytes.\n` +
      `  pnpm-lock.yaml: ${integrity}\n` +
      `  downloaded:     ${actual}\n` +
      `  url:            ${url}`
    );
  }
  return bytes;
}

async function downloadTarball(name, version, integrity, cacheDir) {
  const bytes = await downloadVerifiedTarball(
    name,
    version,
    integrity,
    'If this machine is behind a proxy or an internal registry, pre-populate the cache instead:\n' +
    `  npm pack ${name}@${version} --pack-destination <tmp> && tar -xzf <tmp>/*.tgz -C "${cacheDir}" --strip-components=1`
  );

  mkdirSync(CACHE_ROOT, { recursive: true });
  const key = cacheKey(name, version);
  const tarballPath = join(CACHE_ROOT, `${key}.tgz`);
  writeFileSync(tarballPath, bytes);
  try {
    rmSync(cacheDir, { recursive: true, force: true });
    extractTarball(`${key}.tgz`, key, CACHE_ROOT);
  } finally {
    rmSync(tarballPath, { force: true });
  }
  return 'registry';
}

/**
 * The build host's own platform package is already installed and was already
 * integrity-checked by pnpm at install time, so reuse it when the version
 * matches exactly. Keeps `pnpm packx` on a developer machine working offline
 * for the host target; every other target still goes to the registry.
 */
function populateFromNodeModules(name, version, cacheDir) {
  const installed = join(REPO_ROOT, 'node_modules', name);
  const manifest = join(installed, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    if (JSON.parse(readFileSync(manifest, 'utf8')).version !== version) return false;
  } catch {
    return false;
  }
  assertSafeSymlinks(installed);
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(dirname(cacheDir), { recursive: true });
  cpSync(installed, cacheDir, { recursive: true, dereference: true });
  return true;
}

/** Every `.node` file under `dir`, as paths relative to `dir` with `/` separators. */
export function findNodeBinaries(dir, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...findNodeBinaries(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.node')) found.push(rel);
  }
  return found;
}

/**
 * Re-derive whether a cache directory still holds exactly the package we
 * pinned, by reading its CONTENTS. Returns a reason string when it does not.
 *
 * The `.vendored.json` marker is deliberately not consulted for this: it lives
 * inside the very directory it vouches for, so anything that could corrupt the
 * binaries could equally rewrite the marker. Trusting it meant a cache
 * populated correctly once was trusted forever, through every later local edit,
 * partial write, disk fault, or hand-copied "fix". The digests come from
 * pnpm-lock.yaml by way of `native-binary-digests.json` instead.
 */
function validateCacheDir(cacheDir, name, version, pin) {
  if (!existsSync(join(cacheDir, 'package.json'))) return 'not populated';

  let unpacked;
  try {
    unpacked = JSON.parse(readFileSync(join(cacheDir, 'package.json'), 'utf8'));
  } catch (error) {
    return `package.json is unreadable (${error.message})`;
  }
  if (unpacked.name !== name || unpacked.version !== version) {
    return `package.json says ${unpacked.name}@${unpacked.version}, expected ${name}@${version}`;
  }

  const present = findNodeBinaries(cacheDir).sort();
  const expected = Object.keys(pin.binaries).sort();
  const extra = present.filter((f) => !pin.binaries[f]);
  if (extra.length > 0) return `contains unpinned native binaries: ${extra.join(', ')}`;

  for (const rel of expected) {
    const file = join(cacheDir, ...rel.split('/'));
    if (!existsSync(file)) return `missing pinned binary ${rel}`;
    const actual = sha256Hex(readFileSync(file));
    if (actual !== pin.binaries[rel]) {
      return `${rel} is sha256 ${actual}, pinned as ${pin.binaries[rel]}`;
    }
  }
  return undefined;
}

/** Fetch (or reuse) one platform package and return its cache directory. */
async function ensureCached(name) {
  const { version, integrity } = lockedPackage(name);
  const pin = binaryPin(name); // throws (with the fix) when the pins are missing or stale
  const cacheDir = join(CACHE_ROOT, cacheKey(name, version));
  const marker = join(cacheDir, '.vendored.json');

  // Revalidate the cached BYTES before reuse, not the marker beside them.
  const stale = validateCacheDir(cacheDir, name, version, pin);
  if (!stale) {
    let origin = 'unknown origin';
    try { origin = JSON.parse(readFileSync(marker, 'utf8')).source ?? origin; } catch { /* cosmetic only */ }
    return { cacheDir, version, source: `cache, revalidated (${origin})` };
  }
  if (existsSync(cacheDir)) {
    console.log(`↻ Re-fetching ${name}@${version}: cached copy failed revalidation — ${stale}`);
  }

  const source = populateFromNodeModules(name, version, cacheDir)
    ? 'node_modules'
    : await downloadTarball(name, version, integrity, cacheDir);

  // Same content check against the freshly-populated tree: catches a tarball
  // that unpacked to something other than what we asked for, and an installed
  // copy whose binary does not match the pinned one. The marker is only written
  // once the bytes themselves agree.
  const bad = validateCacheDir(cacheDir, name, version, pin);
  if (bad) {
    throw new Error(
      `Vendored ${name}@${version} from ${source} but it does not match the digests pinned in ` +
      `scripts/native-binary-digests.json — refusing to vendor.\n  ${bad}`
    );
  }

  writeFileSync(marker, `${JSON.stringify({ name, version, integrity, source }, null, 2)}\n`);
  return { cacheDir, version, source };
}

/**
 * Vendor every platform package required by `target` into `destNodeModules`.
 * Returns a report of what was vendored, for logging and for the packaging
 * script's summary table.
 */
export async function vendorPlatformPackagesForTarget(target, destNodeModules) {
  assertPlatformVersionsMatchParents();
  const { packages } = targetConfig(target);
  const vendored = [];

  for (const name of packages) {
    const { cacheDir, version, source } = await ensureCached(name);
    const dest = join(destNodeModules, name);
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    // `tar` creates symlinks from whatever the tarball asks for, and the copy
    // below dereferences them — so foreign packages get the same escape guard
    // the non-foreign path in prepare-package-deps.mjs already applies.
    assertSafeSymlinks(cacheDir);
    cpSync(cacheDir, dest, { recursive: true, dereference: true });
    rmSync(join(dest, '.vendored.json'), { force: true });
    console.log(`✓ Vendored ${name}@${version} for ${target}  (from ${source})`);
    vendored.push({ name, version, source });
  }

  return vendored;
}
