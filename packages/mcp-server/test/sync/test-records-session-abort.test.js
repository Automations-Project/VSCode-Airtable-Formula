/**
 * test-records-session-abort.test.js
 *
 * Task 2 — records engine session-death handling:
 *   B (proactive re-auth): applyRecords re-mints/probes the session at the records-phase start
 *      and throws BEFORE snapshotting if the session cannot be made healthy.
 *   C (mid-run abort): a session death during any write pass sets result.aborted + abortReason,
 *      stops walking rows, skips the remaining passes + reapplyViewFilters + pruneRecords, and
 *      surfaces as records-job phase=failed (recordsTerminalStatus decision).
 *
 * Drives runRecords() directly (fake client + tiny in-memory snapshots), plus a focused unit
 * test on the job-layer decision function.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecords, applyRecords } from '../../src/sync/records.js';
import { recordsTerminalStatus } from '../../src/sync/index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fakes
// ──────────────────────────────────────────────────────────────────────────────

/** A minimal AirtableAuth stand-in exposing the Task-1 records-facing surface. */
function makeAuth() {
  let dead = false;
  return {
    isSessionDead: () => dead,
    getLastTrip: () => (dead ? { status: 403, reason: 'throttle' } : null),
    resetSessionHealth: () => { dead = false; },
    ensureSessionHealthy: async () => ({ healthy: true, recovered: false }),
    _die: () => { dead = true; },
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
 * a text field + a self-link field (so Pass 2 would call addLinkItems if it ran).
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

/** Dest snapshot with a dest-only orphan record (so prune WOULD delete under mirror+confirm). */
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
// C — abort stops the run early on a mid-run session death
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — mid-run session death aborts the whole job (C)', () => {
  it('stops after the first create chunk when the session dies (fewer create calls than chunks; Pass 2 + prune never run)', async () => {
    const auth = makeAuth();
    const createLog = [];
    const linkLog = [];
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => {
        createLog.push(rows.length);
        // Simulate the auth breaker latching mid-batch: the real client swallows each dead
        // per-row POST into failed[] (it does NOT throw at the batch level).
        auth._die();
        return { created: [], failed: rows.map((r) => ({ sourceKey: r.sourceKey, error: 'SESSION_INVALID: session is dead' })) };
      },
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async (...a) => { linkLog.push(a); return { ok: true, added: 0 }; },
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: 0 }; },
      getView: async () => ({}),
      updateViewFilters: async () => ({ ok: true }),
    };

    const srcSnapshot = makeSrcSnapshot(120); // > CREATE_CHUNK (50) → 3 chunks if it kept going
    const destSnapshot = makeDestSnapshot();
    const idmap = makeIdmap();
    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();

    const out = await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true, // prune WOULD delete recOrphan if reached
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted, true, 'result.aborted must be true');
    assert.match(String(out.abortReason), /SESSION_INVALID/, 'abortReason mentions SESSION_INVALID');
    assert.match(String(out.abortReason), /mode=apply/, 'abortReason tells the user how to resume');
    assert.equal(createLog.length, 1, 'only the first chunk was attempted (did NOT march all 120 rows)');
    assert.equal(linkLog.length, 0, 'Pass 2 (addLinkItems) never ran under abort');
    assert.equal(deleteLog.length, 0, 'pruneRecords (deleteRecords) never ran under abort — no deletion on a dead session');
  });

  it('aborts when createRecords THROWS a SESSION_INVALID error at the batch level', async () => {
    const auth = makeAuth(); // isSessionDead stays false → detection must fall back to the error message (Minor-4)
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async () => { throw new Error('SESSION_INVALID: recover threw'); },
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async () => ({ ok: true }),
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: 0 }; },
      getView: async () => ({}),
      updateViewFilters: async () => ({ ok: true }),
    };

    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();
    const out = await runRecords({
      client, srcSnapshot: makeSrcSnapshot(10), destSnapshot: makeDestSnapshot(), idmap: makeIdmap(),
      policy: 'mirror', confirmDeletions: true,
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted, true);
    assert.match(String(out.abortReason), /SESSION_INVALID/);
    assert.equal(deleteLog.length, 0, 'prune skipped even when isSessionDead() is false but a SESSION_INVALID error propagated');
  });

  it('tail safety-net: a session death that surfaces only in reapplyViewFilters still skips prune', async () => {
    // reapplyViewFilters swallows a failed getView as a per-view warning (never sets aborted).
    // If the session died there, the final breaker re-check before pruneRecords must catch it —
    // a dead session must never reach the destructive prune step.
    const auth = makeAuth();
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => ({
        created: rows.map((r, i) => ({ rowId: `recD${i}`, sourceKey: r.sourceKey })),
        failed: [],
      }),
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async () => ({ ok: true, added: 0 }),
      deleteRecords: async (...a) => { deleteLog.push(a); return { deleted: 0 }; },
      // Session dies at the tail (view-config population): sets the breaker AND throws — swallowed.
      getView: async () => { auth._die(); throw new Error('SESSION_INVALID: died during filter restore'); },
      updateViewFilters: async () => ({ ok: true }),
    };

    // Src table with a configless collaborative view → reapplyViewFilters calls getView for it.
    const srcSnapshot = {
      baseId: 'appSRC0000000001',
      tables: [{
        id: 'tS', name: 'Games', primaryFieldId: 'sN',
        fields: [{ id: 'sN', name: 'Name', type: 'text' }],
        views: [{ id: 'vS1', name: 'Grid view', type: 'grid', personalForUserId: null }],
        records: [{ id: 'recS0', cellValuesByColumnId: { sN: 'A' } }],
      }],
    };
    const destSnapshot = makeDestSnapshot(); // has recOrphan

    const idmap = { tables: { tS: 'tD' }, fields: { sN: { destFld: 'dN', choices: {} } }, records: {} };
    const result = makeResult();
    const { limiter, journal, persist } = makeInfra();

    const out = await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'mirror', confirmDeletions: true,
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted, true, 'the tail breaker re-check flags the abort');
    assert.match(String(out.abortReason), /SESSION_INVALID/);
    assert.equal(deleteLog.length, 0, 'pruneRecords was skipped — no deletion under the dead session');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// C — continue-on-failure preserved for NON-session errors
