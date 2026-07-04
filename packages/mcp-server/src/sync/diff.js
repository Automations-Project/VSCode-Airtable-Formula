import { canonicalizeViewConfig } from './remap.js';
import { stableStringify, choiceNames, scalarTypeOptionsChanged, computedSig, fieldSignature, linkSig } from './field-compare.js';

/**
 * Build a flat map of { fieldId → fieldName } across all tables in a snapshot.
 * @param {{ tables: Array<{fields: Array<{id:string, name:string}>}> }} snap
 * @returns {Record<string, string>}
 */
function fldNameMap(snap) {
  const m = {};
  for (const t of snap.tables) for (const f of t.fields) m[f.id] = f.name;
  return m;
}

/**
 * Build a flat map of { choiceId → choiceName } across all select-like fields in a snapshot.
 * @param {{ tables: Array<{fields: Array<{typeOptions: object|null}>}> }} snap
 * @returns {Record<string, string>}
 */
function selNameMap(snap) {
  const m = {};
  for (const t of snap.tables) for (const f of t.fields) {
    const ch = f.typeOptions && f.typeOptions.choices;
    if (ch) for (const c of Object.values(ch)) m[c.id] = c.name;
  }
  return m;
}

/** Return only collaborative (non-personal) views from a table. */
function collabViews(table) { return (table.views || []).filter((v) => !v.personalForUserId); }

/** Link-type fields must be created after plain scalar fields. Computed last. */
const LINK_TYPES = new Set(['multipleRecordLinks', 'foreignKey']);
function fieldOrder(f) { return f.isComputed ? 2 : (LINK_TYPES.has(f.type) ? 1 : 0); }

/**
 * Collect all field IDs referenced by a field (formula tokens, link columns, etc.)
 * so the executor can topologically sort creation order.
 * @param {{ typeOptions: object|null }} field
 * @returns {string[]}
 */
function referencedFieldIds(field) {
  const o = field.typeOptions || {};
  const ids = new Set();
  const deps = o.dependencies?.referencedColumnIdsForValue;
  if (Array.isArray(deps)) deps.forEach((id) => ids.add(id));
  for (const k of ['relationColumnId', 'recordLinkFieldId', 'foreignTableRollupColumnId', 'fieldIdInLinkedTable']) {
    if (o[k]) ids.add(o[k]);
  }
  const formula = o.formulaTextParsed ?? o.formulaText ?? '';
  if (typeof formula === 'string') (formula.match(/fld[A-Za-z0-9]+/g) || []).forEach((id) => ids.add(id));
  return [...ids];
}

/**
 * Build a flat map of { tableId → tableName } for a snapshot (link canonical compare).
 * @param {{ tables: Array<{id:string, name:string}> }} snap
 * @returns {Record<string, string>}
 */
function tblNameMap(snap) {
  const m = {};
  for (const t of snap.tables) m[t.id] = t.name;
  return m;
}

/**
 * Collect table IDs that a link field's typeOptions references.
 * Reuses LINK_TYPES which is already authoritative for ordering.
 * @param {{ type:string, typeOptions:object|null }} field
 * @returns {string[]}
 */
function referencedTableIds(field) {
  const o = field.typeOptions || {};
  const ids = [];
  if (LINK_TYPES.has(field.type) && o.foreignTableId) ids.push(o.foreignTableId);
  return ids;
}

// NOTE (contract for the apply engine): every `typeOptions` / formula text in
// the emitted actions (createField, updateField.changes, reconcilePrimary.toTypeOptions)
// is in SOURCE id-space — it contains source `fld…`/`tbl…` IDs. The apply engine MUST
// remap these to destination IDs via `plan.idmap` (and defer refs whose target field
// is created in the same run) before sending them to Airtable. remap.js is the intended
// single source of truth for that rewrite.

/**
 * Build a createField action for a source field.
 * @param {{ id:string }} srcTable
 * @param {{ id:string, name:string, type:string, typeOptions:object|null, isComputed:boolean }} f
 * @returns {object}
 */
