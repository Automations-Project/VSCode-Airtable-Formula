import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotTableRecords } from '../../src/sync/snapshot.js';

describe('snapshot.snapshotTableRecords', () => {
  it('maps summary.rows {id, fields} → {id, cellValuesByColumnId} via the first collaborative view', async () => {
    let seenView = null;
    const client = {
      queryRecords: async (appId, tableId, viewId, opts) => {
        seenView = viewId;
        assert.equal(opts.limit, 1000);
        return { summary: { rows: [{ id: 'rec1', fields: { fldA: 'x' } }, { id: 'rec2', fields: { fldA: 'y' } }], count: 2 } };
      },
    };
    const table = { id: 'tbl1', views: [{ id: 'viwP', personalForUserId: 'usr1' }, { id: 'viw1', name: 'Grid' }] };
    const out = await snapshotTableRecords(client, 'app1', table);
    assert.equal(seenView, 'viw1'); // skipped the personal view
    assert.deepEqual(out, [{ id: 'rec1', cellValuesByColumnId: { fldA: 'x' } }, { id: 'rec2', cellValuesByColumnId: { fldA: 'y' } }]);
  });
  it('returns [] when the table has no view', async () => {
    const out = await snapshotTableRecords({ queryRecords: async () => ({ summary: { rows: [] } }) }, 'app1', { id: 't', views: [] });
    assert.deepEqual(out, []);
  });
});
