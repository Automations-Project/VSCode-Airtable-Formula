import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remapViewConfig, canonicalizeViewConfig } from '../../src/sync/remap.js';

const idmap = { tables: {}, views: {}, fields: {
  fldA: { destFld: 'fldX', choices: { selA: 'selX' } },
  fldB: { destFld: 'fldY', choices: {} },
} };

describe('remap.remapViewConfig', () => {
  it('remaps fld ids across filters (nested), sorts, groups, columnOrder, colorConfig, cover, calendar', () => {
    const cfg = {
      filters: { conjunction: 'and', filterSet: [
        { id: 'fltAAA', columnId: 'fldA', operator: '=', value: 'selA' },
        { type: 'nested', conjunction: 'or', filterSet: [{ id: 'fltBBB', columnId: 'fldB', operator: '=', value: 'x' }] },
      ] },
      sorts: [{ columnId: 'fldB', ascending: true }],
      groupLevels: [{ columnId: 'fldA', order: 'ascending', emptyGroupState: 'hidden' }],
      columnOrder: [{ columnId: 'fldA', visibility: true, width: 120 }, { columnId: 'fldB', visibility: false }],
      colorConfig: { type: 'selectColumn', selectColumnId: 'fldA' },
      cover: { coverColumnId: 'fldB', coverFitType: 'fit' },
      calendar: { dateColumnRanges: [{ startColumnId: 'fldA', endColumnId: 'fldB' }] },
    };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet[0].columnId, 'fldX');
    assert.equal(out.filters.filterSet[0].value, 'selX');                  // select value choice-id remapped
    assert.equal(out.filters.filterSet[0].id, undefined);                   // auto flt id stripped
    assert.equal(out.filters.filterSet[1].filterSet[0].columnId, 'fldY');   // nested remapped
    assert.equal(out.sorts[0].columnId, 'fldY');
    assert.equal(out.groupLevels[0].columnId, 'fldX');
    assert.equal(out.columnOrder[0].columnId, 'fldX');
    assert.equal(out.columnOrder[0].width, undefined);                      // width stripped
    assert.equal(out.colorConfig.selectColumnId, 'fldX');
    assert.equal(out.cover.coverColumnId, 'fldY');
    assert.equal(out.calendar.dateColumnRanges[0].startColumnId, 'fldX');
    assert.equal(out.calendar.dateColumnRanges[0].endColumnId, 'fldY');
  });
  it('does not mutate input + passes null through', () => {
    const input = { sorts: [{ columnId: 'fldA', ascending: true }] };
    const out = remapViewConfig(input, idmap);
    assert.equal(input.sorts[0].columnId, 'fldA');
    assert.notEqual(out, input);
    assert.equal(remapViewConfig(null, idmap), null);
  });
});

describe('remap.canonicalizeViewConfig', () => {
  it('identical-by-name configs are canonical-equal despite different ids/auto-ids/width (convergence)', () => {
    const a = canonicalizeViewConfig({ sorts: [{ columnId: 'fldA', ascending: true }], columnOrder: [{ columnId: 'fldB', visibility: true, width: 99 }] }, { fldA: 'Price', fldB: 'Qty' }, {});
    const b = canonicalizeViewConfig({ sorts: [{ columnId: 'fldX', ascending: true }], columnOrder: [{ columnId: 'fldY', visibility: true, width: 12 }] }, { fldX: 'Price', fldY: 'Qty' }, {});
    assert.equal(a, b);
  });
  it('a real difference (different sort field) is NOT canonical-equal', () => {
    const a = canonicalizeViewConfig({ sorts: [{ columnId: 'fldA', ascending: true }] }, { fldA: 'Price' }, {});
    const b = canonicalizeViewConfig({ sorts: [{ columnId: 'fldB', ascending: true }] }, { fldB: 'Qty' }, {});
    assert.notEqual(a, b);
  });
  it('an empty filterSet canonicalizes equal to no filters (apply clears stray dest filters → convergence)', () => {
    const noFilter = canonicalizeViewConfig({ filters: null }, {}, {});
    const emptyFilter = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [] } }, {}, {});
    assert.equal(noFilter, emptyFilter);
    const realFilter = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: 'contains', value: null }] } }, { fldA: 'ID' }, {});
    assert.notEqual(noFilter, realFilter); // a genuine filter still differs from none
  });
});

describe('remap.canonicalizeViewConfig columns convergence', () => {
  const names = { fA: 'A', fB: 'B', fC: 'C', fD: 'D' };
  it('ignores column ORDER (visible + hidden); only WHICH columns are shown/hidden gates convergence', () => {
    const x = canonicalizeViewConfig({ columnOrder: [{ columnId: 'fA', visibility: true }, { columnId: 'fB', visibility: true }, { columnId: 'fC', visibility: false }, { columnId: 'fD', visibility: false }] }, names, {});
    const shuffled = canonicalizeViewConfig({ columnOrder: [{ columnId: 'fB', visibility: true }, { columnId: 'fA', visibility: true }, { columnId: 'fD', visibility: false }, { columnId: 'fC', visibility: false }] }, names, {});
    assert.equal(x, shuffled); // same visible/hidden SETS, different order → equal → converges
    const differentVisible = canonicalizeViewConfig({ columnOrder: [{ columnId: 'fA', visibility: true }, { columnId: 'fC', visibility: true }, { columnId: 'fB', visibility: false }, { columnId: 'fD', visibility: false }] }, names, {});
    assert.notEqual(x, differentVisible); // C shown instead of B → different visible set → not equal
  });
});
