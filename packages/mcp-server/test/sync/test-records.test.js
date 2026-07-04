import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1, applyRecordsPass2, applyAttachments } from '../../src/sync/records.js';
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

  it('defers multiCollaborator arrays on the UPDATE path (never sent to updateRecords)', async () => {
    // updatePrimitiveCell cannot write arrays: an internal-typed 'multiCollaborator' cell in the
    // payload would fail the cell POST and poison the rest of the row update.
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldCol: { destFld: 'fldColD', choices: {} },
      },
      records: { recS1: 'recD1' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldCol', type: 'multiCollaborator' }, // INTERNAL spelling
        ],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldT: 'hello', fldCol: ['usrA', 'usrB'] } }],
      }],
    };
    const destSnapshot = { tables: [{ id: 'tblD', name: 'T', fields: [] }] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3b', 't'),
      persist: () => {},
      result,
    });
    assert.equal(updateCalls.length, 1);
    const sentCells = updateCalls[0].rows[0].cellValuesByColumnId;
    assert.ok('fldTD' in sentCells, 'scalar text should be sent');
    assert.ok(!('fldColD' in sentCells), 'multiCollaborator array must NOT be sent to updateRecords');
    assert.ok(
      result.warnings.some((w) => w.code === 'RECORD_ARRAY_UPDATE_DEFERRED'),
      'expected RECORD_ARRAY_UPDATE_DEFERRED warning for the collaborator array',
    );
  });

  it('does not warn RECORD_ARRAY_UPDATE_DEFERRED when the multiSelect cell is already converged on dest', async () => {
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldMS: { destFld: 'fldMSD', choices: { c1: 'c1D', c2: 'c2D' } },
      },
      records: { recS1: 'recD1' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldMS', type: 'multiSelect' },
        ],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldT: 'hello', fldMS: ['c1', 'c2'] } }],
      }],
    };
    // Dest record already holds the remapped choice ids (order-insensitive) → converged.
    const destSnapshot = {
      tables: [{
        id: 'tblD', name: 'T', fields: [],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldMSD: ['c2D', 'c1D'] } }],
      }],
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3c', 't'),
      persist: () => {},
      result,
    });
    assert.equal(
      result.warnings.filter((w) => w.code === 'RECORD_ARRAY_UPDATE_DEFERRED').length, 0,
      'converged multiSelect must not emit a deferral warning',
    );
    // A truly diverged multiSelect must still warn (pinned by the earlier test with no dest record).
  });

  it('propagates a cell cleared on source as an explicit null under source-wins', async () => {
    // readQueries omits empty cells: a cleared source cell arrives as an ABSENT key.
    // Under source-wins the clear must reach the dest, or the stale value lives forever.
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldN: { destFld: 'fldND', choices: {} },
      },
      records: { recS1: 'recD1' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldN', type: 'number' },
          { id: 'fldF', type: 'formula' }, // computed — must never be cleared
        ],
        // fldT was cleared on source (absent key); fldN still has a value.
        records: [{ id: 'recS1', cellValuesByColumnId: { fldN: 42 } }],
      }],
    };
    const destSnapshot = {
      tables: [{
        id: 'tblD', name: 'T', fields: [],
        records: [{
          id: 'recD1',
          // dest still holds the stale text value; also holds a dest-only unmapped cell
          // and a computed cell — both must remain untouched.
          cellValuesByColumnId: { fldTD: 'stale', fldND: 41, fldX: 'dest-only', fldFD: 'computed' },
        }],
      }],
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3d', 't'),
      persist: () => {},
      result,
    });
    assert.equal(updateCalls.length, 1);
    const sentCells = updateCalls[0].rows[0].cellValuesByColumnId;
    assert.equal(sentCells.fldTD, null, 'cleared source cell must be written as explicit null');
    assert.equal(sentCells.fldND, 42, 'changed scalar still sent');
    assert.ok(!('fldX' in sentCells), 'unmapped dest-only field must not be touched');
    assert.ok(!('fldFD' in sentCells), 'computed field must never be cleared');
  });

  it('does not emit clears when the dest cell is already empty or the dest record is unknown', async () => {
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldT: { destFld: 'fldTD', choices: {} }, fldN: { destFld: 'fldND', choices: {} } },
      records: { recS1: 'recD1', recS2: 'recD2' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldT', type: 'text' }, { id: 'fldN', type: 'number' }],
        records: [
          { id: 'recS1', cellValuesByColumnId: { fldN: 7 } },  // fldT absent; dest fldTD also empty
          { id: 'recS2', cellValuesByColumnId: { fldN: 8 } },  // dest record missing from snapshot
        ],
      }],
    };
    const destSnapshot = {
      tables: [{
        id: 'tblD', name: 'T', fields: [],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldND: 6 } }], // no fldTD value; recD2 absent
      }],
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3e', 't'),
      persist: () => {},
      result,
    });
    assert.equal(updateCalls.length, 1);
    for (const row of updateCalls[0].rows) {
      assert.ok(!('fldTD' in row.cellValuesByColumnId), `no null for empty/unknown dest cell (row ${row.rowId})`);
    }
  });

  it('never clears (or writes) anything under conflicts=dest-wins', async () => {
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldT: { destFld: 'fldTD', choices: {} } },
      records: { recS1: 'recD1' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldT', type: 'text' }],
        records: [{ id: 'recS1', cellValuesByColumnId: {} }], // cleared on source
      }],
    };
    const destSnapshot = {
      tables: [{
        id: 'tblD', name: 'T', fields: [],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldTD: 'dest edit' } }],
      }],
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3f', 't'),
      persist: () => {},
      result,
      policy: 'preserve', // conflicts=dest-wins
    });
    assert.equal(updateCalls.length, 0, 'dest-wins must not send any update (no clears)');
  });

  it('does not send an update row whose cell map is empty (no spurious RECORD_UPDATE_FAILED)', async () => {
    // A mapped record whose writable cells produce nothing to write (e.g. all data lives in
    // link/attachment fields, or src+dest are both empty) must be skipped — client.updateRecords
    // rejects an empty cellValuesByColumnId per row, which misreported healthy records as failed.
    const updateCalls = [];
    const client = {
      createRecords: async () => ({ created: [], failed: [] }),
      updateRecords: async (appId, tableId, rows) => {
        updateCalls.push({ rows });
        return { updated: rows.map((r) => r.rowId), failed: [] };
      },
    };
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldT: { destFld: 'fldTD', choices: {} },
        fldL: { destFld: 'fldLD', choices: {} },
      },
      records: { recS1: 'recD1' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [
          { id: 'fldT', type: 'text' },
          { id: 'fldL', type: 'multipleRecordLinks' }, // Pass 2 owns this — never in the update payload
        ],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recS9'] } }], // only a link cell
      }],
    };
    const destSnapshot = {
      tables: [{
        id: 'tblD', name: 'T', fields: [],
        records: [{ id: 'recD1', cellValuesByColumnId: {} }], // dest text also empty → no clear either
      }],
    };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: createLimiter({ rps: 1000, sleep: async () => {} }),
      journal: newJournal('p3g', 't'),
      persist: () => {},
      result,
    });
    assert.equal(updateCalls.length, 0, 'updateRecords must not be called with an empty cell map');
    assert.equal(result.failed, 0, 'no spurious failure for a healthy record');
    assert.equal(result.skipped, 1, 'empty-update record counted as skipped');
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

