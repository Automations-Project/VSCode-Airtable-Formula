import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRecordsJobStatus, readRecordsJobStatus } from '../../src/sync/records.js';
import { recordsStatus } from '../../src/sync/index.js';
import { saveIdmap } from '../../src/sync/idmap.js';
import { renderApplyResult } from '../../src/sync/report.js';

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