// ──────────────────────────────────────────────────────────────────────────────

describe('runRecords — non-session failures do NOT abort (continue-on-failure preserved)', () => {
  it('a normal per-row create failure is a warning; the run completes all passes and prunes', async () => {
    // NOTE: at least one row must SUCCEED here — an all-failed/zero-skip run is now, by design,
    // the RECORDS_ALL_FAILED honest-failure gate's trigger (see test-records-all-failed.test.js).
    // This test's job is to prove a PARTIAL non-session failure (mixed with a success) still
    // does not abort — continue-on-failure is preserved for genuine per-record errors.
    const auth = makeAuth(); // never dies
    const deleteLog = [];
    const client = {
      auth,
      createRecords: async (appId, tableId, rows) => ({
        created: rows.slice(0, 1).map((r) => ({ rowId: 'recD_ok', sourceKey: r.sourceKey })),
        failed: rows.slice(1).map((r) => ({ sourceKey: r.sourceKey, error: 'row failed (422): validation error' })),
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
      client, srcSnapshot: makeSrcSnapshot(3), destSnapshot: makeDestSnapshot(), idmap: makeIdmap(),
      policy: 'mirror', confirmDeletions: true,
      limiter, journal, persist, result,
    });

    assert.equal(out.aborted ?? false, false, 'a non-session failure must NOT abort');
    assert.equal(out.abortReason, undefined, 'no abortReason set');
    assert.equal(out.created, 1, 'the one success was counted');
    assert.ok(out.failed >= 2, 'the failures were counted');
    assert.ok(out.warnings.some((w) => w.code === 'RECORD_CREATE_FAILED'), 'the failure surfaced as a warning');
    assert.equal(deleteLog.length, 1, 'the run completed all passes and reached prune (deleted the orphan)');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Job layer (C) — aborted result routes to phase=failed
// ──────────────────────────────────────────────────────────────────────────────

describe('recordsTerminalStatus — job-layer aborted→failed decision', () => {
  it('an aborted result becomes status=failed / event=records-failed with the abortReason + partial counts', () => {
    const t = recordsTerminalStatus({
      aborted: true,
      abortReason: 'SESSION_INVALID: session died during record sync (last status=403) after 7 created / 0 updated. Re-authenticate, then resume by re-running mode=apply with the same planId (progress is persisted).',
      created: 7, updated: 0, failed: 3, warnings: [{ code: 'X' }],
    });
    assert.equal(t.status, 'failed');
    assert.equal(t.event, 'records-failed');
    assert.match(String(t.error), /SESSION_INVALID/);
    assert.match(String(t.error), /mode=apply/);
    assert.equal(t.recordsResult.created, 7, 'partial counts are preserved');
    assert.equal(t.recordsResult.failed, 3);
    assert.equal(t.recordsResult.warningCount, 1);
  });

  it('an aborted result WITHOUT abortReason falls back to a generic session message', () => {
    const t = recordsTerminalStatus({ aborted: true, created: 0, updated: 0, warnings: [] });
    assert.equal(t.status, 'failed');
    assert.match(String(t.error), /SESSION|session|re-run|apply/i);
  });

  it('a non-aborted result stays status=done / event=records-done', () => {
    const t = recordsTerminalStatus({ aborted: false, created: 5, updated: 2, failed: 0, warnings: [] });
    assert.equal(t.status, 'done');
    assert.equal(t.event, 'records-done');
    assert.equal(t.recordsResult.created, 5);
    assert.equal(t.recordsResult.updated, 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B — proactive session health at the records-phase start
// ──────────────────────────────────────────────────────────────────────────────

describe('applyRecords — proactive session health gate (B)', () => {
  it('throws BEFORE snapshotting when the session cannot be made healthy', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'rec-abort-B-'));
    let reset = 0;
    const client = {
      auth: {
        resetSessionHealth: () => { reset++; },
        ensureSessionHealthy: async () => ({ healthy: false, error: 'probe failed' }),
      },
      // If snapshotting is reached, this throws a DISTINCT error — the test proves it is NOT reached.
      getApplicationData: async () => { throw new Error('SNAPSHOT_SHOULD_NOT_RUN'); },
    };

    await assert.rejects(
      () => applyRecords({ client, sourceBaseId: 'appSRC0000000001', destBaseId: 'appDST0000000001', planId: 'plnB', runStartedAt: 't0' }),
      (err) => {
        assert.match(String(err.message), /SESSION/i, 'throws a session error');
        assert.doesNotMatch(String(err.message), /SNAPSHOT_SHOULD_NOT_RUN/, 'must throw before any snapshot call');
        return true;
      },
    );
    assert.ok(reset >= 1, 'resetSessionHealth was called to un-latch any stale breaker');
  });

  it('is a no-op when client.auth lacks ensureSessionHealthy (older/mocked client) — does not crash', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'rec-abort-B2-'));
    // A client whose auth has no health surface; snapshotting immediately fails with a KNOWN error.
    // We only assert the health block was SKIPPED (no TypeError), so any reject other than a crash is fine.
    const client = {
      auth: {},
      getApplicationData: async () => { throw new Error('REACHED_SNAPSHOT'); },
    };
    await assert.rejects(
      () => applyRecords({ client, sourceBaseId: 'appSRC0000000001', destBaseId: 'appDST0000000001', planId: 'plnB2', runStartedAt: 't0' }),
      (err) => {
        // Reaching the snapshot proves the health block was skipped rather than throwing a TypeError.
        assert.match(String(err.message), /REACHED_SNAPSHOT/);
        return true;
      },
    );
  });
});
