import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

function createMockAuth(responses = {}) {
  const calls = [];
  const defaultResponse = { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '{}' };
  return {
    calls,
    getSecretSocketId: () => 'socTEST',
    get(url, appId) { calls.push({ method: 'GET', url, appId }); return responses.get?.(url) || { ...defaultResponse }; },
    postForm(url, params, appId) { calls.push({ method: 'POST', url, params, appId }); return responses.postForm?.(url, params) || { ...defaultResponse }; },
  };
}
// Decode the payload the client put into stringifiedObjectParams
function payloadOf(call) { return JSON.parse(call.params.stringifiedObjectParams); }

describe('AirtableClient.createRecords', () => {
  it('creates one row per record with client-generated rec IDs', async () => {
    const auth = createMockAuth({});
    const client = new AirtableClient(auth);
    const result = await client.createRecords('appT', 'tblT', [
      { cellValuesByColumnId: { fldA: 'x' }, sourceKey: 's1' },
      { cellValuesByColumnId: { fldA: 'y' }, sourceKey: 's2' },
    ], { viewId: 'viwT' });

    assert.equal(result.created.length, 2);
    assert.equal(result.failed.length, 0);
    const createCalls = auth.calls.filter(c => /\/row\/rec[A-Za-z0-9]+\/create$/.test(c.url));
    assert.equal(createCalls.length, 2);
    const p0 = payloadOf(createCalls[0]);
    assert.equal(p0.tableId, 'tblT');
    assert.deepEqual(p0.cellValuesByColumnId, { fldA: 'x' });
    assert.equal(p0.activeViewId, 'viwT');
    assert.notEqual(result.created[0].rowId, result.created[1].rowId);
    assert.equal(result.created[0].sourceKey, 's1');
  });

  it('isolates a failing row without aborting the batch', async () => {
    const auth = createMockAuth({
      postForm(url, params) {
        const p = JSON.parse(params.stringifiedObjectParams);
        if (p.cellValuesByColumnId?.fldA === 'BOOM') return { ok: false, status: 422, json: async () => ({}), text: async () => 'computed field' };
        return { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '{}' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.createRecords('appT', 'tblT', [
      { cellValuesByColumnId: { fldA: 'ok' }, sourceKey: 's1' },
      { cellValuesByColumnId: { fldA: 'BOOM' }, sourceKey: 's2' },
    ], { viewId: 'viwT' });
    assert.equal(result.created.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].sourceKey, 's2');
    assert.match(result.failed[0].error, /422/);
  });
});

describe('AirtableClient.updateRecords', () => {
  it('sets each primitive cell via updatePrimitiveCell', async () => {
    const auth = createMockAuth({});
    const client = new AirtableClient(auth);
    const result = await client.updateRecords('appT', 'tblT', [
      { rowId: 'rec1', cellValuesByColumnId: { fldA: 'x', fldB: 'selZ' } },
    ]);
    assert.equal(result.updated.length, 1);
    assert.equal(result.failed.length, 0);
    const cellCalls = auth.calls.filter(c => /\/row\/rec1\/updatePrimitiveCell$/.test(c.url));
    assert.equal(cellCalls.length, 2);
    const cols = cellCalls.map(c => JSON.parse(c.params.stringifiedObjectParams).columnId).sort();
    assert.deepEqual(cols, ['fldA', 'fldB']);
  });
});

describe('AirtableClient.deleteRecords', () => {
  it('deletes rows in one destroyMultipleRows call', async () => {
    const auth = createMockAuth({
      postForm: () => ({ ok: true, status: 200, json: async () => ({ data: { actionId: 'actX' } }), text: async () => '{}' }),
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteRecords('appT', 'tblT', ['rec1', 'rec2'], { viewId: 'viwT' });
    assert.equal(result.deleted, 2);
    const calls = auth.calls.filter(c => /\/table\/tblT\/destroyMultipleRows$/.test(c.url));
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].params.stringifiedObjectParams).rowIds, ['rec1', 'rec2']);
  });
});
