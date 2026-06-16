import { canonicalizeComputed } from './remap.js';

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
 * Build a regex that matches any field ID key in the given map, wrapped in
 * curly braces (the Airtable formula token syntax: `{fldXYZ}`).  Returns null
 * if the map is empty.
 * @param {Record<string, string>} idToName
 * @returns {RegExp|null}
 */
function buildIdRegex(idToName) {
  const ids = Object.keys(idToName);
  if (ids.length === 0) return null;
  // Escape each ID and sort longest-first to avoid partial matches.
  const escaped = ids
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'g');
}

/**
 * Replace every occurrence of a field ID found in `idToName` within `str`
 * with `{{<fieldName>}}`.  Handles both bare IDs (in formulaText) and
 * curly-brace-wrapped tokens (`{fldXYZ}` in formulaTextParsed).
 * @param {string} str
 * @param {Record<string, string>} idToName
 * @returns {string}
 */
function subAllIds(str, idToName) {
  if (typeof str !== 'string' || str.length === 0) return str;
  const re = buildIdRegex(idToName);
  if (!re) return str;
  return str.replace(re, (id) => `{{${idToName[id] ?? id}}}`);
}

/**
 * Stable, key-sorted JSON so equal options compare equal regardless of key insertion order.
 * @param {unknown} obj
 * @returns {string}
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',')}}`;
}

/**
 * Description-free canonical signature for a computed field's typeOptions.
 * Normalises all field-ID references to their names so cross-base ID churn is
 * invisible.  Used both by `fieldSignature` (which appends description) and by
 * the `updateField` diff to decide whether typeOptions genuinely changed.
 *
 * @param {{ type:string, typeOptions:object|null }} field
 * @param {Record<string, string>} fldNames  fieldId → name for the relevant base
 * @returns {string}
 */
function computedSig(field, fldNames) {
  const opts = field.typeOptions || {};
  const normalizedOpts = {
    ...opts,
    formulaTextParsed: subAllIds(opts.formulaTextParsed ?? '', fldNames),
    formulaText: subAllIds(opts.formulaText ?? '', fldNames),
    formula: subAllIds(opts.formula ?? '', fldNames),
    relationColumnId: fldNames[opts.relationColumnId ?? ''] ?? opts.relationColumnId ?? '',
    recordLinkFieldId: fldNames[opts.recordLinkFieldId ?? ''] ?? opts.recordLinkFieldId ?? '',
    foreignTableRollupColumnId: fldNames[opts.foreignTableRollupColumnId ?? ''] ?? opts.foreignTableRollupColumnId ?? '',
    fieldIdInLinkedTable: fldNames[opts.fieldIdInLinkedTable ?? ''] ?? opts.fieldIdInLinkedTable ?? '',
  };
  // canonicalizeComputed handles structured extraction; pass empty idToName
  // since we already resolved all IDs above.
  return 'C|' + field.type + '|' + canonicalizeComputed(field.type, normalizedOpts, {});
}

/**
 * Comparable signature for a field.
 * - Computed fields canonicalize field-ID references to field names so
 *   cross-base ID churn is invisible (two formulas that refer to the same-named field
 *   produce identical signatures even if the underlying field IDs differ).
 *   We first run our own ID→name substitution over the formula text (which handles
 *   any ID format, not just `fld`-prefixed ones), then call canonicalizeComputed for
 *   the remaining structured fields (relation, target, result type).
 * - Scalar fields compare type + stable-serialised typeOptions + description.
 *
 * @param {{ type:string, typeOptions:object|null, description:string|null, isComputed:boolean }} field
 * @param {Record<string, string>} fldNames  fieldId → name for the relevant base
 * @returns {string}
 */
function fieldSignature(field, fldNames) {
  if (field.isComputed) {
    return computedSig(field, fldNames) + '|' + (field.description ?? '');
  }
  return 'S|' + field.type + '|' + stableStringify(field.typeOptions ?? null) + '|' + (field.description ?? '');
}

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
        } else if (stableStringify(sf.typeOptions ?? null) !== stableStringify(df.typeOptions ?? null)) {
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

  return { sourceBaseId: srcSnap.baseId, destBaseId: destSnap.baseId, idmap, actions, orphans, warnings };
}
