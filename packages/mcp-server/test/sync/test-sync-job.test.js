import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSyncJobStatus, readSyncJobStatus } from '../../src/sync/job-status.js';
import { planJob, applyJob, syncStatus, fingerprintSchema } from '../../src/sync/index.js';
import { savePlan, saveIdmap } from '../../src/sync/idmap.js';
import { writeRecordsJobStatus } from '../../src/sync/records.js';
import { snapshotBase } from '../../src/sync/snapshot.js';
import { MockClient } from './helpers/mock-client.js';

const SRC = 'appSJ00000000000', DEST = 'appDJ00000000000';

/** A pid guaranteed dead (see test-records-job.test.js). */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', '']);
  assert.ok(r.pid > 0, 'spawned a probe process');
  return r.pid;
}

/** Poll the sync-job file until `pred(job)` is truthy or the timeout elapses. */
async function waitUntil(pred, { src = SRC, dest = DEST, planId, timeoutMs = 8000 } = {}) {
  const start = Date.now();
  for (;;) {
    const j = readSyncJobStatus(src, dest, planId);
    if (pred(j)) return j;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout; last sync-job=${JSON.stringify(j)}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('sync-job status file (job-status.js)', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-job-unified-')); });

  it('write/read round-trips keyed per planId, stamps pid on running phases', () => {
    writeSyncJobStatus(SRC, DEST, 'p1', { phase: 'planning', startedAt: 't0' });
    const j = readSyncJobStatus(SRC, DEST, 'p1');
    assert.equal(j.planId, 'p1');
    assert.equal(j.jobId, 'p1');
    assert.equal(j.phase, 'planning');
    assert.equal(j.pid, process.pid, 'a running phase carries the writer pid');
    assert.equal(readSyncJobStatus(SRC, DEST, 'nope'), null);
  });

  it('merges forward: a done write preserves an earlier schemaResult + startedAt, drops pid', () => {
    writeSyncJobStatus(SRC, DEST, 'p2', { phase: 'schema', startedAt: 't0' });
    writeSyncJobStatus(SRC, DEST, 'p2', { phase: 'records', schemaResult: { created: 3 } });
    writeSyncJobStatus(SRC, DEST, 'p2', { phase: 'done', recordsResult: { created: 5 }, finishedAt: 't1' });
    const j = readSyncJobStatus(SRC, DEST, 'p2');
    assert.equal(j.phase, 'done');
    assert.equal(j.startedAt, 't0', 'startedAt preserved across merges');
    assert.equal(j.schemaResult.created, 3, 'schemaResult preserved into the done write');
    assert.equal(j.recordsResult.created, 5);
    assert.equal(j.pid, undefined, 'a terminal phase drops the pid');
  });

  it('a running phase whose pid is dead reads back as failed with resume advice', () => {
    writeSyncJobStatus(SRC, DEST, 'pDead', { phase: 'records', startedAt: 't0' });
    // overwrite pid with a dead one (writeSyncJobStatus always stamps process.pid, so hand-write)
    writeSyncJobStatus(SRC, DEST, 'pDead2', { phase: 'records', startedAt: 't0', pid: deadPid() });
    const j = readSyncJobStatus(SRC, DEST, 'pDead2');
    assert.equal(j.phase, 'failed', 'a dead writer can never finish — must not stay running forever');
    assert.match(String(j.error), /died mid-records/);
    assert.match(String(j.error), /mode=apply/, 'error advises how to resume');
  });

  it('a dead-pid planning phase advises mode=plan', () => {
    writeSyncJobStatus(SRC, DEST, 'pPlanDead', { phase: 'planning', startedAt: 't0', pid: deadPid() });
    const j = readSyncJobStatus(SRC, DEST, 'pPlanDead');
    assert.equal(j.phase, 'failed');
    assert.match(String(j.error), /mode=plan/);
  });
});

describe('syncStatus()', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-status-')); });

  it('reports phase=unknown when no job exists', () => {
    const s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'none' });
    assert.equal(s.phase, 'unknown');
    assert.equal(s.status, 'unknown');
    assert.equal(s.recordsMapped, 0);
  });

  it('maps each phase to a running/done/failed status and derives recordsMapped from idmap', () => {
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { a: 'X', b: 'Y', c: 'Z' } });

    writeSyncJobStatus(SRC, DEST, 'pl', { phase: 'planning', startedAt: 't0' });
    let s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'pl' });
    assert.equal(s.phase, 'planning');
    assert.equal(s.status, 'running');
    assert.equal(s.recordsMapped, 3, 'recordsMapped derived live from idmap.records');

    writeSyncJobStatus(SRC, DEST, 'sc', { phase: 'schema', startedAt: 't0' });
    s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'sc' });
    assert.equal(s.status, 'running');

    writeSyncJobStatus(SRC, DEST, 're', { phase: 'records', startedAt: 't0', schemaResult: { created: 2 } });
    s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 're' });
    assert.equal(s.status, 'running');
    assert.equal(s.schemaResult.created, 2);

    writeSyncJobStatus(SRC, DEST, 'dn', { phase: 'done', recordsResult: { created: 9 }, finishedAt: 't1' });
    s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'dn' });
    assert.equal(s.phase, 'done');
    assert.equal(s.status, 'done');
    assert.equal(s.recordsResult.created, 9);

    writeSyncJobStatus(SRC, DEST, 'fl', { phase: 'failed', error: 'boom', finishedAt: 't1' });
    s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'fl' });
    assert.equal(s.phase, 'failed');
    assert.equal(s.status, 'failed');
    assert.equal(s.error, 'boom');
  });

  it('a dead-pid running job surfaces as failed via syncStatus', () => {
    writeSyncJobStatus(SRC, DEST, 'zombie', { phase: 'records', startedAt: 't0', pid: deadPid() });
    const s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'zombie' });
    assert.equal(s.status, 'failed');
    assert.match(String(s.error), /died mid-records/);
  });

  it('falls back to the records-job file when no unified sync-job exists (legacy apply)', () => {
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { a: 'X' } });
    writeRecordsJobStatus(SRC, DEST, 'legacy', { status: 'running', startedAt: 't0' });
    const s = syncStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'legacy' });
    assert.equal(s.status, 'running');
    assert.equal(s.phase, 'records');
    assert.equal(s.recordsMapped, 1);
  });
});

