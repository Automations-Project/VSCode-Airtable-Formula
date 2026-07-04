import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remapViewConfig, canonicalizeViewConfig } from '../../src/sync/remap.js';
import { reapplyViewFilters } from '../../src/sync/records.js';

// Realistic rec ids: "rec" + 14 alphanumeric chars = 17 chars total (matches RECORD_REF_ID regex)
const recSrc = 'recSRCSRCSRCSRCSS';  // source record id (17 chars)
const recDst = 'recDSTDSTDSTDSTOO';  // dest record id (17 chars)
const recMiss = 'recMISSINGXXXXXXX'; // unresolvable source record id (18 chars)

// ── Pure remap flip tests ─────────────────────────────────────────────────────

describe('remap — record-ref filter REMAP when records exist', () => {
  const idmap = {
    tables: {},
    views: {},
    fields: { fldG: { destFld: 'fldGD', choices: {} } },
    records: { [recSrc]: recDst },
  };

  it('remaps a resolvable rec filter instead of stripping it', () => {
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
      },
    };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 1);
    assert.deepEqual(out.filters.filterSet[0].value, [recDst]);
    assert.equal(out.filters.filterSet[0].columnId, 'fldGD');
  });

  it('still strips an UNresolvable rec filter', () => {
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recMiss] }],
      },
    };
    assert.equal(remapViewConfig(cfg, idmap).filters.filterSet.length, 0);
  });

  it('drops unresolvable ids from a mixed array (partial remap)', () => {
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc, recMiss] }],
      },
    };
    const out = remapViewConfig(cfg, idmap);
    // recSrc -> recDst; recMiss dropped; leaf kept with resolved subset
    assert.equal(out.filters.filterSet.length, 1);
    assert.deepEqual(out.filters.filterSet[0].value, [recDst]);
  });

  it('drops entire leaf when all array elements are unresolvable', () => {
    const recMiss2 = 'recALSOGONEXXXXXX'; // rec + 14 chars — a real record-id shape
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recMiss, recMiss2] }],
      },
    };
    assert.equal(remapViewConfig(cfg, idmap).filters.filterSet.length, 0);
  });

  it('collaborator usr ids pass through verbatim (user ids are Airtable-global, never in idmap.records)', () => {
    const USR = 'usrCCCCCCCCCCCCCC';
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: USR }],
      },
    };
    const out = remapViewConfig(cfg, idmap);
    assert.equal(out.filters.filterSet.length, 1);
    assert.equal(out.filters.filterSet[0].value, USR);
  });

  it('empty idmap.records -> strip -> leaf dropped (backward compat)', () => {
    const emptyIdmap = { tables: {}, views: {}, fields: { fldG: { destFld: 'fldGD', choices: {} } }, records: {} };
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
      },
    };
    assert.equal(remapViewConfig(cfg, emptyIdmap).filters.filterSet.length, 0);
  });
});

// ── canonicalizeViewConfig convergence with idmap.records ────────────────────

describe('canonicalizeViewConfig — record-ref convergence with idmap', () => {
  const idmap = {
    tables: {},
    views: {},
    fields: { fldG: { destFld: 'fldGD', choices: {} } },
    records: { [recSrc]: recDst },
  };
  const srcFldNames = { fldG: 'Game' };
  const destFldNames = { fldGD: 'Game' };

  it('source (strip=true+idmap, recSrc->recDst) and dest (strip=false+idmap, recDst) canonicalize equal', () => {
    const srcCfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
      },
    };
    const destCfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldGD', operator: '=', value: [recDst] }],
      },
    };
    const srcCanon = canonicalizeViewConfig(srcCfg, srcFldNames, {}, true, idmap);
    const destCanon = canonicalizeViewConfig(destCfg, destFldNames, {}, false, idmap);
    assert.equal(srcCanon, destCanon);
  });

  it('empty idmap.records -> strip -> source canonic equals no-filter (backward compat)', () => {
    const emptyIdmap = { tables: {}, views: {}, fields: { fldG: { destFld: 'fldGD', choices: {} } }, records: {} };
    const srcCfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
      },
    };
    const srcCanon = canonicalizeViewConfig(srcCfg, srcFldNames, {}, true, emptyIdmap);
    const noneCanon = canonicalizeViewConfig({ filters: null }, {}, {}, true, emptyIdmap);
    assert.equal(srcCanon, noneCanon);
  });

  it('dest with unresolved (dangling) rec diverges from stripped source when no idmap.records', () => {
    const emptyIdmap = { tables: {}, views: {}, fields: { fldGD: { destFld: 'fldGD', choices: {} } }, records: {} };
    const cfg = {
      filters: {
        conjunction: 'and',
        filterSet: [{ columnId: 'fldGD', operator: '=', value: [recDst] }],
      },
    };
    // Source: strip=true -> drops the rec leaf -> no filter
    const srcCanon = canonicalizeViewConfig(cfg, destFldNames, {}, true, emptyIdmap);
    // Dest: strip=false, no records in idmap -> keeps the dangling rec -> filter present
    const destCanon = canonicalizeViewConfig(cfg, destFldNames, {}, false, emptyIdmap);
    // They must diverge (forces cleanup apply)
    assert.notEqual(srcCanon, destCanon);
  });
});

// ── reapplyViewFilters mock-client test ──────────────────────────────────────

