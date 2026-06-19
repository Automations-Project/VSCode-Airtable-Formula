import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan, renderApplyResult, renderDiff, DRIFT_SAMPLE_CAP } from '../../src/sync/report.js';

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

// ── renderDiff tests (Task 6) ────────────────────────────────────────────────

/**
 * Build a fake diff with `driftCount` drift entries spread across two tables.
 * Table "Products" gets ceil(driftCount/2), "Offers" gets floor(driftCount/2).
 * Also adds 2 best-effort + 1 not-synced entries in Products, and 3 in Offers.
 */
function buildDiff(driftCount = 30) {
  const productsDrift = Math.ceil(driftCount / 2);  // 15
  const offersDrift = driftCount - productsDrift;    // 15

  function driftEntries(tableName, count) {
    return Array.from({ length: count }, (_, i) => ({
      scope: `field:F${i}`,
      key: 'type',
      source: 'text',
      dest: 'number',
      class: 'drift',
    }));
  }

  const productsEntries = [
    ...driftEntries('Products', productsDrift),
    { scope: 'table', key: 'fieldOrder', source: ['A', 'B'], dest: ['B', 'A'], class: 'best-effort' },
    { scope: 'table', key: 'viewOrder', source: ['V1', 'V2'], dest: ['V2', 'V1'], class: 'best-effort' },
    { scope: 'table', key: 'sections', source: [], dest: [{ id: 's1' }], class: 'not-synced' },
  ];

  const offersEntries = [
    ...driftEntries('Offers', offersDrift),
    { scope: 'table', key: 'fieldOrder', source: ['X', 'Y'], dest: ['Y', 'X'], class: 'best-effort' },
    { scope: 'table', key: 'viewOrder', source: ['V3'], dest: ['V3'], class: 'best-effort' },
    { scope: 'table', key: 'sections', source: [], dest: [], class: 'not-synced' },
  ];

  return {
    diffId: 'diff-001',
    sourceBaseId: 'srcBase',
    destBaseId: 'destBase',
    identical: false,
    converged: false,
    summary: {
      drift: driftCount,
      bestEffort: 4,
      notSynced: 2,
      onlyInSourceTables: 0,
      onlyInDestTables: 0,
    },
    tables: [
      {
        name: 'Products',
        status: 'differs',
        entries: productsEntries,
        fields: { onlyInSource: [], onlyInDest: [] },
        views: { onlyInSource: [], onlyInDest: [] },
      },
      {
        name: 'Offers',
        status: 'differs',
        entries: offersEntries,
        fields: { onlyInSource: ['MissingField'], onlyInDest: [] },
        views: { onlyInSource: ['ExtraView'], onlyInDest: [] },
      },
    ],
    onlyInSourceTables: [],
    onlyInDestTables: [],
  };
}

describe('DRIFT_SAMPLE_CAP', () => {
  it('is exported as 25', () => {
    assert.equal(DRIFT_SAMPLE_CAP, 25);
  });
});

