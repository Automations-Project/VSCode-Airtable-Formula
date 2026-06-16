// Schema apply engine: execute an M2a Plan against a live destination base.
// Live-first + growing idmap + journal (resume) + existence-check (idempotency).
// POST-SPIKE: primary defaults to Name/text; createTable spawns 6 default fields →
// delete the 5 non-primary scaffolding fields (D1); links are foreignKey (later task).
import { remapRefs, toWritableComputedOptions } from './remap.js';
import { isDone, recordDone, recordFailed } from './journal.js';

const UNSUPPORTED_TYPES = new Set(['button', 'asyncText', 'aiText', 'externalSyncSource']);
const COMPUTED_TYPES = new Set(['formula', 'rollup', 'lookup', 'multipleLookupValues', 'count']);
const LINK_TYPES = new Set(['foreignKey', 'multipleRecordLinks']);

// Types Airtable refuses as a primary field — keep a placeholder + warn instead of
// retyping. The try/catch around the retype is the ultimate guard (set is an optimization).
const ILLEGAL_PRIMARY_TYPES = new Set([
  'select', 'singleSelect', 'multiSelect', 'multipleSelects',
  'multipleRecordLinks', 'foreignKey', 'multipleAttachment', 'multipleAttachments',
  'collaborator', 'button', 'rollup', 'lookup', 'multipleLookupValues', 'count',
  'asyncText', 'aiText', 'checkbox',
]);

function buildIndex(snap) {
  const tablesById = new Map();
  const tablesByName = new Map();
  for (const t of snap.tables) {
    const entry = {
      id: t.id, name: t.name, primaryFieldId: t.primaryFieldId,
      fieldsByName: new Map(t.fields.map((f) => [f.name, { id: f.id, name: f.name, type: f.type, typeOptions: f.typeOptions }])),
    };
    tablesById.set(t.id, entry);
    tablesByName.set(t.name, entry);
  }
  return { tablesById, tablesByName };
}

async function readTable(client, appId, tableId) {
  const raw = await client.getApplicationData(appId);
  const tables = raw?.data?.tableSchemas ?? raw?.data?.tables ?? [];
  const t = tables.find((x) => x.id === tableId);
  if (!t) throw new Error(`table ${tableId} not found after create`);
  const cols = t.columns ?? t.fields ?? [];
  const primaryId = t.primaryColumnId ?? t.primaryFieldId ?? cols[0]?.id;
  return { primaryId, primary: cols.find((c) => c.id === primaryId), cols };
}

function rememberLink(state, forwardFieldId, destTableId) {
  state.createdLinks.set(forwardFieldId, { destTableId });
}

async function adoptReverseLink({ client, destAppId, a, idmap, index, state, result }) {
  const destTableId = idmap.tables[a.sourceTableId];
  const { cols } = await readTable(client, destAppId, destTableId);
  for (const c of cols) {
    if (!LINK_TYPES.has(c.type)) continue;
    const sym = c.typeOptions && c.typeOptions.symmetricColumnId;
    if (sym && state.createdLinks.has(sym) && !state.adoptedReverse.has(c.id)) {
      if (c.name !== a.name) await client.renameField(destAppId, c.id, a.name);
      idmap.fields[a.sourceFieldId] = { destFld: c.id, choices: {} };
      const entry = index.tablesById.get(destTableId);
      if (entry) entry.fieldsByName.set(a.name, { id: c.id, name: a.name, type: c.type, typeOptions: c.typeOptions });
      state.adoptedReverse.add(c.id);
      result.skipped++;
      return true;
    }
  }
  return false;
}

function writableLinkOptions(remappedTypeOptions) {
  const o = remappedTypeOptions || {};
  const out = { foreignTableId: o.foreignTableId };
  if (o.relationship) out.relationship = o.relationship;
  return out; // drop symmetricColumnId/unreversed (auto-managed by Airtable)
}

function findDestField(index, destFieldId) {
  for (const entry of index.tablesById.values()) {
    for (const f of entry.fieldsByName.values()) if (f.id === destFieldId) return f;
  }
  return null;
}
function findDestFieldType(index, destFieldId) {
  const f = findDestField(index, destFieldId);
  return f ? f.type : undefined;
}
// Merge source choices into dest choices by NAME (never drop a dest choice). Dest choices
// keep their ids; new source choices are added without ids (Airtable assigns).
function mergeChoices(destField, srcTypeOptions) {
  if (!srcTypeOptions || !srcTypeOptions.choices) return srcTypeOptions;
  const destChoices = (destField && destField.typeOptions && destField.typeOptions.choices) || {};
  const byName = new Map(Object.values(destChoices).map((c) => [c.name, c]));
  for (const c of Object.values(srcTypeOptions.choices)) if (!byName.has(c.name)) byName.set(c.name, { name: c.name, color: c.color });
  const merged = {};
  for (const c of byName.values()) { const id = c.id || c.name; merged[id] = c; }
  return { ...srcTypeOptions, choices: merged };
}

