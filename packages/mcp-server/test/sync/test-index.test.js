import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plan as computeSyncPlan, diff as computeSyncDiff, fingerprintSchema, apply as syncApply } from '../../src/sync/index.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncDir } from '../../src/sync/idmap.js';

describe('sync index.plan', () => {
  it('produces a plan summary and persists plan-<id>.json', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-idx-'));
    const mk = (tableName, fieldName) => ({ data: { tableSchemas: [{ id: 'tbl1', name: tableName, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: fieldName, type: 'text' }] }] } });
    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? mk('T', 'Name') : { data: { tableSchemas: [] } }) };
    const out = await computeSyncPlan({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnTEST' });
    assert.match(out.human, /createTable: 1/);
    assert.ok(existsSync(join(syncDir('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD'), 'plan-plnTEST.json')));
  });
  it('fingerprintSchema is stable + order-independent', () => {
    const a = { tables: [{ id: 't1', name: 'A', fields: [{ id: 'f1', name: 'x', type: 'text' }] }, { id: 't2', name: 'B', fields: [] }] };
    const b = { tables: [{ id: 't2', name: 'B', fields: [] }, { id: 't1', name: 'A', fields: [{ id: 'f1', name: 'x', type: 'text' }] }] };
    assert.equal(fingerprintSchema(a), fingerprintSchema(b));
  });
  // Regression test (Sentry finding, Task 27): fields were NOT sorted before hashing while
  // tables and views were — a field-order-only difference between two snapshots of an
  // otherwise-identical schema (Airtable's field-listing order is not a stable/guaranteed
  // contract; CLAUDE.md classifies field/view/column order as "best-effort", i.e. non-drift)
  // flipped the fingerprint, which the apply() drift guard (index.js) treats as a real
  // schema change — aborting mode=apply (or, on a resume, emitting a scary but false
  // RESUME_DRIFT_BYPASS "someone else changed the dest" warning) on an unchanged schema.
  it('fingerprintSchema: reordering a table\'s fields (no content change) does NOT change the fingerprint', () => {
    const mkTable = (fields) => ({ id: 't1', name: 'T', fields, views: [{ id: 'v1', name: 'Grid view', type: 'grid' }] });
    const fA = { id: 'f1', name: 'Name', type: 'text' };
    const fB = { id: 'f2', name: 'Count', type: 'number' };
    const fC = { id: 'f3', name: 'Status', type: 'singleSelect' };
    const a = { tables: [mkTable([fA, fB, fC])] };
    const b = { tables: [mkTable([fC, fA, fB])] };
    const c = { tables: [mkTable([fB, fC, fA])] };
    assert.equal(fingerprintSchema(a), fingerprintSchema(b), 'permutation 1 must match');
    assert.equal(fingerprintSchema(a), fingerprintSchema(c), 'permutation 2 must match');
  });
  // The guard used to hash id=name=type ONLY, so everything below produced a BYTE-IDENTICAL
  // fingerprint: a collaborator could rewrite a formula, retarget a link, add a select choice or
  // edit a description between plan and apply, the drift check passed, and apply overwrote them.
  it('fingerprintSchema: a field OPTIONS change is drift (formula text, choices, link target)', () => {
    const mk = (options) => ({ tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Calc', type: 'formula', options },
    ] }] });

    const fp = fingerprintSchema(mk({ formula: 'A + B' }));
    assert.notEqual(fingerprintSchema(mk({ formula: 'A * B' })), fp, 'a rewritten formula must be drift');

    const sel = (choices) => ({ tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Status', type: 'select', options: { choices } },
    ] }] });
    assert.notEqual(
      fingerprintSchema(sel({ c1: { name: 'A' }, c2: { name: 'B' } })),
      fingerprintSchema(sel({ c1: { name: 'A' } })),
      'an added select choice must be drift',
    );

    const link = (foreignTableId) => ({ tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Rel', type: 'foreignKey', options: { foreignTableId } },
    ] }] });
    assert.notEqual(fingerprintSchema(link('tblA')), fingerprintSchema(link('tblB')), 'a retargeted link must be drift');
  });

  it('fingerprintSchema: a description change is drift, and options key ORDER is not', () => {
    const withDesc = (description) => ({ tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text', description },
    ] }] });
    assert.notEqual(fingerprintSchema(withDesc('before')), fingerprintSchema(withDesc('after')));

    // Same options, different key order — Airtable's JSON key order is not a schema change, and a
    // guard that cried wolf on re-serialization would get switched off.
    const a = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'N', type: 'number', options: { precision: 2, symbol: '$', nested: { x: 1, y: 2 } } },
    ] }] };
    const b = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'N', type: 'number', options: { symbol: '$', nested: { y: 2, x: 1 }, precision: 2 } },
    ] }] };
    assert.equal(fingerprintSchema(a), fingerprintSchema(b), 'key order must not be drift');
  });

  it('fingerprintSchema: view CONFIG counts only under includeViewConfig (the opt-in read-storm)', () => {
    const mk = (filters) => ({ tables: [{ id: 't1', name: 'T', fields: [], views: [
      { id: 'viw1', name: 'Grid', type: 'grid', config: { filters } },
    ] }] });
    const a = mk({ filterSet: [{ columnId: 'f1', value: 'x' }] });
    const b = mk({ filterSet: [{ columnId: 'f1', value: 'y' }] });

    // Default: view config is NOT hashed — apply() uses the cheap schema-only snapshot.
    assert.equal(fingerprintSchema(a), fingerprintSchema(b), 'default must ignore view config');
    // Opt-in: the same edit is now drift.
    assert.notEqual(
      fingerprintSchema(a, { includeViewConfig: true }),
      fingerprintSchema(b, { includeViewConfig: true }),
      'strictDrift must see a changed view filter',
    );
  });

  it('fingerprintSchema: a genuine field change (add/remove/rename/retype) still changes the fingerprint', () => {
    const base = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text' },
      { id: 'f2', name: 'Count', type: 'number' },
    ] }] };
    const fpBase = fingerprintSchema(base);

    const added = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text' },
      { id: 'f2', name: 'Count', type: 'number' },
      { id: 'f3', name: 'Extra', type: 'text' },
    ] }] };
    assert.notEqual(fingerprintSchema(added), fpBase, 'added field must change the fingerprint');

    const removed = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text' },
    ] }] };
    assert.notEqual(fingerprintSchema(removed), fpBase, 'removed field must change the fingerprint');

    const renamed = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text' },
      { id: 'f2', name: 'Renamed', type: 'number' },
    ] }] };
    assert.notEqual(fingerprintSchema(renamed), fpBase, 'renamed field must change the fingerprint');

    const retyped = { tables: [{ id: 't1', name: 'T', fields: [
      { id: 'f1', name: 'Name', type: 'text' },
      { id: 'f2', name: 'Count', type: 'singleLineText' },
    ] }] };
    assert.notEqual(fingerprintSchema(retyped), fpBase, 'retyped field must change the fingerprint');
  });
});

