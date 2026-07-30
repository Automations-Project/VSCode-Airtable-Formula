// Regression tests: journal resume must be reachable past the drift guard.
//
// Audit finding: after a partial apply mutated the dest, re-running the SAME planId always
// tripped the fingerprint drift guard (the divergence being the sync's own run-1 mutations),
// so the journal's documented resume/retry path was dead code. When a journal for this planId
// already has at least one done action, apply must bypass the guard and emit
// RESUME_DRIFT_BYPASS instead of aborting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockClient } from './helpers/mock-client.js';
import { apply } from '../../src/sync/index.js';
import { savePlan, saveIdmap } from '../../src/sync/idmap.js';
import { newJournal, recordDone, recordFailed, saveJournal } from '../../src/sync/journal.js';

const SRC = 'appSSSSSSSSSSSSSS';
const DEST = 'appDDDDDDDDDDDDDD';

function twoTablePlan(planId) {
  return {
    planId, engineVersion: '2c',
    // Plan-time fingerprint (empty dest) — run 1's own createTable makes the live dest diverge.
    destFingerprint: 'PLAN-TIME-FINGERPRINT-OF-EMPTY-DEST',
    sourceBaseId: SRC, destBaseId: DEST,
    idmap: { tables: {}, fields: {}, views: {} },
    actions: [
      { kind: 'createTable', sourceTableId: 'tA', name: 'TableA' },
      { kind: 'createTable', sourceTableId: 'tB', name: 'TableB' },
    ],
    orphans: [], warnings: [],
  };
}

describe('sync index.apply — journal resume bypasses the drift guard', () => {
  // The bypass used to be automatic: ONE done action switched the drift guard off for the whole
  // run. Resuming proves THIS plan already mutated the dest — it does not prove a collaborator
  // didn't also, and the remaining actions (deletions included) would overwrite them. The
  // ambiguity is now the caller's to resolve, like every other destructive path in this engine.
  it('a drifted resume ABORTS with RESUME_DRIFT unless resumeAfterDrift is passed', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'resume-drift-gate-'));
    const client = new MockClient();
    savePlan(SRC, DEST, twoTablePlan('plnGATE'));

    const { tableId } = await client.createTable(DEST, 'TableA');
    const journal = newJournal('plnGATE', 't0');
    recordDone(journal, 0, 'createTable', tableId);
    saveJournal(SRC, DEST, journal);
    saveIdmap(SRC, DEST, { tables: { tA: tableId }, fields: {}, views: {}, records: {}, attachments: {} });

    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnGATE', runStartedAt: 't1' });

    assert.equal(out.machine.aborted, true, `must abort without the flag: ${out.human}`);
    assert.equal(out.machine.reason, 'RESUME_DRIFT');
    assert.ok((out.machine.warnings || []).some((w) => w.code === 'RESUME_DRIFT'));

    // And it must abort BEFORE touching anything — TableB is not created.
    const names = (await client.getApplicationData(DEST)).data.tableSchemas.map((t) => t.name).sort();
    assert.deepEqual(names, ['TableA'], `no action may run on an aborted resume: ${names}`);
  });

  // A plan from an older engine hashed fewer facets, so its digest can NEVER match. Reporting that
  // as DRIFT blames a collaborator; reporting it mid-resume as RESUME_DRIFT invites the user to
  // wave through an overwrite to fix what is really a version mismatch.
  it('a plan from an older engine aborts with PLAN_STALE, not DRIFT', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'resume-drift-stale-'));
    const client = new MockClient();
    savePlan(SRC, DEST, { ...twoTablePlan('plnOLD'), engineVersion: '2b' });

    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnOLD', runStartedAt: 't1' });

    assert.equal(out.machine.aborted, true);
    assert.equal(out.machine.reason, 'PLAN_STALE');
    assert.match(
      (out.machine.warnings || []).map((w) => w.message).join(' '),
      /not a change to your destination/,
      'the message must not blame the destination for a version bump',
    );
  });

  it('re-run with a partially-done journal resumes (RESUME_DRIFT_BYPASS) instead of aborting DRIFT', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'resume-drift-'));
    const client = new MockClient();
    savePlan(SRC, DEST, twoTablePlan('plnRES'));

    // Simulate run 1: TableA was created (mutating dest → fingerprint diverges), journal
    // marks action 0 done, then the run died before action 1.
    const { tableId } = await client.createTable(DEST, 'TableA');
    const journal = newJournal('plnRES', 't0');
    recordDone(journal, 0, 'createTable', tableId);
    saveJournal(SRC, DEST, journal);
    saveIdmap(SRC, DEST, { tables: { tA: tableId }, fields: {}, views: {}, records: {}, attachments: {} });

    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnRES', runStartedAt: 't1', resumeAfterDrift: true });

    assert.notEqual(out.machine.aborted, true, `resume must not abort: ${out.human}`);
    assert.ok(
      (out.machine.warnings || []).some((w) => w.code === 'RESUME_DRIFT_BYPASS'),
      `expected RESUME_DRIFT_BYPASS warning, got: ${JSON.stringify(out.machine.warnings)}`,
    );
    // Action 0 skipped (journaled done), action 1 applied.
    assert.match(out.human, /created: 1/, `TableB must be created on resume: ${out.human}`);
    const names = (await client.getApplicationData(DEST)).data.tableSchemas.map((t) => t.name).sort();
    assert.deepEqual(names, ['TableA', 'TableB'], 'dest must hold both tables after resume');
  });

  it('journal with zero done actions does NOT bypass the drift guard', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'resume-drift-neg-'));
    const client = new MockClient();
    savePlan(SRC, DEST, twoTablePlan('plnNOB'));

    // Dest was mutated by SOMEONE ELSE (real drift); journal exists but proves no prior progress.
    await client.createTable(DEST, 'Interloper');
    const journal = newJournal('plnNOB', 't0');
    recordFailed(journal, 0, 'createTable', 'transient');
    saveJournal(SRC, DEST, journal);

    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnNOB', runStartedAt: 't1' });
    assert.equal(out.machine.aborted, true, 'real drift with no prior progress must still abort');
    assert.match(out.human, /DRIFT/);
  });

  it('no journal + fingerprint mismatch still aborts DRIFT (existing contract)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'resume-drift-none-'));
    const client = new MockClient();
    savePlan(SRC, DEST, twoTablePlan('plnNOJ'));
    await client.createTable(DEST, 'Interloper');
    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnNOJ', runStartedAt: 't1' });
    assert.equal(out.machine.aborted, true);
    assert.match(out.human, /DRIFT/);
  });
});
