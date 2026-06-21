import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchByNaturalKeys } from '../../src/sync/records.js';

// helper builders
const tbl = (name, fields, records) => ({ id: 't' + name, name, fields, records });
const fld = (id, name, type = 'text') => ({ id, name, type });
const rec = (id, cells) => ({ id, cellValuesByColumnId: cells });
const fresh = () => ({ matched: 0, warnings: [], idmap: undefined });

function setup(srcRecs, dstRecs, idmapRecords = {}) {
  const src = { tables: [tbl('Customers', [fld('sEmail', 'Email')], srcRecs)] };
  const dst = { tables: [tbl('Customers', [fld('dEmail', 'Email')], dstRecs)] };
  const idmap = { tables: {}, fields: {}, records: { ...idmapRecords } };
  const result = { matched: 0, warnings: [] };
  return { src, dst, idmap, result };
}

describe('matchByNaturalKeys', () => {
  it('matches an unmapped src/dest pair sharing a key value', () => {
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: 'a@x.com' })],
      [rec('recD1', { dEmail: 'a@x.com' })]);
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(idmap.records.recS1, 'recD1');
    assert.equal(result.matched, 1);
  });
  it('leaves an existing mapping untouched (existing wins)', () => {
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: 'a@x.com' })],
      [rec('recD1', { dEmail: 'a@x.com' }), rec('recDold', { dEmail: 'a@x.com' })],
      { recS1: 'recDold' });
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(idmap.records.recS1, 'recDold');
    assert.equal(result.matched, 0);
  });
  it('ambiguous: two dest records share a key value → no match + warn', () => {
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: 'a@x.com' })],
      [rec('recD1', { dEmail: 'a@x.com' }), rec('recD2', { dEmail: 'a@x.com' })]);
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(idmap.records.recS1, undefined);
    assert.ok(result.warnings.some((w) => w.code === 'NATURAL_KEY_AMBIGUOUS'));
  });
  it('ambiguous: two unmapped src records share a key → no match + warn', () => {
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: 'a@x.com' }), rec('recS2', { sEmail: 'a@x.com' })],
      [rec('recD1', { dEmail: 'a@x.com' })]);
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(result.matched, 0);
    assert.ok(result.warnings.some((w) => w.code === 'NATURAL_KEY_AMBIGUOUS'));
  });
  it('empty/null key value → skip, no match', () => {
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: '' }), rec('recS2', { sEmail: null })],
      [rec('recD1', { dEmail: '' })]);
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(result.matched, 0);
  });
  it('missing key field on a side → NATURAL_KEY_FIELD_MISSING, table skipped', () => {
    const { src, dst, idmap, result } = setup([rec('recS1', { sEmail: 'a@x.com' })], [rec('recD1', { dEmail: 'a@x.com' })]);
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Ghost' }, idmap, result });
    assert.equal(result.matched, 0);
    assert.ok(result.warnings.some((w) => w.code === 'NATURAL_KEY_FIELD_MISSING'));
  });
  it('never claims an already-mapped dest (no stealing)', () => {
    // recD1 already mapped to recSold; recS1 (same key) must NOT steal it
    const { src, dst, idmap, result } = setup(
      [rec('recS1', { sEmail: 'a@x.com' })],
      [rec('recD1', { dEmail: 'a@x.com' })],
      { recSold: 'recD1' });
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Customers: 'Email' }, idmap, result });
    assert.equal(idmap.records.recS1, undefined);
    assert.equal(idmap.records.recSold, 'recD1');
  });
  it('matches on a computed (numeric) key value via String() compare', () => {
    const src = { tables: [tbl('Orders', [fld('sCode', 'Code', 'autoNumber')], [rec('recS1', { sCode: 1042 })])] };
    const dst = { tables: [tbl('Orders', [fld('dCode', 'Code', 'number')], [rec('recD1', { dCode: 1042 })])] };
    const idmap = { tables: {}, fields: {}, records: {} };
    const result = { matched: 0, warnings: [] };
    matchByNaturalKeys({ srcSnapshot: src, destSnapshot: dst, naturalKeys: { Orders: 'Code' }, idmap, result });
    assert.equal(idmap.records.recS1, 'recD1');
  });
});