export async function applyPlan({ client, plan, destAppId, destSnapshot, idmap, journal, persist }) {
  const index = buildIndex(destSnapshot);
  const state = { createdLinks: new Map(), adoptedReverse: new Set() };
  const result = { planId: plan.planId, aborted: false, created: 0, updated: 0, skipped: 0, failed: 0, warnings: [], idmap };

  for (let idx = 0; idx < plan.actions.length; idx++) {
    const a = plan.actions[idx];
    if (isDone(journal, idx)) { result.skipped++; continue; }
    try {
      await applyAction({ client, destAppId, a, idmap, index, state, result });
      recordDone(journal, idx, a.kind, idmap.tables[a.sourceTableId] ?? (a.sourceFieldId && idmap.fields[a.sourceFieldId]?.destFld));
      persist(idmap, journal);
    } catch (e) {
      recordFailed(journal, idx, a.kind, String(e && e.message ? e.message : e));
      result.failed++;
      result.warnings.push({ code: 'ACTION_FAILED', message: `${a.kind} "${a.name ?? a.sourceFieldId ?? a.sourceTableId}": ${e.message ?? e}` });
      persist(idmap, journal);
      // ponytail: continue, don't halt. A failed create's dependents are guarded by the
      // UNRESOLVABLE_REF check; re-run retries non-done actions. Halting on one bad field
      // blocked the entire sync (494 creates never ran behind one failing update).
    }
  }
  return result;
}

