import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { matchByNaturalKeys, reconcile, runRecords } from '../../src/sync/records.js';
import { saveIdmap } from '../../src/sync/idmap.js';

// helper builders
const tbl = (name, fields, records) => ({ id: 't' + name, name, fields, records });
const fld = (id, name, type = 'text') => ({ id, name, type });
const rec = (id, cells) => ({ id, cellValuesByColumnId: cells });

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

// ──────────────────────────────────────────────────────────────────────────────
// reconcile — natural-key integration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a fake client that serves two in-memory bases by appId.
 * bases: { [appId]: { tables: [{ id, name, fields: [{id,name,type}], records: [{id,cellValuesByColumnId}] }] } }
 *
 * getApplicationData → data.tables shape (normalizeSchema accepts both tableSchemas and tables).
 * queryRecords → summary.rows with { id, fields } shape.
 */
function makeReconcileClient(bases) {
  return {
    async getApplicationData(appId) {
      const base = bases[appId] || { tables: [] };
      return {
        data: {
          tables: base.tables.map((t) => ({
            id: t.id,
            name: t.name,
            primaryFieldId: t.fields[0]?.id ?? null,
            fields: t.fields,
            views: [{ id: 'v' + t.id, name: 'Grid view', type: 'grid' }],
          })),
        },
      };
    },
    async queryRecords(appId, tableId, _viewId, _opts) {
      const base = bases[appId] || { tables: [] };
      const t = base.tables.find((x) => x.id === tableId);
      return {
        summary: {
          rows: (t?.records || []).map((r) => ({ id: r.id, fields: r.cellValuesByColumnId })),
        },
      };
    },
  };
}

describe('reconcile naturalKeys integration', () => {
  it('snapshots source, calls matchByNaturalKeys, returns matched>0, no NOT_IMPLEMENTED stub', async () => {
    // Redirect disk I/O to a throwaway temp dir — hermetic, no real ~/.airtable-user-mcp writes.
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'reconcile-nk-'));

    const SRC = 'appSRC001';
    const DST = 'appDST001';

    // Pre-seed an idmap that has a table match but NO record match for recS1/recD1.
    saveIdmap(SRC, DST, {
      tables: { tSRC: 'tDST' },
      fields: {},
      records: {},
    });

    const bases = {
      [SRC]: {
        tables: [{
          id: 'tSRC',
          name: 'Contacts',
          fields: [{ id: 'fSrcEmail', name: 'Email', type: 'text' }],
          records: [{ id: 'recS1', cellValuesByColumnId: { fSrcEmail: 'alice@example.com' } }],
        }],
      },
      [DST]: {
        tables: [{
          id: 'tDST',
          name: 'Contacts',
          fields: [{ id: 'fDstEmail', name: 'Email', type: 'text' }],
          records: [{ id: 'recD1', cellValuesByColumnId: { fDstEmail: 'alice@example.com' } }],
        }],
      },
    };

    const result = await reconcile({
      client: makeReconcileClient(bases),
      sourceBaseId: SRC,
      destBaseId: DST,
      naturalKeys: { Contacts: 'Email' },
    });

    // (a) matched is present and > 0 — matchByNaturalKeys was called and found the pair
    assert.equal(result.matched, 1, 'reconcile should report matched=1 after natural-key match');

    // (b) No RECONCILE_NATURAL_KEY_NOT_IMPLEMENTED stub warning emitted
    const stubWarns = result.warnings.filter((w) => w.code === 'RECONCILE_NATURAL_KEY_NOT_IMPLEMENTED');
    assert.equal(stubWarns.length, 0, 'stub warning must be gone');

    // (c) The idmap on disk now has the record mapping
    assert.equal(result.idmap.records.recS1, 'recD1', 'idmap.records must include the matched pair');
  });

  it('reconcile without naturalKeys returns matched:0 and no stub warnings', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'reconcile-nonk-'));

    const SRC = 'appSRC002';
    const DST = 'appDST002';

    saveIdmap(SRC, DST, { tables: {}, fields: {}, records: { recS1: 'recD1' } });

    const bases = {
      [SRC]: { tables: [] },
      [DST]: {
        tables: [{
          id: 'tDST',
          name: 'T',
          fields: [{ id: 'fDstId', name: 'Name', type: 'text' }],
          records: [{ id: 'recD1', cellValuesByColumnId: {} }],
        }],
      },
    };

    const result = await reconcile({
      client: makeReconcileClient(bases),
      sourceBaseId: SRC,
      destBaseId: DST,
      // no naturalKeys
    });

    assert.equal(result.matched, 0, 'no naturalKeys → matched stays 0');
    assert.equal(result.warnings.filter((w) => w.code === 'RECONCILE_NATURAL_KEY_NOT_IMPLEMENTED').length, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runRecords natural-key pre-pass integration test
// ──────────────────────────────────────────────────────────────────────────────

function recClient() {
  const calls = { create: [], update: [], deleted: [] };
  return {
    calls,
    async createRecords(appId, tableId, rows) {
      calls.create.push({ tableId, rows });
      return { records: rows.map((r, i) => ({ id: 'new' + i })), created: rows.map((r, i) => ({ id: 'new' + i, sourceKey: r.sourceKey, rowId: 'new' + i })) };
    },
    async updateRecords(appId, tableId, rows) { calls.update.push({ tableId, rows }); return { updated: rows, failed: [] }; },
    async queryRecords(appId, tableId) { return { summary: { rows: [] } }; }, // not used (prune reads snapshot .records)
    async deleteRecords(appId, tableId, rowIds) { calls.deleted.push({ tableId, rowIds }); return { deleted: rowIds.length }; },
    async addLinkItems() { return { ok: true }; },
    async createDataTransferPolicy() { return {}; },
    async pasteAttachmentsCrossBase() { return { pastedRowIds: [] }; },
  };
}

describe('runRecords natural-key pre-pass (mirror safety)', () => {
  it('a real-but-unmapped dest record is matched, NOT deleted by mirror, NOT duplicated', async () => {
    const client = recClient();
    const src = {
      baseId: 'appS',
      tables: [{
        id: 'tS', name: 'Customers', primaryFieldId: 'sEmail',
        fields: [{ id: 'sEmail', name: 'Email', type: 'text' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { sEmail: 'a@x.com' } }],
      }],
    };
    const dst = {
      baseId: 'appD',
      tables: [{
        id: 'tD', name: 'Customers', views: [{ id: 'vD' }],
        fields: [{ id: 'dEmail', name: 'Email', type: 'text' }],
        records: [{ id: 'recD1', cellValuesByColumnId: { dEmail: 'a@x.com' } }],
      }],
    };
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sEmail: { destFld: 'dEmail', choices: {} } },
      records: {},
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client,
      srcSnapshot: src,
      destSnapshot: dst,
      idmap,
      policy: 'mirror',
      confirmDeletions: true,
      naturalKeys: { Customers: 'Email' },
      limiter: { run: (f) => f() },
      journal: {},
      persist: () => {},
      result,
    });

    assert.equal(idmap.records.recS1, 'recD1', 'pre-pass matched the record');
    assert.equal(client.calls.create.length, 0, 'no duplicate create (went update path)');
    assert.deepEqual(client.calls.deleted, [], 'mirror did NOT delete the matched dest record');
  });
});
