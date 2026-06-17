/**
 * test-records-apply.test.js
 *
 * Integration tests for applyRecords() orchestrator and reconcile().
 * Uses mock clients; no real network.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyRecords, reconcile } from '../../src/sync/records.js';
import { saveIdmap, loadIdmap } from '../../src/sync/idmap.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeInMemoryClient(srcData, destData) {
  // srcData / destData: { tables: [{id, name, primaryColumnId, columns, views, records}] }
  // `records` here is the raw rows array expected from queryRecords (not stored on table schema side).

  const clients = {
    src: {
      getApplicationData: async (appId) => {
        return { data: { tableSchemas: JSON.parse(JSON.stringify(srcData.tables)) } };
      },
      queryRecords: async (appId, tableId, viewId, opts) => {
        const tbl = srcData.tables.find((t) => t.id === tableId);
        const rows = (tbl && tbl.records) ? tbl.records : [];
        // Return up to 1000 rows (the cap tested by pre-flight)
        return { summary: { rows: rows.slice(0, 1000).map((r) => ({ id: r.id, fields: r.cellValuesByColumnId || {} })) } };
      },
      getView: async () => ({}),
    },
    dest: {
      getApplicationData: async (appId) => {
        return { data: { tableSchemas: JSON.parse(JSON.stringify(destData.tables)) } };
      },
      queryRecords: async (appId, tableId, viewId, opts) => {
        const tbl = destData.tables.find((t) => t.id === tableId);
        const rows = (tbl && tbl.records) ? tbl.records : [];
        return { summary: { rows: rows.slice(0, 1000).map((r) => ({ id: r.id, fields: r.cellValuesByColumnId || {} })) } };
      },
      getView: async () => ({}),
    },
  };
  return clients;
}

/**
 * Build a unified mock client whose behavior depends on the appId passed.
 * sourceBaseId → srcData, destBaseId → destData.
 */
