// Tests for select-field choice normalization (user-reported bugs 2026-05-17):
//   §1 — "multipleSelects" must be sent as "multiSelect" (no "s") to internal API
//   §2 — choices must be object { selXXX: { name, color } } not array
//   §3 — IDs generated for new choices must be "sel" + 14 alphanumeric chars
//   §4 — existing choices with id are preserved under their own key
//   §5 — already-correct object format passes through unchanged

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

const MOCK_SCHEMA = {
  data: {
    tableSchemas: [
      {
        id: 'tblAAA',
        name: 'Games',
        columns: [
          { id: 'fldMulti', name: 'Platforms', type: 'multiSelect', typeOptions: {
            choices: { selAAAAAAAAAAAAAAAA: { name: 'PC', color: 'blueLight2' } },
          }},
          { id: 'fldSingle', name: 'Status', type: 'singleSelect', typeOptions: {
            choices: { selBBBBBBBBBBBBBBBB: { name: 'Active', color: 'greenLight2' } },
          }},
        ],
        views: [],
      },
    ],
  },
};

function createMockAuth() {
  const calls = [];
  return {
    calls,
    getSecretSocketId: () => 'socTEST123',
    get() {
      return { ok: true, status: 200, json: async () => MOCK_SCHEMA, text: async () => JSON.stringify(MOCK_SCHEMA) };
    },
    postForm(url, params) {
      calls.push({ url, params });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    },
  };
}

function parsedPayload(call) {
  return JSON.parse(call.params.stringifiedObjectParams);
}

describe('multipleSelects → multiSelect type normalization', () => {
  it('createField: "multipleSelects" is sent as "multiSelect" to the internal API', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.createField('appAAA', 'tblAAA', {
      name: 'Platforms',
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.config.type, 'multiSelect');
  });

  it('updateFieldConfig: "multipleSelects" is sent as "multiSelect" to the internal API', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.type, 'multiSelect');
  });

  it('updateFieldConfig: "multiSelect" (already correct) is preserved', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: { choices: [{ name: 'PC' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.type, 'multiSelect');
  });
});

describe('choices array → object normalization', () => {
  it('new choices (no id) produce object keys shaped "sel" + 14 alphanumeric chars', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC' }, { name: 'Xbox', color: 'greenLight2' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const keys = Object.keys(payload.typeOptions.choices);
    assert.equal(keys.length, 2);
    for (const key of keys) {
      assert.match(key, /^sel[A-Za-z0-9]{14}$/, `Choice key "${key}" is not "sel" + 14 alphanumeric chars`);
    }
  });

  it('new choices carry correct name and color in their values', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC', color: 'blueLight2' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const values = Object.values(payload.typeOptions.choices);
    assert.equal(values[0].name, 'PC');
    assert.equal(values[0].color, 'blueLight2');
  });

  it('existing choices with id are preserved under their own key', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: {
        choices: [
          { id: 'selAAAAAAAAAAAAAAAA', name: 'PC', color: 'blueLight2' },
          { name: 'Xbox' },
        ],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const choices = payload.typeOptions.choices;
    assert.ok(choices['selAAAAAAAAAAAAAAAA'], 'existing choice should be keyed by its id');
    assert.equal(choices['selAAAAAAAAAAAAAAAA'].name, 'PC');
    const keys = Object.keys(choices);
    assert.equal(keys.length, 2);
    const newKey = keys.find(k => k !== 'selAAAAAAAAAAAAAAAA');
    assert.match(newKey, /^sel[A-Za-z0-9]{14}$/, 'generated key must match sel+14 alphanumeric');
  });

  it('already-object choices pass through unchanged', async () => {
    const existingChoices = { selAAAAAAAAAAAAAAAA: { name: 'PC', color: 'blueLight2' } };
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: { choices: existingChoices },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.deepEqual(payload.typeOptions.choices, existingChoices);
  });

  it('singleSelect choices are also normalized from array to object', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldSingle', {
      type: 'singleSelect',
      typeOptions: { choices: [{ name: 'Active', color: 'greenLight2' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const keys = Object.keys(payload.typeOptions.choices);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /^sel[A-Za-z0-9]{14}$/);
  });
});
