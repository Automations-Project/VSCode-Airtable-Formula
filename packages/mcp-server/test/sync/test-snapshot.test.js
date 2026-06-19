import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema, isComputedType, snapshotViews } from '../../src/sync/snapshot.js';

describe('snapshot.isComputedType', () => {
  it('flags computed types and not writable ones', () => {
    assert.equal(isComputedType('formula'), true);
    assert.equal(isComputedType('rollup'), true);
    assert.equal(isComputedType('lookup'), true);
    assert.equal(isComputedType('count'), true);
    assert.equal(isComputedType('button'), true);
    assert.equal(isComputedType('text'), false);
    assert.equal(isComputedType('multiSelect'), false);
  });
});

describe('snapshot.normalizeSchema', () => {
  const raw = { data: { tableSchemas: [
    { id: 'tbl1', name: 'Offers', primaryColumnId: 'fldA', columns: [
      { id: 'fldA', name: 'Name', type: 'text', typeOptions: null, description: null },
      { id: 'fldB', name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: 'SUM(1)' }, description: 'd' },
    ] },
  ] } };
  it('flattens tables + fields with computed flags and primary id', () => {
    const snap = normalizeSchema(raw);
    assert.equal(snap.tables.length, 1);
    const t = snap.tables[0];
    assert.equal(t.id, 'tbl1');
    assert.equal(t.name, 'Offers');
    assert.equal(t.primaryFieldId, 'fldA');
    assert.equal(t.fields.length, 2);
    assert.equal(t.fields[0].isComputed, false);
    assert.equal(t.fields[1].isComputed, true);
    assert.equal(t.fields[1].typeOptions.formulaTextParsed, 'SUM(1)');
  });
  it('falls back to .tables and first column for primary', () => {
    const snap = normalizeSchema({ data: { tables: [{ id: 'tbl2', name: 'X', fields: [{ id: 'fldZ', name: 'P', type: 'text' }] }] } });
    assert.equal(snap.tables[0].primaryFieldId, 'fldZ');
  });
});

describe('snapshot sections', () => {
  it('normalizeSchema attaches sections as {name, viewNames}', () => {
    const raw = { data: { tableSchemas: [{
      id: 'tblA', name: 'T', primaryColumnId: 'fld1',
      columns: [{ id: 'fld1', name: 'Name', type: 'text' }],
      views: [{ id: 'viwX', name: 'Grid', type: 'grid' }, { id: 'viwY', name: 'Kanban', type: 'kanban' }],
      viewSectionsById: { vsc1: { id: 'vsc1', name: 'Sales Views', viewOrder: ['viwY', 'viwX'] } },
    }] } };
    const snap = normalizeSchema(raw);
    assert.deepEqual(snap.tables[0].sections, [{ name: 'Sales Views', viewNames: ['Kanban', 'Grid'] }]);
  });
  it('normalizeSchema sections defaults to [] when absent', () => {
    const raw = { data: { tableSchemas: [{ id: 'tblA', name: 'T', columns: [], views: [] }] } };
    assert.deepEqual(normalizeSchema(raw).tables[0].sections, []);
  });
});

describe('snapshot views', () => {
  it('normalizeSchema attaches static views with personal flag', () => {
    const raw = { data: { tableSchemas: [{ id: 'tbl1', name: 'T', primaryColumnId: 'f1', columns: [{ id: 'f1', name: 'Name', type: 'text' }],
      views: [{ id: 'viwA', name: 'Grid view', type: 'grid', description: null, personalForUserId: null },
              { id: 'viwP', name: 'Mine', type: 'grid', personalForUserId: 'usr1' }] }] } };
    const snap = normalizeSchema(raw);
    assert.equal(snap.tables[0].views.length, 2);
    assert.equal(snap.tables[0].views[0].id, 'viwA');
    assert.equal(snap.tables[0].views[1].personalForUserId, 'usr1');
  });
  it('snapshotViews attaches live config (sorts unwrapped, calendar lifted from metadata); skips personal', async () => {
    const snap = { baseId: 'appD', tables: [{ id: 'tbl1', name: 'T', views: [
      { id: 'viwA', name: 'Grid view', type: 'grid', personalForUserId: null },
      { id: 'viwP', name: 'Mine', type: 'grid', personalForUserId: 'usr1' } ] }] };
    const client = { getView: async () => ({ filters: { conjunction: 'and', filterSet: [] },
      sorts: { sortSet: [{ id: 'srt1', columnId: 'f1', ascending: true }], shouldAutoSort: true },
      groupLevels: null, columnOrder: null, frozenColumnCount: 1, colorConfig: null,
      metadata: { calendar: { dateColumnRanges: [{ startColumnId: 'fDate' }] } }, rowHeight: 'small', description: null }) };
    await snapshotViews(client, 'appD', snap);
    const cfg = snap.tables[0].views[0].config;
    assert.ok(cfg);
    assert.equal(cfg.frozenColumnCount, 1);
    assert.deepEqual(cfg.sorts, [{ columnId: 'f1', ascending: true }]);                 // sortSet unwrapped
    assert.deepEqual(cfg.calendar, { dateColumnRanges: [{ startColumnId: 'fDate' }] });   // lifted from metadata
    assert.equal(snap.tables[0].views[1].config, undefined);                              // personal skipped
  });
});
