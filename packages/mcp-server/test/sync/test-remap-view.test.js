import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remapViewConfig, canonicalizeViewConfig, collectFilterRecordRefs } from '../../src/sync/remap.js';

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
  it('empty-predicate operator representations are canonical-equal (isNotEmpty/null ≡ !=/"")', () => {
    // Airtable's internal API stores the same "is not empty" predicate two equivalent ways:
    // the source base holds {isNotEmpty, null}; the dest holds {!=, ""} after the sync applied it.
    const src = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: 'isNotEmpty', value: null }] } }, { fldA: 'Sold.id' }, {});
    const dest = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '!=', value: '' }] } }, { fldA: 'Sold.id' }, {});
    assert.equal(src, dest);
  });
  it('empty-predicate isEmpty/null ≡ =/"" are canonical-equal', () => {
    const src = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: 'isEmpty', value: null }] } }, { fldA: 'ID' }, {});
    const dest = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: '' }] } }, { fldA: 'ID' }, {});
    assert.equal(src, dest);
  });
  it('a NON-empty value with = is NOT collapsed to an empty predicate (real values preserved)', () => {
    const empty = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: '' }] } }, { fldA: 'ID' }, {});
    const real = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: '2' }] } }, { fldA: 'ID' }, {});
    assert.notEqual(empty, real);
    // 0 / false are real values, not "empty"
    const zero = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: 0 }] } }, { fldA: 'ID' }, {});
    assert.notEqual(empty, zero);
  });
});

describe('remap — record-referencing view filters (strip + report + converge)', () => {
  const REC = 'recAAAAAAAAAAAAAA', REC2 = 'recBBBBBBBBBBBBBB', USR = 'usrCCCCCCCCCCCCCC';
  it('strips a link-field rec leaf and reports it', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [{ id: 'flt1', columnId: 'fldA', operator: '=', value: [REC] }] } };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 0);                 // rec leaf dropped before write
    assert.deepEqual(collectFilterRecordRefs(cfg), [REC]);         // surfaced for the warning
  });
  it('keeps resolvable (choice) leaves while stripping rec leaves in the same set', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [
      { columnId: 'fldA', operator: '=', value: [REC] },
      { columnId: 'fldB', operator: '=', value: 'selA' },
    ] } };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 1);
    assert.equal(out.filters.filterSet[0].columnId, 'fldY');       // fldB remapped
    assert.equal(out.filters.filterSet[0].value, 'selX');          // choice remapped, leaf kept
  });
  it('prunes a nested group emptied by stripping; keeps siblings', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [
      { type: 'nested', conjunction: 'or', filterSet: [{ columnId: 'fldA', operator: '=', value: [REC2] }] },
      { columnId: 'fldB', operator: '=', value: 'x' },
    ] } };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 1);                 // emptied nested group pruned
    assert.equal(out.filters.filterSet[0].columnId, 'fldY');
  });
  it('passes collaborator usr ids through VERBATIM (user ids are Airtable-global) and keeps "me"', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [
      { columnId: 'fldB', operator: '=', value: USR },
      { columnId: 'fldB', operator: '=', value: 'me' },
    ] } };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 2);
    assert.equal(out.filters.filterSet[0].value, USR);
    assert.equal(out.filters.filterSet[1].value, 'me');
    assert.deepEqual(collectFilterRecordRefs(cfg), []);            // usr is not a stripped record ref
  });
  it('usr filter canonicalizes identically on source (strip) and dest (keep) sides — converges', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldB', operator: '=', value: USR }] } };
    const srcSide = canonicalizeViewConfig(cfg, { fldB: 'Assignee' }, {}, true);
    const destSide = canonicalizeViewConfig(cfg, { fldB: 'Assignee' }, {}, false);
    assert.equal(srcSide, destSide);
    assert.match(srcSide, /usrCCCCCCCCCCCCCC/);                    // the condition survives, not dropped
  });
  it('mixed [rec, usr] array value: rec remapped/stripped per idmap.records, usr kept verbatim', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: [REC, USR] }] } };
    const out = remapViewConfig(cfg, idmap);                       // idmap has no records → REC unresolvable
    assert.equal(out.filters.filterSet.length, 1);
    assert.deepEqual(out.filters.filterSet[0].value, [USR]);
  });
  it('strips structured/dynamic filter values that carry source ids', () => {
    const cfg = { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '|', value: { tableId: 'tblZ', columnId: 'fldZ', rowId: null } }] } };
    assert.equal(remapViewConfig(cfg, idmap).filters.filterSet.length, 0);
  });
  it('a source filter of only rec leaves canonicalizes equal to no filter (converges)', () => {
    const src = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: [REC] }] } }, { fldA: 'Game' }, {});
    const none = canonicalizeViewConfig({ filters: null }, {}, {});
    assert.equal(src, none);
  });
  it('drops record-referencing colorDefinitions defensively (never written)', () => {
    const out = remapViewConfig({ colorConfig: { type: 'colorDefinitions', colorDefinitions: [{ filterSet: [], color: 'blue' }], defaultColor: 'gray' } }, idmap);
    assert.equal(out.colorConfig.colorDefinitions, undefined);
  });
  it('dest still holding a dangling rec filter diverges from stripped source (forces cleanup), then converges once cleared', () => {
    const srcCfg = { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: [REC] }] } };
    const srcCanon = canonicalizeViewConfig(srcCfg, { fldA: 'Game' }, {}, true);      // source: stripped → no filter
    const destDangling = canonicalizeViewConfig(srcCfg, { fldA: 'Game' }, {}, false); // dest raw: keeps the dangling rec
    assert.notEqual(srcCanon, destDangling);                                          // → emits applyViewConfig (cleanup)
    const destCleared = canonicalizeViewConfig({ filters: null }, {}, {}, false);     // after apply clears it
    assert.equal(srcCanon, destCleared);                                              // → converged, no re-flag
  });
  it('unwraps singleton nested groups in canonical (collapse-agnostic convergence)', () => {
    const grouped = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ type: 'nested', conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: 'selA' }] }] } }, { fldA: 'X' }, { selA: 'A' });
    const flat = canonicalizeViewConfig({ filters: { conjunction: 'and', filterSet: [{ columnId: 'fldA', operator: '=', value: 'selA' }] } }, { fldA: 'X' }, { selA: 'A' });
    assert.equal(grouped, flat);
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

  it('a column with no `visibility` key at all is treated as VISIBLE, matching getView/isColumnVisible semantics', () => {
    // Airtable's internal API omits `visibility` entirely for a visible column
    // in some responses. A source config shaped that way must canonicalize
    // identically to an explicit `visibility: true` config, or a real source
    // column silently compares as hidden and view sync never shows it on dest.
    const explicit = canonicalizeViewConfig({ columnOrder: [{ columnId: 'fA', visibility: true }, { columnId: 'fB', visibility: false }] }, names, {});
    const noKey = canonicalizeViewConfig({ columnOrder: [{ columnId: 'fA' }, { columnId: 'fB', visibility: false }] }, names, {});
    assert.equal(noKey, explicit);
  });
});
