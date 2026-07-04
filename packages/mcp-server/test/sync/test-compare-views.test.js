// test-compare-views.test.js — TDD tests for Task 3: compareViews + compareTable
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareTable } from '../../src/sync/compare.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fld(id, name, type = 'text', extra = {}) {
  return {
    id,
    name,
    type,
    typeOptions: extra.typeOptions ?? null,
    description: extra.description ?? null,
    isComputed: !!extra.isComputed,
  };
}

function view(id, name, type = 'grid', config = {}, extra = {}) {
  return { id, name, type, config, ...extra };
}

/**
 * Minimal table fixture — fields/views/sections all optional.
 */
function tbl(id, name, primaryFieldId, fields = [], views = [], sections = []) {
  return { id, name, primaryFieldId, fields, views, sections };
}

/**
 * Minimal idmap fixture.
 */
function idmap({ tables = {}, fields = {}, views = {} } = {}) {
  return { tables, fields, views };
}

// ── compareTable — basic wiring ────────────────────────────────────────────────

describe('compareTable — basic wiring', () => {
  test('returns status=same for two identical empty tables', () => {
    const src = tbl('tS', 'T', 'p');
    const dest = tbl('tD', 'T', 'p');
    const r = compareTable(src, dest, idmap({ tables: { tS: 'tD' } }));
    assert.equal(r.name, 'T');
    assert.equal(r.status, 'same');
    assert.deepEqual(r.entries, []);
  });

  test('description drift produces a drift entry', () => {
    const src = { ...tbl('tS', 'T', 'p'), description: 'new' };
    const dest = { ...tbl('tD', 'T', 'p'), description: 'old' };
    const r = compareTable(src, dest, idmap({ tables: { tS: 'tD' } }));
    const e = r.entries.find((e) => e.key === 'description');
    assert.ok(e, 'description entry missing');
    assert.equal(e.class, 'drift');
    assert.equal(e.source, 'new');
    assert.equal(e.dest, 'old');
    assert.equal(r.status, 'differs');
  });

  test('primary field name change produces a drift entry', () => {
    const src = tbl('tS', 'T', 'pS', [fld('pS', 'Title')]);
    const dest = tbl('tD', 'T', 'pD', [fld('pD', 'Name')]);
    const im = idmap({ tables: { tS: 'tD' }, fields: { pS: { destFld: 'pD', choices: {} } } });
    const r = compareTable(src, dest, im);
    const e = r.entries.find((e) => e.key === 'primaryFieldName');
    assert.ok(e, 'primaryFieldName entry missing');
    assert.equal(e.class, 'drift');
    assert.equal(e.source, 'Title');
    assert.equal(e.dest, 'Name');
  });

  test('status is same when tables are identical with identical views', () => {
    const src = tbl('tS', 'T', 'pS', [fld('pS', 'Name')], [view('vS', 'Grid', 'grid', {})]);
    const dest = tbl('tD', 'T', 'pD', [fld('pD', 'Name')], [view('vD', 'Grid', 'grid', {})]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { pS: { destFld: 'pD', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    assert.equal(r.status, 'same');
  });
});

// ── compareViews — view type drift ────────────────────────────────────────────

describe('compareViews — view type mismatch (name+type matching)', () => {
  test('same-named view of a DIFFERENT type is NOT matched: reported as onlyInSource + onlyInDest', () => {
    // A view's type is immutable in Airtable — sync converges by creating the source-typed
    // view and orphaning the dest one, so compare must mirror that (no per-view drift entries).
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'MyView', 'grid', {})]);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'MyView', 'gallery', {})]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vD' } }); // stale name-only mapping is rejected
    const r = compareTable(src, dest, im);
    assert.ok(!r.entries.find((e) => e.scope === 'view:MyView'), 'no per-view entries for an unmatched pair');
    assert.deepEqual(r.views.onlyInSource, ['MyView']);
    assert.deepEqual(r.views.onlyInDest, ['MyView']);
  });

  test('falls back to a same-name same-type dest view when another same-named view of a different type exists', () => {
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Board', 'kanban', {})]);
    const dest = tbl('tD', 'T', 'p', [], [view('vD1', 'Board', 'grid', {}), view('vD2', 'Board', 'kanban', {})]);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.deepEqual(r.views.onlyInSource, []);
    assert.deepEqual(r.views.onlyInDest, ['Board']); // the grid duplicate
  });

  test('same view type produces no type entry', () => {
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Grid', 'grid', {})]);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'Grid', 'grid', {})]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vD' } });
    const r = compareTable(src, dest, im);
    assert.ok(!r.entries.find((e) => e.scope === 'view:Grid' && e.key === 'type'));
  });
});

