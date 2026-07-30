// Regression tests: mode=plan / mode=diff must never wipe (and must actually SEE) the
// persisted idmap.records / idmap.attachments identity maps.
//
// Audit findings:
//  - plan() saved matchByName(src,dest) verbatim — matchByName returns only
//    {tables, fields, views}, so saveIdmap atomically erased records/attachments,
//    defeating the C1 duplication guard on the next apply.
//  - diff()/plan() compared views with a records-less idmap, so a record-referencing
//    view filter that a prior sync correctly remapped onto the dest re-flagged as
//    `filters` drift on every run (converged permanently unreachable).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { plan as computeSyncPlan, diff as computeSyncDiff } from '../../src/sync/index.js';
import { saveIdmap, loadIdmap } from '../../src/sync/idmap.js';

const SRC = 'appSSSSSSSSSSSSSS';
const DEST = 'appDDDDDDDDDDDDDD';

const RECORDS = { recSRC00000000001: 'recDEST0000000001' };
const ATTACHMENTS = { 'contract.pdf|12345': true };

function schemaOnlyClient() {
  const mk = (tblId, fldId) => ({ data: { tableSchemas: [{
    id: tblId, name: 'T', primaryColumnId: fldId,
    columns: [{ id: fldId, name: 'Name', type: 'text' }],
  }] } });
  return { getApplicationData: async (appId) => (appId === SRC ? mk('tblS1', 'fldS1') : mk('tblD1', 'fldD1')) };
}

describe('sync index.plan — persisted idmap.records/attachments survive re-plan', () => {
  it('plan() twice preserves records + attachments verbatim while refreshing schema maps', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'plan-idmap-'));
    // A prior sync cycle persisted a populated record/attachment identity map.
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { ...RECORDS }, attachments: { ...ATTACHMENTS } });

    const client = schemaOnlyClient();

    await computeSyncPlan({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnKEEP1' });
    let m = loadIdmap(SRC, DEST);
    assert.deepEqual(m.records, RECORDS, 'idmap.records must survive plan #1');
    assert.deepEqual(m.attachments, ATTACHMENTS, 'idmap.attachments must survive plan #1');
    assert.equal(m.tables.tblS1, 'tblD1', 'schema-level table map must be refreshed by matchByName');
    assert.equal(m.fields.fldS1 && m.fields.fldS1.destFld, 'fldD1', 'schema-level field map must be refreshed');

    // Plan a second time (fresh planId — the routine re-sync workflow).
    await computeSyncPlan({ client, sourceBaseId: SRC, destBaseId: DEST, planId: 'plnKEEP2' });
    m = loadIdmap(SRC, DEST);
    assert.deepEqual(m.records, RECORDS, 'idmap.records must survive plan #2');
    assert.deepEqual(m.attachments, ATTACHMENTS, 'idmap.attachments must survive plan #2');
  });

  it('diff() does not touch idmap.json on disk', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'diff-idmap-'));
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { ...RECORDS }, attachments: { ...ATTACHMENTS } });
    await computeSyncDiff({ client: schemaOnlyClient(), sourceBaseId: SRC, destBaseId: DEST, diffId: 'difKEEP' });
    const m = loadIdmap(SRC, DEST);
    assert.deepEqual(m.records, RECORDS, 'diff() must not wipe idmap.records');
    assert.deepEqual(m.attachments, ATTACHMENTS, 'diff() must not wipe idmap.attachments');
  });
});

describe('sync index.diff/plan — record-referencing view filters use persisted idmap.records', () => {
  // Both bases hold table T with view "Active" filtering on a record id. The dest filter is
  // EXACTLY what a prior sync wrote (source rec id remapped via idmap.records). With the
  // persisted map merged into the compare idmap, the source side canonicalizes to the dest id
  // → no `filters` drift. Without it, the source leaf is stripped while the dest keeps its
  // leaf → permanent false drift.
  function viewFilterClient() {
    const mk = (tblId, fldId, viwId) => ({ data: { tableSchemas: [{
      id: tblId, name: 'T', primaryColumnId: fldId,
      columns: [{ id: fldId, name: 'Name', type: 'text' }],
      views: [{ id: viwId, name: 'Active', type: 'grid' }],
    }] } });
    const cfg = {
      viwS1: { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldS1', operator: 'contains', value: 'recSRC00000000001' }] } },
      viwD1: { filters: { conjunction: 'and', filterSet: [{ columnId: 'fldD1', operator: 'contains', value: 'recDEST0000000001' }] } },
    };
    return {
      getApplicationData: async (appId) => (appId === SRC ? mk('tblS1', 'fldS1', 'viwS1') : mk('tblD1', 'fldD1', 'viwD1')),
      getView: async (appId, viewId) => ({ ...cfg[viewId] }),
    };
  }

  it('diff() reports zero drift for a correctly-synced record filter', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'diff-recref-'));
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { ...RECORDS }, attachments: {} });
    const out = await computeSyncDiff({ client: viewFilterClient(), sourceBaseId: SRC, destBaseId: DEST, diffId: 'difREC' });
    assert.equal(out.machine.summary.drift, 0,
      `expected no drift for an already-remapped record filter, got: ${JSON.stringify(out.machine.driftSample)}`);
    assert.equal(out.machine.converged, true, 'diff must report converged');
  });

  it('plan() does not re-emit applyViewConfig for a correctly-synced record filter', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'plan-recref-'));
    saveIdmap(SRC, DEST, { tables: {}, fields: {}, records: { ...RECORDS }, attachments: {} });
    const out = await computeSyncPlan({ client: viewFilterClient(), sourceBaseId: SRC, destBaseId: DEST, planId: 'plnREC' });
    const reemit = (out.machine.actions || []).filter((a) => a.kind === 'applyViewConfig');
    assert.equal(reemit.length, 0,
      `expected no applyViewConfig re-emit, got: ${JSON.stringify(reemit)}`);
  });
});
