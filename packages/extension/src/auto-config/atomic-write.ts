import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const fileLocks = new Map<string, Promise<void>>();

/**
 * Runs `fn` once every earlier call with the same key (a pathKey) has settled. Two writers in
 * this process then never read-modify-write one config file at once: Configure-official and a
 * card's Setup on one file would otherwise each write the file without the other's entry, and on
 * Windows the second rename can fail with EPERM while the first is in flight.
 */
export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(() => undefined, () => undefined);
  fileLocks.set(key, settled);
  void settled.then(() => { if (fileLocks.get(key) === settled) fileLocks.delete(key); });
  return run;
}

/**
 * Atomic text-file writer shared by every auto-config writer.
 *
 * - Unique random tmp suffix per write (H10): two concurrent writes to the same target (e.g. a
 *   double-click on "Setup") cannot collide on the tmp path and truncate each other's output.
 * - Mode 0600: these files can carry the Airtable PAT (Authorization: Bearer pat...). The rename
 *   replaces the destination inode, so without an explicit mode any restrictive permissions the
 *   user had set would be reset to 0644. No-op on Windows.
 * - The tmp file is removed if the write or rename fails.
 */
export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}
