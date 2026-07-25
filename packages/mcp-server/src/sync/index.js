import { createHash } from 'node:crypto';
import { snapshotBase, snapshotSchemaOnly } from './snapshot.js';
import { matchByName, saveIdmap, savePlan, saveState, loadPlan, loadIdmap, saveDiff, loadDiff, latestDiffId } from './idmap.js';
import { computePlan } from './diff.js';
import { compare } from './compare.js';
import { renderPlan, renderApplyResult, renderDiff } from './report.js';
import { applyPlan } from './apply.js';
import { newJournal, loadJournal, saveJournal } from './journal.js';
import { applyRecords as applyRecordsImpl, reconcile as reconcileImpl, writeRecordsJobStatus, readRecordsJobStatus } from './records.js';
import { validateFieldMappings } from './policy.js';
import { pruneSchema } from './prune-schema.js';
import { acquireApplyLock } from './apply-lock.js';
import { writeSyncJobStatus, readSyncJobStatus } from './job-status.js';

const ENGINE_VERSION = '2b';

/**
 * Produce a deterministic SHA-256 fingerprint of a schema snapshot.
 * Order-independent: tables, fields, and views are all sorted before hashing — field/view/
 * column order is explicitly a "best-effort" (non-drift) concern elsewhere in the sync engine
 * (see compare.js), and Airtable's field-listing order is not guaranteed stable between two
 * reads of an otherwise-unchanged schema. Sorting the composed `id=name=type` strings is
 * equivalent to sorting by `id` (a unique, stable-per-field identifier that always appears
 * first in the string, before any content that legitimately changes the fingerprint like a
 * rename or retype) while keeping the same shape as the views line below.
 *
 * @param {{ tables: Array<{id:string, name:string, fields:Array<{id:string,name:string,type:string}>}> }} snap
 * @returns {string}  hex digest
 */
export function fingerprintSchema(snap) {
  const basis = snap.tables
    .map((t) => `${t.id}:${t.name}:` + t.fields.map((f) => `${f.id}=${f.name}=${f.type}`).sort().join(',')
      + ';V:' + (t.views || []).map((v) => `${v.id}=${v.name}=${v.type}`).sort().join(','))
    .sort()
    .join('|');
  return createHash('sha256').update(basis).digest('hex');
}

/**
 * Compute a schema plan. `planId` is supplied by the caller (tool handler) so
 * the engine stays deterministic/testable.
 *
 * `direction` controls which base is treated as the source of truth:
 * - `'to-dest'` (default) — changeset targets the DEST base (dest is brought up to date with src).
 * - `'to-source'` — swap src/dest before snapshotting so the changeset targets the SOURCE base
 *   (source is brought up to date with dest). Persisted state uses swapped IDs so load/apply
 *   work correctly on the swapped pair.
 *
 * @param {{ client: object, sourceBaseId: string, destBaseId: string, planId: string, direction?: 'to-dest'|'to-source', fieldMappings?: object }} opts
 * @returns {Promise<{ human: string, machine: object }>}
 */
