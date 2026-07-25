/**
 * SINGLE SOURCE OF TRUTH for platform-specific VSIX publishing.
 *
 * The extension vendors two packages whose compiled NAPI (`.node`) binary lives
 * in a SEPARATE per-platform npm package declared as the parent's own
 * optionalDependency:
 *
 *   impit          -> impit-<platform>            (Chrome-TLS HTTP client)
 *   @ngrok/ngrok   -> @ngrok/ngrok-<platform>     (ngrok tunnel provider)
 *
 * npm/pnpm only install the variant matching the machine doing the install, so
 * a single untargeted VSIX built on one CI runner ships exactly one platform's
 * binaries and every other platform gets "Cannot find native binding" the first
 * time `mcp.httpClient: "impit"` or the ngrok tunnel provider is used. The fix
 * is one VSIX per VS Code target (`vsce package --target <t>`), each carrying
 * only its own platform packages.
 *
 * Everything downstream — vendoring (`prepare-package-deps.mjs`), packaging
 * (`package-targets.mjs`), artifact assertions (`assert-vsix-binaries.mjs`) and
 * CI (`.github/workflows/release.yml`) — derives from the table below. Adding a
 * target means adding one row here and nothing else.
 *
 * NOTE (GC10): this matrix applies ONLY to the pre-vendored VSIX. The standalone
 * npm package `airtable-user-mcp` stays universal — npm installs the right
 * optional dependency on the user's own machine, so it needs no per-platform
 * publishing and must not gain any.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, '..');

/**
 * Parent packages whose native binary is split into per-platform child
 * packages. A child is recognised by the `<parent>-` name prefix, which is the
 * NAPI convention both of these follow.
 */
export const PLATFORM_SPLIT_PARENTS = ['impit', '@ngrok/ngrok'];

/**
 * vsce target -> the exact platform packages that target's VSIX must contain.
 *
 * `os` / `cpu` are asserted against each vendored package's own package.json so
 * a wrong-platform binary is caught even if someone renames a package. `libc`
 * is not expressed in package.json metadata, hence the explicit package names:
 * VS Code's `linux-*` targets are glibc and `alpine-*` are musl.
 */
export const VSIX_TARGETS = {
  'win32-x64': {
    os: 'win32',
    cpu: 'x64',
    libc: null,
    packages: ['impit-win32-x64-msvc', '@ngrok/ngrok-win32-x64-msvc'],
  },
  'win32-arm64': {
    os: 'win32',
    cpu: 'arm64',
    libc: null,
    packages: ['impit-win32-arm64-msvc', '@ngrok/ngrok-win32-arm64-msvc'],
  },
  'darwin-x64': {
    os: 'darwin',
    cpu: 'x64',
    libc: null,
    packages: ['impit-darwin-x64', '@ngrok/ngrok-darwin-x64'],
  },
  'darwin-arm64': {
    os: 'darwin',
    cpu: 'arm64',
    libc: null,
    packages: ['impit-darwin-arm64', '@ngrok/ngrok-darwin-arm64'],
  },
  'linux-x64': {
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    packages: ['impit-linux-x64-gnu', '@ngrok/ngrok-linux-x64-gnu'],
  },
  'linux-arm64': {
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    packages: ['impit-linux-arm64-gnu', '@ngrok/ngrok-linux-arm64-gnu'],
  },
  'alpine-x64': {
    os: 'linux',
    cpu: 'x64',
    libc: 'musl',
    packages: ['impit-linux-x64-musl', '@ngrok/ngrok-linux-x64-musl'],
  },
  'alpine-arm64': {
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
    packages: ['impit-linux-arm64-musl', '@ngrok/ngrok-linux-arm64-musl'],
  },
};

