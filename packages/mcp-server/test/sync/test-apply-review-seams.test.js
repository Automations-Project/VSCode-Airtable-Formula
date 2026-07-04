// Seam regressions from the adversarial review of the hardening batch:
//  A1 — createView must adopt by (name, type), not name alone. diff.js matches views by
//       (name, type) and orphans a same-named dest view of a DIFFERENT type; name-only
//       adoption wrote kanban config onto a grid view, pointed idmap.views at the wrong
//       view, and under mirror+confirmDeletions pruneSchema deleted the just-configured view.
//  A2 — updateField's computed-typeOptions branch with unresolved refs must take the
//       'deferred' disposition (retried in-run; NOT journaled done) like createField.
//  A3 — a gated primary retype whose accompanying RENAME did apply mutates the dest
//       fingerprint with zero done journal actions — the prescribed follow-up (same plan +
//       confirmRetypes:true) then hit the DRIFT abort. The applied rename is journaled as a
//       done sub-action so the resume bypass is reachable.
//  A4 — a GENUINE link divergence (linkSig differs) must send the WRITABLE link shape —
//       the raw remapped options carry read-only keys (unreversed) that 422 on every apply.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal, isDone } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';
import { fingerprintSchema } from '../../src/sync/index.js';

function run(client, plan, destSnapshot, { journal, idmap, confirmRetypes } = {}) {
  return applyPlan({
    client, plan, destAppId: plan.destBaseId, destSnapshot,
    idmap: idmap ?? JSON.parse(JSON.stringify(plan.idmap)),
    journal: journal ?? newJournal(plan.planId, 'ts'),
    persist: () => {},
    confirmRetypes,
  });
}

