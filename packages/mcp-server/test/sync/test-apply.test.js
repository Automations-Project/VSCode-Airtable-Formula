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

  it('removes the auto-created scaffolding rows for a clean mirror', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnRows', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'Clean' }],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    const t = client.tables.find((x) => x.name === 'Clean');
    assert.equal(t.rows.length, 0, 'scaffolding rows removed');
    assert.ok(client.calls.some((c) => c.startsWith('deleteRecords:' + t.id)), 'deleteRecords called for the new table');
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
        // Real snapshots always carry symmetricColumnId on foreignKey typeOptions (source id-space).
        { kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldAlink', name: 'Bs', type: 'foreignKey', typeOptions: { foreignTableId: 'tB', relationship: 'many', symmetricColumnId: 'fldBlink' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tB'] },
        { kind: 'createField', sourceTableId: 'tB', sourceFieldId: 'fldBlink', name: 'As', type: 'foreignKey', typeOptions: { foreignTableId: 'tA', relationship: 'many', symmetricColumnId: 'fldAlink' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tA'] },
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

  it('skips + reports a scalar type change (RETYPE_GATED when no confirmRetypes), making no client mutation', async () => {
    const { client, columnId, destSnapshot } = await destWith('text', null);
    const before = client.calls.length;
    const res = await run(client, planUpdate(columnId, { type: 'number', typeOptions: { precision: 0 } }), destSnapshot);
    assert.equal(res.updated, 0);
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_GATED'), 'scalar retype without confirmRetypes → RETYPE_GATED');
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

describe('apply: unresolvable computed ref (no halt)', () => {
  it('skips a computed field referencing a skipped/unmapped field, and keeps going', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnU2', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldBtn', name: 'Btn', type: 'button', typeOptions: {}, description: null, computed: true, dependsOn: [], dependsOnTables: [] },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldF', name: 'F', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_fldBtn}' }, description: null, computed: true, dependsOn: ['fldBtn'], dependsOnTables: [] },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldOk', name: 'OK', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnU2', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0); // did NOT halt
    assert.ok(res.warnings.some((w) => w.code === 'SKIPPED_UNSUPPORTED')); // the button
    assert.ok(res.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'));    // the formula
    assert.equal(res.created, 1); // only the scalar 'OK'
    const cols = (await client.getApplicationData('appD')).data.tableSchemas[0].columns;
    assert.ok(cols.some((c) => c.name === 'OK'));
    assert.ok(!cols.some((c) => c.name === 'F')); // formula NOT created
  });
});

describe('apply: updateField computed + continue-on-failure (live-smoke fixes)', () => {
  it('computed updateField sends the writable shape (drops read-only keys) when refs resolve', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const price = await client.createField('appD', tableId, { name: 'Price', type: 'number' });
    const total = await client.createField('appD', tableId, { name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_OLD}' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnUC', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: { [price.columnId]: { destFld: price.columnId, choices: {} } } },
      actions: [{ kind: 'updateField', sourceFieldId: total.columnId, destFld: total.columnId,
        changes: { typeOptions: { formulaTextParsed: `{column_value_${price.columnId}}*2`, dependencies: { referencedColumnIdsForValue: [price.columnId] }, resultType: 'number', resultIsArray: false } } }],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnUC', 'ts'), persist: () => {} });
    assert.equal(res.updated, 1);
    const f = client._field(total.columnId);
    assert.equal(f.typeOptions.formulaText, `{${price.columnId}}*2`);
    assert.equal(f.typeOptions.formulaTextParsed, undefined);
    assert.equal(f.typeOptions.dependencies, undefined);
  });

  it('defers a computed update whose ref is not yet created (UNRESOLVABLE_REF, no fail)', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const total = await client.createField('appD', tableId, { name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: 'x' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnUD', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'updateField', sourceFieldId: total.columnId, destFld: total.columnId,
        changes: { typeOptions: { formulaTextParsed: '{column_value_fldNOTYET}', dependencies: { referencedColumnIdsForValue: ['fldNOTYET'] } } } }],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: { tables: {}, fields: {} }, journal: newJournal('plnUD', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0);
    assert.ok(res.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'));
  });

  it('does not halt the rest of the plan when one action fails', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnCont', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        { kind: 'updateField', sourceFieldId: 'fX', destFld: 'fldGHOST', changes: { description: 'x' } },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fNew', name: 'Score', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: { tables: { tS: tableId }, fields: {} }, journal: newJournal('plnCont', 'ts'), persist: () => {} });
    assert.equal(res.failed, 1);  // ghost update failed
    assert.equal(res.created, 1); // Score still created — no halt
  });
});

