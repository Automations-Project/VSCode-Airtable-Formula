// Regression tests: mode=reconcile must take the same per-pair apply.lock as mode=apply —
// run concurrently with a background records job it does a load-modify-save of idmap.json
// (last-writer-wins clobber). reconcile() must refuse while a LIVE lock exists, replace a
// stale lock (dead pid), and release the lock on both success and failure.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcile } from '../../src/sync/records.js';
import { saveIdmap, loadIdmap, syncDir } from '../../src/sync/idmap.js';

const SRC = 'appSrcLkXXXXXXXXX';
const DEST = 'appDstLkXXXXXXXXX';

// One dest table whose snapshot holds a single live record (recLive) — a mapping to any
// other dest id is stale and existence-pruned by reconcile.
function destClient() {
  const tables = [{
    id: 'tblD', name: 'T',
    primaryColumnId: 'fldD',
    columns: [{ id: 'fldD', name: 'Name', type: 'text', typeOptions: null, description: null }],
    views: [{ id: 'vD', name: 'Grid view', type: 'grid', personalForUserId: null }],
  }];
  return {
    getApplicationData: async () => ({ data: { tableSchemas: JSON.parse(JSON.stringify(tables)) } }),
    queryRecords: async () => ({ summary: { rows: [{ id: 'recLive', fields: {} }] } }),
    getView: async () => ({}),
  };
}

function writeLock(lock) {
  mkdirSync(syncDir(SRC, DEST), { recursive: true });
  writeFileSync(join(syncDir(SRC, DEST), 'apply.lock'), JSON.stringify(lock));
}

describe('reconcile — per-pair apply lock', () => {
  it('refuses with APPLY_LOCKED while a live lock exists (idmap untouched)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'reconcile-lock-live-'));
    saveIdmap(SRC, DEST, { tables: { tblS: 'tblD' }, fields: {}, records: { recSGone: 'recStaleGone' }, views: {} });
    // A live holder: our own pid is definitionally alive.
    writeLock({ pid: process.pid, planId: 'plnJOB', startedAt: 'ts0' });

    await assert.rejects(
      () => reconcile({ client: destClient(), sourceBaseId: SRC, destBaseId: DEST }),
      (e) => e.code === 'APPLY_LOCKED' && /plnJOB/.test(e.message),
      'reconcile must refuse while a live apply lock exists',
    );
    const after = loadIdmap(SRC, DEST);
    assert.equal(after.records.recSGone, 'recStaleGone', 'idmap must not be modified while locked');
  });

  it('replaces a stale lock (dead pid), reconciles, and releases the lock', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'reconcile-lock-stale-'));
    saveIdmap(SRC, DEST, { tables: { tblS: 'tblD' }, fields: {}, records: { recSGone: 'recStaleGone', recSLive: 'recLive' }, views: {} });
    // A pid that cannot exist → process.kill(pid, 0) throws → stale.
    writeLock({ pid: 2147483646, planId: 'plnDEAD', startedAt: 'ts0' });

    const result = await reconcile({ client: destClient(), sourceBaseId: SRC, destBaseId: DEST });
    assert.equal(result.skipped, 1, 'stale mapping existence-pruned');
    const after = loadIdmap(SRC, DEST);
    assert.equal(after.records.recSGone, undefined, 'stale mapping dropped');
    assert.equal(after.records.recSLive, 'recLive', 'live mapping kept');
    assert.ok(!existsSync(join(syncDir(SRC, DEST), 'apply.lock')), 'lock released after reconcile');
  });

  it('releases the lock when reconcile throws', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'reconcile-lock-err-'));
    const throwing = { getApplicationData: async () => { throw new Error('boom'); } };
    await assert.rejects(() => reconcile({ client: throwing, sourceBaseId: SRC, destBaseId: DEST }), /boom/);
    assert.ok(!existsSync(join(syncDir(SRC, DEST), 'apply.lock')), 'lock released after a throw');
  });
});