export async function plan({ client, sourceBaseId, destBaseId, planId, direction = 'to-dest', fieldMappings }) {
  // When direction='to-source', swap so the changeset targets the original SOURCE base.
  const effectiveSrcId = direction === 'to-source' ? destBaseId : sourceBaseId;
  const effectiveDestId = direction === 'to-source' ? sourceBaseId : destBaseId;

  const src = await snapshotBase(client, effectiveSrcId);
  const dest = await snapshotBase(client, effectiveDestId);
  const idmap = matchByName(src, dest);
  // matchByName returns only schema-level maps (tables/fields/views). The persisted
  // records/attachments maps are the rec→rec identity built by prior record syncs and MUST
  // be preserved VERBATIM: (a) saveIdmap below is a full-file replace, so without this merge
  // every re-plan wiped them and the next apply re-created (duplicated) every record;
  // (b) computePlan's view compare needs idmap.records to remap record-referencing filter
  // values, otherwise a correctly-synced record filter re-flags as drift on every plan.
  const persisted = loadIdmap(effectiveSrcId, effectiveDestId);
  idmap.records = { ...(persisted.records || {}) };
  idmap.attachments = { ...(persisted.attachments || {}) };
  const base = computePlan(src, dest, idmap);
  const fullPlan = {
    planId,
    engineVersion: ENGINE_VERSION,
    destFingerprint: fingerprintSchema(dest),
    ...base,
  };
  saveIdmap(effectiveSrcId, effectiveDestId, idmap);
  savePlan(effectiveSrcId, effectiveDestId, fullPlan);
  saveState(effectiveSrcId, effectiveDestId, {
    sourceBaseId: effectiveSrcId,
    destBaseId: effectiveDestId,
    engineVersion: ENGINE_VERSION,
    lastPlanId: planId,
  });
  const rendered = renderPlan(fullPlan);
  // Dry-run field-mapping validation: attach errors to machine output (no mutation).
  if (fieldMappings) {
    const { errors } = validateFieldMappings(src, dest, fieldMappings);
    rendered.machine = { ...rendered.machine, fieldMappingErrors: errors };
  }
  return rendered;
}

/**
 * Compute a schema diff between two bases. `diffId` is supplied by the caller so the engine
 * stays deterministic/testable. Saves the full diff to disk and returns a rendered digest.
 *
 * @param {{ client: object, sourceBaseId: string, destBaseId: string, diffId: string, fieldMappings?: object }} opts
 * @returns {Promise<{ human: string, machine: object }>}
 */
export async function diff({ client, sourceBaseId, destBaseId, diffId, fieldMappings }) {
  const src = await snapshotBase(client, sourceBaseId);
  const dest = await snapshotBase(client, destBaseId);
  const idmap = matchByName(src, dest);
  // Merge the persisted records map so compare's view canonicalization remaps
  // record-referencing filter values instead of stripping them — otherwise a filter a prior
  // sync correctly restored on the dest re-flags as `filters` drift forever (see plan()).
  const persisted = loadIdmap(sourceBaseId, destBaseId);
  idmap.records = { ...(persisted.records || {}) };
  const base = compare(src, dest, idmap);
  const fullDiff = { diffId, ...base };
  saveDiff(sourceBaseId, destBaseId, fullDiff);
  const rendered = renderDiff(fullDiff);
  // Dry-run field-mapping validation: attach errors to machine output (no mutation).
  if (fieldMappings) {
    const { errors } = validateFieldMappings(src, dest, fieldMappings);
    rendered.machine = { ...rendered.machine, fieldMappingErrors: errors };
  }
  return rendered;
}

/**
 * Load a previously saved schema diff and return a detail view (or digest if no detail given).
 * If `diffId` is falsy, resolves to the most recently written diff via `latestDiffId`.
 *
 * @param {{ sourceBaseId: string, destBaseId: string, diffId?: string, detail?: string, offset?: number, limit?: number }} opts
 * @returns {{ human: string, machine: object }}
 */
export function diffDetail({ sourceBaseId, destBaseId, diffId, detail, offset, limit }) {
  const resolvedDiffId = diffId || latestDiffId(sourceBaseId, destBaseId);
  if (!resolvedDiffId) {
    return { human: 'no diff found', machine: { error: 'no diff found — run mode=diff first' } };
  }
  const savedDiff = loadDiff(sourceBaseId, destBaseId, resolvedDiffId);
  if (!savedDiff) {
    return { human: 'no diff found', machine: { error: 'no diff found — run mode=diff first' } };
  }
  return renderDiff(savedDiff, { detail, offset, limit });
}

