// Schema apply engine: execute an M2a Plan against a live destination base.
// Live-first + growing idmap + journal (resume) + existence-check (idempotency).
// POST-SPIKE: primary defaults to Name/text; createTable spawns 6 default fields →
// delete the 5 non-primary scaffolding fields (D1); links are foreignKey (later task).
import { remapRefs, toWritableComputedOptions, remapViewConfig, collectFilterRecordRefs } from './remap.js';
import { isDone, recordDone, recordFailed } from './journal.js';

const UNSUPPORTED_TYPES = new Set(['button', 'asyncText', 'aiText', 'externalSyncSource']);
const VIEW_GROUP_ANCHOR = new Set(['select', 'singleSelect', 'multiSelect', 'multipleSelects', 'collaborator']);
const COMPUTED_TYPES = new Set(['formula', 'rollup', 'lookup', 'multipleLookupValues', 'count']);
const LINK_TYPES = new Set(['foreignKey', 'multipleRecordLinks']);
const SCALAR_RETYPE_TYPES = new Set(['text', 'multilineText', 'richText', 'number', 'currency', 'percent', 'rating', 'duration', 'checkbox', 'date', 'dateTime', 'phone', 'email', 'url', 'select', 'singleSelect', 'multiSelect', 'multipleSelects']);

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
      viewsByName: new Map((t.views || []).map((v) => [v.name, { id: v.id, type: v.type }])),
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
  return { primaryId, primary: cols.find((c) => c.id === primaryId), cols, views: t.views ?? [] };
}