describe('sync index.plan — direction param (Task 10)', () => {
  // When direction='to-source', the src/dest roles are SWAPPED: dest is snapshotted as
  // "source" and source is snapshotted as "dest". So the changeset targets the SOURCE base.
  // We verify this by checking which base the mock client was asked about for each role:
  // With direction='to-source', appDDDDDDDDDDDDDD (the original dest) should be the "source"
  // that has the table, and appSSSSSSSSSSSSSS (the original source) should be the empty "dest".
  it('direction="to-dest" (default) — createTable targets destBase', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-dir-'));
    const mk = (tableName) => ({ data: { tableSchemas: [{ id: 'tbl1', name: tableName, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: 'Name', type: 'text' }] }] } });
    // Source (appSSSS) has a table; dest (appDDDD) is empty.
    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? mk('TableInSrc') : { data: { tableSchemas: [] } }) };
    const out = await computeSyncPlan({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnDirDest', direction: 'to-dest' });
    // Plan should create the table (because src has it, dest doesn't)
    assert.match(out.human, /createTable: 1/, 'direction=to-dest: createTable should appear for dest');
    // The sample entry should name the table from source
    const sample = out.machine.sample || [];
    const ct = sample.find((e) => e.op === 'createTable');
    assert.ok(ct, 'sample should have a createTable entry');
    assert.equal(ct.table, 'TableInSrc', 'sample entry should reference the source table name');
  });

  it('direction="to-source" — swaps src/dest: createTable targets sourceBase', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-dir-src-'));
    const mk = (tableName) => ({ data: { tableSchemas: [{ id: 'tbl1', name: tableName, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: 'Name', type: 'text' }] }] } });
    // Dest (appDDDD) has a table; source (appSSSS) is empty.
    // With direction='to-source', roles swap: dest becomes "source", source becomes "dest".
    // So the plan should create the table in appSSSSSSSSSSSSSS (the original source = swapped dest).
    const client = { getApplicationData: async (appId) => (appId === 'appDDDDDDDDDDDDDD' ? mk('TableInDest') : { data: { tableSchemas: [] } }) };
    const out = await computeSyncPlan({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnDirSrc', direction: 'to-source' });
    // With the swap: dest (which has the table) is treated as source → plan creates it in original source.
    assert.match(out.human, /createTable: 1/, 'direction=to-source: createTable should appear');
    // The sample entry should name the table from dest (swapped to be source)
    const sample = out.machine.sample || [];
    const ct = sample.find((e) => e.op === 'createTable');
    assert.ok(ct, 'sample should have a createTable entry');
    assert.equal(ct.table, 'TableInDest', 'sample entry should reference the table from swapped source (original dest)');
    // The plan file should be saved with swapped IDs (dest as src, src as dest)
    assert.ok(existsSync(join(syncDir('appDDDDDDDDDDDDDD', 'appSSSSSSSSSSSSSS'), 'plan-plnDirSrc.json')), 'plan saved under swapped dir');
  });

  it('direction defaults to "to-dest" when omitted', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-dir-def-'));
    const mk = (tableName) => ({ data: { tableSchemas: [{ id: 'tbl1', name: tableName, primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: 'Name', type: 'text' }] }] } });
    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? mk('DefaultTable') : { data: { tableSchemas: [] } }) };
    const out = await computeSyncPlan({ client, sourceBaseId: 'appSSSSSSSSSSSSSS', destBaseId: 'appDDDDDDDDDDDDDD', planId: 'plnDefault' });
    assert.match(out.human, /createTable: 1/);
  });
});