/**
 * Execute a saved plan (schema phase) then launch the background records job.
 *
 * THROWS (does not return an abort object) for pre-flight failures: a missing saved plan, and
 * `FIELD_MAP_INVALID` when fieldMappings validation fails (err.code='FIELD_MAP_INVALID',
 * err.mappingErrors=[...]). This is intentional and pinned by tests — direct callers must catch it.
 * applyJob() (the background wrapper the sync_base tool uses) catches these and surfaces them via
 * mode=status as phase='failed'. A DRIFT mismatch is NOT thrown: it returns a renderApplyResult
 * with aborted:true, reason:'DRIFT'.
 *
 * @param {object} opts
 * @param {(event:'records-start'|'records-done'|'records-failed', payload:object)=>void} [opts.onPhase]
 *   Optional phase-timeline callback. Wired by applyJob() so the unified sync-job file tracks the
 *   schema→records→done/failed transitions. Kept optional so direct apply() callers (tests, the
 *   engine) are unaffected. `records-start` fires once the schema phase is committed and the
 *   background records job is launched (payload: `{ schemaResult }`); `records-done` /
 *   `records-failed` fire from the records job's own completion path (payload: `{ recordsResult }`
 *   / `{ error }`).
 */
export async function apply({ client, sourceBaseId, destBaseId, planId, runStartedAt, skip = [], policy, policyOverrides, confirmDeletions, confirmTableDeletions, confirmRetypes, fieldMappings, naturalKeys, onPhase }) {
  const fullPlan = loadPlan(sourceBaseId, destBaseId, planId);
  if (!fullPlan) throw new Error(`No saved plan "${planId}" for ${sourceBaseId} -> ${destBaseId}. Run mode=plan first.`);

  // Concurrency guard: two applies on the same pair would run concurrent background records
  // jobs (record duplication + idmap.json last-writer-wins clobber). Throws APPLY_LOCKED when
  // a live holder exists; stale locks (dead pid) are replaced. NOTE: the background records
  // job outlives this function — on the success path the lock is released in the job's
  // completion path (the .finally below), not when apply() returns.
  const releaseLock = acquireApplyLock(sourceBaseId, destBaseId, planId);
  let lockHeldByRecordsJob = false;
  try {
    // Schema-only: fingerprintSchema + buildIndex use table/field/view METADATA only, not per-view
    // live config — so skip the getView/readData storm (one ~1s read per view) on the dest here.
    const destSnapshot = await snapshotSchemaOnly(client, destBaseId);
    const journal = loadJournal(sourceBaseId, destBaseId, planId) ?? newJournal(planId, runStartedAt);
    // Resume path: a journal with done actions proves a prior partial run of THIS plan already
    // mutated the dest, so the fingerprint divergence is (at least partly) our own doing —
    // without this bypass the drift guard made journal resume/retry unreachable, forcing a full
    // re-plan after every partial failure. Warn instead of aborting.
    const resuming = journal.actions.some((a) => a.status === 'done');
    let resumeDriftBypass = false;
    if (fingerprintSchema(destSnapshot) !== fullPlan.destFingerprint) {
      if (!resuming) {
        return renderApplyResult({ planId, aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: `Destination changed since plan ${planId}. Re-run mode=plan.` }] });
      }
      resumeDriftBypass = true;
    }

    // Pre-flight: validate fieldMappings synchronously before launching the background job.
    // This makes the FIELD_MAP_INVALID catch in the tool handler reachable (the background job
    // re-validates as a safety net, but by then the caller has already returned).
    if (fieldMappings && Object.keys(fieldMappings).length > 0) {
      const srcSnapshot = await snapshotSchemaOnly(client, sourceBaseId);
      const { errors } = validateFieldMappings(srcSnapshot, destSnapshot, fieldMappings);
      if (errors.length > 0) {
        const err = new Error('Field mapping validation failed');
        err.code = 'FIELD_MAP_INVALID';
        err.mappingErrors = errors;
        throw err;
      }
    }

    // C1: preserve the persisted records/attachments identity map across applies (see buildRunIdmap).
    const idmap = buildRunIdmap(sourceBaseId, destBaseId, fullPlan, journal);

    const result = await applyPlan({
      client, plan: fullPlan, destAppId: destBaseId, destSnapshot, idmap, journal,
      persist: (m, j) => { saveIdmap(sourceBaseId, destBaseId, m); saveJournal(sourceBaseId, destBaseId, j); },
      skip, confirmRetypes,
    });
    if (resumeDriftBypass) {
      result.warnings.unshift({
        code: 'RESUME_DRIFT_BYPASS',
        message: `Destination fingerprint differs from plan ${planId}, but its journal shows prior progress — resumed non-done actions instead of aborting. If the dest was ALSO changed by someone else since the plan, re-run mode=plan to pick those changes up.`,
      });
    }

    // Schema extras phase: delete dest-only fields/views/tables under mirror, gated. Runs after
    // applyPlan so matched fields/views exist (orphan deps safe) and BEFORE the records job so
    // the schema is clean before record sync begins. Mutates `result` in-place.
    if (!result.aborted) {
      await pruneSchema({ client, destAppId: destBaseId, plan: fullPlan, policy, policyOverrides, confirmDeletions, confirmTableDeletions, result });

      // Records phase: runs after schema apply, only if not aborted. It is minutes-long for large
      // bases, so we launch it in the BACKGROUND (fire-and-forget) and return immediately — a single
      // blocking apply call would look hung / time out. The phase persists progress (idmap + records
      // journal) and writes a status file; poll via `sync_base mode=status`.
      writeRecordsJobStatus(sourceBaseId, destBaseId, planId, { status: 'running', startedAt: runStartedAt });
      lockHeldByRecordsJob = true; // the job's .finally below owns the release from here on
      result.records = { status: 'running', jobId: planId };
      // Unified sync-job timeline: schema phase committed, records phase now running. Fires
      // BEFORE the return so applyJob's own resolution handler already sees phase='records'.
      if (onPhase) onPhase('records-start', { schemaResult: renderApplyResult(result).machine });
      applyRecordsImpl({ client, sourceBaseId, destBaseId, planId, runStartedAt, policy, policyOverrides, confirmDeletions, fieldMappings, naturalKeys })
        .then((r) => {
          // A records run that ABORTED on a mid-run session death resolves normally (r.aborted=true)
          // but must surface as phase=failed — NOT a lying `done` over 1000s of swallowed
          // SESSION_INVALID per-record failures. recordsTerminalStatus makes that decision (and keeps
          // the partial counts either way). See records.js sessionDied/markAborted.
          const t = recordsTerminalStatus(r);
          writeRecordsJobStatus(sourceBaseId, destBaseId, planId, {
            status: t.status, startedAt: runStartedAt, finishedAt: new Date().toISOString(),
            ...(t.error ? { error: t.error } : {}), result: t.recordsResult,
          });
          if (onPhase) {
            onPhase(t.event, t.event === 'records-failed'
              ? { error: t.error, recordsResult: t.recordsResult }
              : { recordsResult: t.recordsResult });
          }
        })
        .catch((err) => {
          const error = String(err && err.message ? err.message : err);
          writeRecordsJobStatus(sourceBaseId, destBaseId, planId, {
            status: 'failed', startedAt: runStartedAt, finishedAt: new Date().toISOString(), error,
          });
          if (onPhase) onPhase('records-failed', { error });
        })
        .finally(releaseLock);
    }

    saveState(sourceBaseId, destBaseId, { sourceBaseId, destBaseId, engineVersion: ENGINE_VERSION, lastPlanId: planId, lastApplyAt: runStartedAt });
    return renderApplyResult(result);
  } finally {
    // Synchronous exits (DRIFT abort, FIELD_MAP_INVALID, applyPlan throw) never launched the
    // records job — release here. When the job launched, it owns the release.
    if (!lockHeldByRecordsJob) releaseLock();
  }
}