function makeCombinedClient(sourceBaseId, destBaseId, srcData, destData, extra = {}) {
  const { clients } = { clients: makeInMemoryClient(srcData, destData) };

  const createCalls = [];
  const addLinkCalls = [];

  const client = {
    getApplicationData: async (appId) => {
      if (appId === sourceBaseId) return clients.src.getApplicationData(appId);
      return clients.dest.getApplicationData(appId);
    },
    queryRecords: async (appId, tableId, viewId, opts) => {
      if (appId === sourceBaseId) return clients.src.queryRecords(appId, tableId, viewId, opts);
      return clients.dest.queryRecords(appId, tableId, viewId, opts);
    },
    getView: async (appId, viewId) => {
      if (appId === sourceBaseId) return clients.src.getView(appId, viewId);
      return clients.dest.getView(appId, viewId);
    },
    createRecords: async (appId, tableId, rows) => {
      const created = rows.map((r, i) => {
        const rowId = 'recDest' + tableId.slice(-3) + String(i);
        createCalls.push({ appId, tableId, rowId, sourceKey: r.sourceKey, cells: r.cellValuesByColumnId });
        return { rowId, sourceKey: r.sourceKey };
      });
      return { created, failed: [] };
    },
    updateRecords: async () => ({ updated: [], failed: [] }),
    addLinkItems: async (appId, rowId, columnId, items) => {
      addLinkCalls.push({ appId, rowId, columnId, items });
      return { ok: true, added: items.length };
    },
    uploadAttachment: async () => ({ ok: false, error: 'no-op in test' }),
    updateViewFilters: async () => ({ ok: true }),
    ...extra,
  };

  return { client, createCalls, addLinkCalls };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const SRC_APP = 'appSrcSrcSrcSrcSS';
const DEST_APP = 'appDstDstDstDstDD';

/**
 * Two-table source: tableA (with a link field to tableB) and tableB.
 */
function makeTwoTableSrc() {
  return {
    tables: [
      {
        id: 'tblSA', name: 'TableA',
        primaryColumnId: 'fldSAName',
        columns: [
          { id: 'fldSAName', name: 'Name', type: 'text', typeOptions: null, description: null },
          { id: 'fldSALink', name: 'LinkedB', type: 'foreignKey',
            typeOptions: { foreignTableId: 'tblSB', relationship: 'many', symmetricColumnId: 'fldSBLink' },
            description: null },
        ],
        views: [{ id: 'viwSA', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          { id: 'recSA1', cellValuesByColumnId: { fldSAName: 'Alpha', fldSALink: ['recSB1'] } },
        ],
      },
      {
        id: 'tblSB', name: 'TableB',
        primaryColumnId: 'fldSBName',
        columns: [
          { id: 'fldSBName', name: 'Name', type: 'text', typeOptions: null, description: null },
          { id: 'fldSBLink', name: 'TableA', type: 'foreignKey',
            typeOptions: { foreignTableId: 'tblSA', relationship: 'one', symmetricColumnId: 'fldSALink' },
            description: null },
        ],
        views: [{ id: 'viwSB', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          { id: 'recSB1', cellValuesByColumnId: { fldSBName: 'Beta' } },
        ],
      },
    ],
  };
}

/**
 * Matching (empty) dest tables for the two-table source.
 */
function makeTwoTableDest() {
  return {
    tables: [
      {
        id: 'tblDA', name: 'TableA',
        primaryColumnId: 'fldDAName',
        columns: [
          { id: 'fldDAName', name: 'Name', type: 'text', typeOptions: null, description: null },
          { id: 'fldDALink', name: 'LinkedB', type: 'foreignKey',
            typeOptions: { foreignTableId: 'tblDB', relationship: 'many', symmetricColumnId: 'fldDBLink' },
            description: null },
        ],
        views: [{ id: 'viwDA', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [], // empty dest
      },
      {
        id: 'tblDB', name: 'TableB',
        primaryColumnId: 'fldDBName',
        columns: [
          { id: 'fldDBName', name: 'Name', type: 'text', typeOptions: null, description: null },
          { id: 'fldDBLink', name: 'TableA', type: 'foreignKey',
            typeOptions: { foreignTableId: 'tblDA', relationship: 'one', symmetricColumnId: 'fldDALink' },
            description: null },
        ],
        views: [{ id: 'viwDB', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [],
      },
    ],
  };
}

// ── applyRecords end-to-end ───────────────────────────────────────────────────

describe('applyRecords — end-to-end orchestration (mock client)', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'apply-recs-'));
    process.env.AIRTABLE_USER_MCP_HOME = tmpDir;
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('creates records in both tables and populates idmap.records', async () => {
    const srcData = makeTwoTableSrc();
    const destData = makeTwoTableDest();

    // Pre-populate the converged schema idmap (what applyPlan would have written):
    const preIdmap = {
      tables: { tblSA: 'tblDA', tblSB: 'tblDB' },
      fields: {
        fldSAName: { destFld: 'fldDAName', choices: {} },
        fldSALink: { destFld: 'fldDALink', choices: {} },
        fldSBName: { destFld: 'fldDBName', choices: {} },
        fldSBLink: { destFld: 'fldDBLink', choices: {} },
      },
      records: {},
      views: { viwSA: 'viwDA', viwSB: 'viwDB' },
    };
    saveIdmap(SRC_APP, DEST_APP, preIdmap);

    const { client, createCalls, addLinkCalls } = makeCombinedClient(SRC_APP, DEST_APP, srcData, destData);

    const result = await applyRecords({
      client,
      sourceBaseId: SRC_APP,
      destBaseId: DEST_APP,
      planId: 'test-plan-1',
      runStartedAt: new Date().toISOString(),
    });

    // Both source records created
    assert.equal(result.created, 2, `expected 2 created, got ${result.created}`);
    assert.equal(result.failed, 0, `expected 0 failed, got ${result.failed}`);

    // idmap.records populated for both source records
    const savedIdmap = loadIdmap(SRC_APP, DEST_APP);
    assert.ok(savedIdmap.records['recSA1'], 'recSA1 must be in idmap.records');
    assert.ok(savedIdmap.records['recSB1'], 'recSB1 must be in idmap.records');

    // Pass 2: addLinkItems called for the link in TableA
    assert.ok(addLinkCalls.length >= 1, 'addLinkItems should have been called for the link field');
    const linkCall = addLinkCalls[0];
    assert.equal(linkCall.columnId, 'fldDALink', 'link items should target the dest link field');
    assert.equal(linkCall.items.length, 1, 'exactly one link item for recSB1→recDB1');
    // The foreignRowId should be the dest record for recSB1
    assert.equal(linkCall.items[0].foreignRowId, savedIdmap.records['recSB1']);
  });

  it('returns result with expected shape (created, updated, skipped, failed, warnings)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-shape-'));

    const srcData = { tables: [{ id: 'tblS1', name: 'Simple', primaryColumnId: 'fldS1', columns: [{ id: 'fldS1', name: 'Name', type: 'text', typeOptions: null, description: null }], views: [{ id: 'vS1', name: 'Grid view', type: 'grid', personalForUserId: null }], records: [{ id: 'recSimple1', cellValuesByColumnId: { fldS1: 'Hello' } }] }] };
    const destData = { tables: [{ id: 'tblD1', name: 'Simple', primaryColumnId: 'fldD1', columns: [{ id: 'fldD1', name: 'Name', type: 'text', typeOptions: null, description: null }], views: [{ id: 'vD1', name: 'Grid view', type: 'grid', personalForUserId: null }], records: [] }] };

    const srcApp = 'appSrcShapeXXXXXX';
    const destApp = 'appDstShapeXXXXXX';

    saveIdmap(srcApp, destApp, {
      tables: { tblS1: 'tblD1' },
      fields: { fldS1: { destFld: 'fldD1', choices: {} } },
      records: {},
      views: {},
    });

    const { client } = makeCombinedClient(srcApp, destApp, srcData, destData);
    const result = await applyRecords({ client, sourceBaseId: srcApp, destBaseId: destApp, planId: 'pShape', runStartedAt: 'ts' });

    // Required shape
    assert.ok(typeof result.created === 'number', 'result.created must be number');
    assert.ok(typeof result.updated === 'number', 'result.updated must be number');
    assert.ok(typeof result.skipped === 'number', 'result.skipped must be number');
    assert.ok(typeof result.failed === 'number', 'result.failed must be number');
    assert.ok(Array.isArray(result.warnings), 'result.warnings must be array');
    assert.equal(result.created, 1, 'one record should be created');
  });

  it('emits RECORD_COUNT warning when snapshotTableRecords returns exactly 1000 rows', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-cap-'));

    const srcApp = 'appSrcCapXXXXXXXX';
    const destApp = 'appDstCapXXXXXXXX';

    // Build 1000 rows
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `recCap${i}`, cellValuesByColumnId: { fldC1: `val${i}` } }));
    const srcData = { tables: [{ id: 'tblC1', name: 'Big', primaryColumnId: 'fldC1', columns: [{ id: 'fldC1', name: 'Name', type: 'text', typeOptions: null, description: null }], views: [{ id: 'vC1', name: 'Grid view', type: 'grid', personalForUserId: null }], records: rows }] };
    const destData = { tables: [{ id: 'tblCD1', name: 'Big', primaryColumnId: 'fldCD1', columns: [{ id: 'fldCD1', name: 'Name', type: 'text', typeOptions: null, description: null }], views: [{ id: 'vCD1', name: 'Grid view', type: 'grid', personalForUserId: null }], records: [] }] };

    saveIdmap(srcApp, destApp, {
      tables: { tblC1: 'tblCD1' },
      fields: { fldC1: { destFld: 'fldCD1', choices: {} } },
      records: {},
      views: {},
    });

    const { client } = makeCombinedClient(srcApp, destApp, srcData, destData);
    const result = await applyRecords({ client, sourceBaseId: srcApp, destBaseId: destApp, planId: 'pCap', runStartedAt: 'ts' });

    const capWarn = result.warnings.find((w) => w.code === 'RECORD_COUNT');
    assert.ok(capWarn, 'expected RECORD_COUNT warning when table returns exactly 1000 rows');
    assert.ok(capWarn.message.includes('1000'), 'warning should mention the count');
  });
});