describe('planJob()', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'planjob-')); });

  it('returns a jobId + running synchronously, then writes phase=done with a plan digest', async () => {
    const mk = (name) => ({ data: { tableSchemas: [{ id: 'tbl1', name, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: 'Name', type: 'text' }] }] } });
    const client = { getApplicationData: async (appId) => (appId === SRC ? mk('T') : { data: { tableSchemas: [] } }) };

    const r = planJob({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnA' });
    assert.deepEqual(r, { jobId: 'plnA', status: 'running' }, 'planJob returns synchronously without awaiting the snapshot');
    // No terminal write has happened yet on the same synchronous tick.
    assert.equal(readSyncJobStatus(SRC, DEST, 'plnA').phase, 'planning');

    const done = await waitUntil((j) => j && (j.phase === 'done' || j.phase === 'failed'), { planId: 'plnA' });
    assert.equal(done.phase, 'done', `expected done, got ${JSON.stringify(done)}`);
    assert.ok(done.planDigest, 'digest present');
    assert.match(String(done.planDigest.human), /createTable/);
    assert.ok(done.finishedAt);
  });

  it('records phase=failed when the underlying plan() rejects', async () => {
    const client = { getApplicationData: async () => { throw new Error('snapshot exploded'); } };
    const r = planJob({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnFail' });
    assert.equal(r.status, 'running');
    const j = await waitUntil((x) => x && (x.phase === 'done' || x.phase === 'failed'), { planId: 'plnFail' });
    assert.equal(j.phase, 'failed');
    assert.match(String(j.error), /snapshot exploded/);
  });
});

describe('applyJob()', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'applyjob-')); });

  it('returns jobId + running synchronously and drives schema -> records -> done', async () => {
    const client = new MockClient(); // empty source + dest
    const dest = await snapshotBase(client, DEST);
    // Empty plan: nothing to apply, fingerprint matches an empty dest → records phase no-ops → done.
    savePlan(SRC, DEST, {
      planId: 'apJ', engineVersion: '2b', destFingerprint: fingerprintSchema(dest),
      sourceBaseId: SRC, destBaseId: DEST, idmap: { tables: {}, fields: {}, views: {} },
      actions: [], orphans: [], warnings: [],
    });

    const r = applyJob({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'apJ', runStartedAt: 'ts' });
    assert.deepEqual(r, { jobId: 'apJ', status: 'running' });
    // Synchronously after the call the schema phase is registered (records not launched yet).
    assert.equal(readSyncJobStatus(SRC, DEST, 'apJ').phase, 'schema');

    const done = await waitUntil((j) => j && (j.phase === 'done' || j.phase === 'failed'), { planId: 'apJ' });
    assert.equal(done.phase, 'done', `expected done, got ${JSON.stringify(done)}`);
    assert.ok(done.schemaResult, 'schema phase result reflected (proves schema->records transition)');
    assert.ok(done.recordsResult, 'records phase result reflected (proves records->done transition)');
    assert.equal(done.recordsResult.created, 0);
  });

  it('a clean DRIFT abort ends as phase=done carrying the aborted schemaResult (no records phase)', async () => {
    const client = new MockClient();
    savePlan(SRC, DEST, {
      planId: 'apDrift', engineVersion: '2b', destFingerprint: 'STALE',
      sourceBaseId: SRC, destBaseId: DEST, idmap: { tables: {}, fields: {}, views: {} },
      actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'T' }], orphans: [], warnings: [],
    });
    applyJob({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'apDrift', runStartedAt: 'ts' });
    const j = await waitUntil((x) => x && (x.phase === 'done' || x.phase === 'failed'), { planId: 'apDrift' });
    assert.equal(j.phase, 'done', 'a clean drift abort is terminal-done, not a hard failure');
    assert.ok(j.schemaResult && j.schemaResult.aborted, 'schemaResult carries the aborted marker');
    assert.equal(j.recordsResult, undefined, 'no records phase ran');
  });

  it('records phase=failed when apply() rejects (no saved plan)', async () => {
    const client = new MockClient();
    applyJob({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'apNoPlan', runStartedAt: 'ts' });
    const j = await waitUntil((x) => x && (x.phase === 'done' || x.phase === 'failed'), { planId: 'apNoPlan' });
    assert.equal(j.phase, 'failed');
    assert.match(String(j.error), /No saved plan/);
  });
});
