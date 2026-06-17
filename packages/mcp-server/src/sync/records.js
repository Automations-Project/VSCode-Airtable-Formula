/**
 * records.js — Pass 1: sync scalar + select/multiSelect cells.
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

import { coercePass1Cell } from './cells.js';
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
