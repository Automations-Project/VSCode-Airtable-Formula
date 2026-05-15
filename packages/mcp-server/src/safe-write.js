import { writeFileSync, renameSync, rmSync } from "node:fs";

/**
 * Atomically write `data` to `path` via a `${path}.tmp` staging file and
 * `renameSync`. On Windows, Node's renameSync uses MoveFileExW with
 * MOVEFILE_REPLACE_EXISTING, so the destination is replaced atomically with
 * no rmSync window. On any failure, best-effort delete the `.tmp` file and
 * re-throw the original error.
 *
 * The caller is responsible for `mkdirSync` of the parent directory and for
 * any post-write `chmod` / permissions hardening; this helper only owns the
 * write+rename pair.
 *
 * @param {string} path Final destination path.
 * @param {string|Buffer|Uint8Array} data Bytes to write.
 * @param {string|object} [opts] Encoding string or fs.writeFileSync options.
 */
export function safeAtomicWriteFileSync(path, data, opts) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, data, opts);
    renameSync(tmp, path);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