// ── reconcile ─────────────────────────────────────────────────────────────────

describe('reconcile — prunes stale idmap.records entries', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'reconcile-'));
    process.env.AIRTABLE_USER_MCP_HOME = tmpDir;
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('removes a stale idmap.records entry whose dest record is absent from snapshot', async () => {
    const srcApp = 'appSrcRecXXXXXXXX';
    const destApp = 'appDstRecXXXXXXXX';

    // idmap has recA1→recDestA1 (stale) and recA2→recDestA2 (live)
    const staleIdmap = {
      tables: { tblSA: 'tblDA' },
      fields: { fldSAName: { destFld: 'fldDAName', choices: {} } },
      records: {
        recA1: 'recDestA1',  // stale — not in dest snapshot
        recA2: 'recDestA2',  // live  — still in dest snapshot
      },
      views: {},
    };
    saveIdmap(srcApp, destApp, staleIdmap);

    // Dest snapshot has only recDestA2 (recDestA1 was deleted)
    const destData = {
      tables: [{
        id: 'tblDA', name: 'TableA',
        primaryColumnId: 'fldDAName',
        columns: [{ id: 'fldDAName', name: 'Name', type: 'text', typeOptions: null, description: null }],
        views: [{ id: 'vDA', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          { id: 'recDestA2', cellValuesByColumnId: { fldDAName: 'Live Row' } },
        ],
      }],
    };

    const client = {
      getApplicationData: async () => ({ data: { tableSchemas: JSON.parse(JSON.stringify(destData.tables)) } }),
      queryRecords: async (appId, tableId, viewId) => {
        const tbl = destData.tables.find((t) => t.id === tableId);
        const rows = (tbl && tbl.records) ? tbl.records : [];
        return { summary: { rows: rows.map((r) => ({ id: r.id, fields: r.cellValuesByColumnId || {} })) } };
      },
      getView: async () => ({}),
    };

    const result = await reconcile({
      client,
      sourceBaseId: srcApp,
      destBaseId: destApp,
      naturalKeys: {},
    });

    const after = loadIdmap(srcApp, destApp);

    // stale entry pruned
    assert.equal(after.records['recA1'], undefined, 'stale entry recA1→recDestA1 should be pruned');
    // live entry kept
    assert.equal(after.records['recA2'], 'recDestA2', 'live entry recA2→recDestA2 should be kept');

    // skipped count reflects pruned entries
    assert.equal(result.skipped, 1, 'one entry pruned = skipped:1');
    assert.equal(result.failed, 0);
  });

  it('keeps entries whose dest record is present in the snapshot', async () => {
    const srcApp = 'appSrcRecYYYYYYYY';
    const destApp = 'appDstRecYYYYYYYY';

    const existingIdmap = {
      tables: { tblSX: 'tblDX' },
      fields: {},
      records: { recSX1: 'recDX1', recSX2: 'recDX2' },
      views: {},
    };
    saveIdmap(srcApp, destApp, existingIdmap);

    const destData = {
      tables: [{
        id: 'tblDX', name: 'X',
        primaryColumnId: 'fldDX1',
        columns: [{ id: 'fldDX1', name: 'Name', type: 'text', typeOptions: null, description: null }],
        views: [{ id: 'vDX', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          { id: 'recDX1', cellValuesByColumnId: {} },
          { id: 'recDX2', cellValuesByColumnId: {} },
        ],
      }],
    };

    const client = {
      getApplicationData: async () => ({ data: { tableSchemas: JSON.parse(JSON.stringify(destData.tables)) } }),
      queryRecords: async (appId, tableId) => {
        const tbl = destData.tables.find((t) => t.id === tableId);
        return { summary: { rows: ((tbl && tbl.records) || []).map((r) => ({ id: r.id, fields: {} })) } };
      },
      getView: async () => ({}),
    };

    const result = await reconcile({ client, sourceBaseId: srcApp, destBaseId: destApp, naturalKeys: {} });

    const after = loadIdmap(srcApp, destApp);
    assert.equal(after.records['recSX1'], 'recDX1', 'entry 1 should be kept');
    assert.equal(after.records['recSX2'], 'recDX2', 'entry 2 should be kept');
    assert.equal(result.skipped, 0, 'no pruning expected');
  });
});
