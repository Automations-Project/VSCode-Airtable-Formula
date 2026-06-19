import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';

describe('applyPlan: journal-safe selective-apply skip guard', () => {
  it('skips actions by changeId (skip-list) and by apply:false, without filtering plan.actions', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD'); // empty base

    const plan = {
      planId: 'p-sel', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {}, views: {} },
      actions: [
        // A: apply:true, not in skip → should be applied (createTable)
        { kind: 'createTable', sourceTableId: 't1', name: 'A', changeId: 'createTable|A|A', apply: true },
        // B: apply:true, IN skip list → should be skipped
        { kind: 'createTable', sourceTableId: 't2', name: 'B', changeId: 'createTable|B|B', apply: true },
        // C: apply:false → should be skipped
        { kind: 'createTable', sourceTableId: 't3', name: 'C', changeId: 'createTable|C|C', apply: false },
      ],
      orphans: [], warnings: [],
    };
    const idmap = { tables: {}, fields: {}, views: {} };
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot, idmap,
      journal: newJournal('p-sel', 'ts'),
      persist: () => {},
      skip: ['createTable|B|B'],
    });

    // A applied, B skipped (skip-list), C skipped (apply:false)
    assert.equal(res.skipped, 2, `expected 2 skipped, got ${res.skipped}`);
    assert.equal(res.created, 1, `expected 1 created (only A), got ${res.created}`);
    assert.equal(res.failed, 0, `expected 0 failed, got ${res.failed}`);

    // A's idmap entry must exist
    assert.ok(res.idmap.tables.t1, 'A (t1) must be in idmap.tables');
    // B and C must NOT be in idmap (never applied)
    assert.equal(res.idmap.tables.t2, undefined, 'B (t2) must NOT be in idmap.tables');
    assert.equal(res.idmap.tables.t3, undefined, 'C (t3) must NOT be in idmap.tables');

    // Only table A should be created in the mock
    const tables = (await client.getApplicationData('appD')).data.tableSchemas;
    const names = tables.map((t) => t.name).sort();
    assert.deepEqual(names, ['A'], `expected only table A in dest, got ${JSON.stringify(names)}`);
  });

  it('default skip=[] and apply!==false means existing behavior is unchanged', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');

    const plan = {
      planId: 'p-compat', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {}, views: {} },
      actions: [
        // No apply field, no changeId — mirrors old plan format
        { kind: 'createTable', sourceTableId: 'tX', name: 'X' },
        { kind: 'createTable', sourceTableId: 'tY', name: 'Y' },
      ],
      orphans: [], warnings: [],
    };
    const idmap = { tables: {}, fields: {}, views: {} };
    // Call WITHOUT skip param — must still work
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot, idmap,
      journal: newJournal('p-compat', 'ts'),
      persist: () => {},
    });

    assert.equal(res.created, 2, `expected 2 created, got ${res.created}`);
    assert.equal(res.failed, 0);
    assert.ok(res.idmap.tables.tX);
    assert.ok(res.idmap.tables.tY);
  });
});