// Adopt the auto-created reverse of a link whose FORWARD side is already mapped in the idmap
// (created earlier this run, or matched/adopted in a prior run). The reverse-side createField
// action carries the source FORWARD field id in typeOptions.symmetricColumnId; the dest column
// whose symmetricColumnId equals that forward's dest id IS this link's reverse — adopt exactly
// that one. (First-unadopted matching cross-wired multi-link table pairs, and run-local
// createdLinks state made cross-run retries create duplicate link pairs.)
async function adoptReverseLink({ client, destAppId, a, idmap, index, state, result }) {
  const srcForwardId = a.typeOptions && a.typeOptions.symmetricColumnId;
  const wantSym = srcForwardId && idmap.fields[srcForwardId] && idmap.fields[srcForwardId].destFld;
  if (!wantSym) return false; // forward unknown → nothing to adopt (create a fresh pair)
  const destTableId = idmap.tables[a.sourceTableId];
  const { cols } = await readTable(client, destAppId, destTableId);
  for (const c of cols) {
    if (!LINK_TYPES.has(c.type)) continue;
    const sym = c.typeOptions && c.typeOptions.symmetricColumnId;
    if (sym === wantSym && !state.adoptedReverse.has(c.id)) {
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
const SELECT_TYPES = new Set(['select', 'singleSelect', 'multiSelect', 'multipleSelects']);

// Source-choice-id → dest-choice-id map, matched by NAME (same contract as idmap.js
// matchChoices). Registered at field create/adopt time: the records phase of the SAME run
// reads idmap.fields[..].choices to map select cells — an empty map made every select cell
// skip (RECORD_CELL_SKIPPED) on first sync, and multiSelect columns never converged after.
function matchChoicesByName(srcTypeOptions, destTypeOptions) {
  const sc = srcTypeOptions && srcTypeOptions.choices;
  const dc = destTypeOptions && destTypeOptions.choices;
  if (!sc || !dc) return {};
  const destByName = new Map(Object.entries(dc).map(([id, c]) => [c.name, c.id || id]));
  const out = {};
  for (const [id, c] of Object.entries(sc)) {
    const destId = destByName.get(c.name);
    if (destId) out[c.id || id] = destId;
  }
  return out;
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

export async function applyPlan({ client, plan, destAppId, destSnapshot, idmap, journal, persist, skip = [], confirmRetypes = false }) {
  const index = buildIndex(destSnapshot);
  const state = { adoptedReverse: new Set(), createdTables: new Set() };
  if (!idmap.views) idmap.views = {};
  const result = { planId: plan.planId, aborted: false, created: 0, updated: 0, skipped: 0, failed: 0, retyped: 0, warnings: [], idmap };
  const skipSet = new Set(skip);

  // Attempt one action. Dispositions (applyAction return value):
  //  undefined  → applied (or a terminal intentional skip) — journaled done.
  //  'gated'    → declined by a confirm gate / accepted deferral — NOT journaled done, so a
  //               re-run of the SAME plan (e.g. with confirmRetypes:true) actually retries it.
  //  'deferred' → blocked on a dependency that may be created later THIS run — retried below;
  //               its warnings are held back and only surfaced if it never resolves.
  const attempt = async (idx, a) => {
    const warnStart = result.warnings.length;
    try {
      const disposition = await applyAction({ client, destAppId, a, idmap, index, state, result, confirmRetypes });
      if (disposition === 'deferred') return { status: 'deferred', warns: result.warnings.splice(warnStart) };
      if (disposition === 'gated') { result.skipped++; persist(idmap, journal); return { status: 'gated' }; }
      recordDone(journal, idx, a.kind, idmap.tables[a.sourceTableId] ?? (a.sourceFieldId && idmap.fields[a.sourceFieldId]?.destFld));
      persist(idmap, journal);
      return { status: 'done' };
    } catch (e) {
      recordFailed(journal, idx, a.kind, String(e && e.message ? e.message : e));
      result.failed++;
      result.warnings.push({ code: 'ACTION_FAILED', message: `${a.kind} "${a.name ?? a.sourceFieldId ?? a.sourceTableId}": ${e.message ?? e}` });
      persist(idmap, journal);
      // ponytail: continue, don't halt. A failed create's dependents are guarded by the
      // UNRESOLVABLE_REF check; re-run retries non-done actions. Halting on one bad field
      // blocked the entire sync (494 creates never ran behind one failing update).
      return { status: 'failed' };
    }
  };

  const deferred = [];
  for (let idx = 0; idx < plan.actions.length; idx++) {
    const a = plan.actions[idx];
    if (isDone(journal, idx)) { result.skipped++; continue; }
    if (a.apply === false || skipSet.has(a.changeId)) { result.skipped++; continue; }
    const r = await attempt(idx, a);
    if (r.status === 'deferred') deferred.push({ idx, a, warns: r.warns });
  }

  // Deferred-dependency retry: an action blocked on a not-yet-created table/field (link to a
  // later table, computed field referencing a later field, computed primary referencing its
  // siblings) is retried after the rest of the plan ran — loop until a pass makes no progress.
  let progress = true;
  while (progress && deferred.length) {
    progress = false;
    for (let i = 0; i < deferred.length; ) {
      const d = deferred[i];
      const r = await attempt(d.idx, d.a);
      if (r.status === 'deferred') { d.warns = r.warns; i++; continue; }
      deferred.splice(i, 1);
      progress = true;
    }
  }
  // Never resolved this run: surface the held-back warnings and count skipped. NOT journaled
  // done — a re-run (or re-plan) retries once the dependency becomes resolvable.
  for (const d of deferred) {
    result.warnings.push(...d.warns);
    result.skipped++;
  }
  if (deferred.length) persist(idmap, journal);
  return result;
}

async function applyAction({ client, destAppId, a, idmap, index, state, result, confirmRetypes }) {
  switch (a.kind) {
    case 'createTable': {
      const existing = index.tablesByName.get(a.name);
      if (existing) { idmap.tables[a.sourceTableId] = existing.id; result.skipped++; return; }
      const { tableId } = await client.createTable(destAppId, a.name);
      idmap.tables[a.sourceTableId] = tableId;
      state.createdTables.add(tableId); // its primary is an empty placeholder → retype ungated
      // D1: delete the auto-created non-primary scaffolding fields for a clean mirror.
      const { primaryId, primary, cols, views } = await readTable(client, destAppId, tableId);
      for (const c of cols) {
        if (c.id === primaryId) continue;
        await client.deleteField(destAppId, c.id, c.name);
      }
      // D1b: delete the auto-created blank scaffolding ROWS (Airtable seeds ~3 on create) — the table
      // holds only scaffolding at this point (records sync runs later), so a full clear is safe and
      // keeps the mirror clean. Best-effort: a failure here must not abort the table create.
      try {
        const viewId = (views || [])[0]?.id;
        if (viewId) {
          const rowIds = ((await client.queryRecords(destAppId, tableId, viewId)).summary?.rows || []).map((r) => r.id);
          if (rowIds.length) await client.deleteRecords(destAppId, tableId, rowIds, { viewId });
        }
      } catch (e) {
        result.warnings.push({ code: 'SCAFFOLDING_ROWS_KEPT', message: `Table "${a.name}": could not remove default scaffolding rows: ${e.message ?? e}` });
      }
      const entry = {
        id: tableId, name: a.name, primaryFieldId: primaryId,
        fieldsByName: new Map([[primary.name, { id: primaryId, name: primary.name, type: primary.type, typeOptions: primary.typeOptions ?? null }]]),
        // include the auto-created default view(s) so a same-run createView adopts (not duplicates) them
        viewsByName: new Map((views || []).map((v) => [v.name, { id: v.id, type: v.type }])),
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
      let renamed = false, retyped = false, disposition;
      if (primary && primary.name !== a.toName) { await client.renameField(destAppId, primaryId, a.toName); renamed = true; }
      if (a.toType && primary && primary.type !== a.toType) {
        if (ILLEGAL_PRIMARY_TYPES.has(a.toType)) {
          result.warnings.push({ code: 'PRIMARY_TYPE_INCOMPATIBLE', message: `Primary "${a.toName}" wants ${a.toType}; kept ${primary.type} placeholder` });
        } else if (!confirmRetypes && !state.createdTables.has(destTableId)) {
          // Retyping a PRE-EXISTING table's primary is a lossy conversion of real data — honor
          // the same confirmRetypes gate as non-primary scalar retypes. (A table created this
          // run has an empty placeholder primary, so its retype is safe and stays ungated.)
          result.warnings.push({ code: 'RETYPE_GATED', message: `Primary "${a.toName}": retype ${primary.type}→${a.toType} gated — set confirmRetypes:true` });
          disposition = 'gated';
        } else {
          let toOpts = remapRefs(a.toTypeOptions, idmap);
          if (COMPUTED_TYPES.has(a.toType)) {
            // Same contract as createField/updateField: computed configs must be written in the
            // WRITABLE shape (raw snapshot options carry read-only formulaTextParsed/dependencies/
            // resultType the API 422s on). reconcilePrimary runs right after createTable — before
            // sibling fields exist — so defer until the refs are created later this run.
            const refs = (a.toTypeOptions && a.toTypeOptions.dependencies && a.toTypeOptions.dependencies.referencedColumnIdsForValue) || [];
            const unresolved = refs.filter((d) => !(idmap.fields[d] && idmap.fields[d].destFld));
            if (unresolved.length) {
              result.warnings.push({ code: 'UNRESOLVABLE_REF', message: `Primary "${a.toName}" retype to ${a.toType} deferred — refs [${unresolved.join(', ')}] not yet created` });
              disposition = 'deferred';
            } else {
              toOpts = toWritableComputedOptions(a.toType, toOpts);
            }
          } else if (a.toType === 'autoNumber') {
            // maxUsedAutoNumber is a read-only runtime counter (same strip as createField).
            const { maxUsedAutoNumber, ...rest } = toOpts || {};
            toOpts = rest;
          }
          if (!disposition) {
            try { await client.updateFieldConfig(destAppId, primaryId, { type: a.toType, typeOptions: toOpts }); retyped = true; }
            catch (e) { result.warnings.push({ code: 'PRIMARY_TYPE_INCOMPATIBLE', message: `Primary "${a.toName}" retype to ${a.toType} rejected: ${e.message ?? e}` }); }
          }
        }
      }
      idmap.fields[a.sourcePrimaryFieldId] = { destFld: primaryId, choices: {} };
      if (primary) {
        if (renamed) { entry.fieldsByName.delete(primary.name); primary.name = a.toName; entry.fieldsByName.set(a.toName, primary); }
        if (retyped) primary.type = a.toType;
      }
      if (disposition) return disposition; // gated/deferred retype: NOT journaled done → retryable
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
        // Adoption: the dest field already exists with its own choice ids — register the real
        // name-matched map so the same-run records phase can write select cells.
        idmap.fields[a.sourceFieldId] = { destFld: existing.id, choices: matchChoicesByName(a.typeOptions, existing.typeOptions) };
        result.skipped++;
        return;
      }
      if (LINK_TYPES.has(a.type)) {
        // A link whose target table has no dest counterpart yet (created later in this plan, or
        // skipped) must not be sent — the payload would carry the SOURCE base's tbl id. Defer:
        // retried after the remaining createTable actions this run; else surfaced + retryable.
        const foreignSrc = a.typeOptions && a.typeOptions.foreignTableId;
        if (foreignSrc && !idmap.tables[foreignSrc]) {
          result.warnings.push({ code: 'UNRESOLVABLE_REF', message: `Link field "${a.name}" targets table ${foreignSrc} with no dest counterpart (not yet created or skipped) — not created` });
          return 'deferred';
        }
        // Reciprocal-once: adopt the auto-created reverse of this link's already-created forward.
        if (await adoptReverseLink({ client, destAppId, a, idmap, index, state, result })) return;
      }

      const remapped = remapRefs(a.typeOptions, idmap);
      let typeOptions = remapped;
      if (LINK_TYPES.has(a.type)) {
        typeOptions = writableLinkOptions(remapped);
      } else if (COMPUTED_TYPES.has(a.type)) {
        const unresolved = (a.dependsOn || []).filter((d) => !(idmap.fields[d] && idmap.fields[d].destFld));
        if (unresolved.length) {
          result.warnings.push({ code: 'UNRESOLVABLE_REF', message: `Field "${a.name}" references unresolved field(s) [${unresolved.join(', ')}] (skipped or unmapped) — not created` });
          return 'deferred'; // retried this run once the refs are created; else retryable next run
        }
        typeOptions = toWritableComputedOptions(a.type, remapped);
        if (a.type === 'formula') {
          const v = await client.validateFormula(destAppId, destTableId, typeOptions.formulaText ?? '');
          if (!v.valid) throw new Error(`formula invalid: ${v.message ?? v.error ?? 'rejected'}`);
        }
      }
      if (a.type === 'autoNumber') {
        // maxUsedAutoNumber is a read-only runtime counter — the internal API rejects it on create.
        // The dest base starts its own auto-numbering; strip it so the field creates cleanly.
        const { maxUsedAutoNumber, ...rest } = typeOptions || {};
        typeOptions = rest;
      }
      const { columnId } = await client.createField(destAppId, destTableId, { name: a.name, type: a.type, typeOptions, description: a.description ?? undefined });
      let createdTypeOptions = typeOptions;
      let choices = {};
      if (SELECT_TYPES.has(a.type)) {
        // The server may re-key the choices it was sent (createField's response does not
        // reliably echo the column), so re-read the AUTHORITATIVE dest schema and name-match.
        // Without this the idmap carried choices:{} and the same-run records phase skipped
        // every select/multiSelect cell of the new field. Best-effort: a failed re-read must
        // not fail the create — the next plan's matchByName repopulates the map.
        try {
          const { cols } = await readTable(client, destAppId, destTableId);
          const createdCol = cols.find((c) => c.id === columnId);
          if (createdCol) createdTypeOptions = createdCol.typeOptions ?? createdTypeOptions;
          choices = matchChoicesByName(a.typeOptions, createdCol && createdCol.typeOptions);
        } catch (e) {
          result.warnings.push({ code: 'CHOICE_MAP_UNRESOLVED', message: `Field "${a.name}": could not read back created choices (${e.message ?? e}) — select cells may be skipped this run` });
        }
      }
      idmap.fields[a.sourceFieldId] = { destFld: columnId, choices };
      if (entry) entry.fieldsByName.set(a.name, { id: columnId, name: a.name, type: a.type, typeOptions: createdTypeOptions });
      result.created++;
      return;
    }

    case 'updateField': {
      const changes = a.changes || {};
      if (changes.type !== undefined) {
        const destType = findDestFieldType(index, a.destFld);
        const fname = findDestField(index, a.destFld)?.name ?? a.destFld;
        // A gated/deferred retype still applies the non-destructive parts of the action
        // (description) and returns 'gated' so it is NOT journaled done — a re-run of the
        // same plan (e.g. with confirmRetypes:true) retries it.
        if (!SCALAR_RETYPE_TYPES.has(changes.type) || !SCALAR_RETYPE_TYPES.has(destType)) {
          result.warnings.push({ code: 'RETYPE_DEFERRED', message: `Field "${fname}": retype ${destType}→${changes.type} deferred (non-scalar)` });
          if (changes.description !== undefined) await client.updateFieldDescription(destAppId, a.destFld, changes.description);
          return 'gated';
        }
        if (!confirmRetypes) {
          result.warnings.push({ code: 'RETYPE_GATED', message: `Field "${fname}": scalar retype ${destType}→${changes.type} gated — set confirmRetypes:true` });
          if (changes.description !== undefined) await client.updateFieldDescription(destAppId, a.destFld, changes.description);
          return 'gated';
        }
        const newOpts = changes.typeOptions ? mergeChoices(findDestField(index, a.destFld), remapRefs(changes.typeOptions, idmap)) : undefined;
        try {
          await client.updateFieldConfig(destAppId, a.destFld, { type: changes.type, typeOptions: newOpts });
          const f = findDestField(index, a.destFld); if (f) { f.type = changes.type; if (newOpts) f.typeOptions = newOpts; }
          result.retyped++;
        } catch (e) {
          result.warnings.push({ code: 'RETYPE_FAILED', message: `Field "${fname}": retype to ${changes.type} rejected: ${e.message ?? e}` });
          return;
        }
        if (changes.name !== undefined) { await client.renameField(destAppId, a.destFld, changes.name); const f2 = findDestField(index, a.destFld); if (f2) f2.name = changes.name; }
        if (changes.description !== undefined) { await client.updateFieldDescription(destAppId, a.destFld, changes.description); }
        return;
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

    case 'createView': {
      const destTableId = idmap.tables[a.sourceTableId];
      const entry = index.tablesById.get(destTableId);
      const existing = entry && entry.viewsByName.get(a.name);
      if (existing) { idmap.views[a.sourceViewId] = existing.id; result.skipped++; return; }
      const template = entry && [...entry.viewsByName.values()][0]; // dest table always has ≥1 view
      const { viewId } = await client.createView(destAppId, destTableId, { name: a.name, type: a.type, copyFromViewId: template ? template.id : undefined });
      idmap.views[a.sourceViewId] = viewId;
      if (entry) entry.viewsByName.set(a.name, { id: viewId, type: a.type });
      result.created++;
      return;
    }

    case 'applyViewConfig': {
      const destViewId = idmap.views[a.sourceViewId];
      if (!destViewId) { result.skipped++; return; } // view not created (e.g. createView failed)
      const cfg = remapViewConfig(a.config || {}, idmap);
      const strippedRefs = collectFilterRecordRefs(a.config || {});
      if (strippedRefs.length) result.warnings.push({ code: 'VIEW_UNRESOLVABLE_RECORD_REF', message: `View ${destViewId} filters: ${strippedRefs.length} record/collaborator-ref clause(s) dropped (records not synced; row set will differ from source)` });
      const refOk = (id) => !!(id && findDestField(index, id));
      const warnRef = (facet) => result.warnings.push({ code: 'VIEW_UNRESOLVABLE_REF', message: `View ${destViewId} ${facet}: unresolved field ref dropped` });

      // Anchor validation (PROBE-VERIFIED): kanban stack = groupLevels[0].columnId; calendar = dateColumnRanges startColumnId.
      let anchorOk = true;
      if (a.type === 'kanban') { const stack = cfg.groupLevels && cfg.groupLevels[0] && cfg.groupLevels[0].columnId; anchorOk = !!(stack && refOk(stack) && VIEW_GROUP_ANCHOR.has(findDestFieldType(index, stack))); }
      else if (a.type === 'calendar') anchorOk = !!(cfg.calendar && cfg.calendar.dateColumnRanges && cfg.calendar.dateColumnRanges.every((r) => refOk(r.startColumnId)));
      if (!anchorOk) result.warnings.push({ code: 'VIEW_ANCHOR_FALLBACK', message: `View ${destViewId} (${a.type}) missing/incompatible anchor → grid-safe config only` });

      const tryFacet = async (name, fn) => { try { await fn(); } catch (e) { result.warnings.push({ code: 'VIEW_FACET_FAILED', message: `View ${destViewId} ${name}: ${e.message ?? e}` }); } };

      // Grid-safe facets (always; drop unresolved-ref ones).
      // Always push filters/sorts/groups to MATCH source — clearing the dest when source has
      // none (a stray dest filter/sort/group source lacks would otherwise never converge).
      await tryFacet('filters', () => client.updateViewFilters(destAppId, destViewId, cfg.filters || { filterSet: [], conjunction: 'and' }));
      if (!cfg.sorts || cfg.sorts.every((s) => refOk(s.columnId))) await tryFacet('sorts', () => client.applySorts(destAppId, destViewId, cfg.sorts || [])); else warnRef('sorts');
      if (!cfg.groupLevels || cfg.groupLevels.every((g) => refOk(g.columnId))) await tryFacet('groups', () => client.updateGroupLevels(destAppId, destViewId, cfg.groupLevels || [])); else warnRef('groups');
      if (cfg.columnOrder && cfg.columnOrder.length) {
        const visible = cfg.columnOrder.filter((c) => c.visibility && refOk(c.columnId)).map((c) => c.columnId);
        await tryFacet('columns', () => client.setViewColumns(destAppId, destViewId, { visibleColumnIds: visible, frozenColumnCount: cfg.frozenColumnCount }));
      } else if (typeof cfg.frozenColumnCount === 'number') {
        await tryFacet('frozen', () => client.updateFrozenColumnCount(destAppId, destViewId, cfg.frozenColumnCount));
      }
      if (cfg.rowHeight) await tryFacet('rowHeight', () => client.updateRowHeight(destAppId, destViewId, cfg.rowHeight));

      // Type-specific facets — only when the anchor validated.
      if (anchorOk && cfg.colorConfig && refOk(cfg.colorConfig.selectColumnId)) await tryFacet('color', () => client.setViewColorConfig(destAppId, destViewId, cfg.colorConfig));
      if (anchorOk && cfg.cover && refOk(cfg.cover.coverColumnId)) await tryFacet('cover', () => client.setViewCover(destAppId, destViewId, cfg.cover));
      if (anchorOk && cfg.calendar && cfg.calendar.dateColumnRanges && cfg.calendar.dateColumnRanges.every((r) => refOk(r.startColumnId))) await tryFacet('calendar', () => client.setCalendarDateColumns(destAppId, destViewId, cfg.calendar.dateColumnRanges));
      if (cfg.form) await tryFacet('form', () => client.setFormMetadata(destAppId, destViewId, cfg.form));

      result.updated++;
      return;
    }

    default:
      throw new Error(`unhandled action kind: ${a.kind}`);
  }
}
