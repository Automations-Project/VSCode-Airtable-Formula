/**
 * test-records-resume-created.test.js
 *
 * A RESUMED records job (same planId after a crash) must still treat rows created by the
 * crashed run as sync-created: Pass 2 (links) / Pass 3 (attachments) key their dest-wins
 * protection on the created-this-plan dest ids. On resume those rows are already in
 * idmap.records, take Pass 1's dest-wins skip, and never re-enter the run-local set — so the
 * set is persisted in the records journal (journal.createdDestIds) and seeded from it on
 * resume of the SAME planId. Cross-plan behavior is unchanged (a new plan gets a new journal).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRecords } from '../../src/sync/records.js';

const noLimiter = { run: (fn) => fn() };

function fixtures() {
  const linkCalls = [];
  const pastes = [];
  const client = {
    async createRecords(appId, tableId, rows) {
      return { created: rows.map((r) => ({ rowId: 'recNew_' + r.sourceKey, sourceKey: r.sourceKey })), failed: [] };
    },
    async updateRecords(appId, tableId, rows) { return { updated: rows, failed: [] }; },
    async addLinkItems(appId, rowId, fldId, items) { linkCalls.push({ rowId, fldId }); return { ok: true, added: items.length }; },
    async createDataTransferPolicy() { return { policy: 'signed' }; },
    async pasteAttachmentsCrossBase(appId, tableId, payload) { pastes.push(payload); return { pastedRowIds: payload.targetRowIds }; },
  };
  // recS1 was CREATED by the crashed run (already mapped → recD1, present on dest with empty
  // link/attachment cells). recSTarget is its link target (pre-existing, mapped).
  const srcSnapshot = {
    baseId: 'appS',
    tables: [{
      id: 'tS', name: 'Games', primaryFieldId: 'sN',
      fields: [
        { id: 'sN', name: 'Name', type: 'text' },
        { id: 'sL', name: 'Link', type: 'foreignKey', typeOptions: { foreignTableId: 'tS' } },
        { id: 'sA', name: 'Att', type: 'multipleAttachments' },
      ],
      views: [],
      records: [
        {
          id: 'recS1',
          cellValuesByColumnId: {
            sN: 'one',
            sL: ['recSTarget'],
            sA: [{ id: 'att1', url: 'https://src/a.png', filename: 'a.png', size: 10, type: 'image/png' }],
          },
        },
        { id: 'recSTarget', cellValuesByColumnId: { sN: 'target' } },
      ],
    }],
  };
  const destSnapshot = {
    baseId: 'appD',
    tables: [{
      id: 'tD', name: 'Games', views: [{ id: 'viwD' }], fields: [],
      records: [
        { id: 'recD1', cellValuesByColumnId: { dN: 'one' } },      // created by the crashed run
        { id: 'recDTarget', cellValuesByColumnId: { dN: 'target' } },
      ],
    }],
  };
  const idmap = {
    tables: { tS: 'tD' },
    fields: { sN: { destFld: 'dN', choices: {} }, sL: { destFld: 'dL' }, sA: { destFld: 'dA' } },
    records: { recS1: 'recD1', recSTarget: 'recDTarget' },
  };
  return { linkCalls, pastes, client, srcSnapshot, destSnapshot, idmap };
}

describe('runRecords — resumed job keeps created-this-plan rows sync-created (dest-wins)', () => {
  it('seeds createdDestIds from journal.createdDestIds so Pass 2/3 still write to crashed-run rows under preserve', async () => {
    const { linkCalls, pastes, client, srcSnapshot, destSnapshot, idmap } = fixtures();
    // Journal persisted by the crashed run of the SAME planId: recD1 was created this plan.
    const journal = { planId: 'plnR', startedAt: 't', actions: [], createdDestIds: ['recD1'] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'preserve',
      limiter: noLimiter, journal, persist: () => {}, result,
    });
    assert.ok(linkCalls.some((c) => c.rowId === 'recD1'), 'Pass 2 writes links to the crashed-run-created row');
    assert.ok(pastes.some((p) => p.targetRowIds.includes('recD1')), 'Pass 3 pastes attachments to the crashed-run-created row');
  });

  it('cross-plan unchanged: a journal without createdDestIds still protects pre-existing rows under preserve', async () => {
    const { linkCalls, pastes, client, srcSnapshot, destSnapshot, idmap } = fixtures();
    const journal = { planId: 'plnNew', startedAt: 't', actions: [] };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'preserve',
      limiter: noLimiter, journal, persist: () => {}, result,
    });
    assert.equal(linkCalls.length, 0, 'pre-existing mapped rows still protected under preserve');
    assert.equal(pastes.length, 0, 'no attachment paste over a pre-existing mapped row');
  });

  it('persists created dest ids into the journal on every per-chunk persist (crash-durable)', async () => {
    const { client, srcSnapshot, destSnapshot, idmap } = fixtures();
    delete idmap.records.recS1; // recS1 not yet mapped → Pass 1 creates it this run
    const snapshots = [];
    const journal = { planId: 'plnFresh', startedAt: 't', actions: [] };
    const persist = (m, j) => { snapshots.push((j.createdDestIds || []).slice()); };
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0, warnings: [] };
    await runRecords({
      client, srcSnapshot, destSnapshot, idmap,
      policy: 'preserve',
      limiter: noLimiter, journal, persist, result,
    });
    assert.ok(snapshots.some((s) => s.includes('recNew_recS1')), 'a persist during the run captured the created id');
    assert.ok(journal.createdDestIds.includes('recNew_recS1'), 'journal carries the created id after the run');
  });
});