describe('sync index.plan — fieldMappings validation (Task 8)', () => {
  // Both src and dest have the same table/fields. We inject a mapping with a COMPUTED
  // dest target (formula field) — validateFieldMappings must return FIELD_MAP_TARGET_COMPUTED.
  // plan() must attach fieldMappingErrors to the returned result and make NO client writes.
  it('mode=plan with invalid fieldMappings (computed dest) returns fieldMappingErrors, no mutation', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-fmap-'));

    // src: table T with text field "Name"
    const srcSchema = { data: { tableSchemas: [{
      id: 'tbl1', name: 'T', primaryColumnId: 'fld1',
      columns: [
        { id: 'fld1', name: 'Name', type: 'text' },
      ],
    }] } };
    // dest: table T with text field "Name" and a formula field "Computed"
    const destSchema = { data: { tableSchemas: [{
      id: 'tblD1', name: 'T', primaryColumnId: 'fldD1',
      columns: [
        { id: 'fldD1', name: 'Name', type: 'text' },
        { id: 'fldD2', name: 'Computed', type: 'formula' },
      ],
    }] } };

    let writeCallCount = 0;
    const client = {
      getApplicationData: async (appId) => {
        if (appId === 'appSSSSSSSSSSSSSS') return srcSchema;
        return destSchema;
      },
      // Track any mutating calls — there should be none
      createTable: async () => { writeCallCount++; return {}; },
      createField: async () => { writeCallCount++; return {}; },
    };

    const fieldMappings = { T: { Name: 'Computed' } }; // invalid: Computed is formula (computed)

    const out = await computeSyncPlan({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      planId: 'plnFmapTest',
      fieldMappings,
    });

    // Must include fieldMappingErrors
    assert.ok(out.machine.fieldMappingErrors, 'fieldMappingErrors must be present in machine output');
    assert.equal(out.machine.fieldMappingErrors.length, 1, 'should have exactly one error');
    assert.equal(out.machine.fieldMappingErrors[0].code, 'FIELD_MAP_TARGET_COMPUTED', 'error code should be FIELD_MAP_TARGET_COMPUTED');
    assert.equal(out.machine.fieldMappingErrors[0].table, 'T', 'error should reference table T');
    assert.equal(out.machine.fieldMappingErrors[0].target, 'Computed', 'error should reference target field Computed');

    // No mutations must have occurred
    assert.equal(writeCallCount, 0, 'no client write calls should have been made');
  });

  it('mode=diff with invalid fieldMappings returns fieldMappingErrors', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-fmap-diff-'));

    const srcSchema = { data: { tableSchemas: [{
      id: 'tbl1', name: 'T', primaryColumnId: 'fld1',
      columns: [{ id: 'fld1', name: 'Name', type: 'text' }],
    }] } };
    const destSchema = { data: { tableSchemas: [{
      id: 'tblD1', name: 'T', primaryColumnId: 'fldD1',
      columns: [
        { id: 'fldD1', name: 'Name', type: 'text' },
        { id: 'fldD2', name: 'Computed', type: 'formula' },
      ],
    }] } };

    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? srcSchema : destSchema) };
    const fieldMappings = { T: { Name: 'Computed' } };

    const out = await computeSyncDiff({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      diffId: 'difFmapTest',
      fieldMappings,
    });

    assert.ok(out.machine.fieldMappingErrors, 'fieldMappingErrors must be present in diff machine output');
    assert.equal(out.machine.fieldMappingErrors[0].code, 'FIELD_MAP_TARGET_COMPUTED');
  });

  it('mode=plan with valid fieldMappings returns no fieldMappingErrors', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-fmap-valid-'));

    const srcSchema = { data: { tableSchemas: [{
      id: 'tbl1', name: 'T', primaryColumnId: 'fld1',
      columns: [{ id: 'fld1', name: 'Name', type: 'text' }],
    }] } };
    const destSchema = { data: { tableSchemas: [{
      id: 'tblD1', name: 'T', primaryColumnId: 'fldD1',
      columns: [
        { id: 'fldD1', name: 'Name', type: 'text' },
        { id: 'fldD2', name: 'Notes', type: 'text' },
      ],
    }] } };

    const client = { getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? srcSchema : destSchema) };
    const fieldMappings = { T: { Name: 'Notes' } }; // valid: both text fields

    const out = await computeSyncPlan({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      planId: 'plnFmapValid',
      fieldMappings,
    });

    assert.ok(Array.isArray(out.machine.fieldMappingErrors), 'fieldMappingErrors should be an array');
    assert.equal(out.machine.fieldMappingErrors.length, 0, 'should have no errors for a valid mapping');
  });

  it('mode=plan without fieldMappings does not include fieldMappingErrors', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-fmap-none-'));
    const mk = () => ({ data: { tableSchemas: [{ id: 'tbl1', name: 'T', primaryColumnId: 'fld1', columns: [{ id: 'fld1', name: 'Name', type: 'text' }] }] } });
    const client = { getApplicationData: async () => mk() };
    const out = await computeSyncPlan({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      planId: 'plnNoFmap',
    });
    // Without fieldMappings, fieldMappingErrors should not appear
    assert.equal(out.machine.fieldMappingErrors, undefined, 'fieldMappingErrors should be absent when no fieldMappings given');
  });
});

