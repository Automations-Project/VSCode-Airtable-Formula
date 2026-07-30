// Regression tests for the 2026-07-09 field-ref bug report:
//   Bug 1 — downloads must resolve {column_value_fldXXX} to real {Field Name} refs
//   Bug 3 — writes must accept the legacy {column_value_fldXXX} form (→ {fldXXX})
// Non-field placeholder tokens (n8n-style {FOO_PLACEHOLDER}) must never be rewritten.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formulaRefsToNames, formulaRefsToIds, buildFieldNameMap } from '../src/formula-refs.js';
import { AirtableClient } from '../src/client.js';

const NAMES = {
  fldI81k8Tbw7jGr3U: 'Game',
  fldCzcvbBHHT8zacf: 'Marketplaces',
  fldJcbvrfHgiOi6Q7: 'Dropbox Folder URL',
  fldBraceyBadName1: 'Weird {Name}',
};

describe('formulaRefsToNames (download path)', () => {
  it('resolves {column_value_fldXXX} to {Field Name}', () => {
    assert.equal(
      formulaRefsToNames('IF({column_value_fldI81k8Tbw7jGr3U} = "x", 1, 0)', NAMES),
      'IF({Game} = "x", 1, 0)',
    );
  });

  it('resolves bare {fldXXX} refs too', () => {
    assert.equal(formulaRefsToNames('{fldCzcvbBHHT8zacf}', NAMES), '{Marketplaces}');
  });

  it('handles names with spaces', () => {
    assert.equal(
      formulaRefsToNames('{column_value_fldJcbvrfHgiOi6Q7}', NAMES),
      '{Dropbox Folder URL}',
    );
  });

  it('leaves non-field placeholder tokens untouched', () => {
    const text = 'CONCATENATE({ACCOUNT_SCREENSHOT_PLACEHOLDER}, {column_value_fldI81k8Tbw7jGr3U})';
    assert.equal(
      formulaRefsToNames(text, NAMES),
      'CONCATENATE({ACCOUNT_SCREENSHOT_PLACEHOLDER}, {Game})',
    );
  });

  it('unknown field id falls back to the id form {fldXXX}', () => {
    assert.equal(
      formulaRefsToNames('{column_value_fldUnknown1234567}', NAMES),
      '{fldUnknown1234567}',
    );
  });

  it('a name containing braces cannot round-trip — falls back to id form', () => {
    assert.equal(formulaRefsToNames('{fldBraceyBadName1}', NAMES), '{fldBraceyBadName1}');
  });

  it('a name that is itself shaped like a ref token falls back to id form', () => {
    // Emitting {column_value_fldFoo1} / {fldI81k8Tbw7jGr3U} as a NAME would be
    // indistinguishable from a stored ref and get mangled or misresolved on upload.
    const names = {
      fldRealAAAAAAAAAA: 'column_value_fldFoo1',
      fldRealBBBBBBBBBB: 'fldI81k8Tbw7jGr3U',
      fldRealCCCCCCCCCC: 'selAbc123',
    };
    assert.equal(formulaRefsToNames('{fldRealAAAAAAAAAA}', names), '{fldRealAAAAAAAAAA}');
    assert.equal(formulaRefsToNames('{fldRealBBBBBBBBBB}', names), '{fldRealBBBBBBBBBB}');
    assert.equal(formulaRefsToNames('{fldRealCCCCCCCCCC}', names), '{fldRealCCCCCCCCCC}');
  });

  it('non-string input passes through', () => {
    assert.equal(formulaRefsToNames(undefined, NAMES), undefined);
  });
});

describe('formulaRefsToIds (write path)', () => {
  it('strips the column_value_ prefix so legacy downloads upload correctly', () => {
    assert.equal(
      formulaRefsToIds('IF({column_value_fldI81k8Tbw7jGr3U}, {column_value_selAbc123}, 0)'),
      'IF({fldI81k8Tbw7jGr3U}, {selAbc123}, 0)',
    );
  });

  it('leaves {Field Name} refs and placeholders untouched', () => {
    const text = 'IF({Game} = {ACCOUNT_TITLE_PLACEHOLDER}, {fldI81k8Tbw7jGr3U}, "")';
    assert.equal(formulaRefsToIds(text), text);
  });
});

describe('buildFieldNameMap', () => {
  it('maps ids to names across tables, for both columns and fields keys', () => {
    const map = buildFieldNameMap([
      { id: 'tbl1', columns: [{ id: 'fldA', name: 'Alpha' }] },
      { id: 'tbl2', fields: [{ id: 'fldB', name: 'Beta' }] },
    ]);
    assert.deepEqual(map, { fldA: 'Alpha', fldB: 'Beta' });
  });
});

describe('client write-path normalization', () => {
  const schema = {
    data: {
      tableSchemas: [{
        id: 'tblAuVM0n8bgJzZzC',
        name: 'Offers',
        columns: [{ id: 'fldC1mIRsgh0YsKCI', name: 'JSON: Auto Descriptions', type: 'formula', typeOptions: {} }],
        views: [],
      }],
    },
  };

  function captureAuth() {
    const calls = [];
    return {
      calls,
      getSecretSocketId: () => null,
      get: () => ({ ok: true, status: 200, json: async () => schema, text: async () => JSON.stringify(schema) }),
      postForm: (url, params) => {
        calls.push({ url, params });
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    };
  }

  it('validateFormula sends {fldXXX}, never {column_value_fldXXX}', async () => {
    const auth = captureAuth();
    const client = new AirtableClient(auth);
    await client.validateFormula(
      'appFV44ToEwmqcpOG',
      'tblAuVM0n8bgJzZzC',
      '{column_value_fldI81k8Tbw7jGr3U} & {Game}',
    );
    const payload = JSON.parse(auth.calls[0].params.stringifiedObjectParams);
    assert.equal(payload.config.typeOptions.formulaText, '{fldI81k8Tbw7jGr3U} & {Game}');
  });

  it('updateFieldConfig normalizes formulaText refs', async () => {
    const auth = captureAuth();
    const client = new AirtableClient(auth);
    await client.updateFieldConfig('appFV44ToEwmqcpOG', 'fldC1mIRsgh0YsKCI', {
      type: 'formula',
      typeOptions: { formulaText: 'IF({column_value_fldCzcvbBHHT8zacf}, 1, 0)' },
    });
    const payload = JSON.parse(auth.calls[0].params.stringifiedObjectParams);
    assert.equal(payload.typeOptions.formulaText, 'IF({fldCzcvbBHHT8zacf}, 1, 0)');
  });
});
