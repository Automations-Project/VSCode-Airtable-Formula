import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { newJournal, recordDone, saveRecordsJournal, loadRecordsJournal } from '../../src/sync/journal.js';
import { syncDir } from '../../src/sync/idmap.js';

describe('records-journal', () => {
  const originalHome = process.env.AIRTABLE_USER_MCP_HOME;

  after(() => {
    process.env.AIRTABLE_USER_MCP_HOME = originalHome;
  });

  it('saveRecordsJournal writes records-journal-{planId}.json (distinct from journal)', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'rjrnl-'));
    const j = newJournal('plnZ', '2026-06-16T00:00:00Z');
    recordDone(j, 0, 'createRecord', 'recX');
    saveRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', j);

    // Assert distinct filename: records-journal exists
    const recordsJournalPath = join(syncDir('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), 'records-journal-plnZ.json');
    assert.ok(existsSync(recordsJournalPath), 'records-journal-plnZ.json should exist');

    // Assert distinct filename: schema journal does NOT exist
    const schemaJournalPath = join(syncDir('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), 'journal-plnZ.json');
    assert.equal(existsSync(schemaJournalPath), false, 'journal-plnZ.json should NOT exist for records journal');

    // Round-trip: verify full journal data
    const back = loadRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'plnZ');
    assert.equal(back.planId, 'plnZ');
    assert.equal(back.startedAt, '2026-06-16T00:00:00Z');
    assert.deepEqual(back.actions, j.actions);
    assert.equal(back.actions[0].destId, 'recX');

    // Assert null on missing journal
    assert.equal(loadRecordsJournal('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', 'nope'), null);
  });
});
