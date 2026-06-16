import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MockClient } from './helpers/mock-client.js';
import { apply, fingerprintSchema } from '../../src/sync/index.js';
import { snapshotBase } from '../../src/sync/snapshot.js';
import { savePlan } from '../../src/sync/idmap.js';
import { renderApplyResult } from '../../src/sync/report.js';

describe('report.renderApplyResult', () => {
  it('summarizes counts and drift abort', () => {
    assert.match(renderApplyResult({ planId: 'p', aborted: false, created: 2, updated: 1, skipped: 3, failed: 0, warnings: [] }).human, /created: 2/);
    assert.match(renderApplyResult({ planId: 'p', aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: 'm' }] }).human, /DRIFT/);
  });
});

describe('index.apply', () => {
  it('aborts on dest drift (no mutation)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-'));
    const client = new MockClient();
    const plan = { planId: 'plnD', engineVersion: '2b', destFingerprint: 'STALE', sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', idmap: { tables: {}, fields: {} }, actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'T' }], orphans: [], warnings: [] };
    savePlan('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD', plan);
    const out = await apply({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnD', runStartedAt: 'ts' });
    assert.match(out.human, /DRIFT/);
    assert.equal((await client.getApplicationData('appDDDDDDDDDDDDDD')).data.tableSchemas.length, 0);
  });

  it('applies when the fingerprint matches', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply2-'));
    const client = new MockClient();
    const dest = await snapshotBase(client, 'appDDDDDDDDDDDDDD');
    const plan = { planId: 'plnOK', engineVersion: '2b', destFingerprint: fingerprintSchema(dest), sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', idmap: { tables: {}, fields: {} }, actions: [{ kind: 'createTable', sourceTableId: 'tS', name: 'T' }], orphans: [], warnings: [] };
    savePlan('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD', plan);
    const out = await apply({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnOK', runStartedAt: 'ts' });
    assert.match(out.human, /created: 1/);
  });
});
