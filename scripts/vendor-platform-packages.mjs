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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { lockedPackage, targetConfig, assertPlatformVersionsMatchParents, REPO_ROOT } from './vsix-targets.mjs';

const CACHE_ROOT = join(REPO_ROOT, '.cache', 'vsix-platform-packages');

const registryBase = () =>
  (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/?$/, '/');

/** `@ngrok/ngrok-darwin-x64` -> `ngrok-darwin-x64` (npm tarball basename). */
const tarballBasename = (name) => name.slice(name.lastIndexOf('/') + 1);

/** Filesystem-safe cache key for a possibly-scoped package name. */
const cacheKey = (name, version) => `${name.replace(/[@/]/g, '_')}-${version}`;

function sha512Base64(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

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
function extractTarball(tarballName, destName, cwd) {
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

async function downloadTarball(name, version, integrity, cacheDir) {
  const url = `${registryBase()}${name}/-/${tarballBasename(name)}-${version}.tgz`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Could not download ${name}@${version} from ${url}: ${error.message}\n` +
      'If this machine is behind a proxy or an internal registry, pre-populate the cache instead:\n' +
      `  npm pack ${name}@${version} --pack-destination <tmp> && tar -xzf <tmp>/*.tgz -C "${cacheDir}" --strip-components=1`
    );
  }
  if (!response.ok) {
    throw new Error(`Could not download ${name}@${version}: ${response.status} ${response.statusText} (${url})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha512Base64(bytes);
  if (actual !== integrity) {
    throw new Error(
      `Integrity mismatch for ${name}@${version} — refusing to vendor.\n` +
      `  pnpm-lock.yaml: ${integrity}\n` +
      `  downloaded:     ${actual}\n` +
      `  url:            ${url}`
    );
  }

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
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(dirname(cacheDir), { recursive: true });
  cpSync(installed, cacheDir, { recursive: true, dereference: true });
  return true;
}

/** Fetch (or reuse) one platform package and return its cache directory. */
async function ensureCached(name) {
  const { version, integrity } = lockedPackage(name);
  const cacheDir = join(CACHE_ROOT, cacheKey(name, version));
  const marker = join(cacheDir, '.vendored.json');

  if (existsSync(marker)) {
    try {
      const stamp = JSON.parse(readFileSync(marker, 'utf8'));
      if (stamp.name === name && stamp.version === version && stamp.integrity === integrity) {
        return { cacheDir, version, source: `cache (${stamp.source})` };
      }
    } catch { /* corrupt marker — re-populate below */ }
  }

  const source = populateFromNodeModules(name, version, cacheDir)
    ? 'node_modules'
    : await downloadTarball(name, version, integrity, cacheDir);

  // Guard against a tarball that unpacked to something other than what we asked
  // for — the marker is only written once the unpacked manifest agrees.
  const unpacked = JSON.parse(readFileSync(join(cacheDir, 'package.json'), 'utf8'));
  if (unpacked.name !== name || unpacked.version !== version) {
    throw new Error(
      `Unpacked ${name}@${version} but its package.json says ` +
      `${unpacked.name}@${unpacked.version} — refusing to vendor.`
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
    cpSync(cacheDir, dest, { recursive: true, dereference: true });
    rmSync(join(dest, '.vendored.json'), { force: true });
    console.log(`✓ Vendored ${name}@${version} for ${target}  (from ${source})`);
    vendored.push({ name, version, source });
  }

  return vendored;
}