/**
 * Launch plan() as a BACKGROUND job and return immediately.
 *
 * plan() snapshots BOTH bases (one ~1s getView/readData per view — minutes on a view-heavy base),
 * which blows past the MCP client's response window and surfaces as `Connection closed` even though
 * the plan is computed + persisted. So the tool handler calls this instead of awaiting plan():
 * it writes `sync-job-<planId>.json` phase='planning' (with our pid), fires plan() fire-and-forget,
 * and returns synchronously. On resolve → phase='done' + the rendered digest; on reject → phase='failed'.
 * plan() itself is unchanged (the engine/tests call it directly).
 *
 * @param {{ client: object, sourceBaseId: string, destBaseId: string, planId: string, direction?: string, fieldMappings?: object }} opts
 * @returns {{ jobId: string, status: 'running' }}
 */
// The plan's machine output embeds the full idmap (tables/fields/views/choices) — multiple MB on a
// large base (observed 2.7MB of a 5.4MB sync-job file). The sync-job status file is rewritten on
// every phase transition + read on every mode=status poll, so storing the full digest is wasteful.
// Strip the idmap for the STATUS digest — it is persisted verbatim in idmap.json and plan-<id>.json
// for anyone who needs the full mapping. Keeps verdict/counts/sample/orphans/warnings.
function compactPlanDigest(machine) {
  if (!machine || typeof machine !== 'object') return machine;
  const { idmap, ...rest } = machine;
  return idmap ? { ...rest, idmapOmitted: true } : rest;
}