describe('sync index.apply — pruneSchema integration (Task 2)', () => {
  // apply() with policy=mirror + plan carrying orphans (one field orphan + one table orphan),
  // confirmDeletions=true, confirmTableDeletions=false:
  //   - deleteFields should be called for the orphan field
  //   - deleteTable should NOT be called (table gated by confirmTableDeletions=false)
  //   - result.machine.schemaDeleted > 0
  //   - result.machine.warnings includes a TABLE_DELETION_GATED entry
  //
  // Because apply() does substantial I/O (plan/idmap/journal), we drive the full flow:
  // save a minimal plan whose orphans include the target field + table, then call syncApply().
  // The applyPlan itself is a no-op (no actions) so only pruneSchema has observable side-effects.
  it('apply() with mirror+confirmDeletions calls deleteFields for orphan field, gates orphan table, warns TABLE_DELETION_GATED', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-prune-'));

    const srcAppId = 'appSRCPRUNE00000';
    const destAppId = 'appDESTPRUNE0000';

    // Both bases share an identical table so fingerprints match and plan has zero actions.
    // The orphans (field + table) are injected manually into the plan file after saving.
    const schema = { data: { tableSchemas: [{
      id: 'tblA', name: 'Shared', primaryColumnId: 'fldA1',
      columns: [{ id: 'fldA1', name: 'Name', type: 'text' }],
    }] } };

    const deleteFieldsCalls = [];
    const deleteTableCalls = [];

    const client = {
      getApplicationData: async () => schema,
      // applyPlan may call createTable/createField for new items, but our plan is empty.
      createTable: async () => ({ data: { id: 'tblNEW' } }),
      createField: async () => ({ data: { id: 'fldNEW' } }),
      deleteFields: async (appId, fields, opts) => {
        deleteFieldsCalls.push({ appId, fields, opts });
        // Return as if all succeeded
        return { succeeded: fields.map((f) => ({ fieldId: f.fieldId })), failed: [] };
      },
      deleteTable: async (appId, tableId, tableName) => {
        deleteTableCalls.push({ appId, tableId, tableName });
      },
    };

    // Step 1: Run plan() to persist a valid plan.
    await computeSyncPlan({
      client,
      sourceBaseId: srcAppId,
      destBaseId: destAppId,
      planId: 'plnPruneTest',
    });

    // Step 2: Patch the saved plan to inject orphans.
    // We load the plan file, add orphans, and re-save it.
    const { syncDir: getSyncDir } = await import('../../src/sync/idmap.js');
    const { readFileSync: rfSync, writeFileSync } = await import('node:fs');
    const planPath = join(getSyncDir(srcAppId, destAppId), 'plan-plnPruneTest.json');
    const savedPlan = JSON.parse(rfSync(planPath, 'utf8'));
    // Inject: one field orphan (dest table "Shared" has an extra field "OldField"),
    //         one table orphan (dest has extra table "Orphaned")
    savedPlan.orphans = [
      { kind: 'field', tableName: 'Shared', destId: 'fldORPHAN1', name: 'OldField' },
      { kind: 'table', name: 'Orphaned', destId: 'tblORPHAN1' },
    ];
    writeFileSync(planPath, JSON.stringify(savedPlan));

    // Step 3: Call apply() with policy=mirror, confirmDeletions=true, confirmTableDeletions=false.
    const out = await syncApply({
      client,
      sourceBaseId: srcAppId,
      destBaseId: destAppId,
      planId: 'plnPruneTest',
      runStartedAt: new Date().toISOString(),
      policy: 'mirror',
      confirmDeletions: true,
      confirmTableDeletions: false,
    });

    // Assert: deleteFields was called once for the orphan field
    assert.equal(deleteFieldsCalls.length, 1, 'deleteFields must be called exactly once');
    assert.equal(deleteFieldsCalls[0].fields[0].fieldId, 'fldORPHAN1', 'deleteFields called with correct orphan fieldId');

    // Assert: deleteTable was NOT called (gated by confirmTableDeletions=false)
    assert.equal(deleteTableCalls.length, 0, 'deleteTable must NOT be called (confirmTableDeletions=false)');

    // Assert: result.machine.schemaDeleted reflects the deleted field
    assert.ok(out.machine.schemaDeleted > 0, 'result.machine.schemaDeleted must be > 0');

    // Assert: TABLE_DELETION_GATED warning in result
    const warnings = out.machine.warnings || [];
    const gatedWarn = warnings.find((w) => w.code === 'TABLE_DELETION_GATED');
    assert.ok(gatedWarn, 'result must carry a TABLE_DELETION_GATED warning');
    assert.match(gatedWarn.message, /confirmTableDeletions/, 'TABLE_DELETION_GATED message must mention confirmTableDeletions');
  });
});

