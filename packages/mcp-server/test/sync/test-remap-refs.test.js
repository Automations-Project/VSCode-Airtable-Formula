import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remapRefs, toWritableComputedOptions } from '../../src/sync/remap.js';

const idmap = {
  tables: { tblSRC: 'tblDST' },
  fields: {
    fldA: { destFld: 'fldX', choices: {} },
    fldB: { destFld: 'fldY', choices: {} },
  },
};

describe('remap.remapRefs', () => {
  it('converts {column_value_fldX} + bare tokens to BARE dest ids (input form)', () => {
    const out = remapRefs({ formulaTextParsed: '{column_value_fldA}+{column_value_fldB}', formulaText: '{fldA}+fldB' }, idmap);
    assert.equal(out.formulaTextParsed, '{fldX}+{fldY}');
    assert.equal(out.formulaText, '{fldX}+fldB');
  });
  it('rewrites single-id ref keys and foreignTableId', () => {
    const out = remapRefs({ relationColumnId: 'fldA', foreignTableRollupColumnId: 'fldB', foreignTableId: 'tblSRC' }, idmap);
    assert.equal(out.relationColumnId, 'fldX');
    assert.equal(out.foreignTableRollupColumnId, 'fldY');
    assert.equal(out.foreignTableId, 'tblDST');
  });
  it('rewrites the dependencies array and leaves unknown ids intact', () => {
    const out = remapRefs({ dependencies: { referencedColumnIdsForValue: ['fldA', 'fldUNKNOWN'] } }, idmap);
    assert.deepEqual(out.dependencies.referencedColumnIdsForValue, ['fldX', 'fldUNKNOWN']);
  });
  it('deep-clones (does not mutate input)', () => {
    const input = { relationColumnId: 'fldA' };
    const out = remapRefs(input, idmap);
    assert.equal(input.relationColumnId, 'fldA');
    assert.notEqual(out, input);
  });
  it('passes null/undefined through', () => {
    assert.equal(remapRefs(null, idmap), null);
    assert.equal(remapRefs(undefined, idmap), undefined);
  });
});

describe('remap.toWritableComputedOptions', () => {
  it('formula: emits formulaText, drops read-only keys', () => {
    const remapped = remapRefs({ formulaTextParsed: '{column_value_fldA}*2', dependencies: { referencedColumnIdsForValue: ['fldA'] }, resultType: 'number', resultIsArray: false }, idmap);
    const w = toWritableComputedOptions('formula', remapped);
    assert.equal(w.formulaText, '{fldX}*2');
    assert.equal(w.formulaTextParsed, undefined);
    assert.equal(w.dependencies, undefined);
    assert.equal(w.resultType, undefined);
    assert.equal(w.resultIsArray, undefined);
  });
  it('formula: preserves whitelisted format keys (date-typed formula)', () => {
    const w = toWritableComputedOptions('formula', { formulaTextParsed: 'CREATED_TIME()', isDateTime: true, dateFormat: 'Local', timeZone: 'client', resultType: 'date' });
    assert.equal(w.formulaText, 'CREATED_TIME()');
    assert.equal(w.isDateTime, true);
    assert.equal(w.dateFormat, 'Local');
  });
  it('rollup: emits relation + target + formulaText', () => {
    const remapped = remapRefs({ relationColumnId: 'fldA', foreignTableRollupColumnId: 'fldB', formulaTextParsed: 'SUM(values)', resultType: 'number' }, idmap);
    const w = toWritableComputedOptions('rollup', remapped);
    assert.equal(w.relationColumnId, 'fldX');
    assert.equal(w.foreignTableRollupColumnId, 'fldY');
    assert.equal(w.formulaText, 'SUM(values)');
    assert.equal(w.resultType, undefined);
  });
  it('count: emits recordLinkFieldId only', () => {
    const remapped = remapRefs({ recordLinkFieldId: 'fldA', resultType: 'number' }, idmap);
    const w = toWritableComputedOptions('count', remapped);
    assert.equal(w.recordLinkFieldId, 'fldX');
    assert.equal(w.resultType, undefined);
  });
});