export function planJob({ client, sourceBaseId, destBaseId, planId, direction, fieldMappings }) {
  const startedAt = new Date().toISOString();
  writeSyncJobStatus(sourceBaseId, destBaseId, planId, { phase: 'planning', startedAt });
  // Defer to a microtask so a synchronous throw inside plan() still becomes a phase='failed'
  // write rather than propagating out of planJob (which must return synchronously).
  Promise.resolve()
    .then(() => plan({ client, sourceBaseId, destBaseId, planId, direction, fieldMappings }))
    .then((rendered) => {
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, {
        phase: 'done',
        planDigest: { human: rendered.human, machine: compactPlanDigest(rendered.machine) },
        finishedAt: new Date().toISOString(),
      });
    })
    .catch((e) => {
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, {
        phase: 'failed',
        error: String(e && e.message ? e.message : e),
        finishedAt: new Date().toISOString(),
      });
    });
  return { jobId: planId, status: 'running' };
}

/**
 * Launch apply() as a BACKGROUND job and return immediately.
 *
 * apply() runs the whole schema phase synchronously (snapshotSchemaOnly + applyPlan + pruneSchema)
 * before it backgrounds the records phase — long enough on a real base to trip the MCP response
 * window. applyJob threads an `onPhase` callback into apply() so the unified sync-job file reflects
 * the full timeline: phase='schema' (here) → phase='records' (records-start) → phase='done'
 * (records-done) / phase='failed' (records-failed). A clean DRIFT abort (apply resolves with an
 * aborted result and never launches records) is terminal-'done' carrying the aborted schemaResult;
 * a synchronous apply() throw (no saved plan, FIELD_MAP_INVALID, applyPlan throw, APPLY_LOCKED) is
 * terminal-'failed'. The apply-lock is still acquired inside apply() (semantics unchanged).
 *
 * @param {object} opts — every apply() param (client, sourceBaseId, destBaseId, planId, runStartedAt, skip, policy, policyOverrides, confirmDeletions, confirmTableDeletions, confirmRetypes, fieldMappings, naturalKeys)
 * @returns {{ jobId: string, status: 'running' }}
 */
