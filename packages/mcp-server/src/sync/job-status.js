// job-status.js — unified per-planId background-job status for base-to-base sync.
//
// `mode=plan` and `mode=apply` are minutes-long on real / view-heavy bases (a plan snapshots
// BOTH bases; an apply runs the whole schema phase before it backgrounds records) — long enough
// that a synchronous MCP call surfaces as `MCP error -32000: Connection closed` even though the
// work completes + persists server-side. So both are launched as BACKGROUND jobs (planJob /
// applyJob in ./index.js) that return `{ jobId, status:'running' }` immediately; progress is
// written here to `sync-job-<planId>.json` and polled via `sync_base mode=status`.
//
// Phases: 'planning' | 'schema' | 'records' | 'done' | 'failed'. The first three are RUNNING
// phases and carry the writer `pid` — a reader that finds a running phase whose pid is dead
// (the process crashed before writing a terminal phase) reports it as 'failed' with resume
// advice, mirroring the records-job pid-liveness fix in records.js.
//
// Writes MERGE-FORWARD over the existing file so a later terminal write keeps the fields set by
// earlier phases (e.g. the 'done' write preserves the 'records' write's schemaResult + startedAt).
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { syncDir } from './idmap.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

/** Phases during which the writing process is still alive and expected to advance the file. */
const RUNNING_PHASES = new Set(['planning', 'schema', 'records']);

function syncJobPath(sourceBaseId, destBaseId, planId) {
  return join(syncDir(sourceBaseId, destBaseId), `sync-job-${planId}.json`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Merge `status` over the current sync-job file and persist atomically.
 *
 * - Merge-forward: earlier fields (startedAt, schemaResult, planDigest, …) survive later writes.
 * - RUNNING phases stamp the writer's pid (for liveness detection); terminal phases drop it.
 * - `planId`/`jobId` are always set to the file's planId.
 *
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {string} planId
 * @param {{ phase: string, [k:string]: any }} status
 * @returns {object} the persisted body
 */
export function writeSyncJobStatus(sourceBaseId, destBaseId, planId, status) {
  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  const p = syncJobPath(sourceBaseId, destBaseId, planId);
  let existing = {};
  if (existsSync(p)) {
    try { existing = JSON.parse(readFileSync(p, 'utf8')) || {}; } catch { existing = {}; }
  }
  const body = { ...existing, ...status, planId, jobId: planId };
  if (RUNNING_PHASES.has(body.phase)) {
    // Honor an explicitly-supplied pid (tests inject a dead one); otherwise stamp our own.
    if (status.pid == null) body.pid = process.pid;
  } else {
    delete body.pid;
  }
  safeAtomicWriteFileSync(p, JSON.stringify(body, null, 2));
  return body;
}

/**
 * Read the sync-job file. Returns `null` when absent/unparseable. A RUNNING phase whose pid is
 * dead is re-reported as `phase:'failed'` with resume advice (the process died before it could
 * write a terminal phase — the file would otherwise report 'running' forever).
 *
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {string} planId
 * @returns {object|null}
 */
export function readSyncJobStatus(sourceBaseId, destBaseId, planId) {
  const p = syncJobPath(sourceBaseId, destBaseId, planId);
  if (!existsSync(p)) return null;
  let job = null;
  try { job = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  if (job && RUNNING_PHASES.has(job.phase) && job.pid != null && !pidAlive(job.pid)) {
    const resumeMode = job.phase === 'planning' ? 'plan' : 'apply';
    return {
      ...job,
      phase: 'failed',
      error: `sync job process (pid ${job.pid}) died mid-${job.phase} — re-run mode=${resumeMode} to resume ` +
        `(schema idmap + records journal persist per chunk, so completed work is not repeated)`,
    };
  }
  return job;
}
