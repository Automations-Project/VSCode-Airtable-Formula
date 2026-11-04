// Regression tests: per-pair apply lock (audit: two concurrent mode=apply runs on the same
// src/dest pair ran concurrent background records jobs that duplicated records and
// last-writer-wins-clobbered idmap.json). apply() must refuse while a LIVE lock exists,
// replace a stale lock (dead pid), and release the lock once the background records job settles.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockClient } from './helpers/mock-client.js';
import { apply, fingerprintSchema, ENGINE_VERSION } from '../../src/sync/index.js';
import { snapshotBase } from '../../src/sync/snapshot.js';
import { savePlan, syncDir } from '../../src/sync/idmap.js';

const SRC = 'appSSSSSSSSSSSSSS';
const DEST = 'appDDDDDDDDDDDDDD';

async function seedPlan(client, planId) {
  const dest = await snapshotBase(client, DEST);
  const plan = {
    planId, engineVersion: ENGINE_VERSION, destFingerprint: fingerprintSchema(dest),
    sourceBaseId: SRC, destBaseId: DEST,
    idmap: { tables: {}, fields: {}, views: {} },
    actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'T' }],
    orphans: [], warnings: [],
  };
  savePlan(SRC, DEST, plan);
  return plan;
}

function writeLock(lock) {
  mkdirSync(syncDir(SRC, DEST), { recursive: true });
  writeFileSync(join(syncDir(SRC, DEST), 'apply.lock'), JSON.stringify(lock));
}

async function waitForLockRelease(timeoutMs = 5000) {
  const p = join(syncDir(SRC, DEST), 'apply.lock');
  const deadline = Date.now() + timeoutMs;
  while (existsSync(p)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

describe('sync index.apply — per-pair apply lock', () => {
  it('refuses with APPLY_LOCKED while a live lock exists (no mutation)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-lock-live-'));
    const client = new MockClient();
    await seedPlan(client, 'plnLOCK');
    // A live holder: our own pid is definitionally alive.
    writeLock({ pid: process.pid, planId: 'plnOTHER', startedAt: 'ts0' });

    await assert.rejects(
      () => apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnLOCK', runStartedAt: 'ts' }),
      (e) => e.code === 'APPLY_LOCKED' && /plnOTHER/.test(e.message),
      'apply must refuse while a live apply lock exists',
    );
    // Nothing was mutated in dest.
    assert.equal((await client.getApplicationData(DEST)).data.tableSchemas.length, 0, 'no mutation while locked');
  });

  it('replaces a stale lock (dead pid) and applies normally', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-lock-stale-'));
    const client = new MockClient();
    await seedPlan(client, 'plnSTALE');
    // A pid that cannot exist → process.kill(pid, 0) throws → stale.
    writeLock({ pid: 2147483646, planId: 'plnDEAD', startedAt: 'ts0' });

    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnSTALE', runStartedAt: 'ts' });
    assert.match(out.human, /created: 1/, 'stale lock must be replaced, apply proceeds');
  });

  it('releases the lock after the background records job settles', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-lock-rel-'));
    const client = new MockClient();
    await seedPlan(client, 'plnREL');
    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnREL', runStartedAt: 'ts' });
    assert.match(out.human, /created: 1/);
    // The synchronous phase returns while the records job is still running — the lock is held
    // until the job's completion path releases it.
    const released = await waitForLockRelease();
    assert.ok(released, 'apply.lock must be removed once the background records job settles');
  });

  it('releases the lock on a synchronous abort (DRIFT) — no background job launched', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-lock-drift-'));
    const client = new MockClient();
    const plan = {
      planId: 'plnDR', engineVersion: ENGINE_VERSION, destFingerprint: 'STALE',
      sourceBaseId: SRC, destBaseId: DEST,
      idmap: { tables: {}, fields: {} },
      actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'T' }],
      orphans: [], warnings: [],
    };
    savePlan(SRC, DEST, plan);
    const out = await apply({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnDR', runStartedAt: 'ts' });
    assert.match(out.human, /DRIFT/);
    assert.ok(!existsSync(join(syncDir(SRC, DEST), 'apply.lock')), 'lock must be released after a DRIFT abort');
  });
});
