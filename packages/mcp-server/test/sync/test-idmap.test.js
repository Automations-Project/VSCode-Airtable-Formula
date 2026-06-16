import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { matchByName, saveIdmap, loadIdmap, syncDir } from '../../src/sync/idmap.js';

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

describe('idmap state I/O', () => {
  it('round-trips idmap through the sync dir', () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-test-'));
    const m = { tables: { tS: 'tD' }, fields: {} };
    saveIdmap('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB', m);
    assert.ok(existsSync(join(syncDir('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), 'idmap.json')));
    assert.deepEqual(loadIdmap('appAAAAAAAAAAAAAA', 'appBBBBBBBBBBBBBB'), m);
  });
});
