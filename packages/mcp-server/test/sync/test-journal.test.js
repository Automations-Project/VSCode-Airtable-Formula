import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { newJournal, isDone, recordDone, recordFailed, saveJournal, loadJournal } from '../../src/sync/journal.js';

describe('journal', () => {
  it('records done/failed and reports done by idx', () => {
    const j = newJournal('plnX', '2026-06-16T00:00:00Z');
    assert.equal(isDone(j, 0), false);
    recordDone(j, 0, 'createTable', 'tblD');
    recordFailed(j, 1, 'createField', 'boom');
    assert.equal(isDone(j, 0), true);
    assert.equal(isDone(j, 1), false); // failed is retryable, not done
    assert.equal(j.actions.find((a) => a.idx === 0).destId, 'tblD');
    assert.equal(j.actions.find((a) => a.idx === 1).error, 'boom');
  });
  it('round-trips through the sync dir', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'jrnl-'));
    const j = newJournal('plnY', 'ts');
    recordDone(j, 0, 'createTable', 'tblD');
    saveJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', j);
    const back = loadJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'plnY');
    assert.equal(back.actions[0].destId, 'tblD');
    assert.equal(loadJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'nope'), null);
  });
});
