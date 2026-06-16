import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../../src/sync/diff.js';
import { matchByName } from '../../src/sync/idmap.js';

function field(id, name, type, extra = {}) { return { id, name, type, typeOptions: extra.typeOptions ?? null, description: extra.description ?? null, isComputed: !!extra.isComputed }; }

describe('diff.computePlan', () => {
  it('emits createTable + fields for a source-only table', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'New', primaryFieldId: 'fS1', fields: [field('fS1','Name','text'), field('fS2','Note','multilineText')] }] };
    const dest = { baseId: 'appD', tables: [] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const kinds = plan.actions.map(a => a.kind);
    assert.deepEqual(kinds, ['createTable', 'reconcilePrimary', 'createField']);
    assert.equal(plan.actions[0].name, 'New');
    assert.equal(plan.actions[2].name, 'Note');
  });

  it('skips an identical existing field (idempotent) and updates a diverged one', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1','Name','text'), field('fS2','Count','number',{ typeOptions:{ precision: 0 } }) ] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [
      field('fD1','Name','text'), field('fD2','Count','text') ] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const updates = plan.actions.filter(a => a.kind === 'updateField');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].destFld, 'fD2');
    assert.equal(updates[0].changes.type, 'number');
    assert.ok(!plan.actions.some(a => a.kind === 'createField'));
  });

  it('does NOT flag a computed field whose formula differs only by field IDs', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1','Name','text'),
      field('fS2','Total','formula',{ isComputed:true, typeOptions:{ formulaTextParsed:'{fS1}' } }) ] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [
      field('fD1','Name','text'),
      field('fD2','Total','formula',{ isComputed:true, typeOptions:{ formulaTextParsed:'{fD1}' } }) ] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    assert.equal(plan.actions.length, 0, 'identical-by-name formula must not produce an action');
  });

  it('reports dest-only tables/fields as orphans, never as actions', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [field('fS1','Name','text')] }] };
    const dest = { baseId: 'appD', tables: [
      { id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [field('fD1','Name','text'), field('fDx','Extra','text')] },
      { id: 'tDghost', name: 'Ghost', primaryFieldId: 'fg', fields: [field('fg','x','text')] } ] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const orphanNames = plan.orphans.map(o => o.name).sort();
    assert.deepEqual(orphanNames, ['Extra', 'Ghost']);
    assert.equal(plan.actions.length, 0);
  });

  it('orders new-table fields: scalars before links before computed', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1', 'Name', 'text'),
      field('fS4', 'Formula', 'formula', { isComputed: true, typeOptions: { formulaTextParsed: '1' } }),
      field('fS3', 'Link', 'multipleRecordLinks'),
      field('fS2', 'Score', 'number'),
    ] }] };
    const dest = { baseId: 'appD', tables: [] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const createNames = plan.actions.filter(a => a.kind === 'createField').map(a => a.name);
    assert.ok(createNames.indexOf('Score') < createNames.indexOf('Link'), 'scalar before link');
    assert.ok(createNames.indexOf('Link') < createNames.indexOf('Formula'), 'link before computed');
  });

  it('computed field differing only by description -> changes has description, not typeOptions', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1', 'Name', 'text'),
      { id: 'fS2', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{fS1}' }, description: 'new', isComputed: true },
    ] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [
      field('fD1', 'Name', 'text'),
      { id: 'fD2', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{fD1}' }, description: 'old', isComputed: true },
    ] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const upd = plan.actions.filter(a => a.kind === 'updateField');
    assert.equal(upd.length, 1);
    assert.equal(upd[0].changes.description, 'new');
    assert.equal(upd[0].changes.typeOptions, undefined, 'no spurious typeOptions for ID-only formula difference');
  });

  it('captures foreign table dependency on a link field createField', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1','Name','text'),
      field('fS2','Link','multipleRecordLinks',{ typeOptions:{ foreignTableId: 'tblFOREIGN' } }) ] }] };
    const dest = { baseId: 'appD', tables: [] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const link = plan.actions.find(a => a.kind === 'createField' && a.name === 'Link');
    assert.ok(link, 'link createField present');
    assert.deepEqual(link.dependsOnTables, ['tblFOREIGN']);
  });

  it('computed createField dependsOn includes referenced source field ids', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1','Name','text'),
      field('fS2','Total','formula',{ isComputed:true, typeOptions:{ formulaTextParsed:'{fldREF1}+{fldREF2}', dependencies:{ referencedColumnIdsForValue:['fldREF1','fldREF2'] } } }) ] }] };
    const dest = { baseId: 'appD', tables: [] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const f = plan.actions.find(a => a.kind === 'createField' && a.name === 'Total');
    assert.ok(f.dependsOn.includes('fldREF1') && f.dependsOn.includes('fldREF2'));
  });

  it('emits updateField when an existing select field gained a source choice', () => {
    const sel = (choices) => ({ typeOptions: { choices } });
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [
      field('fS1','Name','text'),
      field('fS2','Status','singleSelect', sel({ s1:{id:'s1',name:'Open'}, s2:{id:'s2',name:'Closed'} })) ] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [
      field('fD1','Name','text'),
      field('fD2','Status','singleSelect', sel({ d1:{id:'d1',name:'Open'} })) ] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const upd = plan.actions.filter(a => a.kind === 'updateField' && a.destFld === 'fD2');
    assert.equal(upd.length, 1, 'a select field that gained a choice should produce an updateField');
    assert.ok(upd[0].changes.typeOptions, 'carries typeOptions (source choice set; apply engine remaps/merges)');
  });
});