// ──────────────────────────────────────────────────────────────────────────────
// applyRecordsPass2
// ──────────────────────────────────────────────────────────────────────────────

describe('records.applyRecordsPass2', () => {
  function makeLimiter() {
    return createLimiter({ rps: 1000, sleep: async () => {} });
  }

  it('adds resolved link items with correct foreignRowId and displayName', async () => {
    const addCalls = [];
    const client = {
      addLinkItems: async (appId, rowId, columnId, items) => {
        addCalls.push({ appId, rowId, columnId, items });
        return { ok: true, added: items.length };
      },
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recS1: 'recD1', recSTarget: 'recDTarget' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recSTarget'] } }],
      }],
    };

    // dest row's link cell is currently empty → nothing to dedup against
    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblD', name: 'T',
        fields: [{ id: 'fldLD', type: 'multipleRecordLinks' }],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldLD: [] } }],
      }],
    };

    const destDisplayNames = new Map([['recDTarget', 'Target Row']]);
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames,
      limiter: makeLimiter(),
      journal: newJournal('p2-1', 't'),
      persist: () => {},
      result,
    });

    assert.equal(addCalls.length, 1, 'addLinkItems should be called once');
    assert.equal(addCalls[0].rowId, 'recD1');
    assert.equal(addCalls[0].columnId, 'fldLD');
    assert.deepEqual(addCalls[0].items, [{ foreignRowId: 'recDTarget', foreignRowDisplayName: 'Target Row' }]);
    assert.equal(result.warnings.length, 0, 'no warnings for fully-resolved links');
  });

  it('emits RECORD_LINK_UNRESOLVED warning for unresolved src ids, does not abort record', async () => {
    const addCalls = [];
    const client = {
      addLinkItems: async (appId, rowId, columnId, items) => {
        addCalls.push({ rowId, columnId, items });
        return { ok: true, added: items.length };
      },
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recS1: 'recD1', recSTarget: 'recDTarget' }, // recX has no mapping
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recSTarget', 'recX'] } }],
      }],
    };

    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblD', name: 'T',
        fields: [{ id: 'fldLD', type: 'multipleRecordLinks' }],
        records: [{ id: 'recD1', cellValuesByColumnId: {} }],
      }],
    };

    const destDisplayNames = new Map([['recDTarget', 'Target']]);
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames,
      limiter: makeLimiter(),
      journal: newJournal('p2-2', 't'),
      persist: () => {},
      result,
    });

    // The resolved link should still be added (record not aborted)
    assert.equal(addCalls.length, 1, 'addLinkItems still called for resolved items');
    assert.deepEqual(addCalls[0].items, [{ foreignRowId: 'recDTarget', foreignRowDisplayName: 'Target' }]);

    // One RECORD_LINK_UNRESOLVED warning for the unresolved recX
    const unresolvedWarns = result.warnings.filter((w) => w.code === 'RECORD_LINK_UNRESOLVED');
    assert.equal(unresolvedWarns.length, 1, 'expected exactly one RECORD_LINK_UNRESOLVED warning');
    assert.ok(unresolvedWarns[0].message.includes('recX') || unresolvedWarns[0].message.includes('1'), 'warning should mention unresolved id or count');
  });

  it('does not re-add links already present in destSnapshot (idempotency)', async () => {
    const addCalls = [];
    const client = {
      addLinkItems: async (appId, rowId, columnId, items) => {
        addCalls.push({ rowId, columnId, items });
        return { ok: true, added: items.length };
      },
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recS1: 'recD1', recSTarget: 'recDTarget' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recSTarget'] } }],
      }],
    };

    // dest row already has recDTarget linked → must NOT re-add
    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblD', name: 'T',
        fields: [{ id: 'fldLD', type: 'multipleRecordLinks' }],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldLD: ['recDTarget'] } }],
      }],
    };

    const destDisplayNames = new Map([['recDTarget', 'Target']]);
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames,
      limiter: makeLimiter(),
      journal: newJournal('p2-3', 't'),
      persist: () => {},
      result,
    });

    // addLinkItems must NOT be called (nothing new to add)
    assert.equal(addCalls.length, 0, 'addLinkItems must not be called when link already present');
    assert.equal(result.warnings.length, 0);
  });

  it('handles object-shaped dest link cell elements (dedup on foreignRowId)', async () => {
    const addCalls = [];
    const client = {
      addLinkItems: async (appId, rowId, columnId, items) => {
        addCalls.push({ rowId, columnId, items });
        return { ok: true, added: items.length };
      },
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recS1: 'recD1', recSTarget: 'recDTarget' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recSTarget'] } }],
      }],
    };

    // dest row's link cell is OBJECT-shaped (API returned objects, not strings)
    // Current link is already { foreignRowId: 'recDTarget' } → must NOT re-add
    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblD', name: 'T',
        fields: [{ id: 'fldLD', type: 'multipleRecordLinks' }],
        records: [{ id: 'recD1', cellValuesByColumnId: { fldLD: [{ foreignRowId: 'recDTarget' }] } }],
      }],
    };

    const destDisplayNames = new Map([['recDTarget', 'Target']]);
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames,
      limiter: makeLimiter(),
      journal: newJournal('p2-3b', 't'),
      persist: () => {},
      result,
    });

    // addLinkItems must NOT be called (link already present in object form)
    assert.equal(addCalls.length, 0, 'addLinkItems must not be called when link already present (object shape)');
    assert.equal(result.warnings.length, 0);
  });

  it('skips src records not in idmap.records', async () => {
    const addCalls = [];
    const client = {
      addLinkItems: async (appId, rowId, columnId, items) => {
        addCalls.push({ rowId, items });
        return { ok: true, added: items.length };
      },
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: {}, // recS1 has no dest mapping
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recS2'] } }],
      }],
    };

    const destSnapshot = { baseId: 'appDest', tables: [{ id: 'tblD', records: [] }] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames: new Map(),
      limiter: makeLimiter(),
      journal: newJournal('p2-4', 't'),
      persist: () => {},
      result,
    });

    assert.equal(addCalls.length, 0, 'no addLinkItems when src row not mapped');
  });

  it('continues on addLinkItems failure and emits RECORD_LINK_FAILED warning', async () => {
    const client = {
      addLinkItems: async () => ({ ok: false, error: 'network error' }),
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recS1: 'recD1', recSTarget: 'recDTarget' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'multipleRecordLinks' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recSTarget'] } }],
      }],
    };

    const destSnapshot = {
      baseId: 'appDest',
      tables: [{
        id: 'tblD', name: 'T',
        fields: [{ id: 'fldLD', type: 'multipleRecordLinks' }],
        records: [{ id: 'recD1', cellValuesByColumnId: {} }],
      }],
    };

    const destDisplayNames = new Map([['recDTarget', 'Target']]);
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] };

    // Must not throw
    await applyRecordsPass2({
      client, srcSnapshot, destSnapshot, idmap, destDisplayNames,
      limiter: makeLimiter(),
      journal: newJournal('p2-5', 't'),
      persist: () => {},
      result,
    });

    const failWarns = result.warnings.filter((w) => w.code === 'RECORD_LINK_FAILED');
    assert.equal(failWarns.length, 1, 'expected RECORD_LINK_FAILED warning');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// applyAttachments
