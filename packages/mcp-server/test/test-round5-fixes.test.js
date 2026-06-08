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

// ─── §3 — update_formula_field whitelist merge (#17 + #17 regression) ───────

describe('#17 — format keys preserved, read-only keys excluded from formula update', () => {
  const FORMULA_FORMAT_KEYS = [
    'format', 'precision', 'symbol', 'negative', 'percentV2',
    'dateFormat', 'timeFormat', 'timeZone', 'isDateTime', 'shouldDisplayTimeZone',
  ];

  function pickFormatOptions(typeOptions) {
    const result = {};
    for (const key of FORMULA_FORMAT_KEYS) {
      if (key in typeOptions) result[key] = typeOptions[key];
    }
    return result;
  }

  it('format keys (precision, percentV2) survive the whitelist pick', () => {
    const typeOptions = {
      formulaTextParsed: 'SUM(1,2)',  // read-only — must be excluded
      resultType: 'percent',          // read-only — must be excluded
      resultIsArray: false,           // read-only — must be excluded
      dependencies: { fld123: true }, // read-only — must be excluded
      percentV2: true,
      precision: 0,
      format: 'percentV2',
    };
    const picked = pickFormatOptions(typeOptions);
    assert.equal(picked.percentV2, true, 'percentV2 must be preserved');
    assert.equal(picked.precision, 0, 'precision must be preserved');
    assert.equal(picked.format, 'percentV2', 'format must be preserved');
  });

  it('read-only computed keys are excluded from the whitelist pick (#17 regression)', () => {
    const typeOptions = {
      formulaTextParsed: 'IF({column_value_fld123}, 1, 0)',
      resultType: 'number',
      resultIsArray: false,
      dependencies: { fld123: true },
      precision: 2,
    };
    const picked = pickFormatOptions(typeOptions);
    assert.equal(picked.formulaTextParsed, undefined, 'formulaTextParsed must be excluded');
    assert.equal(picked.resultType, undefined, 'resultType must be excluded');
    assert.equal(picked.resultIsArray, undefined, 'resultIsArray must be excluded');
    assert.equal(picked.dependencies, undefined, 'dependencies must be excluded');
    assert.equal(picked.precision, 2, 'precision must be preserved');
  });

  it('merged payload has formulaText updated and format keys intact', () => {
    const typeOptions = {
      formulaTextParsed: 'OLD',
      resultType: 'percent',
      percentV2: true,
      precision: 0,
    };
    const formatOptions = pickFormatOptions(typeOptions);
    const merged = { ...formatOptions, formulaText: 'SUM(3,4)' };
    assert.equal(merged.formulaText, 'SUM(3,4)');
    assert.equal(merged.percentV2, true);
    assert.equal(merged.precision, 0);
    assert.equal(merged.formulaTextParsed, undefined, 'must not bleed into payload');
    assert.equal(merged.resultType, undefined, 'must not bleed into payload');
  });

  it('resolveField exposes typeOptions for whitelist extraction', async () => {
    const schema = {
      data: {
        tableSchemas: [{
          id: 'tblX', name: 'T',
          columns: [{
            id: 'fldPct', name: 'Pct', type: 'formula',
            typeOptions: { formulaTextParsed: 'SUM(1,2)', resultType: 'percent', percentV2: true, precision: 0 },
          }],
          views: [],
        }],
      },
    };
    const client = new AirtableClient(createMockAuth(schema));
    const { field } = await client.resolveField('appX', 'fldPct');
    const picked = pickFormatOptions(field?.typeOptions || {});
    assert.equal(picked.percentV2, true);
    assert.equal(picked.precision, 0);
    assert.equal(picked.formulaTextParsed, undefined);
    assert.equal(picked.resultType, undefined);
  });
});
