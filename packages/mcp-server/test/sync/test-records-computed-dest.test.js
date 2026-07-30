// Regression: the record sync must NEVER write to a COMPUTED dest field. The live failure was a
// scalar/valued source field name-matched to a computed dest field (a lookup/rollup, fldOwLeUB4tLYxGXt)
// → the row create POST returned 403 INVALID_PERMISSIONS ("Field ... cannot be updated"), which fails
// the WHOLE row (0 created). buildCreateCells never received destComputedFldIds; buildUpdateCells
// only consulted it on the clear path. Both now skip a cell whose DEST field is computed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateCells, buildUpdateCells } from '../../src/sync/records.js';

const srcFields = [
  { id: 'fldScalar', type: 'number' },   // writable source
  { id: 'fldName', type: 'text' },        // writable source
];
const srcCells = { fldScalar: 5, fldName: 'Alice' };
const idmap = {
  fields: {
    fldScalar: { destFld: 'fldRollup' },  // → COMPUTED dest field
    fldName:   { destFld: 'fldNameDest' },// → writable dest field
  },
  choices: {},
};

test('buildCreateCells omits a cell whose DEST field is computed', () => {
  const computed = new Set(['fldRollup']);
  const cells = buildCreateCells(srcFields, srcCells, idmap, [], 'recS', computed);
  assert.equal(cells.fldRollup, undefined, 'computed dest field is NOT in the create payload');
  assert.equal(cells.fldNameDest, 'Alice', 'the writable dest field IS written');
});

test('control: without the computed-dest guard the field WOULD be written (proves the guard is load-bearing)', () => {
  const cells = buildCreateCells(srcFields, srcCells, idmap, [], 'recS', new Set());
  assert.equal(cells.fldRollup, 5, 'no guard → the bad write is present');
});

test('buildUpdateCells omits a cell whose DEST field is computed (write path, not just clear path)', () => {
  const computed = new Set(['fldRollup']);
  const destCells = { fldRollup: 99, fldNameDest: 'Bob' };
  const cells = buildUpdateCells(srcFields, srcCells, destCells, idmap, [], 'recS', computed);
  assert.equal(cells.fldRollup, undefined, 'computed dest field is NOT in the update payload');
  assert.equal(cells.fldNameDest, 'Alice', 'the writable dest field IS updated');
});

test('buildUpdateCells does not emit a cleared-cell null into a computed dest field', () => {
  const computed = new Set(['fldRollup']);
  const clearedSrc = { fldName: 'Alice' }; // fldScalar ABSENT = cleared on source
  const destCells = { fldRollup: 99 };      // dest still holds a value
  const cells = buildUpdateCells(srcFields, clearedSrc, destCells, idmap, [], 'recS', computed);
  assert.equal('fldRollup' in cells, false, 'no null clear into a computed dest field');
});
