/**
 * records.js — Pass 1/2: sync scalar + select/multiSelect cells + link cells.
 *              Pass 3 (applyAttachments): download source attachments → upload to dest.
 *
 * For each matched table (those with idmap.tables[srcTableId]):
 *   CREATE path — source record not yet in idmap.records → createRecords, fill idmap.records.
 *   UPDATE path — source record already mapped → updateRecords (primitive + single-select),
 *                 then setArrayChoiceCell for multiSelect / multiCollaborator diffs.
 *
 * All client calls go through `limiter.run(() => withRetry(() => ...))`.
 * Continue-on-failure: per-table errors are caught and pushed as warnings.
 * `persist(idmap, journal)` is called after each batch.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { coercePass1Cell, partitionLinkValue, linkRecId, coerceMappedValue, ARRAY_CELL_TYPES } from './cells.js';
import { resolvePolicy, validateFieldMappings } from './policy.js';
import { withRetry, createLimiter } from './ratelimit.js';
import { remapViewConfig, collectFilterRecordRefs } from './remap.js';
import { snapshotSchemaOnly, snapshotTableRecords, normalizeViewConfig, isComputedType } from './snapshot.js';
import { loadIdmap, saveIdmap, syncDir } from './idmap.js';
import { newJournal, loadRecordsJournal, saveRecordsJournal } from './journal.js';
import { acquireApplyLock } from './apply-lock.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

/**
 * Inject resolved field mappings for one record into a cells payload (mutates + returns it).
 *
 * For each mapping whose destType coercion returns write:true, sets cells[destFieldId] = value.
 * Skips mappings whose coerced result is write:false (e.g. object/array src values).
 *
 * @param {object} cells         - dest cellValuesByColumnId being built (mutated)
 * @param {Array}  tableMappings - resolved mappings filtered to the current table
 * @param {object} srcCells      - source record cellValuesByColumnId
 * @returns {object}             - same `cells` reference (mutated)
 */
function injectFieldMappings(cells, tableMappings, srcCells) {
  for (const m of tableMappings) {
    const r = coerceMappedValue(srcCells[m.srcFieldId], m.destType);
    if (r.write) cells[m.destFieldId] = r.value;
  }
  return cells;
}

