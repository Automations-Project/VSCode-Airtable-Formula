/**
 * test-records-all-failed.test.js
 *
 * Task E — generalized "all writes failed" honest-failure gate (records engine).
 *
 * Task 2 made runRecords abort honestly on a SESSION death (SESSION_INVALID / isSessionDead()).
 * But a non-session run-wide failure — e.g. every write hanging/erroring for a reason that is
 * NOT SESSION_INVALID and does NOT latch the auth breaker — was still swallowed per-record and
 * reported as job `done` with 0 created / 0 updated / everything failed. That is dishonest and
 * silently burns the batch.
 *
 * This suite verifies the additional, more general net added to runRecords: if a run attempted
 * writes and had ZERO successes (created===0, updated===0) AND ZERO skips (skipped===0), with
 * only failures (failed>0), the whole run is now treated as aborted via the SAME `result.aborted`
 * plumbing Task 2 built — surfacing as phase=failed (resumable) instead of a misleading `done`,
 * and skipping reapplyViewFilters + pruneRecords (nothing was actually synced).
 *
 * The `skipped===0` clause is critical: a skip-heavy resume run (most rows already
 * mapped/converged → skipped, a couple of genuine per-record failures, 0 created/updated) must
 * NOT trip this gate — that would be a false positive on perfectly normal resume behavior.
 *
 * Drives runRecords() directly (fake client + tiny in-memory snapshots), reusing the fixture
 * style from test-records-session-abort.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runRecords } from '../../src/sync/records.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fakes (mirrors test-records-session-abort.test.js)
// ──────────────────────────────────────────────────────────────────────────────

/** A minimal AirtableAuth stand-in — never dies (these are NON-session failures). */
function makeAuth() {
  return {
    isSessionDead: () => false,
    getLastTrip: () => null,
    resetSessionHealth: () => {},
    ensureSessionHealthy: async () => ({ healthy: true, recovered: false }),
  };
}

function makeInfra() {
  return {
    limiter: { run: (f) => f() },
    journal: {},
    persist: () => {},
  };
}

