import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema, isComputedType } from '../../src/sync/snapshot.js';

describe('snapshot.isComputedType', () => {
  it('flags computed types and not writable ones', () => {
    assert.equal(isComputedType('formula'), true);
    assert.equal(isComputedType('rollup'), true);
    assert.equal(isComputedType('lookup'), true);
    assert.equal(isComputedType('count'), true);
    assert.equal(isComputedType('button'), true);
    assert.equal(isComputedType('text'), false);
    assert.equal(isComputedType('multiSelect'), false);
  });
});

describe('snapshot.normalizeSchema', () => {
  const raw = { data: { tableSchemas: [
    { id: 'tbl1', name: 'Offers', primaryColumnId: 'fldA', columns: [
      { id: 'fldA', name: 'Name', type: 'text', typeOptions: null, description: null },
      { id: 'fldB', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: 'SUM(1)' }, description: 'd' },
    ] },
  ] } };
  it('flattens tables + fields with computed flags and primary id', () => {
    const snap = normalizeSchema(raw);
    assert.equal(snap.tables.length, 1);
    const t = snap.tables[0];
    assert.equal(t.id, 'tbl1');
    assert.equal(t.name, 'Offers');
    assert.equal(t.primaryFieldId, 'fldA');
    assert.equal(t.fields.length, 2);
    assert.equal(t.fields[0].isComputed, false);
    assert.equal(t.fields[1].isComputed, true);
    assert.equal(t.fields[1].typeOptions.formulaTextParsed, 'SUM(1)');
  });
  it('falls back to .tables and first column for primary', () => {
    const snap = normalizeSchema({ data: { tables: [{ id: 'tbl2', name: 'X', fields: [{ id: 'fldZ', name: 'P', type: 'text' }] }] } });
    assert.equal(snap.tables[0].primaryFieldId, 'fldZ');
  });
});