export function applyJob({ client, sourceBaseId, destBaseId, planId, runStartedAt, skip = [], policy, policyOverrides, confirmDeletions, confirmTableDeletions, confirmRetypes, fieldMappings, naturalKeys }) {
  const startedAt = runStartedAt || new Date().toISOString();
  // Don't clobber a job already running for this planId. readSyncJobStatus downgrades a
  // running-phase-with-dead-pid to 'failed', so a live 'planning'/'schema'/'records' phase here means a
  // genuine in-flight job — re-report it as running instead of overwriting its status file and then
  // failing its own apply() with APPLY_LOCKED (which would misreport the live job as failed and leave
  // a contradictory 'done'+error terminal record). A prior 'failed'/'done' file falls through to resume.
  const existingJob = readSyncJobStatus(sourceBaseId, destBaseId, planId);
  if (existingJob && (existingJob.phase === 'planning' || existingJob.phase === 'schema' || existingJob.phase === 'records')) {
    return { jobId: planId, status: 'running' };
  }
  writeSyncJobStatus(sourceBaseId, destBaseId, planId, { phase: 'schema', startedAt });

  const onPhase = (event, payload = {}) => {
    if (event === 'records-start') {
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, { phase: 'records', schemaResult: payload.schemaResult });
    } else if (event === 'records-done') {
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, { phase: 'done', recordsResult: payload.recordsResult, finishedAt: new Date().toISOString() });
    } else if (event === 'records-failed') {
      // Include the partial recordsResult (present on a mid-run session abort) so mode=status shows
      // what landed before the failure — not just the error string.
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, {
        phase: 'failed', error: payload.error,
        ...(payload.recordsResult !== undefined ? { recordsResult: payload.recordsResult } : {}),
        finishedAt: new Date().toISOString(),
      });
    }
  };

  Promise.resolve()
    .then(() => apply({ client, sourceBaseId, destBaseId, planId, runStartedAt: startedAt, skip, policy, policyOverrides, confirmDeletions, confirmTableDeletions, confirmRetypes, fieldMappings, naturalKeys, onPhase }))
    .then((rendered) => {
      const m = (rendered && rendered.machine) || {};
      // When the records phase launched, its own onPhase callbacks (records-done/records-failed)
      // own the terminal write — don't clobber it. m.records.status is a STATIC 'running' snapshot
      // set at apply() return time (records writes to the status FILE, never mutating this object),
      // so this check normally suffices. As belt-and-suspenders (and to satisfy a review concern),
      // ALSO re-read the file's phase: only finalize here if it's still 'schema' — i.e. the records
      // phase never started (clean DRIFT abort / no-records path). Any non-'schema' phase means
      // records or a terminal write already owns the file.
      if (m.records && m.records.status === 'running') return;
      const current = readSyncJobStatus(sourceBaseId, destBaseId, planId);
      if (current && current.phase !== 'schema') return;
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, { phase: 'done', schemaResult: m, finishedAt: new Date().toISOString() });
    })
    .catch((e) => {
      const error = e && e.code === 'FIELD_MAP_INVALID'
        ? `Field mapping validation failed: ${(e.mappingErrors || []).map((me) => `[${me.code}] table=${me.table || '?'}${me.source ? ' source=' + me.source : ''}${me.target ? ' target=' + me.target : ''}`).join('; ')}`
        : String(e && e.message ? e.message : e);
      writeSyncJobStatus(sourceBaseId, destBaseId, planId, {
        phase: 'failed', error, ...(e && e.code ? { errorCode: e.code } : {}), finishedAt: new Date().toISOString(),
      });
    });

  return { jobId: planId, status: 'running' };
}

// The saved planDigest.machine (already idmap-stripped by compactPlanDigest) can still run to
// tens of thousands of lines on a view-heavy base — big enough to push summary/schemaResult/
// recordsResult past the MCP response's truncation window. mode=status is polled far more often
// than anyone actually needs the raw machine payload (which stays on disk in plan-<planId>.json
// verbatim), so project it down to the human summary by default; verbose:true opts back into the
// full machine. This only affects the RESPONSE shape — the job FILE on disk is never touched here.
function projectPlanDigestForResponse(planDigest, verbose) {
  if (planDigest === undefined || planDigest === null) return planDigest;
  if (verbose) return planDigest;
  return { human: planDigest.human, machineOmitted: true };
}

