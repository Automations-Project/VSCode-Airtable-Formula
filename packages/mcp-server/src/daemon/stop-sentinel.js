/**
 * "The user stopped this on purpose" marker, written next to daemon.lock.
 *
 * WHY IT EXISTS
 * -------------
 * A stop driven through the MCP tool runs inside the daemon process. It cannot
 * reach the extension host's in-memory `DaemonManager._userStopped` flag
 * (daemon-manager.ts:92, set only from the explicit stop command at :258), so the
 * next implicit `ensureDaemon()` — definition provider, credential handoff, a
 * formula command — silently spawns a replacement and the stop was a lie. The
 * sentinel is the only channel that crosses the process boundary.
 *
 * WHY IT CANNOT WEDGE A LEGITIMATE START
 * --------------------------------------
 * `startDaemon()` clears it the moment it acquires the lock, so the file only
 * ever means "the last daemon was stopped deliberately and nothing has started
 * one since". Every explicit start path — CLI `daemon start`, the detached
 * respawn, the extension's own start command — goes through `startDaemon()`, so
 * a stale sentinel survives exactly until the next intentional start. Readers
 * should additionally ignore it whenever a healthy lockfile exists (a live
 * daemon obviously outranks a record of a past stop).
 *
 * ponytail: a plain JSON file rather than a field inside daemon.lock — the
 * lockfile is deleted on stop, which is precisely when this has to survive.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHomeDir } from '../paths.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

export function getStopSentinelPath(configDir = getHomeDir()) {
  return join(configDir, 'daemon.stopped');
}

/**
 * Record a deliberate stop.
 * @param {{ configDir?: string, pid?: number|null, uuid?: string|null, by?: string, reason?: string|null }} options
 */
export function writeStopSentinel(options = {}) {
  const path = getStopSentinelPath(options.configDir);
  const record = {
    stoppedAt: new Date().toISOString(),
    pid: options.pid ?? null,
    uuid: options.uuid ?? null,
    by: options.by ?? 'unknown',
    reason: options.reason ?? null,
  };
  mkdirSync(dirname(path), { recursive: true });
  safeAtomicWriteFileSync(path, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return record;
}

/** @returns {{stoppedAt:string,pid:number|null,uuid:string|null,by:string,reason:string|null}|null} */
export function readStopSentinel(options = {}) {
  const path = getStopSentinelPath(options.configDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // A corrupt sentinel must not suppress a start — treat it as absent.
    return null;
  }
}

/** @returns {boolean} true when a sentinel existed and was removed. */
export function clearStopSentinel(options = {}) {
  const path = getStopSentinelPath(options.configDir);
  if (!existsSync(path)) return false;
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
