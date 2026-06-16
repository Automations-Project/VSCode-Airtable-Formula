import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';

function run(client, plan, destSnapshot) {
  return applyPlan({
    client, plan, destAppId: plan.destBaseId, destSnapshot,
    idmap: JSON.parse(JSON.stringify(plan.idmap)),
    journal: newJournal(plan.planId, 'ts'),
    persist: () => {},
  });
}

describe('apply: createTable + scaffolding-delete + reconcilePrimary', () => {
  it('creates a table, deletes the 5 non-primary defaults, renames+retypes the primary, maps it', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD'); // empty base
    const plan = {
      planId: 'pln1', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'Offers' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Title', toType: 'number', toTypeOptions: { format: 'integer' } },
      ],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    const t = (await client.getApplicationData('appD')).data.tableSchemas[0];
    assert.equal(t.name, 'Offers');
    assert.equal(t.columns.length, 1, 'scaffolding deleted, only primary remains');
    assert.equal(t.columns[0].name, 'Title');
    assert.equal(t.columns[0].type, 'number');
    assert.ok(res.idmap.tables.tS);
    assert.equal(res.idmap.fields.fS1.destFld, t.columns[0].id);
  });

  it('warns PRIMARY_TYPE_INCOMPATIBLE on rejected retype, keeps placeholder (still renamed)', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'pln2', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Key', toType: 'singleSelect', toTypeOptions: { choices: {} } },
      ],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.ok(res.warnings.some((w) => w.code === 'PRIMARY_TYPE_INCOMPATIBLE'));
    const t = (await client.getApplicationData('appD')).data.tableSchemas[0];
    assert.equal(t.columns[0].name, 'Key');
  });

  it('adopts an existing table by name instead of recreating', async () => {
    const client = new MockClient();
    await client.createTable('appD', 'Offers');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'pln3', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'Offers' }],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.created, 0);
    assert.equal(res.skipped, 1);
    assert.equal((await client.getApplicationData('appD')).data.tableSchemas.length, 1);
  });
});
