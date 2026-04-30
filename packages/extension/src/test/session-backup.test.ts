import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';

// Import after mocking so CONFIG_DIR resolves against our throwaway sandbox.
const sandboxParent = path.join(os.tmpdir(), 'airtable-sb-test-' + Date.now());
const configDir    = path.join(sandboxParent, '.airtable-user-mcp');

// We cannot override `CONFIG_DIR` directly (it's a module-top constant resolved
// from `os.homedir()`), so we stub `os.homedir()` before importing the module.
vi.mock('os', async (orig) => {
  const actual = (await orig()) as typeof os;
  return { ...actual, homedir: () => sandboxParent };
});

// Dynamically import after the mock so the module reads our stubbed home dir.
let backupSession: typeof import('../mcp/session-backup.js').backupSession;
let restoreSession: typeof import('../mcp/session-backup.js').restoreSession;
let isEncryptedFile: typeof import('../mcp/session-backup.js').isEncryptedFile;

beforeEach(async () => {
  fsSync.mkdirSync(configDir, { recursive: true });
  fsSync.writeFileSync(path.join(configDir, 'seed.txt'), 'seed data');
  const mod = await import('../mcp/session-backup.js');
  backupSession = mod.backupSession;
  restoreSession = mod.restoreSession;
  isEncryptedFile = mod.isEncryptedFile;
});

afterEach(() => {
  fsSync.rmSync(sandboxParent, { recursive: true, force: true });
});

// ─── Unencrypted roundtrip ──────────────────────────────────────────────────
describe('backup/restore roundtrip (unencrypted)', () => {
  it('backs up and restores the config dir', async () => {
    const dest = path.join(sandboxParent, 'backup.zip');
    await backupSession(dest);
    expect(fsSync.existsSync(dest)).toBe(true);

    // Wipe config and restore.
    fsSync.rmSync(configDir, { recursive: true, force: true });
    await restoreSession(dest);

    expect(fsSync.existsSync(path.join(configDir, 'seed.txt'))).toBe(true);
    expect(fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8')).toBe('seed data');
  });
});

// ─── Encrypted v2 roundtrip ─────────────────────────────────────────────────
describe('backup/restore roundtrip (encrypted v2)', () => {
  it('encrypts, detects, and decrypts with the correct password', async () => {
    const dest = path.join(sandboxParent, 'backup.enc.zip');
    await backupSession(dest, 'hunter2');

    const raw = await fs.readFile(dest);
    expect(isEncryptedFile(raw)).toBe(true);
    // v2 format has the version byte at offset 4.
    expect(raw[0]).toBe(0x41); // 'A'
    expect(raw[4]).toBe(0x02); // FORMAT_V2

    fsSync.rmSync(configDir, { recursive: true, force: true });
    await restoreSession(dest, 'hunter2');
    expect(fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8')).toBe('seed data');
  });

  it('rejects an incorrect password with a clear message', async () => {
    const dest = path.join(sandboxParent, 'backup.enc.zip');
    await backupSession(dest, 'correct');
    fsSync.rmSync(configDir, { recursive: true, force: true });
    await expect(restoreSession(dest, 'wrong')).rejects.toThrow(/Incorrect password|corrupted/);
  });

  it('rejects an encrypted backup when no password is supplied', async () => {
    const dest = path.join(sandboxParent, 'backup.enc.zip');
    await backupSession(dest, 'hunter2');
    await expect(restoreSession(dest)).rejects.toThrow(/password required/);
  });
});

// ─── v1 legacy format (read-only) ───────────────────────────────────────────
describe('legacy v1 format read (C3 backwards-compat)', () => {
  it('can decrypt a hand-crafted v1 backup produced with PBKDF2 100k', async () => {
    // Build a v1-format blob: MAGIC(4) + salt(32) + iv(12) + ciphertext + authTag(16).
    // No version byte — the parser falls back to v1 iterations.
    const zip = new AdmZip();
    zip.addFile('seed.txt', Buffer.from('v1 payload'));
    const zipBuf = zip.toBuffer();

    const salt = crypto.randomBytes(32);
    const iv   = crypto.randomBytes(12);
    const key  = crypto.pbkdf2Sync('legacypw', salt, 100_000, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct     = Buffer.concat([cipher.update(zipBuf), cipher.final()]);
    const tag    = cipher.getAuthTag();
    // NOTE: NO version byte — this is the v1 header.
    const v1Blob = Buffer.concat([Buffer.from('ATSB'), salt, iv, ct, tag]);

    const dest = path.join(sandboxParent, 'legacy.zip');
    await fs.writeFile(dest, v1Blob);

    fsSync.rmSync(configDir, { recursive: true, force: true });
    await restoreSession(dest, 'legacypw');
    expect(fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8')).toBe('v1 payload');
  });
});

// ─── C4 zip-slip defence ────────────────────────────────────────────────────
//
// adm-zip's `addFile()` sanitizes leading `../` at encode time, so we cannot
// construct a zip-slip fixture via its public API. Real malicious backups
// produced by other tools (python zipfile, 7-zip trash-files mode, rogue
// archivers) DO preserve `../` in the central directory, so we still need the
// defense — we just test it with a hand-crafted PKZIP binary below, plus a
// null-byte entry name which adm-zip does preserve.

/**
 * Build a minimal PKZIP archive with a single STORED (uncompressed) entry
 * whose entry name is exactly what the caller specified — no normalisation.
 * This is the zip equivalent of a hand-crafted attack file.
 */
function buildMaliciousZip(entryName: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, 'utf8');
  // Proper CRC-32 (adm-zip validates it on getData()).
  const crc32 = Buffer.alloc(4);
  let c = ~0 >>> 0;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  crc32.writeUInt32LE((~c) >>> 0, 0);

  // Local file header
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);      // version needed
  lfh.writeUInt16LE(0, 6);       // flags
  lfh.writeUInt16LE(0, 8);       // method = store
  lfh.writeUInt16LE(0, 10);      // mod time
  lfh.writeUInt16LE(0, 12);      // mod date
  crc32.copy(lfh, 14);           // crc32
  lfh.writeUInt32LE(data.length, 18); // comp size
  lfh.writeUInt32LE(data.length, 22); // uncomp size
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);      // extra len

  const localEntry = Buffer.concat([lfh, nameBuf, data]);

  // Central directory entry
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);       // version made by
  cd.writeUInt16LE(20, 6);       // version needed
  cd.writeUInt16LE(0, 8);        // flags
  cd.writeUInt16LE(0, 10);       // method
  cd.writeUInt16LE(0, 12);       // mod time
  cd.writeUInt16LE(0, 14);       // mod date
  crc32.copy(cd, 16);
  cd.writeUInt32LE(data.length, 20); // comp size
  cd.writeUInt32LE(data.length, 24); // uncomp size
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);       // extra len
  cd.writeUInt16LE(0, 32);       // comment len
  cd.writeUInt16LE(0, 34);       // disk
  cd.writeUInt16LE(0, 36);       // internal attrs
  cd.writeUInt32LE(0, 38);       // external attrs
  cd.writeUInt32LE(0, 42);       // offset of local header

  const cdEntry = Buffer.concat([cd, nameBuf]);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);      // disk
  eocd.writeUInt16LE(0, 6);      // cd disk
  eocd.writeUInt16LE(1, 8);      // entries this disk
  eocd.writeUInt16LE(1, 10);     // total entries
  eocd.writeUInt32LE(cdEntry.length, 12); // cd size
  eocd.writeUInt32LE(localEntry.length, 16); // cd offset
  eocd.writeUInt16LE(0, 20);     // comment len

  return Buffer.concat([localEntry, cdEntry, eocd]);
}

