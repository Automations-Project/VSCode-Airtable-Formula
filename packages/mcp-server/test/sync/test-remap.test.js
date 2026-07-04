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
  it('detects display-format divergence on a formula (same formula, different format options)', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: '{fldA}*2', format: 'currency', symbol: '$', precision: 2 }, srcNames);
    const d = canonicalizeComputed('formula', { formulaTextParsed: '{fldX}*2', format: 'decimal', precision: 0 }, destNames);
    assert.notEqual(s, d);
  });
  it('identical format options canonicalize equal across bases', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: '{fldA}*2', format: 'currency', symbol: '$', precision: 2 }, srcNames);
    const d = canonicalizeComputed('formula', { formulaTextParsed: '{fldX}*2', format: 'currency', symbol: '$', precision: 2 }, destNames);
    assert.equal(s, d);
  });
  it('detects dateFormat divergence on a date-typed formula', () => {
    const s = canonicalizeComputed('formula', { formulaTextParsed: 'CREATED_TIME()', isDateTime: true, dateFormat: 'Local' }, {});
    const d = canonicalizeComputed('formula', { formulaTextParsed: 'CREATED_TIME()', isDateTime: true, dateFormat: 'ISO' }, {});
    assert.notEqual(s, d);
  });
  it('IGNORES format divergence on lookup/count (apply cannot write their format — would never converge)', () => {
    const sL = canonicalizeComputed('lookup', { relationColumnId: 'fldA', foreignTableRollupColumnId: 'fldB', format: 'currency' }, srcNames);
    const dL = canonicalizeComputed('lookup', { relationColumnId: 'fldX', foreignTableRollupColumnId: 'fldY' }, destNames);
    assert.equal(sL, dL);
    const sC = canonicalizeComputed('count', { relationColumnId: 'fldA', format: 'decimal' }, srcNames);
    const dC = canonicalizeComputed('count', { relationColumnId: 'fldX' }, destNames);
    assert.equal(sC, dC);
  });
});