describe('renderDiff — digest (no detail)', () => {
  const diff = buildDiff(30);

  it('returns { human, machine }', () => {
    const out = renderDiff(diff);
    assert.ok(typeof out.human === 'string', 'human should be a string');
    assert.ok(out.machine !== null && typeof out.machine === 'object', 'machine should be an object');
  });

  it('machine has top-level identity fields', () => {
    const { machine } = renderDiff(diff);
    assert.equal(machine.diffId, 'diff-001');
    assert.equal(machine.sourceBaseId, 'srcBase');
    assert.equal(machine.destBaseId, 'destBase');
    assert.equal(machine.identical, false);
    assert.equal(machine.converged, false);
  });

  it('machine.summary.drift === 30', () => {
    const { machine } = renderDiff(diff);
    assert.equal(machine.summary.drift, 30);
  });

  it('machine.summary bestEffort and notSynced are numbers', () => {
    const { machine } = renderDiff(diff);
    assert.equal(typeof machine.summary.bestEffort, 'number');
    assert.equal(typeof machine.summary.notSynced, 'number');
    assert.equal(machine.summary.bestEffort, 4);
    assert.equal(machine.summary.notSynced, 2);
  });

  it('machine.driftSample.length === 25 (capped at DRIFT_SAMPLE_CAP)', () => {
    const { machine } = renderDiff(diff);
    assert.equal(machine.driftSample.length, 25);
  });

  it('driftSample entries each have table, scope, key, source, dest', () => {
    const { machine } = renderDiff(diff);
    for (const s of machine.driftSample) {
      assert.ok('table' in s, 'entry should have table');
      assert.ok('scope' in s, 'entry should have scope');
      assert.ok('key' in s, 'entry should have key');
      assert.ok('source' in s, 'entry should have source');
      assert.ok('dest' in s, 'entry should have dest');
    }
  });

  it('machine.tables is per-table rollup with drift/bestEffort/notSynced counts', () => {
    const { machine } = renderDiff(diff);
    assert.equal(machine.tables.length, 2);

    const products = machine.tables.find((t) => t.table === 'Products');
    assert.ok(products, 'Products table in rollup');
    assert.equal(products.status, 'differs');
    assert.equal(products.drift, 15);
    assert.equal(products.bestEffort, 2);
    assert.equal(products.notSynced, 1);

    const offers = machine.tables.find((t) => t.table === 'Offers');
    assert.ok(offers, 'Offers table in rollup');
    assert.equal(offers.drift, 15);
    assert.equal(offers.bestEffort, 2);
    assert.equal(offers.notSynced, 1);
  });

  it('machine.tables bestEffort and notSynced are NUMBERS not arrays', () => {
    const { machine } = renderDiff(diff);
    for (const t of machine.tables) {
      assert.equal(typeof t.bestEffort, 'number', `${t.table}.bestEffort should be number`);
      assert.equal(typeof t.notSynced, 'number', `${t.table}.notSynced should be number`);
    }
  });

  it('machine.detailHint is a string', () => {
    const { machine } = renderDiff(diff);
    assert.ok(typeof machine.detailHint === 'string', 'detailHint should be a string');
  });

  it('human contains table names and drift count', () => {
    const { human } = renderDiff(diff);
    assert.match(human, /Products/);
    assert.match(human, /Offers/);
    assert.match(human, /drift/i);
  });

  it('human mentions the cap / overflow when there are more than 25 drift entries', () => {
    const { human } = renderDiff(diff);
    // Should say something about more drift entries (5 more after cap of 25)
    assert.match(human, /\+5|5 more/i);
  });
});

describe('renderDiff — digest with 10 drift entries (no cap needed)', () => {
  it('driftSample.length === 10 when total drift < DRIFT_SAMPLE_CAP', () => {
    const diff = buildDiff(10);
    // Fix the summary to match actual entry count (5 per table)
    diff.summary.drift = 10;
    const { machine } = renderDiff(diff);
    assert.equal(machine.driftSample.length, 10);
  });
});

describe('renderDiff — detail mode', () => {
  const diff = buildDiff(30);

  it('returns Offers entries when detail="Offers"', () => {
    const { machine } = renderDiff(diff, { detail: 'Offers' });
    // Should have entries array (the raw entries for Offers table)
    assert.ok(Array.isArray(machine.entries), 'machine.entries should be array');
    // Offers has 15 drift + 3 non-drift = 18 entries
    assert.equal(machine.entries.length, 18);
  });

  it('includes fields and views only-in lists in detail mode', () => {
    const { machine } = renderDiff(diff, { detail: 'Offers' });
    assert.ok('fields' in machine, 'machine should have fields');
    assert.ok('views' in machine, 'machine should have views');
    assert.deepEqual(machine.fields.onlyInSource, ['MissingField']);
    assert.deepEqual(machine.views.onlyInSource, ['ExtraView']);
  });

  it('slices entries with offset and limit', () => {
    const { machine } = renderDiff(diff, { detail: 'Offers', offset: 5, limit: 3 });
    assert.equal(machine.entries.length, 3);
  });

  it('returns error object for unknown table name', () => {
    const { machine } = renderDiff(diff, { detail: 'NonExistent' });
    assert.ok('error' in machine, 'should return error for unknown table');
    assert.match(machine.error, /NonExistent|available/i);
  });

  it('human in detail mode describes Offers entries', () => {
    const { human } = renderDiff(diff, { detail: 'Offers' });
    assert.ok(typeof human === 'string', 'human should be a string');
    assert.match(human, /Offers/);
  });

  it('detail mode returns Products entries when detail="Products"', () => {
    const { machine } = renderDiff(diff, { detail: 'Products' });
    assert.ok(Array.isArray(machine.entries));
    // Products has 15 drift + 3 non-drift = 18 entries
    assert.equal(machine.entries.length, 18);
  });
});
