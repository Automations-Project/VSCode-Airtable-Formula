/**
 * records.js — Pass 1/2: sync scalar + select/multiSelect cells + link cells.
 *              Pass 3 (applyAttachments): download source attachments → upload to dest.
 *
 * For each matched table (those with idmap.tables[srcTableId]):
 *   CREATE path — source record not yet in idmap.records → createRecords, fill idmap.records.
 *   UPDATE path — source record already mapped → updateRecords (primitive + single-select ONLY;
 *                 multiSelect arrays are deferred with a RECORD_ARRAY_UPDATE_DEFERRED warning).
 *
 * All client calls go through `limiter.run(() => withRetry(() => ...))`.
 * Continue-on-failure: per-table errors are caught and pushed as warnings.
 * `persist(idmap, journal)` is called after each batch.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { coercePass1Cell, partitionLinkValue, linkRecId } from './cells.js';
import { withRetry, createLimiter } from './ratelimit.js';
import { remapViewConfig, collectFilterRecordRefs } from './remap.js';
import { snapshotSchemaOnly, snapshotViews, snapshotTableRecords } from './snapshot.js';
import { loadIdmap, saveIdmap, syncDir } from './idmap.js';
import { newJournal, loadRecordsJournal, saveRecordsJournal } from './journal.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

// ── Records-job status file (records-job-<planId>.json) ──
// The records phase is minutes-long for large bases, so apply() launches it in the BACKGROUND
// and returns immediately. Status is persisted to disk (survives process restarts) and polled
// via sync_base mode=status. Progress (records mapped) is derived live from idmap.records.
function recordsJobPath(sourceBaseId, destBaseId, planId) {
  return join(syncDir(sourceBaseId, destBaseId), `records-job-${planId}.json`);
}
export function writeRecordsJobStatus(sourceBaseId, destBaseId, planId, status) {
  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  safeAtomicWriteFileSync(recordsJobPath(sourceBaseId, destBaseId, planId), JSON.stringify({ planId, ...status }, null, 2));
}
export function readRecordsJobStatus(sourceBaseId, destBaseId, planId) {
  const p = recordsJobPath(sourceBaseId, destBaseId, planId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Enable per-request pacing for the records phase, then return a restore fn.
 *
 * Every browser-backed call funnels through the auth queue, which spaces dequeued calls by
 * `auth._rateDelayMs` (default 0 = off). The records phase fires many POSTs (per-row creates +
 * per-item link appends); without pacing they burst past Airtable's ~5 req/s per-base limit and
 * trip the 429/403 backoff (reactive). Defaulting the delay ON (200ms ≈ 5/s, override via
 * AIRTABLE_SYNC_RATE_DELAY_MS) paces the inner POSTs PROACTIVELY so we stay under the limit and
 * don't provoke the abuse detector. Scoped to the phase: restored afterward so interactive MCP
 * tool calls stay snappy. No-op when the client has no auth (tests).
 *
 * @param {object} client
 * @returns {() => void} restore — resets the prior delay
 */
export function applySyncRateDelay(client) {
  const auth = client?.auth;
  if (!auth) return () => {};
  const prev = auth._rateDelayMs;
  const ms = Number(process.env.AIRTABLE_SYNC_RATE_DELAY_MS);
  auth._rateDelayMs = Number.isFinite(ms) && ms > 0 ? ms : 200;
  return () => { auth._rateDelayMs = prev; };
}

/**
 * Returns true if the field type is a multiSelect (arrays not accepted by updateRecords).
 * @param {string} type
 * @returns {boolean}
 */