describe('apply: createView', () => {
  it('creates a missing view (copyFromViewId=default), maps it; adopts an existing one by name', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T'); // has default Grid view
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnV', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {}, views: {} },
      actions: [
        { kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vGrid', name: 'Grid view', type: 'grid' },
        { kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vNew', name: 'New View', type: 'grid' },
      ], orphans: [], warnings: [] };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnV', 'ts'), persist: () => {} });
    assert.ok(res.idmap.views.vGrid);  // adopted the default Grid view
    assert.ok(res.idmap.views.vNew);   // created
    const views = (await client.getApplicationData('appD')).data.tableSchemas[0].views;
    assert.equal(views.filter((v) => v.name === 'New View').length, 1);
    assert.equal(views.filter((v) => v.name === 'Grid view').length, 1); // not duplicated
  });
});

describe('apply: createTable then createView in one run (adopt default view)', () => {
  it('adopts the auto-created Grid view (no crash, no duplicate) and creates new views', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD'); // empty base
    const plan = { planId: 'plnTV', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {}, views: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Name', toType: 'text', toTypeOptions: null },
        { kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vGrid', name: 'Grid view', type: 'grid' },
        { kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vNew', name: 'Board', type: 'grid' },
      ], orphans: [], warnings: [] };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: { tables: {}, fields: {}, views: {} }, journal: newJournal('plnTV', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0);
    const t = (await client.getApplicationData('appD')).data.tableSchemas[0];
    assert.equal(t.views.filter((v) => v.name === 'Grid view').length, 1); // default adopted, not duplicated
    assert.ok(res.idmap.views.vGrid);
    assert.ok(t.views.some((v) => v.name === 'Board'));
  });
});

describe('apply: applyViewConfig', () => {
  async function destWithView(type) {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const price = await client.createField('appD', tableId, { name: 'Price', type: 'number' });
    const { viewId } = await client.createView('appD', tableId, { name: 'V', type });
    const destSnapshot = await snapshotBase(client, 'appD');
    return { client, tableId, viewId, price: price.columnId, destSnapshot };
  }
  const run = (client, plan, destSnapshot) => applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal(plan.planId, 'ts'), persist: () => {} });

  it('pushes remapped sorts + frozen for a grid view', async () => {
    const { client, viewId, price, destSnapshot } = await destWithView('grid');
    const plan = { planId: 'pV1', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: { fSrcPrice: { destFld: price, choices: {} } }, views: { vSrc: viewId } },
      actions: [{ kind: 'applyViewConfig', sourceTableId: 'tS', sourceViewId: 'vSrc', type: 'grid',
        config: { sorts: [{ columnId: 'fSrcPrice', ascending: true }], frozenColumnCount: 1 } }], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.ok(client.calls.some((k) => k === `applySorts:${viewId}`));
    assert.deepEqual(client._view(viewId).config.sorts, [{ columnId: price, ascending: true }]); // remapped
  });

  it('kanban whose stack (groupLevels) field is missing in dest → fallback warning, no failure', async () => {
    const { client, viewId, destSnapshot } = await destWithView('kanban');
    const plan = { planId: 'pV2', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: {}, views: { vSrc: viewId } },
      actions: [{ kind: 'applyViewConfig', sourceTableId: 'tS', sourceViewId: 'vSrc', type: 'kanban',
        config: { groupLevels: [{ columnId: 'fGONE', order: 'ascending', emptyGroupState: 'hidden' }] } }], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.ok(res.warnings.some((w) => w.code === 'VIEW_ANCHOR_FALLBACK' || w.code === 'VIEW_UNRESOLVABLE_REF'));
  });

  it('a source column with no `visibility` key at all is applied as SHOWN, not silently dropped as hidden', async () => {
    // Airtable's internal API omits `visibility` entirely for a visible column
    // in some responses. The columns facet must use the same isColumnVisible
    // semantics as getView, or a real source column never reaches setViewColumns's
    // visibleColumnIds and destination views end up missing columns forever.
    const { client, viewId, price, destSnapshot } = await destWithView('grid');
    const plan = { planId: 'pV3', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: {}, fields: { fSrcPrice: { destFld: price, choices: {} } }, views: { vSrc: viewId } },
      actions: [{ kind: 'applyViewConfig', sourceTableId: 'tS', sourceViewId: 'vSrc', type: 'grid',
        config: { columnOrder: [{ columnId: 'fSrcPrice' /* no visibility key */ }] } }], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.ok(client.calls.some((k) => k === `setViewColumns:${viewId}`));
    assert.deepEqual(client._view(viewId).config.columns.visibleColumnIds, [price]);
  });
});

