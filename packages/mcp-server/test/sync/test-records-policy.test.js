/**
 * test-records-policy.test.js
 *
 * Tests for Pass 1 conflict-policy integration in applyRecordsPass1.
 * Fixtures (fakeClient, noLimiter, baseSnap, srcSnap) are kept reusable
 * for Task 5 and Task 6 which append more tests to this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1 } from '../../src/sync/records.js';

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