describe('apply: createView adoption requires matching TYPE, not just name (A1)', () => {
  it('source kanban vs same-named dest grid → creates a NEW kanban; idmap points at the kanban, never the grid', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { viewId: gridBoardId } = await client.createView('appD', tableId, { name: 'Board', type: 'grid' });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnA1', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {}, views: {} },
      actions: [{ kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vK', name: 'Board', type: 'kanban' }],
      orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.equal(res.created, 1, 'a genuinely new view of the SOURCE type must be created');
    const views = (await client.getApplicationData('appD')).data.tableSchemas[0].views;
    const boards = views.filter((v) => v.name === 'Board');
    assert.equal(boards.length, 2, 'grid Board left in place (it is the orphan pruneSchema owns), kanban Board created');
    const kanban = boards.find((v) => v.type === 'kanban');
    assert.ok(kanban, 'created view carries the source type');
    assert.equal(res.idmap.views.vK, kanban.id, 'idmap.views must point at the kanban');
    assert.notEqual(res.idmap.views.vK, gridBoardId, 'idmap.views must never point at the same-named grid');
  });

  it('same name AND same type is still adopted (no duplicate view)', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { viewId: boardId } = await client.createView('appD', tableId, { name: 'Board', type: 'kanban' });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnA1b', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {}, views: {} },
      actions: [{ kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vK', name: 'Board', type: 'kanban' }],
      orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.equal(res.created, 0);
    assert.equal(res.idmap.views.vK, boardId, 'matching (name, type) adopts the existing view');
    const views = (await client.getApplicationData('appD')).data.tableSchemas[0].views;
    assert.equal(views.filter((v) => v.name === 'Board').length, 1, 'no duplicate created');
  });
});

describe('apply: updateField computed typeOptions with unresolved refs is deferred, not done (A2)', () => {
  const updateAction = (calcId) => ({ kind: 'updateField', sourceFieldId: 'sCalc', destFld: calcId,
    changes: { typeOptions: { formulaTextParsed: '{column_value_fldX}', dependencies: { referencedColumnIdsForValue: ['fldX'] } } } });

  it('unresolved ref → UNRESOLVABLE_REF, NOT journaled done; re-run with the ref mapped applies the update', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { columnId: calcId } = await client.createField('appD', tableId, { name: 'Calc', type: 'formula', typeOptions: { formulaText: '1' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnA2', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [updateAction(calcId)], orphans: [], warnings: [] };
    const journal = newJournal('plnA2', 'ts');

    const r1 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: {} } });
    assert.equal(r1.failed, 0);
    assert.ok(r1.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'));
    assert.equal(isDone(journal, 0), false, 'deferred computed update must NOT be journaled done');

    // Run 2: the ref is now mapped (created by a later run) — the SAME journal must retry it.
    const { columnId: xId } = await client.createField('appD', tableId, { name: 'X', type: 'number' });
    const r2 = await run(client, plan, await snapshotBase(client, 'appD'),
      { journal, idmap: { tables: { tS: tableId }, fields: { fldX: { destFld: xId, choices: {} } } } });
    assert.equal(r2.updated, 1, 're-run must apply the computed update once the ref resolves');
    assert.equal(client._field(calcId).typeOptions.formulaText, `{${xId}}`, 'refs remapped + writable shape');
  });

  it('in-run deferral: the ref is created LATER in the same plan → retried and applied in one run', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T');
    const { columnId: calcId } = await client.createField('appD', tableId, { name: 'Calc', type: 'formula', typeOptions: { formulaText: '1' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = { planId: 'plnA2b', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [
        // Dependency-inverted order: the update appears BEFORE the field it references.
        updateAction(calcId),
        { kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fldX', name: 'X', type: 'number', typeOptions: { precision: 0 }, description: null, computed: false, dependsOn: [], dependsOnTables: [] },
      ], orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot, { idmap: { tables: { tS: tableId }, fields: {} } });
    assert.equal(res.failed, 0);
    assert.equal(res.updated, 1, 'deferred update must be retried after its ref was created this run');
    assert.ok(!res.warnings.some((w) => w.code === 'UNRESOLVABLE_REF'), 'resolved deferral must not surface a warning');
    const destXId = res.idmap.fields.fldX.destFld;
    assert.equal(client._field(calcId).typeOptions.formulaText, `{${destXId}}`);
  });
});

describe('apply: gated primary retype with an applied rename stays resumable (A3)', () => {
  it('journals the rename as a done sub-action so the same-plan confirmRetypes:true follow-up survives the drift guard', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'T'); // pre-existing table → retype gated
    const destSnapshot = await snapshotBase(client, 'appD');
    const fpBefore = fingerprintSchema(destSnapshot);
    const plan = { planId: 'plnA3', sourceBaseId: 'appS', destBaseId: 'appD', idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Title', toType: 'number', toTypeOptions: { format: 'integer' } }],
      orphans: [], warnings: [] };
    const journal = newJournal('plnA3', 'ts');

    const r1 = await run(client, plan, destSnapshot, { journal, idmap: { tables: { tS: tableId }, fields: {} }, confirmRetypes: false });
    assert.ok(r1.warnings.some((w) => w.code === 'RETYPE_GATED'));
    const primary = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(primary.name, 'Title', 'rename applied');
    assert.equal(primary.type, 'text', 'retype gated — no mutation');

    // The rename mutated the dest fingerprint...
    const snapshot2 = await snapshotBase(client, 'appD');
    assert.notEqual(fingerprintSchema(snapshot2), fpBefore, 'precondition: the applied rename changes the fingerprint');
    // ...so the prescribed follow-up only survives the drift guard when the journal shows
    // prior progress (index.js: resuming = journal.actions.some((a) => a.status === 'done')).
    assert.equal(isDone(journal, 0), false, 'the gated retype itself must stay retryable');
    assert.ok(journal.actions.some((e) => e.status === 'done'),
      'the applied rename must be journaled as a done sub-action → resume bypass reachable');

    // Idempotent on resume: re-running the same gated plan must not duplicate the sub-action.
    await run(client, plan, snapshot2, { journal, idmap: { tables: { tS: tableId }, fields: {} }, confirmRetypes: false });
    assert.equal(journal.actions.filter((e) => e.status === 'done').length, 1, 'sub-action recorded once (upsert)');

    // Follow-up with confirmRetypes:true on the SAME journal performs the retype.
    const r2 = await run(client, plan, snapshot2, { journal, idmap: { tables: { tS: tableId }, fields: {} }, confirmRetypes: true });
    assert.equal(r2.updated, 1);
    const after = (await client.getApplicationData('appD')).data.tableSchemas[0].columns[0];
    assert.equal(after.type, 'number', 'follow-up run performs the retype');
    assert.equal(isDone(journal, 0), true, 'retype now journaled done');
  });
});

describe('apply: genuine link divergence sends WRITABLE link options (A4)', () => {
  it('drops read-only unreversed/symmetricColumnId and remaps foreignTableId before updateFieldConfig', async () => {
    const client = new MockClient();
    const a = await client.createTable('appD', 'A');
    const b = await client.createTable('appD', 'B');
    const c = await client.createTable('appD', 'C');
    // Dest link points at B; source (diverged) points at C — linkSig differs → updateField.
    const { columnId: linkId } = await client.createField('appD', a.tableId, { name: 'Link', type: 'foreignKey', typeOptions: { foreignTableId: b.tableId, relationship: 'many' } });
    const destSnapshot = await snapshotBase(client, 'appD');
    const captured = [];
    const orig = client.updateFieldConfig.bind(client);
    client.updateFieldConfig = async (appId, colId, cfg) => { captured.push(cfg); return orig(appId, colId, cfg); };
    const plan = { planId: 'plnA4', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tC: c.tableId }, fields: {} },
      actions: [{ kind: 'updateField', sourceFieldId: 'sLink', destFld: linkId,
        // Raw SOURCE typeOptions as diff.js emits them: carry read-only unreversed + a
        // source-base symmetricColumnId that must never reach the dest API.
        changes: { typeOptions: { foreignTableId: 'tC', relationship: 'many', symmetricColumnId: 'fldSrcRev', unreversed: true } } }],
      orphans: [], warnings: [] };
    const res = await run(client, plan, destSnapshot);
    assert.equal(res.failed, 0);
    assert.equal(res.updated, 1);
    const cfg = captured.find((x) => x.type === 'foreignKey');
    assert.ok(cfg, 'link update sent as a link-typed config');
    assert.deepEqual(cfg.typeOptions, { foreignTableId: c.tableId, relationship: 'many' },
      'writable link shape only — unreversed/symmetricColumnId dropped, foreignTableId remapped to the DEST table id');
  });
});
