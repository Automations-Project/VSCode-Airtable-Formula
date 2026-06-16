import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plan as computeSyncPlan, fingerprintSchema } from '../../src/sync/index.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncDir } from '../../src/sync/idmap.js';

describe('sync index.plan', () => {
  it('produces a plan summary and persists plan-<id>.json', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-idx-'));
    const mk = (tableName, fieldName) => ({ data: { tableSchemas: [{ id: 'tbl1', name: tableName, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: fieldName, type: 'text' }] }] } });
    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? mk('T', 'Name') : { data: { tableSchemas: [] } }) };
    const out = await computeSyncPlan({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnTEST' });
    assert.match(out.human, /createTable: 1/);
    assert.ok(existsSync(join(syncDir('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD'), 'plan-plnTEST.json')));
  });
  it('fingerprintSchema is stable + order-independent', () => {
    const a = { tables: [{ id: 't1', name: 'A', fields: [{ id: 'f1', name: 'x', type: 'text' }] }, { id: 't2', name: 'B', fields: [] }] };
    const b = { tables: [{ id: 't2', name: 'B', fields: [] }, { id: 't1', name: 'A', fields: [{ id: 'f1', name: 'x', type: 'text' }] }] };
    assert.equal(fingerprintSchema(a), fingerprintSchema(b));
  });
});
