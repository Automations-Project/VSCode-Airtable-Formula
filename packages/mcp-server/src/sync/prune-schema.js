// packages/mcp-server/src/sync/prune-schema.js
// Schema extras axis: delete dest-only fields/views/tables under mirror, tiered-gated, dependency-safe.
// Fields use deleteFields WITHOUT force (so a matched field is never cascade-deleted); orphan->orphan
// deps resolve by retry-until-stable; a field still blocked after no progress is kept + warned.
import { resolvePolicy } from './policy.js';

export async function pruneSchema({ client, destAppId, plan, policy, policyOverrides, confirmDeletions, confirmTableDeletions, result }) {
  if (result.schemaDeleted == null) result.schemaDeleted = 0;
  if (result.tablesDeleted == null) result.tablesDeleted = 0;
  if (!result.warnings) result.warnings = [];
  const orphans = (plan && plan.orphans) || [];
  const removes = (tableName) => resolvePolicy(policy, policyOverrides, tableName).extras === 'remove';

  let gatedFieldsViews = 0;
  let gatedTables = 0;

  // 1. Views (no dependents) — matched-table orphans
  for (const v of orphans.filter((o) => o.kind === 'view' && removes(o.tableName))) {
    if (!confirmDeletions) { gatedFieldsViews++; continue; }
    try { await client.deleteView(destAppId, v.destId); result.schemaDeleted++; }
    catch (e) { result.warnings.push({ code: 'SCHEMA_DELETE_FAILED', message: `view "${v.name}" (${v.tableName}): ${e.message ?? e}` }); }
  }

  // 2. Fields — delete-retry-until-stable, never force
  let fieldOrphans = orphans.filter((o) => o.kind === 'field' && removes(o.tableName));
  if (!confirmDeletions) { gatedFieldsViews += fieldOrphans.length; fieldOrphans = []; }
  let remaining = fieldOrphans;
  while (remaining.length) {
    let res;
    try { res = await client.deleteFields(destAppId, remaining.map((o) => ({ fieldId: o.destId, expectedName: o.name })), { force: false }); }
    catch (e) { for (const o of remaining) result.warnings.push({ code: 'SCHEMA_DELETE_FAILED', message: `field "${o.name}" (${o.tableName}): ${e.message ?? e}` }); break; }
    result.schemaDeleted += (res.succeeded || []).length;
    const failedIds = new Set((res.failed || []).map((f) => f.fieldId));
    const stillBlocked = remaining.filter((o) => failedIds.has(o.destId));
    if (stillBlocked.length === remaining.length) {
      // no progress → blocked by a matched (non-orphan) dependency, or unresolvable. Keep + warn.
      for (const o of stillBlocked) result.warnings.push({ code: 'SCHEMA_DELETE_BLOCKED', message: `field "${o.name}" in "${o.tableName}" blocked by a dependency (likely a matched field) — kept` });
      break;
    }
    remaining = stillBlocked;
  }

  // 3. Tables (after their fields) — gated by confirmTableDeletions
  for (const t of orphans.filter((o) => o.kind === 'table' && removes(o.name))) {
    if (!confirmTableDeletions) { gatedTables++; continue; }
    try { await client.deleteTable(destAppId, t.destId, t.name); result.tablesDeleted++; }
    catch (e) { result.warnings.push({ code: 'SCHEMA_DELETE_FAILED', message: `table "${t.name}": ${e.message ?? e}` }); }
  }

  if (gatedFieldsViews > 0) result.warnings.push({ code: 'DELETION_GATED', message: `${gatedFieldsViews} dest-only field(s)/view(s) would be deleted under mirror — set confirmDeletions:true` });
  if (gatedTables > 0) result.warnings.push({ code: 'TABLE_DELETION_GATED', message: `${gatedTables} dest-only table(s) would be deleted under mirror — set confirmTableDeletions:true` });
}
