// Hardening regressions for the schema apply engine (audit findings):
//  - adoptReverseLink must adopt the EXACT symmetric reverse (not first-unadopted) — two
//    links between the same table pair otherwise cross-wire silently.
//  - reverse-link adoption must work across runs (idmap-based, not in-memory createdLinks).
//  - gated/deferred actions (RETYPE_GATED / RETYPE_DEFERRED / UNRESOLVABLE_REF) must NOT be
//    journaled done — a re-run of the same plan retries them.
//  - a link createField whose target table is created later in the plan is deferred and
//    retried in the same run (never sent with the SOURCE base's tbl id).
//  - reconcilePrimary honors confirmRetypes for pre-existing tables and writes computed
//    primaries in the writable shape (toWritableComputedOptions; autoNumber strip).
//  - a gated/deferred retype still applies the accompanying description change.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal, isDone } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';

function run(client, plan, destSnapshot, { journal, idmap, confirmRetypes } = {}) {
  return applyPlan({
    client, plan, destAppId: plan.destBaseId, destSnapshot,
    idmap: idmap ?? JSON.parse(JSON.stringify(plan.idmap)),
    journal: journal ?? newJournal(plan.planId, 'ts'),
    persist: () => {},
    confirmRetypes,
  });
}

describe('apply: adoptReverseLink exact symmetric match (no cross-wiring)', () => {
  it('two links into the same table adopt their OWN reverses even when plan order differs from creation order', async () => {
    const client = new MockClient();
    const a = await client.createTable('appD', 'A');
    const b = await client.createTable('appD', 'B');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnXW', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tA: a.tableId, tB: b.tableId }, fields: {} },
      actions: [
        // Forwards created in A: Owner first, Reviewer second (auto-reverses appended to B in that order).
        { kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldOwner', name: 'Owner', type: 'foreignKey', typeOptions: { foreignTableId: 'tB', relationship: 'many', symmetricColumnId: 'fldOwnerRev' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tB'] },
        { kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldReviewer', name: 'Reviewer', type: 'foreignKey', typeOptions: { foreignTableId: 'tB', relationship: 'many', symmetricColumnId: 'fldReviewerRev' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tB'] },
        // Reverse-side actions arrive in the OPPOSITE order (source table B's field order):
        // Reviewer's reverse FIRST — first-unadopted matching would grab Owner's reverse here.
        { kind: 'createField', sourceTableId: 'tB', sourceFieldId: 'fldReviewerRev', name: 'Reviewed Tasks', type: 'foreignKey', typeOptions: { foreignTableId: 'tA', relationship: 'many', symmetricColumnId: 'fldReviewer' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tA'] },
        { kind: 'createField', sourceTableId: 'tB', sourceFieldId: 'fldOwnerRev', name: 'Owned Tasks', type: 'foreignKey', typeOptions: { foreignTableId: 'tA', relationship: 'many', symmetricColumnId: 'fldOwner' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tA'] },
      ],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    const tables = (await client.getApplicationData('appD')).data.tableSchemas;
    const tableB = tables.find((t) => t.name === 'B');
    const links = tableB.columns.filter((c) => c.type === 'foreignKey');
    assert.equal(links.length, 2, 'exactly two reverse links (no duplicates)');
    const reviewed = links.find((c) => c.name === 'Reviewed Tasks');
    const owned = links.find((c) => c.name === 'Owned Tasks');
    assert.ok(reviewed && owned, 'both reverses adopted + renamed');
    // The field named "Reviewed Tasks" must be symmetric to the Reviewer forward, not Owner's.
    assert.equal(reviewed.typeOptions.symmetricColumnId, res.idmap.fields.fldReviewer.destFld,
      'Reviewed Tasks must pair with the Reviewer forward');
    assert.equal(owned.typeOptions.symmetricColumnId, res.idmap.fields.fldOwner.destFld,
      'Owned Tasks must pair with the Owner forward');
    assert.equal(res.idmap.fields.fldReviewerRev.destFld, reviewed.id);
    assert.equal(res.idmap.fields.fldOwnerRev.destFld, owned.id);
  });
});

describe('apply: cross-run reverse-link adoption (idmap-based, not in-memory state)', () => {
  it('adopts a prior run\'s auto-created reverse instead of creating a duplicate link pair', async () => {
    const client = new MockClient();
    const a = await client.createTable('appD', 'A');
    const b = await client.createTable('appD', 'B');
    // Prior run created the forward link (Airtable auto-created its reverse in B, default name "A").
    const { columnId: forwardId } = await client.createField('appD', a.tableId, { name: 'Bs', type: 'foreignKey', typeOptions: { foreignTableId: b.tableId, relationship: 'many' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnXR', sourceBaseId: 'appS', destBaseId: 'appD',
      // The forward is already mapped (matched by name in a re-plan / persisted idmap).
      idmap: { tables: { tA: a.tableId, tB: b.tableId }, fields: { fldAlink: { destFld: forwardId, choices: {} } } },
      actions: [
        { kind: 'createField', sourceTableId: 'tB', sourceFieldId: 'fldBlink', name: 'As', type: 'foreignKey', typeOptions: { foreignTableId: 'tA', relationship: 'many', symmetricColumnId: 'fldAlink' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tA'] },
      ],
      orphans: [], warnings: [],
    };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    const tableB = (await client.getApplicationData('appD')).data.tableSchemas.find((t) => t.name === 'B');
    const links = tableB.columns.filter((c) => c.type === 'foreignKey');
    assert.equal(links.length, 1, 'must adopt the existing auto-reverse, not create a duplicate pair');
    assert.equal(links[0].name, 'As');
    assert.equal(res.idmap.fields.fldBlink.destFld, links[0].id);
    assert.equal(links[0].typeOptions.symmetricColumnId, forwardId);
  });
});

describe('apply: gated/deferred actions are NOT journaled done (same-plan re-run retries)', () => {
  it('RETYPE_GATED, then re-run with confirmRetypes:true on the SAME journal actually retypes', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { columnId } = await client.createField('appD', tableId, { name: 'F', type: 'text' });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnG', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'updateField', sourceFieldId: 'sF', destFld: columnId, changes: { type: 'number' } }], orphans: [], warnings: [] };
    const journal = newJournal('plnG', 'ts');

    const r1 = await run(client, plan, destSnapshot, { journal, confirmRetypes: false });
    assert.ok(r1.warnings.some((w) => w.code === 'RETYPE_GATED'));
    assert.equal(isDone(journal, 0), false, 'gated action must NOT be journaled done');

    const r2 = await run(client, plan, destSnapshot, { journal, confirmRetypes: true });
    assert.equal(r2.retyped, 1, 're-run with confirmRetypes:true must perform the retype');
    assert.ok(client.calls.includes(`updateFieldConfig:${columnId}:number`));
  });

  it('UNRESOLVABLE_REF createField, then re-run with the dep now mapped creates the field', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnUR', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldF', name: 'F', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_fldX}' }, description: null, computed: true, dependsOn: ['fldX'], dependsOnTables: [] }],
      orphans: [], warnings: [] };
    const journal = newJournal('plnUR', 'ts');

    const r1 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: {} } });
    assert.ok(r1.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'));
    assert.equal(isDone(journal, 0), false, 'deferred action must NOT be journaled done');

    // Run 2: the dep is now mapped (e.g. created by a later run / other table's actions).
    const { columnId: xId } = await client.createField('appD', tableId, { name: 'X', type: 'number' });
    const r2 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: { fldX: { destFld: xId, choices: {} } } } });
    assert.equal(r2.created, 1, 're-run must create the formula once the ref resolves');
    const cols = (await client.getApplicationData('appD')).data.tableSchemas[0].columns;
    assert.ok(cols.some((c) => c.name === 'F'));
  });

  it('in-run deferral: a computed field whose dep is created LATER in the plan converges in one run', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnIR', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        // Dependency-inverted order: the formula appears BEFORE the field it references.
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldTotal', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_fldPrice}*2', dependencies: { referencedColumnIdsForValue: ['fldPrice'] } }, description: null, computed: true, dependsOn: ['fldPrice'], dependsOnTables: [] },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldPrice', name: 'Price', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ],
      orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: { tS: tableId }, fields: {} } });
    assert.equal(res.created, 2, 'formula must be retried and created after its dep exists');
    assert.equal(res.failed, 0);
    assert.ok(!res.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'), 'resolved deferral must not surface a warning');
    const total = (await client.getApplicationData('appD')).data.tableSchemas[0].columns.find((c) => c.name === 'Total');
    assert.ok(total, 'Total created');
    const destPriceId = res.idmap.fields.fldPrice.destFld;
    assert.equal(total.typeOptions.formulaText, `{${destPriceId}}*2`);
  });
});