/**
 * Poll a background plan/apply job by planId. Reads the unified sync-job file (+ pid-liveness) and
 * derives live progress (records mapped so far) from idmap.records. Falls back to the records-job
 * file when no unified sync-job file exists (e.g. an apply that ran before this file existed).
 * Supersedes recordsStatus() for the tool handler; recordsStatus() is kept for existing callers.
 *
 * By default the returned planDigest is projected to `{ human, machineOmitted: true }` — the full
 * `machine` payload (which can be tens of thousands of lines on a view-heavy base) is omitted from
 * the RESPONSE only; it remains persisted verbatim on disk (plan-<planId>.json). Pass verbose:true
 * to get the full planDigest (including machine) back in the response.
 *
 * @param {{ sourceBaseId: string, destBaseId: string, planId: string, verbose?: boolean }} opts
 * @returns {{ planId:string, phase:string, status:'running'|'done'|'failed'|'unknown', recordsMapped:number, planDigest?:object, schemaResult?:object, recordsResult?:object, startedAt?:string, finishedAt?:string, error?:string, message?:string }}
 */
export function syncStatus({ sourceBaseId, destBaseId, planId, verbose = false }) {
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  const recordsMapped = Object.keys((idmap && idmap.records) || {}).length;

  const job = readSyncJobStatus(sourceBaseId, destBaseId, planId);
  if (!job) {
    // Fallback: a records job written directly by apply() before the unified sync-job existed.
    const rj = readRecordsJobStatus(sourceBaseId, destBaseId, planId);
    if (rj) {
      const phase = rj.status === 'running' ? 'records' : rj.status; // 'done' | 'failed' | 'records'
      return {
        planId, phase, status: rj.status, recordsMapped,
        ...(rj.result !== undefined ? { recordsResult: rj.result } : {}),
        ...(rj.startedAt !== undefined ? { startedAt: rj.startedAt } : {}),
        ...(rj.finishedAt !== undefined ? { finishedAt: rj.finishedAt } : {}),
        ...(rj.error !== undefined ? { error: rj.error } : {}),
      };
    }
    return { planId, phase: 'unknown', status: 'unknown', recordsMapped, message: 'No sync job found for this planId (run mode=plan or mode=apply first).' };
  }

  const status = job.phase === 'done' ? 'done' : job.phase === 'failed' ? 'failed' : 'running';
  return {
    planId,
    phase: job.phase,
    status,
    recordsMapped,
    ...(job.planDigest !== undefined ? { planDigest: projectPlanDigestForResponse(job.planDigest, verbose) } : {}),
    ...(job.schemaResult !== undefined ? { schemaResult: job.schemaResult } : {}),
    ...(job.recordsResult !== undefined ? { recordsResult: job.recordsResult } : {}),
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
  };
}

/**
 * Decide the terminal status of a finished records run (pure — no I/O, unit-testable).
 *
 * A records run that hit a mid-run session death resolves normally with `r.aborted === true`
 * (records.js sets it via markAborted). That must become a records-job phase=failed — NOT a
 * `done` that hides thousands of swallowed SESSION_INVALID failures — while still carrying the
 * partial counts so the user sees what landed before the abort. A non-aborted run stays `done`.
 *
 * @param {object} r - records result accumulator ({ aborted?, abortReason?, created, updated, failed, ... })
 * @returns {{ status:'done'|'failed', event:'records-done'|'records-failed', error?:string, recordsResult:object }}
 */
export function recordsTerminalStatus(r) {
  const recordsResult = {
    created: r.created, updated: r.updated, failed: r.failed,
    matched: r.matched || 0,
    attachmentsUploaded: r.attachmentsUploaded || 0, viewFiltersReapplied: r.viewFiltersReapplied || 0,
    deleted: r.deleted || 0,
    warningCount: (r.warnings || []).length,
    warnings: r.warnings || [],
  };
  if (r.aborted) {
    const error = r.abortReason
      || 'SESSION_INVALID: record sync aborted — the auth session died mid-run. Re-authenticate, then re-run mode=apply with the same planId to resume (progress is persisted).';
    return { status: 'failed', event: 'records-failed', error, recordsResult };
  }
  return { status: 'done', event: 'records-done', recordsResult };
}

