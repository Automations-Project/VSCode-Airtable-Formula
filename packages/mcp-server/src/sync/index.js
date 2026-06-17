import { createHash } from 'node:crypto';
import { snapshotBase, snapshotSchemaOnly } from './snapshot.js';
import { matchByName, saveIdmap, savePlan, saveState, loadPlan, loadIdmap } from './idmap.js';
import { computePlan } from './diff.js';
import { renderPlan, renderApplyResult } from './report.js';
import { applyPlan } from './apply.js';
import { newJournal, loadJournal, saveJournal } from './journal.js';
import { applyRecords as applyRecordsImpl, reconcile as reconcileImpl, writeRecordsJobStatus, readRecordsJobStatus } from './records.js';

const ENGINE_VERSION = '2b';

/**
 * Produce a deterministic SHA-256 fingerprint of a schema snapshot.
 * Order-independent: tables are sorted before hashing.
 *
 * @param {{ tables: Array<{id:string, name:string, fields:Array<{id:string,name:string,type:string}>}> }} snap
 * @returns {string}  hex digest
 */
export function fingerprintSchema(snap) {
  const basis = snap.tables
    .map((t) => `${t.id}:${t.name}:` + t.fields.map((f) => `${f.id}=${f.name}=${f.type}`).join(',')
      + ';V:' + (t.views || []).map((v) => `${v.id}=${v.name}=${v.type}`).sort().join(','))
    .sort()
    .join('|');
  return createHash('sha256').update(basis).digest('hex');
}

/**
 * Compute a schema plan. `planId` is supplied by the caller (tool handler) so
 * the engine stays deterministic/testable.
 *
 * @param {{ client: object, sourceBaseId: string, destBaseId: string, planId: string }} opts
 * @returns {Promise<{ human: string, machine: object }>}
 */
export async function plan({ client, sourceBaseId, destBaseId, planId }) {
  const src = await snapshotBase(client, sourceBaseId);
  const dest = await snapshotBase(client, destBaseId);
  const idmap = matchByName(src, dest);
  const base = computePlan(src, dest, idmap);
  const fullPlan = {
    planId,
    engineVersion: ENGINE_VERSION,
    destFingerprint: fingerprintSchema(dest),
    ...base,
  };
  saveIdmap(sourceBaseId, destBaseId, idmap);
  savePlan(sourceBaseId, destBaseId, fullPlan);
  saveState(sourceBaseId, destBaseId, {
    sourceBaseId,
    destBaseId,
    engineVersion: ENGINE_VERSION,
    lastPlanId: planId,
  });
  return renderPlan(fullPlan);
}

export async function apply({ client, sourceBaseId, destBaseId, planId, runStartedAt }) {
  const fullPlan = loadPlan(sourceBaseId, destBaseId, planId);
  if (!fullPlan) throw new Error(`No saved plan "${planId}" for ${sourceBaseId} -> ${destBaseId}. Run mode=plan first.`);

  // Schema-only: fingerprintSchema + buildIndex use table/field/view METADATA only, not per-view
  // live config — so skip the getView/readData storm (one ~1s read per view) on the dest here.
  const destSnapshot = await snapshotSchemaOnly(client, destBaseId);
  if (fingerprintSchema(destSnapshot) !== fullPlan.destFingerprint) {
    return renderApplyResult({ planId, aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: `Destination changed since plan ${planId}. Re-run mode=plan.` }] });
  }

  const journal = loadJournal(sourceBaseId, destBaseId, planId) ?? newJournal(planId, runStartedAt);
  let idmap;
  if (journal.actions.length > 0) {
    idmap = mergeIdmaps(sourceBaseId, destBaseId, fullPlan);
  } else {
    idmap = JSON.parse(JSON.stringify(fullPlan.idmap));
    idmap.records ??= {};
    idmap.views ??= {};
  }

  const result = await applyPlan({
    client, plan: fullPlan, destAppId: destBaseId, destSnapshot, idmap, journal,
    persist: (m, j) => { saveIdmap(sourceBaseId, destBaseId, m); saveJournal(sourceBaseId, destBaseId, j); },
  });

  // Records phase: runs after schema apply, only if not aborted. It is minutes-long for large
  // bases, so we launch it in the BACKGROUND (fire-and-forget) and return immediately — a single
  // blocking apply call would look hung / time out. The phase persists progress (idmap + records
  // journal) and writes a status file; poll via `sync_base mode=status`.
  if (!result.aborted) {
    writeRecordsJobStatus(sourceBaseId, destBaseId, planId, { status: 'running', startedAt: runStartedAt });
    applyRecordsImpl({ client, sourceBaseId, destBaseId, planId, runStartedAt })
      .then((r) => writeRecordsJobStatus(sourceBaseId, destBaseId, planId, {
        status: 'done', startedAt: runStartedAt, finishedAt: new Date().toISOString(),
        result: {
          created: r.created, updated: r.updated, failed: r.failed,
          attachmentsUploaded: r.attachmentsUploaded || 0, viewFiltersReapplied: r.viewFiltersReapplied || 0,
          warnings: (r.warnings || []).length,
        },
      }))
      .catch((err) => writeRecordsJobStatus(sourceBaseId, destBaseId, planId, {
        status: 'failed', startedAt: runStartedAt, finishedAt: new Date().toISOString(),
        error: String(err && err.message ? err.message : err),
      }));
    result.records = { status: 'running', jobId: planId };
  }

  saveState(sourceBaseId, destBaseId, { sourceBaseId, destBaseId, engineVersion: ENGINE_VERSION, lastPlanId: planId, lastApplyAt: runStartedAt });
  return renderApplyResult(result);
}

/**
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
 * @param {object} [opts.naturalKeys]   - { [tableName]: fieldName } for re-match (stub)
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
    records: { ...fullPlan.idmap.records, ...m.records },
    views: { ...fullPlan.idmap.views, ...m.views },
  };
}

function mergeIdmaps(sourceBaseId, destBaseId, fullPlan) {
  return mergeIdmapsForTest(sourceBaseId, destBaseId, fullPlan);
}