describe('reapplyViewFilters — mock client', () => {
  function makeLimiter() { return { run: (fn) => fn() }; }
  function makeJournal() { return {}; }
  function makeNoop() { return () => {}; }

  it('calls updateViewFilters with remapped recDst filter for a resolvable view', async () => {
    const calls = [];
    const client = {
      updateViewFilters: async (appId, viewId, filters) => {
        calls.push({ appId, viewId, filters });
        return { ok: true };
      },
    };

    const srcSnapshot = {
      baseId: 'appSRC',
      tables: [{
        id: 'tblSRCSRCSRCSRCS',
        fields: [],
        records: [],
        views: [{
          id: 'viwSRCSRCSRCSRCS',
          name: 'By Game',
          type: 'grid',
          personalForUserId: null,
          config: {
            filters: {
              conjunction: 'and',
              filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
            },
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDST', tables: [] };

    const idmap = {
      tables: { tblSRCSRCSRCSRCS: 'tblDSTDSTDSTDSTO' },
      views: { viwSRCSRCSRCSRCS: 'viwDSTDSTDSTDSTO' },
      fields: { fldG: { destFld: 'fldGD', choices: {} } },
      records: { [recSrc]: recDst },
    };

    const result = { warnings: [], viewFiltersReapplied: 0 };

    await reapplyViewFilters({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: makeJournal(),
      persist: makeNoop(),
      result,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].appId, 'appDST');
    assert.equal(calls[0].viewId, 'viwDSTDSTDSTDSTO');
    assert.deepEqual(calls[0].filters.filterSet[0].value, [recDst]);
    assert.equal(calls[0].filters.filterSet[0].columnId, 'fldGD');
    assert.equal(result.viewFiltersReapplied, 1);
    assert.equal(result.warnings.length, 0);
  });

  it('skips views with no resolvable record refs (all unresolved)', async () => {
    const calls = [];
    const client = {
      updateViewFilters: async (appId, viewId, filters) => { calls.push({ appId, viewId, filters }); return { ok: true }; },
    };

    const srcSnapshot = {
      baseId: 'appSRC',
      tables: [{
        id: 'tblSRCSRCSRCSRCS',
        fields: [],
        records: [],
        views: [{
          id: 'viwSRCSRCSRCSRCS',
          name: 'Orphan filter',
          type: 'grid',
          personalForUserId: null,
          config: {
            filters: {
              conjunction: 'and',
              filterSet: [{ columnId: 'fldG', operator: '=', value: [recMiss] }],
            },
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDST', tables: [] };

    const idmap = {
      tables: { tblSRCSRCSRCSRCS: 'tblDSTDSTDSTDSTO' },
      views: { viwSRCSRCSRCSRCS: 'viwDSTDSTDSTDSTO' },
      fields: { fldG: { destFld: 'fldGD', choices: {} } },
      records: {},  // recMiss NOT in records
    };

    const result = { warnings: [], viewFiltersReapplied: 0 };

    await reapplyViewFilters({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: makeJournal(),
      persist: makeNoop(),
      result,
    });

    assert.equal(calls.length, 0); // should not call updateViewFilters
    assert.equal(result.viewFiltersReapplied, 0);
  });

  it('skips personal views', async () => {
    const calls = [];
    const client = {
      updateViewFilters: async (appId, viewId, filters) => { calls.push({ viewId }); return { ok: true }; },
    };

    const srcSnapshot = {
      baseId: 'appSRC',
      tables: [{
        id: 'tblSRCSRCSRCSRCS',
        fields: [],
        records: [],
        views: [{
          id: 'viwPersonalXXXXXX',
          name: 'My View',
          type: 'grid',
          personalForUserId: 'usrSOMEUSER12345',
          config: {
            filters: {
              conjunction: 'and',
              filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
            },
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDST', tables: [] };

    const idmap = {
      tables: { tblSRCSRCSRCSRCS: 'tblDSTDSTDSTDSTO' },
      views: { viwPersonalXXXXXX: 'viwDPersonalXXXXX' },
      fields: { fldG: { destFld: 'fldGD', choices: {} } },
      records: { [recSrc]: recDst },
    };

    const result = { warnings: [], viewFiltersReapplied: 0 };

    await reapplyViewFilters({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: makeJournal(),
      persist: makeNoop(),
      result,
    });

    assert.equal(calls.length, 0);
    assert.equal(result.viewFiltersReapplied, 0);
  });

  it('continues on failure and pushes VIEW_FILTER_REAPPLY_FAILED warning', async () => {
    const client = {
      updateViewFilters: async () => { throw new Error('network error'); },
    };

    const srcSnapshot = {
      baseId: 'appSRC',
      tables: [{
        id: 'tblSRCSRCSRCSRCS',
        fields: [],
        records: [],
        views: [{
          id: 'viwSRCSRCSRCSRCS',
          name: 'Test View',
          type: 'grid',
          personalForUserId: null,
          config: {
            filters: {
              conjunction: 'and',
              filterSet: [{ columnId: 'fldG', operator: '=', value: [recSrc] }],
            },
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDST', tables: [] };

    const idmap = {
      tables: { tblSRCSRCSRCSRCS: 'tblDSTDSTDSTDSTO' },
      views: { viwSRCSRCSRCSRCS: 'viwDSTDSTDSTDSTO' },
      fields: { fldG: { destFld: 'fldGD', choices: {} } },
      records: { [recSrc]: recDst },
    };

    const result = { warnings: [], viewFiltersReapplied: 0 };

    // Should not throw
    await reapplyViewFilters({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: makeJournal(),
      persist: makeNoop(),
      result,
    });

    assert.equal(result.viewFiltersReapplied, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'VIEW_FILTER_REAPPLY_FAILED');
    assert.ok(result.warnings[0].message.includes('viwSRCSRCSRCSRCS'));
    assert.ok(result.warnings[0].message.includes('viwDSTDSTDSTDSTO'));
  });
});
