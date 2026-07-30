import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecordsPass1, applyRecordsPass2, orderTablesByLinkDeps } from '../../src/sync/records.js';
import { newJournal } from '../../src/sync/journal.js';
import { createLimiter } from '../../src/sync/ratelimit.js';

const fastLimiter = () => createLimiter({ rps: 1000, sleep: async () => {} });
const newResult = () => ({ created: 0, updated: 0, skipped: 0, failed: 0, warnings: [] });

// ── orderTablesByLinkDeps ────────────────────────────────────────────────────
describe('orderTablesByLinkDeps', () => {
  it('orders link TARGET tables before the tables that depend on them', () => {
    // tblA links to tblB (foreignTableId=tblB) → tblB must come first
    const tables = [
      { id: 'tblA', fields: [{ id: 'fA', type: 'foreignKey', typeOptions: { foreignTableId: 'tblB' } }] },
      { id: 'tblB', fields: [{ id: 'fB', type: 'text' }] },
    ];
    const idmap = { tables: { tblA: 'x', tblB: 'y' }, fields: { fA: { destFld: 'd' } } };
    const ordered = orderTablesByLinkDeps(tables, idmap).map((t) => t.id);
    assert.deepEqual(ordered, ['tblB', 'tblA']);
  });

  it('breaks cycles deterministically (original order) without throwing or dropping tables', () => {
    const tables = [
      { id: 'tblA', fields: [{ id: 'fA', type: 'foreignKey', typeOptions: { foreignTableId: 'tblB' } }] },
      { id: 'tblB', fields: [{ id: 'fB', type: 'foreignKey', typeOptions: { foreignTableId: 'tblA' } }] },
    ];
    const idmap = { tables: { tblA: 'x', tblB: 'y' }, fields: { fA: { destFld: 'd1' }, fB: { destFld: 'd2' } } };
    const ordered = orderTablesByLinkDeps(tables, idmap).map((t) => t.id);
    assert.equal(ordered.length, 2);
    assert.ok(ordered.includes('tblA') && ordered.includes('tblB'));
  });

  it('ignores self-links and unmapped link fields', () => {
    const tables = [
      { id: 'tblA', fields: [{ id: 'fSelf', type: 'foreignKey', typeOptions: { foreignTableId: 'tblA' } }] },
      { id: 'tblB', fields: [{ id: 'fUnmapped', type: 'foreignKey', typeOptions: { foreignTableId: 'tblA' } }] },
    ];
    // fUnmapped has no idmap.fields entry → no dependency edge
    const idmap = { tables: { tblA: 'x', tblB: 'y' }, fields: {} };
    const ordered = orderTablesByLinkDeps(tables, idmap).map((t) => t.id);
    assert.deepEqual(ordered, ['tblA', 'tblB']); // stable original order
  });
});

// ── inner-POST pacing: each create POST routes through the phase-local limiter (gate) ────────
describe('records phase pacing (gate)', () => {
  it('routes each inner create POST through the records limiter, not the shared auth queue', async () => {
    let gateRuns = 0;
    const limiterSpy = { run: (fn) => { gateRuns++; return fn(); } }; // stands in for createLimiter
    const client = {
      // simulate the real createRecords: one gated POST per row
      createRecords: async (appId, tableId, rows, opts) => {
        const created = [];
        for (const r of rows) {
          await opts.gate(() => Promise.resolve({ ok: true })); // inner per-row POST through the gate
          created.push({ rowId: 'recD_' + r.sourceKey, sourceKey: r.sourceKey });
        }
        return { created, failed: [] };
      },
      updateRecords: async () => ({ updated: [], failed: [] }),
    };
    const idmap = { tables: { tblS: 'tblD' }, fields: { fldT: { destFld: 'fldTD', choices: {} } }, records: {} };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T', fields: [{ id: 'fldT', type: 'text' }],
        records: [1, 2, 3].map((n) => ({ id: 'recS' + n, cellValuesByColumnId: { fldT: 'v' + n } })),
      }],
    };
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tblD', name: 'T', fields: [], records: [] }] };
    const result = newResult();
    await applyRecordsPass1({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: limiterSpy, journal: newJournal('p', 't'), persist: () => {}, result,
    });
    assert.equal(result.created, 3);
    assert.equal(gateRuns, 3, 'one limiter slot per inner create POST (paced), not one per chunk');
  });
});

