// apply-lock.js — per base-pair concurrency guard for mode=apply.
//
// Two concurrent applies on the same src__dest pair run concurrent background records jobs
// that duplicate every unmapped record and last-writer-wins-clobber idmap.json. The lock is
// a small JSON file in syncDir(src,dest); a holder is live iff its pid is alive. Stale locks
// (dead pid / unparseable) are replaced. NOTE: the background records job outlives apply()'s
// synchronous phase — the lock is held until that job settles (released in its completion
// path), not when apply() returns.
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { syncDir } from './idmap.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
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
  if (existsSync(lockPath)) {
    let held = null;
    try { held = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* corrupt → stale, replace */ }
    if (held && pidAlive(held.pid)) {
      const err = new Error(
        `Another apply is already running for this base pair (planId "${held.planId}", pid ${held.pid}, started ${held.startedAt}). ` +
        'Wait for it to finish (poll sync_base mode=status) before re-applying.',
      );
      err.code = 'APPLY_LOCKED';
      throw err;
    }
    // Stale lock (dead pid) — fall through and replace it.
  }
  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  safeAtomicWriteFileSync(lockPath, JSON.stringify({ pid: process.pid, planId, startedAt: new Date().toISOString() }, null, 2));
  return () => { try { unlinkSync(lockPath); } catch { /* already released */ } };
}