describe('apply: link createField to a not-yet-created table (dependsOnTables)', () => {
  it('defers the link until its target table is created later in the same run (never sends the source tbl id)', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD'); // empty base
    const plan = { planId: 'plnLT', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tA', name: 'Projects' },
        { kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldTasks', name: 'Tasks', type: 'foreignKey', typeOptions: { foreignTableId: 'tB', relationship: 'many', symmetricColumnId: 'fldProj' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tB'] },
        { kind: 'createTable', sourceTableId: 'tB', name: 'Tasks' },
      ],
      orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: {}, fields: {} } });
    assert.equal(res.failed, 0, 'link to a later table must not fail the action');
    const tables = (await client.getApplicationData('appD')).data.tableSchemas;
    const projects = tables.find((t) => t.name === 'Projects');
    const link = projects.columns.find((c) => c.name === 'Tasks');
    assert.ok(link, 'link created after its target table exists');
    assert.equal(link.typeOptions.foreignTableId, res.idmap.tables.tB, 'foreignTableId must be the DEST table id, never the source id');
  });

  it('link whose target table never materializes → UNRESOLVABLE_REF warning, not ACTION_FAILED, not journaled done', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'A');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnLN', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tA: tableId }, fields: {} },
      actions: [{ kind: 'createField', sourceTableId: 'tA', sourceFieldId: 'fldL', name: 'L', type: 'foreignKey', typeOptions: { foreignTableId: 'tMISSING', relationship: 'many' }, description: null, computed: false, dependsOn: [], dependsOnTables: ['tMISSING'] }],
      orphans: [], warnings: [] };
    const journal = newJournal('plnLN', 'ts');
    const res = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tA: tableId }, fields: {} } });
    assert.equal(res.failed, 0);
    assert.ok(res.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'));
    assert.equal(isDone(journal, 0), false, 'unresolved link create must stay retryable');
    const cols = (await client.getApplicationData('appD')).data.tableSchemas[0].columns;
    assert.ok(!cols.some((c) => c.name === 'L'), 'link NOT created with a source tbl id');
  });
});

