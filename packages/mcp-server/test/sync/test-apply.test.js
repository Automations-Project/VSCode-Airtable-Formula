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

describe('apply: createField (scalar)', () => {
  it('creates a scalar field and maps it; skips one that already exists by name', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'Offers');
    await client.createField('appD', tableId, { name: 'Existing', type: 'text' });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnF', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fNew', name: 'Score', type: 'number', typeOptions: { precision: 0 }, description: 'pts', computed: false, dependsOn: [], dependsOnTables: [] },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fExist', name: 'Existing', type: 'text', typeOptions: null, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnF', 'ts'), persist: () => {} });
    assert.equal(res.created, 1);   // Score
    assert.equal(res.skipped, 1);   // Existing adopted
    assert.equal(res.idmap.fields.fNew.destFld.startsWith('fld'), true);
    assert.ok(res.idmap.fields.fExist.destFld);
    const score = (await client.getApplicationData('appD')).data.tableSchemas[0].columns.find((c) => c.name === 'Score');
    assert.equal(score.description, 'pts');
  });
});

describe('apply: createField (computed + unsupported)', () => {
  it('remaps a formula to dest ids, validates, creates it, strips read-only keys', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnC', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldPrice', name: 'Price', type: 'number', typeOptions: { precision: 2 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldTotal', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_fldPrice}*2', dependencies: { referencedColumnIdsForValue: ['fldPrice'] }, resultType: 'number' }, description: null, computed: true, dependsOn: ['fldPrice'], dependsOnTables: [] },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnC', 'ts'), persist: () => {} });
    assert.equal(res.created, 2);
    assert.equal(res.failed, 0);
    const destPriceId = res.idmap.fields.fldPrice.destFld;
    const total = (await client.getApplicationData('appD')).data.tableSchemas[0].columns.find((c) => c.name === 'Total');
    assert.equal(total.typeOptions.formulaText, `{${destPriceId}}*2`);
    assert.equal(total.typeOptions.formulaTextParsed, undefined); // read-only key stripped
    assert.ok(client.calls.some((k) => k === `validateFormula:{${destPriceId}}*2`));
  });

  it('fails the action when formula validation fails (no create)', async () => {
    const client = new MockClient({ formulaValid: false });
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnBad', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldX', name: 'Bad', type: 'formula', typeOptions: { formulaTextParsed: 'NONSENSE(' }, description: null, computed: true, dependsOn: [], dependsOnTables: [] }],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnBad', 'ts'), persist: () => {} });
    assert.equal(res.created, 0);
    assert.equal(res.failed, 1);
    assert.ok(res.warnings.some((w) => w.code === 'ACTION_FAILED'));
  });

  it('skips an unsupported type (button) with SKIPPED_UNSUPPORTED and no create', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const before = (await client.getApplicationData('appD')).data.tableSchemas[0].columns.length;
    const plan = {
      planId: 'plnBtn', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldBtn', name: 'OpenIt', type: 'button', typeOptions: { label: {} }, description: null, computed: true, dependsOn: [], dependsOnTables: [] }],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnBtn', 'ts'), persist: () => {} });
    assert.equal(res.created, 0);
    assert.equal(res.skipped, 1);
    assert.ok(res.warnings.some((w) => w.code === 'SKIPPED_UNSUPPORTED'));
    assert.equal(res.idmap.fields.fldBtn, undefined);
    assert.equal((await client.getApplicationData('appD')).data.tableSchemas[0].columns.length, before);
  });
});

describe('apply: createField (link foreignKey) reciprocal-once', () => {
  it('creates the forward link and adopts the auto-created reverse instead of duplicating', async () => {
    const client = new MockClient();
    const a = await client.createTable('appD', 'A');
    const b = await client.createTable('appD', 'B');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnL', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tA: a.tableId, tB: b.tableId }, fields: {} },
      actions: [
        { kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldAlink', name: 'Bs', type: 'foreignKey', typeOptions: { foreignTableId: 'tB', relationship: 'many' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tB'] },
        { kind: 'createField', sourceTableId: 'tB', sourceFieldId: 'fldBlink', name: 'As', type: 'foreignKey', typeOptions: { foreignTableId: 'tA', relationship: 'many' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tA'] },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnL', 'ts'), persist: () => {} });
    assert.equal(res.created, 1);  // only the forward link issues a create
    assert.equal(res.skipped, 1);  // reverse adopted
    const tables = (await client.getApplicationData('appD')).data.tableSchemas;
    const tableB = tables.find((t) => t.name === 'B');
    const links = tableB.columns.filter((c) => c.type === 'foreignKey');
    assert.equal(links.length, 1, 'reverse link must not be duplicated');
    assert.equal(links[0].name, 'As'); // adopted reverse renamed to source name
    assert.ok(res.idmap.fields.fldBlink.destFld);
  });
});

