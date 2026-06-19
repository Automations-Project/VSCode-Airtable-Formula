/**
 * test-diff-engine.test.js
 *
 * Tests for diff() and diffDetail() engine functions in src/sync/index.js.
 * Uses a mock client; no real network.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { diff, diffDetail } from '../../src/sync/index.js';
import { syncDir } from '../../src/sync/idmap.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const SRC_APP = 'appSrcDiffSrcDiff';
const DEST_APP = 'appDstDiffDstDiff';
const TABLE_NAME = 'Tasks';

/**
 * Source schema: Tasks table with a text field "Title".
 */
const SRC_DATA = {
  tableSchemas: [
    {
      id: 'tblSrc001',
      name: TABLE_NAME,
      primaryColumnId: 'fldSrc001',
      columns: [
        { id: 'fldSrc001', name: 'Title', type: 'text' },
        { id: 'fldSrc002', name: 'Count', type: 'text' },
      ],
    },
  ],
};

/**
 * Destination schema: same table, same field names, but "Count" is a number type — creates drift.
 */
const DEST_DATA = {
  tableSchemas: [
    {
      id: 'tblDst001',
      name: TABLE_NAME,
      primaryColumnId: 'fldDst001',
      columns: [
        { id: 'fldDst001', name: 'Title', type: 'text' },
        { id: 'fldDst002', name: 'Count', type: 'number' },
      ],
    },
  ],
};

/**
 * Build a unified mock client whose behavior depends on the appId passed.
 */
function makeMockClient(sourceBaseId, destBaseId) {
  return {
    getApplicationData: async (appId) => {
      if (appId === sourceBaseId) return { data: SRC_DATA };
      return { data: DEST_DATA };
    },
    getView: async () => ({}),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('sync index.diff / diffDetail', () => {
  before(() => {
    // Redirect home dir so test writes don't pollute real user data.
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-'));
  });

  it('diff() returns a digest with drift >= 1 and writes diff-<id>.json', async () => {
    const client = makeMockClient(SRC_APP, DEST_APP);
    const result = await diff({ client, sourceBaseId: SRC_APP, destBaseId: DEST_APP, diffId: 'd1' });

    // Should have a human-readable summary.
    assert.ok(typeof result.human === 'string', 'human should be a string');
    assert.ok(result.human.length > 0, 'human should not be empty');

    // machine.summary.drift should be >= 1 (type mismatch on "Count" field).
    assert.ok(result.machine.summary.drift >= 1, `expected drift >= 1, got ${result.machine.summary.drift}`);

    // diffId should be reflected in the machine output.
    assert.equal(result.machine.diffId, 'd1', 'machine.diffId should equal d1');

    // The file should have been persisted.
    const dir = syncDir(SRC_APP, DEST_APP);
    const filePath = join(dir, 'diff-d1.json');
    assert.ok(existsSync(filePath), `diff-d1.json should exist at ${filePath}`);
  });

  it('diffDetail() with explicit diffId returns entries for the table', async () => {
    // d1 was written by the previous test; reuse via diffDetail (no client needed).
    const result = diffDetail({ sourceBaseId: SRC_APP, destBaseId: DEST_APP, diffId: 'd1', detail: TABLE_NAME });

    assert.ok(typeof result.human === 'string', 'human should be a string');
    // In detail mode, machine contains entries for the requested table.
    assert.ok(Array.isArray(result.machine.entries), 'machine.entries should be an array');
    // There should be at least one entry (the type drift on "Count").
    assert.ok(result.machine.entries.length >= 1, `expected >= 1 entry, got ${result.machine.entries.length}`);
    // Each entry should have scope/key/source/dest/class.
    const entry = result.machine.entries[0];
    assert.ok(entry.scope, 'entry.scope should be present');
    assert.ok(entry.key, 'entry.key should be present');
    assert.ok(entry.class, 'entry.class should be present');
  });

  it('diffDetail() with no diffId uses latestDiffId() to find the file', async () => {
    // Pass no diffId — should auto-resolve to the latest diff (d1).
    const result = diffDetail({ sourceBaseId: SRC_APP, destBaseId: DEST_APP, detail: TABLE_NAME });

    assert.ok(typeof result.human === 'string', 'human should be a string');
    assert.ok(Array.isArray(result.machine.entries), 'machine.entries should be an array');
    assert.ok(result.machine.entries.length >= 1, 'should resolve to the latest diff and return entries');
  });
});
