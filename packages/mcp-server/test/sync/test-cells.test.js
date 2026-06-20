import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isWritableForRecords, coercePass1Cell, partitionLinkValue, linkRecId, coerceMappedValue } from '../../src/sync/cells.js';

const idmap = { fields: { fldSel: { destFld: 'fldSelD', choices: { selA: 'selAD', selB: 'selBD' } } } };

describe('cells.isWritableForRecords', () => {
  it('false for computed + link + attachment, true for scalar/select', () => {
    assert.equal(isWritableForRecords({ type: 'formula' }), false);
    assert.equal(isWritableForRecords({ type: 'multipleRecordLinks' }), false);
    assert.equal(isWritableForRecords({ type: 'foreignKey' }), false); // internal link type — must be remapped, not written raw
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
describe('cells.linkRecId', () => {
  it('string → string', () => {
    assert.equal(linkRecId('recXyz'), 'recXyz');
  });
  it('object with foreignRowId → foreignRowId', () => {
    assert.equal(linkRecId({ foreignRowId: 'recAbc' }), 'recAbc');
  });
  it('object with id → id', () => {
    assert.equal(linkRecId({ id: 'recDef' }), 'recDef');
  });
  it('object with both foreignRowId and id → foreignRowId preferred', () => {
    assert.equal(linkRecId({ foreignRowId: 'recA', id: 'recB' }), 'recA');
  });
  it('garbage object → null', () => {
    assert.equal(linkRecId({}), null);
    assert.equal(linkRecId({ other: 'val' }), null);
  });
  it('null/undefined → null', () => {
    assert.equal(linkRecId(null), null);
    assert.equal(linkRecId(undefined), null);
  });
});

describe('cells.partitionLinkValue', () => {
  const m = { records: { recS1: 'recD1', recS2: 'recD2' } };
  it('splits resolved vs unresolved by the record map', () => {
    assert.deepEqual(partitionLinkValue(['recS1', 'recS2', 'recX'], m), { resolved: ['recD1', 'recD2'], unresolved: ['recX'] });
  });
  it('handles mixed string and object shapes in source link cell', () => {
    assert.deepEqual(
      partitionLinkValue([{ foreignRowId: 'recS1' }, { id: 'recS2' }, 'recS3'], { records: { recS1: 'recD1', recS2: 'recD2' } }),
      { resolved: ['recD1', 'recD2'], unresolved: ['recS3'] }
    );
  });
  it('null/empty → empty partition', () => {
    assert.deepEqual(partitionLinkValue(null, m), { resolved: [], unresolved: [] });
  });
});

describe('cells.coerceMappedValue', () => {
  it('passes a number through to a number target', () => {
    assert.deepEqual(coerceMappedValue(1042, 'number'), { write: true, value: 1042 });
  });
  it('stringifies for a text target', () => {
    assert.deepEqual(coerceMappedValue(1042, 'text'), { write: true, value: '1042' });
  });
  it('passes null through (clears the cell)', () => {
    assert.deepEqual(coerceMappedValue(null, 'number'), { write: true, value: null });
  });
  it('refuses an array source value (defensive)', () => {
    assert.deepEqual(coerceMappedValue(['x'], 'text'), { write: false });
  });
});