describe('apply: updateField', () => {
  async function destWith(fieldType, typeOptions) {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { columnId } = await client.createField('appD', tableId, { name: 'F', type: fieldType, typeOptions });
    return { client, columnId, destSnapshot: await snapshotBase(client, 'appD') };
  }
  function planUpdate(destFld, changes) {
    return { planId: 'plnU', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'updateField', sourceFieldId: 'fS', destFld, changes }], orphans: [], warnings: [] };
  }
  const run = (client, plan, destSnapshot) => applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: { tables: {}, fields: {} }, journal: newJournal(plan.planId, 'ts'), persist: () => {} });

  it('applies a description change', async () => {
    const { client, columnId, destSnapshot } = await destWith('text', null);
    const res = await run(client, planUpdate(columnId, { description: 'new' }), destSnapshot);
    assert.equal(res.updated, 1);
    assert.equal(client._field(columnId).description, 'new');
  });

  it('skips + reports a type change (RETYPE_DEFERRED), making no client mutation', async () => {
    const { client, columnId, destSnapshot } = await destWith('text', null);
    const before = client.calls.length;
    const res = await run(client, planUpdate(columnId, { type: 'number', typeOptions: { precision: 0 } }), destSnapshot);
    assert.equal(res.updated, 0);
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_DEFERRED'));
    assert.equal(client.calls.length, before); // no updateFieldConfig issued
  });

  it('merges select choices (keeps dest-only, adds source-only) without dropping any', async () => {
    const destChoices = { selD1: { id: 'selD1', name: 'Open' }, selD2: { id: 'selD2', name: 'DestOnly' } };
    const { client, columnId, destSnapshot } = await destWith('select', { choices: destChoices });
    const srcChoices = { selS1: { id: 'selS1', name: 'Open' }, selS3: { id: 'selS3', name: 'Closed' } };
    const res = await run(client, planUpdate(columnId, { typeOptions: { choices: srcChoices } }), destSnapshot);
    assert.equal(res.updated, 1);
    const names = Object.values(client._field(columnId).typeOptions.choices).map((c) => c.name).sort();
    assert.deepEqual(names, ['Closed', 'DestOnly', 'Open']);
  });
});

describe('apply: resume + idempotency', () => {
  function fullPlan() {
    return {
      planId: 'plnR', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Title', toType: 'text', toTypeOptions: null },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fS2', name: 'Score', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ],
      orphans: [], warnings: [],
    };
  }

  it('skips journal-done actions on resume (does not recreate the table)', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T'); // simulate a prior run's createTable
    const before = client.calls.length;
    const journal = newJournal('plnR', 'ts');
    journal.actions.push({ idx: 0, kind: 'createTable', status: 'done', destId: tableId });
    const idmap = { tables: { tS: tableId }, fields: {} }; // grown idmap a prior run persisted
    const destSnapshot = await snapshotBase(client, 'appD');
    const res = await applyPlan({ client, plan: fullPlan(), destAppId: 'appD', destSnapshot, idmap, journal, persist: () => {} });
    assert.equal(res.failed, 0);
    assert.ok(res.skipped >= 1);
    assert.ok(!client.calls.slice(before).some((k) => k === 'createTable:T')); // table NOT recreated
  });

  it('a second apply over the populated dest is a no-op (existence-skip self-heal)', async () => {
    const client = new MockClient();
    const r1 = await applyPlan({ client, plan: fullPlan(), destAppId: 'appD', destSnapshot: await snapshotBase(client, 'appD'), idmap: { tables: {}, fields: {} }, journal: newJournal('plnR', 'ts'), persist: () => {} });
    assert.equal(r1.failed, 0);
    const r2 = await applyPlan({ client, plan: fullPlan(), destAppId: 'appD', destSnapshot: await snapshotBase(client, 'appD'), idmap: { tables: {}, fields: {} }, journal: newJournal('plnR', 'ts'), persist: () => {} });
    assert.equal(r2.created, 0);
    assert.equal(r2.failed, 0);
  });
});
