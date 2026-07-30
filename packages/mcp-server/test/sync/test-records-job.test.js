import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeRecordsJobStatus, readRecordsJobStatus } from '../../src/sync/records.js';
import { recordsStatus } from '../../src/sync/index.js';
import { saveIdmap, syncDir } from '../../src/sync/idmap.js';
import { renderApplyResult } from '../../src/sync/report.js';

/** A pid guaranteed dead: spawn a no-op node process synchronously — by the time spawnSync
 *  returns it has exited, so its pid no longer maps to a live process. */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', '']);
  assert.ok(r.pid > 0, 'spawned a probe process');
  return r.pid;
}

const SRC = 'appSRC0000000000', DEST = 'appDST0000000000';

describe('records background-job status', () => {
  beforeEach(() => { process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-job-')); });

  it('writeRecordsJobStatus / readRecordsJobStatus round-trips, keyed per planId', () => {
    writeRecordsJobStatus(SRC, DEST, 'pln1', { status: 'running', startedAt: 't0' });
    const j = readRecordsJobStatus(SRC, DEST, 'pln1');
    assert.equal(j.planId, 'pln1');
    assert.equal(j.status, 'running');
    assert.equal(j.startedAt, 't0');
    assert.equal(readRecordsJobStatus(SRC, DEST, 'other'), null);
  });

  it('recordsStatus merges the job file with the LIVE idmap.records count', () => {
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { recA: 'recX', recB: 'recY' } });
    writeRecordsJobStatus(SRC, DEST, 'pln2', { status: 'running', startedAt: 't0' });
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'pln2' });
    assert.equal(s.status, 'running');
    assert.equal(s.recordsMapped, 2); // live progress derived from idmap
  });

  it('recordsStatus returns status="unknown" when no job exists', () => {
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'plnNONE' });
    assert.equal(s.status, 'unknown');
    assert.equal(s.recordsMapped, 0);
  });

  it('stamps the writer pid on a running status write', () => {
    writeRecordsJobStatus(SRC, DEST, 'plnPid', { status: 'running', startedAt: 't0' });
    const j = readRecordsJobStatus(SRC, DEST, 'plnPid');
    assert.equal(j.pid, process.pid, 'running status must carry the writing process pid');
    assert.equal(j.status, 'running', 'writer is alive → still running');
  });

  it('reports a running job with a DEAD pid as failed with a resume hint (process died mid-job)', () => {
    writeRecordsJobStatus(SRC, DEST, 'plnDead', { status: 'running', startedAt: 't0', pid: deadPid() });
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'plnDead' });
    assert.equal(s.status, 'failed', 'a dead writer can never finish the job — must not report running forever');
    assert.match(String(s.error), /died mid-job/);
    assert.match(String(s.error), /mode=apply/, 'error must tell the user how to resume');
  });

  it('keeps a running job with a LIVE pid as running', () => {
    writeRecordsJobStatus(SRC, DEST, 'plnLive', { status: 'running', startedAt: 't0', pid: process.pid });
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'plnLive' });
    assert.equal(s.status, 'running');
  });

  it('a legacy running job file without pid stays running (cannot verify liveness)', () => {
    // Simulate a pre-pid job file written by an older version.
    mkdirSync(syncDir(SRC, DEST), { recursive: true });
    writeFileSync(join(syncDir(SRC, DEST), 'records-job-plnLegacy.json'), JSON.stringify({ planId: 'plnLegacy', status: 'running', startedAt: 't0' }));
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'plnLegacy' });
    assert.equal(s.status, 'running');
  });

  it('done/failed statuses are never re-derived from pid', () => {
    writeRecordsJobStatus(SRC, DEST, 'plnDone', { status: 'done', startedAt: 't0', finishedAt: 't1', pid: deadPid(), result: { created: 1 } });
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'plnDone' });
    assert.equal(s.status, 'done');
  });

  it('done status carries the result summary', () => {
    writeRecordsJobStatus(SRC, DEST, 'pln3', { status: 'done', startedAt: 't0', finishedAt: 't1', result: { created: 5, updated: 0, failed: 0, attachmentsUploaded: 1, viewFiltersReapplied: 2, warnings: 0 } });
    const s = recordsStatus({ sourceBaseId: SRC, destBaseId: DEST, planId: 'pln3' });
    assert.equal(s.status, 'done');
    assert.equal(s.result.created, 5);
    assert.equal(s.result.viewFiltersReapplied, 2);
  });
});

describe('renderApplyResult — background records line', () => {
  it('shows the running/jobId/poll line when records.status==="running"', () => {
    const out = renderApplyResult({ planId: 'plnX', created: 0, updated: 0, skipped: 0, failed: 0, records: { status: 'running', jobId: 'plnX' } });
    assert.match(out.human, /records: started in background \(jobId=plnX\)/);
    assert.match(out.human, /mode=status/);
  });
});
