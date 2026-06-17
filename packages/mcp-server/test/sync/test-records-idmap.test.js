import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadIdmap, saveIdmap } from '../../src/sync/idmap.js';
import { mergeIdmapsForTest } from '../../src/sync/index.js';

describe('idmap records slot', () => {
  it('loadIdmap defaults to { tables: {}, fields: {}, records: {} } when file missing', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const m = loadIdmap('appAAAA', 'appBBBB');
    assert.deepEqual(m, { tables: {}, fields: {}, records: {} });
  });

  it('loadIdmap defaults to { tables: {}, fields: {}, records: {} } on parse error', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const homeDir = process.env.AIRTABLE_USER_MCP_HOME;
    const syncPath = join(homeDir, 'sync', 'appAAAA__appBBBB');
    // Save broken JSON
    mkdirSync(syncPath, { recursive: true });
    writeFileSync(join(syncPath, 'idmap.json'), 'not valid json {');
    const m = loadIdmap('appAAAA', 'appBBBB');
    assert.deepEqual(m, { tables: {}, fields: {}, records: {} });
  });

  it('mergeIdmaps merges records with persisted winning on conflict', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const homeDir = process.env.AIRTABLE_USER_MCP_HOME;
    const syncPath = join(homeDir, 'sync', 'appAAAA__appBBBB');

    // Write persisted idmap with records
    mkdirSync(syncPath, { recursive: true });
    const persistedMap = {
      tables: {},
      fields: {},
      records: { a: 'X', b: '2' }
    };
    writeFileSync(join(syncPath, 'idmap.json'), JSON.stringify(persistedMap));

    // Plan has different records
    const planIdmap = {
      tables: {},
      fields: {},
      records: { a: '1', c: '3' }
    };
    const fullPlan = { idmap: planIdmap };

    const merged = mergeIdmapsForTest('appAAAA', 'appBBBB', fullPlan);

    // Persisted should win on 'a', keep 'b', and plan contributes 'c'
    assert.deepEqual(merged.records, { a: 'X', b: '2', c: '3' });
  });

  it('mergeIdmaps also merges views with persisted winning', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const homeDir = process.env.AIRTABLE_USER_MCP_HOME;
    const syncPath = join(homeDir, 'sync', 'appAAAA__appBBBB');

    mkdirSync(syncPath, { recursive: true });
    const persistedMap = {
      tables: {},
      fields: {},
      records: {},
      views: { vS1: 'vD_old', vS2: 'vD2' }
    };
    writeFileSync(join(syncPath, 'idmap.json'), JSON.stringify(persistedMap));

    const planIdmap = {
      tables: {},
      fields: {},
      records: {},
      views: { vS1: 'vD_new', vS3: 'vD3' }
    };
    const fullPlan = { idmap: planIdmap };

    const merged = mergeIdmapsForTest('appAAAA', 'appBBBB', fullPlan);

    // Persisted wins on vS1, keeps vS2, plan contributes vS3
    assert.deepEqual(merged.views, { vS1: 'vD_old', vS2: 'vD2', vS3: 'vD3' });
  });
});