describe('apply: reconcilePrimary confirmRetypes gate + writable computed options', () => {
  it('retyping a PRE-EXISTING table\'s primary without confirmRetypes → RETYPE_GATED, no mutation, retryable', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T'); // pre-existing dest table with data-bearing primary
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnPG', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Name', toType: 'number', toTypeOptions: { format: 'integer' } }],
      orphans: [], warnings: [] };
    const journal = newJournal('plnPG', 'ts');
    const r1 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: {} }, confirmRetypes: false });
    assert.ok(r1.warnings.some((w) => w.code === 'RETYPE_GATED'), 'ungated primary retype of a pre-existing table is a lossy conversion');
    const primary = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(primary.type, 'text', 'primary must be kept');
    assert.equal(isDone(journal, 0), false, 'gated reconcilePrimary must stay retryable');

    const r2 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: {} }, confirmRetypes: true });
    assert.equal(r2.updated, 1);
    const after = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(after.type, 'number', 're-run with confirmRetypes:true performs the retype');
  });

  it('table created THIS run: primary retype stays ungated (placeholder primary, no data)', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnPU', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Title', toType: 'number', toTypeOptions: { format: 'integer' } },
      ], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: {}, fields: {} }, confirmRetypes: false });
    assert.ok(!res.warnings.some((w) => w.code === 'RETYPE_GATED'));
    const primary = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(primary.type, 'number');
  });

  it('formula primary is written in the WRITABLE shape with refs remapped (deferred until siblings exist)', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnPF', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Total', toType: 'formula',
          toTypeOptions: { formulaTextParsed: '{column_value_fldPrice}*2', dependencies: { referencedColumnIdsForValue: ['fldPrice'] }, resultType: 'number', format: 'currency' } },
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldPrice', name: 'Price', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: {}, fields: {} } });
    assert.equal(res.failed, 0);
    const primary = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(primary.type, 'formula', 'primary retyped after the sibling ref was created');
    const destPriceId = res.idmap.fields.fldPrice.destFld;
    assert.equal(primary.typeOptions.formulaText, `{${destPriceId}}*2`, 'refs remapped + input-form formulaText');
    assert.equal(primary.typeOptions.formulaTextParsed, undefined, 'read-only key stripped');
    assert.equal(primary.typeOptions.dependencies, undefined, 'read-only key stripped');
    assert.equal(primary.typeOptions.format, 'currency', 'format keys carried');
  });

  it('autoNumber primary: read-only maxUsedAutoNumber is stripped before updateFieldConfig', async () => {
    const client = new MockClient();
    const destSnapshot = await snapshotBase(client, 'appD');
    const captured = [];
    const orig = client.updateFieldConfig.bind(client);
    client.updateFieldConfig = async (appId, colId, cfg) => { captured.push(cfg); return orig(appId, colId, cfg); };
    const plan = { planId: 'plnPA', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'ID', toType: 'autoNumber', toTypeOptions: { maxUsedAutoNumber: 7 } },
      ], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: {}, fields: {} } });
    assert.equal(res.failed, 0);
    const cfg = captured.find((c) => c.type === 'autoNumber');
    assert.ok(cfg, 'primary retyped to autoNumber');
    assert.equal(cfg.typeOptions && 'maxUsedAutoNumber' in cfg.typeOptions, false, 'read-only counter stripped');
  });
});

