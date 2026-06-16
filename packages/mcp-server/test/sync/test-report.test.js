import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan } from '../../src/sync/report.js';

describe('report.renderPlan', () => {
  it('summarizes action/orphan/warning counts', () => {
    const plan = { actions: [
      { kind: 'createTable', name: 'T' }, { kind: 'createField', name: 'a' },
      { kind: 'updateField', destFld: 'fD' } ], orphans: [{ kind: 'field', name: 'x' }], warnings: [{ code: 'FIELD_CAP', message: 'm' }] };
    const out = renderPlan(plan);
    assert.equal(out.machine, plan);
    assert.match(out.human, /createTable: 1/);
    assert.match(out.human, /createField: 1/);
    assert.match(out.human, /updateField: 1/);
    assert.match(out.human, /orphans: 1/);
    assert.match(out.human, /FIELD_CAP/);
  });
});