/**
 * @deprecated Use `syncStatus()` instead — it reports the full plan→schema→records phase timeline
 * and already falls back to the legacy `records-job-<planId>.json` file this reads. Retained only
 * for existing direct callers/tests; new code should not use it.
 *
 * Poll the background records job started by apply(). Reads the persisted status file and
 * derives live progress (records mapped so far) from idmap.records.
 * @returns {{ planId:string, status:string, recordsMapped:number, startedAt?:string, finishedAt?:string, result?:object, error?:string, message?:string }}
 */
export function recordsStatus({ sourceBaseId, destBaseId, planId }) {
  const job = readRecordsJobStatus(sourceBaseId, destBaseId, planId)
    || { planId, status: 'unknown', message: 'No records job found for this planId (run mode=apply first).' };
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  return { ...job, recordsMapped: Object.keys((idmap && idmap.records) || {}).length };
}

/**
 * Reconcile mode: prune stale idmap.records entries after manual deletions in dest.
 * Delegates to records.js reconcile().
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance
 * @param {string} opts.sourceBaseId
 * @param {string} opts.destBaseId
 * @param {object} [opts.naturalKeys]   - { [tableName]: fieldName } — matches dest↔source
 *   records by the key field's value; add-only, ambiguity-safe (never overwrites an
 *   existing mapping or claims an already-mapped dest row)
 * @returns {Promise<object>}           - { created, updated, skipped, failed, warnings, idmap }
 */
export async function reconcile({ client, sourceBaseId, destBaseId, naturalKeys = {} }) {
  return reconcileImpl({ client, sourceBaseId, destBaseId, naturalKeys });
}

// On resume, merge the persisted (grown) idmap over the plan's base matches so this-run
// creations from a prior crashed run survive. Persisted wins on key conflict (has grown).
export function mergeIdmapsForTest(sourceBaseId, destBaseId, fullPlan) {
  const m = loadIdmap(sourceBaseId, destBaseId);
  return {
    tables: { ...fullPlan.idmap.tables, ...m.tables },
    fields: { ...fullPlan.idmap.fields, ...m.fields },
    records: { ...(fullPlan.idmap.records || {}), ...(m.records || {}) },
    attachments: { ...(fullPlan.idmap.attachments || {}), ...(m.attachments || {}) },
    views: { ...(fullPlan.idmap.views || {}), ...(m.views || {}) },
  };
}

function mergeIdmaps(sourceBaseId, destBaseId, fullPlan) {
  return mergeIdmapsForTest(sourceBaseId, destBaseId, fullPlan);
}

// Build the idmap for an apply run.
// CRITICAL (C1 — record-duplication guard): the persisted records/attachments maps are the rec->rec
// identity and MUST survive across applies. A fresh plan's idmap has NO records, so on the fresh path
// we seed records/attachments from the ON-DISK idmap. Without this, the schema phase persists an empty
// records map and the records phase re-creates every record (duplicates) on every re-apply with a new
// planId. The resume path (journal has actions) goes through mergeIdmaps, which already preserves them.
export function buildRunIdmap(sourceBaseId, destBaseId, fullPlan, journal) {
  if (journal.actions.length > 0) return mergeIdmaps(sourceBaseId, destBaseId, fullPlan);
  const persisted = loadIdmap(sourceBaseId, destBaseId);
  const idmap = JSON.parse(JSON.stringify(fullPlan.idmap));
  idmap.records = { ...(persisted.records || {}) };
  idmap.attachments = { ...(persisted.attachments || {}) };
  idmap.views ??= {};
  return idmap;
}