describe('sync index.apply — synchronous fieldMappings pre-flight (Task 8 Fix)', () => {
  // apply() must throw FIELD_MAP_INVALID synchronously (before launching the background records
  // job) when fieldMappings references a computed (formula) dest field.
  // Verified by: (a) rejection with the correct code, (b) no schema mutations occurred.
  it('apply() with invalid fieldMappings (computed dest) rejects synchronously with FIELD_MAP_INVALID, no mutations', async () => {
    process.env.AIRTABLE_USER_MCP_HOME = mkdtempSync(join(tmpdir(), 'sync-apply-fmap-'));

    // src: table T with a single text field "Name"
    const srcSchema = { data: { tableSchemas: [{
      id: 'tbl1', name: 'T', primaryColumnId: 'fld1',
      columns: [{ id: 'fld1', name: 'Name', type: 'text' }],
    }] } };
    // dest: table T with text "Name" + formula "Computed"
    const destSchema = { data: { tableSchemas: [{
      id: 'tblD1', name: 'T', primaryColumnId: 'fldD1',
      columns: [
        { id: 'fldD1', name: 'Name', type: 'text' },
        { id: 'fldD2', name: 'Computed', type: 'formula' },
      ],
    }] } };

    let schemaMutationCount = 0;

    const client = {
      getApplicationData: async (appId) => (appId === 'appSSSSSSSSSSSSSS' ? srcSchema : destSchema),
      // Detect any schema mutations (should NOT be called)
      createTable: async () => { schemaMutationCount++; return {}; },
      createField: async () => { schemaMutationCount++; return {}; },
      updateField: async () => { schemaMutationCount++; return {}; },
    };

    // Step 1: Run plan() so apply() can find a saved plan.
    const planOut = await computeSyncPlan({
      client,
      sourceBaseId: 'appSSSSSSSSSSSSSS',
      destBaseId: 'appDDDDDDDDDDDDDD',
      planId: 'plnApplyFmapTest',
    });
    assert.ok(planOut, 'plan must succeed before apply');

    // Reset mutation counter (plan itself may have no mutations, but be safe)
    schemaMutationCount = 0;

    // Step 2: Call apply() with an invalid fieldMappings (Computed is a formula field).
    // It should reject BEFORE any mutation or background job launch.
    const fieldMappings = { T: { Name: 'Computed' } };

    let thrown = null;
    try {
      await syncApply({
        client,
        sourceBaseId: 'appSSSSSSSSSSSSSS',
        destBaseId: 'appDDDDDDDDDDDDDD',
        planId: 'plnApplyFmapTest',
        runStartedAt: new Date().toISOString(),
        fieldMappings,
      });
    } catch (e) {
      thrown = e;
    }

    // Must have thrown
    assert.ok(thrown, 'apply() must throw for invalid fieldMappings');
    assert.equal(thrown.code, 'FIELD_MAP_INVALID', 'error code must be FIELD_MAP_INVALID');
    assert.ok(Array.isArray(thrown.mappingErrors), 'mappingErrors must be an array');
    assert.equal(thrown.mappingErrors.length, 1, 'should have exactly one mapping error');
    assert.equal(thrown.mappingErrors[0].code, 'FIELD_MAP_TARGET_COMPUTED', 'error code must be FIELD_MAP_TARGET_COMPUTED');

    // No schema mutations must have occurred
    assert.equal(schemaMutationCount, 0, 'no schema mutations should have occurred before validation fails');

    // No background job should have been launched (verified indirectly: apply threw before the
    // fire-and-forget block, so no records job status file was written)
    const { syncDir: getSyncDir } = await import('../../src/sync/idmap.js');
    const jobFile = join(getSyncDir('appSSSSSSSSSSSSSS', 'appDDDDDDDDDDDDDD'), 'records-job-plnApplyFmapTest.json');
    assert.ok(!existsSync(jobFile), 'records job status file must NOT exist (background job was not launched)');
  });
});
