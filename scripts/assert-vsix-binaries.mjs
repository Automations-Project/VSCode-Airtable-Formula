/**
 * Assert that a packaged .vsix contains EXACTLY the native binaries its vsce
 * target needs — and none belonging to any other platform.
 *
 * Both halves matter. A missing binary means "Cannot find native binding" the
 * first time a user selects `mcp.httpClient: "impit"` or starts an ngrok
 * tunnel. A binary from the WRONG platform is the same failure wearing a
 * disguise: the tree looks populated, packaging looks like it worked, and the
 * bug only surfaces on a user's machine. So the check is two-sided —
 * present-and-correct, and absent-if-not-ours.
 *
 * Usage:
 *   node scripts/assert-vsix-binaries.mjs [--target=<t>] <file.vsix> [...]
 *   node scripts/assert-vsix-binaries.mjs --dir=artifacts        (all targets)
 *
 * With no --target the target is read from the vsce-generated filename
 * (`airtable-formula-<target>-<version>.vsix`).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  ALL_TARGETS,
  isPlatformPackage,
  lockedPackage,
  targetConfig,
} from './vsix-targets.mjs';

const NODE_MODULES_PREFIX = 'extension/dist/node_modules/';

// ── Minimal ZIP reader (central directory only — no full extraction) ────────
// A .vsix is a plain zip. We only need the entry list plus a handful of tiny
// package.json files, so this reads the central directory and inflates single
// members on demand rather than pulling in a zip dependency.

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a zip file: end-of-central-directory record not found');
}

function readDirectoryLocation(buf) {
  const eocd = findEocd(buf);
  let entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  // ZIP64 — vsce artifacts routinely exceed 65535 entries (patchright alone
  // contributes thousands), at which point the 32-bit fields are saturated and
  // the real values live in the ZIP64 record.
  if (entries === 0xffff || offset === 0xffffffff) {
    let locator = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOCATOR_SIG) { locator = i; break; }
    }
    if (locator < 0) throw new Error('Zip claims ZIP64 but no ZIP64 locator was found');
    const eocd64 = Number(buf.readBigUInt64LE(locator + 8));
    if (buf.readUInt32LE(eocd64) !== EOCD64_SIG) throw new Error('Malformed ZIP64 end-of-central-directory');
    entries = Number(buf.readBigUInt64LE(eocd64 + 32));
    offset = Number(buf.readBigUInt64LE(eocd64 + 48));
  }

  return { entries, offset };
}

/** Parse the ZIP64 extra field, which overrides saturated 32-bit values. */
function readZip64Extra(extra, wants) {
  const out = {};
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      for (const field of wants) {
        if (q + 8 > p + 4 + size) break;
        out[field] = Number(extra.readBigUInt64LE(q));
        q += 8;
      }
      break;
    }
    p += 4 + size;
  }
  return out;
}

