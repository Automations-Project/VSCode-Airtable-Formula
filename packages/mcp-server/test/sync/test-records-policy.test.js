/**
 * test-records-policy.test.js
 *
 * Tests for Pass 1 conflict-policy integration in applyRecordsPass1.
 * Fixtures (fakeClient, noLimiter, baseSnap, srcSnap) are kept reusable
 * for Task 5 and Task 6 which append more tests to this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1, pruneRecords, collectTruncatedTableNames, runRecords } from '../../src/sync/records.js';

export function fakeClient() {
  const calls = { create: [], update: [] };
  return {
    calls,
    async createRecords(appId, tableId, rows) {
      calls.create.push({ tableId, rows });
      return { records: rows.map((r, i) => ({ id: 'recD' + i })), created: rows.map((r, i) => ({ id: 'recD' + i })) };
    },
    async updateRecords(appId, tableId, rows) {
      calls.update.push({ tableId, rows });
      return { updated: rows, failed: [] };
    },
  };
}

export const noLimiter = { run: (fn) => fn() };

export const baseSnap = () => ({
  baseId: 'appD',
  tables: [{ id: 'tD', name: 'Games', fields: [{ id: 'dN', name: 'Name', type: 'text' }] }],
});

export function srcSnap() {
  return {
    baseId: 'appS',
    tables: [{
      id: 'tS',
      name: 'Games',
      primaryFieldId: 'sN',
      fields: [{ id: 'sN', name: 'Name', type: 'text' }],
      records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'Zelda' } }],
    }],
  };
}

describe('Pass1 field mapping (injection)', () => {
  it('writes a computed source value into a scalar dest field on CREATE', async () => {
    const client = fakeClient();
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'Offers', primaryFieldId: 'sN',
      fields: [{ id: 'sN', name: 'Name', type: 'text' }, { id: 'sCode', name: 'Code', type: 'autoNumber' }],
      records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'A', sCode: 1042 } }] }] };
    const dst = { baseId: 'appD', tables: [{ id: 'tD', name: 'Offers',
      fields: [{ id: 'dN', name: 'Name', type: 'text' }, { id: 'dInject', name: 'InjectID', type: 'number' }] }] };
    const idmap = { tables: { tS: 'tD' }, fields: { sN: { destFld: 'dN', choices: {} } }, records: {} };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    const fieldMappings = [{ table: 'Offers', srcFieldId: 'sCode', destFieldId: 'dInject', destType: 'number' }];
    await applyRecordsPass1({ client, srcSnapshot: src, destSnapshot: dst, idmap, limiter: noLimiter, journal: {}, persist: () => {}, result, fieldMappings });
    const created = client.calls.create[0].rows[0].cellValuesByColumnId;
    assert.equal(created.dInject, 1042, 'source Code value injected into dest InjectID');
  });
});

describe('Pass1 conflict policy', () => {
  it('dest-wins (preserve) skips updating an already-mapped record', async () => {
    const client = fakeClient();
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} } },
      records: { recS1: 'recD_existing' },
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client,
      srcSnapshot: srcSnap(),
      destSnapshot: baseSnap(),
      idmap,
      limiter: noLimiter,
      journal: {},
      persist: () => {},
      result,
      policy: 'preserve',
    });
    assert.equal(client.calls.update.length, 0, 'no update under preserve');
  });

  it('source-wins (overlay) updates the mapped record', async () => {
    const client = fakeClient();
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} } },
      records: { recS1: 'recD_existing' },
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client,
      srcSnapshot: srcSnap(),
      destSnapshot: baseSnap(),
      idmap,
      limiter: noLimiter,
      journal: {},
      persist: () => {},
      result,
      policy: 'overlay',
    });
    assert.equal(client.calls.update.length, 1, 'one update under overlay');
  });
});

// ── Task 6: pruneRecords (extras axis) ───────────────────────────────────────

// pruneClient: rows are now supplied on destSnapshot.tables[].records, NOT via queryRecords.
// deleteRecords is still mocked; queryRecords is omitted (pruneRecords no longer calls it).
function pruneClient() {
  const calls = { deleted: [] };
  return {
    calls,
    async deleteRecords(appId, tableId, rowIds) { calls.deleted.push({ tableId, rowIds }); return { deleted: rowIds.length }; },
  };
}

// destSnap2: table carries .records so pruneRecords can derive orphans without re-querying.
const destSnap2 = () => ({
  baseId: 'appD',
  tables: [{
    id: 'tD',
    name: 'Games',
    views: [{ id: 'viwD' }],
    fields: [],
    records: [{ id: 'recKeep', cellValuesByColumnId: {} }, { id: 'recOrphan', cellValuesByColumnId: {} }],
  }],
});

describe('pruneRecords (extras axis)', () => {
  it('mirror + confirmDeletions deletes orphan dest rows (not in idmap.records)', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.deepEqual(client.calls.deleted, [{ tableId: 'tD', rowIds: ['recOrphan'] }]);
    assert.equal(result.deleted, 1);
  });
  it('mirror WITHOUT confirmDeletions deletes nothing + warns DELETION_GATED', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'mirror', confirmDeletions: false, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0);
    const w = result.warnings.find((x) => x.code === 'DELETION_GATED');
    assert.ok(w && /1/.test(w.message), 'gated warning with count 1');
  });
  it('keep/preserve table is never pruned', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'overlay', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0);
  });
  it('deletion failure with missing result.failed/warnings guards against NaN and throw', async () => {
    // Table has one orphan row in .records (not in idmap.records → orphan); deleteRecords throws.
    const destSnapWithOrphan = {
      baseId: 'appD',
      tables: [{
        id: 'tD',
        name: 'Games',
        views: [{ id: 'viwD' }],
        fields: [],
        records: [{ id: 'recOrphan', cellValuesByColumnId: {} }],
      }],
    };
    const failingClient = {
      calls: { deleted: [] },
      async deleteRecords() { throw new Error('delete failed'); },
    };
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} }; // empty records → orphan exists
    const result = { deleted: 0 }; // omit failed and warnings — guards against NaN/throw
    await pruneRecords({
      client: failingClient,
      destSnapshot: destSnapWithOrphan,
      idmap,
      policy: 'mirror',
      confirmDeletions: true,
      limiter: { run: (fn) => fn() },
      result,
    });
    assert.equal(typeof result.failed, 'number', 'result.failed is a number');
    assert.ok(!Number.isNaN(result.failed), 'result.failed is not NaN');
    assert.ok(Array.isArray(result.warnings), 'result.warnings is an array');
    const deleteFailedWarning = result.warnings.find((w) => w.code === 'RECORD_DELETE_FAILED');
    assert.ok(deleteFailedWarning, 'RECORD_DELETE_FAILED warning present');
  });

  // M3: a dest table whose id is NOT a value in idmap.tables is NOT pruned, even under mirror+confirmDeletions.
  it('M3: dest-only table (not matched to any source table) is never pruned', async () => {
    // tD2 is a dest-only table — its id does not appear in idmap.tables values.
    const destSnapDestOnly = {
      baseId: 'appD',
      tables: [{
        id: 'tD2',
        name: 'DestOnly',
        views: [{ id: 'viwD2' }],
        fields: [],
        records: [{ id: 'recX', cellValuesByColumnId: {} }],
      }],
    };
    const client = pruneClient();
    // idmap.tables maps tS → tD (a different table), so tD2 is not matched.
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnapDestOnly, idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0, 'no deleteRecords call for a dest-only table');
    assert.equal(result.deleted, 0);
  });

  // ── Task 1: truncation guard ─────────────────────────────────────────────────

  // (1) THE FIX — mirror + confirmDeletions + DEST table at 1000 rows → no delete + skip warning
  it('mirror skips a DEST-truncated table (1000 rows) instead of deleting orphans', async () => {
    const client = pruneClient();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `recD${i}`, cellValuesByColumnId: {} }));
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [], records: rows }] };
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} }; // 0 mapped → all 1000 would be orphans
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot, idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0, 'deleteRecords never called');
    assert.equal(result.deleted, 0);
    assert.ok(result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'));
  });

  // (2) source-side truncation supplied via the truncatedTables set (dest rows < 1000)
  it('mirror skips a table named in truncatedTables even when dest rows < 1000', async () => {
    const client = pruneClient();
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tD', name: 'SrcBig', views: [{ id: 'viwD' }], fields: [], records: [{ id: 'recD0', cellValuesByColumnId: {} }] }] };
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot, idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result, truncatedTables: new Set(['SrcBig']) });
    assert.equal(client.calls.deleted.length, 0);
    assert.ok(result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'));
  });

  // (3) regression — NON-truncated table still prunes its orphan (use destSnap2(): recKeep mapped, recOrphan not)
  it('mirror still deletes orphans on a NON-truncated table', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.deepEqual(client.calls.deleted, [{ tableId: 'tD', rowIds: ['recOrphan'] }]);
    assert.ok(!result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'));
  });

  // (4) overlay + truncated table → no truncation-skip warning (guard sits AFTER the extras check)
  it('overlay + truncated table emits NO truncation-skip warning', async () => {
    const client = pruneClient();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `recD${i}`, cellValuesByColumnId: {} }));
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [], records: rows }] };
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot, idmap, policy: 'overlay', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.ok(!result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'));
  });

  // Delete chunking: >50 orphans should produce multiple deleteRecords calls of ≤50 each.
  it('>50 orphans produce multiple delete chunks of ≤50 ids each', async () => {
    // 75 dest records; none in idmap.records → all are orphans.
    const allRecords = Array.from({ length: 75 }, (_, i) => ({ id: `recOrphan${i}`, cellValuesByColumnId: {} }));
    const destSnapLarge = {
      baseId: 'appD',
      tables: [{
        id: 'tD',
        name: 'Games',
        views: [{ id: 'viwD' }],
        fields: [],
        records: allRecords,
      }],
    };
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: {} };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnapLarge, idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    // 75 orphans → 2 chunks (50 + 25)
    assert.equal(client.calls.deleted.length, 2, 'two deleteRecords chunks for 75 orphans');
    assert.equal(client.calls.deleted[0].rowIds.length, 50, 'first chunk has 50 ids');
    assert.equal(client.calls.deleted[1].rowIds.length, 25, 'second chunk has 25 ids');
    assert.equal(result.deleted, 75, 'all 75 orphans counted as deleted');
  });
});

// ── Source-deletion propagation: stale idmap entries must not protect dest rows ──

// Dest table with two rows: recKeep (mapped, source alive) + recStale (mapped, source DELETED).
const destSnapStale = () => ({
  baseId: 'appD',
  tables: [{
    id: 'tD',
    name: 'Games',
    views: [{ id: 'viwD' }],
    fields: [],
    records: [{ id: 'recKeep', cellValuesByColumnId: {} }, { id: 'recStale', cellValuesByColumnId: {} }],
  }],
});

describe('pruneRecords — source-deletion propagation (stale idmap entries)', () => {
  it('mirror + confirmDeletions deletes a dest row whose SOURCE record was deleted and drops the stale mapping', async () => {
    const client = pruneClient();
    // recSGone's source record no longer exists (not in liveSourceRecordIds)
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep', recSGone: 'recStale' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({
      client, destSnapshot: destSnapStale(), idmap, policy: 'mirror', confirmDeletions: true,
      limiter: noLimiter, result, liveSourceRecordIds: new Set(['recS1']),
    });
    assert.deepEqual(client.calls.deleted, [{ tableId: 'tD', rowIds: ['recStale'] }], 'stale-mapped dest row deleted');
    assert.equal(result.deleted, 1);
    assert.equal(idmap.records.recSGone, undefined, 'stale idmap entry dropped after deletion');
    assert.equal(idmap.records.recS1, 'recKeep', 'live mapping kept');
  });

  it('does NOT delete stale-mapped rows in a truncated table (source may lie beyond the cap)', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep', recSGone: 'recStale' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({
      client, destSnapshot: destSnapStale(), idmap, policy: 'mirror', confirmDeletions: true,
      limiter: noLimiter, result, liveSourceRecordIds: new Set(['recS1']), truncatedTables: new Set(['Games']),
    });
    assert.equal(client.calls.deleted.length, 0, 'no deletion on a truncated table');
    assert.equal(idmap.records.recSGone, 'recStale', 'stale mapping kept when table truncated');
    assert.ok(result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'));
  });

  it('overlay (keep policy) never deletes stale-mapped rows nor drops the mapping', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep', recSGone: 'recStale' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({
      client, destSnapshot: destSnapStale(), idmap, policy: 'overlay', confirmDeletions: true,
      limiter: noLimiter, result, liveSourceRecordIds: new Set(['recS1']),
    });
    assert.equal(client.calls.deleted.length, 0);
    assert.equal(idmap.records.recSGone, 'recStale', 'mapping untouched under keep policy');
  });

  it('mirror WITHOUT confirmDeletions gates the stale-mapped row (counted, not deleted, mapping kept)', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep', recSGone: 'recStale' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({
      client, destSnapshot: destSnapStale(), idmap, policy: 'mirror', confirmDeletions: false,
      limiter: noLimiter, result, liveSourceRecordIds: new Set(['recS1']),
    });
    assert.equal(client.calls.deleted.length, 0);
    const w = result.warnings.find((x) => x.code === 'DELETION_GATED');
    assert.ok(w && /1/.test(w.message), 'gated warning counts the stale-mapped row');
    assert.equal(idmap.records.recSGone, 'recStale', 'mapping kept while gated');
  });

  it('back-compat: without liveSourceRecordIds every mapping still protects its dest row', async () => {
    const client = pruneClient();
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep', recSGone: 'recStale' } };
    const result = { deleted: 0, failed: 0, warnings: [] };
    await pruneRecords({
      client, destSnapshot: destSnapStale(), idmap, policy: 'mirror', confirmDeletions: true,
      limiter: noLimiter, result,
    });
    assert.equal(client.calls.deleted.length, 0, 'no liveSourceRecordIds → all mapped rows protected');
    assert.equal(idmap.records.recSGone, 'recStale');
  });
});

// ── Task 2: collectTruncatedTableNames helper ────────────────────────────────

describe('collectTruncatedTableNames', () => {
  it('names any table at the 1000 cap on either side', () => {
    const big = (name) => ({ id: 'tbl' + name, name, records: Array.from({ length: 1000 }, (_, i) => ({ id: 'r' + i })) });
    const small = (name) => ({ id: 'tbl' + name, name, records: [{ id: 'r0' }] });
    const src = { tables: [big('A'), small('B')] };
    const dest = { tables: [small('A'), big('C')] };
    const set = collectTruncatedTableNames(src, dest);
    assert.deepEqual([...set].sort(), ['A', 'C']);
  });

  it('prefers snapshotRowCount over live records length (folded synthetic rows must not count)', () => {
    // mirrorFoldedLinks pushes synthetic rows into destTable.records during Pass 1 — the
    // truncation heuristic must reflect the FETCHED row count, not the inflated live array.
    const inflated = {
      id: 'tblI', name: 'Inflated', snapshotRowCount: 400,
      records: Array.from({ length: 1100 }, (_, i) => ({ id: 'r' + i })),
    };
    const genuinelyBig = {
      id: 'tblG', name: 'Big', snapshotRowCount: 1000,
      records: Array.from({ length: 1000 }, (_, i) => ({ id: 'g' + i })),
    };
    const set = collectTruncatedTableNames({ tables: [] }, { tables: [inflated, genuinelyBig] });
    assert.equal(set.has('Inflated'), false, 'inflated-but-not-truncated table must not be flagged');
    assert.ok(set.has('Big'), 'genuinely capped table still flagged');
  });
});

// ── runRecords integration: prune threading ─────────────────────────────────

// Combined mock client for runRecords: creates succeed (rowId per sourceKey), updates succeed,
// deletions recorded.
function runClient() {
  const calls = { deleted: [], created: [], updated: [] };
  return {
    calls,
    async createRecords(appId, tableId, rows) {
      const created = rows.map((r, i) => {
        const rowId = 'recNew_' + r.sourceKey;
        calls.created.push({ tableId, rowId, sourceKey: r.sourceKey });
        return { rowId, sourceKey: r.sourceKey };
      });
      return { created, failed: [] };
    },
    async updateRecords(appId, tableId, rows) { calls.updated.push({ tableId, rows }); return { updated: rows, failed: [] }; },
    async deleteRecords(appId, tableId, rowIds) { calls.deleted.push({ tableId, rowIds }); return { deleted: rowIds.length }; },
    async addLinkItems() { return { ok: true, added: 1 }; },
    async updateViewFilters() { return { ok: true }; },
  };
}

describe('runRecords — prune integration', () => {
  it('mirror prune still runs when folded-link mirroring pushes dest records past 1000', async () => {
    // Dest starts with 990 FETCHED rows: recD0 (mapped) + 989 orphans.
    // Src: recS0 (mapped) + 20 new records each linking to recS0 → creates fold links,
    // mirrorFoldedLinks pushes 20 synthetic rows → live dest records array = 1010.
    // Truncation detection must use the fetched count (990), NOT the inflated live length.
    const destRows = [{ id: 'recD0', cellValuesByColumnId: {} }]
      .concat(Array.from({ length: 989 }, (_, i) => ({ id: `recOrphan${i}`, cellValuesByColumnId: {} })));
    const destSnapshot = {
      baseId: 'appD',
      tables: [{ id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [], records: destRows }],
    };
    const srcRecords = [{ id: 'recS0', cellValuesByColumnId: { sN: 'zero' } }]
      .concat(Array.from({ length: 20 }, (_, i) => ({
        id: `recSNew${i}`, cellValuesByColumnId: { sN: `new${i}`, sL: ['recS0'] },
      })));
    const srcSnapshot = {
      baseId: 'appS',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        fields: [
          { id: 'sN', name: 'Name', type: 'text' },
          { id: 'sL', name: 'Self', type: 'foreignKey', typeOptions: { foreignTableId: 'tS' } },
        ],
        views: [],
        records: srcRecords,
      }],
    };
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} }, sL: { destFld: 'dL' } },
      records: { recS0: 'recD0' },
    };
    const client = runClient();
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter: noLimiter, journal: {}, persist: () => {}, result,
    });
    assert.equal(result.created, 20, 'all 20 new records created');
    assert.ok(!result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED_PRUNE_SKIPPED'),
      'no false truncation-skip warning from mirrored synthetic rows');
    assert.ok(!result.warnings.some((w) => w.code === 'RECORDS_TRUNCATED'),
      'no false RECORDS_TRUNCATED warning from mirrored synthetic rows');
    assert.equal(result.deleted, 989, 'all real orphans pruned under mirror+confirm');
  });

  it('threads live source ids: a source-deleted record is pruned under mirror+confirm and its mapping dropped', async () => {
    // Source only has recS1; idmap still maps recSGone → recStale (source record deleted).
    const srcSnapshot = {
      baseId: 'appS',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        fields: [{ id: 'sN', name: 'Name', type: 'text' }],
        views: [],
        records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'Zelda' } }],
      }],
    };
    const destSnapshot = {
      baseId: 'appD',
      tables: [{
        id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [],
        records: [{ id: 'recKeep', cellValuesByColumnId: {} }, { id: 'recStale', cellValuesByColumnId: {} }],
      }],
    };
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} } },
      records: { recS1: 'recKeep', recSGone: 'recStale' },
    };
    const client = runClient();
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter: noLimiter, journal: {}, persist: () => {}, result,
    });
    assert.deepEqual(client.calls.deleted, [{ tableId: 'tD', rowIds: ['recStale'] }], 'source-deleted counterpart pruned');
    assert.equal(idmap.records.recSGone, undefined, 'stale idmap entry dropped');
    assert.equal(idmap.records.recS1, 'recKeep', 'live mapping kept');
  });
});