describe('apply: gated/deferred retype still applies the description change', () => {
  async function destWithText() {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { columnId } = await client.createField('appD', tableId, { name: 'F', type: 'text' });
    return { client, columnId, destSnapshot: await snapshotBase(client, 'appD') };
  }
  function planFor(columnId, changes) {
    return { planId: 'plnDD', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'updateField', sourceFieldId: 'sF', destFld: columnId, changes }], orphans: [], warnings: [] };
  }

  it('RETYPE_DEFERRED (non-scalar) + description → description applied', async () => {
    const { client, columnId, destSnapshot } = await destWithText();
    const res = await run(client, planFor(columnId, { type: 'formula', description: 'kept' }), destSnapshot, { confirmRetypes: true });
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_DEFERRED'));
    assert.equal(client._field(columnId).description, 'kept', 'description must not be dropped by the deferred retype');
    assert.equal(client._field(columnId).type, 'text', 'type unchanged');
  });

  it('RETYPE_GATED + description → description applied', async () => {
    const { client, columnId, destSnapshot } = await destWithText();
    const res = await run(client, planFor(columnId, { type: 'number', description: 'kept2' }), destSnapshot, { confirmRetypes: false });
    assert.ok(res.warnings.some((w) => w.code === 'RETYPE_GATED'));
    assert.equal(client._field(columnId).description, 'kept2', 'description must not be dropped by the gated retype');
    assert.equal(client._field(columnId).type, 'text', 'type unchanged');
  });
});
