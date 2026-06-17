import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { newJournal, recordDone, saveRecordsJournal, loadRecordsJournal } from '../../src/sync/journal.js';

describe('records-journal', () => {
  it('saveRecordsJournal writes records-journal-{planId}.json (distinct from journal)', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'rjrnl-'));
    const j = newJournal('plnZ', '2026-06-16T00:00:00Z');
    recordDone(j, 0, 'createRecord', 'recX');
    saveRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', j);
    const back = loadRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'plnZ');
    assert.equal(back.actions[0].destId, 'recX');
    assert.equal(loadRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'nope'), null);
  });
});