// ── Pass 1 folds resolvable links into the create payload ────────────────────
describe('applyRecordsPass1 — fold resolvable links into create', () => {
  function captureClient(captured, { failOnLink = false } = {}) {
    return {
      createRecords: async (appId, tableId, rows) => {
        const created = [];
        const failed = [];
        rows.forEach((r, i) => {
          const hasLink = Object.values(r.cellValuesByColumnId || {}).some(
            (v) => Array.isArray(v) && v.some((e) => e && typeof e === 'object' && e.foreignRowId),
          );
          captured.push({ tableId, cells: r.cellValuesByColumnId, sourceKey: r.sourceKey });
          if (failOnLink && hasLink) {
            failed.push({ sourceKey: r.sourceKey, error: 'simulated 422: link cell rejected' });
          } else {
            created.push({ rowId: 'recD_' + r.sourceKey, sourceKey: r.sourceKey });
          }
        });
        return { created, failed };
      },
      updateRecords: async () => ({ updated: [], failed: [] }),
      addLinkItems: async () => ({ ok: true, added: 1 }),
    };
  }

  it('writes a resolvable link as [{foreignRowId}] in the create payload', async () => {
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldT: { destFld: 'fldTD', choices: {} }, fldL: { destFld: 'fldLD' } },
      records: { recTarget: 'recTargetD' }, // target already created (earlier table)
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldT', type: 'text' }, { id: 'fldL', type: 'foreignKey', typeOptions: { foreignTableId: 'tblOther' } }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldT: 'hi', fldL: ['recTarget'] } }],
      }],
    };
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tblD', name: 'T', fields: [], records: [] }] };
    const captured = [];
    const result = newResult();
    await applyRecordsPass1({
      client: captureClient(captured), srcSnapshot, destSnapshot, idmap,
      limiter: fastLimiter(), journal: newJournal('p', 't'), persist: () => {}, result,
    });
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].cells.fldTD, 'hi');
    assert.deepEqual(captured[0].cells.fldLD, [{ foreignRowId: 'recTargetD', foreignRowDisplayName: '' }]);
    assert.equal(result.created, 1);
  });

  it('does NOT fold an unresolvable link (target not yet mapped) — leaves it for Pass 2', async () => {
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: {}, // target NOT mapped
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'foreignKey', typeOptions: { foreignTableId: 'tblOther' } }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recMissing'] } }],
      }],
    };
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tblD', name: 'T', fields: [], records: [] }] };
    const captured = [];
    const result = newResult();
    await applyRecordsPass1({
      client: captureClient(captured), srcSnapshot, destSnapshot, idmap,
      limiter: fastLimiter(), journal: newJournal('p', 't'), persist: () => {}, result,
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].cells.fldLD, undefined); // not folded
  });

  it('mirrors folded links into destSnapshot so Pass 2 does not re-add them', async () => {
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recTarget: 'recTargetD' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'foreignKey', typeOptions: { foreignTableId: 'tblOther' } }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recTarget'] } }],
      }],
    };
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tblD', name: 'T', fields: [], records: [] }] };
    const captured = [];
    const result = newResult();
    await applyRecordsPass1({
      client: captureClient(captured), srcSnapshot, destSnapshot, idmap,
      limiter: fastLimiter(), journal: newJournal('p', 't'), persist: () => {}, result,
    });
    // Pass 2 should now see the folded link in destSnapshot and add NOTHING
    const addCalls = [];
    const client2 = {
      addLinkItems: async (appId, rowId, columnId, items) => { addCalls.push({ rowId, columnId, items }); return { ok: true, added: items.length }; },
    };
    await applyRecordsPass2({
      client: client2, srcSnapshot, destSnapshot, idmap,
      destDisplayNames: new Map(), limiter: fastLimiter(), journal: newJournal('p', 't'), persist: () => {}, result,
    });
    assert.equal(addCalls.length, 0, 'Pass 2 must not re-add a link already folded in Pass 1');
  });

  it('SAFETY: if create rejects the link cell, retries without links, flips fold off, warns', async () => {
    const idmap = {
      tables: { tblS: 'tblD' },
      fields: { fldL: { destFld: 'fldLD' } },
      records: { recTarget: 'recTargetD' },
    };
    const srcSnapshot = {
      tables: [{
        id: 'tblS', name: 'T',
        fields: [{ id: 'fldL', type: 'foreignKey', typeOptions: { foreignTableId: 'tblOther' } }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldL: ['recTarget'] } }],
      }],
    };
    const destSnapshot = { baseId: 'appD', tables: [{ id: 'tblD', name: 'T', fields: [], records: [] }] };
    const captured = [];
    const result = newResult();
    await applyRecordsPass1({
      client: captureClient(captured, { failOnLink: true }), srcSnapshot, destSnapshot, idmap,
      limiter: fastLimiter(), journal: newJournal('p', 't'), persist: () => {}, result,
    });
    // First attempt (with link) failed, retry (without link) succeeded → row created
    assert.equal(idmap.records.recS1, 'recD_recS1');
    assert.equal(result.created, 1);
    assert.equal(result.failed, 0);
    assert.ok(result.warnings.some((w) => w.code === 'FOLD_LINKS_DISABLED'));
    // retry payload had NO link cell
    const retry = captured[captured.length - 1];
    assert.equal(retry.cells.fldLD, undefined);
  });
});
