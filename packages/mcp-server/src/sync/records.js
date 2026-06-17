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

import { coercePass1Cell, partitionLinkValue, linkRecId } from './cells.js';
import { withRetry, createLimiter } from './ratelimit.js';
import { remapViewConfig, collectFilterRecordRefs } from './remap.js';
import { snapshotSchemaOnly, snapshotViews, snapshotTableRecords } from './snapshot.js';
import { loadIdmap, saveIdmap } from './idmap.js';
import { newJournal, loadRecordsJournal, saveRecordsJournal } from './journal.js';

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
export async function applyRecordsPass1({ client, srcSnapshot, destSnapshot, idmap, limiter, journal, persist, result }) {
  if (!idmap.records) idmap.records = {};

  // destAppId comes from the snapshot (set by snapshotBase); fall back to '' for tests that omit it.
  const destAppId = destSnapshot.baseId || '';

  for (const srcTable of (srcSnapshot.tables || [])) {
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
        // CREATE path — multiSelect arrays ARE accepted by createRecords
        const cells = buildCreateCells(srcTable.fields, srcCells, idmap, result.warnings, rec.id);
        createRows.push({ cellValuesByColumnId: cells, sourceKey: rec.id });
      } else {
        // UPDATE path — multiSelect arrays NOT accepted by updateRecords (deferred with warning)
        const cells = buildUpdateCells(srcTable.fields, srcCells, idmap, result.warnings, rec.id);
        updateRows.push({ rowId: destRecId, cellValuesByColumnId: cells });
      }
    }

    // ── CREATE batch ──────────────────────────────────────────────────────
    if (createRows.length > 0) {
      try {
        const res = await limiter.run(() =>
          withRetry(() => client.createRecords(destAppId, destTableId, createRows, {})),
        );
        for (const created of (res.created || [])) {
          idmap.records[created.sourceKey] = created.rowId;
          result.created++;
        }
        for (const failed of (res.failed || [])) {
          result.failed++;
          result.warnings.push({
            code: 'RECORD_CREATE_FAILED',
            message: `Table ${destTableId}: failed to create record (sourceKey=${failed.sourceKey}): ${failed.error}`,
          });
        }
      } catch (err) {
        result.failed += createRows.length;
        result.warnings.push({
          code: 'RECORD_CREATE_FAILED',
          message: `Table ${destTableId}: createRecords threw: ${err.message}`,
        });
      }
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
 * Pass 3 record sync: download source attachments → upload to dest base.
 *
 * For each matched table, for each source field of type `multipleAttachments`
 * that has a dest field mapping, for each source record with a non-empty
 * attachment cell whose src row maps (idmap.records[srcRecId]):
 *   - For each attachment { url, filename, size, type }:
 *     - Dedupe key = `${filename}|${size}`. Skip if already uploaded.
 *     - Fetch bytes from source URL (URLs expire ~2h — must download during run).
 *     - Upload to dest via client.uploadAttachment (rate-limited + retried).
 *     - On {ok:true}: record dedupe key, bump attachmentsUploaded counter.
 *     - On {ok:false} OR thrown fetch error: push ATTACHMENT_FAILED warning, CONTINUE.
 *   - persist(idmap, journal) after each source table.
 *
 * NOTE: {ok:true} from uploadAttachment IS the hosting verification per Task-0 spike.
 * The spike confirmed dest attachment URLs are on dl.airtable.com after a successful upload.
 * No separate per-attachment read-back re-query is performed (that would be an extra network
 * call per attachment; the spike already proved {ok:true} guarantees hosting).
 *
 * @param {object}   opts
 * @param {object}   opts.client          - AirtableClient instance (must have uploadAttachment)
 * @param {object}   opts.srcSnapshot     - source base snapshot (tables with records attached)
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

  const destAppId = destSnapshot.baseId || '';

  for (const srcTable of (srcSnapshot.tables || [])) {
    const destTableId = idmap.tables[srcTable.id];
    if (!destTableId) continue; // table not matched → skip

    // Find attachment fields that have a dest mapping
    const attFields = (srcTable.fields || []).filter(
      (f) => ATTACHMENT_TYPES.has(f.type) && idmap.fields[f.id],
    );
    if (attFields.length === 0) continue;

    for (const rec of (srcTable.records || [])) {
      const destRowId = idmap.records[rec.id];
      if (!destRowId) continue; // src record not yet mapped → skip

      const srcCells = rec.cellValuesByColumnId || {};

      for (const field of attFields) {
        const cellValue = srcCells[field.id];
        if (!cellValue || !Array.isArray(cellValue) || cellValue.length === 0) continue;

        const destFldId = idmap.fields[field.id].destFld;

        for (const attachment of cellValue) {
          const { url, filename, size, type } = attachment;
          if (!url || !filename) continue;

          const dedupeKey = `${filename}|${size}`;
          if (idmap.attachments[dedupeKey]) continue; // already uploaded → skip

          // Fetch bytes from source (URLs expire ~2h)
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
            continue; // next attachment, don't abort the record
          }

          // Upload to dest via limiter + retry
          try {
            const res = await limiter.run(() =>
              withRetry(() =>
                client.uploadAttachment(destAppId, destRowId, destFldId, {
                  bytes,
                  filename,
                  contentType,
                }),
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
              // Don't set dedupe key on failure so a retry run can re-attempt
            }
          } catch (uploadErr) {
            result.warnings.push({
              code: 'ATTACHMENT_FAILED',
              message: `Attachment ${filename}: upload threw — ${uploadErr.message}`,
            });
          }
        }
      }
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