// ── compareViews — filter content drift ───────────────────────────────────────

describe('compareViews — filter content drift', () => {
  test('filters differ → drift entry key=filters', () => {
    const srcConfig = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fS1', operator: 'isEmpty', value: null }],
      },
    };
    const destConfig = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fD1', operator: 'isNotEmpty', value: null }],
      },
    };
    const src = tbl('tS', 'T', 'fS1', [fld('fS1', 'Status')], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'fD1', [fld('fD1', 'Status')], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { fS1: { destFld: 'fD1', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    const e = r.entries.find((e) => e.scope === 'view:Grid' && e.key === 'filters');
    assert.ok(e, 'filters drift entry missing');
    assert.equal(e.class, 'drift');
  });

  test('identical filters produce no filters entry', () => {
    // Source uses src field IDs; dest uses dest field IDs.  After canonicalization
    // both resolve to the same field NAME ('Status') → no filter drift.
    const srcConfig = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fS1', operator: 'isEmpty', value: null }],
      },
    };
    const destConfig = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fD1', operator: 'isEmpty', value: null }],
      },
    };
    const src = tbl('tS', 'T', 'fS1', [fld('fS1', 'Status')], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'fD1', [fld('fD1', 'Status')], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { fS1: { destFld: 'fD1', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    assert.ok(!r.entries.find((e) => e.scope === 'view:Grid' && e.key === 'filters'));
  });
});

// ── compareViews — column visibility vs order ─────────────────────────────────

