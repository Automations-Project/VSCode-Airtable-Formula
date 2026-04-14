import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

const MAGIC = Buffer.from('ATSB'); // Airtable Session Backup
const CONFIG_DIR = path.join(os.homedir(), '.airtable-user-mcp');

export async function backupSession(destPath: string, password?: string): Promise<void> {
  const zipBuffer = await createZipBuffer(CONFIG_DIR);

  if (password) {
    const encrypted = encrypt(zipBuffer, password);
    await fs.writeFile(destPath, encrypted);
  } else {
    await fs.writeFile(destPath, zipBuffer);
  }
}

export async function restoreSession(srcPath: string, password?: string): Promise<void> {
  const fileData = await fs.readFile(srcPath);

  let zipBuffer: Buffer;
  if (isEncrypted(fileData)) {
    if (!password) throw new Error('Backup is encrypted — password required');
    zipBuffer = decrypt(fileData, password);
  } else {
    zipBuffer = fileData;
  }

  if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
    throw new Error('Invalid backup file — not a valid zip archive');
  }

  await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(CONFIG_DIR, true);
}

export function isEncryptedFile(data: Buffer): boolean {
  return isEncrypted(data);
}

function isEncrypted(data: Buffer): boolean {
  return data.length >= 4 && data.subarray(0, 4).equals(MAGIC);
}

function encrypt(data: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, encrypted, authTag]);
}

function decrypt(data: Buffer, password: string): Buffer {
  const salt = data.subarray(4, 36);
  const iv = data.subarray(36, 48);
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(48, data.length - 16);

  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
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
