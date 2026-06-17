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
import { withRetry } from './ratelimit.js';

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