function makeResult() {
  return { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
}

/**
 * Source snapshot: one "Games" table with `nRows` create-path records (none mapped),
 * a text field + a self-link field (empty, so link-folding never engages).
 */
function makeSrcSnapshot(nRows) {
  const records = [];
  for (let i = 0; i < nRows; i++) {
    records.push({ id: `recS${i}`, cellValuesByColumnId: { sN: `Row ${i}`, sLink: [] } });
  }
  return {
    baseId: 'appSRC0000000001',
    tables: [{
      id: 'tS', name: 'Games', primaryFieldId: 'sN',
      fields: [
        { id: 'sN', name: 'Name', type: 'text' },
        { id: 'sLink', name: 'Self', type: 'multipleRecordLinks', typeOptions: { foreignTableId: 'tS' } },
      ],
      views: [{ id: 'vS1', name: 'Grid view', type: 'grid', personalForUserId: null }],
      records,
    }],
  };
}

/** Dest snapshot with a dest-only orphan record (so prune WOULD delete it if reached). */
function makeDestSnapshot() {
  return {
    baseId: 'appDST0000000001',
    tables: [{
      id: 'tD', name: 'Games', primaryFieldId: 'dN',
      fields: [
        { id: 'dN', name: 'Name', type: 'text' },
        { id: 'dLink', name: 'Self', type: 'multipleRecordLinks', typeOptions: { foreignTableId: 'tD' } },
      ],
      views: [{ id: 'vD1', name: 'Grid view', type: 'grid', personalForUserId: null }],
      records: [{ id: 'recOrphan', cellValuesByColumnId: {} }],
    }],
  };
}

function makeIdmap() {
  return {
    tables: { tS: 'tD' },
    fields: {
      sN: { destFld: 'dN', choices: {} },
      sLink: { destFld: 'dLink', choices: {} },
    },
    records: {},
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1 — all-failed trips the gate
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — honest-failure gate (RECORDS_ALL_FAILED)', () => {
  it('trips the gate when every write attempt fails with zero successes and zero skips', async () => {
    const auth = makeAuth();
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => ({
        created: [],
        failed: rows.map((r) => ({ sourceKey: r.sourceKey, error: 'row failed (500): upstream hung' })),
      }),
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async () => ({ ok: true, added: 0 }),
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: a[2].length }; },
      getView: async () => ({}),
      updateViewFilters: async () => ({ ok: true }),
    };

    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();
    const out = await runRecords({
      client, srcSnapshot: makeSrcSnapshot(5), destSnapshot: makeDestSnapshot(), idmap: makeIdmap(),
      policy: 'mirror', confirmDeletions: true, // prune WOULD delete recOrphan if reached
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted, true, 'a total non-session failure must trip the honest-failure gate');
    assert.match(String(out.abortReason), /RECORDS_ALL_FAILED/, 'abortReason identifies the gate');
    assert.match(String(out.abortReason), /mode=apply/, 'abortReason tells the user how to resume');
    assert.ok(
      out.warnings.some((w) => w.code === 'RECORDS_ALL_FAILED'),
      'a RECORDS_ALL_FAILED warning is present',
    );
    assert.equal(out.failed, 5, 'all 5 failures were counted');
    assert.equal(out.created, 0);
    assert.equal(out.skipped, 0);
    assert.equal(deleteLog.length, 0, 'pruneRecords did NOT run — the gate skips it on total failure');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2 — partial success does NOT trip
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — honest-failure gate does not false-positive on partial success', () => {
  it('does not abort when some rows are created and some fail', async () => {
    const auth = makeAuth();
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => ({
        created: rows.slice(0, 3).map((r) => ({ rowId: 'recD_' + r.sourceKey, sourceKey: r.sourceKey })),
        failed: rows.slice(3).map((r) => ({ sourceKey: r.sourceKey, error: 'row failed (500): upstream hung' })),
      }),
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async () => ({ ok: true, added: 0 }),
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: a[2].length }; },
      getView: async () => ({}),
      updateViewFilters: async () => ({ ok: true }),
    };

    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();
    const out = await runRecords({
      client, srcSnapshot: makeSrcSnapshot(5), destSnapshot: makeDestSnapshot(), idmap: makeIdmap(),
      policy: 'mirror', confirmDeletions: true,
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted ?? false, false, 'partial success must NOT trip the gate');
    assert.equal(out.abortReason, undefined, 'no abortReason set');
    assert.ok(!out.warnings.some((w) => w.code === 'RECORDS_ALL_FAILED'), 'no RECORDS_ALL_FAILED warning');
    assert.equal(out.created, 3);
    assert.equal(out.failed, 2);
    assert.equal(deleteLog.length, 1, 'the run completed all passes and reached prune');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3 — skip-heavy does NOT trip (false-positive guard)
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — honest-failure gate does not false-positive on a skip-heavy resume run', () => {
  it('does not abort when rows are already converged (skipped) alongside a couple of genuine failures', async () => {
    // 3 rows are PRE-MAPPED (already synced) with a converged link cell (identical literal
    // array on both sides — arrayCellEquals is a structural comparison, not an idmap-remap) and
    // NO other scalar field mapped, so buildUpdateCells computes an EMPTY cell diff for them →
    // result.skipped++ (Pass 1's "nothing to write" skip). 2 rows are unmapped (create path)
    // and fail with a genuine non-session error. Net: created=0, updated=0, skipped=3, failed=2.
    const auth = makeAuth();
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => ({
        created: [],
        failed: rows.map((r) => ({ sourceKey: r.sourceKey, error: 'row failed (422): validation error' })),
      }),
      updateRecords: async () => ({ updated: [], failed: [] }), // never called — updateRows stays empty
      addLinkItems: async () => ({ ok: true, added: 0 }),
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: a[2].length }; },
      getView: async () => ({}),
      updateViewFilters: async () => ({ ok: true }),
    };

    const srcSnapshot = {
      baseId: 'appSRC0000000001',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        // sN intentionally NOT in idmap.fields below — only sLink is mapped, so buildUpdateCells
        // only ever considers sLink for the mapped (skip-path) rows.
        fields: [
          { id: 'sN', name: 'Name', type: 'text' },
          { id: 'sLink', name: 'Self', type: 'multipleRecordLinks', typeOptions: { foreignTableId: 'tS' } },
        ],
        views: [{ id: 'vS1', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          // Already-mapped, converged → skipped
          { id: 'recS0', cellValuesByColumnId: { sN: 'Zero', sLink: ['recAnchor'] } },
          { id: 'recS1', cellValuesByColumnId: { sN: 'One', sLink: ['recAnchor'] } },
          { id: 'recS2', cellValuesByColumnId: { sN: 'Two', sLink: ['recAnchor'] } },
          // Unmapped → create path → genuine failure
          { id: 'recS3', cellValuesByColumnId: { sN: 'Three', sLink: [] } },
          { id: 'recS4', cellValuesByColumnId: { sN: 'Four', sLink: [] } },
        ],
      }],
    };
    const destSnapshot = {
      baseId: 'appDST0000000001',
      tables: [{
        id: 'tD', name: 'Games', primaryFieldId: 'dN',
        fields: [
          { id: 'dN', name: 'Name', type: 'text' },
          { id: 'dLink', name: 'Self', type: 'multipleRecordLinks', typeOptions: { foreignTableId: 'tD' } },
        ],
        views: [{ id: 'vD1', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [
          { id: 'recD0', cellValuesByColumnId: { dLink: ['recAnchor'] } },
          { id: 'recD1', cellValuesByColumnId: { dLink: ['recAnchor'] } },
          { id: 'recD2', cellValuesByColumnId: { dLink: ['recAnchor'] } },
          { id: 'recOrphan', cellValuesByColumnId: {} },
        ],
      }],
    };
    const idmap = {
      tables: { tS: 'tD' },
      fields: { sLink: { destFld: 'dLink', choices: {} } }, // sN NOT mapped on purpose
      records: { recS0: 'recD0', recS1: 'recD1', recS2: 'recD2' },
    };

    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();
    const out = await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter, journal, persist, result,
    });

    assert.equal(out.skipped, 3, 'the 3 already-converged mapped rows were skipped (sanity check on the fixture)');
    assert.equal(out.created, 0);
    assert.equal(out.updated, 0);
    assert.equal(out.failed, 2, 'the 2 unmapped rows genuinely failed');
    assert.equal(out.aborted ?? false, false, 'skipped>0 must guard against the false positive');
    assert.equal(out.abortReason, undefined, 'no abortReason set');
    assert.ok(!out.warnings.some((w) => w.code === 'RECORDS_ALL_FAILED'), 'no RECORDS_ALL_FAILED warning');
    assert.equal(deleteLog.length, 1, 'the run completed all passes and reached prune (deleted the orphan)');
  });

  it('unit-checks the bare gate condition directly (skipped>0 must never trip it)', () => {
    // Direct condition check mirroring the gate added in runRecords, per the brief's escape
    // hatch — a belt-and-suspenders assertion independent of the full runRecords plumbing above.
    const wouldTrip = (r) => r.failed > 0 && r.created === 0 && r.updated === 0 && r.skipped === 0;

    assert.equal(
      wouldTrip({ created: 0, updated: 0, skipped: 3, failed: 2, warnings: [] }),
      false,
      'skipped>0, created=0, updated=0, failed>0 must NOT be flagged',
    );
    assert.equal(
      wouldTrip({ created: 0, updated: 0, skipped: 0, failed: 5, warnings: [] }),
      true,
      'skipped=0, created=0, updated=0, failed>0 IS the total-failure shape',
    );
  });
});
