/**
 * test-records-policy.test.js
 *
 * Tests for Pass 1 conflict-policy integration in applyRecordsPass1.
 * Fixtures (fakeClient, noLimiter, baseSnap, srcSnap) are kept reusable
 * for Task 5 and Task 6 which append more tests to this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1, pruneRecords } from '../../src/sync/records.js';

export function fakeClient() {
  const calls = { create: [], update: [] };
  return {
    calls,
    async createRecords(appId, tableId, rows) {
      calls.create.push({ tableId, rows });
      return { records: rows.map((r, i) => ({ id: 'recD' + i })), created: rows.map((r, i) => ({ id: 'recD' + i })) };
    },
    async updateRecords(appId, tableId, rows) {
      calls.update.push({ tableId, rows });
      return { updated: rows, failed: [] };
    },
  };
}

export const noLimiter = { run: (fn) => fn() };

export const baseSnap = () => ({
  baseId: 'appD',
  tables: [{ id: 'tD', name: 'Games', fields: [{ id: 'dN', name: 'Name', type: 'text' }] }],
});

export function srcSnap() {
  return {
    baseId: 'appS',
    tables: [{
      id: 'tS',
      name: 'Games',
      primaryFieldId: 'sN',
      fields: [{ id: 'sN', name: 'Name', type: 'text' }],
      records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'Zelda' } }],
    }],
  };
}

describe('Pass1 field mapping (injection)', () => {
  it('writes a computed source value into a scalar dest field on CREATE', async () => {
    const client = fakeClient();
    const src = { baseId: 'appS', tables: [{ id: 'tS', name: 'Offers', primaryFieldId: 'sN',
      fields: [{ id: 'sN', name: 'Name', type: 'text' }, { id: 'sCode', name: 'Code', type: 'autoNumber' }],
      records: [{ id: 'recS1', cellValuesByColumnId: { sN: 'A', sCode: 1042 } }] }] };
    const dst = { baseId: 'appD', tables: [{ id: 'tD', name: 'Offers',
      fields: [{ id: 'dN', name: 'Name', type: 'text' }, { id: 'dInject', name: 'InjectID', type: 'number' }] }] };
    const idmap = { tables: { tS: 'tD' }, fields: { sN: { destFld: 'dN', choices: {} } }, records: {} };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    const fieldMappings = [{ table: 'Offers', srcFieldId: 'sCode', destFieldId: 'dInject', destType: 'number' }];
    await applyRecordsPass1({ client, srcSnapshot: src, destSnapshot: dst, idmap, limiter: noLimiter, journal: {}, persist: () => {}, result, fieldMappings });
    const created = client.calls.create[0].rows[0].cellValuesByColumnId;
    assert.equal(created.dInject, 1042, 'source Code value injected into dest InjectID');
  });
});

describe('Pass1 conflict policy', () => {
  it('dest-wins (preserve) skips updating an already-mapped record', async () => {
    const client = fakeClient();
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} } },
      records: { recS1: 'recD_existing' },
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client,
      srcSnapshot: srcSnap(),
      destSnapshot: baseSnap(),
      idmap,
      limiter: noLimiter,
      journal: {},
      persist: () => {},
      result,
      policy: 'preserve',
    });
    assert.equal(client.calls.update.length, 0, 'no update under preserve');
  });

  it('source-wins (overlay) updates the mapped record', async () => {
    const client = fakeClient();
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sN: { destFld: 'dN', choices: {} } },
      records: { recS1: 'recD_existing' },
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client,
      srcSnapshot: srcSnap(),
      destSnapshot: baseSnap(),
      idmap,
      limiter: noLimiter,
      journal: {},
      persist: () => {},
      result,
      policy: 'overlay',
    });
    assert.equal(client.calls.update.length, 1, 'one update under overlay');
  });
});

// ── Task 6: pruneRecords (extras axis) ───────────────────────────────────────

function pruneClient(rowsByTable) {
  const calls = { deleted: [] };
  return {
    calls,
    async queryRecords(appId, tableId) { return { summary: { rows: (rowsByTable[tableId] || []).map((id) => ({ id, fields: {} })) } }; },
    async deleteRecords(appId, tableId, rowIds) { calls.deleted.push({ tableId, rowIds }); return { deleted: rowIds.length }; },
  };
}
const destSnap2 = () => ({ baseId: 'appD', tables: [{ id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [] }] });

describe('pruneRecords (extras axis)', () => {
  it('mirror + confirmDeletions deletes orphan dest rows (not in idmap.records)', async () => {
    const client = pruneClient({ tD: ['recKeep', 'recOrphan'] });
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'mirror', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.deepEqual(client.calls.deleted, [{ tableId: 'tD', rowIds: ['recOrphan'] }]);
    assert.equal(result.deleted, 1);
  });
  it('mirror WITHOUT confirmDeletions deletes nothing + warns DELETION_GATED', async () => {
    const client = pruneClient({ tD: ['recKeep', 'recOrphan'] });
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'mirror', confirmDeletions: false, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0);
    const w = result.warnings.find((x) => x.code === 'DELETION_GATED');
    assert.ok(w && /1/.test(w.message), 'gated warning with count 1');
  });
  it('keep/preserve table is never pruned', async () => {
    const client = pruneClient({ tD: ['recKeep', 'recOrphan'] });
    const idmap = { tables: { tS: 'tD' }, fields: {}, records: { recS1: 'recKeep' } };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await pruneRecords({ client, destSnapshot: destSnap2(), idmap, policy: 'overlay', confirmDeletions: true, limiter: { run: (fn) => fn() }, result });
    assert.equal(client.calls.deleted.length, 0);
  });
});
