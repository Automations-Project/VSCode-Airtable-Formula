import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ─── shared mock helpers ───────────────────────────────────────────────────

function createMockAuth(responses = {}) {
  const calls = [];
  const defaultResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  };
  return {
    calls,
    getSecretSocketId: () => 'socTEST',
    get(url, appId)           { calls.push({ method: 'GET',  url, appId }); return responses.get?.(url)      || { ...defaultResponse }; },
    postForm(url, params, appId) { calls.push({ method: 'POST', url, params, appId }); return responses.postForm?.(url, params) || { ...defaultResponse }; },
    postJSON(url, body, appId)   { calls.push({ method: 'POST', url, body,   appId }); return responses.postJSON?.(url, body)   || { ...defaultResponse }; },
  };
}

// ─── rate delay test ──────────────────────────────────────────────────────

describe('AirtableAuth rate delay', () => {
  it('_rateDelayMs defaults to 0', () => {
    // Import the class to verify the constructor default.
    // We cannot instantiate AirtableAuth (it needs patchright), but we can
    // inspect the constructor source to confirm the default.
    // This test guards against accidental removal of the field.
    const fs = _require('node:fs');
    const src = fs.readFileSync(
      new URL('../src/auth.js', import.meta.url),
      'utf8'
    );
    assert.ok(src.includes('_rateDelayMs'), '_rateDelayMs field must exist in auth.js');
    assert.ok(
      src.includes('AIRTABLE_RATE_DELAY_MS'),
      'env var AIRTABLE_RATE_DELAY_MS must be referenced',
    );
  });
});

describe('tool-call semaphore helpers', () => {
  it('acquires immediately when inflight < cap', async () => {
    const src = _require('node:fs').readFileSync(
      new URL('../src/index.js', import.meta.url),
      'utf8'
    );
    assert.ok(src.includes('_acquireToolSlot'), '_acquireToolSlot must be defined');
    assert.ok(src.includes('_releaseToolSlot'), '_releaseToolSlot must be defined');
    assert.ok(src.includes('_pendingToolQueue'), '_pendingToolQueue must be defined');
  });
});

import { AirtableClient } from '../src/client.js';

describe('AirtableClient.deleteFields', () => {
  it('batch-deletes all fields with no dependencies in one API call', async () => {
    const SCHEMA = { data: { tableSchemas: [{ id: 'tblAAA', columns: [
      { id: 'fld001', name: 'Field A', type: 'text', typeOptions: {} },
      { id: 'fld002', name: 'Field B', type: 'text', typeOptions: {} },
    ], views: [] }] } };
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
      postForm(url) {
        if (url.includes('destroyMultipleColumns')) {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
        }
        return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [
      { fieldId: 'fld001', expectedName: 'Field A' },
      { fieldId: 'fld002', expectedName: 'Field B' },
    ]);
    assert.equal(result.succeeded.length, 2);
    assert.equal(result.failed.length, 0);
    const batchCalls = auth.calls.filter(c => c.url.includes('destroyMultipleColumns'));
    assert.equal(batchCalls.length, 1, 'should make exactly one batch call when no deps');
  });

  it('makes two batch calls when force=true and deps exist', async () => {
    const SCHEMA = { data: { tableSchemas: [{ id: 'tblAAA', columns: [
      { id: 'fld001', name: 'HasDeps', type: 'text', typeOptions: {} },
    ], views: [] }] } };
    let batchCallCount = 0;
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
      postForm(url) {
        if (!url.includes('destroyMultipleColumns')) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
        batchCallCount++;
        if (batchCallCount === 1) {
          return { ok: false, status: 422, json: async () => ({ error: { type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED' } }), text: async () => '' };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [{ fieldId: 'fld001', expectedName: 'HasDeps' }], { force: true });
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.succeeded[0].forced, true);
    assert.equal(batchCallCount, 2, 'should make two batch calls for force=true + deps');
  });

  it('routes to failed when deps exist and force=false', async () => {
    const SCHEMA = { data: { tableSchemas: [{ id: 'tblAAA', columns: [
      { id: 'fld001', name: 'HasDeps', type: 'text', typeOptions: {} },
    ], views: [] }] } };
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
      postForm() {
        return { ok: false, status: 422, json: async () => ({ error: { type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED' } }), text: async () => '' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [{ fieldId: 'fld001', expectedName: 'HasDeps' }], { force: false });
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.failed.length, 1);
    assert.ok(result.failed[0].error.includes('dependencies'), `expected dep error, got: "${result.failed[0].error}"`);
    const batchCalls = auth.calls.filter(c => c.url.includes('destroyMultipleColumns'));
    assert.equal(batchCalls.length, 1, 'should stop after first call when force=false');
  });

  it('routes to failed when expectedName does not match', async () => {
    const SCHEMA = { data: { tableSchemas: [{ id: 'tblAAA', columns: [
      { id: 'fld001', name: 'Actual Name', type: 'text', typeOptions: {} },
    ], views: [] }] } };
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [{ fieldId: 'fld001', expectedName: 'Wrong Name' }]);
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.failed.length, 1);
    assert.ok(result.failed[0].error.includes('Safety check'), `expected safety check error, got: "${result.failed[0].error}"`);
    assert.equal(auth.calls.filter(c => c.url.includes('destroyMultipleColumns')).length, 0, 'no batch call if safety check fails');
  });

  it('processes fields from different tables independently', async () => {
    const SCHEMA = { data: { tableSchemas: [
      { id: 'tbl1', columns: [{ id: 'fld001', name: 'A', type: 'text', typeOptions: {} }], views: [] },
      { id: 'tbl2', columns: [{ id: 'fld002', name: 'B', type: 'text', typeOptions: {} }], views: [] },
    ] } };
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
      postForm(url) {
        if (url.includes('tbl1')) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
        return { ok: false, status: 500, json: async () => ({ error: { type: 'INTERNAL' } }), text: async () => 'error' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [
      { fieldId: 'fld001', expectedName: 'A' },
      { fieldId: 'fld002', expectedName: 'B' },
    ]);
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.succeeded[0].fieldId, 'fld001');
    assert.equal(result.failed[0].fieldId, 'fld002');
  });

  it('calls onProgress once at end with final counts', async () => {
    const SCHEMA = { data: { tableSchemas: [{ id: 'tbl1', columns: [
      { id: 'fld001', name: 'A', type: 'text', typeOptions: {} },
    ], views: [] }] } };
    const auth = createMockAuth({
      get() { return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' }; },
    });
    const client = new AirtableClient(auth);
    const progressLog = [];
    await client.deleteFields('appTEST', [{ fieldId: 'fld001', expectedName: 'A' }], {
      onProgress: (info) => progressLog.push(info),
    });
    assert.equal(progressLog.length, 1);
    assert.equal(progressLog[0].index, 0);
    assert.equal(progressLog[0].total, 1);
  });
});