function makeCreateField(srcTable, f) {
  return {
    kind: 'createField',
    sourceTableId: srcTable.id,
    sourceFieldId: f.id,
    name: f.name,
    type: f.type,
    typeOptions: f.typeOptions,
    description: f.description,
    computed: f.isComputed,
    dependsOn: referencedFieldIds(f),
    dependsOnTables: referencedTableIds(f),
  };
}

/**
 * Compute a schema-sync plan by diffing source and dest snapshots.
 *
 * The plan contains:
 * - `actions` — ordered list of schema mutations needed to bring dest up to date with src.
 *   Action kinds (in emission order):
 *   - `createTable`       — dest has no table by this name; create it.
 *   - `reconcilePrimary`  — emitted immediately after createTable (or when the primary
 *                           field name/type diverges on an existing table).
 *   - `createField`       — field exists in src but not in dest (for this table).
 *   - `updateField`       — field exists in both but has diverged (type / typeOptions /
 *                           description differ); carries a `changes` map of what to update.
 * - `orphans` — dest tables/fields with no counterpart in src (reported only, never mutated).
 * - `warnings` — non-fatal issues such as duplicate field names in src or approaching
 *                Airtable's 500-field-per-table limit.
 *
 * @param {{ baseId:string, tables: Array<{id:string, name:string, primaryFieldId:string, fields:Array<{id:string,name:string,type:string,typeOptions:object|null,description:string|null,isComputed:boolean}>}> }} srcSnap
 * @param {{ baseId:string, tables: Array<{id:string, name:string, primaryFieldId:string, fields:Array<{id:string,name:string,type:string,typeOptions:object|null,description:string|null,isComputed:boolean}>}> }} destSnap
 * @param {{ tables: Record<string,string>, fields: Record<string,{destFld:string,choices:Record<string,string>}> }} idmap
 * @returns {{ sourceBaseId:string, destBaseId:string, idmap:object, actions:object[], orphans:object[], warnings:object[] }}
 */