describe('apply: createField (autoNumber — strip read-only maxUsedAutoNumber)', () => {
  it('creates an autoNumber field without passing maxUsedAutoNumber to the client', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    // Track typeOptions actually passed to createField
    const capturedTypeOptions = [];
    const origCreate = client.createField.bind(client);
    client.createField = async (appId, tblId, cfg) => {
      capturedTypeOptions.push({ name: cfg.name, typeOptions: cfg.typeOptions });
      return origCreate(appId, tblId, cfg);
    };
    const plan = {
      planId: 'plnAN', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        {
          kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldAN',
          name: 'ID', type: 'autoNumber',
          typeOptions: { maxUsedAutoNumber: 5 },
          description: null, computed: false, dependsOn: [], dependsOnTables: [],
        },
      ],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot,
      idmap: JSON.parse(JSON.stringify(plan.idmap)),
      journal: newJournal('plnAN', 'ts'),
      persist: () => {},
    });
    assert.equal(res.created, 1, 'autoNumber field must be created');
    assert.equal(res.failed, 0, 'must not fail');
    assert.ok(res.idmap.fields.fldAN, 'field must be mapped');
    const captured = capturedTypeOptions.find((c) => c.name === 'ID');
    assert.ok(captured, 'createField must have been called for ID');
    assert.equal(
      captured.typeOptions && 'maxUsedAutoNumber' in captured.typeOptions,
      false,
      'maxUsedAutoNumber must be stripped from typeOptions before createField',
    );
  });
});

// Build a dest base with table 'T' + one field of `fieldType`; return { destSnapshot, fId }.
async function destWithField(client, fieldType, typeOptions = null) {
  const { tableId } = await client.createTable('appD', 'T');
  const { columnId: fId } = await client.createField('appD', tableId, { name: 'F', type: fieldType, typeOptions });
  const destSnapshot = await snapshotBase(client, 'appD');
  return { destSnapshot, fId };
}
function retypePlan(fId, changes) {
  return { planId: 'pRT', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
    actions: [{ kind: 'updateField', sourceFieldId: 'sF', destFld: fId, changes }], orphans: [], warnings: [] };
}
function runRT(client, plan, destSnapshot, confirmRetypes) {
  return applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: { tables: {}, fields: {} },
    journal: newJournal(plan.planId, 'ts'), persist: () => {}, confirmRetypes });
}

describe('apply: field retypes (M4)', () => {
  it('scalar retype + confirmRetypes → updateFieldConfig called with new type, retyped=1', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    const res = await runRT(client, retypePlan(fId, { type: 'number' }), destSnapshot, true);
    assert.equal(res.retyped, 1);
    assert.ok(client.calls.includes(`updateFieldConfig:${fId}:number`));
  });
  it('scalar retype WITHOUT confirmRetypes → not applied, RETYPE_GATED', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    const res = await runRT(client, retypePlan(fId, { type: 'number' }), destSnapshot, false);
    assert.equal(res.retyped ?? 0, 0);
    assert.ok(!client.calls.some((c) => c.startsWith(`updateFieldConfig:${fId}`)));
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_GATED'));
  });
  it('out-of-scope retype (dest text → source formula) → RETYPE_DEFERRED, not applied', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    const res = await runRT(client, retypePlan(fId, { type: 'formula' }), destSnapshot, true);
    assert.equal(res.retyped ?? 0, 0);
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_DEFERRED'));
  });
  it('rejected retype → RETYPE_FAILED, field kept, no throw', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    client.updateFieldConfig = async () => { throw new Error('incompatible existing data'); };
    const res = await runRT(client, retypePlan(fId, { type: 'number' }), destSnapshot, true);
    assert.equal(res.retyped ?? 0, 0);
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_FAILED'));
    assert.equal(res.failed, 0, 'continue-on-failure: not a hard failure');
  });
  it('retype + rename in one action → both applied', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    const res = await runRT(client, retypePlan(fId, { type: 'number', name: 'Renamed' }), destSnapshot, true);
    assert.equal(res.retyped, 1);
    assert.ok(client.calls.includes(`updateFieldConfig:${fId}:number`));
    assert.ok(client.calls.some((c) => c.startsWith(`renameField:${fId}:Renamed`)));
  });
  it('text → select retype → updateFieldConfig with select + choices (mergeChoices)', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'text');
    const changes = { type: 'select', typeOptions: { choices: { sel1: { id: 'sel1', name: 'Open', color: 'blue' } } } };
    const res = await runRT(client, retypePlan(fId, changes), destSnapshot, true);
    assert.equal(res.retyped, 1);
    assert.ok(client.calls.includes(`updateFieldConfig:${fId}:select`));
    const f = client.tables[0].columns.find((c) => c.id === fId);
    assert.ok(f.typeOptions && f.typeOptions.choices, 'choices applied via mergeChoices');
  });
  it('non-type updateField (typeOptions only) is unchanged by the retype path', async () => {
    const client = new MockClient();
    const { destSnapshot, fId } = await destWithField(client, 'number');
    const res = await runRT(client, retypePlan(fId, { typeOptions: { precision: 2 } }), destSnapshot, false);
    assert.ok(client.calls.includes(`updateFieldConfig:${fId}:number`), 'still applies typeOptions update');
    assert.ok(!res.warnings.some((w) => w.code === 'RETYPE_GATED'));
  });
});
