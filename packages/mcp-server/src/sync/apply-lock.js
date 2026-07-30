// apply-lock.js — per base-pair concurrency guard for mode=apply.
//
// Two concurrent applies on the same src__dest pair run concurrent background records jobs
// that duplicate every unmapped record and last-writer-wins-clobber idmap.json. The lock is
// a small JSON file in syncDir(src,dest); a holder is live iff its pid is alive. Stale locks
// (dead pid / unparseable) are replaced. NOTE: the background records job outlives apply()'s
// synchronous phase — the lock is held until that job settles (released in its completion
// path), not when apply() returns.
import { join } from 'node:path';
import { readFileSync, mkdirSync, unlinkSync, openSync, writeSync, closeSync } from 'node:fs';
import { syncDir } from './idmap.js';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// In-process single-flight guard. The daemon serves up to 16 concurrent tool calls in ONE node
// process, so two mode=apply calls on the same pair would race the file check below AND carry the
// same pid (the file can't tell same-process callers apart). Keyed on the resolved lockPath (which
// incorporates AIRTABLE_USER_MCP_HOME via syncDir), NOT the bare appId pair, so it isolates exactly
// like the on-disk lock — same pair + same home collides (correct), different home does not (tests).
// acquireApplyLock is fully SYNCHRONOUS (no awaits between check and add), so this Set alone
// serializes same-process callers with no interleave window.
const heldLockPaths = new Set();

function lockedError(msg) {
  const err = new Error(msg);
  err.code = 'APPLY_LOCKED';
  return err;
}

/**
 * Acquire the per-pair apply lock, or throw `APPLY_LOCKED` if a live holder exists.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {string} planId
 * @returns {() => void} release function (bound to the lock path resolved at acquire time)
 */
export function acquireApplyLock(sourceBaseId, destBaseId, planId) {
  const lockPath = join(syncDir(sourceBaseId, destBaseId), 'apply.lock');

  if (heldLockPaths.has(lockPath)) {
    throw lockedError(
      `Another apply is already running in this process for base pair ${sourceBaseId}__${destBaseId}. ` +
      'Poll sync_base mode=status before re-applying.',
    );
  }

  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, planId, startedAt: new Date().toISOString() }, null, 2);

  // Cross-process/crash guard: atomic EXCLUSIVE create ('wx' → EEXIST if the file already exists),
  // so two processes can't both observe "no lock" and both proceed (the check-then-write race).
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // File exists: a LIVE holder (refuse) or a STALE one (dead pid / corrupt) → replace it, then
    // re-create exclusively. A live pid — even our own — means a real holder: same-process concurrency
    // is already caught by heldLockPaths above, so reaching here with our pid means an external holder.
    let held = null;
    try { held = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* corrupt → stale */ }
    if (held && pidAlive(held.pid)) {
      throw lockedError(
        `Another apply is already running for this base pair (planId "${held.planId}", pid ${held.pid}, started ${held.startedAt}). ` +
        'Wait for it to finish (poll sync_base mode=status) before re-applying.',
      );
    }
    try { unlinkSync(lockPath); } catch { /* raced away */ }
    fd = openSync(lockPath, 'wx'); // EEXIST here means a real concurrent winner slipped in → fail safe (never double-apply)
  }
  try { writeSync(fd, payload); } finally { closeSync(fd); }

  heldLockPaths.add(lockPath);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    heldLockPaths.delete(lockPath);
    try { unlinkSync(lockPath); } catch { /* already released */ }
  };
}