export function computePlan(srcSnap, destSnap, idmap) {
  const actions = [];
  const orphans = [];
  const warnings = [];

  const srcNames = fldNameMap(srcSnap);
  const destNames = fldNameMap(destSnap);
  const srcTblNames = tblNameMap(srcSnap);
  const destTblNames = tblNameMap(destSnap);
  const destTablesById = new Map(destSnap.tables.map((t) => [t.id, t]));

  // ── Duplicate-name detection in src (warn; first-occurrence wins in idmap) ──
  for (const st of srcSnap.tables) {
    const seen = new Set();
    for (const f of st.fields) {
      if (seen.has(f.name)) {
        warnings.push({ code: 'DUPLICATE_NAME', message: `Table "${st.name}" has duplicate field name "${f.name}"` });
      }
      seen.add(f.name);
    }
  }

  // ── Per-table diff ────────────────────────────────────────────────────────
  for (const st of srcSnap.tables) {
    const destTableId = idmap.tables[st.id];
    const destTable = destTableId ? destTablesById.get(destTableId) : null;

    if (!destTable) {
      // Table doesn't exist in dest → create it + all its fields.
      actions.push({ kind: 'createTable', sourceTableId: st.id, name: st.name });

      const primary = st.fields.find((f) => f.id === st.primaryFieldId) || st.fields[0];
      if (primary) {
        actions.push({
          kind: 'reconcilePrimary',
          sourceTableId: st.id,
          sourcePrimaryFieldId: primary.id,
          toName: primary.name,
          toType: primary.type,
          toTypeOptions: primary.typeOptions,
        });
      }

      // Non-primary fields sorted: scalars → links → computed.
      const rest = st.fields.filter((f) => f !== primary);
      for (const f of [...rest].sort((a, b) => fieldOrder(a) - fieldOrder(b))) {
        actions.push(makeCreateField(st, f));
      }
      continue;
    }

    // Table exists — reconcile primary if name or type diverged.
    const srcPrimary = st.fields.find((f) => f.id === st.primaryFieldId);
    const destPrimary = destTable.fields.find((f) => f.id === destTable.primaryFieldId);
    if (
      srcPrimary && destPrimary &&
      (srcPrimary.name !== destPrimary.name || srcPrimary.type !== destPrimary.type)
    ) {
      actions.push({
        kind: 'reconcilePrimary',
        sourceTableId: st.id,
        sourcePrimaryFieldId: srcPrimary.id,
        toName: srcPrimary.name,
        toType: srcPrimary.type,
        toTypeOptions: srcPrimary.typeOptions,
      });
    }

    // Index dest fields by name for O(1) lookup.
    const destFieldsByName = new Map(destTable.fields.map((f) => [f.name, f]));

    const newFields = [];
    for (const sf of st.fields) {
      if (sf.id === st.primaryFieldId) continue; // primary handled above

      const df = destFieldsByName.get(sf.name);
      if (!df) {
        newFields.push(sf);
        continue;
      }

      // Field exists in both — compare signatures.
      if (fieldSignature(sf, srcNames) !== fieldSignature(df, destNames)) {
        const changes = {};
        if (sf.type !== df.type) changes.type = sf.type;
        // For computed fields, only flag typeOptions when the canonical (ID-stable)
        // options differ — not when field IDs merely differ across bases.
        // For scalar fields, use a raw stable-stringify comparison.
        if (sf.isComputed) {
          if (computedSig(sf, srcNames) !== computedSig(df, destNames)) {
            changes.typeOptions = sf.typeOptions;
          }
        } else if (LINK_TYPES.has(sf.type) && LINK_TYPES.has(df.type)) {
          // Link fields: raw typeOptions carry base-local ids (foreignTableId,
          // symmetricColumnId) that NEVER match cross-base — compare the canonical
          // remap-aware identity instead, so updateField is emitted only on REAL
          // divergence (e.g. the link points at a different-named table).
          if (linkSig(sf, srcTblNames) !== linkSig(df, destTblNames)) {
            changes.typeOptions = sf.typeOptions;
          }
        } else if (scalarTypeOptionsChanged(sf, df)) {
          changes.typeOptions = sf.typeOptions;
        }
        if ((sf.description ?? null) !== (df.description ?? null)) {
          changes.description = sf.description;
        }
        if (Object.keys(changes).length > 0) {
          actions.push({ kind: 'updateField', sourceFieldId: sf.id, destFld: df.id, changes });
        }
      }
    }

    // Emit new fields in dependency-safe order.
    for (const f of newFields.sort((a, b) => fieldOrder(a) - fieldOrder(b))) {
      actions.push(makeCreateField(st, f));
    }

    // Warn if we'd push dest past Airtable's 500-field cap.
    if (destTable.fields.length + newFields.length > 500) {
      warnings.push({ code: 'FIELD_CAP', message: `Table "${st.name}" would exceed 500 fields` });
    }
  }

  // ── Orphan detection: dest tables/fields not matched by any src counterpart ──
  const srcTableByDestId = new Map(Object.entries(idmap.tables).map(([s, d]) => [d, s]));
  const srcTablesById = new Map(srcSnap.tables.map((t) => [t.id, t]));

  for (const dt of destSnap.tables) {
    const srcTableId = srcTableByDestId.get(dt.id);
    if (!srcTableId) {
      orphans.push({ kind: 'table', destId: dt.id, name: dt.name });
      continue;
    }
    const srcTable = srcTablesById.get(srcTableId);
    const srcNamesSet = new Set(srcTable.fields.map((f) => f.name));
    for (const df of dt.fields) {
      if (!srcNamesSet.has(df.name)) {
        orphans.push({ kind: 'field', destId: df.id, name: df.name, tableName: dt.name });
      }
    }
  }

  // ── View diff (collaborative only; appended AFTER all field/table actions) ──
  const srcSelNames = selNameMap(srcSnap);
  const destSelNames = selNameMap(destSnap);
  const viewActions = [];
  for (const st of srcSnap.tables) {
    const destTableId = idmap.tables[st.id];
    const destTable = destTableId ? destTablesById.get(destTableId) : null;
    const destViewsByName = destTable ? new Map(collabViews(destTable).map((v) => [v.name, v])) : new Map();
    for (const sv of (st.views || [])) {
      if (sv.personalForUserId) { warnings.push({ code: 'VIEW_PERSONAL_SKIPPED', message: `Personal view "${sv.name}" in "${st.name}" skipped` }); continue; }
      const dv = destViewsByName.get(sv.name);
      if (!dv) {
        viewActions.push({ kind: 'createView', sourceTableId: st.id, sourceViewId: sv.id, name: sv.name, type: sv.type });
        viewActions.push({ kind: 'applyViewConfig', sourceTableId: st.id, sourceViewId: sv.id, type: sv.type, config: sv.config || {} });
      } else if (canonicalizeViewConfig(sv.config || {}, srcNames, srcSelNames, true, idmap) !== canonicalizeViewConfig(dv.config || {}, destNames, destSelNames, false, idmap)) {
        viewActions.push({ kind: 'applyViewConfig', sourceTableId: st.id, sourceViewId: sv.id, type: sv.type, config: sv.config || {} });
      }
    }
  }
  actions.push(...viewActions);

  // View orphans: dest-only collaborative views in a matched table.
  for (const dt of destSnap.tables) {
    const srcTableId = srcTableByDestId.get(dt.id);
    if (!srcTableId) continue; // whole table is already a table orphan
    const srcTable = srcTablesById.get(srcTableId);
    const srcViewNames = new Set(collabViews(srcTable).map((v) => v.name));
    for (const dv of collabViews(dt)) if (!srcViewNames.has(dv.name)) orphans.push({ kind: 'view', destId: dv.id, name: dv.name, tableName: dt.name });
  }

  // Section orphans: dest-only sidebar sections in a matched table (by name).
  for (const dt of destSnap.tables) {
    const srcTableId = srcTableByDestId.get(dt.id);
    if (!srcTableId) continue; // whole table is already a table orphan
    const srcTable = srcTablesById.get(srcTableId);
    const srcSectionNames = new Set((srcTable.sections || []).map((s) => s.name));
    for (const ds of (dt.sections || [])) {
      if (ds.id && !srcSectionNames.has(ds.name)) {
        orphans.push({ kind: 'section', destId: ds.id, name: ds.name, tableName: dt.name });
      }
    }
  }

  // ── Annotate every action with a stable changeId + class + apply ─────────
  // Build resolution maps from srcSnap once (name-based, stable across bases).
  const srcTableNameById = new Map(srcSnap.tables.map((t) => [t.id, t.name]));
  const srcFieldTableName = new Map(); // fieldId → tableName
  const srcFieldName = new Map();      // fieldId → fieldName
  const srcViewName = new Map();       // viewId  → viewName
  for (const t of srcSnap.tables) {
    for (const f of t.fields) {
      srcFieldTableName.set(f.id, t.name);
      srcFieldName.set(f.id, f.name);
    }
    for (const v of (t.views || [])) {
      srcViewName.set(v.id, v.name);
    }
  }

  for (const a of actions) {
    let tableName, targetName;
    switch (a.kind) {
      case 'createTable':
        tableName = a.name;
        targetName = a.name;
        break;
      case 'reconcilePrimary':
        tableName = srcTableNameById.get(a.sourceTableId) ?? a.sourceTableId;
        targetName = tableName;
        break;
      case 'createField':
        tableName = srcTableNameById.get(a.sourceTableId) ?? a.sourceTableId;
        targetName = a.name;
        break;
      case 'updateField':
        // No sourceTableId — resolve via srcFieldId→tableName map.
        tableName = srcFieldTableName.get(a.sourceFieldId) ?? a.sourceFieldId;
        targetName = srcFieldName.get(a.sourceFieldId) ?? a.sourceFieldId;
        break;
      case 'createView':
        tableName = srcTableNameById.get(a.sourceTableId) ?? a.sourceTableId;
        targetName = a.name;
        break;
      case 'applyViewConfig':
        // No name field — resolve view name from sourceViewId.
        tableName = srcTableNameById.get(a.sourceTableId) ?? a.sourceTableId;
        targetName = srcViewName.get(a.sourceViewId) ?? a.sourceViewId;
        break;
      default:
        tableName = a.sourceTableId ?? '';
        targetName = a.name ?? '';
    }
    a.changeId = `${a.kind}|${tableName}|${targetName}`;
    a.class = 'drift';
    a.apply = true;
  }

  return { sourceBaseId: srcSnap.baseId, destBaseId: destSnap.baseId, idmap, actions, orphans, warnings };
}
