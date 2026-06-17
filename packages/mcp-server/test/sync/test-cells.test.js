import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isWritableForRecords, coercePass1Cell, partitionLinkValue } from '../../src/sync/cells.js';

const idmap = { fields: { fldSel: { destFld: 'fldSelD', choices: { selA: 'selAD', selB: 'selBD' } } } };

describe('cells.isWritableForRecords', () => {
  it('false for computed + link + attachment, true for scalar/select', () => {
    assert.equal(isWritableForRecords({ type: 'formula' }), false);
    assert.equal(isWritableForRecords({ type: 'multipleRecordLinks' }), false);
    assert.equal(isWritableForRecords({ type: 'multipleAttachments' }), false);
    assert.equal(isWritableForRecords({ type: 'text' }), true);
    assert.equal(isWritableForRecords({ type: 'select' }), true);
  });
});
describe('cells.coercePass1Cell', () => {
  it('passes scalars through', () => {
    assert.deepEqual(coercePass1Cell({ id: 'fldT', type: 'text' }, 'hi', idmap), { write: true, value: 'hi' });
  });
  it('remaps a single-select choice id', () => {
    assert.deepEqual(coercePass1Cell({ id: 'fldSel', type: 'select' }, 'selA', idmap), { write: true, value: 'selAD' });
  });
  it('remaps a multi-select choice array', () => {
    assert.deepEqual(coercePass1Cell({ id: 'fldSel', type: 'multiSelect' }, ['selA', 'selB'], idmap), { write: true, value: ['selAD', 'selBD'] });
  });
  it('does not write link / attachment / computed cells in pass 1', () => {
    assert.equal(coercePass1Cell({ id: 'fldL', type: 'multipleRecordLinks' }, ['rec1'], idmap).write, false);
    assert.equal(coercePass1Cell({ id: 'fldF', type: 'formula' }, 5, idmap).write, false);
  });
  it('drops an unmappable choice id (reports via write:false)', () => {
    assert.equal(coercePass1Cell({ id: 'fldSel', type: 'select' }, 'selUNKNOWN', idmap).write, false);
  });
});
describe('cells.partitionLinkValue', () => {
  const m = { records: { recS1: 'recD1', recS2: 'recD2' } };
  it('splits resolved vs unresolved by the record map', () => {
    assert.deepEqual(partitionLinkValue(['recS1', 'recS2', 'recX'], m), { resolved: ['recD1', 'recD2'], unresolved: ['recX'] });
  });
  it('null/empty → empty partition', () => {
    assert.deepEqual(partitionLinkValue(null, m), { resolved: [], unresolved: [] });
  });
});