describe('zip-slip rejection (C4)', () => {
  it('rejects a backup with a ../ traversal entry (hand-crafted zip)', async () => {
    const maliciousZip = buildMaliciousZip('../evil.txt', Buffer.from('pwned'));
    const dest = path.join(sandboxParent, 'malicious.zip');
    await fs.writeFile(dest, maliciousZip);

    await expect(restoreSession(dest)).rejects.toThrow(/zip-slip|escapes target|malformed/);
    // CONFIG_DIR should still be intact.
    expect(fsSync.existsSync(path.join(configDir, 'seed.txt'))).toBe(true);
    // Nothing must have landed at the traversal target.
    expect(fsSync.existsSync(path.join(sandboxParent, 'evil.txt'))).toBe(false);
  });

  it('rejects a backup whose entry name contains a NUL byte', async () => {
    // adm-zip preserves NUL bytes in entry names, giving us a path to exercise
    // the malformed-name branch of our validation without a hand-crafted zip.
    const zip = new AdmZip();
    zip.addFile('ev\0il.txt', Buffer.from('nope'));
    const dest = path.join(sandboxParent, 'null-byte.zip');
    await fs.writeFile(dest, zip.toBuffer());

    await expect(restoreSession(dest)).rejects.toThrow(/malformed entry name/);
  });
});

// ─── H1 size cap ────────────────────────────────────────────────────────────
describe('file-size cap (H1)', () => {
  it('rejects backups larger than 200 MB', async () => {
    // Fake the size via truncate+allocate so we don't actually write 200 MB.
    const dest = path.join(sandboxParent, 'huge.zip');
    const fd = await fs.open(dest, 'w');
    try {
      await fd.truncate(201 * 1024 * 1024);
    } finally {
      await fd.close();
    }
    await expect(restoreSession(dest)).rejects.toThrow(/too large/);
  });
});

// ─── C5 staged restore preserves old data on failure ────────────────────────
describe('staged restore (C5)', () => {
  it('leaves the existing config dir intact when validation fails', async () => {
    // Use the hand-crafted ../ zip (adm-zip would sanitize it away).
    const maliciousZip = buildMaliciousZip('../escape.txt', Buffer.from('nope'));
    const dest = path.join(sandboxParent, 'bad.zip');
    await fs.writeFile(dest, maliciousZip);

    const preHash = fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8');
    await expect(restoreSession(dest)).rejects.toThrow();

    // Existing config must be untouched (round-2 bug: previously wiped first).
    expect(fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8')).toBe(preHash);
  });

  it('successfully replaces config dir atomically on success', async () => {
    // Write seed content that differs from what will be restored, so we can
    // confirm a swap actually happened.
    fsSync.writeFileSync(path.join(configDir, 'marker.txt'), 'will be replaced');

    // Build a fresh backup from a different source state.
    const altConfig = path.join(sandboxParent, 'alt-config');
    fsSync.mkdirSync(altConfig, { recursive: true });
    fsSync.writeFileSync(path.join(altConfig, 'seed.txt'), 'fresh data');
    const altZip = new AdmZip();
    altZip.addLocalFolder(altConfig);
    const dest = path.join(sandboxParent, 'fresh.zip');
    await fs.writeFile(dest, altZip.toBuffer());

    await restoreSession(dest);

    // Old marker should be gone, new seed present.
    expect(fsSync.existsSync(path.join(configDir, 'marker.txt'))).toBe(false);
    expect(fsSync.readFileSync(path.join(configDir, 'seed.txt'), 'utf8')).toBe('fresh data');
  });
});