function readEntries(buf) {
  const { entries: count, offset } = readDirectoryLocation(buf);
  const entries = new Map();
  let p = offset;

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`Malformed zip: central directory entry ${i} has a bad signature`);
    }
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // ZIP64 packs only the saturated fields, in this fixed order.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      const wants = [];
      if (uncompressedSize === 0xffffffff) wants.push('uncompressedSize');
      if (compressedSize === 0xffffffff) wants.push('compressedSize');
      if (localOffset === 0xffffffff) wants.push('localOffset');
      const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      const z64 = readZip64Extra(extra, wants);
      if (z64.uncompressedSize !== undefined) uncompressedSize = z64.uncompressedSize;
      if (z64.compressedSize !== undefined) compressedSize = z64.compressedSize;
      if (z64.localOffset !== undefined) localOffset = z64.localOffset;
    }

    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function readMember(buf, entry) {
  const nameLen = buf.readUInt16LE(entry.localOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
}

// ── Assertions ─────────────────────────────────────────────────────────────

/** `extension/dist/node_modules/@ngrok/ngrok-darwin-x64/x.node` -> `@ngrok/ngrok-darwin-x64` */
function packageNameOf(entryName) {
  if (!entryName.startsWith(NODE_MODULES_PREFIX)) return undefined;
  const rest = entryName.slice(NODE_MODULES_PREFIX.length);
  const parts = rest.split('/');
  if (parts.length < 2) return undefined;
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** The vsce target encoded in a `<name>-<target>-<version>.vsix` filename, if any. */
function targetFromFilename(file) {
  const name = basename(file, '.vsix');
  return ALL_TARGETS.find((t) => name.includes(`-${t}-`) || name.endsWith(`-${t}`));
}

export function assertVsix(file, target) {
  const config = targetConfig(target);
  const buf = readFileSync(file);
  const entries = readEntries(buf);
  const problems = [];
  const verified = [];

  const manifestOf = (pkg) => {
    const entry = entries.get(`${NODE_MODULES_PREFIX}${pkg}/package.json`);
    if (!entry) return undefined;
    try {
      return JSON.parse(readMember(buf, entry).toString('utf8'));
    } catch (error) {
      problems.push(`${pkg}/package.json could not be read: ${error.message}`);
      return undefined;
    }
  };

  // 1. The artifact must actually BE a platform build. vsce stamps
  //    `TargetPlatform="<t>"` into extension.vsixmanifest when --target is
  //    passed and omits it otherwise, and that attribute — not the filename —
  //    is what the Marketplace and Open VSX use to decide who gets this
  //    artifact. Without this check a correctly-named but untargeted VSIX
  //    would pass every binary assertion below and then be published as the
  //    universal build for every platform: the exact failure this exists to
  //    prevent.
  const manifestEntry = entries.get('extension.vsixmanifest');
  if (!manifestEntry) {
    problems.push('extension.vsixmanifest is missing — not a valid VSIX');
  } else {
    const xml = readMember(buf, manifestEntry).toString('utf8');
    const stamped = /TargetPlatform="([^"]+)"/.exec(xml)?.[1];
    if (!stamped) {
      problems.push(
        'extension.vsixmanifest declares no TargetPlatform — this is an UNTARGETED VSIX ' +
        'and must never be published; package it with `vsce package --target <t>`'
      );
    } else if (stamped !== target) {
      problems.push(`extension.vsixmanifest declares TargetPlatform="${stamped}" but was checked as ${target}`);
    }
  }

  // 2. The pure-JS loaders must be present — a binary with no loader is dead weight.
  for (const parent of ['impit', '@ngrok/ngrok']) {
    if (!entries.has(`${NODE_MODULES_PREFIX}${parent}/package.json`)) {
      problems.push(`missing loader package dist/node_modules/${parent}`);
    }
  }

  // 3. Every expected platform package present, at the locked version, for the
  //    right os/cpu, with the exact .node file its own package.json points at.
  const expected = new Set(config.packages);
  for (const pkg of config.packages) {
    const manifest = manifestOf(pkg);
    if (!manifest) {
      problems.push(`missing platform package dist/node_modules/${pkg} (required by target ${target})`);
      continue;
    }

    const locked = lockedPackage(pkg).version;
    if (manifest.version !== locked) {
      problems.push(`${pkg} is v${manifest.version} but pnpm-lock.yaml pins v${locked}`);
    }
    if (Array.isArray(manifest.os) && !manifest.os.includes(config.os)) {
      problems.push(`${pkg} declares os=[${manifest.os}] but target ${target} is ${config.os}`);
    }
    if (Array.isArray(manifest.cpu) && !manifest.cpu.includes(config.cpu)) {
      problems.push(`${pkg} declares cpu=[${manifest.cpu}] but target ${target} is ${config.cpu}`);
    }

    const main = typeof manifest.main === 'string' ? manifest.main : undefined;
    if (!main || !main.endsWith('.node')) {
      problems.push(`${pkg} package.json "main" is ${JSON.stringify(main)} — expected a .node file`);
      continue;
    }
    const binary = entries.get(`${NODE_MODULES_PREFIX}${pkg}/${main}`);
    if (!binary) {
      problems.push(`${pkg} is present but its native binary "${main}" is missing from the VSIX`);
    } else if (binary.uncompressedSize === 0) {
      problems.push(`${pkg}/${main} is present but empty (0 bytes)`);
    } else {
      verified.push({ pkg, version: manifest.version, binary: main, bytes: binary.uncompressedSize });
    }
  }

  // 4. No OTHER platform package may be present. This is the wrong-binary
  //    check: it is driven by the `<parent>-` naming rule rather than by a list
  //    of the other targets, so a platform package outside the matrix entirely
  //    (impit-freebsd-x64, @ngrok/ngrok-android-arm64, …) is caught too.
  const foundPlatformPkgs = new Set();
  for (const name of entries.keys()) {
    const pkg = packageNameOf(name);
    if (pkg && isPlatformPackage(pkg)) foundPlatformPkgs.add(pkg);
  }
  for (const pkg of [...foundPlatformPkgs].sort()) {
    if (!expected.has(pkg)) {
      problems.push(`dist/node_modules/${pkg} does not belong in a ${target} VSIX — wrong platform`);
    }
  }

  // 5. Belt and braces: every .node file anywhere in the artifact must live in
  //    an expected platform package. Catches a stray binary copied outside
  //    node_modules, which check 3 would not see.
  for (const name of entries.keys()) {
    if (!name.endsWith('.node')) continue;
    const pkg = packageNameOf(name);
    if (!pkg || !expected.has(pkg)) {
      problems.push(`unexpected native binary in ${target} VSIX: ${name}`);
    }
  }

  return { file, target, problems, verified };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const explicitTarget = args.find((a) => a.startsWith('--target='))?.slice('--target='.length);
  const dir = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
  let files = args.filter((a) => !a.startsWith('--'));

  if (dir) {
    files = files.concat(
      readdirSync(dir).filter((f) => f.endsWith('.vsix')).sort().map((f) => join(dir, f))
    );
  }

  if (files.length === 0) {
    console.error('Usage: node scripts/assert-vsix-binaries.mjs [--target=<t>] <file.vsix> [...]');
    console.error('       node scripts/assert-vsix-binaries.mjs --dir=artifacts');
    process.exit(2);
  }

  let failed = false;
  const seenTargets = new Set();

  for (const file of files) {
    const target = explicitTarget || targetFromFilename(file);

    // An artifact whose filename carries no target is an untargeted build.
    // Those must never be published, so treat one as a failure rather than
    // guessing a target for it.
    if (!target) {
      failed = true;
      console.error(
        `\n✗ ${basename(file)}  [no target in filename]\n` +
        '    untargeted VSIX — must never be published; rebuild with ' +
        '`node scripts/package-targets.mjs`, or pass --target=<t> to check it anyway'
      );
      continue;
    }

    seenTargets.add(target);
    const result = assertVsix(file, target);

    if (result.problems.length > 0) {
      failed = true;
      console.error(`\n✗ ${basename(file)}  [${target}]`);
      for (const problem of result.problems) console.error(`    ${problem}`);
    } else {
      console.log(`\n✓ ${basename(file)}  [${target}]`);
      for (const v of result.verified) {
        console.log(`    ${v.pkg}@${v.version} → ${v.binary} (${(v.bytes / 1048576).toFixed(1)} MiB)`);
      }
    }
  }

  // When asked to check a whole directory, an artifact set that silently lost a
  // target is itself a failure — a release must cover every published target.
  if (dir && !explicitTarget) {
    const missing = ALL_TARGETS.filter((t) => !seenTargets.has(t));
    if (missing.length > 0) {
      failed = true;
      console.error(`\n✗ ${dir} is missing a VSIX for: ${missing.join(', ')}`);
    }
  }

  console.log('');
  if (failed) {
    console.error('VSIX native-binary assertions FAILED.');
    process.exit(1);
  }
  console.log(`VSIX native-binary assertions passed for ${files.length} artifact(s).`);
}

// Run only when invoked directly, not when imported by package-targets.mjs.
if (process.argv[1]?.endsWith('assert-vsix-binaries.mjs')) {
  main();
}