async function applyAction({ client, destAppId, a, idmap, index, state, result }) {
  switch (a.kind) {
    case 'createTable': {
      const existing = index.tablesByName.get(a.name);
      if (existing) { idmap.tables[a.sourceTableId] = existing.id; result.skipped++; return; }
      const { tableId } = await client.createTable(destAppId, a.name);
      idmap.tables[a.sourceTableId] = tableId;
      // D1: delete the auto-created non-primary scaffolding fields for a clean mirror.
      const { primaryId, primary, cols } = await readTable(client, destAppId, tableId);
      for (const c of cols) {
        if (c.id === primaryId) continue;
        await client.deleteField(destAppId, c.id, c.name);
      }
      const entry = {
        id: tableId, name: a.name, primaryFieldId: primaryId,
        fieldsByName: new Map([[primary.name, { id: primaryId, name: primary.name, type: primary.type, typeOptions: primary.typeOptions ?? null }]]),
      };
      index.tablesById.set(tableId, entry);
      index.tablesByName.set(a.name, entry);
      result.created++;
      return;
    }

    case 'reconcilePrimary': {
      const destTableId = idmap.tables[a.sourceTableId];
      const entry = index.tablesById.get(destTableId);
      if (!entry || !entry.primaryFieldId) throw new Error(`reconcilePrimary: no primary for ${destTableId}`);
      const primaryId = entry.primaryFieldId;
      let primary = null;
      for (const f of entry.fieldsByName.values()) if (f.id === primaryId) primary = f;
      let renamed = false, retyped = false;
      if (primary && primary.name !== a.toName) { await client.renameField(destAppId, primaryId, a.toName); renamed = true; }
      if (a.toType && primary && primary.type !== a.toType) {
        if (ILLEGAL_PRIMARY_TYPES.has(a.toType)) {
          result.warnings.push({ code: 'PRIMARY_TYPE_INCOMPATIBLE', message: `Primary "${a.toName}" wants ${a.toType}; kept ${primary.type} placeholder` });
        } else {
          try { await client.updateFieldConfig(destAppId, primaryId, { type: a.toType, typeOptions: remapRefs(a.toTypeOptions, idmap) }); retyped = true; }
          catch (e) { result.warnings.push({ code: 'PRIMARY_TYPE_INCOMPATIBLE', message: `Primary "${a.toName}" retype to ${a.toType} rejected: ${e.message ?? e}` }); }
        }
      }
      idmap.fields[a.sourcePrimaryFieldId] = { destFld: primaryId, choices: {} };
      if (primary) {
        if (renamed) { entry.fieldsByName.delete(primary.name); primary.name = a.toName; entry.fieldsByName.set(a.toName, primary); }
        if (retyped) primary.type = a.toType;
      }
      if (renamed || retyped) result.updated++; else result.skipped++;
      return;
    }

    case 'createField': {
      const destTableId = idmap.tables[a.sourceTableId];
      const entry = index.tablesById.get(destTableId);
      if (UNSUPPORTED_TYPES.has(a.type)) {
        result.warnings.push({ code: 'SKIPPED_UNSUPPORTED', message: `Field "${a.name}" (${a.type}) skipped — unsupported by the apply engine` });
        result.skipped++;
        return;
      }
      const existing = entry && entry.fieldsByName.get(a.name);
      if (existing) {
        idmap.fields[a.sourceFieldId] = { destFld: existing.id, choices: {} };
        result.skipped++;
        return;
      }
      // Reciprocal-once: adopt the auto-created reverse of a link made earlier this run.
      if (LINK_TYPES.has(a.type) && await adoptReverseLink({ client, destAppId, a, idmap, index, state, result })) return;

      const remapped = remapRefs(a.typeOptions, idmap);
      let typeOptions = remapped;
      if (LINK_TYPES.has(a.type)) {
        typeOptions = writableLinkOptions(remapped);
      } else if (COMPUTED_TYPES.has(a.type)) {
        const unresolved = (a.dependsOn || []).filter((d) => !(idmap.fields[d] && idmap.fields[d].destFld));
        if (unresolved.length) {
          result.warnings.push({ code: 'UNRESOLVABLE_REF', message: `Field "${a.name}" references unresolved field(s) [${unresolved.join(', ')}] (skipped or unmapped) — not created` });
          result.skipped++;
          return;
        }
        typeOptions = toWritableComputedOptions(a.type, remapped);
        if (a.type === 'formula') {
          const v = await client.validateFormula(destAppId, destTableId, typeOptions.formulaText ?? '');
          if (!v.valid) throw new Error(`formula invalid: ${v.message ?? v.error ?? 'rejected'}`);
        }
      }
      const { columnId } = await client.createField(destAppId, destTableId, { name: a.name, type: a.type, typeOptions, description: a.description ?? undefined });
      idmap.fields[a.sourceFieldId] = { destFld: columnId, choices: {} };
      if (entry) entry.fieldsByName.set(a.name, { id: columnId, name: a.name, type: a.type, typeOptions });
      if (LINK_TYPES.has(a.type)) rememberLink(state, columnId, destTableId);
      result.created++;
      return;
    }

    case 'updateField': {
      const changes = a.changes || {};
      if (changes.type !== undefined) {
        result.warnings.push({ code: 'RETYPE_DEFERRED', message: `Field ${a.destFld}: type change to "${changes.type}" deferred (M4)` });
        return; // never retype an existing field in M2b
      }
      let mutated = false;
      if (changes.name !== undefined) { await client.renameField(destAppId, a.destFld, changes.name); mutated = true; }
      if (changes.typeOptions !== undefined) {
        const destType = findDestFieldType(index, a.destFld);
        const remapped = remapRefs(changes.typeOptions, idmap);
        if (COMPUTED_TYPES.has(destType)) {
          // Computed updates need the writable shape (drop read-only formulaTextParsed/
          // dependencies/resultType — the API 422s on them). Defer if a referenced field
          // isn't created yet (updates run before creates); a re-plan after creates converges.
          const refs = (changes.typeOptions.dependencies && changes.typeOptions.dependencies.referencedColumnIdsForValue) || [];
          const unresolved = refs.filter((d) => !(idmap.fields[d] && idmap.fields[d].destFld));
          if (unresolved.length) {
            result.warnings.push({ code: 'UNRESOLVABLE_REF', message: `Update of "${a.destFld}" typeOptions deferred — refs [${unresolved.join(', ')}] not yet created (re-plan after creates)` });
          } else {
            await client.updateFieldConfig(destAppId, a.destFld, { type: destType, typeOptions: toWritableComputedOptions(destType, remapped) });
            mutated = true;
          }
        } else {
          await client.updateFieldConfig(destAppId, a.destFld, { type: destType, typeOptions: mergeChoices(findDestField(index, a.destFld), remapped) });
          mutated = true;
        }
      }
      if (changes.description !== undefined) { await client.updateFieldDescription(destAppId, a.destFld, changes.description); mutated = true; }
      if (mutated) result.updated++; else result.skipped++;
      return;
    }

    default:
      throw new Error(`unhandled action kind: ${a.kind}`);
  }
}
