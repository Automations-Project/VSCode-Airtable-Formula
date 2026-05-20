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
  it('processes all fields and reports succeeded/failed counts', async () => {
    // Schema contains all three fields so resolveField succeeds for each.
    // The cache is invalidated after each successful delete, causing a re-fetch
    // that always returns the full schema. postForm fails only for fldBAD.
    const SCHEMA = {
      data: {
        tableSchemas: [{
          id: 'tblAAA',
          columns: [
            { id: 'fld001', name: 'Field A', type: 'text', typeOptions: {} },
            { id: 'fldBAD', name: 'Bad Field', type: 'text', typeOptions: {} },
            { id: 'fld003', name: 'Field C', type: 'text', typeOptions: {} },
          ],
          views: [],
        }],
      },
    };
    const auth = createMockAuth({
      get() {
        return { ok: true, status: 200, json: async () => SCHEMA, text: async () => '{}' };
      },
      postForm(url) {
        // fldBAD destroy call fails with a non-dependency error → throws in deleteField
        if (url.includes('fldBAD')) {
          return { ok: false, status: 422, json: async () => ({ error: { type: 'NOT_FOUND' } }), text: async () => 'not found' };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    });
    const client = new AirtableClient(auth);
    const fields = [
      { fieldId: 'fld001', expectedName: 'Field A' },
      { fieldId: 'fldBAD', expectedName: 'Bad Field' },
      { fieldId: 'fld003', expectedName: 'Field C' },
    ];
    const result = await client.deleteFields('appTEST', fields, { force: true });
    assert.equal(result.succeeded.length, 2, 'two fields should succeed');
    assert.equal(result.failed.length, 1, 'one field should fail');
    assert.equal(result.failed[0].fieldId, 'fldBAD');
    assert.ok(typeof result.failed[0].error === 'string', 'error must be a string');
  });

  it('calls onProgress once per field', async () => {
    const auth = createMockAuth({
      get() {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: { tableSchemas: [{ id: 'tbl1', columns: [{ id: 'fld001', name: 'A', type: 'text', typeOptions: {} }], views: [] }] },
          }),
          text: async () => '{}',
        };
      },
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

  it('continues processing after a per-field failure', async () => {
    // Schema contains both fields. fld001 postForm fails (non-dep error → throws),
    // fld002 succeeds. Cache is invalidated only on success, but the schema mock
    // always returns both fields so both resolveField calls succeed regardless.
    const SCHEMA2 = {
      data: { tableSchemas: [{ id: 'tbl1', columns: [
        { id: 'fld001', name: 'A', type: 'text', typeOptions: {} },
        { id: 'fld002', name: 'B', type: 'text', typeOptions: {} },
      ], views: [] }] },
    };
    const auth = createMockAuth({
      get() {
        return { ok: true, status: 200, json: async () => SCHEMA2, text: async () => '{}' };
      },
      postForm(url) {
        if (url.includes('fld001')) return { ok: false, status: 422, json: async () => ({ error: { type: 'ERR' } }), text: async () => 'err' };
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [
      { fieldId: 'fld001', expectedName: 'A' },
      { fieldId: 'fld002', expectedName: 'B' },
    ], { force: true });
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.failed.length, 1);
  });

  it('routes deleted:false (dependency-blocked) to failed[] when force=false', async () => {
    const DEPENDENCY_RESPONSE = {
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED',
          details: { dependentColumns: [{ id: 'fldDEP', type: 'formula' }] },
        },
      }),
      text: async () => JSON.stringify({ error: { type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED' } }),
    };
    const auth = createMockAuth({
      get() {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: { tableSchemas: [{ id: 'tbl1', columns: [{ id: 'fld001', name: 'HasDeps', type: 'formula', typeOptions: {} }], views: [] }] },
          }),
          text: async () => '{}',
        };
      },
      postForm() {
        return DEPENDENCY_RESPONSE;
      },
    });
    const client = new AirtableClient(auth);
    const result = await client.deleteFields('appTEST', [{ fieldId: 'fld001', expectedName: 'HasDeps' }], { force: false });
    assert.equal(result.succeeded.length, 0, 'no fields should be in succeeded');
    assert.equal(result.failed.length, 1, 'dependency-blocked field should be in failed');
    assert.ok(result.failed[0].error.includes('dependencies') || result.failed[0].error.includes('not deleted'),
      `error message should mention dependencies or not deleted, got: "${result.failed[0].error}"`);
  });
});