// ── Records-job status file (records-job-<planId>.json) ──
// The records phase is minutes-long for large bases, so apply() launches it in the BACKGROUND
// and returns immediately. Status is persisted to disk (survives process restarts) and polled
// via sync_base mode=status. Progress (records mapped) is derived live from idmap.records.
function recordsJobPath(sourceBaseId, destBaseId, planId) {
  return join(syncDir(sourceBaseId, destBaseId), `records-job-${planId}.json`);
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export function writeRecordsJobStatus(sourceBaseId, destBaseId, planId, status) {
  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  // Stamp the writer's pid on 'running' so a reader can detect a job whose process died
  // mid-run — after a crash/restart the .then/.catch that would write done/failed never
  // fires, and the file would otherwise report 'running' forever.
  const body = { planId, ...(status.status === 'running' ? { pid: process.pid } : {}), ...status };
  safeAtomicWriteFileSync(recordsJobPath(sourceBaseId, destBaseId, planId), JSON.stringify(body, null, 2));
}
export function readRecordsJobStatus(sourceBaseId, destBaseId, planId) {
  const p = recordsJobPath(sourceBaseId, destBaseId, planId);
  if (!existsSync(p)) return null;
  let job = null;
  try { job = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  // Liveness: 'running' is only believable while the writing process is alive. A pid-less
  // (legacy) file cannot be verified and stays 'running'. Windows-safe: process.kill(pid, 0)
  // throws for a nonexistent pid on every platform.
  if (job && job.status === 'running' && job.pid != null && !pidAlive(job.pid)) {
    return {
      ...job,
      status: 'failed',
      error: `records job process (pid ${job.pid}) died mid-job — re-run mode=apply to resume (idmap + records journal persist per chunk, so completed work is not repeated)`,
    };
  }
  return job;
}

/**
 * Build a "gate" that wraps each INNER per-row/per-item POST of the records phase so it runs
 * through the phase-local rate limiter (≈5 req/s) with transient retry. Passed into
 * client.createRecords/updateRecords/addLinkItems via their `gate` option.
 *
 * Why a per-POST gate and not the shared auth queue's `_rateDelayMs`: the records phase runs as a
 * non-awaited BACKGROUND job, and the daemon serves every interactive tool call through the SAME
 * auth queue — delaying that queue would throttle all interactive traffic for the whole multi-minute
 * run. This limiter is created per records run, so only THIS phase's POSTs are paced; interactive
 * calls are untouched.
 *
 * @param {{run:(fn:()=>Promise<any>)=>Promise<any>}} limiter
 * @returns {(fn:()=>Promise<any>)=>Promise<any>}
 */
const makeGate = (limiter) => (fn) => limiter.run(() => withRetry(fn));

// ── Session-death detection (Task 2) ──────────────────────────────────────────
// The records phase runs 1000s of per-row writes. When the auth circuit-breaker latches
// (a browser-free re-auth kept failing, or a throttle 403 never cleared), EVERY subsequent
// per-row POST short-circuits to SESSION_INVALID — but the client SWALLOWS each into its
// failed[] array (it does not throw at the batch level), so the naive engine marches through
// all rows as per-record failures and then reports the job `done`. These helpers let each
// write pass detect a fatal, run-wide session death and abort the whole job instead.

/**
 * True when the session is dead run-wide: the breaker has latched (isSessionDead) OR a
 * SESSION_INVALID error propagated (covers the Task-1 Minor-4 case where a 403-escalation's
 * _recoverSession itself threw, so the breaker may not be latched yet).
 *
 * @param {object} client - AirtableClient (may lack .auth on older/mocked clients → guarded)
 * @param {*} [err]        - a caught error or a per-row error string to inspect
 * @returns {boolean}
 */
function sessionDied(client, err) {
  if (client?.auth?.isSessionDead?.() === true) return true;
  return !!err && /SESSION_INVALID/.test(String(err.message ? err.message : err));
}

/**
 * Build the abort reason: trip detail (when available) + partial counts + resume advice.
 * @param {object} client
 * @param {object} result - { created, updated }
 * @returns {string}
 */
function buildAbortReason(client, result) {
  const trip = client?.auth?.getLastTrip?.();
  // Surface Airtable's actual response body at the trip — its 4xx JSON states the REAL reason
  // (permission / CSRF / rate / forbidden action) that a bare "403" hides. Truncated + secrets-safe.
  const detail = trip
    ? ` (last status=${trip.status}${trip.body ? `; airtable said: ${trip.body}` : ''})`
    : '';
  return `SESSION_INVALID: session died during record sync${detail} after ${result.created} created / ${result.updated} updated. Re-authenticate, then resume by re-running mode=apply with the same planId (progress is persisted).`;
}

/**
 * Flag the result as aborted (first-wins abortReason). Called from every write pass the moment
 * a session death is detected; runRecords then skips the remaining passes + prune.
 */
function markAborted(client, result) {
  result.aborted = true;
  if (!result.abortReason) result.abortReason = buildAbortReason(client, result);
}

/**
 * Returns true if the field type is a multiSelect (arrays not accepted by updateRecords).
 * @param {string} type
 * @returns {boolean}
 */
function isMultiSelect(type) {
  return type === 'multiSelect' || type === 'multipleSelects';
}

/** multiSelect + multiCollaborator — updated via setArrayChoiceCell (add/remove items). */
function isArrayChoiceType(type) {
  return (
    type === 'multiSelect' ||
    type === 'multipleSelects' ||
    type === 'multiCollaborator' ||
    type === 'multipleCollaborators'
  );
}

/**
 * Normalize a multiSelect / multiCollaborator cell to an array of id strings.
 * @param {*} val
 * @returns {string[]}
 */
function arrayChoiceIds(val) {
  if (!Array.isArray(val)) return [];
  const out = [];
  for (const e of val) {
    if (typeof e === 'string' && e) out.push(e);
    else if (e && typeof e === 'object') {
      const id = e.id ?? e.userId ?? e.foreignRowId;
      if (typeof id === 'string' && id) out.push(id);
    }
  }
  return out;
}

/**
 * Build setArrayChoiceCell ops for multiSelect / multiCollaborator UPDATE diffs.
 * Choice ids are remapped through idmap.fields[srcFld].choices for multiSelect.
 * Collaborator usr ids pass through (Airtable-global).
 *
 * @returns {{ columnId: string, desiredIds: string[], currentIds: string[], srcFieldId: string, type: string }[]}
 */
export function collectArrayChoiceUpdates(srcFields, srcCells, destCells, idmap, warnings = null, srcRecId = '') {
  const ops = [];
  if (!destCells) return ops;
  for (const field of srcFields) {
    if (!isArrayChoiceType(field.type)) continue;
    const mapping = idmap.fields[field.id];
    if (!mapping) continue;
    const srcVal = srcCells[field.id];
    let desired;
    if (isMultiSelect(field.type)) {
      const cm = mapping.choices || {};
      const srcIds = arrayChoiceIds(srcVal);
      // Unmappable choices → skip op. Mirror the CREATE path (buildCreateCells), which
      // emits RECORD_CELL_SKIPPED — otherwise a stale multiSelect on an EXISTING dest row
      // fails silently and never converges on re-sync (hard to diagnose).
      const mapped = srcIds.map((s) => cm[s]).filter(Boolean);
      if (mapped.length !== srcIds.length) {
        warnings?.push({
          code: 'RECORD_CELL_SKIPPED',
          message: `Record ${srcRecId}: field ${field.id} (${field.type}) choice could not be mapped to dest — multiSelect update skipped`,
        });
        continue;
      }
      desired = mapped;
    } else {
      desired = arrayChoiceIds(srcVal);
    }
    const current = arrayChoiceIds(destCells[mapping.destFld]);
    if (arrayCellEquals(desired, current)) continue;
    ops.push({
      columnId: mapping.destFld,
      desiredIds: desired,
      currentIds: current,
      srcFieldId: field.id,
      type: field.type,
    });
  }
  return ops;
}

/**
 * Order-insensitive equality of two array cell values by normalized element id
 * (strings pass through; objects contribute .id / .foreignRowId). multiSelect /
 * collaborator cell arrays carry no user-facing order (display order comes from
 * choiceOrder), so a pure reorder is not a difference.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function arrayCellEquals(a, b) {
  const key = (arr) => (Array.isArray(arr) ? arr : [])
    .map((e) => (typeof e === 'string' ? e : String(e?.id ?? e?.foreignRowId ?? JSON.stringify(e))))
    .sort()
    .join('\u0000');
  return key(a) === key(b);
}

/**
 * Build the per-record cell map for the CREATE path.
 * Includes all writable cells (scalar, select, multiSelect).
 * Pushes RECORD_CELL_SKIPPED warnings for unmappable choices.
 *
 * @param {Array} srcFields   - source table field descriptors
 * @param {object} srcCells   - source record cellValuesByColumnId
 * @param {object} idmap      - id-map (fields + choices)
 * @param {Array}  warnings   - result.warnings array (mutated)
 * @param {string} srcRecId   - source record id (for warning context)
 * @returns {object}          - dest cellValuesByColumnId
 */
export function buildCreateCells(srcFields, srcCells, idmap, warnings, srcRecId, destComputedFldIds = new Set()) {
  const cells = {};
  for (const field of srcFields) {
    const srcVal = srcCells[field.id];
    if (srcVal === undefined) continue;
    const mapping = idmap.fields[field.id];
    if (!mapping) continue; // field not mapped → skip
    // A valued source field name-matched to a COMPUTED dest field (formula/lookup/rollup/count/
    // autoNumber/computed timestamp|user/…) must NOT be written: Airtable rejects a write to a
    // computed field with 403 INVALID_PERMISSIONS ("Field <id> cannot be updated"), which fails the
    // ENTIRE row create (→ 0 created). Skip it — the dest value is derived, not synced.
    if (destComputedFldIds.has(mapping.destFld)) continue;
    const coerced = coercePass1Cell(field, srcVal, idmap);
    if (!coerced.write) {
      // Only warn for select/multiSelect that failed choice mapping (not for structural skip)
      if (field.type === 'select' || field.type === 'multiSelect' || field.type === 'multipleSelects') {
        warnings.push({
          code: 'RECORD_CELL_SKIPPED',
          message: `Record ${srcRecId}: field ${field.id} (${field.type}) choice could not be mapped to dest — cell skipped`,
        });
      }
      continue;
    }
    cells[mapping.destFld] = coerced.value;
  }
  return cells;
}

/**
 * Build the per-record cell map for the UPDATE path.
 * Excludes ALL array-shaped cells (updateRecords → updatePrimitiveCell rejects arrays — one
 * array cell in the payload would fail its cell POST and poison the rest of the row update):
 *   - link/attachment arrays are silently skipped (owned by Pass 2 / Pass 3);
 *   - multiSelect/collaborator arrays are omitted here and applied via collectArrayChoiceUpdates
 *     + client.setArrayChoiceCell after the primitive update batch.
 *
 * Cleared cells: readQueries omits empty cells, so a cell CLEARED on source arrives as an
 * ABSENT key. Since buildUpdateCells only runs under conflicts=source-wins, the clear must
 * propagate: an explicit null is emitted for a mapped, writable, non-array field whose dest
 * cell is known to still hold a value. Never cleared: unmapped fields, computed fields on
 * EITHER side (a scalar-source field name-matched to a computed dest field is a persistent
 * RETYPE_DEFERRED pair — updatePrimitiveCell rejects computed writes and one failing cell
 * poisons the whole row update), array cells (Pass 2/3 / deferral own those), and anything
 * when the dest record's cells are unknown (dest record absent from the snapshot).
 *
 * @param {Array}  srcFields  - source table field descriptors
 * @param {object} srcCells   - source record cellValuesByColumnId
 * @param {object|undefined} destCells - dest record cellValuesByColumnId (undefined when the
 *                                       mapped dest record is absent from the dest snapshot)
 * @param {object} idmap      - id-map (fields + choices)
 * @param {Array}  warnings   - result.warnings array (mutated)
 * @param {string} srcRecId   - source record id (for warning context)
 * @param {Set<string>} [destComputedFldIds] - dest field ids whose DEST type is computed
 * @returns {object}          - dest cellValuesByColumnId (primitives + single-select only)
 */
export function buildUpdateCells(srcFields, srcCells, destCells, idmap, warnings, srcRecId, destComputedFldIds = new Set()) {
  const cells = {};
  for (const field of srcFields) {
    const mapping = idmap.fields[field.id];
    if (!mapping) continue; // field not mapped → skip
    const srcVal = srcCells[field.id]; // ABSENT key = cell is EMPTY on source
    // Array-shaped cells are never accepted by updateRecords.
    // multiSelect / multiCollaborator: handled after the primitive batch via setArrayChoiceCell
    // (collectArrayChoiceUpdates) — no RECORD_ARRAY_UPDATE_DEFERRED spam.
    // links / attachments: Pass 2 / Pass 3.
    if (ARRAY_CELL_TYPES.has(field.type)) {
      continue;
    }
    if (isComputedType(field.type)) continue; // Pass 1 never writes (or clears) computed SOURCE cells
    // ...and never writes (or clears) a COMPUTED DEST field: a scalar/valued source name-matched to a
    // computed dest field (formula/lookup/rollup/…) is a persistent RETYPE_DEFERRED pair; Airtable
    // rejects the write with 403 INVALID_PERMISSIONS ("cannot be updated") and one failing cell
    // poisons the whole row update. (Covers BOTH the write and clear paths.)
    if (destComputedFldIds.has(mapping.destFld)) continue;
    if (srcVal === undefined) {
      // Cleared on source: propagate the clear (source-wins) as an explicit null, but only
      // when the dest record is known to still hold a value for this field.
      const destVal = destCells ? destCells[mapping.destFld] : undefined;
      if (destVal !== undefined && destVal !== null) cells[mapping.destFld] = null;
      continue;
    }
    const coerced = coercePass1Cell(field, srcVal, idmap);
    if (!coerced.write) {
      if (field.type === 'select') {
        warnings.push({
          code: 'RECORD_CELL_SKIPPED',
          message: `Record ${srcRecId}: field ${field.id} (select) choice could not be mapped to dest — cell skipped`,
        });
      }
      continue;
    }
    if (Array.isArray(coerced.value)) continue; // defensive: no array must ever enter the row payload
    // Skip cells the destination already agrees with. updateRecords issues ONE
    // serialized HTTP POST per CELL (client.js `updatePrimitiveCell`), and without
    // this comparison every mapped scalar cell of every mapped row was re-posted on
    // every re-sync even when nothing had changed — 1000 rows x 20 fields = 20,000
    // sequential requests for a no-op run. On a converged table this collapses most
    // rows to zero cells, which the existing empty-row skip then drops entirely.
    if (destCells && sameCellValue(destCells[mapping.destFld], coerced.value)) continue;
    cells[mapping.destFld] = coerced.value;
  }
  return cells;
}

/**
 * Value equality for the Pass-1 update diff.
 *
 * Only ever sees scalars here — array-shaped cells returned earlier, and the
 * Array.isArray guard above is belt-and-braces — so strict equality covers the
 * common case and a structural compare covers the object-shaped ones (select
 * choices, dates carrying a timezone wrapper). Deliberately conservative: when in
 * doubt it reports "different" and we simply write the cell as before.
 */
function sameCellValue(a, b) {
  if (a === b) return true;
  // An absent dest cell and an explicit null/'' source cell are not worth a request
  // apart, but only treat them equal when BOTH sides are empty-ish.
  const empty = (v) => v === undefined || v === null || v === '';
  if (empty(a) && empty(b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Pass 1 record sync: scalar/select upsert + fill the global record map.
 *
 * @param {object} opts
 * @param {object} opts.client        - AirtableClient instance
 * @param {object} opts.srcSnapshot   - source base snapshot (tables with records attached)
 * @param {object} opts.destSnapshot  - dest base snapshot
 * @param {object} opts.idmap         - live id-map (mutated: idmap.records filled)
 * @param {object} opts.limiter       - rate limiter from createLimiter()
 * @param {object} opts.journal       - journal from newJournal()
 * @param {Function} opts.persist     - persist(idmap, journal) called after each batch
 * @param {object} opts.result        - result accumulator { created, updated, skipped, failed, warnings }
 * @returns {Promise<void>}
 */
/**
 * Order source tables so a link target table is created BEFORE the tables that link to it,
 * maximizing how many link cells can be folded into the create payload (their dest target
 * already exists in idmap.records). Deterministic: ties / cycles preserve original order.
 *
 * An edge T → target exists when T has a MAPPED link field (foreignKey/multipleRecordLinks)
 * whose `typeOptions.foreignTableId` is another known table. Self-links are ignored (the row's
 * own dest id isn't known until after its create → handled by Pass 2).
 *
 * @param {Array}  tables  - source table descriptors
 * @param {object} idmap   - id-map (.fields used to skip unmapped link fields)
 * @returns {Array}        - tables reordered (targets first); cycles broken in original order
 */
export function orderTablesByLinkDeps(tables, idmap) {
  const list = tables || [];
  const byId = new Set(list.map((t) => t.id));
  const deps = new Map(); // tableId → Set(targetTableId)
  for (const t of list) {
    const set = new Set();
    for (const f of (t.fields || [])) {
      if ((f.type === 'foreignKey' || f.type === 'multipleRecordLinks') && idmap.fields?.[f.id]) {
        const target = f.typeOptions?.foreignTableId;
        if (target && target !== t.id && byId.has(target)) set.add(target);
      }
    }
    deps.set(t.id, set);
  }
  const ordered = [];
  const emitted = new Set();
  const remaining = list.slice();
  while (remaining.length) {
    // Emit the FIRST (original-order) table whose deps are all already emitted.
    const idx = remaining.findIndex((t) => [...deps.get(t.id)].every((d) => emitted.has(d)));
    const pick = idx === -1 ? 0 : idx; // no eligible table → cycle: break by taking the first remaining
    const [t] = remaining.splice(pick, 1);
    ordered.push(t);
    emitted.add(t.id);
  }
  return ordered;
}

/**
 * Build the resolvable link cells for the CREATE payload: for each mapped link field whose
 * source value references records already in idmap.records, emit
 * `{ destFld: [{ foreignRowId: <destRecId>, foreignRowDisplayName: '' }] }`.
 * Unresolvable targets (forward/circular refs) are left to Pass 2 (it re-adds anything missing).
 * (Display name is cosmetic — '' is accepted; Airtable recomputes it.)
 *
 * @param {Array}  srcFields
 * @param {object} srcCells
 * @param {object} idmap
 * @returns {object} dest cellValuesByColumnId fragment containing only the resolvable link cells
 */
function buildResolvableLinkCells(srcFields, srcCells, idmap) {
  const cells = {};
  for (const field of (srcFields || [])) {
    if (field.type !== 'foreignKey' && field.type !== 'multipleRecordLinks') continue;
    const mapping = idmap.fields[field.id];
    if (!mapping) continue;
    const srcVal = srcCells[field.id];
    if (!srcVal || (Array.isArray(srcVal) && srcVal.length === 0)) continue;
    const { resolved } = partitionLinkValue(srcVal, idmap);
    if (resolved.length > 0) {
      cells[mapping.destFld] = resolved.map((id) => ({ foreignRowId: id, foreignRowDisplayName: '' }));
    }
  }
  return cells;
}

/**
 * Mirror links folded into a create into the in-memory dest snapshot, so Pass 2's dedup
 * (built from destSnapshot) treats them as already-present and does NOT re-add them.
 * (Created rows are absent from the pre-run dest snapshot; this keeps it consistent.)
 */
function mirrorFoldedLinks(destTableById, destTableId, destRowId, linkCells) {
  if (!linkCells || Object.keys(linkCells).length === 0) return;
  const dt = destTableById.get(destTableId);
  if (!dt) return;
  dt.records ??= [];
  dt.records.push({ id: destRowId, cellValuesByColumnId: { ...linkCells } });
}

/**
 * Create one chunk, with a SAFETY fallback: if folded link cells cause per-row create failures,
 * retry just those rows WITHOUT the link cells. If stripping links rescues a row, the link cell
 * is the culprit → disable link-folding for the remainder of the run (runState.foldLinks=false),
 * so Pass 2 writes those links per-item. This bounds the blast radius if `row/create` ever rejects
 * a folded link array to ~one chunk of retries (the create-with-links capability is high-confidence
 * but not live-verified — this is the calibration knob).
 */
async function createChunkWithFallback({ client, destAppId, destTableId, chunk, idmap, result, limiter, runState, destTableById, createdDestIds }) {
  const gate = makeGate(limiter); // paces each inner per-row create POST under the phase limiter
  let res;
  try {
    res = await client.createRecords(destAppId, destTableId, chunk, { gate });
  } catch (err) {
    // A run-wide session death aborts the whole job; any other throw is a per-chunk failure.
    if (sessionDied(client, err)) { markAborted(client, result); return; }
    result.failed += chunk.length;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: createRecords threw: ${err.message}` });
    return;
  }

  // Record rows that landed BEFORE any death (preserve partial progress), then check for death.
  for (const created of (res.created || [])) {
    idmap.records[created.sourceKey] = created.rowId;
    createdDestIds?.add(created.rowId);
    result.created++;
    const row = chunk.find((r) => r.sourceKey === created.sourceKey);
    mirrorFoldedLinks(destTableById, destTableId, created.rowId, row?.linkCells);
  }

  const failed = res.failed || [];

  // Session death during the per-row POSTs: the client swallows each dead POST into failed[]
  // (it does NOT throw at the batch level). Detect it here and abort BEFORE processing/retrying
  // any failures — a dead session must not spin the link-strip retry or march the remaining rows.
  if (sessionDied(client) || failed.some((f) => sessionDied(client, f.error))) {
    markAborted(client, result);
    return;
  }

  if (failed.length === 0) return;

  // Split failures: those whose row carried folded links (retryable) vs genuine failures.
  const failedKeys = new Set(failed.map((f) => f.sourceKey));
  const linkFailedRows = chunk.filter(
    (r) => failedKeys.has(r.sourceKey) && r.linkCells && Object.keys(r.linkCells).length > 0,
  );
  const linkFailedKeys = new Set(linkFailedRows.map((r) => r.sourceKey));
  for (const f of failed) {
    if (linkFailedKeys.has(f.sourceKey)) continue; // handled by retry below
    result.failed++;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: failed to create record (sourceKey=${f.sourceKey}): ${f.error}` });
  }

  if (linkFailedRows.length === 0) return;

  // Retry the link-bearing failures WITHOUT their link cells.
  const stripped = linkFailedRows.map((r) => {
    const cells = { ...r.cellValuesByColumnId };
    for (const k of Object.keys(r.linkCells)) delete cells[k];
    return { cellValuesByColumnId: cells, sourceKey: r.sourceKey, linkCells: {} };
  });
  let retryRes;
  try {
    retryRes = await client.createRecords(destAppId, destTableId, stripped, { gate });
  } catch (err) {
    if (sessionDied(client, err)) { markAborted(client, result); return; }
    result.failed += stripped.length;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: retry-without-links threw: ${err.message}` });
    return;
  }
  let rescued = 0;
  for (const created of (retryRes.created || [])) {
    idmap.records[created.sourceKey] = created.rowId; // links NOT folded → Pass 2 adds them (no mirror)
    createdDestIds?.add(created.rowId);
    result.created++;
    rescued++;
  }
  for (const f of (retryRes.failed || [])) {
    result.failed++;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: failed to create record without links (sourceKey=${f.sourceKey}): ${f.error}` });
  }
  if (rescued > 0 && runState.foldLinks) {
    runState.foldLinks = false;
    result.warnings.push({
      code: 'FOLD_LINKS_DISABLED',
      message: `Table ${destTableId}: create rejected folded link cells — disabled link-fold for the rest of this run (Pass 2 writes links per-item)`,
    });
  }
}

export async function applyRecordsPass1({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result, policy, policyOverrides, fieldMappings = [], createdDestIds }) {
  if (!idmap.records) idmap.records = {};

  // destAppId comes from the snapshot (set by snapshotBase); fall back to '' for tests that omit it.
  const destAppId = destSnapshot.baseId || '';

  // Run-level circuit breaker for fold-into-create (see createChunkWithFallback).
  const runState = { foldLinks: true };
  // Dest table lookup for mirroring folded links into the snapshot (so Pass 2 dedups them out).
  const destTableById = new Map((destSnapshot.tables || []).map((t) => [t.id, t]));

  // Create link TARGET tables before their dependents so cross-table links resolve at create time.
  const orderedTables = orderTablesByLinkDeps(srcSnapshot.tables || [], idmap);

  for (const srcTable of orderedTables) {
    // A session death latched by a prior table/chunk aborts the whole job — never start a new table.
    if (client.auth?.isSessionDead?.()) { markAborted(client, result); return; }
    // Per-table write outcome, derived by diffing the run-wide counters across this
    // iteration. pruneRecords needs it: the only "don't prune after a failure" gate
    // used to be RUN-wide (failed>0 && created===0 && updated===0 && skipped===0), so a
    // single converged row anywhere in the run disarmed it — and a table whose every
    // write failed (a FIELD_FORBIDDEN 403 is a schema-level property that fails every
    // row of one table by design) then had its pre-existing dest rows deleted under
    // mirror while the replacement data was never written.
    const countsBefore = {
      created: result.created, updated: result.updated,
      skipped: result.skipped, failed: result.failed,
    };
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched → skip

    const { conflicts } = resolvePolicy(policy, policyOverrides, srcTable.name);
    const tableMappings = fieldMappings.filter((m) => m.table === srcTable.name);
    // Dest cell lookup for the UPDATE path (converged-array detection + cleared-cell propagation).
    const destCellsById = new Map(
      (destTableById.get(destTableId)?.records || []).map((r) => [r.id, r.cellValuesByColumnId || {}]),
    );
    // Dest fields that are COMPUTED — a name-matched scalar-source/computed-dest pair
    // (persistent RETYPE_DEFERRED) must never receive a cleared-cell null (see buildUpdateCells).
    const destComputedFldIds = new Set(
      (destTableById.get(destTableId)?.fields || []).filter((f) => isComputedType(f.type)).map((f) => f.id),
    );

    const records = srcTable.records || [];
    if (records.length === 0) continue;

    // Partition into CREATE vs UPDATE batches
    const createRows = [];
    const updateRows = [];
    /** @type {{ rowId: string, srcRecId: string, ops: ReturnType<typeof collectArrayChoiceUpdates> }[]} */
    const arrayChoiceRows = [];

    for (const rec of records) {
      const srcCells = rec.cellValuesByColumnId || {};
      const destRecId = idmap.records[rec.id];

      if (!destRecId) {
        // CREATE path — scalar/select/multiSelect arrays ARE accepted by createRecords.
        const cells = buildCreateCells(srcTable.fields, srcCells, idmap, result.warnings, rec.id, destComputedFldIds);
        injectFieldMappings(cells, tableMappings, srcCells);
        // Fold resolvable links (remapped) into the create payload (kills most of Pass 2).
        let linkCells = {};
        if (runState.foldLinks) {
          linkCells = buildResolvableLinkCells(srcTable.fields, srcCells, idmap);
          Object.assign(cells, linkCells);
        }
        createRows.push({ cellValuesByColumnId: cells, sourceKey: rec.id, linkCells });
      } else {
        // UPDATE path — primitives via updateRecords; multiSelect via setArrayChoiceCell
        // preserve dest edits: skip the overwrite. Count it as skipped (like overlay's no-op path
        // below) so a preserve/dest-wins re-sync of mostly-mapped rows never trips the
        // RECORDS_ALL_FAILED gate (created==0 && updated==0 && skipped==0 && failed>0) and falsely
        // aborts a healthy run just because a few NEW-record creates failed.
        if (conflicts === 'dest-wins') { result.skipped++; continue; }
        const destCells = destCellsById.get(destRecId);
        const cells = buildUpdateCells(srcTable.fields, srcCells, destCells, idmap, result.warnings, rec.id, destComputedFldIds);
        injectFieldMappings(cells, tableMappings, srcCells);
        const arrayOps = collectArrayChoiceUpdates(srcTable.fields, srcCells, destCells, idmap, result.warnings, rec.id);
        if (arrayOps.length > 0) {
          arrayChoiceRows.push({ rowId: destRecId, srcRecId: rec.id, ops: arrayOps });
        }
        // Nothing to write → skip: client.updateRecords rejects an empty cell map per row,
        // which would misreport this healthy record as RECORD_UPDATE_FAILED on every re-sync.
        // Array-only diffs still count as work (handled below) so don't skip the whole record.
        if (Object.keys(cells).length === 0) {
          if (arrayOps.length === 0) result.skipped++;
          continue;
        }
        updateRows.push({ rowId: destRecId, cellValuesByColumnId: cells });
      }
    }

    // ── CREATE batches (chunked) ──────────────────────────────────────────
    // Chunk + persist per chunk so progress is durable/visible: a crash loses at most one chunk
    // (not the whole table → bounded duplication on resume), and idmap.records grows during the
    // run so `sync_base mode=status` reports live progress instead of 0 until a huge table finishes.
    const CREATE_CHUNK = 50;
    for (let i = 0; i < createRows.length; i += CREATE_CHUNK) {
      const chunk = createRows.slice(i, i + CREATE_CHUNK);
      await createChunkWithFallback({ client, destAppId, destTableId, chunk, idmap, result, limiter, runState, destTableById, createdDestIds });
      persist(idmap, journal);
      if (result.aborted) return; // session died mid-chunk — stop walking rows/tables
    }

    // ── UPDATE batch ──────────────────────────────────────────────────────
    if (updateRows.length > 0) {
      try {
        const res = await client.updateRecords(destAppId, destTableId, updateRows, { gate: makeGate(limiter) });
        const updFailed = res.failed || [];
        // Session death mid-batch: updateRecords swallows dead per-cell POSTs into failed[] too.
        if (sessionDied(client) || updFailed.some((f) => sessionDied(client, f.error))) {
          result.updated += (res.updated || []).length;
          markAborted(client, result);
          persist(idmap, journal);
          return;
        }
        result.updated += (res.updated || []).length;
        for (const failed of updFailed) {
          result.failed++;
          result.warnings.push({
            code: 'RECORD_UPDATE_FAILED',
            message: `Table ${destTableId}: failed to update record (rowId=${failed.rowId}): ${failed.error}`,
          });
        }
      } catch (err) {
        if (sessionDied(client, err)) { markAborted(client, result); persist(idmap, journal); return; }
        result.failed += updateRows.length;
        result.warnings.push({
          code: 'RECORD_UPDATE_FAILED',
          message: `Table ${destTableId}: updateRecords threw: ${err.message}`,
        });
      }
      persist(idmap, journal);
    }

    // ── multiSelect / multiCollaborator UPDATE (add/remove item APIs) ─────
    // updatePrimitiveCell rejects arrays; setArrayChoiceCell converges membership.
    if (arrayChoiceRows.length > 0 && typeof client.setArrayChoiceCell === 'function') {
      const gate = makeGate(limiter);
      for (const row of arrayChoiceRows) {
        if (result.aborted) return;
        let rowOk = true;
        for (const op of row.ops) {
          try {
            const res = await client.setArrayChoiceCell(
              destAppId,
              row.rowId,
              op.columnId,
              op.desiredIds,
              { currentIds: op.currentIds, gate },
            );
            if (sessionDied(client) || sessionDied(client, res?.error)) {
              markAborted(client, result);
              persist(idmap, journal);
              return;
            }
            if (!res?.ok) {
              rowOk = false;
              result.warnings.push({
                code: 'RECORD_ARRAY_UPDATE_FAILED',
                message: `Record ${row.srcRecId}: field ${op.srcFieldId} (${op.type}) array update failed: ${res?.error || 'unknown'}`,
              });
            }
          } catch (err) {
            if (sessionDied(client, err)) { markAborted(client, result); persist(idmap, journal); return; }
            rowOk = false;
            result.warnings.push({
              code: 'RECORD_ARRAY_UPDATE_FAILED',
              message: `Record ${row.srcRecId}: field ${op.srcFieldId} (${op.type}) array update threw: ${err.message}`,
            });
          }
        }
        if (rowOk) {
          // Count as updated when only array cells changed (no primitive update row).
          if (!updateRows.some((u) => u.rowId === row.rowId)) result.updated++;
        } else {
          result.failed++;
        }
      }
      persist(idmap, journal);
    }

    // Record what this table actually achieved, for pruneRecords' per-table gate.
    // Tables that `continue` above never reach here — they attempted no writes, so
    // the absence of an entry correctly reads as "nothing failed".
    (result.perTable ??= {})[srcTable.name] = {
      created: result.created - countsBefore.created,
      updated: result.updated - countsBefore.updated,
      skipped: result.skipped - countsBefore.skipped,
      failed: result.failed - countsBefore.failed,
    };
  }
}

/**
 * Pass 2 record sync: write link cells (multipleRecordLinks / foreignKey) that
 * were deferred from Pass 1.
 *
 * For each matched table, for each source field of type `multipleRecordLinks`
 * or `foreignKey` that has a dest field mapping, for each source record with a
 * non-empty link cell:
 *   - Map src row → dest row (skip if the src row has no dest mapping).
 *   - `partitionLinkValue(srcCell, idmap)` → resolved (dest rec ids) + unresolved (src rec ids).
 *   - Dedup against current dest links: only add ids NOT already present.
 *   - Call `client.addLinkItems` via the limiter for the new items.
 *   - Push ONE `RECORD_LINK_UNRESOLVED` warning (count + context) for any unresolved ids.
 *   - Continue-on-failure: per-field errors are caught and pushed as `RECORD_LINK_FAILED` warnings.
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance (must have addLinkItems)
 * @param {object} opts.srcSnapshot     - source base snapshot (tables with records attached)
 * @param {object} opts.destSnapshot    - dest base snapshot (tables with records attached; used for dedup)
 * @param {object} opts.idmap           - live id-map (.tables, .fields, .records)
 * @param {Map}    opts.destDisplayNames - Map<destRecId, primaryString> for foreignRowDisplayName
 * @param {object} opts.limiter         - rate limiter from createLimiter()
 * @param {object} opts.journal         - journal from newJournal()
 * @param {Function} opts.persist       - persist(idmap, journal) called after each table
 * @param {object} opts.result          - result accumulator { created, updated, skipped, failed, warnings }
 * @param {string}   [opts.policy]         - global preset ('mirror'|'overlay'|'preserve')
 * @param {object}   [opts.policyOverrides]- per-table preset overrides
 * @param {Set<string>} [opts.createdDestIds] - dest row ids CREATED this run (Pass 1); under
 *   conflicts=dest-wins only these rows receive link writes — a PRE-EXISTING mapped dest row is
 *   never touched (the dest user may have removed the link on purpose).
 * @returns {Promise<void>}
 */
export async function applyRecordsPass2({ client, srcSnapshot, destSnapshot, idmap, destDisplayNames, limiter, journal, persist, result, policy, policyOverrides, createdDestIds = new Set() }) {
  const destAppId = destSnapshot.baseId || '';

  // Build a fast lookup: destTableId → Map<destRecId, Set<linkedDestRecId>>
  // so we can check which links already exist on the dest row.
  const destLinkIndex = new Map(); // destTableId → Map<destRecId, Map<destFldId, Set<linkedId>>>
  for (const destTable of (destSnapshot.tables || [])) {
    const recMap = new Map();
    for (const rec of (destTable.records || [])) {
      recMap.set(rec.id, rec.cellValuesByColumnId || {});
    }
    destLinkIndex.set(destTable.id, recMap);
  }

  for (const srcTable of (srcSnapshot.tables || [])) {
    // A session death latched by a prior table aborts the whole job — never start a new table.
    if (client.auth?.isSessionDead?.()) { markAborted(client, result); return; }
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue;

    // Conflicts axis: under dest-wins, only rows created THIS run get link writes.
    const { conflicts } = resolvePolicy(policy, policyOverrides, srcTable.name);

    // Find all link fields in this source table that have a dest mapping
    const linkFields = (srcTable.fields || []).filter(
      (f) => (f.type === 'multipleRecordLinks' || f.type === 'foreignKey') && idmap.fields[f.id],
    );
    if (linkFields.length === 0) continue;

    const destRecMap = destLinkIndex.get(destTableId) || new Map();

    for (const rec of (srcTable.records || [])) {
      const destRowId = idmap.records[rec.id];
      if (!destRowId) continue; // src row not yet mapped → skip
      // Pre-existing mapped dest row under dest-wins: never re-add links the dest user removed.
      if (conflicts === 'dest-wins' && !createdDestIds.has(destRowId)) continue;

      const srcCells = rec.cellValuesByColumnId || {};
      const destCells = destRecMap.get(destRowId) || {};

      for (const field of linkFields) {
        const srcVal = srcCells[field.id];

        const mapping = idmap.fields[field.id];
        const destFldId = mapping.destFld;

        // Partition: resolved → dest rec ids; unresolved → src rec ids with no mapping.
        // (An empty/cleared source cell → resolved=[] and unresolved=[]; still evaluated
        // below so dest-extra links are surfaced under source-wins.)
        const { resolved, unresolved } = partitionLinkValue(srcVal, idmap);

        // Current dest link membership (string- or object-shaped elements).
        const currentLinks = destCells[destFldId];
        const currentLinkIds = (Array.isArray(currentLinks) ? currentLinks : []).map(linkRecId).filter(Boolean);

        // Warn for unresolved (one warning per field+record, count in message)
        if (unresolved.length > 0) {
          result.warnings.push({
            code: 'RECORD_LINK_UNRESOLVED',
            message: `Record ${rec.id} field ${field.id}: ${unresolved.length} linked record(s) could not be resolved (no dest mapping): ${unresolved.join(', ')}`,
          });
        }

        // Mirror/overlay (source-wins) promises dest link membership converges to source, but
        // Pass 2 only ADDS missing links — dest-extra links are never removed (link removal is a
        // deferred follow-up, same class as attachment-strip). Surface the gap so mirror users
        // aren't misled that links fully converged. Only trustworthy when every source link
        // resolved (otherwise an "extra" dest link may correspond to an unresolved source link).
        if (conflicts === 'source-wins' && unresolved.length === 0) {
          const desired = new Set(resolved);
          const extra = currentLinkIds.filter((id) => !desired.has(id));
          if (extra.length > 0) {
            result.warnings.push({
              code: 'LINK_REMOVE_DEFERRED',
              message: `Record ${rec.id} field ${field.id} → dest row ${destRowId}: ${extra.length} dest-only link(s) not removed (link removal is deferred; dest not fully mirrored)`,
            });
          }
        }

        if (resolved.length === 0) continue;

        // Dedup against current dest links (only ADD ids not already present).
        const alreadyPresent = new Set(currentLinkIds);
        const toAdd = resolved.filter((id) => !alreadyPresent.has(id));
        if (toAdd.length === 0) continue;

        const items = toAdd.map((destRec) => ({
          foreignRowId: destRec,
          foreignRowDisplayName: destDisplayNames.get(destRec) ?? '',
        }));

        try {
          const res = await client.addLinkItems(destAppId, destRowId, destFldId, items, { gate: makeGate(limiter) });
          if (!res.ok) {
            // addLinkItems never throws — a dead session surfaces as ok:false + a SESSION_INVALID error.
            if (sessionDied(client, res.error)) { markAborted(client, result); persist(idmap, journal); return; }
            result.warnings.push({
              code: 'RECORD_LINK_FAILED',
              message: `Record ${rec.id} field ${field.id} → dest row ${destRowId}: addLinkItems failed: ${res.error}`,
            });
          } else {
            result.updated++;
          }
        } catch (err) {
          if (sessionDied(client, err)) { markAborted(client, result); persist(idmap, journal); return; }
          result.warnings.push({
            code: 'RECORD_LINK_FAILED',
            message: `Record ${rec.id} field ${field.id} → dest row ${destRowId}: addLinkItems threw: ${err.message}`,
          });
        }
      }
    }

    persist(idmap, journal);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Default fetchBytes: real fetch-based implementation.
// Injected in tests so no real network is hit.
// ──────────────────────────────────────────────────────────────────────────────
async function defaultFetchBytes(url) {
  const r = await fetch(url);
  return { bytes: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
}

/**
 * Attachment field type names accepted by Airtable (public API names).
 */
const ATTACHMENT_TYPES = new Set(['multipleAttachments', 'multipleAttachment']);

/**
 * Fallback: upload a single attachment via download→upload for cases where the
 * server-side fast-path skipped or failed it.
 *
 * @param {object} opts
 * @param {object}   opts.client
 * @param {string}   opts.destAppId
 * @param {string}   opts.destRowId
 * @param {string}   opts.destFldId
 * @param {object}   opts.attachment  - { url, filename, size, type }
 * @param {object}   opts.idmap
 * @param {object}   opts.result
 * @param {Function} opts.fetchBytes
 * @param {object}   opts.limiter
 */
async function uploadAttachmentFallback({ client, destAppId, destRowId, destFldId, attachment, idmap, result, fetchBytes, limiter }) {
  const { url, filename, size, type } = attachment;
  if (!url || !filename) return;

  // Dedupe key is scoped to the destination CELL (row|field|filename|size): a same-named
  // same-size file on ANOTHER record/field is a different upload and must never be suppressed,
  // while a re-run of the SAME cell stays idempotent. Old-format `filename|size` keys persisted
  // by earlier runs are legacy — kept in the map but never matched (a one-time re-upload of an
  // already-filled cell beats permanently-empty cells on every other record).
  const dedupeKey = `${destRowId}|${destFldId}|${filename}|${size}`;
  if (idmap.attachments[dedupeKey]) return; // already uploaded to this cell

  let bytes;
  let contentType = type;
  try {
    const fetched = await fetchBytes(url);
    bytes = fetched.bytes;
    if (!contentType && fetched.contentType) contentType = fetched.contentType;
  } catch (fetchErr) {
    result.warnings.push({
      code: 'ATTACHMENT_FAILED',
      message: `Attachment ${filename}: fetch failed — ${fetchErr.message}`,
    });
    return;
  }

  try {
    const res = await limiter.run(() =>
      withRetry(() =>
        client.uploadAttachment(destAppId, destRowId, destFldId, { bytes, filename, contentType }),
      ),
    );
    if (res.ok) {
      idmap.attachments[dedupeKey] = true;
      result.attachmentsUploaded = (result.attachmentsUploaded || 0) + 1;
    } else {
      result.warnings.push({
        code: 'ATTACHMENT_FAILED',
        message: `Attachment ${filename}: upload failed — ${res.error || 'unknown error'}`,
      });
    }
  } catch (uploadErr) {
    result.warnings.push({
      code: 'ATTACHMENT_FAILED',
      message: `Attachment ${filename}: upload threw — ${uploadErr.message}`,
    });
  }
}

/**
 * Pass 3 record sync: server-side cross-base attachment copy (fast-path), with
 * per-attachment download→upload fallback for skipped/failed items.
 *
 * Fast-path (per table with ≥1 mapped attachment field):
 *   1. Collect included source records (mapped in idmap.records, have ≥1 attachment cell).
 *   2. Build `attachmentIdsWithCellLocation` from all attachment objects in included cells.
 *   3. Call `createDataTransferPolicy` (POST createDataTransferPolicyV2) to get the signed policy.
 *   4. Call `pasteAttachmentsCrossBase` (POST pasteCells) which SETS the target cells (idempotent).
 *   5. Bump result.attachmentsUploaded by pastedRowIds.length (or numUpdatedCells).
 *
 * Fallback (per skipped attachment or on fast-path error):
 *   - For res.skippedAttachments (non-empty): call uploadAttachmentFallback for each skipped att.
 *   - On thrown error from fast-path: warn ATTACHMENT_FALLBACK, iterate all included attachments
 *     through uploadAttachmentFallback.
 *   - Continue-on-failure: per-table errors never throw out of the loop.
 *   - persist(idmap, journal) after each table.
 *
 * @param {object}   opts
 * @param {object}   opts.client          - AirtableClient instance (must have createDataTransferPolicy, pasteAttachmentsCrossBase, uploadAttachment)
 * @param {object}   opts.srcSnapshot     - source base snapshot (tables with records attached; must have baseId)
 * @param {object}   opts.destSnapshot    - dest base snapshot (provides destAppId via baseId)
 * @param {object}   opts.idmap           - live id-map (.tables, .fields, .records, .attachments)
 * @param {object}   opts.limiter         - rate limiter from createLimiter()
 * @param {object}   opts.journal         - journal from newJournal()
 * @param {Function} opts.persist         - persist(idmap, journal) called after each table
 * @param {object}   opts.result          - result accumulator (must include .warnings array and .attachmentsUploaded counter)
 * @param {Function} [opts.fetchBytes]    - async (url) => { bytes, contentType? } (default: real fetch)
 * @param {string}   [opts.policy]         - global preset ('mirror'|'overlay'|'preserve')
 * @param {object}   [opts.policyOverrides]- per-table preset overrides
 * @param {Set<string>} [opts.createdDestIds] - dest row ids CREATED this run (Pass 1); under
 *   conflicts=dest-wins only these rows receive attachment writes — pasteAttachmentsCrossBase
 *   SETS (replaces) the target cell, so a pre-existing mapped dest row must never be included
 *   (dest-added attachments would be destroyed).
 * @returns {Promise<void>}
 */
export async function applyAttachments({
  client,
  srcSnapshot,
  destSnapshot,
  idmap,
  limiter,
  journal,
  persist,
  result,
  fetchBytes = defaultFetchBytes,
  policy,
  policyOverrides,
  createdDestIds = new Set(),
}) {
  // Initialize dedupe map if not already present (survives across calls for idempotency)
  idmap.attachments ??= {};

  const srcAppId = srcSnapshot.baseId || '';
  const destAppId = destSnapshot.baseId || '';

  for (const srcTable of (srcSnapshot.tables || [])) {
    // A session death latched by a prior table aborts the whole job — never start a new table.
    if (client.auth?.isSessionDead?.()) { markAborted(client, result); return; }
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched → skip

    // Conflicts axis: under dest-wins, only rows created THIS run get attachment writes —
    // both the fast-path paste (which wholesale-replaces the target cell) and the fallback.
    const { conflicts } = resolvePolicy(policy, policyOverrides, srcTable.name);
    const destWinsSkip = (destRowId) => conflicts === 'dest-wins' && !createdDestIds.has(destRowId);

    try {
      // Find attachment fields that have a dest mapping
      const attFields = (srcTable.fields || []).filter(
        (f) => ATTACHMENT_TYPES.has(f.type) && idmap.fields[f.id],
      );
      if (attFields.length === 0) continue;

      // Determine a dest viewId for pasteCells (requires a view context)
      // Use the first collaborative (non-personal) view; fall back to first view of any type.
      const destTable = (destSnapshot.tables || []).find((t) => t.id === destTableId);
      const destViews = destTable?.views || [];
      const destViewId = destViews.find((v) => !v.personalForUserId)?.id ?? destViews[0]?.id;
      if (!destViewId) {
        result.warnings.push({
          code: 'ATTACHMENT_FALLBACK',
          message: `Table ${srcTable.id}: no dest view found for pasteCells — falling back to per-attachment upload`,
        });
        // Fall through to fallback for all records/fields in this table
        for (const rec of (srcTable.records || [])) {
          const destRowId = idmap.records[rec.id];
          if (!destRowId) continue;
          if (destWinsSkip(destRowId)) continue; // preserve dest edits on pre-existing rows
          const srcCells = rec.cellValuesByColumnId || {};
          for (const field of attFields) {
            const cellValue = srcCells[field.id];
            if (!cellValue || !Array.isArray(cellValue) || cellValue.length === 0) continue;
            const destFldId = idmap.fields[field.id].destFld;
            for (const att of cellValue) {
              await uploadAttachmentFallback({ client, destAppId, destRowId, destFldId, attachment: att, idmap, result, fetchBytes, limiter });
            }
          }
        }
        persist(idmap, journal);
        continue;
      }

      // Collect included records: must be mapped AND have ≥1 attachment cell.
      // Under dest-wins, pre-existing mapped rows are excluded from BOTH the paste payload
      // and every fallback derived from includedRecs (pasteCells replaces the target cell).
      const includedRecs = [];
      for (const rec of (srcTable.records || [])) {
        const destRowId = idmap.records[rec.id];
        if (!destRowId) continue;
        if (destWinsSkip(destRowId)) continue; // preserve dest edits on pre-existing rows
        const srcCells = rec.cellValuesByColumnId || {};
        const hasAtt = attFields.some((f) => {
          const cv = srcCells[f.id];
          return Array.isArray(cv) && cv.length > 0;
        });
        if (hasAtt) includedRecs.push({ rec, destRowId });
      }

      // Mirror/overlay (source-wins): a source row that CLEARED all its attachments is excluded
      // from includedRecs, so its dest attachment cell is never touched. Attachment CLEARING is a
      // deferred follow-up (like link removal), so surface the gap rather than silently reporting
      // convergence. One warning per table with the count of dest cells left populated.
      if (conflicts === 'source-wins') {
        const destRecCells = new Map((destTable?.records || []).map((r) => [r.id, r.cellValuesByColumnId || {}]));
        let clearCount = 0;
        for (const rec of (srcTable.records || [])) {
          const destRowId = idmap.records[rec.id];
          if (!destRowId) continue;
          const sCells = rec.cellValuesByColumnId || {};
          const dCells = destRecCells.get(destRowId) || {};
          for (const f of attFields) {
            const sv = sCells[f.id];
            const srcEmpty = !Array.isArray(sv) || sv.length === 0;
            const dv = dCells[idmap.fields[f.id].destFld];
            if (srcEmpty && Array.isArray(dv) && dv.length > 0) clearCount++;
          }
        }
        if (clearCount > 0) {
          result.warnings.push({
            code: 'ATTACHMENT_CLEAR_DEFERRED',
            message: `Table ${srcTable.name}: ${clearCount} dest attachment cell(s) not cleared (source emptied them; attachment clearing is deferred — dest not fully mirrored)`,
          });
        }
      }

      if (includedRecs.length === 0) {
        persist(idmap, journal);
        continue;
      }

      // Build fast-path payload arrays
      const sourceColumnConfigs = attFields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        typeOptions: f.typeOptions || {},
      }));
      const targetColumnIds = attFields.map((f) => idmap.fields[f.id].destFld);
      const targetRowIds = includedRecs.map((r) => r.destRowId);
      const sourceRowIds = includedRecs.map((r) => r.rec.id);

      // 2D grid: [rowIdx][colIdx] = attachment array (or [])
      const sourceCellValues2dArray = includedRecs.map(({ rec }) => {
        const srcCells = rec.cellValuesByColumnId || {};
        return attFields.map((f) => {
          const cv = srcCells[f.id];
          return Array.isArray(cv) ? cv : [];
        });
      });

      // Flat list of all attachment location refs for the policy request
      const attachmentIdsWithCellLocation = [];
      for (const { rec } of includedRecs) {
        const srcCells = rec.cellValuesByColumnId || {};
        for (const field of attFields) {
          const cv = srcCells[field.id];
          if (!Array.isArray(cv)) continue;
          for (const att of cv) {
            if (att.id) {
              attachmentIdsWithCellLocation.push({
                rowId: rec.id,
                columnId: field.id,
                attachmentId: att.id,
              });
            }
          }
        }
      }

      if (attachmentIdsWithCellLocation.length === 0) {
        persist(idmap, journal);
        continue;
      }

      // Fast-path: createDataTransferPolicy → pasteAttachmentsCrossBase
      let pasteRes;
      try {
        const policy = await limiter.run(() =>
          withRetry(() =>
            client.createDataTransferPolicy(srcAppId, srcTable.id, attachmentIdsWithCellLocation),
          ),
        );

        pasteRes = await limiter.run(() =>
          withRetry(() =>
            client.pasteAttachmentsCrossBase(destAppId, destTableId, {
              viewId: destViewId,
              sourceAppId: srcAppId,
              sourceTableId: srcTable.id,
              sourceColumnConfigs,
              sourceCellValues2dArray,
              targetRowIds,
              targetColumnIds,
              signedDataTransferPolicy: policy,
              sourceRowIds,
            }),
          ),
        );

        // Count success by pastedRowIds (most reliable signal)
        result.attachmentsUploaded = (result.attachmentsUploaded || 0) +
          (pasteRes.pastedRowIds?.length ?? pasteRes.numUpdatedCells ?? 0);

        // Handle partial skips: fall back per skipped attachment
        if (Array.isArray(pasteRes.skippedAttachments) && pasteRes.skippedAttachments.length > 0) {
          result.warnings.push({
            code: 'ATTACHMENT_FALLBACK',
            message: `Table ${srcTable.id}: ${pasteRes.skippedAttachments.length} attachment(s) skipped by pasteCells — falling back to per-attachment upload`,
          });

          // Build lookup: attachmentId → { rec, field } for fallback
          const attLookup = new Map();
          for (const { rec } of includedRecs) {
            const srcCells = rec.cellValuesByColumnId || {};
            for (const field of attFields) {
              const cv = srcCells[field.id];
              if (!Array.isArray(cv)) continue;
              for (const att of cv) {
                if (att.id) attLookup.set(att.id, { rec, field, att });
              }
            }
          }

          for (const skipped of pasteRes.skippedAttachments) {
            const attId = skipped.attachmentId ?? skipped.id;
            const entry = attLookup.get(attId);
            if (!entry) continue;
            const { rec, field, att } = entry;
            const destRowId = idmap.records[rec.id];
            if (!destRowId) continue;
            const destFldId = idmap.fields[field.id]?.destFld;
            if (!destFldId) continue;
            await uploadAttachmentFallback({ client, destAppId, destRowId, destFldId, attachment: att, idmap, result, fetchBytes, limiter });
          }
        }
      } catch (fastPathErr) {
        // A dead session aborts the whole job — do NOT fall back (every fallback upload would
        // also fail under the dead session, spinning per-attachment ATTACHMENT_FAILED warnings).
        if (sessionDied(client, fastPathErr)) { markAborted(client, result); persist(idmap, journal); return; }
        // Fast-path threw — fall back to per-attachment upload for all included records
        result.warnings.push({
          code: 'ATTACHMENT_FALLBACK',
          message: `Table ${srcTable.id}: fast-path threw (${fastPathErr.message}) — falling back to per-attachment upload`,
        });

        for (const { rec, destRowId } of includedRecs) {
          const srcCells = rec.cellValuesByColumnId || {};
          for (const field of attFields) {
            const cv = srcCells[field.id];
            if (!Array.isArray(cv)) continue;
            const destFldId = idmap.fields[field.id]?.destFld;
            if (!destFldId) continue;
            for (const att of cv) {
              await uploadAttachmentFallback({ client, destAppId, destRowId, destFldId, attachment: att, idmap, result, fetchBytes, limiter });
            }
          }
          // uploadAttachmentFallback swallows its errors — poll the breaker so a mid-fallback
          // session death still aborts instead of spinning through every remaining record.
          if (client.auth?.isSessionDead?.()) { markAborted(client, result); persist(idmap, journal); return; }
        }
      }
    } catch (tableErr) {
      // A dead session aborts; any other unexpected per-table error is a warning (continue-on-failure).
      if (sessionDied(client, tableErr)) { markAborted(client, result); persist(idmap, journal); return; }
      // Top-level per-table guard: never throw out of the loop
      result.warnings.push({
        code: 'ATTACHMENT_FAILED',
        message: `Table ${srcTable.id}: unexpected error — ${tableErr.message}`,
      });
    }

    persist(idmap, journal);
  }
}

/**
 * After records exist, rewrite collaborative view filters whose record refs now resolve.
 *
 * For each source table matched in idmap.tables, for each collaborative view (non-personal)
 * whose config.filters contain a record-ref leaf that resolves in idmap.records:
 *   - Compute remapViewConfig(view.config, idmap).filters
 *   - Call client.updateViewFilters(destApp, destViewId, filters) via limiter + withRetry
 *   - Map source view id -> dest view id via idmap.views[srcViewId]
 *   - Skip views with no resolvable record refs
 *   - Continue-on-failure (VIEW_FILTER_REAPPLY_FAILED warning)
 *   - Bump result.viewFiltersReapplied counter on success
 *
 * @param {object} opts
 * @param {object} opts.client        - AirtableClient instance
 * @param {object} opts.srcSnapshot   - source base snapshot
 * @param {object} opts.destSnapshot  - dest base snapshot
 * @param {object} opts.idmap         - live id-map (.tables, .fields, .records, .views)
 * @param {object} opts.limiter       - rate limiter from createLimiter()
 * @param {object} opts.journal       - journal from newJournal()
 * @param {Function} opts.persist     - persist(idmap, journal) called after each table
 * @param {object} opts.result        - result accumulator { warnings, viewFiltersReapplied }
 * @returns {Promise<void>}
 */
export async function reapplyViewFilters({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result }) {
  const destAppId = destSnapshot.baseId || '';
  const recs = (idmap && idmap.records) || {};

  // applyRecords takes a SCHEMA-ONLY snapshot (no view configs) to avoid a getView storm.
  // Populate SOURCE view live-configs now (source-only, once, at the end) so we can find and
  // remap the record-ref filters. Views that already carry a config are skipped.
  //
  // Each getView is guarded PER VIEW (limiter + retry + catch): this runs at the tail of a
  // multi-minute request-heavy job, and one failed view read (deleted view, 404, session
  // hiccup) must not abort the whole filter restore — the other views still get their
  // record-ref filters back, and the failed one is reported as a warning.
  if (typeof client.getView === 'function') {
    const srcAppId = srcSnapshot.baseId || '';
    for (const t of (srcSnapshot.tables || [])) {
      for (const v of (t.views || [])) {
        if (v.personalForUserId || v.config) continue;
        try {
          const live = await limiter.run(() => withRetry(() => client.getView(srcAppId, v.id)));
          v.config = normalizeViewConfig(live);
        } catch (err) {
          result.warnings.push({
            code: 'VIEW_FILTER_REAPPLY_FAILED',
            message: `View ${v.id}: getView failed during filter restore (${err.message}) — view skipped`,
          });
        }
      }
    }
  }

  for (const srcTable of (srcSnapshot.tables || [])) {
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched -> skip

    for (const sv of (srcTable.views || [])) {
      if (sv.personalForUserId) continue; // skip personal views

      // Check if this view has any record-ref leaves that resolve in idmap.records
      const refIds = collectFilterRecordRefs(sv.config);
      if (refIds.length === 0) continue; // no record refs -> skip

      const hasResolvable = refIds.some((id) => recs[id] !== undefined);
      if (!hasResolvable) continue; // none resolve -> skip

      const destViewId = (idmap.views || {})[sv.id];
      if (!destViewId) continue; // no dest view mapping -> skip

      // Remap the filters (remapRecRefValue with stripUnresolved=true)
      const remapped = remapViewConfig(sv.config || {}, idmap);
      const filters = remapped.filters || { filterSet: [], conjunction: 'and' };

      try {
        await limiter.run(() => withRetry(() => client.updateViewFilters(destAppId, destViewId, filters)));
        result.viewFiltersReapplied = (result.viewFiltersReapplied || 0) + 1;
      } catch (err) {
        result.warnings.push({
          code: 'VIEW_FILTER_REAPPLY_FAILED',
          message: `View ${sv.id} (dest ${destViewId}): reapplyViewFilters threw: ${err.message}`,
        });
      }
    }

    persist(idmap, journal);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// runRecords — core records orchestrator
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Core records orchestrator — drives Pass1 → destDisplayNames → Pass2 → attachments
 * → reapplyViewFilters → pruneRecords. All I/O infrastructure (limiter, journal, persist,
 * result) is supplied by the caller so this function is fully testable without filesystem.
 *
 * Pre-flight: runs validateFieldMappings BEFORE any write. If there are mapping errors,
 * throws an Error with .code = 'FIELD_MAP_INVALID' and .mappingErrors = errors[].
 *
 * @param {object} opts
 * @param {object}   opts.client           - AirtableClient instance
 * @param {object}   opts.srcSnapshot      - source base snapshot (with records attached)
 * @param {object}   opts.destSnapshot     - dest base snapshot (with records attached)
 * @param {object}   opts.idmap            - live id-map (.tables, .fields, .records)
 * @param {string}   [opts.policy]         - global preset ('mirror'|'overlay'|'preserve')
 * @param {object}   [opts.policyOverrides]- per-table preset overrides
 * @param {boolean}  [opts.confirmDeletions] - gate for pruneRecords deletions
 * @param {object}   [opts.fieldMappings]  - raw field mapping config { [table]: { srcName: destName } }
 * @param {object}   [opts.naturalKeys]    - { [tableName]: fieldName } for natural-key matching (optional)
 * @param {object}   opts.limiter          - rate limiter { run: (fn) => fn() }
 * @param {object}   opts.journal          - records journal object
 * @param {Function} opts.persist          - (idmap, journal) => void — called after each phase
 * @param {object}   opts.result           - result accumulator (mutated in place, returned)
 * @returns {Promise<object>}              - the result accumulator
 */
export async function runRecords({ client, srcSnapshot, destSnapshot, idmap, policy, policyOverrides, confirmDeletions, fieldMappings, naturalKeys, limiter, journal, persist, result }) {
  // Pre-flight: validate field mappings BEFORE any write. Abort on error.
  const { errors, resolved } = validateFieldMappings(srcSnapshot, destSnapshot, fieldMappings || {});
  if (errors.length) {
    const err = new Error(`Invalid field mappings: ${errors.map((e) => e.code).join(', ')}`);
    err.code = 'FIELD_MAP_INVALID';
    err.mappingErrors = errors;
    throw err;
  }

  // Record each table's FETCHED row count before any pass runs — Pass 1 mirrors folded-link
  // rows into destSnapshot (mirrorFoldedLinks), and those synthetic entries must not count
  // toward the >=1000 truncation heuristic (collectTruncatedTableNames / pruneRecords).
  for (const t of [...(srcSnapshot.tables || []), ...(destSnapshot.tables || [])]) {
    t.snapshotRowCount ??= (t.records || []).length;
  }

  // Dest row ids created THIS plan — Pass 2/3 use it so conflicts=dest-wins only blocks
  // writes to PRE-EXISTING mapped rows (created rows always get their links/attachments).
  // Seeded from the records journal so a RESUMED job (same planId after a crash) still treats
  // rows created by the crashed run as sync-created: on resume they are already in
  // idmap.records, take Pass 1's dest-wins skip, and would otherwise never re-enter the set —
  // leaving their link/attachment cells permanently empty under preserve. Cross-plan behavior
  // is unchanged (a new planId gets a new journal without createdDestIds).
  const createdDestIds = new Set(Array.isArray(journal?.createdDestIds) ? journal.createdDestIds : []);
  // Mirror the current set into the journal before EVERY persist (incl. Pass 1's per-chunk
  // saves) so a crash mid-run leaves the created ids durable next to idmap.records.
  const persistRun = (m, j) => { j.createdDestIds = [...createdDestIds]; persist(m, j); };

  // Natural-key pre-pass: match real-but-unmapped dest records BEFORE Pass 1 + prune,
  // so Pass 1 updates (not duplicates) them and pruneRecords does not treat them as orphans.
  if (naturalKeys && Object.keys(naturalKeys).length) {
    matchByNaturalKeys({ srcSnapshot, destSnapshot, naturalKeys, idmap, result });
    persistRun(idmap, journal);
  }

  // Pass 1: scalar / select upsert — fills idmap.records
  await applyRecordsPass1({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist: persistRun, result, policy, policyOverrides, fieldMappings: resolved, createdDestIds });
  persistRun(idmap, journal);
  // Session died mid-Pass-1: skip the remaining passes, reapplyViewFilters, AND pruneRecords —
  // a dead/partial session must never reach prune (deleting under a dead session is dangerous).
  if (result.aborted) return result;

  // Rebuild destDisplayNames from idmap.records now populated by Pass 1.
  // Key = dest record id, value = source primary cell value (string).
  const destDisplayNames = new Map();
  for (const srcTable of srcSnapshot.tables) {
    const primaryFieldId = srcTable.primaryFieldId;
    for (const srcRec of (srcTable.records || [])) {
      const destRecId = idmap.records[srcRec.id];
      if (!destRecId) continue;
      const primaryVal = primaryFieldId ? (srcRec.cellValuesByColumnId || {})[primaryFieldId] : undefined;
      destDisplayNames.set(destRecId, primaryVal !== undefined ? String(primaryVal) : '');
    }
  }

  // Pass 2: link cells
  await applyRecordsPass2({ client, srcSnapshot, destSnapshot, idmap, destDisplayNames, limiter, journal, persist: persistRun, result, policy, policyOverrides, createdDestIds });
  persistRun(idmap, journal);
  if (result.aborted) return result; // session died mid-Pass-2 — skip attachments/filters/prune

  // Pass 3: attachments
  await applyAttachments({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist: persistRun, result, policy, policyOverrides, createdDestIds });
  persistRun(idmap, journal);
  if (result.aborted) return result; // session died mid-Pass-3 — skip reapplyViewFilters + prune

  // Honest-failure gate: a run that attempted writes and had ZERO successes AND ZERO skips, with
  // only failures, is a run-wide failure (e.g. a non-SESSION_INVALID hang that the per-pass abort
  // detection doesn't catch). Route it through the same aborted→phase=failed path so it never
  // reports a misleading 'done' with a burned batch, and skip reapplyViewFilters + prune (nothing
  // synced). The skipped===0 guard is critical: a skip-heavy resume run (most rows already
  // mapped/converged → skipped, a few genuine per-record failures, 0 created) must NOT trip this.
  if (!result.aborted && result.failed > 0 && result.created === 0 && result.updated === 0 && result.skipped === 0) {
    result.aborted = true;
    result.abortReason = `RECORDS_ALL_FAILED: all ${result.failed} record write(s) failed with zero successes — a run-wide failure (not classified as a session death). Investigate (see warnings), then re-run mode=apply with the same planId to resume (progress is persisted).`;
    result.warnings.push({ code: 'RECORDS_ALL_FAILED', message: result.abortReason });
    persistRun(idmap, journal);
    return result;
  }

  // Reapply view filters whose record refs now resolve.
  // Defensive guard: a filter-restore failure must NEVER prevent the prune step below —
  // otherwise one tail-step error discards completed passes and skips the extras axis.
  try {
    await reapplyViewFilters({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist: persistRun, result });
  } catch (err) {
    result.warnings.push({
      code: 'VIEW_FILTER_REAPPLY_FAILED',
      message: `reapplyViewFilters failed (${err.message}) — continuing to prune`,
    });
  }
  persistRun(idmap, journal);

  // Extras axis: prune dest-only orphan records under mirror policy
  const truncatedTables = collectTruncatedTableNames(srcSnapshot, destSnapshot);
  for (const name of truncatedTables) {
    result.warnings.push({
      code: 'RECORDS_TRUNCATED',
      message: `Table "${name}": snapshot capped at 1000 rows — records beyond the limit are not synced ` +
        `and mirror deletion is skipped for this table (>1000-row pagination is a follow-up).`,
    });
  }
  // Filtered-view guard: a table whose records were read through a FILTERED view (every
  // collaborative view carries filters — snapshotTableRecords flags it) is a partial row set
  // of unknown extent: hidden source rows are not synced, and hidden dest rows are
  // indistinguishable from orphans/stale mappings. Same false-orphan hazard as truncation,
  // so reuse the truncatedTables guard (no prune, no stale-mapping deletion) and warn loudly.
  // An unfiltered read is a capture-gated follow-up (readQueries only reads through a view).
  const srcTableSet = new Set(srcSnapshot.tables || []);
  for (const t of [...(srcSnapshot.tables || []), ...(destSnapshot.tables || [])]) {
    if (!t.snapshotViewFiltered) continue;
    const side = srcTableSet.has(t) ? 'source' : 'dest';
    result.warnings.push({
      code: 'SNAPSHOT_VIEW_FILTERED',
      message: `Table "${t.name}" (${side}): every collaborative view is filtered — records were read ` +
        `through filtered view "${t.snapshotViewFiltered.viewName ?? t.snapshotViewFiltered.viewId}" and the ` +
        `row set is PARTIAL. Records hidden by the filter are not synced, and mirror deletion is skipped ` +
        `for this table. Add an unfiltered view to sync it fully.`,
    });
    truncatedTables.add(t.name);
  }
  // Final safety net before the DESTRUCTIVE prune step: a session death that a swallowing
  // sub-loop (e.g. attachment fallback on the last table) never surfaced as result.aborted must
  // STILL never reach pruneRecords — deleting under a dead/partial session is dangerous. Re-check
  // the breaker directly here (the per-pass guards cover mid-run; this closes the tail window).
  if (!result.aborted && client.auth?.isSessionDead?.()) markAborted(client, result);
  if (result.aborted) { persistRun(idmap, journal); return result; }

  // Live source record ids: a persisted mapping whose source record no longer exists must not
  // protect its dest row — otherwise mirror never propagates source-side record deletions.
  const liveSourceRecordIds = new Set();
  for (const t of (srcSnapshot.tables || [])) {
    for (const r of (t.records || [])) liveSourceRecordIds.add(r.id);
  }
  await pruneRecords({ client, destSnapshot, idmap, policy, policyOverrides, confirmDeletions, limiter, result, truncatedTables, liveSourceRecordIds });
  persistRun(idmap, journal);

  return result;
}

/**
 * Top-level records phase orchestrator.
 *
 * 1. Loads the converged schema idmap (written by the schema apply phase).
 * 2. Snapshots src + dest schema (no records yet).
 * 3. Attaches records to each table snapshot via snapshotTableRecords.
 *    Emits RECORD_COUNT warning when exactly 1000 rows are returned (possibly truncated).
 * 4. Builds a phase-local rate limiter (~5 req/s; gates inner POSTs) and a records journal.
 * 5. Runs: Pass 1 (scalar/select upsert + fold resolvable links into create) → rebuild
 *          destDisplayNames → Pass 2 (remaining/forward links) → Pass 3 (attachments)
 *          → reapplyViewFilters.
 * 6. Persists idmap (+ journal) after each chunk/phase.
 * 7. Returns a result accumulator.
 *
 * RESUME MODEL: resume is driven by the persisted **idmap.records** + a fresh live dest snapshot —
 * a created row is skipped on re-run because its source id is already mapped, and Pass 2 dedups
 * links against the live dest. The records journal persists `createdDestIds` (dest rows created
 * this plan) so a resume of the SAME planId keeps them dest-wins-writable in Pass 2/3; beyond
 * that it is advisory (no per-record done-gating) — idmap + live re-snapshot are the source of
 * truth. Known limitation:
 * a crash between a create's server-ack and the per-chunk idmap persist can re-create up to one
 * chunk (~50) of rows as duplicates on resume (reconcile existence-prunes + natural-key
 * re-matches by value).
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance
 * @param {string} opts.sourceBaseId    - source base app ID
 * @param {string} opts.destBaseId      - dest base app ID
 * @param {string} opts.planId          - plan ID (used for journal file name)
 * @param {string} opts.runStartedAt    - ISO timestamp of this run start
 * @param {string} [opts.policy]        - global preset ('mirror'|'overlay'|'preserve')
 * @param {object} [opts.policyOverrides] - per-table preset overrides
 * @param {boolean} [opts.confirmDeletions] - gate for pruneRecords deletions
 * @param {object} [opts.fieldMappings] - raw field mapping config { [table]: { srcName: destName } }
 * @param {object} [opts.naturalKeys]   - { [tableName]: fieldName } for natural-key matching (optional)
 * @returns {Promise<object>}           - result accumulator
 */
export async function applyRecords({ client, sourceBaseId, destBaseId, planId, runStartedAt, policy, policyOverrides, confirmDeletions, fieldMappings, naturalKeys }) {
  // 0. Proactive session health (B): the schema phase runs thousands of mutations right before this
  //    and can leave the auth circuit-breaker LATCHED (a browser-free re-auth kept failing / a
  //    throttle 403 never cleared). Un-latch it and probe (browser-free modes re-mint a stale
  //    cookie) so the snapshots + writes below all run on a FRESH, healthy session. Throwing here is
  //    correct and resumable: nothing has been written yet, and applyRecordsImpl's .catch turns the
  //    throw into records-job status:'failed'. Guarded so an older/mocked client without the surface
  //    (Task-1 client.auth.*) simply skips this block instead of crashing.
  if (client.auth?.ensureSessionHealthy) {
    client.auth.resetSessionHealth?.();               // clear a breaker left dead by the schema phase
    const health = await client.auth.ensureSessionHealthy(); // probe + (browser-free) re-mint if stale
    if (!health.healthy) {
      const err = new Error(
        `SESSION_INVALID: session is not healthy at the records-phase start${health.error ? ` (${health.error})` : ''} — ` +
          `re-authenticate, then resume by re-running mode=apply with the same planId (nothing was written yet).`,
      );
      err.code = 'SESSION_INVALID';
      throw err;
    }
  }

  // 1. Load the converged idmap (produced by the schema apply phase)
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  idmap.records ??= {};
  idmap.attachments ??= {};

  // 2. Snapshot schemas ONLY (no per-view live-config reads — those are a getView/readData
  //    storm: ~1s per view, hundreds of views on a view-heavy base, on BOTH bases. The records
  //    phase needs schema + records, not view configs. reapplyViewFilters reads source view
  //    configs lazily, source-only, at the end.)
  const [srcSnapshot, destSnapshot] = await Promise.all([
    snapshotSchemaOnly(client, sourceBaseId),
    snapshotSchemaOnly(client, destBaseId),
  ]);

  // 3. Attach records to each table in both snapshots
  for (const table of srcSnapshot.tables) {
    table.records = await snapshotTableRecords(client, sourceBaseId, table);
  }
  for (const table of destSnapshot.tables) {
    table.records = await snapshotTableRecords(client, destBaseId, table);
  }

  // 4. Infra: rate limiter + journal + persist + result
  // Phase-local pacing. Default ~5 req/s; lower it (AIRTABLE_SYNC_RPS=2) for an account that's
  // throttle-sensitized — Airtable also enforces a per-WINDOW cap that per-second pacing can't dodge,
  // so a recently-abused base may need a slower rate (or a full cooldown) to avoid re-tripping.
  const rps = Number(process.env.AIRTABLE_SYNC_RPS) || 5;
  const limiter = createLimiter({ rps });
  const journal = loadRecordsJournal(sourceBaseId, destBaseId, planId) ?? newJournal(planId, runStartedAt);
  const persist = (m, j) => {
    saveIdmap(sourceBaseId, destBaseId, m);
    saveRecordsJournal(sourceBaseId, destBaseId, j);
  };
  const result = {
    planId,
    aborted: false,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    deleted: 0,
    warnings: [],
    idmap,
  };

  // Pre-flight: emit RECORD_COUNT warning for tables that returned exactly 1000 rows
  // (indicates possible truncation — pagination is a follow-up feature).
  for (const table of srcSnapshot.tables) {
    const count = (table.records || []).length;
    if (count === 1000) {
      result.warnings.push({
        code: 'RECORD_COUNT',
        message: `Table "${table.name}" (${table.id}) has ${count} records; record sync pulls up to 1000 per table — results may be truncated (pagination is a follow-up)`,
      });
    }
  }

  // Delegate the core phases to runRecords
  return runRecords({ client, srcSnapshot, destSnapshot, idmap, policy, policyOverrides, confirmDeletions, fieldMappings, naturalKeys, limiter, journal, persist, result });
}

// ──────────────────────────────────────────────────────────────────────────────
// collectTruncatedTableNames — set-builder for pruneRecords truncation guard
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Table names whose snapshot hit the 1000-row read cap on EITHER side (possibly truncated).
 * Uses `snapshotRowCount` (stamped by runRecords BEFORE Pass 1) when present — the live
 * `.records` array is inflated by mirrorFoldedLinks' synthetic rows during Pass 1, which must
 * not fake a truncation and silently disable mirror prune.
 */
export function collectTruncatedTableNames(srcSnapshot, destSnapshot) {
  const names = new Set();
  for (const t of [...(srcSnapshot?.tables || []), ...(destSnapshot?.tables || [])]) {
    if ((t.snapshotRowCount ?? (t.records || []).length) >= 1000) names.add(t.name);
  }
  return names;
}

// ──────────────────────────────────────────────────────────────────────────────
// pruneRecords — extras axis: delete dest-only orphan records under mirror (gated)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extras axis: delete dest rows no source record maps to, for tables whose policy removes extras.
 * Gated by confirmDeletions — without it, nothing is deleted and a DELETION_GATED warning carries
 * the would-delete count. result.deleted accumulates actual deletions.
 *
 * Orphan detection uses the already-attached snapshot records (`.records` populated by
 * applyRecords → snapshotTableRecords at limit 1000) instead of re-querying. This avoids
 * the silent 100-row cap from queryRecords and the potential for a personal/filtered view.
 * NOTE: tables with >1000 rows are still bounded by the snapshot's limit — consistent with
 * the engine's existing RECORD_COUNT behaviour (pagination is a follow-up).
 *
 * @param {object} opts
 * @param {object}   opts.client           - AirtableClient instance
 * @param {object}   opts.destSnapshot     - dest base snapshot (tables with .records + views)
 * @param {object}   opts.idmap            - live id-map (.tables src→dest, .records srcId→destId)
 * @param {string}   opts.policy           - global preset name ('mirror' | 'overlay' | 'preserve')
 * @param {object}   [opts.policyOverrides]- per-table preset overrides { [tableName]: preset }
 * @param {boolean}  opts.confirmDeletions - if false, gate deletions (push DELETION_GATED warning)
 * @param {object}   opts.limiter          - rate limiter { run: (fn) => fn() }
 * @param {object}   opts.result           - result accumulator (mutated: result.deleted, result.warnings)
 * @param {Set<string>} [opts.truncatedTables] - table names whose snapshot hit the 1000-row cap (skipped to avoid false-orphan deletion)
 * @param {Set<string>} [opts.liveSourceRecordIds] - all record ids present in the SOURCE snapshot; when
 *   provided, a mapping whose source id is absent is STALE (source record deleted) and does not
 *   protect its dest row — the dest row becomes an ordinary orphan (gated + truncation-guarded),
 *   and the stale idmap entry is dropped once the row is actually deleted. Omit (null) to keep
 *   the legacy behaviour where every mapping protects its dest row.
 * @returns {Promise<void>}
 */
export async function pruneRecords({ client, destSnapshot, idmap, policy, policyOverrides, confirmDeletions, limiter, result, truncatedTables = new Set(), liveSourceRecordIds = null }) {
  if (result.deleted == null) result.deleted = 0;
  if (result.failed == null) result.failed = 0;
  if (!result.warnings) result.warnings = [];

  // A mapping protects its dest row only while its SOURCE record is still alive — otherwise
  // mirror could never propagate source deletions (the stale entry shields the row forever).
  // Stale-mapped dest rows fall through to the ordinary orphan path (same confirm gate, same
  // truncation guard); their idmap entries are dropped only after the row is really deleted.
  const mappedDestIds = new Set();
  const staleDestToSrc = new Map(); // destRecId → srcRecId for mappings whose source is gone
  for (const [srcRecId, destRecId] of Object.entries(idmap.records || {})) {
    if (liveSourceRecordIds && !liveSourceRecordIds.has(srcRecId)) staleDestToSrc.set(destRecId, srcRecId);
    else mappedDestIds.add(destRecId);
  }

  // M3 guard: only prune tables that are the dest-side of a matched pair.
  // A dest table whose id is NOT a value in idmap.tables is a dest-only (schema-orphan) table —
  // deleting its rows while keeping the table shell is an inconsistent half-state; skip it.
  const matchedDestTableIds = new Set(Object.values(idmap.tables || {}));

  const DELETE_CHUNK = 50;

  for (const t of (destSnapshot.tables || [])) {
    // M3: skip dest-only tables (not matched to any source table)
    if (!matchedDestTableIds.has(t.id)) continue;

    const { extras } = resolvePolicy(policy, policyOverrides, t.name);
    if (extras !== 'remove') continue;

    // Truncation safety: a table whose snapshot hit the 1000-row cap cannot be safely pruned —
    // unmapped rows may be legitimate records whose source/dest counterpart fell beyond the window.
    // Skip deletion entirely (the >1000-row read is a capture-gated follow-up).
    const isTruncated = truncatedTables.has(t.name) || (t.snapshotRowCount ?? (t.records || []).length) >= 1000;
    if (isTruncated) {
      result.warnings.push({
        code: 'RECORDS_TRUNCATED_PRUNE_SKIPPED',
        message: `Table "${t.name}": snapshot capped at 1000 rows — cannot safely distinguish ` +
          `dest-only orphans from records beyond the limit; skipping mirror deletion to avoid data loss ` +
          `(>1000-row pagination is a follow-up).`,
      });
      continue;
    }

    // Per-table write-failure gate. Deleting dest-only rows in a table whose every
    // write failed destroys the existing data AND leaves nothing in its place — the
    // run-wide RECORDS_ALL_FAILED gate cannot catch it, because one converged row in
    // any other table (counted as `skipped`) disarms it. A FIELD_FORBIDDEN 403 is a
    // per-field permission property, so "every row of exactly one table failed" is a
    // routine outcome, not an exotic one.
    const tableCounts = result.perTable?.[t.name];
    if (tableCounts && tableCounts.failed > 0
        && tableCounts.created === 0 && tableCounts.updated === 0 && tableCounts.skipped === 0) {
      result.warnings.push({
        code: 'RECORDS_FAILED_PRUNE_SKIPPED',
        message: `Table "${t.name}": all ${tableCounts.failed} record write(s) failed — skipping mirror ` +
          `deletion so dest-only rows are not destroyed while their replacement data was never written. ` +
          `Fix the cause (see warnings) and re-run mode=apply with the same planId.`,
      });
      continue;
    }

    // Prefer the first collaborative (non-personal) view; fall back to first view of any type.
    const views = t.views || [];
    const viewId = views.find((v) => !v.personalForUserId)?.id ?? views[0]?.id;

    // Derive orphans from the already-attached snapshot rows (fetched at limit 1000 by applyRecords).
    // Newly-created records are in idmap.records so they are NOT orphans.
    const rows = t.records || [];
    const orphans = rows.map((r) => r.id).filter((id) => !mappedDestIds.has(id));
    if (orphans.length === 0) continue;

    if (!confirmDeletions) {
      result.warnings.push({ code: 'DELETION_GATED', message: `Table "${t.name}": ${orphans.length} dest-only record(s) would be deleted under mirror — re-run with confirmDeletions:true` });
      continue;
    }

    // Chunk deletions (~50 ids per call) — now that the 100-row cap is lifted, orphan counts
    // can be large; deleteRecords sends all ids in one destroyMultipleRows so we batch here.
    for (let i = 0; i < orphans.length; i += DELETE_CHUNK) {
      const chunk = orphans.slice(i, i + DELETE_CHUNK);
      try {
        await limiter.run(() => client.deleteRecords(destSnapshot.baseId, t.id, chunk, { viewId }));
        result.deleted += chunk.length;
        // Drop stale idmap entries whose dest row was just deleted (source already gone).
        for (const id of chunk) {
          const srcRecId = staleDestToSrc.get(id);
          if (srcRecId !== undefined) delete idmap.records[srcRecId];
        }
      } catch (e) {
        result.failed += chunk.length;
        result.warnings.push({ code: 'RECORD_DELETE_FAILED', message: `Table "${t.name}": ${e.message ?? e}` });
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// matchByNaturalKeys — pure natural-key record matching
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Natural-key record matching: add idmap.records entries by matching source→dest records on a
 * key field's VALUE (field id resolved per-base by name). ADD-ONLY + ambiguity-safe — never
 * removes/overwrites a mapping, never claims an already-mapped dest, never guesses → can only
 * protect records (prevent false-orphan deletes / duplicates), never mis-map.
 */
export function matchByNaturalKeys({ srcSnapshot, destSnapshot, naturalKeys, idmap, result }) {
  if (result.matched == null) result.matched = 0;
  if (!result.warnings) result.warnings = [];
  idmap.records ??= {};
  const srcTables = new Map((srcSnapshot.tables || []).map((t) => [t.name, t]));
  const dstTables = new Map((destSnapshot.tables || []).map((t) => [t.name, t]));

  for (const [tableName, keyFieldName] of Object.entries(naturalKeys || {})) {
    if (!keyFieldName) continue;
    const st = srcTables.get(tableName);
    const dt = dstTables.get(tableName);
    const srcKeyId = st?.fields.find((f) => f.name === keyFieldName)?.id;
    const dstKeyId = dt?.fields.find((f) => f.name === keyFieldName)?.id;
    if (!st || !dt || !srcKeyId || !dstKeyId) {
      result.warnings.push({ code: 'NATURAL_KEY_FIELD_MISSING', message: `Table "${tableName}": key field "${keyFieldName}" not found on ${(!st || !srcKeyId) ? 'source' : 'dest'}` });
      continue;
    }

    // dest records grouped by key value (skip empty)
    const destByKey = new Map();
    for (const r of (dt.records || [])) {
      const v = (r.cellValuesByColumnId || {})[dstKeyId];
      if (v == null || v === '') continue;
      const k = String(v);
      if (!destByKey.has(k)) destByKey.set(k, []);
      destByKey.get(k).push(r.id);
    }

    // count unmapped source key values (a value on >1 unmapped source = ambiguous)
    const srcKeyCount = new Map();
    for (const r of (st.records || [])) {
      if (idmap.records[r.id]) continue;
      const v = (r.cellValuesByColumnId || {})[srcKeyId];
      if (v == null || v === '') continue;
      const k = String(v);
      srcKeyCount.set(k, (srcKeyCount.get(k) || 0) + 1);
    }

    const claimed = new Set(Object.values(idmap.records)); // updated as we add
    for (const r of (st.records || [])) {
      if (idmap.records[r.id]) continue;                  // existing mapping wins
      const v = (r.cellValuesByColumnId || {})[srcKeyId];
      if (v == null || v === '') continue;                 // empty key → skip
      const k = String(v);
      if (srcKeyCount.get(k) > 1) {
        result.warnings.push({ code: 'NATURAL_KEY_AMBIGUOUS', message: `Table "${tableName}": key "${k}" on multiple source records — skipped` });
        continue;
      }
      const dests = destByKey.get(k) || [];
      if (dests.length === 0) continue;                    // no dest match → new record (Pass 1 creates)
      if (dests.length > 1) {
        result.warnings.push({ code: 'NATURAL_KEY_AMBIGUOUS', message: `Table "${tableName}": key "${k}" matches multiple dest records — skipped` });
        continue;
      }
      if (claimed.has(dests[0])) continue;                 // single dest already mapped → don't steal
      idmap.records[r.id] = dests[0];
      claimed.add(dests[0]);
      result.matched++;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// reconcile — existence-prune stale idmap.records entries
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile mode: prune stale idmap.records entries.
 *
 * 1. Loads the persisted idmap.
 * 2. Snapshots the DEST base schema only, then pulls dest records for each matched table.
 * 3. Builds a Set of all live dest record IDs across all tables.
 * 4. Drops any idmap.records[src]=dest entry whose dest ID is not present in the snapshot.
 *    SKIPPED entirely (with RECORDS_TRUNCATED_PRUNE_SKIPPED warnings) when any dest table's
 *    snapshot hit the 1000-row cap — a live mapping beyond the window would otherwise be
 *    falsely pruned and re-created as a duplicate on the next apply.
 * 5. Natural-key re-match: snapshots source records and calls matcher to add idmap.records entries by key value.
 * 6. Saves the pruned idmap.
 * 7. Returns a result shaped like { created:0, updated:0, skipped, failed:0, matched, warnings, idmap }.
 *    `skipped` = number of pruned entries. `matched` = number of records matched by natural key.
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance
 * @param {string} opts.sourceBaseId    - source base app ID
 * @param {string} opts.destBaseId      - dest base app ID
 * @param {object} [opts.naturalKeys]   - { [tableName]: fieldName } for re-match (optional)
 * @returns {Promise<object>}           - { created, updated, skipped, failed, warnings, idmap }
 */
export async function reconcile({ client, sourceBaseId, destBaseId, naturalKeys = {} }) {
  // Concurrency guard: reconcile is a load-modify-save of idmap.json — run concurrently with a
  // background records job (mode=apply) on the same pair, both would last-writer-wins clobber
  // the idmap. Same per-pair apply.lock as apply(): throws APPLY_LOCKED while a live holder
  // exists; a stale lock (dead pid) is replaced. Released when reconcile settles (no
  // background phase — reconcile is fully synchronous).
  const releaseLock = acquireApplyLock(sourceBaseId, destBaseId, 'reconcile');
  try {
    return await reconcileLocked({ client, sourceBaseId, destBaseId, naturalKeys });
  } finally {
    releaseLock();
  }
}

async function reconcileLocked({ client, sourceBaseId, destBaseId, naturalKeys }) {
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  idmap.records ??= {};

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    matched: 0,
    warnings: [],
    idmap,
  };

  // Snapshot dest schema + attach records (schema-only — reconcile needs record existence,
  // not view configs; avoids the getView/readData storm).
  const destSnapshot = await snapshotSchemaOnly(client, destBaseId);
  for (const table of destSnapshot.tables) {
    table.records = await snapshotTableRecords(client, destBaseId, table);
  }

  // Truncation guard (same false-orphan class pruneRecords guards with
  // RECORDS_TRUNCATED_PRUNE_SKIPPED): a dest table whose snapshot hit the 1000-row cap may
  // hold live records beyond the read window. A missing dest id cannot be attributed to a
  // table (record ids carry no table info), so ANY truncated dest table makes the whole
  // existence-prune unsafe — pruning a live mapping would make the next apply re-create the
  // record as a duplicate. Skip the prune entirely and warn instead.
  const truncatedDestTables = collectTruncatedTableNames(null, destSnapshot);
  for (const name of truncatedDestTables) {
    result.warnings.push({
      code: 'RECORDS_TRUNCATED_PRUNE_SKIPPED',
      message: `Table "${name}": dest snapshot capped at 1000 rows — a mapping whose dest row lies ` +
        `beyond the window cannot be told apart from a deleted record; skipping reconcile's ` +
        `existence-prune to avoid duplicating live records on the next apply ` +
        `(>1000-row pagination is a follow-up).`,
    });
  }
  // Filtered-view guard (same false-prune class): a dest table whose records were read through
  // a filtered view (snapshotTableRecords found no unfiltered collaborative view) hides live
  // rows from the snapshot — a mapping to a hidden row must not be pruned, or the next apply
  // re-creates the record as a duplicate.
  const filteredDestTables = (destSnapshot.tables || []).filter((t) => t.snapshotViewFiltered);
  for (const t of filteredDestTables) {
    result.warnings.push({
      code: 'SNAPSHOT_VIEW_FILTERED',
      message: `Table "${t.name}" (dest): every collaborative view is filtered — records were read ` +
        `through filtered view "${t.snapshotViewFiltered.viewName ?? t.snapshotViewFiltered.viewId}" and the ` +
        `row set is PARTIAL; skipping reconcile's existence-prune to avoid pruning live mappings. ` +
        `Add an unfiltered view to reconcile this base pair.`,
    });
  }
  if (truncatedDestTables.size > 0 || filteredDestTables.length > 0) {
    // Existence-prune skipped — a missing dest id cannot be attributed to a table, so any
    // partial dest snapshot makes the whole prune unsafe.
  } else {
    // Build set of all live dest record IDs across all tables
    const allLiveDestIds = new Set();
    for (const dt of destSnapshot.tables) {
      for (const r of (dt.records || [])) {
        allLiveDestIds.add(r.id);
      }
    }

    // Existence-prune
    for (const [srcRecId, destRecId] of Object.entries(idmap.records)) {
      if (!allLiveDestIds.has(destRecId)) {
        delete idmap.records[srcRecId];
        result.skipped++;
      }
    }
  }

  // Natural-key re-match: snapshot source schema + records, then call matcher.
  if (Object.keys(naturalKeys).length > 0) {
    const srcSnapshot = await snapshotSchemaOnly(client, sourceBaseId);
    for (const table of srcSnapshot.tables) {
      table.records = await snapshotTableRecords(client, sourceBaseId, table);
    }
    matchByNaturalKeys({ srcSnapshot, destSnapshot, naturalKeys, idmap, result });
  }

  saveIdmap(sourceBaseId, destBaseId, idmap);

  return result;
}
