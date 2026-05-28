// Tests for round-5 bug fixes (issues #9, #15, #17 — 2026-05-28):
//   §1 — #9:  parseScaffoldingTables empty visibleTableOrder short-circuits before tableById
//   §2 — #15: formulaTextParsed is the live key; fallback chain must check it first
//   §3 — #17: resolveField exposes existing typeOptions for update_formula_field merge

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

function createMockAuth(schemaResponse) {
  return {
    getSecretSocketId: () => null,
    get: () => ({
      ok: true,
      status: 200,
      json: async () => schemaResponse,
      text: async () => JSON.stringify(schemaResponse),
    }),
    postForm: () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
  };
}

// ─── §1 — parseScaffoldingTables ──────────────────────────────────────────────

describe('#9 — parseScaffoldingTables', () => {
  const auth = createMockAuth({});
  const client = new AirtableClient(auth);
  const ps = d => client.parseScaffoldingTables(d);

  it('returns tableSchemas when present and non-empty', () => {
    const d = { tableSchemas: [{ id: 'tbl1', name: 'A' }] };
    assert.deepEqual(ps(d), [{ id: 'tbl1', name: 'A' }]);
  });

  it('returns tables when tableSchemas absent', () => {
    const d = { tables: [{ id: 'tbl1', name: 'B' }] };
    assert.deepEqual(ps(d), [{ id: 'tbl1', name: 'B' }]);
  });

  it('empty tableSchemas [] does NOT short-circuit — falls through to visibleTableOrder', () => {
    const d = {
      tableSchemas: [],
      visibleTableOrder: ['tbl1'],
      tableById: { tbl1: { name: 'C' } },
    };
    const result = ps(d);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'tbl1');
    assert.equal(result[0].name, 'C');
  });

  it('empty visibleTableOrder [] does NOT short-circuit (#9 regression) — falls through to tableById', () => {
    const d = {
      visibleTableOrder: [],    // empty — was returning [] instead of falling through
      tableById: {
        tbl1: { name: 'Table One' },
        tbl2: { name: 'Table Two' },
      },
    };
    const result = ps(d);
    assert.equal(result.length, 2, 'should return all tables from tableById, not []');
  });

  it('non-empty visibleTableOrder maps to tableById entries in order', () => {
    const d = {
      visibleTableOrder: ['tbl2', 'tbl1'],
      tableById: {
        tbl1: { name: 'Alpha' },
        tbl2: { name: 'Beta' },
      },
    };
    const result = ps(d);
    assert.equal(result[0].id, 'tbl2');
    assert.equal(result[0].name, 'Beta');
    assert.equal(result[1].id, 'tbl1');
    assert.equal(result[1].name, 'Alpha');
  });

  it('no order arrays at all — falls back to Object.values(tableById)', () => {
    const d = {
      tableById: {
        tblA: { name: 'Standalone' },
      },
    };
    const result = ps(d);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Standalone');
  });

  it('null / undefined data returns []', () => {
    assert.deepEqual(ps(null), []);
    assert.deepEqual(ps(undefined), []);
    assert.deepEqual(ps({}), []);
  });
});

// ─── §2 — formulaTextParsed fallback (#15) ───────────────────────────────────

describe('#15 — resolveField returns formulaTextParsed for formula fields', () => {
  it('resolveField exposes typeOptions.formulaTextParsed as the live key', async () => {
    const schema = {
      data: {
        tableSchemas: [{
          id: 'tblX',
          name: 'T',
          columns: [{
            id: 'fldFormula',
            name: 'Calc',
            type: 'formula',
            typeOptions: {
              formulaTextParsed: 'IF({column_value_fld123}, 1, 0)',
              resultType: 'number',
            },
          }],
          views: [],
        }],
      },
    };
    const client = new AirtableClient(createMockAuth(schema));
    const { field } = await client.resolveField('appX', 'fldFormula');
    // The fallback chain in download_formula_field should find this key first
    assert.equal(
      field.typeOptions?.formulaTextParsed,
      'IF({column_value_fld123}, 1, 0)',
    );
  });

  it('resolveField still returns typeOptions.formulaText for older fields', async () => {
    const schema = {
      data: {
        tableSchemas: [{
          id: 'tblX',
          name: 'T',
          columns: [{
            id: 'fldOld',
            name: 'OldCalc',
            type: 'formula',
            typeOptions: {
              formulaText: 'NOW()',
              resultType: 'date',
            },
          }],
          views: [],
        }],
      },
    };
    const client = new AirtableClient(createMockAuth(schema));
    const { field } = await client.resolveField('appX', 'fldOld');
    assert.equal(field.typeOptions?.formulaText, 'NOW()');
  });
});

// ─── §3 — resolveField provides existing typeOptions for update_formula_field merge (#17) ──

describe('#17 — resolveField exposes existing typeOptions for merge before formula update', () => {
  it('formula field with format typeOptions is accessible via resolveField', async () => {
    const schema = {
      data: {
        tableSchemas: [{
          id: 'tblX',
          name: 'T',
          columns: [{
            id: 'fldPct',
            name: 'Pct',
            type: 'formula',
            typeOptions: {
              formulaText: 'SUM(1,2)',
              resultType: 'percent',
              percentV2: true,
              precision: 0,
            },
          }],
          views: [],
        }],
      },
    };
    const client = new AirtableClient(createMockAuth(schema));
    const { field } = await client.resolveField('appX', 'fldPct');
    const existing = field?.typeOptions || {};
    // Simulates what update_formula_field does: merge existing into new formula update
    const merged = { ...existing, formulaText: 'SUM(3,4)' };
    assert.equal(merged.resultType, 'percent', 'resultType must survive merge');
    assert.equal(merged.precision, 0, 'precision must survive merge');
    assert.equal(merged.percentV2, true, 'percentV2 must survive merge');
    assert.equal(merged.formulaText, 'SUM(3,4)', 'formulaText must be updated');
  });
});
