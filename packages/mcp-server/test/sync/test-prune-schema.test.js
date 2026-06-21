import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSchema } from '../../src/sync/prune-schema.js';

// Mock client. deleteFields succeeds for a field UNLESS some still-present field depends on it
// (modelled by `deps`: dependentFieldId -> [fieldIds it depends on]). force is asserted false.
function mockClient({ deps = {} } = {}) {
  const calls = { views: [], tables: [], fieldBatches: [] };
  const present = new Set(); // fields still alive (seeded per test via opts)
  const api = {
    calls,
    _seed(ids) { ids.forEach((i) => present.add(i)); },
    async deleteView(appId, viewId) { calls.views.push(viewId); },
    async deleteTable(appId, tableId, expectedName) { calls.tables.push({ tableId, expectedName }); },
    async deleteFields(appId, fields, opts) {
      assert.equal(opts.force, false, 'must never force-delete fields');
      calls.fieldBatches.push(fields.map((f) => f.fieldId));
      const succeeded = [], failed = [];
      for (const { fieldId, expectedName } of fields) {
        // blocked if any CURRENTLY-PRESENT field depends on fieldId
        const blockedBy = Object.entries(deps).filter(([dep, on]) => present.has(dep) && on.includes(fieldId)).map(([dep]) => dep);
        if (blockedBy.length) { failed.push({ fieldId, name: expectedName, error: 'has dependents: ' + blockedBy.join(',') }); }
        else { present.delete(fieldId); succeeded.push(fieldId); }
      }
      return { succeeded, failed };
    },
  };
  return api;
}
const baseResult = () => ({ schemaDeleted: 0, tablesDeleted: 0, warnings: [] });
const plan = (orphans) => ({ orphans });

describe('pruneSchema', () => {
  it('mirror + confirmDeletions deletes orphan views and fields (matched tables)', async () => {
    const client = mockClient(); client._seed(['fldA', 'fldB']);
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'view', destId: 'viw1', name: 'Extra', tableName: 'Offers' },
      { kind: 'field', destId: 'fldA', name: 'X', tableName: 'Offers' },
      { kind: 'field', destId: 'fldB', name: 'Y', tableName: 'Offers' },
    ]), policy: 'mirror', confirmDeletions: true, confirmTableDeletions: false, result });
    assert.deepEqual(client.calls.views, ['viw1']);
    assert.equal(result.schemaDeleted, 3, '1 view + 2 fields');
  });

  it('mirror WITHOUT confirmDeletions deletes nothing + DELETION_GATED with count', async () => {
    const client = mockClient(); client._seed(['fldA']);
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'view', destId: 'viw1', name: 'Extra', tableName: 'Offers' },
      { kind: 'field', destId: 'fldA', name: 'X', tableName: 'Offers' },
    ]), policy: 'mirror', confirmDeletions: false, confirmTableDeletions: false, result });
    assert.equal(result.schemaDeleted, 0);
    const w = result.warnings.find((x) => x.code === 'DELETION_GATED');
    assert.ok(w && /2/.test(w.message), 'gated count = 2 (1 view + 1 field)');
    assert.equal(client.calls.views.length, 0);
  });

  it('orphan TABLE: confirmDeletions but NOT confirmTableDeletions → TABLE_DELETION_GATED, table kept', async () => {
    const client = mockClient();
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'table', destId: 'tbl9', name: 'DestOnly' },
    ]), policy: 'mirror', confirmDeletions: true, confirmTableDeletions: false, result });
    assert.equal(client.calls.tables.length, 0);
    assert.ok(result.warnings.some((x) => x.code === 'TABLE_DELETION_GATED'));
  });

  it('orphan TABLE: confirmTableDeletions → table deleted', async () => {
    const client = mockClient();
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'table', destId: 'tbl9', name: 'DestOnly' },
    ]), policy: 'mirror', confirmDeletions: true, confirmTableDeletions: true, result });
    assert.deepEqual(client.calls.tables, [{ tableId: 'tbl9', expectedName: 'DestOnly' }]);
    assert.equal(result.tablesDeleted, 1);
  });

  it('overlay table: orphans never deleted', async () => {
    const client = mockClient(); client._seed(['fldA']);
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'field', destId: 'fldA', name: 'X', tableName: 'Offers' },
      { kind: 'table', destId: 'tbl9', name: 'DestOnly' },
    ]), policy: 'overlay', confirmDeletions: true, confirmTableDeletions: true, result });
    assert.equal(result.schemaDeleted, 0);
    assert.equal(result.tablesDeleted, 0);
  });

  it('policyOverrides preserve protects a dest-only table under global mirror', async () => {
    const client = mockClient();
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'table', destId: 'tbl9', name: 'Keep' },
    ]), policy: 'mirror', policyOverrides: { Keep: 'preserve' }, confirmDeletions: true, confirmTableDeletions: true, result });
    assert.equal(client.calls.tables.length, 0);
  });

  it('orphan->orphan dependency resolves by retry (delete dependent first)', async () => {
    // fldB depends on fldA (both orphans). Pass 1: fldA blocked (fldB present), fldB deletes.
    // Pass 2: fldA deletes (fldB gone). Both eventually deleted, no force.
    const client = mockClient({ deps: { fldB: ['fldA'] } }); client._seed(['fldA', 'fldB']);
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'field', destId: 'fldA', name: 'A', tableName: 'Offers' },
      { kind: 'field', destId: 'fldB', name: 'B', tableName: 'Offers' },
    ]), policy: 'mirror', confirmDeletions: true, confirmTableDeletions: false, result });
    assert.equal(result.schemaDeleted, 2, 'both deleted across passes');
  });

  it('orphan blocked by a MATCHED field is skipped + SCHEMA_DELETE_BLOCKED (never forced)', async () => {
    // fldM (matched, NOT in orphans, always present) depends on fldA (orphan). fldA can never delete.
    const client = mockClient({ deps: { fldM: ['fldA'] } }); client._seed(['fldA', 'fldM']);
    const result = baseResult();
    await pruneSchema({ client, destAppId: 'appD', plan: plan([
      { kind: 'field', destId: 'fldA', name: 'A', tableName: 'Offers' },
    ]), policy: 'mirror', confirmDeletions: true, confirmTableDeletions: false, result });
    assert.equal(result.schemaDeleted, 0);
    assert.ok(result.warnings.some((x) => x.code === 'SCHEMA_DELETE_BLOCKED'));
  });
});