function isMultiSelect(type) {
  return type === 'multiSelect' || type === 'multipleSelects';
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
function buildCreateCells(srcFields, srcCells, idmap, warnings, srcRecId) {
  const cells = {};
  for (const field of srcFields) {
    const srcVal = srcCells[field.id];
    if (srcVal === undefined) continue;
    const mapping = idmap.fields[field.id];
    if (!mapping) continue; // field not mapped → skip
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
 * Excludes multiSelect arrays (not supported by updateRecords).
 * Pushes RECORD_ARRAY_UPDATE_DEFERRED warnings for skipped multiSelect cells.
 *
 * @param {Array}  srcFields  - source table field descriptors
 * @param {object} srcCells   - source record cellValuesByColumnId
 * @param {object} idmap      - id-map (fields + choices)
 * @param {Array}  warnings   - result.warnings array (mutated)
 * @param {string} srcRecId   - source record id (for warning context)
 * @returns {object}          - dest cellValuesByColumnId (primitives + single-select only)
 */
function buildUpdateCells(srcFields, srcCells, idmap, warnings, srcRecId) {
  const cells = {};
  for (const field of srcFields) {
    const srcVal = srcCells[field.id];
    if (srcVal === undefined) continue;
    const mapping = idmap.fields[field.id];
    if (!mapping) continue; // field not mapped → skip
    // multiSelect arrays are not accepted by updateRecords → defer
    if (isMultiSelect(field.type)) {
      warnings.push({
        code: 'RECORD_ARRAY_UPDATE_DEFERRED',
        message: `Record ${srcRecId}: field ${field.id} is multiSelect — array update deferred (updateRecords does not support arrays)`,
      });
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
    cells[mapping.destFld] = coerced.value;
  }
  return cells;
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
async function createChunkWithFallback({ client, destAppId, destTableId, chunk, idmap, result, limiter, runState, destTableById }) {
  let res;
  try {
    res = await limiter.run(() => withRetry(() => client.createRecords(destAppId, destTableId, chunk, {})));
  } catch (err) {
    result.failed += chunk.length;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: createRecords threw: ${err.message}` });
    return;
  }

  for (const created of (res.created || [])) {
    idmap.records[created.sourceKey] = created.rowId;
    result.created++;
    const row = chunk.find((r) => r.sourceKey === created.sourceKey);
    mirrorFoldedLinks(destTableById, destTableId, created.rowId, row?.linkCells);
  }

  const failed = res.failed || [];
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
    retryRes = await limiter.run(() => withRetry(() => client.createRecords(destAppId, destTableId, stripped, {})));
  } catch (err) {
    result.failed += stripped.length;
    result.warnings.push({ code: 'RECORD_CREATE_FAILED', message: `Table ${destTableId}: retry-without-links threw: ${err.message}` });
    return;
  }
  let rescued = 0;
  for (const created of (retryRes.created || [])) {
    idmap.records[created.sourceKey] = created.rowId; // links NOT folded → Pass 2 adds them (no mirror)
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

export async function applyRecordsPass1({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result }) {
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
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched → skip

    const records = srcTable.records || [];
    if (records.length === 0) continue;

    // Partition into CREATE vs UPDATE batches
    const createRows = [];
    const updateRows = [];

    for (const rec of records) {
      const srcCells = rec.cellValuesByColumnId || {};
      const destRecId = idmap.records[rec.id];

      if (!destRecId) {
        // CREATE path — scalar/select/multiSelect arrays ARE accepted by createRecords.
        const cells = buildCreateCells(srcTable.fields, srcCells, idmap, result.warnings, rec.id);
        // Fold resolvable links (remapped) into the create payload (kills most of Pass 2).
        let linkCells = {};
        if (runState.foldLinks) {
          linkCells = buildResolvableLinkCells(srcTable.fields, srcCells, idmap);
          Object.assign(cells, linkCells);
        }
        createRows.push({ cellValuesByColumnId: cells, sourceKey: rec.id, linkCells });
      } else {
        // UPDATE path — multiSelect arrays NOT accepted by updateRecords (deferred with warning)
        const cells = buildUpdateCells(srcTable.fields, srcCells, idmap, result.warnings, rec.id);
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
      await createChunkWithFallback({ client, destAppId, destTableId, chunk, idmap, result, limiter, runState, destTableById });
      persist(idmap, journal);
    }

    // ── UPDATE batch ──────────────────────────────────────────────────────
    if (updateRows.length > 0) {
      try {
        const res = await limiter.run(() =>
          withRetry(() => client.updateRecords(destAppId, destTableId, updateRows)),
        );
        result.updated += (res.updated || []).length;
        for (const failed of (res.failed || [])) {
          result.failed++;
          result.warnings.push({
            code: 'RECORD_UPDATE_FAILED',
            message: `Table ${destTableId}: failed to update record (rowId=${failed.rowId}): ${failed.error}`,
          });
        }
      } catch (err) {
        result.failed += updateRows.length;
        result.warnings.push({
          code: 'RECORD_UPDATE_FAILED',
          message: `Table ${destTableId}: updateRecords threw: ${err.message}`,
        });
      }
      persist(idmap, journal);
    }
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
 * @returns {Promise<void>}
 */
export async function applyRecordsPass2({ client, srcSnapshot, destSnapshot, idmap, destDisplayNames, limiter, journal, persist, result }) {
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
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue;

    // Find all link fields in this source table that have a dest mapping
    const linkFields = (srcTable.fields || []).filter(
      (f) => (f.type === 'multipleRecordLinks' || f.type === 'foreignKey') && idmap.fields[f.id],
    );
    if (linkFields.length === 0) continue;

    const destRecMap = destLinkIndex.get(destTableId) || new Map();

    for (const rec of (srcTable.records || [])) {
      const destRowId = idmap.records[rec.id];
      if (!destRowId) continue; // src row not yet mapped → skip

      const srcCells = rec.cellValuesByColumnId || {};
      const destCells = destRecMap.get(destRowId) || {};

      for (const field of linkFields) {
        const srcVal = srcCells[field.id];
        if (!srcVal || (Array.isArray(srcVal) && srcVal.length === 0)) continue;

        const mapping = idmap.fields[field.id];
        const destFldId = mapping.destFld;

        // Partition: resolved → dest rec ids; unresolved → src rec ids with no mapping
        const { resolved, unresolved } = partitionLinkValue(srcVal, idmap);

        // Warn for unresolved (one warning per field+record, count in message)
        if (unresolved.length > 0) {
          result.warnings.push({
            code: 'RECORD_LINK_UNRESOLVED',
            message: `Record ${rec.id} field ${field.id}: ${unresolved.length} linked record(s) could not be resolved (no dest mapping): ${unresolved.join(', ')}`,
          });
        }

        if (resolved.length === 0) continue;

        // Dedup against current dest links
        // Map link-cell elements through linkRecId to handle both string and object shapes
        const currentLinks = destCells[destFldId];
        const currentLinkIds = (Array.isArray(currentLinks) ? currentLinks : []).map(linkRecId).filter(Boolean);
        const alreadyPresent = new Set(currentLinkIds);
        const toAdd = resolved.filter((id) => !alreadyPresent.has(id));
        if (toAdd.length === 0) continue;

        const items = toAdd.map((destRec) => ({
          foreignRowId: destRec,
          foreignRowDisplayName: destDisplayNames.get(destRec) ?? '',
        }));

        try {
          const res = await limiter.run(() =>
            withRetry(() => client.addLinkItems(destAppId, destRowId, destFldId, items)),
          );
          if (!res.ok) {
            result.warnings.push({
              code: 'RECORD_LINK_FAILED',
              message: `Record ${rec.id} field ${field.id} → dest row ${destRowId}: addLinkItems failed: ${res.error}`,
            });
          } else {
            result.updated++;
          }
        } catch (err) {
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

  const dedupeKey = `${filename}|${size}`;
  if (idmap.attachments[dedupeKey]) return; // already uploaded

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
}) {
  // Initialize dedupe map if not already present (survives across calls for idempotency)
  idmap.attachments ??= {};

  const srcAppId = srcSnapshot.baseId || '';
  const destAppId = destSnapshot.baseId || '';

  for (const srcTable of (srcSnapshot.tables || [])) {
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched → skip

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

      // Collect included records: must be mapped AND have ≥1 attachment cell
      const includedRecs = [];
      for (const rec of (srcTable.records || [])) {
        const destRowId = idmap.records[rec.id];
        if (!destRowId) continue;
        const srcCells = rec.cellValuesByColumnId || {};
        const hasAtt = attFields.some((f) => {
          const cv = srcCells[f.id];
          return Array.isArray(cv) && cv.length > 0;
        });
        if (hasAtt) includedRecs.push({ rec, destRowId });
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
        }
      }
    } catch (tableErr) {
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
  // remap the record-ref filters. If configs are already present this is a no-op-ish refresh.
  if (typeof client.getView === 'function') {
    const needsConfig = (srcSnapshot.tables || []).some((t) => (t.views || []).some((v) => !v.personalForUserId && !v.config));
    if (needsConfig) await snapshotViews(client, srcSnapshot.baseId || '', srcSnapshot);
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
// applyRecords — top-level orchestrator
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Top-level records phase orchestrator.
 *
 * 1. Loads the converged schema idmap (written by the schema apply phase).
 * 2. Snapshots src + dest schema (no records yet).
 * 3. Attaches records to each table snapshot via snapshotTableRecords.
 *    Emits RECORD_COUNT warning when exactly 1000 rows are returned (possibly truncated).
 * 4. Builds a rate limiter and records journal (resumable).
 * 5. Runs: Pass 1 (scalar/select upsert) → rebuild destDisplayNames → Pass 2 (links)
 *          → Pass 3 (attachments) → reapplyViewFilters.
 * 6. Persists idmap + journal after each phase.
 * 7. Returns a result accumulator.
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance
 * @param {string} opts.sourceBaseId    - source base app ID
 * @param {string} opts.destBaseId      - dest base app ID
 * @param {string} opts.planId          - plan ID (used for journal file name)
 * @param {string} opts.runStartedAt    - ISO timestamp of this run start
 * @returns {Promise<object>}           - result accumulator
 */
export async function applyRecords({ client, sourceBaseId, destBaseId, planId, runStartedAt }) {
  // 1. Load the converged idmap (produced by the schema apply phase)
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  idmap.records ??= {};
  idmap.attachments ??= {};

  // Pace every POST in this phase under ~5 req/s (proactive); restored in finally.
  const restoreRateDelay = applySyncRateDelay(client);
  try {

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
  const limiter = createLimiter({ rps: 5 });
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

  // 5a. Pass 1: scalar / select upsert — fills idmap.records
  await applyRecordsPass1({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result });
  persist(idmap, journal);

  // 5b. Rebuild destDisplayNames from idmap.records now populated by Pass 1.
  //     Key = dest record id, value = source primary cell value (string).
  //     The source primary string is the correct display name because dest content mirrors source.
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

  // 5c. Pass 2: link cells
  await applyRecordsPass2({ client, srcSnapshot, destSnapshot, idmap, destDisplayNames, limiter, journal, persist, result });
  persist(idmap, journal);

  // 5d. Pass 3: attachments
  await applyAttachments({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result });
  persist(idmap, journal);

  // 5e. Reapply view filters whose record refs now resolve
  await reapplyViewFilters({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result });
  persist(idmap, journal);

  return result;
  } finally {
    restoreRateDelay();
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
 * 5. naturalKeys re-match is stubbed (emits warning when provided — extend when needed).
 * 6. Saves the pruned idmap.
 * 7. Returns a result shaped like { created:0, updated:0, skipped, failed:0, warnings, idmap }.
 *    `skipped` = number of pruned entries.
 *
 * @param {object} opts
 * @param {object} opts.client          - AirtableClient instance
 * @param {string} opts.sourceBaseId    - source base app ID
 * @param {string} opts.destBaseId      - dest base app ID
 * @param {object} [opts.naturalKeys]   - { [tableName]: fieldName } for re-match (optional)
 * @returns {Promise<object>}           - { created, updated, skipped, failed, warnings, idmap }
 */
export async function reconcile({ client, sourceBaseId, destBaseId, naturalKeys = {} }) {
  const idmap = loadIdmap(sourceBaseId, destBaseId);
  idmap.records ??= {};

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    warnings: [],
    idmap,
  };

  // Snapshot dest schema + attach records (schema-only — reconcile needs record existence,
  // not view configs; avoids the getView/readData storm).
  const destSnapshot = await snapshotSchemaOnly(client, destBaseId);
  for (const table of destSnapshot.tables) {
    table.records = await snapshotTableRecords(client, destBaseId, table);
  }

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

  // naturalKeys re-match (stub: emit warning for each non-empty key)
  for (const [tableName, fieldName] of Object.entries(naturalKeys)) {
    if (fieldName) {
      result.warnings.push({
        code: 'RECONCILE_NATURAL_KEY_NOT_IMPLEMENTED',
        message: `naturalKeys re-match for table "${tableName}" (field "${fieldName}") is not yet implemented`,
      });
    }
  }

  saveIdmap(sourceBaseId, destBaseId, idmap);

  return result;
}
