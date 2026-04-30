// Tests for the 2.3.2 / Round-4 fixes (user report 2026-04-30):
//   §2.1 + §2.2 — auto-rewrite isEmpty/isNotEmpty on text + formula(text) + lookup/rollup(text)
//   §2.3       — foreignKey isEmpty/isNotEmpty throws clear error
//   §2.4 / §2.5 — enrichFilterError surfaces nesting-depth limit and likely causes
//   §2.6       — reorder_view_fields accepts partial maps and merges with current order
//
// All tests use the mock-auth pattern from test-client.test.js so we can
// inspect what the client *would have sent* to Airtable.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

const MOCK_SCHEMA = {
  data: {
    tableSchemas: [
      {
        id: 'tblAAA',
        name: 'Offers',
        columns: [
          { id: 'fldText',     name: 'Code',        type: 'text',       typeOptions: {} },
          { id: 'fldFormula',  name: 'IsExpired',   type: 'formula',    typeOptions: { resultType: 'text' } },
          { id: 'fldLookup',   name: 'Marketplace', type: 'lookup',     typeOptions: { resultType: 'text' } },
          { id: 'fldRollupNum',name: 'Total',       type: 'rollup',     typeOptions: { resultType: 'number' } },
          { id: 'fldFK',       name: 'Marketplaces',type: 'foreignKey', typeOptions: {} },
          { id: 'fldNumber',   name: 'Asking',      type: 'number',     typeOptions: {} },
        ],
        views: [{ id: 'viwTEST', name: 'Grid', type: 'grid' }],
      },
    ],
  },
};

const VIEW_DATA = {
  data: {
    viewDatas: [
      {
        id: 'viwTEST',
        type: 'grid',
        columnOrder: [
          { columnId: 'fldText',      visibility: true },
          { columnId: 'fldFormula',   visibility: true },
          { columnId: 'fldLookup',    visibility: true },
          { columnId: 'fldRollupNum', visibility: true },
          { columnId: 'fldFK',        visibility: true },
          { columnId: 'fldNumber',    visibility: true },
        ],
      },
    ],
  },
};

function createMockAuth({ postForm } = {}) {
  const calls = [];
  return {
    calls,
    getSecretSocketId: () => 'socTEST123',
    get(url) {
      calls.push({ method: 'GET', url });
      if (url.includes('readData')) {
        return { ok: true, status: 200, json: async () => VIEW_DATA, text: async () => JSON.stringify(VIEW_DATA) };
      }
      return { ok: true, status: 200, json: async () => MOCK_SCHEMA, text: async () => JSON.stringify(MOCK_SCHEMA) };
    },
    postForm(url, params) {
      calls.push({ method: 'POST', url, params });
      if (postForm) return postForm(url, params);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    },
    postJSON: () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
}

describe('updateViewFilters — emptiness rewrites (§2.1, §2.2, §2.3)', () => {
  it('rewrites isEmpty → "=" "" on a text field', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateViewFilters('appXXX', 'viwTEST', {
      filterSet: [{ columnId: 'fldText', operator: 'isEmpty' }],
      conjunction: 'and',
    });
    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateFilters'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    const leaf = sentPayload.filters.filterSet[0];
    assert.equal(leaf.operator, '=');
    assert.equal(leaf.value, '');
  });

  it('rewrites isNotEmpty → "!=" "" on a formula(text) field', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateViewFilters('appXXX', 'viwTEST', {
      filterSet: [{ columnId: 'fldFormula', operator: 'isNotEmpty' }],
      conjunction: 'and',
    });
    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateFilters'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    const leaf = sentPayload.filters.filterSet[0];
    assert.equal(leaf.operator, '!=');
    assert.equal(leaf.value, '');
  });

  it('rewrites isEmpty on a lookup(text) field', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateViewFilters('appXXX', 'viwTEST', {
      filterSet: [{ columnId: 'fldLookup', operator: 'isEmpty' }],
      conjunction: 'and',
    });
    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateFilters'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    assert.equal(sentPayload.filters.filterSet[0].operator, '=');
    assert.equal(sentPayload.filters.filterSet[0].value, '');
  });

  it('does NOT rewrite isEmpty on a number field', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateViewFilters('appXXX', 'viwTEST', {
      filterSet: [{ columnId: 'fldNumber', operator: 'isEmpty' }],
      conjunction: 'and',
    });
    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateFilters'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    assert.equal(sentPayload.filters.filterSet[0].operator, 'isEmpty');
  });

  it('throws clear error on foreignKey isEmpty/isNotEmpty', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await assert.rejects(
      () => client.updateViewFilters('appXXX', 'viwTEST', {
        filterSet: [{ columnId: 'fldFK', operator: 'isNotEmpty' }],
        conjunction: 'and',
      }),
      { message: /linked-record fields.*Workaround.*helper formula/s },
    );
  });

  it('rewrites inside a nested group', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateViewFilters('appXXX', 'viwTEST', {
      filterSet: [
        {
          type: 'nested',
          conjunction: 'or',
          filterSet: [{ columnId: 'fldText', operator: 'isEmpty' }],
        },
      ],
      conjunction: 'and',
    });
    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateFilters'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    assert.equal(sentPayload.filters.filterSet[0].filterSet[0].operator, '=');
  });
});

describe('updateViewFilters — enriched error (§2.4, §2.5)', () => {
  it('surfaces nesting-depth limit when Airtable returns 422', async () => {
    const auth = createMockAuth({
      postForm: () => ({
        ok: false, status: 422,
        json: async () => ({ error: { type: 'FAILED_STATE_CHECK' } }),
        text: async () => JSON.stringify({ error: { type: 'FAILED_STATE_CHECK' } }),
      }),
    });
    const client = new AirtableClient(auth);
    const deeplyNested = {
      conjunction: 'and',
      filterSet: [
        {
          type: 'nested',
          conjunction: 'or',
          filterSet: [
            {
              type: 'nested',
              conjunction: 'and',
              filterSet: [{ columnId: 'fldText', operator: 'contains', value: 'x' }],
            },
          ],
        },
      ],
    };
    await assert.rejects(
      () => client.updateViewFilters('appXXX', 'viwTEST', deeplyNested),
      { message: /depth is 3.*Flatten/s },
    );
  });
});

describe('reorderViewFields — partial-map merge (§2.6)', () => {
  it('merges a single-field move with the current columnOrder', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    // Move fldFK to position 1 (originally position 4).
    await client.reorderViewFields('appXXX', 'viwTEST', { fldFK: 1 });

    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateMultipleViewConfigs'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    const indices = sentPayload.targetOverallColumnIndicesById;
    // All 6 fields should be present in the final map
    assert.equal(Object.keys(indices).length, 6);
    // fldFK should be at position 1
    assert.equal(indices.fldFK, 1);
    // Original neighbours shift accordingly
    assert.equal(indices.fldText, 0);    // unchanged
    assert.equal(indices.fldFormula, 2); // bumped
  });

  it('handles multiple moves applied in ascending target-order', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.reorderViewFields('appXXX', 'viwTEST', { fldNumber: 0, fldFK: 1 });

    const post = auth.calls.find(c => c.method === 'POST' && c.url.includes('updateMultipleViewConfigs'));
    const sentPayload = JSON.parse(post.params.stringifiedObjectParams);
    const indices = sentPayload.targetOverallColumnIndicesById;
    assert.equal(indices.fldNumber, 0);
    assert.equal(indices.fldFK, 1);
    // Total should still cover every field
    assert.equal(Object.keys(indices).length, 6);
  });
});
