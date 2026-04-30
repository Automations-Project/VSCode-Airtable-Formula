import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

// Format:
//   v1:  MAGIC(4) + salt(32) + iv(12) + ciphertext + authTag(16)  — PBKDF2 100k
//   v2:  MAGIC(4) + VERSION(1=0x02) + salt(32) + iv(12) + ciphertext + authTag(16)  — PBKDF2 600k
// v1 is read for backwards-compat; v2 is written for all new encrypted backups.
const MAGIC = Buffer.from('ATSB'); // Airtable Session Backup
const FORMAT_V2 = 0x02;
const PBKDF2_ITERS_V1 = 100_000;  // legacy, read-only
const PBKDF2_ITERS_V2 = 600_000;  // OWASP 2023 recommendation for PBKDF2-SHA256
const CONFIG_DIR = path.join(os.homedir(), '.airtable-user-mcp');

// Hard caps — reject files larger than this to prevent OOM and zip-bombs.
const MAX_BACKUP_FILE_BYTES = 200 * 1024 * 1024;    // 200 MB on-disk
const MAX_UNZIPPED_BYTES    = 500 * 1024 * 1024;    // 500 MB post-extraction

export async function backupSession(destPath: string, password?: string): Promise<void> {
  const zipBuffer = await createZipBuffer(CONFIG_DIR);

  if (password) {
    const encrypted = encrypt(zipBuffer, password);
    await fs.writeFile(destPath, encrypted);
  } else {
    await fs.writeFile(destPath, zipBuffer);
  }
}

/** Parsed header of an encrypted backup. */
interface BackupHeader {
  version:    1 | 2;
  iterations: number;
  saltOffset: number;
}

function parseEncryptedHeader(data: Buffer): BackupHeader {
  // v2: MAGIC(4) + VERSION(1=0x02) + salt(32) + ...
  if (data.length >= 5 && data[4] === FORMAT_V2) {
    return { version: 2, iterations: PBKDF2_ITERS_V2, saltOffset: 5 };
  }
  // v1: MAGIC(4) + salt(32) + iv(12) + ...   (no version byte)
  return { version: 1, iterations: PBKDF2_ITERS_V1, saltOffset: 4 };
}

export async function restoreSession(srcPath: string, password?: string): Promise<void> {
  // H1 — size guard. stat before reading so a 4 GB attacker file doesn't OOM
  // the extension host.
  const stat = await fs.stat(srcPath);
  if (stat.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error(`Backup file is too large (${stat.size} bytes, max ${MAX_BACKUP_FILE_BYTES}).`);
  }

  const fileData = await fs.readFile(srcPath);

  let zipBuffer: Buffer;
  if (isEncrypted(fileData)) {
    if (!password) throw new Error('Backup is encrypted — password required');
    zipBuffer = decrypt(fileData, password);
  } else {
    zipBuffer = fileData;
  }

  // Minimal sanity check that this even looks like a PKZIP file (header "PK").
  if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
    throw new Error('Invalid backup file — not a valid zip archive');
  }

  // C4 / C5 — staged restore. Extract into a sibling staging dir first, validate
  // every entry stays inside it, track uncompressed size to guard against
  // zip-bombs, and only then swap it into CONFIG_DIR. If any step fails the
  // user's existing session is untouched.
  const parent = path.dirname(CONFIG_DIR);
  const stagingDir = path.join(parent, path.basename(CONFIG_DIR) + '.restoring.' + crypto.randomBytes(6).toString('hex'));
  await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(stagingDir, { recursive: true });

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const stagingResolved = path.resolve(stagingDir) + path.sep;
    let totalSize = 0;

    for (const entry of entries) {
      // Normalise / reject absolute paths, drive letters, and `..` traversal.
      // Calling path.resolve() against the staging dir and checking the prefix
      // is the canonical zip-slip defence.
      const rawName = entry.entryName;
      if (!rawName || rawName.includes('\0')) {
        throw new Error(`Backup rejected: malformed entry name "${rawName}"`);
      }
      const resolved = path.resolve(stagingDir, rawName);
      if (!(resolved + (entry.isDirectory ? path.sep : '')).startsWith(stagingResolved) && resolved + path.sep !== stagingResolved) {
        throw new Error(`Backup rejected: entry "${rawName}" escapes target directory (zip-slip).`);
      }

      if (entry.isDirectory) {
        await fs.mkdir(resolved, { recursive: true });
        continue;
      }

      // Track uncompressed size to guard against zip-bombs.
      const data = entry.getData();
      totalSize += data.length;
      if (totalSize > MAX_UNZIPPED_BYTES) {
        throw new Error(`Backup rejected: uncompressed size exceeds ${MAX_UNZIPPED_BYTES} bytes (possible zip-bomb).`);
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, data);
    }

    // Atomic swap: move old aside, move staging into place. rm-rf the old one
    // only after the swap succeeded so we never end up with no session.
    const backupAside = CONFIG_DIR + '.old.' + crypto.randomBytes(6).toString('hex');
    let hadExisting = false;
    try {
      await fs.rename(CONFIG_DIR, backupAside);
      hadExisting = true;
    } catch (err: unknown) {
      // ENOENT = no existing config is fine, everything else rethrows
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    try {
      await fs.rename(stagingDir, CONFIG_DIR);
    } catch (err) {
      // Swap failed — try to restore the original so we don't leave the user stranded.
      if (hadExisting) {
        await fs.rename(backupAside, CONFIG_DIR).catch(() => {});
      }
      throw err;
    }

    // Swap succeeded — delete the aside copy best-effort.
    if (hadExisting) {
      await fs.rm(backupAside, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    // Validation or extraction failed. Wipe staging; existing CONFIG_DIR is
    // intact because we never touched it.
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export function isEncryptedFile(data: Buffer): boolean {
  return isEncrypted(data);
}

function isEncrypted(data: Buffer): boolean {
  return data.length >= 4 && data.subarray(0, 4).equals(MAGIC);
}

function encrypt(data: Buffer, password: string): Buffer {
  // Always write v2 (600k PBKDF2 iterations). v1 is read-only for back-compat.
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERS_V2, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_V2]), salt, iv, encrypted, authTag]);
}

function decrypt(data: Buffer, password: string): Buffer {
  const header = parseEncryptedHeader(data);
  const saltStart = header.saltOffset;
  const saltEnd   = saltStart + 32;
  const ivStart   = saltEnd;
  const ivEnd     = ivStart + 12;
  const tagStart  = data.length - 16;

  if (tagStart <= ivEnd) {
    throw new Error('Corrupted backup — file too short to contain ciphertext.');
  }

  const salt = data.subarray(saltStart, saltEnd);
  const iv = data.subarray(ivStart, ivEnd);
  const authTag = data.subarray(tagStart);
  const encrypted = data.subarray(ivEnd, tagStart);

  const key = crypto.pbkdf2Sync(password, salt, header.iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error('Incorrect password or corrupted backup');
  }
}

async function createZipBuffer(dirPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(dirPath, false);
    archive.finalize();
  });
}
