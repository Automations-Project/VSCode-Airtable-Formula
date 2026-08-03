/**
 * Guards that stop a prune from destroying data it cannot replace.
 *
 * M6: pruneRecords had only a RUN-wide "everything failed" gate, so one converged
 *     row in any other table disarmed it and a table whose every write failed had
 *     its pre-existing dest rows deleted with nothing written in their place.
 * M8: pruneSchema deleted the fieldMappings TARGETS that apply() had just validated
 *     — they are dest-only by construction and therefore always classified orphans.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSchema } from '../../src/sync/prune-schema.js';
import { applyRecordsPass1, pruneRecords, buildUpdateCells } from '../../src/sync/records.js';

const noopLimiter = { run: (fn) => fn() };

// ── M8 ──────────────────────────────────────────────────────────────────────

function schemaClient() {
  const calls = { fieldBatches: [] };
  return {
    calls,
    async deleteFields(appId, fields, opts) {
      assert.equal(opts.force, false);
      calls.fieldBatches.push(fields.map((f) => f.fieldId));
      return { succeeded: fields.map((f) => f.fieldId), failed: [] };
    },
    async deleteView() {}, async deleteTable() {}, async deleteViewSection() {},
  };
}

describe('pruneSchema — fieldMappings targets are never deleted', () => {
  const plan = {
    orphans: [
      { kind: 'field', destId: 'fldInject', name: 'InjectID', tableName: 'Tasks' },
      { kind: 'field', destId: 'fldJunk', name: 'Junk', tableName: 'Tasks' },
    ],
  };

  it('keeps a mapping target and still deletes real orphans', async () => {
    const client = schemaClient();
    const result = { warnings: [] };
    await pruneSchema({
      client, destAppId: 'app1', plan,
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true, confirmTableDeletions: false,
      result,
      fieldMappings: { Tasks: { Code: 'InjectID' } },
    });

    const deleted = client.calls.fieldBatches.flat();
    assert.ok(!deleted.includes('fldInject'), 'must NOT delete the fieldMappings target');
    assert.ok(deleted.includes('fldJunk'), 'must still delete genuine orphans');
    assert.equal(result.warnings.filter((w) => w.code === 'FIELD_MAP_TARGET_PROTECTED').length, 1);
  });

  it('without fieldMappings the same field is deleted (proves the guard is what saves it)', async () => {
    const client = schemaClient();
    const result = { warnings: [] };
    await pruneSchema({
      client, destAppId: 'app1', plan,
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true, confirmTableDeletions: false,
      result,
    });
    assert.ok(client.calls.fieldBatches.flat().includes('fldInject'));
  });
});

// ── M6 ──────────────────────────────────────────────────────────────────────

function recordsFixture() {
  const deleted = [];
  const client = {
    async deleteRecords(baseId, tableId, ids) { deleted.push(...ids); },
  };
  const destSnapshot = {
    baseId: 'appDest',
    tables: [{
      id: 'tblA', name: 'Tasks',
      views: [{ id: 'viwA', personalForUserId: null }],
      snapshotRowCount: 2,
      records: [{ id: 'recKeep' }, { id: 'recOrphan' }],
    }],
  };
  return { client, destSnapshot, deleted };
}

describe('pruneRecords — per-table write-failure gate', () => {
  it('does NOT delete after all writes fail when source and destination table names differ', async () => {
    const deleted = [];
    const client = {
      async createRecords(_baseId, _tableId, rows) {
        return {
          created: [],
          failed: rows.map((row) => ({ sourceKey: row.sourceKey, error: 'FIELD_FORBIDDEN' })),
        };
      },
      async deleteRecords(_baseId, _tableId, ids) { deleted.push(...ids); },
    };
    const srcSnapshot = {
      baseId: 'appSource',
      tables: [{
        id: 'tblSource', name: 'Source Tasks',
        fields: [{ id: 'fldSourceName', name: 'Name', type: 'text' }],
        records: [{ id: 'recSourceNew', cellValuesByColumnId: { fldSourceName: 'new' } }],
      }],
    };
    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblDest', name: 'Renamed Tasks',
        fields: [{ id: 'fldDestName', name: 'Name', type: 'text' }],
        views: [{ id: 'viwDest', personalForUserId: null }],
        snapshotRowCount: 1,
        records: [{ id: 'recDestOrphan' }],
      }],
    };
    const idmap = {
      tables: { tblSource: 'tblDest' },
      fields: { fldSourceName: { destFld: 'fldDestName' } },
      records: {},
    };
    const result = { warnings: [], created: 0, updated: 0, skipped: 0, failed: 0 };

    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: noopLimiter, journal: {}, persist: () => {}, result,
      policy: 'mirror', policyOverrides: {},
    });
    await pruneRecords({
      client, destSnapshot, idmap,
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true,
      limiter: noopLimiter, result,
    });

    assert.deepEqual(deleted, [], 'a destination rename must not bypass the all-writes-failed guard');
    assert.equal(result.warnings.filter((w) => w.code === 'RECORDS_FAILED_PRUNE_SKIPPED').length, 1);
  });

  it('does NOT delete dest rows in a table whose every write failed', async () => {
    const { client, destSnapshot, deleted } = recordsFixture();
    const result = {
      warnings: [],
      // Run-wide numbers look "fine" because another table converged — this is
      // exactly the shape that disarmed the old run-wide gate.
      created: 0, updated: 0, skipped: 7, failed: 3,
      perTable: {
        tblA: { created: 0, updated: 0, skipped: 0, failed: 3 },
        tblOther: { created: 0, updated: 0, skipped: 7, failed: 0 },
      },
    };

    await pruneRecords({
      // tblA must be the dest side of a matched pair, or pruneRecords skips it as a
      // dest-only table before any gate is reached. recKeep is mapped, recOrphan is not.
      client, destSnapshot, idmap: { tables: { tblSrcA: 'tblA' }, records: { recSrc1: 'recKeep' } },
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true,
      limiter: noopLimiter, result,
    });

    assert.deepEqual(deleted, [], 'no rows may be deleted in a wholly-failed table');
    assert.equal(result.warnings.filter((w) => w.code === 'RECORDS_FAILED_PRUNE_SKIPPED').length, 1);
  });

  it('DOES delete orphans when the table wrote successfully', async () => {
    const { client, destSnapshot, deleted } = recordsFixture();
    const result = {
      warnings: [],
      created: 1, updated: 0, skipped: 0, failed: 0,
      perTable: { tblA: { created: 1, updated: 0, skipped: 0, failed: 0 } },
    };

    await pruneRecords({
      // tblA must be the dest side of a matched pair, or pruneRecords skips it as a
      // dest-only table before any gate is reached. recKeep is mapped, recOrphan is not.
      client, destSnapshot, idmap: { tables: { tblSrcA: 'tblA' }, records: { recSrc1: 'recKeep' } },
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true,
      limiter: noopLimiter, result,
    });

    assert.ok(deleted.length > 0, 'a healthy table must still prune its orphans');
  });

  it('a table with no perTable entry (no writes attempted) still prunes', async () => {
    const { client, destSnapshot, deleted } = recordsFixture();
    const result = { warnings: [], created: 0, updated: 0, skipped: 0, failed: 0, perTable: {} };

    await pruneRecords({
      // tblA must be the dest side of a matched pair, or pruneRecords skips it as a
      // dest-only table before any gate is reached. recKeep is mapped, recOrphan is not.
      client, destSnapshot, idmap: { tables: { tblSrcA: 'tblA' }, records: { recSrc1: 'recKeep' } },
      policy: 'mirror', policyOverrides: {}, confirmDeletions: true,
      limiter: noopLimiter, result,
    });

    assert.ok(deleted.length > 0, 'absence of an entry must not be read as failure');
  });
});

// ── M12 ─────────────────────────────────────────────────────────────────────

describe('buildUpdateCells — converged cells are not re-posted', () => {
  // updateRecords issues one serialized HTTP POST per CELL, so re-sending cells the
  // destination already agrees with is pure request amplification: 1000 rows x 20
  // fields = 20,000 sequential requests for a run that changes nothing.
  const srcFields = [
    { id: 'fldName', name: 'Name', type: 'text' },
    { id: 'fldQty', name: 'Qty', type: 'number' },
  ];
  const idmap = { fields: { fldName: { destFld: 'dName' }, fldQty: { destFld: 'dQty' } }, tables: {} };

  it('emits nothing when every mapped cell already matches the dest', () => {
    const cells = buildUpdateCells(
      srcFields,
      { fldName: 'Alice', fldQty: 7 },
      { dName: 'Alice', dQty: 7 },
      idmap, [], 'rec1',
    );
    assert.deepEqual(cells, {}, 'a converged row must produce zero cell writes');
  });

  it('emits only the cell that actually changed', () => {
    const cells = buildUpdateCells(
      srcFields,
      { fldName: 'Alice', fldQty: 9 },
      { dName: 'Alice', dQty: 7 },
      idmap, [], 'rec1',
    );
    assert.deepEqual(cells, { dQty: 9 });
  });

  it('still propagates a cleared source cell', () => {
    const cells = buildUpdateCells(
      srcFields,
      { fldName: 'Alice' },            // Qty absent = cleared on source
      { dName: 'Alice', dQty: 7 },
      idmap, [], 'rec1',
    );
    assert.deepEqual(cells, { dQty: null });
  });

  it('treats empty-string / null / absent as equivalent, not as a change', () => {
    const cells = buildUpdateCells(
      [{ id: 'fldName', name: 'Name', type: 'text' }],
      { fldName: '' },
      { dName: null },
      { fields: { fldName: { destFld: 'dName' } }, tables: {} }, [], 'rec1',
    );
    assert.deepEqual(cells, {}, 'empty-ish on both sides is not worth a request');
  });
});
