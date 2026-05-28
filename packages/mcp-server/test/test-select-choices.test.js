// Tests for select-field choice normalization (confirmed from capture 2026-05-28):
//   §1 — "multipleSelects" must be sent as "multiSelect" (no "s") to internal API
//   §2 — choices must be object { selXXX: { id, name, color? } } not array
//   §3 — IDs generated for new choices must be "sel" + 14 alphanumeric chars
//   §4 — existing choices with id are preserved under their own key
//   §5 — object-form choices get id added to each value (internal API requires it)
//   §6 — choiceOrder array must be sent in typeOptions
//   §7 — disableColors: false must be sent in typeOptions
//   §8 — default (string for select, array for multiSelect) sent outside typeOptions

import { describe, it } from 'node:test';
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
            choices: { selAAAAAAAAAAAAAAAA: { id: 'selAAAAAAAAAAAAAAAA', name: 'PC', color: 'blue' } },
          }},
          { id: 'fldSingle', name: 'Status', type: 'singleSelect', typeOptions: {
            choices: { selBBBBBBBBBBBBBBBB: { id: 'selBBBBBBBBBBBBBBBB', name: 'Active', color: 'green' } },
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

// ─── §1 — type name normalization ────────────────────────────────────────────

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

// ─── §2–§5 — choices format ──────────────────────────────────────────────────

describe('choices array → object normalization', () => {
  it('new choices (no id) produce object keys shaped "sel" + 14 alphanumeric chars', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC' }, { name: 'Xbox', color: 'green' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const keys = Object.keys(payload.typeOptions.choices);
    assert.equal(keys.length, 2);
    for (const key of keys) {
      assert.match(key, /^sel[A-Za-z0-9]{14}$/, `Choice key "${key}" is not "sel" + 14 alphanumeric chars`);
    }
  });

  it('new choices carry id, name, and color in their values (§ capture-confirmed format)', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: { choices: [{ name: 'PC', color: 'blue' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const [[key, val]] = Object.entries(payload.typeOptions.choices);
    assert.equal(val.name, 'PC');
    assert.equal(val.color, 'blue');
    assert.equal(val.id, key, 'id inside value must match the object key');
  });

  it('existing choices with id are preserved under their own key', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: {
        choices: [
          { id: 'selAAAAAAAAAAAAAAAA', name: 'PC', color: 'blue' },
          { name: 'Xbox' },
        ],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const choices = payload.typeOptions.choices;
    assert.ok(choices['selAAAAAAAAAAAAAAAA'], 'existing choice should be keyed by its id');
    assert.equal(choices['selAAAAAAAAAAAAAAAA'].name, 'PC');
    assert.equal(choices['selAAAAAAAAAAAAAAAA'].id, 'selAAAAAAAAAAAAAAAA', 'id must be in value');
    const keys = Object.keys(choices);
    assert.equal(keys.length, 2);
    const newKey = keys.find(k => k !== 'selAAAAAAAAAAAAAAAA');
    assert.match(newKey, /^sel[A-Za-z0-9]{14}$/, 'generated key must match sel+14 alphanumeric');
  });

  it('object-form choices get id added to each value', async () => {
    // The internal API requires { selXXX: { id: "selXXX", name, color } }.
    // When caller passes an object without id inside values, we inject it.
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: { choices: { selAAAAAAAAAAAAAAAA: { name: 'PC', color: 'blue' } } },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const choice = payload.typeOptions.choices['selAAAAAAAAAAAAAAAA'];
    assert.equal(choice.id, 'selAAAAAAAAAAAAAAAA', 'id must be injected into value');
    assert.equal(choice.name, 'PC');
    assert.equal(choice.color, 'blue');
  });

  it('singleSelect choices are also normalized from array to object', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldSingle', {
      type: 'singleSelect',
      typeOptions: { choices: [{ name: 'Active', color: 'green' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    const keys = Object.keys(payload.typeOptions.choices);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /^sel[A-Za-z0-9]{14}$/);
    assert.equal(payload.typeOptions.choices[keys[0]].id, keys[0], 'id must be in value');
  });
});

// ─── §6 — choiceOrder ────────────────────────────────────────────────────────

describe('choiceOrder in typeOptions (§ capture-confirmed required field)', () => {
  it('choiceOrder matches the array order of input choices', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: {
        choices: [
          { id: 'selAAAAAAAAAAAAAAAA', name: 'PC' },
          { id: 'selBBBBBBBBBBBBBBBB', name: 'Xbox' },
          { id: 'selCCCCCCCCCCCCCCCC', name: 'PS5' },
        ],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.deepEqual(payload.typeOptions.choiceOrder, [
      'selAAAAAAAAAAAAAAAA',
      'selBBBBBBBBBBBBBBBB',
      'selCCCCCCCCCCCCCCCC',
    ]);
  });

  it('explicit choiceOrder from caller is respected', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: {
        choices: {
          selAAAAAAAAAAAAAAAA: { name: 'PC' },
          selBBBBBBBBBBBBBBBB: { name: 'Xbox' },
        },
        choiceOrder: ['selBBBBBBBBBBBBBBBB', 'selAAAAAAAAAAAAAAAA'],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.deepEqual(payload.typeOptions.choiceOrder, ['selBBBBBBBBBBBBBBBB', 'selAAAAAAAAAAAAAAAA']);
  });
});

// ─── §7 — disableColors ──────────────────────────────────────────────────────

describe('disableColors in typeOptions (§ capture-confirmed required field)', () => {
  it('disableColors defaults to false when not specified', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: { choices: [{ name: 'PC' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.typeOptions.disableColors, false);
  });

  it('disableColors: true is passed through when specified', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multiSelect',
      typeOptions: { choices: [{ name: 'PC' }], disableColors: true },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.typeOptions.disableColors, true);
  });
});

// ─── §8 — default value ──────────────────────────────────────────────────────

describe('default value outside typeOptions (§ capture-confirmed payload position)', () => {
  it('singleSelect: default string ID is placed outside typeOptions in updateConfig', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldSingle', {
      type: 'singleSelect',
      typeOptions: {
        default: 'selBBBBBBBBBBBBBBBB',
        choices: [{ id: 'selBBBBBBBBBBBBBBBB', name: 'Active', color: 'green' }],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.default, 'selBBBBBBBBBBBBBBBB', 'default must be at payload root');
    assert.equal(payload.typeOptions.default, undefined, 'default must NOT be inside typeOptions');
  });

  it('multipleSelects: default array is placed outside typeOptions in updateConfig', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldMulti', {
      type: 'multipleSelects',
      typeOptions: {
        default: ['selAAAAAAAAAAAAAAAA'],
        choices: [{ id: 'selAAAAAAAAAAAAAAAA', name: 'PC', color: 'blue' }],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.deepEqual(payload.default, ['selAAAAAAAAAAAAAAAA'], 'default must be at payload root');
    assert.equal(payload.typeOptions.default, undefined, 'default must NOT be inside typeOptions');
  });

  it('singleSelect createField: default is placed inside config (not at payload root)', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.createField('appAAA', 'tblAAA', {
      name: 'Status',
      type: 'singleSelect',
      typeOptions: {
        default: 'selBBBBBBBBBBBBBBBB',
        choices: [{ id: 'selBBBBBBBBBBBBBBBB', name: 'Active', color: 'green' }],
      },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.config.default, 'selBBBBBBBBBBBBBBBB', 'default must be inside config');
    assert.equal(payload.default, undefined, 'default must NOT be at payload root for create');
  });

  it('no default: default key is omitted from payload entirely', async () => {
    const auth = createMockAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appAAA', 'fldSingle', {
      type: 'singleSelect',
      typeOptions: { choices: [{ name: 'Active' }] },
    });
    const payload = parsedPayload(auth.calls[auth.calls.length - 1]);
    assert.equal(payload.default, undefined, 'default must be absent when not specified');
  });
});
