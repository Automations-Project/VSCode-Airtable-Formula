import { classOf, compareFields, compare } from '../../src/sync/compare.js';
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

  // ── I1: guard choices comparison on type-match ───────────────────────────
  test('I1: type mismatch with src singleSelect emits exactly one type entry and no choices entry', () => {
    // src is singleSelect (has choices), dest is number — types differ.
    // Before the fix this emitted BOTH a 'type' entry AND a spurious 'choices' entry.
    const srcOpts = { choices: { s1: { id: 's1', name: 'Open' } } };
    const src = { fields: [fld('s1', 'Status', 'singleSelect', { typeOptions: srcOpts })] };
    const dest = { fields: [fld('d1', 'Status', 'number')] };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries } = compareFields(src, dest, idmap);
    const typeEntries = entries.filter((e) => e.key === 'type');
    const choicesEntries = entries.filter((e) => e.key === 'choices');
    assert.equal(typeEntries.length, 1, 'should emit exactly one type entry');
    assert.equal(choicesEntries.length, 0, 'should emit no choices entry when types differ');
  });

  // ── I2: by-name fallback tracks matched dest by id ───────────────────────
  test('I2: by-name fallback tracks matched dest fields by id (no duplicate match)', () => {
    // Two src fields with different names, but the by-name fallback is what we're testing.
    // Specifically: once a dest field is matched it must not be counted as onlyInDest,
    // and the second src field with no idmap entry that has no name match goes to onlyInSource.
    const src = {
      fields: [
        fld('s1', 'Alpha', 'text'),  // matched by idmap → d1
        fld('s2', 'Beta', 'text'),   // no idmap entry, no name match in dest → onlyInSource
      ],
    };
    const dest = {
      fields: [
        fld('d1', 'Alpha', 'text'),  // matched by idmap
      ],
    };
    const idmap = { fields: { s1: { destFld: 'd1', choices: {} } } };
    const { entries, onlyInSource, onlyInDest } = compareFields(src, dest, idmap);
    // Alpha should be matched (no type drift), Beta should be in onlyInSource, dest has nothing extra
    assert.ok(!entries.some((e) => e.scope === 'field:Alpha'), 'no drift on identical Alpha');
    assert.ok(onlyInSource.includes('Beta'), 'Beta in onlyInSource');
    assert.deepEqual(onlyInDest, [], 'no dest-only fields');
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

// ── compare() top-level tests (Task 4) ──────────────────────────────────────

function mkSnap(baseId, tables) {
  return { baseId, tables };
}

function mkTable(id, name, fields, views = []) {
  return { id, name, primaryFieldId: fields[0]?.id ?? null, fields, views, sections: [] };
}

describe('compare', () => {
  test('identical snapshots → identical:true, converged:true, summary all zero', () => {
    const tableA = mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text'), fld('sf2', 'Value', 'number')]);
    const destA = mkTable('dt1', 'Alpha', [fld('df1', 'Name', 'text'), fld('df2', 'Value', 'number')]);
    const srcSnap = mkSnap('srcBase', [tableA]);
    const destSnap = mkSnap('destBase', [destA]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} }, sf2: { destFld: 'df2', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.sourceBaseId, 'srcBase');
    assert.equal(result.destBaseId, 'destBase');
    assert.equal(result.identical, true);
    assert.equal(result.converged, true);
    assert.equal(result.summary.drift, 0);
    assert.equal(result.summary.bestEffort, 0);
    assert.equal(result.summary.notSynced, 0);
    assert.equal(result.summary.onlyInSourceTables, 0);
    assert.equal(result.summary.onlyInDestTables, 0);
    assert.deepEqual(result.onlyInSourceTables, []);
    assert.deepEqual(result.onlyInDestTables, []);
    assert.equal(result.tables.length, 1);
    assert.equal(result.tables[0].status, 'same');
  });

  test('one reordered field → identical:false, converged:true, bestEffort===1', () => {
    // Fields A and B exist in both, but order is reversed in dest.
    // Both tables must have the same primary field NAME ('A') so primaryFieldName is not a drift source.
    const srcTable = { ...mkTable('st1', 'Alpha', [fld('sf1', 'A', 'text'), fld('sf2', 'B', 'text')]), primaryFieldId: 'sf1' };
    const destTable = { ...mkTable('dt1', 'Alpha', [fld('df2', 'B', 'text'), fld('df1', 'A', 'text')]), primaryFieldId: 'df1' };
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} }, sf2: { destFld: 'df2', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.identical, false);
    assert.equal(result.converged, true);
    assert.equal(result.summary.bestEffort, 1, 'exactly one best-effort entry for fieldOrder');
    assert.equal(result.summary.drift, 0);
  });

  test('one type change → converged:false, drift>=1', () => {
    const srcTable = mkTable('st1', 'Alpha', [fld('sf1', 'Price', 'number')]);
    const destTable = mkTable('dt1', 'Alpha', [fld('df1', 'Price', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.identical, false);
    assert.equal(result.converged, false);
    assert.ok(result.summary.drift >= 1, `drift should be >=1 (got ${result.summary.drift})`);
  });

  test('unmatched src table appears in onlyInSourceTables with count', () => {
    const srcTable = mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', []);
    const idmap = { tables: {}, fields: {}, views: {} };
    const result = compare(srcSnap, destSnap, idmap);
    assert.deepEqual(result.onlyInSourceTables, ['Alpha']);
    assert.equal(result.summary.onlyInSourceTables, 1);
    assert.equal(result.identical, false);
    assert.equal(result.converged, false, 'missing dest table counts as not-converged (I1 fix)');
  });

  test('unmatched dest table appears in onlyInDestTables with count', () => {
    const destTable = mkTable('dt1', 'Beta', [fld('df1', 'Name', 'text')]);
    const srcSnap = mkSnap('srcBase', []);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = { tables: {}, fields: {}, views: {} };
    const result = compare(srcSnap, destSnap, idmap);
    assert.deepEqual(result.onlyInDestTables, ['Beta']);
    assert.equal(result.summary.onlyInDestTables, 1);
    assert.equal(result.identical, false);
  });

  test('by-name fallback matches table when idmap.tables has no entry', () => {
    // Tables have same name but no idmap entry → should match by name
    const srcTable = mkTable('st1', 'MyTable', [fld('sf1', 'X', 'text')]);
    const destTable = mkTable('dt1', 'MyTable', [fld('df1', 'X', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = { tables: {}, fields: {}, views: {} };
    const result = compare(srcSnap, destSnap, idmap);
    assert.deepEqual(result.onlyInSourceTables, []);
    assert.deepEqual(result.onlyInDestTables, []);
    assert.equal(result.tables.length, 1);
    assert.equal(result.identical, true);
    assert.equal(result.converged, true);
  });

  // ── I1 (converged fix) tests ─────────────────────────────────────────────

  test('I1: source has a table dest lacks → converged:false, identical:false', () => {
    // onlyInSourceTables is non-empty; sync would need to createTable → not converged.
    const srcTable = mkTable('st1', 'MissingInDest', [fld('sf1', 'Name', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', []);
    const idmap = { tables: {}, fields: {}, views: {} };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.converged, false, 'missing dest table → converged must be false');
    assert.equal(result.identical, false);
    assert.deepEqual(result.onlyInSourceTables, ['MissingInDest']);
  });

  test('I1: source has a field dest lacks within a matched table → converged:false', () => {
    // Matched table "Alpha" but src has an extra field "Extra" absent in dest.
    // Sync would need to createField → not converged.
    const srcTable = mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text'), fld('sf2', 'Extra', 'number')]);
    const destTable = mkTable('dt1', 'Alpha', [fld('df1', 'Name', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.converged, false, 'missing dest field → converged must be false');
    assert.equal(result.identical, false);
    assert.ok(result.tables[0].fields.onlyInSource.includes('Extra'));
  });

  test('I1: dest has an extra table/field (onlyInDest only) → converged:true, identical:false', () => {
    // Orphan dest table and orphan dest field — sync never deletes them.
    // converged must remain true; identical must be false.
    const srcTable = mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text')]);
    const destTable = mkTable('dt1', 'Alpha', [fld('df1', 'Name', 'text'), fld('df2', 'OrphanField', 'text')]);
    const destExtra = mkTable('dt2', 'OrphanTable', [fld('df3', 'X', 'text')]);
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable, destExtra]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.converged, true, 'orphan dest items must not break convergence');
    assert.equal(result.identical, false, 'orphan items still break identity');
    assert.deepEqual(result.onlyInDestTables, ['OrphanTable']);
    assert.ok(result.tables[0].fields.onlyInDest.includes('OrphanField'));
  });

  test('I1: best-effort-only diff (field reorder) still yields converged:true', () => {
    // Confirm the pre-existing best-effort-only case is unaffected by the fix.
    const srcTable = { ...mkTable('st1', 'Alpha', [fld('sf1', 'A', 'text'), fld('sf2', 'B', 'text')]), primaryFieldId: 'sf1' };
    const destTable = { ...mkTable('dt1', 'Alpha', [fld('df2', 'B', 'text'), fld('df1', 'A', 'text')]), primaryFieldId: 'df1' };
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} }, sf2: { destFld: 'df2', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.converged, true, 'best-effort-only diff must still yield converged:true');
    assert.equal(result.identical, false);
    assert.equal(result.summary.bestEffort, 1);
    assert.equal(result.summary.drift, 0);
  });

  test('summary counts aggregate drift and best-effort across multiple tables', () => {
    // Table1: type drift (drift+1), Table2: field reorder (bestEffort+1).
    // Both tables must have matching primary field names to isolate the intended diffs.
    const t1Src = mkTable('st1', 'T1', [fld('sf1', 'A', 'number')]);
    const t1Dest = mkTable('dt1', 'T1', [fld('df1', 'A', 'text')]);
    const t2Src = { ...mkTable('st2', 'T2', [fld('sf2', 'X', 'text'), fld('sf3', 'Y', 'text')]), primaryFieldId: 'sf2' };
    const t2Dest = { ...mkTable('dt2', 'T2', [fld('df3', 'Y', 'text'), fld('df2', 'X', 'text')]), primaryFieldId: 'df2' };
    const srcSnap = mkSnap('srcBase', [t1Src, t2Src]);
    const destSnap = mkSnap('destBase', [t1Dest, t2Dest]);
    const idmap = {
      tables: { st1: 'dt1', st2: 'dt2' },
      fields: {
        sf1: { destFld: 'df1', choices: {} },
        sf2: { destFld: 'df2', choices: {} },
        sf3: { destFld: 'df3', choices: {} },
      },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    assert.equal(result.summary.drift, 1, 'one type drift in T1');
    assert.equal(result.summary.bestEffort, 1, 'one fieldOrder in T2');
    assert.equal(result.identical, false);
    assert.equal(result.converged, false, 'has drift → not converged');
  });
});

// ── Section id-strip tests (Task 1) ─────────────────────────────────────────────

describe('compare — sections id-strip', () => {
  test('same name+viewNames but different vsc ids → NO sections entry (id stripped from comparison)', () => {
    // src section has id 'vscSRC', dest section has id 'vscDEST', but name+viewNames identical.
    // compare() must NOT emit a key:'sections' entry.
    const srcTable = {
      ...mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text')]),
      sections: [{ id: 'vscSRC', name: 'Group A', viewNames: ['Grid'] }],
    };
    const destTable = {
      ...mkTable('dt1', 'Alpha', [fld('df1', 'Name', 'text')]),
      sections: [{ id: 'vscDEST', name: 'Group A', viewNames: ['Grid'] }],
    };
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    const sectionsEntry = result.tables.flatMap((t) => t.entries).find((e) => e.key === 'sections');
    assert.ok(!sectionsEntry, 'same name+viewNames with different ids must NOT produce a sections entry');
    assert.equal(result.converged, true);
    assert.equal(result.identical, true);
  });

  test('different section names → sections entry IS emitted (not-synced)', () => {
    const srcTable = {
      ...mkTable('st1', 'Alpha', [fld('sf1', 'Name', 'text')]),
      sections: [{ id: 'vscSRC', name: 'Group A', viewNames: ['Grid'] }],
    };
    const destTable = {
      ...mkTable('dt1', 'Alpha', [fld('df1', 'Name', 'text')]),
      sections: [{ id: 'vscDEST', name: 'Group B', viewNames: ['Grid'] }],
    };
    const srcSnap = mkSnap('srcBase', [srcTable]);
    const destSnap = mkSnap('destBase', [destTable]);
    const idmap = {
      tables: { st1: 'dt1' },
      fields: { sf1: { destFld: 'df1', choices: {} } },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    const sectionsEntry = result.tables.flatMap((t) => t.entries).find((e) => e.key === 'sections');
    assert.ok(sectionsEntry, 'different section names must produce a sections entry');
    assert.equal(sectionsEntry.class, 'not-synced');
    // source/dest should be the FULL sections (with id)
    assert.deepEqual(sectionsEntry.source, srcTable.sections);
    assert.deepEqual(sectionsEntry.dest, destTable.sections);
  });
});

// ── Bug fix tests: cross-base computed/link ref canonicalization ──────────────

describe('compareFields — cross-base ref canonicalization', () => {
  // Bug 1: rollup with foreignTableRollupColumnId in ANOTHER table
  test('Bug1: rollup referencing field in another table — different raw ids, same name → no typeOptions drift', () => {
    // "Revenue" table has a rollup field "Total" that rolls up "Amount" from "Orders" table.
    // Src: foreignTableRollupColumnId = 'fldSrcAmount' (field in Orders table, not Revenue)
    // Dest: foreignTableRollupColumnId = 'fldDestAmount' (same logical field, different id)
    // Both map to the name 'Amount'. With a global fldNames map, computedSig resolves both
    // to '{{Amount}}' → sigs match → no drift.
    const srcSnap = {
      baseId: 'srcBase',
      tables: [
        {
          id: 'tSrcOrders', name: 'Orders', primaryFieldId: 'fSrcOrderName',
          fields: [
            { id: 'fSrcOrderName', name: 'Order Name', type: 'text', typeOptions: null, description: null, isComputed: false },
            { id: 'fSrcAmount', name: 'Amount', type: 'number', typeOptions: { precision: 2 }, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tSrcRevenue', name: 'Revenue', primaryFieldId: 'fSrcRevName',
          fields: [
            { id: 'fSrcRevName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
            { id: 'fSrcLink', name: 'Orders Link', type: 'foreignKey', typeOptions: { foreignTableId: 'tSrcOrders', symmetricColumnId: 'fSrcSym', relationship: 'many', unreversed: true }, description: null, isComputed: false },
            {
              id: 'fSrcTotal', name: 'Total', type: 'rollup',
              typeOptions: {
                relationColumnId: 'fSrcLink',
                foreignTableRollupColumnId: 'fSrcAmount', // field in ANOTHER table
                formulaTextParsed: 'SUM(values)',
              },
              description: null, isComputed: true,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const destSnap = {
      baseId: 'destBase',
      tables: [
        {
          id: 'tDestOrders', name: 'Orders', primaryFieldId: 'fDestOrderName',
          fields: [
            { id: 'fDestOrderName', name: 'Order Name', type: 'text', typeOptions: null, description: null, isComputed: false },
            { id: 'fDestAmount', name: 'Amount', type: 'number', typeOptions: { precision: 2 }, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tDestRevenue', name: 'Revenue', primaryFieldId: 'fDestRevName',
          fields: [
            { id: 'fDestRevName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
            { id: 'fDestLink', name: 'Orders Link', type: 'foreignKey', typeOptions: { foreignTableId: 'tDestOrders', symmetricColumnId: 'fDestSym', relationship: 'many', unreversed: true }, description: null, isComputed: false },
            {
              id: 'fDestTotal', name: 'Total', type: 'rollup',
              typeOptions: {
                relationColumnId: 'fDestLink',
                foreignTableRollupColumnId: 'fDestAmount', // different raw id, same name
                formulaTextParsed: 'SUM(values)',
              },
              description: null, isComputed: true,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const idmap = {
      tables: { tSrcOrders: 'tDestOrders', tSrcRevenue: 'tDestRevenue' },
      fields: {
        fSrcOrderName: { destFld: 'fDestOrderName', choices: {} },
        fSrcAmount: { destFld: 'fDestAmount', choices: {} },
        fSrcRevName: { destFld: 'fDestRevName', choices: {} },
        fSrcLink: { destFld: 'fDestLink', choices: {} },
        fSrcTotal: { destFld: 'fDestTotal', choices: {} },
      },
      views: {},
    };
    // compare() is the top-level entry point that threads snapshots to compareFields
    const result = compare(srcSnap, destSnap, idmap);
    const typeOptsDrift = result.tables
      .flatMap((t) => t.entries)
      .filter((e) => e.key === 'typeOptions' && e.scope === 'field:Total');
    assert.deepEqual(typeOptsDrift, [], 'rollup with cross-table foreignTableRollupColumnId must not produce typeOptions drift when target field name is the same');
  });

  // Bug 2a: link field — same target table name, different raw ids → NO drift
  test('Bug2a: link field — same target table name, different foreignTableId → no typeOptions drift', () => {
    const srcSnap = {
      baseId: 'srcBase',
      tables: [
        {
          id: 'tSrcProjects', name: 'Projects', primaryFieldId: 'fSrcProjName',
          fields: [
            { id: 'fSrcProjName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tSrcTasks', name: 'Tasks', primaryFieldId: 'fSrcTaskName',
          fields: [
            { id: 'fSrcTaskName', name: 'Task', type: 'text', typeOptions: null, description: null, isComputed: false },
            {
              id: 'fSrcLink', name: 'Project', type: 'foreignKey',
              typeOptions: {
                foreignTableId: 'tSrcProjects',   // raw src table id
                symmetricColumnId: 'fSrcSymLink',  // raw src field id (reciprocal)
                relationship: 'many',
                unreversed: true,
              },
              description: null, isComputed: false,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const destSnap = {
      baseId: 'destBase',
      tables: [
        {
          id: 'tDestProjects', name: 'Projects', primaryFieldId: 'fDestProjName',
          fields: [
            { id: 'fDestProjName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tDestTasks', name: 'Tasks', primaryFieldId: 'fDestTaskName',
          fields: [
            { id: 'fDestTaskName', name: 'Task', type: 'text', typeOptions: null, description: null, isComputed: false },
            {
              id: 'fDestLink', name: 'Project', type: 'foreignKey',
              typeOptions: {
                foreignTableId: 'tDestProjects',   // different raw id but same TABLE NAME
                symmetricColumnId: 'fDestSymLink',  // different raw id (but irrelevant — dropped)
                relationship: 'many',
                unreversed: true,
              },
              description: null, isComputed: false,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const idmap = {
      tables: { tSrcProjects: 'tDestProjects', tSrcTasks: 'tDestTasks' },
      fields: {
        fSrcProjName: { destFld: 'fDestProjName', choices: {} },
        fSrcTaskName: { destFld: 'fDestTaskName', choices: {} },
        fSrcLink: { destFld: 'fDestLink', choices: {} },
      },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    const typeOptsDrift = result.tables
      .flatMap((t) => t.entries)
      .filter((e) => e.key === 'typeOptions' && e.scope === 'field:Project');
    assert.deepEqual(typeOptsDrift, [], 'link field pointing to same-named table must not produce typeOptions drift');
    assert.equal(result.converged, true, 'synced link field should be converged');
  });

  // Bug 2b: link field — genuinely different target table → MUST drift
  test('Bug2b: link field — different target table name → typeOptions drift IS emitted', () => {
    const srcSnap = {
      baseId: 'srcBase',
      tables: [
        {
          id: 'tSrcProjects', name: 'Projects', primaryFieldId: 'fSrcProjName',
          fields: [
            { id: 'fSrcProjName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tSrcClients', name: 'Clients', primaryFieldId: 'fSrcClientName',
          fields: [
            { id: 'fSrcClientName', name: 'Client', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tSrcTasks', name: 'Tasks', primaryFieldId: 'fSrcTaskName',
          fields: [
            { id: 'fSrcTaskName', name: 'Task', type: 'text', typeOptions: null, description: null, isComputed: false },
            {
              id: 'fSrcLink', name: 'Related', type: 'foreignKey',
              typeOptions: {
                foreignTableId: 'tSrcProjects',   // links to Projects
                symmetricColumnId: 'fSrcSym',
                relationship: 'many',
                unreversed: true,
              },
              description: null, isComputed: false,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const destSnap = {
      baseId: 'destBase',
      tables: [
        {
          id: 'tDestProjects', name: 'Projects', primaryFieldId: 'fDestProjName',
          fields: [
            { id: 'fDestProjName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tDestClients', name: 'Clients', primaryFieldId: 'fDestClientName',
          fields: [
            { id: 'fDestClientName', name: 'Client', type: 'text', typeOptions: null, description: null, isComputed: false },
          ],
          views: [], sections: [],
        },
        {
          id: 'tDestTasks', name: 'Tasks', primaryFieldId: 'fDestTaskName',
          fields: [
            { id: 'fDestTaskName', name: 'Task', type: 'text', typeOptions: null, description: null, isComputed: false },
            {
              id: 'fDestLink', name: 'Related', type: 'foreignKey',
              typeOptions: {
                foreignTableId: 'tDestClients',   // links to Clients — DIFFERENT table!
                symmetricColumnId: 'fDestSym',
                relationship: 'many',
                unreversed: true,
              },
              description: null, isComputed: false,
            },
          ],
          views: [], sections: [],
        },
      ],
    };
    const idmap = {
      tables: { tSrcProjects: 'tDestProjects', tSrcClients: 'tDestClients', tSrcTasks: 'tDestTasks' },
      fields: {
        fSrcProjName: { destFld: 'fDestProjName', choices: {} },
        fSrcClientName: { destFld: 'fDestClientName', choices: {} },
        fSrcTaskName: { destFld: 'fDestTaskName', choices: {} },
        fSrcLink: { destFld: 'fDestLink', choices: {} },
      },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    const typeOptsDrift = result.tables
      .flatMap((t) => t.entries)
      .filter((e) => e.key === 'typeOptions' && e.scope === 'field:Related');
    assert.equal(typeOptsDrift.length, 1, 'link to genuinely different-named table MUST produce typeOptions drift');
    assert.equal(typeOptsDrift[0].class, 'drift');
  });

  // Regression: existing computed field test still works (table-local refs remain resolved)
  test('Regression: intra-table computed field (formula referencing own-table field) still no drift', () => {
    const srcSnap = {
      baseId: 'srcBase',
      tables: [{
        id: 'tSrc', name: 'T', primaryFieldId: 'fSrcName',
        fields: [
          { id: 'fSrcName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          {
            id: 'fSrcFormula', name: 'ShortName', type: 'formula',
            typeOptions: { formulaTextParsed: '{fSrcName}' },
            description: null, isComputed: true,
          },
        ],
        views: [], sections: [],
      }],
    };
    const destSnap = {
      baseId: 'destBase',
      tables: [{
        id: 'tDest', name: 'T', primaryFieldId: 'fDestName',
        fields: [
          { id: 'fDestName', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
          {
            id: 'fDestFormula', name: 'ShortName', type: 'formula',
            typeOptions: { formulaTextParsed: '{fDestName}' },
            description: null, isComputed: true,
          },
        ],
        views: [], sections: [],
      }],
    };
    const idmap = {
      tables: { tSrc: 'tDest' },
      fields: {
        fSrcName: { destFld: 'fDestName', choices: {} },
        fSrcFormula: { destFld: 'fDestFormula', choices: {} },
      },
      views: {},
    };
    const result = compare(srcSnap, destSnap, idmap);
    const typeOptsDrift = result.tables.flatMap((t) => t.entries).filter((e) => e.key === 'typeOptions');
    assert.deepEqual(typeOptsDrift, [], 'intra-table formula must still produce no drift');
  });
});
