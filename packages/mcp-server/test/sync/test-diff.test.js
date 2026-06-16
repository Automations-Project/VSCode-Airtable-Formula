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
});