/**
 * Targets VS Code supports that we deliberately do NOT publish, with the reason.
 * Kept in code (rather than only in prose) so the omission is a recorded
 * decision rather than an oversight, and so `--targets=all` can never silently
 * pick one up.
 *
 * `linux-armhf` — EXCLUDED. `impit` publishes no 32-bit-ARM build (its platform
 * set is darwin-{arm64,x64}, linux-{arm64,x64}-{gnu,musl},
 * win32-{arm64,x64}-msvc — no `linux-arm-gnueabihf`), while `@ngrok/ngrok`
 * does. Shipping an armhf VSIX would therefore mean shipping an extension that
 * advertises `airtableFormula.mcp.httpClient: "impit"` in its settings UI and
 * throws "Cannot find native binding" the moment an armhf user selects it —
 * the exact class of silently-broken artifact this whole matrix exists to
 * prevent. Publishing nothing for armhf instead makes the Marketplace report
 * the extension as unavailable there, which is honest and recoverable. Revisit
 * if impit ever ships a `linux-arm-gnueabihf` artifact; the row would then be
 * `{ os:'linux', cpu:'arm', libc:'glibc', packages:[impit-linux-arm-gnueabihf,
 * '@ngrok/ngrok-linux-arm-gnueabihf'] }` and nothing else would need changing.
 */
export const EXCLUDED_TARGETS = {
  'linux-armhf': 'impit publishes no 32-bit-ARM (arm-gnueabihf) binary; an armhf VSIX would ship a broken mcp.httpClient="impit" setting.',
};

export const ALL_TARGETS = Object.keys(VSIX_TARGETS);

/**
 * Leading bytes an executable native binary must have, per OS.
 *
 * Package name, package.json metadata and file name are all just *labels* — a
 * binary carrying another platform's machine code under the correct filename
 * satisfies every one of them. The magic number is the first check that looks
 * at the bytes themselves, so it is what catches a content swap (and a file
 * truncated at the front).
 *
 * Values below were read from the actual vendored binaries, not assumed:
 * every win32 package starts `4d5a`, every linux/alpine one `7f454c46`, every
 * darwin one `cffaedfe`. The extra darwin entries are the other legal Mach-O
 * containers — byte-swapped and universal/fat — which we do not currently ship
 * (no target uses `@ngrok/ngrok-darwin-universal`) but which would be valid if
 * one ever did.
 */
export const NATIVE_BINARY_MAGICS = {
  win32: [
    { hex: '4d5a', label: 'PE/COFF ("MZ")' },
  ],
  linux: [
    { hex: '7f454c46', label: 'ELF' },
  ],
  darwin: [
    { hex: 'cffaedfe', label: 'Mach-O 64-bit (MH_MAGIC_64)' },
    { hex: 'feedfacf', label: 'Mach-O 64-bit (MH_CIGAM_64, byte-swapped)' },
    { hex: 'cafebabe', label: 'Mach-O universal/fat' },
    { hex: 'cafebabf', label: 'Mach-O universal/fat (64-bit)' },
    { hex: 'bebafeca', label: 'Mach-O universal/fat (byte-swapped)' },
  ],
};

/** Accepted magic-number prefixes for a target's OS. */
export function expectedBinaryMagics(os) {
  const magics = NATIVE_BINARY_MAGICS[os];
  if (!magics) {
    throw new Error(
      `No native-binary magic numbers are defined for os "${os}". Add them to ` +
      'NATIVE_BINARY_MAGICS in scripts/vsix-targets.mjs before publishing that target.'
    );
  }
  return magics;
}

/** Every platform package referenced by any target (used for absence checks). */
export function allPlatformPackages() {
  return [...new Set(Object.values(VSIX_TARGETS).flatMap((t) => t.packages))].sort();
}

/** True when `name` is a per-platform child of one of the split parents. */
export function isPlatformPackage(name) {
  return PLATFORM_SPLIT_PARENTS.some((parent) => name.startsWith(`${parent}-`));
}

export function targetConfig(target) {
  const config = VSIX_TARGETS[target];
  if (config) return config;
  const excluded = EXCLUDED_TARGETS[target];
  if (excluded) {
    throw new Error(`Target "${target}" is deliberately not published: ${excluded}`);
  }
  throw new Error(
    `Unknown vsce target "${target}". Known targets: ${ALL_TARGETS.join(', ')}`
  );
}

/**
 * The vsce target matching the machine we are running on, or undefined when the
 * host is not a published target (e.g. linux-armhf, freebsd).
 */
