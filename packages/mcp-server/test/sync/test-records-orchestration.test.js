/**
 * test-records-orchestration.test.js
 *
 * Unit tests for runRecords() — the extracted core orchestrator.
 * Drives runRecords directly so we can supply all infrastructure
 * (limiter, journal, persist, result) without touching the filesystem.
 *
 * Task 7: pre-flight field-mapping validation aborts before any write.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRecords } from '../../src/sync/records.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeClient() {
  const calls = [];
  return {
    calls,
    createRecords:  async (..._a) => { calls.push('create');  return { records: [], created: [] }; },
    updateRecords:  async ()       => { calls.push('update');  return { updated: [], failed: [] }; },
    deleteRecords:  async ()       => { calls.push('delete');  return {}; },
    queryRecords:   async ()       => ({ summary: { rows: [] } }),
    // view methods — shouldn't be reached in abort path
    updateViewFilters:    async () => ({}),
    updateViewGroupLevels: async () => ({}),
    applyViewSorts:       async () => ({}),
    setViewColumns:       async () => ({}),
  };
}

function makeInfra() {
  const journal = {};
  const persisted = [];
  return {
    limiter: { run: (f) => f() },
    journal,
    persist: (...args) => persisted.push(args),
    persisted,
  };
}

function makeResult() {
  return { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
}

// ──────────────────────────────────────────────────────────────────────────────
// Snapshots
// ──────────────────────────────────────────────────────────────────────────────

/** src has: Offers table, two fields: Name(text) and Code(autoNumber) */
function makeSrcSnapshot() {
  return {
    baseId: 'appSRC0000000001',
    tables: [{
      id: 'tSRC01',
      name: 'Offers',
      primaryFieldId: 'fSrcName',
      fields: [
        { id: 'fSrcName', name: 'Name',  type: 'text' },
        { id: 'fSrcCode', name: 'Code',  type: 'autoNumber' },
      ],
      views: [{ id: 'vSrc1', name: 'Grid view', type: 'grid' }],
      records: [],
    }],
  };
}

/** dest has: Offers table, one field: PK(formula) — computed, so mapping to it is invalid */
function makeDestSnapshotWithComputedPK() {
  return {
    baseId: 'appDST0000000001',
    tables: [{
      id: 'tDST01',
      name: 'Offers',
      primaryFieldId: 'fDstPK',
      fields: [
        { id: 'fDstPK', name: 'PK', type: 'formula' },
      ],
      views: [{ id: 'vDst1', name: 'Grid view', type: 'grid' }],
      records: [],
    }],
  };
}

/** dest has: Offers table, writable target field */
function makeDestSnapshotWritable() {
  return {
    baseId: 'appDST0000000002',
    tables: [{
      id: 'tDST02',
      name: 'Offers',
      primaryFieldId: 'fDstName',
      fields: [
        { id: 'fDstName', name: 'Name',  type: 'text' },
        { id: 'fDstLabel', name: 'Label', type: 'text' },
      ],
      views: [{ id: 'vDst2', name: 'Grid view', type: 'grid' }],
      records: [],
    }],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — pre-flight field-mapping validation', () => {
  it('is exported from records.js', () => {
    assert.equal(typeof runRecords, 'function', 'runRecords must be exported');
  });

  it('aborts before any write when a fieldMapping targets a computed (formula) dest field', async () => {
    const client = makeClient();
    const { limiter, journal, persist } = makeInfra();
    const result = makeResult();

    const srcSnapshot  = makeSrcSnapshot();
    const destSnapshot = makeDestSnapshotWithComputedPK();
    const idmap = { tables: { tSRC01: 'tDST01' }, fields: {}, records: {} };

    await assert.rejects(
      () => runRecords({
        client, srcSnapshot, destSnapshot, idmap,
        fieldMappings: { Offers: { Code: 'PK' } },   // Code → PK(formula) — invalid
        limiter, journal, persist, result,
      }),
      (err) => {
        assert.equal(err.code, 'FIELD_MAP_INVALID', 'error code must be FIELD_MAP_INVALID');
        assert.ok(Array.isArray(err.mappingErrors),  '.mappingErrors must be an array');
        assert.ok(err.mappingErrors.length > 0,      '.mappingErrors must be non-empty');
        return true;
      },
      'runRecords must reject with FIELD_MAP_INVALID for computed dest target',
    );

    assert.deepEqual(client.calls, [], 'no client writes should occur before validation completes');
  });

  it('aborts before any write when a fieldMapping references a missing source field', async () => {
    const client = makeClient();
    const { limiter, journal, persist } = makeInfra();
    const result = makeResult();

    const srcSnapshot  = makeSrcSnapshot();
    const destSnapshot = makeDestSnapshotWritable();
    const idmap = { tables: { tSRC01: 'tDST02' }, fields: {}, records: {} };

    await assert.rejects(
      () => runRecords({
        client, srcSnapshot, destSnapshot, idmap,
        fieldMappings: { Offers: { NonExistent: 'Label' } },
        limiter, journal, persist, result,
      }),
      (err) => {
        assert.equal(err.code, 'FIELD_MAP_INVALID');
        assert.ok(err.mappingErrors.some((e) => e.code === 'FIELD_MAP_SOURCE_MISSING'));
        return true;
      },
    );

    assert.deepEqual(client.calls, [], 'no writes should occur for missing source field');
  });

  it('completes without error when fieldMappings is empty (no-op)', async () => {
    const client = makeClient();
    const { limiter, journal, persist } = makeInfra();
    const result = makeResult();

    const srcSnapshot  = makeSrcSnapshot();
    const destSnapshot = makeDestSnapshotWritable();
    // No idmap table match means Pass1/Pass2 find nothing to do — completes cleanly
    const idmap = { tables: {}, fields: {}, records: {} };

    // Should not throw
    const out = await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      fieldMappings: {},
      limiter, journal, persist, result,
    });
    assert.ok(out, 'result should be returned');
  });

  it('completes without error when fieldMappings is omitted (undefined)', async () => {
    const client = makeClient();
    const { limiter, journal, persist } = makeInfra();
    const result = makeResult();

    const srcSnapshot  = makeSrcSnapshot();
    const destSnapshot = makeDestSnapshotWritable();
    const idmap = { tables: {}, fields: {}, records: {} };

    // fieldMappings omitted entirely
    const out = await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      limiter, journal, persist, result,
    });
    assert.ok(out, 'result should be returned');
  });
});