describe('diff plan contract (M2b extensions)', () => {
  it('reconcilePrimary carries sourcePrimaryFieldId; createField carries description', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'New', primaryFieldId: 'fS1', fields: [
      field('fS1', 'Name', 'text'),
      field('fS2', 'Note', 'multilineText', { description: 'hello' }),
    ] }] };
    const dest = { baseId: 'appD', tables: [] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const prim = plan.actions.find((a) => a.kind === 'reconcilePrimary');
    assert.equal(prim.sourcePrimaryFieldId, 'fS1');
    const note = plan.actions.find((a) => a.kind === 'createField' && a.name === 'Note');
    assert.equal(note.description, 'hello');
  });
});

describe('diff convergence (apply-aligned typeOptions)', () => {
  const sel = (id, name, names) => field(id, name, 'singleSelect', { typeOptions: { choices: Object.fromEntries(names.map((n, i) => [`sel${id}${i}`, { id: `sel${id}${i}`, name: n }])) } });

  it('no updateField when dest select is a superset of source choices', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [field('fS1', 'Name', 'text'), sel('fS2', 'Status', ['Open', 'Closed'])] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [field('fD1', 'Name', 'text'), sel('fD2', 'Status', ['Open', 'Closed', 'DestOnly'])] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    assert.equal(plan.actions.filter((a) => a.kind === 'updateField').length, 0);
  });

  it('updateField when source select has a choice dest lacks', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [field('fS1', 'Name', 'text'), sel('fS2', 'Status', ['Open', 'Closed', 'New'])] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [field('fD1', 'Name', 'text'), sel('fD2', 'Status', ['Open', 'Closed'])] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    const u = plan.actions.filter((a) => a.kind === 'updateField');
    assert.equal(u.length, 1);
    assert.equal(u[0].destFld, 'fD2');
  });

  it('no updateField when source typeOptions is empty but dest has options (no phantom {})', () => {
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'T', primaryFieldId: 'fS1', fields: [field('fS1', 'Name', 'text'), field('fS2', 'Note', 'text')] }] };
    const dest = { baseId: 'appD', tables: [{ id: 'tD', name: 'T', primaryFieldId: 'fD1', fields: [field('fD1', 'Name', 'text'), field('fD2', 'Note', 'text', { typeOptions: { validatorName: 'url' } })] }] };
    const plan = computePlan(src, dest, matchByName(src, dest));
    assert.equal(plan.actions.filter((a) => a.kind === 'updateField').length, 0);
  });
});
