import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeComputed } from '../../src/sync/remap.js';

describe('remap.canonicalizeComputed', () => {
  const srcNames = { fldA: 'Price', fldB: 'Qty' };
  const destNames = { fldX: 'Price', fldY: 'Qty' };

  it('makes two formulas with different field IDs but same names compare equal', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: '{fldA}*{fldB}' }, srcNames);
    const d = canonicalizeComputed('formula', { formulaTextParsed: '{fldX}*{fldY}' }, destNames);
    assert.equal(s, d);
  });
  it('detects a real formula difference', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: '{fldA}+{fldB}' }, srcNames);
    const d = canonicalizeComputed('formula', { formulaTextParsed: '{fldX}*{fldY}' }, destNames);
    assert.notEqual(s, d);
  });
  it('canonicalizes rollup relation/target columns by name', () => {
    const s = canonicalizeComputed('rollup', { relationColumnId: 'fldA', foreignTableRollupColumnId: 'fldB', formulaText: 'SUM(values)' }, srcNames);
    const d = canonicalizeComputed('rollup', { relationColumnId: 'fldX', foreignTableRollupColumnId: 'fldY', formulaText: 'SUM(values)' }, destNames);
    assert.equal(s, d);
  });
  it('treats an unknown ref id as itself (no crash)', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: '{fldUNKNOWN}+1' }, {});
    assert.match(s, /fldUNKNOWN/);
  });
});
