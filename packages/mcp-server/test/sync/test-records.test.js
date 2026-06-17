import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1 } from '../../src/sync/records.js';
import { newJournal } from '../../src/sync/journal.js';
import { createLimiter } from '../../src/sync/ratelimit.js';

function mockClient(captured) {
  return {
    createRecords: async (appId, tableId, rows) => {
      const created = rows.map((r, i) => {
        const rowId = 'recD' + i;
        captured.push({ tableId, rowId, cells: r.cellValuesByColumnId, sourceKey: r.sourceKey });
        return { rowId, sourceKey: r.sourceKey };
      });
      return { created, failed: [] };
    },
    updateRecords: async () => ({ updated: [], failed: [] }),
  };
}

describe('records.applyRecordsPass1', () => {
  it('creates new records with coerced scalar/select cells and fills the record map', async () => {
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldSel: { destFld: 'fldSelD', choices: { selA: 'selAD' } },
      },
      records: {},
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldSel', type: 'select' },
          { id: 'fldL', type: 'multipleRecordLinks' },
        ],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldT: 'hi', fldSel: 'selA', fldL: ['recS9'] } }],
      }],
    };
    const destSnapshot = { tables: [{ id: 'tblD', name: 'T', fields: [] }] };
    const captured = [];
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client: mockClient(captured),
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p1', 't'),
      persist: () => {},
      result,
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].tableId, 'tblD');
    assert.deepEqual(captured[0].cells, { fldTD: 'hi', fldSelD: 'selAD' }); // link cell NOT written in pass 1
    assert.equal(idmap.records.recS1, 'recD0');                              // map filled
    assert.equal(result.created, 1);
  });

  it('skips unmatched table (not in idmap.tables)', async () => {
    const idmap = { tables: {}, fields: {}, records: {} };
    const srcSnapshot = {
      tables: [{
        id: 'tblX', name: 'Orphan',
        fields: [{ id: 'fldT', type: 'text' }],
        records: [{ id: 'recX1', cellValuesByColumnId: { fldT: 'val' } }],
      }],
    };
    const destSnapshot = { tables: [] };
    const captured = [];
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client: mockClient(captured),
      srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p2', 't'),
      persist: () => {},
      result,
    });
    assert.equal(captured.length, 0);
    assert.equal(result.created, 0);
  });

  it('updates existing records for scalar+single-select and skips multiSelect with RECORD_ARRAY_UPDATE_DEFERRED warning', async () => {
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ tableId, rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldSel: { destFld: 'fldSelD', choices: { selA: 'selAD' } },
        fldMS: { destFld: 'fldMSD', choices: { c1: 'c1D', c2: 'c2D' } },
      },
      records: { recS1: 'recD1' }, // already mapped → UPDATE path
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldSel', type: 'select' },
          { id: 'fldMS', type: 'multiSelect' },
        ],
        records: [{
          id: 'recS1',
          cellValuesByColumnId: { fldT: 'hello', fldSel: 'selA', fldMS: ['c1', 'c2'] },
        }],
      }],
    };
    const destSnapshot = { tables: [{ id: 'tblD', name: 'T', fields: [] }] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client,
      srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3', 't'),
      persist: () => {},
      result,
    });
    assert.equal(result.updated, 1);
    // multiSelect should NOT appear in the updateRecords call (arrays not supported)
    assert.equal(updateCalls.length, 1);
    const sentCells = updateCalls[0].rows[0].cellValuesByColumnId;
    assert.ok('fldTD' in sentCells, 'scalar text should be sent');
    assert.ok('fldSelD' in sentCells, 'single-select should be sent');
    assert.ok(!('fldMSD' in sentCells), 'multiSelect must NOT be sent to updateRecords');
    // Warning emitted for deferred multiSelect
    assert.ok(
      result.warnings.some((w) => w.code === 'RECORD_ARRAY_UPDATE_DEFERRED'),
      'expected RECORD_ARRAY_UPDATE_DEFERRED warning',
    );
  });

  it('pushes RECORD_CELL_SKIPPED warning when a select choice cannot be mapped', async () => {
    const captured = [];
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldSel: { destFld: 'fldSelD', choices: { selA: 'selAD' } }, // selB not in map
      },
      records: {},
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldSel', type: 'select' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldSel: 'selB' } }],
      }],
    };
    const destSnapshot = { tables: [{ id: 'tblD', name: 'T', fields: [] }] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client: mockClient(captured),
      srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p4', 't'),
      persist: () => {},
      result,
    });
    assert.ok(
      result.warnings.some((w) => w.code === 'RECORD_CELL_SKIPPED'),
      'expected RECORD_CELL_SKIPPED warning for unmappable choice',
    );
    // Record is still created (best-effort), just without the unmappable cell
    assert.equal(result.created, 1);
  });

  it('continues on createRecords failure and emits RECORD_CREATE_FAILED warning', async () => {
    const client = {
      createRecords: async () => {
        const e = new Error('bad request — schema mismatch');
        e.status = 422; // non-transient: withRetry will not retry, avoids real sleep delays
        throw e;
      },
      updateRecords: async () => ({ updated: [], failed: [] }),
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldT: { destFld: 'fldTD', choices: {} } },
      records: {},
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldT', type: 'text' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldT: 'x' } }],
      }],
    };
    const destSnapshot = { tables: [{ id: 'tblD', name: 'T', fields: [] }] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    // Should not throw
    await applyRecordsPass1({
      client,
      srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p5', 't'),
      persist: () => {},
      result,
    });
    assert.equal(result.failed, 1);
    assert.ok(
      result.warnings.some((w) => w.code === 'RECORD_CREATE_FAILED'),
      'expected RECORD_CREATE_FAILED warning',
    );
  });
});
