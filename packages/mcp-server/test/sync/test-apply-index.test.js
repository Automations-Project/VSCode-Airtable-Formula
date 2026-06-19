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

describe('index: views', () => {
  it('fingerprintSchema changes when a table gains a view', () => {
    const a = { tables: [{ id: 't1', name: 'T', fields: [{ id: 'f1', name: 'Name', type: 'text' }], views: [{ id: 'v1', name: 'Grid view', type: 'grid' }] }] };
    const b = { tables: [{ id: 't1', name: 'T', fields: [{ id: 'f1', name: 'Name', type: 'text' }], views: [{ id: 'v1', name: 'Grid view', type: 'grid' }, { id: 'v2', name: 'Board', type: 'kanban' }] }] };
    assert.notEqual(fingerprintSchema(a), fingerprintSchema(b));
  });

  it('apply creates a source-only view end to end (views applied after fields)', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-v-'));
    const client = new MockClient();
    const dest = await snapshotBase(client, 'appDDDDDDDDDDDDDD'); // empty base
    const plan = { planId: 'plnVI', engineVersion: '2b', destFingerprint: fingerprintSchema(dest), sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', idmap: { tables: {}, fields: {}, views: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tS', name: 'T' },
        { kind: 'reconcilePrimary', sourceTableId: 'tS', sourcePrimaryFieldId: 'fS1', toName: 'Name', toType: 'text', toTypeOptions: null },
        { kind: 'createView', sourceTableId: 'tS', sourceViewId: 'vNew', name: 'Board', type: 'grid' },
      ], orphans: [], warnings: [] };
    savePlan('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD', plan);
    const out = await apply({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnVI', runStartedAt: 'ts' });
    assert.match(out.human, /created/);
    const views = (await client.getApplicationData('appDDDDDDDDDDDDDD')).data.tableSchemas[0].views;
    assert.ok(views.some((v) => v.name === 'Board'));
  });
});

describe('index.apply: skip forwarding', () => {
  it('apply() with skip:[changeId] forwards to applyPlan so the skipped action is not applied', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'apply-skip-'));
    const client = new MockClient();
    const dest = await snapshotBase(client, 'appDDDDDDDDDDDDDD');
    const plan = {
      planId: 'plnSKIP',
      engineVersion: '2b',
      destFingerprint: fingerprintSchema(dest),
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      idmap: { tables: {}, fields: {}, views: {} },
      actions: [
        { kind: 'createTable', sourceTableId: 'tA', name: 'TableA', changeId: 'createTable|A|A', apply: true },
        { kind: 'createTable', sourceTableId: 'tB', name: 'TableB', changeId: 'createTable|B|B', apply: true },
      ],
      orphans: [],
      warnings: [],
    };
    savePlan('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD', plan);
    // Pass skip: ['createTable|B|B'] — TableB should be skipped
    const out = await apply({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      planId: 'plnSKIP',
      runStartedAt: 'ts',
      skip: ['createTable|B|B'],
    });
    // One created (A), one skipped (B)
    assert.match(out.human, /created: 1/, `expected created:1 in: ${out.human}`);
    assert.match(out.human, /skipped: 1/, `expected skipped:1 in: ${out.human}`);
    // Only TableA should be in the dest
    const tables = (await client.getApplicationData('appDDDDDDDDDDDDDD')).data.tableSchemas;
    const names = tables.map((t) => t.name).sort();
    assert.deepEqual(names, ['TableA'], `expected only TableA in dest, got ${JSON.stringify(names)}`);
  });
});
