import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { matchByName, saveIdmap, loadIdmap, syncDir, saveDiff, loadDiff, latestDiffId } from '../../src/sync/idmap.js';

const src = { tables: [
  { id: 'tS', name: 'Offers', fields: [
    { id: 'fS1', name: 'Name', type: 'text' },
    { id: 'fS2', name: 'Status', type: 'singleSelect', typeOptions: { choices: { selS: { id: 'selS', name: 'Open' } } } },
    { id: 'fS3', name: 'OnlyInSource', type: 'text' },
  ] },
  { id: 'tSonly', name: 'Ghost', fields: [] },
] };
const dest = { tables: [
  { id: 'tD', name: 'Offers', fields: [
    { id: 'fD1', name: 'Name', type: 'text' },
    { id: 'fD2', name: 'Status', type: 'singleSelect', typeOptions: { choices: { selD: { id: 'selD', name: 'Open' } } } },
  ] },
] };

describe('idmap.matchByName', () => {
  it('maps tables, fields, and choices by name; skips unmatched', () => {
    const m = matchByName(src, dest);
    assert.equal(m.tables.tS, 'tD');
    assert.equal(m.tables.tSonly, undefined);
    assert.equal(m.fields.fS1.destFld, 'fD1');
    assert.equal(m.fields.fS2.destFld, 'fD2');
    assert.equal(m.fields.fS2.choices.selS, 'selD');
    assert.equal(m.fields.fS3, undefined);
  });
});

describe('idmap view matching', () => {
  it('matches collaborative views by name within a table; skips personal + unmatched', () => {
    const src = { tables: [{ id: 'tS', name: 'T', fields: [{ id: 'fS', name: 'Name' }], views: [
      { id: 'vS1', name: 'Grid view', personalForUserId: null },
      { id: 'vS2', name: 'OnlySrc', personalForUserId: null },
      { id: 'vS3', name: 'Mine', personalForUserId: 'usr1' } ] }] };
    const dest = { tables: [{ id: 'tD', name: 'T', fields: [{ id: 'fD', name: 'Name' }], views: [
      { id: 'vD1', name: 'Grid view', personalForUserId: null },
      { id: 'vDm', name: 'Mine', personalForUserId: 'usr2' } ] }] };
    const m = matchByName(src, dest);
    assert.equal(m.views.vS1, 'vD1');     // matched by name
    assert.equal(m.views.vS2, undefined); // no dest match
    assert.equal(m.views.vS3, undefined); // source personal skipped
  });
  it('still returns tables + fields maps (additive)', () => {
    const src = { tables: [{ id: 'tS', name: 'T', fields: [{ id: 'fS', name: 'Name' }], views: [] }] };
    const dest = { tables: [{ id: 'tD', name: 'T', fields: [{ id: 'fD', name: 'Name' }], views: [] }] };
    const m = matchByName(src, dest);
    assert.equal(m.tables.tS, 'tD');
    assert.equal(m.fields.fS.destFld, 'fD');
    assert.deepEqual(m.views, {});
  });
});

describe('idmap state I/O', () => {
  it('round-trips idmap through the sync dir', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const m = { tables: { tS: 'tD' }, fields: {} };
    saveIdmap('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', m);
    assert.ok(existsSync(join(syncDir('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), 'idmap.json')));
    assert.deepEqual(loadIdmap('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), m);
  });
});

describe('idmap diff I/O', () => {
  const SRC = 'appSSSSSSSSSSSSSS';
  const DEST = 'appDDDDDDDDDDDDDD';

  it('saveDiff writes and loadDiff reads back the diff', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-test-'));
    const diff = { diffId: 'd1', tables: [] };
    saveDiff(SRC, DEST, diff);
    assert.ok(existsSync(join(syncDir(SRC, DEST), 'diff-d1.json')));
    assert.deepEqual(loadDiff(SRC, DEST, 'd1'), diff);
  });

  it('latestDiffId returns the id of the most recently saved diff', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-test-'));
    saveDiff(SRC, DEST, { diffId: 'd1', tables: [] });
    assert.equal(latestDiffId(SRC, DEST), 'd1');
    // Save a second diff later — it should win
    saveDiff(SRC, DEST, { diffId: 'd2', tables: ['x'] });
    assert.equal(latestDiffId(SRC, DEST), 'd2');
  });

  it('loadDiff returns null for unknown diffId', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-test-'));
    assert.equal(loadDiff(SRC, DEST, 'no-such-diff'), null);
  });

  it('latestDiffId returns null when no diff files exist', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-test-'));
    assert.equal(latestDiffId(SRC, DEST), null);
  });

  it('latestDiffId returns null when sync dir does not exist', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-diff-test-'));
    // Use a pair that was never written to
    assert.equal(latestDiffId('appNEVER1111111111', 'appNEVER2222222222'), null);
  });
});
