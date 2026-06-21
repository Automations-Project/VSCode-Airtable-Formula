import { createHash } from 'node:crypto';
import { snapshotBase, snapshotSchemaOnly } from './snapshot.js';
import { matchByName, saveIdmap, savePlan, saveState, loadPlan, loadIdmap, saveDiff, loadDiff, latestDiffId } from './idmap.js';
import { computePlan } from './diff.js';
import { compare } from './compare.js';
import { renderPlan, renderApplyResult, renderDiff } from './report.js';
import { applyPlan } from './apply.js';
import { newJournal, loadJournal, saveJournal } from './journal.js';
import { applyRecords as applyRecordsImpl, reconcile as reconcileImpl, writeRecordsJobStatus, readRecordsJobStatus } from './records.js';
import { validateFieldMappings, isDeleting } from './policy.js';
import { pruneSchema } from './prune-schema.js';

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

export async function apply({ client, sourceBaseId, destBaseId, planId, runStartedAt, skip = [], policy, policyOverrides, confirmDeletions, confirmTableDeletions, confirmRetypes, fieldMappings, naturalKeys }) {
  const fullPlan = loadPlan(sourceBaseId, destBaseId, planId);
  if (!fullPlan) throw new Error(`No saved plan "${planId}" for ${sourceBaseId} -> ${destBaseId}. Run mode=plan first.`);

  // Schema-only: fingerprintSchema + buildIndex use table/field/view METADATA only, not per-view
  // live config — so skip the getView/readData storm (one ~1s read per view) on the dest here.
  const destSnapshot = await snapshotSchemaOnly(client, destBaseId);
  if (fingerprintSchema(destSnapshot) !== fullPlan.destFingerprint) {
    return renderApplyResult({ planId, aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: `Destination changed since plan ${planId}. Re-run mode=plan.` }] });
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

  const journal = loadJournal(sourceBaseId, destBaseId, planId) ?? newJournal(planId, runStartedAt);
  // C1: preserve the persisted records/attachments identity map across applies (see buildRunIdmap).
  const idmap = buildRunIdmap(sourceBaseId, destBaseId, fullPlan, journal);

  const result = await applyPlan({
    client, plan: fullPlan, destAppId: destBaseId, destSnapshot, idmap, journal,
    persist: (m, j) => { saveIdmap(sourceBaseId, destBaseId, m); saveJournal(sourceBaseId, destBaseId, j); },
    skip, confirmRetypes,
  });

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
    applyRecordsImpl({ client, sourceBaseId, destBaseId, planId, runStartedAt, policy, policyOverrides, confirmDeletions, fieldMappings, naturalKeys })
      .then((r) => writeRecordsJobStatus(sourceBaseId, destBaseId, planId, {
        status: 'done', startedAt: runStartedAt, finishedAt: new Date().toISOString(),
        result: {
          created: r.created, updated: r.updated, failed: r.failed,
          matched: r.matched || 0,
          attachmentsUploaded: r.attachmentsUploaded || 0, viewFiltersReapplied: r.viewFiltersReapplied || 0,
          deleted: r.deleted || 0,
          warningCount: (r.warnings || []).length,
          warnings: r.warnings || [],
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