describe('compareViews — column visibility vs order', () => {
  test('column order differs but visibility set same → best-effort key=columnOrder', () => {
    const srcConfig = {
      columnOrder: [
        { columnId: 'fS1', visibility: true },
        { columnId: 'fS2', visibility: true },
      ],
    };
    const destConfig = {
      columnOrder: [
        { columnId: 'fD2', visibility: true },
        { columnId: 'fD1', visibility: true },
      ],
    };
    const src = tbl('tS', 'T', 'fS1', [fld('fS1', 'A'), fld('fS2', 'B')], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'fD1', [fld('fD1', 'A'), fld('fD2', 'B')], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { fS1: { destFld: 'fD1', choices: {} }, fS2: { destFld: 'fD2', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    // Visibility set is the same (both visible) → no columnVisibility entry
    assert.ok(!r.entries.find((e) => e.key === 'columnVisibility'), 'should not have visibility entry when set is the same');
    // Column order differs
    const oe = r.entries.find((e) => e.key === 'columnOrder');
    assert.ok(oe, 'columnOrder entry missing');
    assert.equal(oe.class, 'best-effort');
  });

  test('column visibility differs → drift entry key=columnVisibility', () => {
    const srcConfig = {
      columnOrder: [
        { columnId: 'fS1', visibility: true },
        { columnId: 'fS2', visibility: false },
      ],
    };
    const destConfig = {
      columnOrder: [
        { columnId: 'fD1', visibility: true },
        { columnId: 'fD2', visibility: true }, // B is visible in dest but hidden in src
      ],
    };
    const src = tbl('tS', 'T', 'fS1', [fld('fS1', 'A'), fld('fS2', 'B')], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'fD1', [fld('fD1', 'A'), fld('fD2', 'B')], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { fS1: { destFld: 'fD1', choices: {} }, fS2: { destFld: 'fD2', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    const ve = r.entries.find((e) => e.key === 'columnVisibility');
    assert.ok(ve, 'columnVisibility drift entry missing');
    assert.equal(ve.class, 'drift');
  });
});

// ── compareViews — sort clause order ──────────────────────────────────────────

describe('compareViews — sort clause order', () => {
  test('sort clause order differs → best-effort entry key=sortOrder', () => {
    const srcConfig = {
      sorts: [
        { columnId: 'fS1', ascending: true },
        { columnId: 'fS2', ascending: false },
      ],
    };
    const destConfig = {
      sorts: [
        { columnId: 'fD2', ascending: false },
        { columnId: 'fD1', ascending: true },
      ],
    };
    const src = tbl('tS', 'T', 'fS1', [fld('fS1', 'A'), fld('fS2', 'B')], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'fD1', [fld('fD1', 'A'), fld('fD2', 'B')], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({
      tables: { tS: 'tD' },
      fields: { fS1: { destFld: 'fD1', choices: {} }, fS2: { destFld: 'fD2', choices: {} } },
      views: { vS: 'vD' },
    });
    const r = compareTable(src, dest, im);
    const se = r.entries.find((e) => e.key === 'sortOrder');
    assert.ok(se, 'sortOrder best-effort entry missing');
    assert.equal(se.class, 'best-effort');
  });
});

// ── compareViews — only-in lists ──────────────────────────────────────────────

describe('compareViews — only-in-source', () => {
  test('view only in source → appears in views.onlyInSource', () => {
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Kanban', 'kanban', {})]);
    const dest = tbl('tD', 'T', 'p', [], []);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.ok(r.views.onlyInSource.includes('Kanban'), 'Kanban should be onlyInSource');
    assert.equal(r.status, 'differs');
  });

  test('personal views are skipped (not in onlyInSource)', () => {
    const personalView = view('vP', 'My Personal View', 'grid', {}, { personalForUserId: 'usr123' });
    const src = tbl('tS', 'T', 'p', [], [personalView]);
    const dest = tbl('tD', 'T', 'p', [], []);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.ok(!r.views.onlyInSource.includes('My Personal View'), 'personal view should be skipped');
    assert.equal(r.status, 'same');
  });

  test('view only in dest → appears in views.onlyInDest', () => {
    const src = tbl('tS', 'T', 'p', [], []);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'Gallery', 'gallery', {})]);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.ok(r.views.onlyInDest.includes('Gallery'), 'Gallery should be onlyInDest');
    assert.equal(r.status, 'differs');
  });
});

// ── compareTable — sections diff ──────────────────────────────────────────────

describe('compareTable — sections diff', () => {
  test('compareTable flags missing section as not-synced (brief canonical test)', () => {
    const src = {
      id: 'tS', name: 'T', primaryFieldId: 'p',
      fields: [],
      views: [{ id: 'v', name: 'Grid', type: 'grid', config: {} }],
      sections: [{ name: 'Sales', viewNames: ['Grid'] }],
    };
    const dest = {
      id: 'tD', name: 'T', primaryFieldId: 'p',
      fields: [],
      views: [{ id: 'w', name: 'Grid', type: 'grid', config: {} }],
      sections: [],
    };
    const im = { tables: { tS: 'tD' }, fields: {}, views: { v: 'w' } };
    const r = compareTable(src, dest, im);
    const s = r.entries.find((e) => e.key === 'sections');
    assert.ok(s, 'sections entry missing');
    assert.equal(s.class, 'not-synced');
  });

  test('identical sections produce no sections entry', () => {
    const secs = [{ name: 'Sales', viewNames: ['Grid'] }];
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Grid')], secs);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'Grid')], secs);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vD' } });
    const r = compareTable(src, dest, im);
    assert.ok(!r.entries.find((e) => e.key === 'sections'), 'identical sections should produce no entry');
  });

  test('source has two sections, dest has one → not-synced entry with source/dest arrays', () => {
    const srcSecs = [{ name: 'Sales', viewNames: ['Grid'] }, { name: 'Ops', viewNames: ['Kanban'] }];
    const destSecs = [{ name: 'Sales', viewNames: ['Grid'] }];
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Grid'), view('vK', 'Kanban')], srcSecs);
    const dest = tbl('tD', 'T', 'p', [], [view('vG', 'Grid')], destSecs);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vG', vK: 'vK' } });
    const r = compareTable(src, dest, im);
    const s = r.entries.find((e) => e.key === 'sections');
    assert.ok(s, 'sections entry missing');
    assert.equal(s.class, 'not-synced');
    assert.equal(s.scope, 'table');
    assert.deepEqual(s.source, srcSecs);
    assert.deepEqual(s.dest, destSecs);
  });

  test('section viewNames sequence differs → not-synced entry', () => {
    const srcSecs = [{ name: 'Sales', viewNames: ['Grid', 'Gallery'] }];
    const destSecs = [{ name: 'Sales', viewNames: ['Gallery', 'Grid'] }];
    const src = tbl('tS', 'T', 'p', [], [], srcSecs);
    const dest = tbl('tD', 'T', 'p', [], [], destSecs);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    const s = r.entries.find((e) => e.key === 'sections');
    assert.ok(s, 'sections entry missing when viewNames sequence differs');
    assert.equal(s.class, 'not-synced');
  });
});

// ── compareTable — view order diff ────────────────────────────────────────────

describe('compareTable — view order', () => {
  test('view order differs → best-effort entry key=viewOrder', () => {
    const src = tbl('tS', 'T', 'p', [], [view('vA', 'A'), view('vB', 'B')]);
    const dest = tbl('tD', 'T', 'p', [], [view('vB2', 'B'), view('vA2', 'A')]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vA: 'vA2', vB: 'vB2' } });
    const r = compareTable(src, dest, im);
    const vo = r.entries.find((e) => e.key === 'viewOrder');
    assert.ok(vo, 'viewOrder entry missing');
    assert.equal(vo.class, 'best-effort');
    assert.deepEqual(vo.source, ['A', 'B']);
    assert.deepEqual(vo.dest, ['B', 'A']);
  });

  test('same view order → no viewOrder entry', () => {
    const src = tbl('tS', 'T', 'p', [], [view('vA', 'A'), view('vB', 'B')]);
    const dest = tbl('tD', 'T', 'p', [], [view('vA2', 'A'), view('vB2', 'B')]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vA: 'vA2', vB: 'vB2' } });
    const r = compareTable(src, dest, im);
    assert.ok(!r.entries.find((e) => e.key === 'viewOrder'), 'no viewOrder when order is same');
  });
});

