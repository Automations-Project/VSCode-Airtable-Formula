import { classOf, compareFields } from '../../src/sync/compare.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── classOf tests (Task 1, kept here for completeness) ──────────────────────

test('classOf maps order keys to best-effort, sections to not-synced, rest to drift', () => {
  assert.equal(classOf('type'), 'drift');
  assert.equal(classOf('choices'), 'drift');
  assert.equal(classOf('fieldOrder'), 'best-effort');
  assert.equal(classOf('viewOrder'), 'best-effort');
  assert.equal(classOf('columnOrder'), 'best-effort');
  assert.equal(classOf('sortOrder'), 'best-effort');
  assert.equal(classOf('sections'), 'not-synced');
  assert.equal(classOf('somethingElse'), 'drift'); // default
});

// ── compareFields tests (Task 2) ─────────────────────────────────────────────

function fld(id, name, type, extra = {}) {
  return {
    id,
    name,
    type,
    typeOptions: extra.typeOptions ?? null,
    description: extra.description ?? null,
    isComputed: !!extra.isComputed,
  };
}

describe('compareFields', () => {
  test('detects type drift', () => {
    const src = { fields: [fld('s1', 'Price', 'number')] };
    const dest = { fields: [fld('d1', 'Price', 'text')] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    assert.deepEqual(
      entries.find((e) => e.key === 'type'),
      { scope: 'field:Price', key: 'type', source: 'number', dest: 'text', class: 'drift' },
    );
  });

  test('detects description drift', () => {
    const src = { fields: [fld('s1', 'Notes', 'text', { description: 'new desc' })] };
    const dest = { fields: [fld('d1', 'Notes', 'text', { description: 'old desc' })] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    assert.deepEqual(
      entries.find((e) => e.key === 'description'),
      { scope: 'field:Notes', key: 'description', source: 'new desc', dest: 'old desc', class: 'drift' },
    );
  });

  test('detects choices drift when source has a choice dest lacks', () => {
    const srcOpts = { choices: { s1: { id: 's1', name: 'Open' }, s2: { id: 's2', name: 'Closed' } } };
    const destOpts = { choices: { d1: { id: 'd1', name: 'Open' } } };
    const src = { fields: [fld('s1', 'Status', 'singleSelect', { typeOptions: srcOpts })] };
    const dest = { fields: [fld('d1', 'Status', 'singleSelect', { typeOptions: destOpts })] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    const choicesEntry = entries.find((e) => e.key === 'choices');
    assert.ok(choicesEntry, 'should emit choices drift entry');
    assert.equal(choicesEntry.scope, 'field:Status');
    assert.equal(choicesEntry.class, 'drift');
  });

  test('no choices drift when dest is a superset of src choices', () => {
    const srcOpts = { choices: { s1: { id: 's1', name: 'Open' } } };
    const destOpts = { choices: { d1: { id: 'd1', name: 'Open' }, d2: { id: 'd2', name: 'Extra' } } };
    const src = { fields: [fld('s1', 'Status', 'singleSelect', { typeOptions: srcOpts })] };
    const dest = { fields: [fld('d1', 'Status', 'singleSelect', { typeOptions: destOpts })] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    assert.ok(!entries.find((e) => e.key === 'choices'), 'dest superset of src → no choices drift');
  });

  test('flags field order as best-effort when sequence differs', () => {
    const mk = (names) => ({ fields: names.map((n) => fld(n, n, 'text')) });
    const idmap = { fields: { A: { destFld: 'A', choices: {} }, B: { destFld: 'B', choices: {} } } };
    const { entries } = compareFields(mk(['A', 'B']), mk(['B', 'A']), idmap);
    const o = entries.find((e) => e.key === 'fieldOrder');
    assert.ok(o, 'fieldOrder entry should exist');
    assert.equal(o.class, 'best-effort');
    assert.deepEqual([o.source, o.dest], [['A', 'B'], ['B', 'A']]);
  });

  test('no fieldOrder entry when sequence is identical', () => {
    const mk = (names) => ({ fields: names.map((n) => fld(n, n, 'text')) });
    const idmap = { fields: { A: { destFld: 'A', choices: {} }, B: { destFld: 'B', choices: {} } } };
    const { entries } = compareFields(mk(['A', 'B']), mk(['A', 'B']), idmap);
    assert.ok(!entries.find((e) => e.key === 'fieldOrder'), 'same order → no fieldOrder entry');
  });

  test('reports source-only field in onlyInSource, not as an entry', () => {
    const src = { fields: [fld('s1', 'A', 'text'), fld('s2', 'OnlySrc', 'text')] };
    const dest = { fields: [fld('d1', 'A', 'text')] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries, onlyInSource, onlyInDest } = compareFields(src, dest, idmap);
    assert.ok(onlyInSource.includes('OnlySrc'), 'OnlySrc in onlyInSource');
    assert.ok(!entries.some((e) => e.scope === 'field:OnlySrc'), 'no entries for OnlySrc');
    assert.deepEqual(onlyInDest, []);
  });

  test('reports dest-only field in onlyInDest, not as an entry', () => {
    const src = { fields: [fld('s1', 'A', 'text')] };
    const dest = { fields: [fld('d1', 'A', 'text'), fld('d2', 'OnlyDest', 'text')] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries, onlyInSource, onlyInDest } = compareFields(src, dest, idmap);
    assert.ok(onlyInDest.includes('OnlyDest'), 'OnlyDest in onlyInDest');
    assert.ok(!entries.some((e) => e.scope === 'field:OnlyDest'), 'no entries for OnlyDest');
    assert.deepEqual(onlyInSource, []);
  });

  test('identical fields produce no entries', () => {
    const src = { fields: [fld('s1', 'Price', 'number', { typeOptions: { precision: 2 } })] };
    const dest = { fields: [fld('d1', 'Price', 'number', { typeOptions: { precision: 2 } })] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries, onlyInSource, onlyInDest } = compareFields(src, dest, idmap);
    assert.deepEqual(entries, []);
    assert.deepEqual(onlyInSource, []);
    assert.deepEqual(onlyInDest, []);
  });

  test('matches fields by name via by-name fallback when idmap has no entry for a field', () => {
    // s2 not in idmap.fields but name matches d2 in dest
    const src = { fields: [fld('s1', 'A', 'text'), fld('s2', 'B', 'number')] };
    const dest = { fields: [fld('d1', 'A', 'text'), fld('d2', 'B', 'text')] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    const typeEntry = entries.find((e) => e.scope === 'field:B' && e.key === 'type');
    assert.ok(typeEntry, 'by-name fallback should find B and detect type drift');
    assert.equal(typeEntry.source, 'number');
    assert.equal(typeEntry.dest, 'text');
  });

  test('computed fields compared by canonical sig (id-stable)', () => {
    const srcOpts = { formulaTextParsed: '{s1}' };
    const destOpts = { formulaTextParsed: '{d1}' };
    const src = { fields: [
      fld('s1', 'Name', 'text'),
      fld('s2', 'Total', 'formula', { isComputed: true, typeOptions: srcOpts }),
    ] };
    const dest = { fields: [
      fld('d1', 'Name', 'text'),
      fld('d2', 'Total', 'formula', { isComputed: true, typeOptions: destOpts }),
    ] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} }, s2: { destFld: 'd2', choices: {} } } };
    // Same formula referencing same-named field → no typeOptions drift
    const { entries } = compareFields(src, dest, idmap);
    assert.ok(!entries.find((e) => e.key === 'typeOptions'), 'id-stable formula should not produce typeOptions drift');
  });
});
