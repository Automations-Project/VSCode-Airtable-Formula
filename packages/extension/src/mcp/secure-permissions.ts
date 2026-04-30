import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Lock down a directory so only the current OS user can access it.
 * Best-effort — failures are logged but don't throw.
 */
export async function secureDirectory(dirPath: string): Promise<void> {
  try {
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) return;

    if (process.platform === 'win32') {
      await secureWindows(dirPath);
    } else {
      await secureUnix(dirPath);
    }
    console.log(`[secure-permissions] Secured: ${dirPath}`);
  } catch (err) {
    console.warn(`[secure-permissions] Failed to secure ${dirPath}:`, err);
  }
}

async function secureUnix(dirPath: string): Promise<void> {
  await fs.chmod(dirPath, 0o700);

  const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
    try {
      if (entry.isDirectory()) {
        await fs.chmod(fullPath, 0o700);
      } else {
        await fs.chmod(fullPath, 0o600);
      }
    } catch {
      // Skip entries we can't chmod (e.g., symlinks)
    }
  }
}

async function secureWindows(dirPath: string): Promise<void> {
  const username = process.env.USERNAME;
  if (!username) {
    console.warn('[secure-permissions] USERNAME env var not set, skipping Windows ACL');
    return;
  }

  // icacls parses its grant argument `principal:permissions` with its own
  // quoting rules; usernames containing spaces / `(` / `)` / `,` would corrupt
  // the grant. Double quotes around the principal force icacls to treat it as
  // one token. Strip any embedded double-quote defensively (they are not legal
  // in Windows usernames anyway).
  const safeUser = username.replace(/"/g, '');
  if (safeUser !== username) {
    console.warn('[secure-permissions] Removed quote characters from USERNAME before passing to icacls');
  }

  await execFileAsync('icacls', [
    dirPath,
    '/inheritance:r',
    '/grant:r',
    `"${safeUser}":(OI)(CI)F`,
  ]);
}