// ──────────────────────────────────────────────────────────────────────────────

describe('records.applyAttachments', () => {
  function makeLimiter() {
    return createLimiter({ rps: 1000, sleep: async () => {} });
  }

  function makeFixtures({ uploadResult = { ok: true, attachmentId: 'att1' } } = {}) {
    const uploadCalls = [];
    const client = {
      uploadAttachment: async (appId, rowId, columnId, payload) => {
        uploadCalls.push({ appId, rowId, columnId, payload });
        return uploadResult;
      },
    };

    const fetchCalls = [];
    const fetchBytes = async (url) => {
      fetchCalls.push(url);
      return { bytes: Buffer.from('fake-image-data'), contentType: 'image/png' };
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {
        fldAtt: { destFld: 'fldAttD' },
      },
      records: { recS1: 'recD1' },
      // attachments intentionally omitted to test initialization
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldAtt', type: 'multipleAttachments' }],
        records: [{
          id: 'recS1',
          cellValuesByColumnId: {
            fldAtt: [{ id: 'attSrc1', url: 'https://example.com/image.png', filename: 'image.png', size: 1024, type: 'image/png' }],
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDest' };

    const result = { created: 0, updated: 0, skipped: 0, failed: 0, attachmentsUploaded: 0, warnings: [] };

    return { client, fetchBytes, fetchCalls, uploadCalls, idmap, srcSnapshot, destSnapshot, result };
  }

  it('downloads and uploads an attachment with correct destRow/destFld/filename', async () => {
    const { client, fetchBytes, fetchCalls, uploadCalls, idmap, srcSnapshot, destSnapshot, result } = makeFixtures();

    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-1', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    assert.equal(fetchCalls.length, 1, 'fetchBytes called once for the attachment URL');
    assert.equal(fetchCalls[0], 'https://example.com/image.png');

    assert.equal(uploadCalls.length, 1, 'uploadAttachment called once');
    assert.equal(uploadCalls[0].appId, 'appDest');
    assert.equal(uploadCalls[0].rowId, 'recD1');
    assert.equal(uploadCalls[0].columnId, 'fldAttD');
    assert.equal(uploadCalls[0].payload.filename, 'image.png');
    assert.ok(uploadCalls[0].payload.bytes, 'bytes must be provided');

    // dedupe key should be set after success
    assert.equal(idmap.attachments['image.png|1024'], true);
  });

  it('deduplicates: same filename|size not re-uploaded on second applyAttachments call', async () => {
    const { client, fetchBytes, uploadCalls, idmap, srcSnapshot, destSnapshot, result } = makeFixtures();

    // First call
    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-2a', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    assert.equal(uploadCalls.length, 1, 'first call uploads once');

    // Second call — idmap.attachments is preserved, same attachment must be skipped
    const result2 = { created: 0, updated: 0, skipped: 0, failed: 0, attachmentsUploaded: 0, warnings: [] };
    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-2b', 't'),
      persist: () => {},
      result: result2,
      fetchBytes,
    });

    assert.equal(uploadCalls.length, 1, 'second call must NOT re-upload (dedupe by filename|size)');
  });

  it('ok:false upload → ATTACHMENT_FAILED warning, no throw, record continues', async () => {
    const { client, fetchBytes, uploadCalls, idmap, srcSnapshot, destSnapshot, result } = makeFixtures({
      uploadResult: { ok: false, error: 'upload quota exceeded' },
    });

    // Must not throw
    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-3', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    assert.equal(uploadCalls.length, 1, 'uploadAttachment was still called');

    const failWarns = result.warnings.filter((w) => w.code === 'ATTACHMENT_FAILED');
    assert.equal(failWarns.length, 1, 'expected exactly one ATTACHMENT_FAILED warning');
    assert.ok(failWarns[0].message.includes('image.png'), 'warning should mention the filename');

    // dedupe key must NOT be set on failure
    assert.equal(idmap.attachments['image.png|1024'], undefined);
  });

  it('fetchBytes error → ATTACHMENT_FAILED warning, no throw, continues to next attachment', async () => {
    const uploadCalls = [];
    const client = {
      uploadAttachment: async (appId, rowId, columnId, payload) => {
        uploadCalls.push(payload.filename);
        return { ok: true, attachmentId: 'att99' };
      },
    };

    // fetchBytes throws on first URL, succeeds on second
    let fetchCount = 0;
    const fetchBytes = async (url) => {
      fetchCount++;
      if (fetchCount === 1) throw new Error('network timeout');
      return { bytes: Buffer.from('ok'), contentType: 'image/jpeg' };
    };

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldAtt: { destFld: 'fldAttD' } },
      records: { recS1: 'recD1' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldAtt', type: 'multipleAttachments' }],
        records: [{
          id: 'recS1',
          cellValuesByColumnId: {
            fldAtt: [
              { id: 'a1', url: 'https://src/a.png', filename: 'a.png', size: 100, type: 'image/png' },
              { id: 'a2', url: 'https://src/b.jpg', filename: 'b.jpg', size: 200, type: 'image/jpeg' },
            ],
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDest' };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, attachmentsUploaded: 0, warnings: [] };

    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-4', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    // First attachment failed (fetch threw), second should still be uploaded
    const failWarns = result.warnings.filter((w) => w.code === 'ATTACHMENT_FAILED');
    assert.equal(failWarns.length, 1, 'one warning for the failed fetch');
    assert.ok(failWarns[0].message.includes('a.png'), 'warning should mention a.png');
    assert.equal(uploadCalls.length, 1, 'second attachment (b.jpg) should still be uploaded');
    assert.equal(uploadCalls[0], 'b.jpg');
  });

  it('skips unmatched tables and fields without a destFld mapping', async () => {
    const uploadCalls = [];
    const client = {
      uploadAttachment: async () => { uploadCalls.push(true); return { ok: true }; },
    };
    const fetchBytes = async () => ({ bytes: Buffer.from('x'), contentType: 'text/plain' });

    const idmap = {
      tables: { tblS: 'tblD' },
      fields: {}, // fldAtt not mapped
      records: { recS1: 'recD1' },
    };

    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldAtt', type: 'multipleAttachments' }],
        records: [{
          id: 'recS1',
          cellValuesByColumnId: {
            fldAtt: [{ id: 'a1', url: 'https://src/x.txt', filename: 'x.txt', size: 5, type: 'text/plain' }],
          },
        }],
      }],
    };

    const destSnapshot = { baseId: 'appDest' };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, attachmentsUploaded: 0, warnings: [] };

    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('att-5', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    assert.equal(uploadCalls.length, 0, 'no upload when field is not mapped');
  });
});
