import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan, renderApplyResult } from '../../src/sync/report.js';

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

describe('report.renderApplyResult', () => {
  const baseResult = { planId: 'plnTEST', created: 2, updated: 1, skipped: 0, failed: 0 };

  it('omits records line when result.records is absent', () => {
    const out = renderApplyResult(baseResult);
    assert.match(out.human, /Apply plnTEST/);
    assert.match(out.human, /created: 2/);
    assert.doesNotMatch(out.human, /records:/);
    assert.equal(out.machine, baseResult);
  });

  it('includes records line when result.records is present', () => {
    const result = {
      ...baseResult,
      records: { created: 10, updated: 3, failed: 1, attachmentsUploaded: 2, viewFiltersReapplied: 0 },
    };
    const out = renderApplyResult(result);
    assert.match(out.human, /records: created 10 \/ updated 3 \/ failed 1 \/ attachments 2 \/ viewFilters 0/);
  });

  it('includes warnings after records line', () => {
    const result = {
      ...baseResult,
      records: { created: 5, updated: 0, failed: 0, attachmentsUploaded: 0, viewFiltersReapplied: 1 },
      warnings: [{ code: 'RECORDS_PHASE_FAILED', message: 'oops' }],
    };
    const out = renderApplyResult(result);
    assert.match(out.human, /records: created 5/);
    assert.match(out.human, /RECORDS_PHASE_FAILED/);
  });

  it('renders aborted result without records line', () => {
    const result = { aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: 'Destination changed' }] };
    const out = renderApplyResult(result);
    assert.match(out.human, /Apply aborted/);
    assert.doesNotMatch(out.human, /records:/);
  });
});
