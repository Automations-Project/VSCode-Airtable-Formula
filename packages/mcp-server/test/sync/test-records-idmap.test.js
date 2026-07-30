import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadIdmap, saveIdmap } from '../../src/sync/idmap.js';
import { mergeIdmapsForTest, buildRunIdmap } from '../../src/sync/index.js';

describe('buildRunIdmap — records identity survives across applies (C1 duplication guard)', () => {
  it('FRESH apply (empty journal) SEEDS records + attachments from the persisted idmap, not the plan', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-c1-'));
    // Persisted idmap holds the grown rec->rec identity from a prior apply.
    saveIdmap('appAAAA', 'appBBBB', { tables: {}, fields: {}, records: { recA: 'recX' }, attachments: { 'photo.png|123': true } });
    // A fresh plan's idmap has NO records (plan is schema-only).
    const fullPlan = { idmap: { tables: { tblS: 'tblD' }, fields: {}, views: {} } };
    const idmap = buildRunIdmap('appAAAA', 'appBBBB', fullPlan, { actions: [] });
    assert.deepEqual(idmap.records, { recA: 'recX' });               // preserved — NOT wiped (the bug)
    assert.deepEqual(idmap.attachments, { 'photo.png|123': true });   // attachment dedupe map preserved
    assert.equal(idmap.tables.tblS, 'tblD');                          // plan's schema matches still present
  });

  it('RESUME (journal has actions) merges persisted records over the plan', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-c1r-'));
    saveIdmap('appAAAA', 'appBBBB', { tables: {}, fields: {}, records: { recA: 'recX' } });
    const fullPlan = { idmap: { tables: {}, fields: {}, records: {}, views: {} } };
    const idmap = buildRunIdmap('appAAAA', 'appBBBB', fullPlan, { actions: [{ idx: 0, status: 'done' }] });
    assert.equal(idmap.records.recA, 'recX');
  });
});

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