export function hostTarget() {
  const { platform, arch } = process;
  if (platform === 'win32' || platform === 'darwin') {
    return VSIX_TARGETS[`${platform}-${arch}`] ? `${platform}-${arch}` : undefined;
  }
  if (platform === 'linux') {
    // Node reports a glibc runtime version only when linked against glibc;
    // its absence is the standard musl (Alpine) signal.
    let musl = false;
    try {
      musl = !process.report?.getReport?.()?.header?.glibcVersionRuntime;
    } catch {
      musl = false;
    }
    const candidate = `${musl ? 'alpine' : 'linux'}-${arch}`;
    return VSIX_TARGETS[candidate] ? candidate : undefined;
  }
  return undefined;
}

// ── Lockfile pinning ───────────────────────────────────────────────────────
// Versions are NEVER hardcoded here. They are read from pnpm-lock.yaml so a
// target VSIX can only ever carry the impit/ngrok build that `pnpm install`
// resolved and the test suite ran against. The lockfile also carries the
// registry integrity hash, which we verify byte-for-byte after download — that
// pins the artifact itself, not just its version number.

let lockCache;

function loadLockEntries() {
  if (lockCache) return lockCache;
  const raw = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  const lines = raw.split(/\r?\n/);
  // name -> version -> integrity. A lockfile legitimately carries several
  // versions of unrelated packages, so multiplicity is only an error for the
  // packages we actually vendor — checked in lockedPackage(), not here.
  /** @type {Map<string, Map<string, string>>} */
  const entries = new Map();

  for (let i = 0; i < lines.length; i++) {
    // Package keys live at exactly two-space indentation, optionally quoted
    // because scoped names start with '@':  `  '@ngrok/ngrok-darwin-x64@1.7.0':`
    const keyMatch = /^ {2}'?(@?[^'\s]+?)'?:$/.exec(lines[i]);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    // Plain semver only — skips peer-suffixed snapshot keys like `foo@1(bar@2)`.
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(version)) continue;

    // Only the `packages:` section carries `resolution: {integrity: ...}`;
    // requiring it excludes the `snapshots:` duplicates automatically.
    const resolution = /^\s+resolution: \{integrity: (sha\d+-[A-Za-z0-9+/=]+)\}$/.exec(
      lines[i + 1] ?? ''
    );
    if (!resolution) continue;

    if (!entries.has(name)) entries.set(name, new Map());
    entries.get(name).set(version, resolution[1]);
  }

  lockCache = entries;
  return entries;
}

/** Locked `{ version, integrity }` for a package, or throws if absent/ambiguous. */
export function lockedPackage(name) {
  const versions = loadLockEntries().get(name);
  if (!versions || versions.size === 0) {
    throw new Error(
      `"${name}" has no entry in pnpm-lock.yaml. Platform packages must be ` +
      'locked before they can be vendored into a targeted VSIX — run `pnpm install`.'
    );
  }
  if (versions.size > 1) {
    throw new Error(
      `pnpm-lock.yaml resolves "${name}" to more than one version ` +
      `(${[...versions.keys()].join(', ')}). A VSIX cannot carry two builds of the ` +
      'same native package — dedupe the lockfile before packaging.'
    );
  }
  const [version, integrity] = [...versions.entries()][0];
  return { version, integrity };
}

/**
 * Every platform package must be locked at the SAME version as its parent —
 * a mismatch means the VSIX would ship a loader and a binary from different
 * releases, which is an ABI coin-flip.
 */
export function assertPlatformVersionsMatchParents() {
  const problems = [];
  for (const parent of PLATFORM_SPLIT_PARENTS) {
    const parentVersion = lockedPackage(parent).version;
    for (const pkg of allPlatformPackages()) {
      if (!pkg.startsWith(`${parent}-`)) continue;
      const { version } = lockedPackage(pkg);
      if (version !== parentVersion) {
        problems.push(`${pkg}@${version} does not match ${parent}@${parentVersion}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Platform packages are out of step with their parent package:\n  ${problems.join('\n  ')}`
    );
  }
}
