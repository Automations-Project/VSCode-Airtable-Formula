/**
 * Record the exact SHA-256 of every `.node` file each platform package ships
 * into `scripts/native-binary-digests.json`.
 *
 * WHY THIS EXISTS
 *
 * `assert-vsix-binaries.mjs` used to verify a native binary by its package
 * name, its package.json `os`/`cpu`/`version`, its filename, and a 4-byte magic
 * number. Every one of those except the magic is a LABEL an attacker or a
 * broken pipeline controls, and the magic distinguishes PE from ELF from
 * Mach-O — the OS and nothing more. So an x64 binary swapped for an ARM64 one
 * on the same OS passed, and a glibc build swapped for a musl build passed:
 * both keep the magic, and `cpu` was only ever read from the vendored package's
 * own manifest, never from the machine code.
 *
 * An exact digest closes that. There is no arch, libc, ABI or toolchain
 * difference that survives a byte-for-byte comparison.
 *
 * WHY THE EXPECTED VALUES ARE NOT CIRCULAR
 *
 * This script never reads the artifact being checked, and never reads the
 * vendoring cache. For each platform package it:
 *
 *   1. reads `{version, integrity}` from **pnpm-lock.yaml**;
 *   2. downloads that exact tarball from the registry;
 *   3. refuses to continue unless the tarball's SHA-512 byte-matches the
 *      lockfile's `integrity`;
 *   4. unpacks it to a throwaway directory and hashes the `.node` files inside.
 *
 * The chain of trust therefore runs lockfile → tarball → digest → assertion.
 * The VSIX is the last link and vouches for nothing.
 *
 * WHEN TO RUN IT
 *
 * Only when `impit` or `@ngrok/ngrok` changes version in pnpm-lock.yaml. Until
 * then the pins are static and the committed file is reviewable in a diff. If
 * you forget, packaging and assertion both FAIL CLOSED with the exact command
 * to run — they never fall back to the weaker check.
 *
 *   node scripts/record-native-binary-digests.mjs           # rewrite the pins
 *   node scripts/record-native-binary-digests.mjs --check   # verify, write nothing
 *
 * `--check` re-derives every digest from freshly downloaded tarballs and exits
 * non-zero on any drift, without touching the file. Requires registry access.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPlatformPackages, assertPlatformVersionsMatchParents, lockedPackage } from './vsix-targets.mjs';
import {
  cacheKey,
  downloadVerifiedTarball,
  extractTarball,
  findNodeBinaries,
  sha256Hex,
} from './vendor-platform-packages.mjs';
import { assertSafeSymlinks } from './safe-symlinks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, 'native-binary-digests.json');

const checkOnly = process.argv.includes('--check');

async function digestsFor(name, scratch) {
  const { version, integrity } = lockedPackage(name);
  const key = cacheKey(name, version);

  const bytes = await downloadVerifiedTarball(
    name,
    version,
    integrity,
    'Recording digests requires registry access — it is the one step that cannot use the cache,\n' +
    'because the whole point is to re-derive the expected bytes from the lockfile-verified tarball.'
  );

  writeFileSync(join(scratch, `${key}.tgz`), bytes);
  extractTarball(`${key}.tgz`, key, scratch);
  const unpacked = join(scratch, key);

  // `tar` creates whatever symlinks the archive asks for, and `findNodeBinaries`
  // treats a symlinked `.node` as an ordinary file — so without this guard a
  // tarball could point `foo.node` at a file outside the extraction and we would
  // hash THAT, pinning a digest of something we never unpacked. Unreachable
  // today (the tarball is byte-identical to what the registry published, per the
  // integrity gate above), but this is the routine that mints the trust root for
  // every later check, so it should not rely on an upstream guarantee.
  assertSafeSymlinks(unpacked);

  const manifest = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'));
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(
      `${name}@${version} unpacked to a package calling itself ${manifest.name}@${manifest.version}.`
    );
  }

  const files = findNodeBinaries(unpacked).sort();
  if (files.length === 0) {
    throw new Error(`${name}@${version} contains no .node file — it cannot be a platform package.`);
  }

  const binaries = {};
  for (const rel of files) {
    binaries[rel] = sha256Hex(readFileSync(join(unpacked, ...rel.split('/'))));
  }
  return { version, integrity, binaries };
}

async function main() {
  assertPlatformVersionsMatchParents();

  const names = allPlatformPackages();
  const scratch = mkdtempSync(join(tmpdir(), 'napi-digests-'));
  const packages = {};

  try {
    for (const name of names) {
      const pin = await digestsFor(name, scratch);
      packages[name] = pin;
      for (const [file, digest] of Object.entries(pin.binaries)) {
        console.log(`  ${name}@${pin.version}  ${file}  sha256:${digest}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const output = {
    $comment: [
      'Exact SHA-256 of every .node file each per-platform npm package ships.',
      'Generated by scripts/record-native-binary-digests.mjs from tarballs whose SHA-512 was',
      'verified against the integrity hash in pnpm-lock.yaml BEFORE anything inside was hashed.',
      'Expected values therefore derive from the lockfile, never from a VSIX being checked.',
      'Regenerate only when impit or @ngrok/ngrok changes version; a stale pin fails packaging',
      'closed with the command to run.',
    ],
    algorithm: 'sha256',
    packages: Object.fromEntries(names.map((n) => [n, packages[n]])),
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;

  if (!checkOnly) {
    writeFileSync(OUT_FILE, serialized);
    console.log(`\n✓ Recorded ${names.length} platform packages into scripts/native-binary-digests.json`);
    return;
  }

  // Compare the PINS only, never the whole serialized file. `$comment` is prose
  // and `algorithm` is a constant; diffing them would report a comment reword as
  // "does not match the tarballs pnpm-lock.yaml pins", which is both alarming
  // and false. What this check exists to catch is a pin file that is internally
  // consistent — right version, right integrity — but carries WRONG DIGESTS.
  let existing;
  try {
    existing = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  } catch (error) {
    console.error(`\n✗ scripts/native-binary-digests.json could not be read: ${error.message}`);
    process.exit(1);
  }

  const canonical = (pkgs) => JSON.stringify(
    Object.fromEntries(
      Object.keys(pkgs ?? {}).sort().map((n) => [n, {
        version: pkgs[n]?.version,
        integrity: pkgs[n]?.integrity,
        binaries: Object.fromEntries(Object.keys(pkgs[n]?.binaries ?? {}).sort().map((f) => [f, pkgs[n].binaries[f]])),
      }])
    )
  );

  if (canonical(existing.packages) !== canonical(output.packages)) {
    console.error(
      '\n✗ scripts/native-binary-digests.json does not match the tarballs pnpm-lock.yaml pins.\n' +
      '  Run `pnpm record:binary-digests` and commit the result.'
    );
    // Name what actually differs — a bare "does not match" over 16 packages is
    // a scavenger hunt.
    for (const name of names) {
      const was = existing.packages?.[name];
      const now = output.packages[name];
      if (!was) { console.error(`    ${name}: absent from the pin file`); continue; }
      if (was.version !== now.version) console.error(`    ${name}: pinned v${was.version}, lockfile v${now.version}`);
      if (was.integrity !== now.integrity) console.error(`    ${name}: integrity differs`);
      for (const [file, digest] of Object.entries(now.binaries)) {
        if (was.binaries?.[file] !== digest) {
          console.error(`    ${name}/${file}: pinned ${was.binaries?.[file] ?? '(absent)'}, actual ${digest}`);
        }
      }
      for (const file of Object.keys(was.binaries ?? {})) {
        if (!now.binaries[file]) console.error(`    ${name}/${file}: pinned but not present in the tarball`);
      }
    }
    for (const name of Object.keys(existing.packages ?? {})) {
      if (!output.packages[name]) console.error(`    ${name}: pinned but no longer in the target matrix`);
    }
    process.exit(1);
  }
  console.log(`\n✓ All ${names.length} pinned platform packages match their lockfile-verified tarballs.`);
}

try {
  await main();
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
