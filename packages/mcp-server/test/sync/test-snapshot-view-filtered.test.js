/**
 * test-snapshot-view-filtered.test.js
 *
 * snapshotTableRecords reads records THROUGH a view (the readQueries endpoint has no
 * table-scoped source), so a filtered view silently yields a PARTIAL row set: hidden source
 * records are never synced, and hidden dest records look deleted (false orphan prunes →
 * duplicates on the next apply).
 *
 * Guard under test:
 *  - snapshotTableRecords prefers a view with NO filters (config on the snapshot, or probed
 *    via getView) and flags `table.snapshotViewFiltered` when every checkable candidate is
 *    filtered.
 *  - runRecords surfaces SNAPSHOT_VIEW_FILTERED and reuses the truncatedTables guard so
 *    mirror pruning never trusts the partial snapshot.
 *  - reconcile skips the existence-prune when a dest table was read through a filtered view.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotTableRecords } from '../../src/sync/snapshot.js';
import { runRecords, reconcile } from '../../src/sync/records.js';
import { saveIdmap, loadIdmap } from '../../src/sync/idmap.js';

const FILTERED = { filters: { filterSet: [{ columnId: 'fldX', operator: 'contains', value: 'x' }], conjunction: 'and' } };
const UNFILTERED = { filters: { filterSet: [], conjunction: 'and' } };

function queryClient(rows, extra = {}) {
  const seen = [];
  return {
    seen,
    queryRecords: async (appId, tableId, viewId) => { seen.push(viewId); return { summary: { rows } }; },
    ...extra,
  };
}

describe('snapshot.snapshotTableRecords — filtered-view avoidance', () => {
  it('skips a filtered view when the snapshot already carries configs', async () => {
    const client = queryClient([{ id: 'rec1', fields: {} }]);
    const table = {
      id: 'tbl1',
      views: [
        { id: 'viwF', name: 'Active', config: FILTERED },
        { id: 'viwU', name: 'All', config: UNFILTERED },
      ],
    };
    const out = await snapshotTableRecords(client, 'app1', table);
    assert.deepEqual(client.seen, ['viwU'], 'must read through the unfiltered view');
    assert.equal(table.snapshotViewFiltered, undefined, 'no flag when an unfiltered view exists');
    assert.equal(out.length, 1);
  });

  it('probes getView when configs are absent (schema-only snapshot) and picks the unfiltered view', async () => {
    const probed = [];
    const client = queryClient([], {
      getView: async (appId, viewId) => {
        probed.push(viewId);
        return viewId === 'viwF' ? { ...FILTERED } : { filters: null };
      },
    });
    const table = { id: 'tbl1', views: [{ id: 'viwF', name: 'Active' }, { id: 'viwU', name: 'All' }] };
    await snapshotTableRecords(client, 'app1', table);
    assert.deepEqual(probed, ['viwF', 'viwU']);
    assert.deepEqual(client.seen, ['viwU']);
    assert.equal(table.snapshotViewFiltered, undefined);
  });

  it('flags table.snapshotViewFiltered when EVERY collaborative view is filtered', async () => {
    const client = queryClient([{ id: 'rec1', fields: {} }], {
      getView: async () => ({ ...FILTERED }),
    });
    const table = { id: 'tbl1', name: 'Tasks', views: [{ id: 'viw1', name: 'Active' }, { id: 'viw2', name: 'Mine' }] };
    const out = await snapshotTableRecords(client, 'app1', table);
    assert.deepEqual(client.seen, ['viw1'], 'falls back to the first collaborative view');
    assert.ok(table.snapshotViewFiltered, 'table must be flagged as read-through-filtered-view');
    assert.equal(table.snapshotViewFiltered.viewId, 'viw1');
    assert.equal(out.length, 1, 'records are still returned (partial is better than nothing)');
  });

  // These two used to assert "cannot verify → no flag". That was the defect:
  // snapshotViewFiltered is the ONLY signal that adds a table to truncatedTables and
  // suppresses pruneRecords, so treating an UNVERIFIED view as clean let mirror
  // delete real records as false orphans when the row set was actually filtered.
  // Unverified is now flagged (with unverified:true to distinguish it from a
  // known-filtered view); the records are still returned either way.
  it('flags an unverifiable view as unsafe when the client has no getView', async () => {
    const client = queryClient([]);
    const table = { id: 'tbl1', views: [{ id: 'viwP', personalForUserId: 'usr1' }, { id: 'viw1', name: 'Grid' }] };
    await snapshotTableRecords(client, 'app1', table);
    assert.deepEqual(client.seen, ['viw1']);
    assert.ok(table.snapshotViewFiltered, 'cannot verify → must NOT be treated as prunable');
    assert.equal(table.snapshotViewFiltered.viewId, 'viw1');
    assert.equal(table.snapshotViewFiltered.unverified, true);
  });

  it('flags an unverifiable view as unsafe when getView probing fails', async () => {
    const client = queryClient([], { getView: async () => { throw new Error('boom'); } });
    const table = { id: 'tbl1', views: [{ id: 'viw1', name: 'Grid' }] };
    await snapshotTableRecords(client, 'app1', table);
    assert.deepEqual(client.seen, ['viw1']);
    assert.ok(table.snapshotViewFiltered, 'a swallowed probe error must not read as "clean"');
    assert.equal(table.snapshotViewFiltered.unverified, true);
  });
});

describe('runRecords — filtered-view snapshot disables mirror prune (truncation-guard reuse)', () => {
  it('does not delete orphans in a flagged table and emits SNAPSHOT_VIEW_FILTERED', async () => {
    const deleted = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => ({ updated: rows, failed: [] }),
      deleteRecords: async (appId, tableId, rowIds) => { deleted.push(rowIds); return {}; },
    };
    const srcSnapshot = {
      baseId: 'appS',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        fields: [{ id: 'sN', name: 'Name', type: 'text' }],
        views: [{ id: 'vS1', name: 'Grid view', type: 'grid', personalForUserId: null, config: {} }],
        records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'A' } }],
      }],
    };
    const destSnapshot = {
      baseId: 'appD',
      tables: [{
        id: 'tD', name: 'Games', views: [{ id: 'vD1', config: {} }], fields: [],
        // Snapshot read through a filtered view — 'recHidden' style rows are NOT here, and
        // 'recOrphan' cannot be distinguished from a mapped row hidden by the filter.
        snapshotViewFiltered: { viewId: 'vD1', viewName: 'Active' },
        records: [
          { id: 'recD1', cellValuesByColumnId: {} },
          { id: 'recOrphan', cellValuesByColumnId: {} },
        ],
      }],
    };
    const idmap = { tables: { tS: 'tD' }, fields: { sN: { destFld: 'dN', choices: {} } }, records: { recS1: 'recD1' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };

    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter: { run: (f) => f() }, journal: {}, persist: () => {}, result,
    });

    assert.deepEqual(deleted, [], 'prune must not trust a filtered (partial) snapshot');
    assert.ok(result.warnings.some((w) => w.code === 'SNAPSHOT_VIEW_FILTERED'), 'must warn SNAPSHOT_VIEW_FILTERED');
    assert.equal(result.deleted, 0);
  });

  it('a filtered SOURCE table also blocks the stale-mapping prune path', async () => {
    const deleted = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => ({ updated: rows, failed: [] }),
      deleteRecords: async (appId, tableId, rowIds) => { deleted.push(rowIds); return {}; },
    };
    const srcSnapshot = {
      baseId: 'appS',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        fields: [{ id: 'sN', name: 'Name', type: 'text' }],
        views: [{ id: 'vS1', name: 'Active', type: 'grid', personalForUserId: null }],
        snapshotViewFiltered: { viewId: 'vS1', viewName: 'Active' },
        // recS1 is hidden by the source filter → absent here, but its mapping is NOT stale.
        records: [],
      }],
    };
    const destSnapshot = {
      baseId: 'appD',
      tables: [{
        id: 'tD', name: 'Games', views: [{ id: 'vD1', config: {} }], fields: [],
        records: [{ id: 'recD1', cellValuesByColumnId: {} }],
      }],
    };
    const idmap = { tables: { tS: 'tD' }, fields: { sN: { destFld: 'dN', choices: {} } }, records: { recS1: 'recD1' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };

    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter: { run: (f) => f() }, journal: {}, persist: () => {}, result,
    });

    assert.deepEqual(deleted, [], 'a source record hidden by a filter must never orphan its dest row');
    assert.ok(result.warnings.some((w) => w.code === 'SNAPSHOT_VIEW_FILTERED'));
  });
});

describe('reconcile — filtered dest view skips the existence-prune', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-filt-')); });

  it('keeps mappings whose dest rows are hidden by the filter (no false prune)', async () => {
    const SRC = 'appSRC0000000000', DEST = 'appDST0000000000';
    // recD2 exists in dest but is hidden by the only (filtered) view → absent from the read.
    saveIdmap(SRC, DEST, { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recD1', recS2: 'recD2' } });
    const client = {
      getApplicationData: async () => ({
        data: {
          tableSchemas: [{
            id: 'tD', name: 'Games', primaryColumnId: 'dN',
            columns: [{ id: 'dN', name: 'Name', type: 'text' }],
            views: [{ id: 'vD1', name: 'Active', type: 'grid', personalForUserId: null }],
          }],
        },
      }),
      getView: async () => ({ filters: { filterSet: [{ columnId: 'dN', operator: 'contains', value: 'x' }], conjunction: 'and' } }),
      queryRecords: async () => ({ summary: { rows: [{ id: 'recD1', fields: {} }] } }),
    };
    const res = await reconcile({ client, sourceBaseId: SRC, destBaseId: DEST });
    assert.equal(res.skipped, 0, 'no mapping may be pruned from a filtered (partial) snapshot');
    assert.ok(res.warnings.some((w) => w.code === 'SNAPSHOT_VIEW_FILTERED'), 'must warn SNAPSHOT_VIEW_FILTERED');
    const persisted = loadIdmap(SRC, DEST);
    assert.equal(persisted.records.recS2, 'recD2', 'hidden-but-live mapping survives');
  });
});