// ── compareTable — view-level facets: colorConfig, frozenColumnCount, rowHeight ──

describe('compareViews — other facets', () => {
  test('frozenColumnCount differs → drift entry with key=frozenColumnCount', () => {
    const srcConfig = { frozenColumnCount: 2 };
    const destConfig = { frozenColumnCount: 1 };
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vD' } });
    const r = compareTable(src, dest, im);
    assert.equal(r.status, 'differs');
    // compareViews emits key 'frozenColumnCount' with class 'drift' for this facet
    const e = r.entries.find((e) => e.scope === 'view:Grid' && e.key === 'frozenColumnCount');
    assert.ok(e, 'frozenColumnCount DiffEntry missing');
    assert.equal(e.class, 'drift');
    assert.equal(e.source, 2);
    assert.equal(e.dest, 1);
  });

  test('rowHeight differs → drift entry with key=rowHeight', () => {
    const srcConfig = { rowHeight: 'short' };
    const destConfig = { rowHeight: 'tall' };
    const src = tbl('tS', 'T', 'p', [], [view('vS', 'Grid', 'grid', srcConfig)]);
    const dest = tbl('tD', 'T', 'p', [], [view('vD', 'Grid', 'grid', destConfig)]);
    const im = idmap({ tables: { tS: 'tD' }, views: { vS: 'vD' } });
    const r = compareTable(src, dest, im);
    assert.equal(r.status, 'differs');
    // compareViews emits key 'rowHeight' with class 'drift' for this facet
    const e = r.entries.find((e) => e.scope === 'view:Grid' && e.key === 'rowHeight');
    assert.ok(e, 'rowHeight DiffEntry missing');
    assert.equal(e.class, 'drift');
    assert.equal(e.source, 'short');
    assert.equal(e.dest, 'tall');
  });
});

// ── compareTable — combined status ─────────────────────────────────────────────

describe('compareTable — status transitions', () => {
  test('fields.onlyInSource makes status=differs', () => {
    const src = tbl('tS', 'T', 'p', [fld('f1', 'ExtraField')]);
    const dest = tbl('tD', 'T', 'p', []);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.equal(r.status, 'differs');
    assert.ok(r.fields.onlyInSource.includes('ExtraField'));
  });

  test('fields.onlyInDest makes status=differs', () => {
    const src = tbl('tS', 'T', 'p', []);
    const dest = tbl('tD', 'T', 'p', [fld('f1', 'DestOnlyField')]);
    const im = idmap({ tables: { tS: 'tD' } });
    const r = compareTable(src, dest, im);
    assert.equal(r.status, 'differs');
    assert.ok(r.fields.onlyInDest.includes('DestOnlyField'));
  });
});
