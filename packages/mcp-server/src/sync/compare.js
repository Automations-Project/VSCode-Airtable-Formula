// compare.js — base-schema comparator helpers (pure: no fs, no network, no Date.now/Math.random)

import { choiceNames, scalarTypeOptionsChanged, computedSig, linkSig } from './field-compare.js';
import { canonicalizeViewConfig } from './remap.js';

const BEST_EFFORT = new Set(['fieldOrder', 'viewOrder', 'columnOrder', 'sortOrder', 'groupOrder']);
const NOT_SYNCED = new Set(['sections']);

/** @type {Record<string, 'drift'|'best-effort'|'not-synced'>} */
export const DIFF_CLASS = new Proxy({}, {
  get(_target, key) { return classOf(key); },
});

/**
 * Classify an attribute key as 'drift', 'best-effort', or 'not-synced'.
 * @param {string} key
 * @returns {'drift'|'best-effort'|'not-synced'}
 */
export function classOf(key) {
  if (BEST_EFFORT.has(key)) return 'best-effort';
  if (NOT_SYNCED.has(key)) return 'not-synced';
  return 'drift';
}

/**
 * Build a flat map of { fieldId → fieldName } for the fields in a table.
 * @param {{ fields: Array<{id:string, name:string}> }} table
 * @returns {Record<string, string>}
 */
function tableFieldNameMap(table) {
  const m = {};
  for (const f of table.fields) m[f.id] = f.name;
  return m;
}

/**
 * Build a flat map of { fieldId → fieldName } across ALL tables in a snapshot.
 * Mirrors diff.js's fldNameMap so computed sigs for cross-table refs (e.g. rollup's
 * foreignTableRollupColumnId) resolve correctly.
 * @param {{ tables: Array<{fields: Array<{id:string, name:string}>}> }} snap
 * @returns {Record<string, string>}
 */
function snapFldNames(snap) {
  const m = {};
  for (const t of snap.tables) for (const f of t.fields) m[f.id] = f.name;
  return m;
}

/**
 * Build a flat map of { tableId → tableName } across all tables in a snapshot.
 * Used to canonicalize link field foreignTableId references for cross-base comparison.
 * @param {{ tables: Array<{id:string, name:string}> }} snap
 * @returns {Record<string, string>}
 */
function snapTblNames(snap) {
  const m = {};
  for (const t of snap.tables) m[t.id] = t.name;
  return m;
}

/**
 * Compare fields between a source table and a destination table using the provided idmap.
 *
 * Matching strategy:
 *  1. For each src field, look up destFld id via idmap.fields[srcField.id].
 *  2. If idmap has no entry for this src field, fall back to matching by field name in dest.
 *
 * For each matched pair, compare:
 *  - type (raw string)
 *  - typeOptions: for computed fields use computedSig (ID-stable); for scalars use scalarTypeOptionsChanged
 *  - choices: using scalarTypeOptionsChanged (which does set-membership for select types)
 *  - description (normalised to null)
 *
 * Also emits one { scope:'table', key:'fieldOrder', class:'best-effort', source, dest } entry
 * when the matched-field name sequence differs between src and dest.
 *
 * @param {{ fields: Array<{id:string, name:string, type:string, typeOptions:object|null, description:string|null, isComputed:boolean}> }} srcTable
 * @param {{ fields: Array<{id:string, name:string, type:string, typeOptions:object|null, description:string|null, isComputed:boolean}> }} destTable
 * @param {{ fields: Record<string, {destFld:string, choices:Record<string,string>}> }} idmap
 * @returns {{ entries: Array<{scope:string, key:string, source:unknown, dest:unknown, class:string}>, onlyInSource: string[], onlyInDest: string[] }}
 */
export function compareFields(srcTable, destTable, idmap, srcGlobalFldNames, destGlobalFldNames, srcGlobalTblNames, destGlobalTblNames) {
  const entries = [];
  const onlyInSource = [];
  const onlyInDest = [];

  // Build name→field map for dest for by-name fallback and unmatched detection.
  const destByName = new Map(destTable.fields.map((f) => [f.name, f]));
  // Track which dest field ids were matched so we can find dest-only fields
  // (using id rather than name prevents a single dest field from being claimed twice
  // if two src fields share the same name in an edge case).
  const matchedDestIds = new Set();

  // Build id→name maps for computed sig resolution.
  // Use snapshot-global maps (passed in from compare()/compareTable()) so that
  // cross-table refs (e.g. rollup's foreignTableRollupColumnId targeting a field in
  // another table) resolve to a name instead of remaining as a raw id.
  // Fall back to table-local if not provided (e.g. direct compareFields() calls in tests).
  const srcFldNames = srcGlobalFldNames ?? tableFieldNameMap(srcTable);
  const destFldNames = destGlobalFldNames ?? tableFieldNameMap(destTable);

  // srcMatchedOrder: matched field names in src iteration order (for fieldOrder check).
  const srcMatchedOrder = [];

  for (const sf of srcTable.fields) {
    // Resolve dest field: idmap first, then by-name fallback.
    let df = null;
    const idmapEntry = idmap.fields && idmap.fields[sf.id];
    if (idmapEntry) {
      df = destTable.fields.find((f) => f.id === idmapEntry.destFld) ?? null;
    }
    if (!df) {
      df = destByName.get(sf.name) ?? null;
    }

    if (!df) {
      onlyInSource.push(sf.name);
      continue;
    }

    matchedDestIds.add(df.id);
    srcMatchedOrder.push(sf.name);

    const scope = `field:${sf.name}`;

    // Compare type.
    if (sf.type !== df.type) {
      entries.push({ scope, key: 'type', source: sf.type, dest: df.type, class: classOf('type') });
    }

    // Compare typeOptions / choices — only when types match.
    // When types differ we already emitted a 'type' entry; comparing typeOptions across
    // incompatible types would produce a spurious second entry (e.g. singleSelect choices
    // vs a number field that has no choices at all).
    if (sf.type === df.type) {
      if (sf.isComputed) {
        // Computed: use canonical, ID-stable sig for typeOptions.
        if (computedSig(sf, srcFldNames) !== computedSig(df, destFldNames)) {
          entries.push({ scope, key: 'typeOptions', source: sf.typeOptions, dest: df.typeOptions, class: classOf('typeOptions') });
        }
      } else if (sf.type === 'foreignKey' || sf.type === 'multipleRecordLinks') {
        // Link fields: canonical remap-aware identity (linkSig, shared with diff.js so
        // mode=diff and mode=plan agree) — foreignTableId resolves to the table NAME;
        // base-scoped symmetricColumnId / viewIdForRecordSelection are dropped entirely.
        const srcTblNames = srcGlobalTblNames ?? {};
        const destTblNames = destGlobalTblNames ?? {};
        if (linkSig(sf, srcTblNames) !== linkSig(df, destTblNames)) {
          entries.push({ scope, key: 'typeOptions', source: sf.typeOptions, dest: df.typeOptions, class: classOf('typeOptions') });
        }
      } else {
        // Scalar: check choices separately (set-membership) and other typeOptions.
        const srcChoices = choiceNames(sf.typeOptions);
        if (srcChoices !== null) {
          // It's a select-type — check via scalarTypeOptionsChanged (choice set membership).
          if (scalarTypeOptionsChanged(sf, df)) {
            entries.push({ scope, key: 'choices', source: sf.typeOptions, dest: df.typeOptions, class: classOf('choices') });
          }
        } else if (scalarTypeOptionsChanged(sf, df)) {
          entries.push({ scope, key: 'typeOptions', source: sf.typeOptions, dest: df.typeOptions, class: classOf('typeOptions') });
        }
      }
    }

    // Compare description (normalised to null).
    const srcDesc = sf.description ?? null;
    const destDesc = df.description ?? null;
    if (srcDesc !== destDesc) {
      entries.push({ scope, key: 'description', source: srcDesc, dest: destDesc, class: classOf('description') });
    }
  }

  // Collect dest-only fields.
  for (const df of destTable.fields) {
    if (!matchedDestIds.has(df.id)) {
      onlyInDest.push(df.name);
    }
  }

  // Check fieldOrder: compare the matched field name sequence in src iteration order
  // vs the same names in their dest table iteration order.
  const destFieldIndex = new Map(destTable.fields.map((f, i) => [f.name, i]));
  const destOrderedMatchedNames = [...srcMatchedOrder].sort(
    (a, b) => (destFieldIndex.get(a) ?? Infinity) - (destFieldIndex.get(b) ?? Infinity),
  );

  if (srcMatchedOrder.join('\0') !== destOrderedMatchedNames.join('\0')) {
    entries.push({
      scope: 'table',
      key: 'fieldOrder',
      source: srcMatchedOrder,
      dest: destOrderedMatchedNames,
      class: 'best-effort',
    });
  }

  return { entries, onlyInSource, onlyInDest };
}

// ── Internal helpers for compareViews / compareTable ──────────────────────────

/**
 * Build { fieldId → fieldName } for a single table's fields.
 * @param {{ fields: Array<{id:string, name:string}> }} table
 * @returns {Record<string,string>}
 */
function tableFldNames(table) {
  const m = {};
  for (const f of (table.fields || [])) m[f.id] = f.name;
  return m;
}

/**
 * Build { choiceId → choiceName } for a single table's select fields.
 * @param {{ fields: Array<{typeOptions:object|null}> }} table
 * @returns {Record<string,string>}
 */
function tableSelNames(table) {
  const m = {};
  for (const f of (table.fields || [])) {
    const ch = f.typeOptions && f.typeOptions.choices;
    if (ch) for (const c of Object.values(ch)) m[c.id] = c.name;
  }
  return m;
}

/**
 * Return only collaborative (non-personal) views.
 * @param {{ views?: Array<{personalForUserId?:string}> }} table
 * @returns {Array}
 */
function collabViews(table) {
  return (table.views || []).filter((v) => !v.personalForUserId);
}

/**
 * Build a column-order sequence (by field name) from a canonicalized config object.
 * The canonical JSON for columns is { visible: string[], hidden: string[] }.
 * Column order is the original ordered list (visible + hidden in appearance order).
 * We reconstruct from the raw config instead since canonical loses order for sets.
 * @param {{ columnOrder?: Array<{columnId:string, visibility:boolean}> }} config
 * @param {Record<string,string>} fldNames
 * @returns {string[]}
 */
function columnOrderNames(config, fldNames) {
  return (config.columnOrder || []).map((co) => fldNames[co.columnId] ?? co.columnId);
}

/**
 * Build a sort-clause sequence (by field name + direction) from raw config.
 * @param {{ sorts?: Array<{columnId:string, ascending:boolean}> }} config
 * @param {Record<string,string>} fldNames
 * @returns {string[]}
 */
function sortOrderKeys(config, fldNames) {
  return (config.sorts || []).map((s) => `${fldNames[s.columnId] ?? s.columnId}:${s.ascending}`);
}

/**
 * Build a group-clause sequence (by field name + order) from raw config.
 * @param {{ groupLevels?: Array<{columnId:string, order:string}> }} config
 * @param {Record<string,string>} fldNames
 * @returns {string[]}
 */
function groupOrderKeys(config, fldNames) {
  return (config.groupLevels || []).map((g) => `${fldNames[g.columnId] ?? g.columnId}:${g.order}`);
}

/**
 * Compare views between a source table and a destination table.
 *
 * Matching strategy (per view):
 *  1. Look up dest view id via idmap.views[srcView.id] — rejected if the types differ
 *     (a view's type is immutable, so a cross-type mapping is stale/name-only noise).
 *  2. Fall back to matching by (view name, view type) in dest. A same-named dest view of
 *     a DIFFERENT type is NOT a counterpart: sync converges by creating the source-typed
 *     view and orphaning the dest one, so it is reported as onlyInSource + onlyInDest.
 *  Personal views (personalForUserId is set) are skipped on both sides.
 *
 * Per matched pair emits DiffEntries with scope `view:<name>`:
 *  - `filters` / `sorts` / `groups` / `columnVisibility` / `frozen` / `color` / `cover` /
 *    `calendar` / `rowHeight` / `form` → class drift (via canonicalizeViewConfig comparison)
 *  - `columnOrder` → class best-effort
 *  - `sortOrder` → class best-effort
 *  - `groupOrder` → class best-effort
 *
 * @param {{ fields: Array, views: Array }} srcTable
 * @param {{ fields: Array, views: Array }} destTable
 * @param {{ views: Record<string,string>, fields: Record<string,{destFld:string,choices:Record<string,string>}> }} idmap
 * @returns {{ entries: Array, onlyInSource: string[], onlyInDest: string[] }}
 */
export function compareViews(srcTable, destTable, idmap) {
  const entries = [];
  const onlyInSource = [];
  const onlyInDest = [];

  const srcFldNames = tableFldNames(srcTable);
  const destFldNames = tableFldNames(destTable);
  const srcSelNames = tableSelNames(srcTable);
  const destSelNames = tableSelNames(destTable);

  const srcViews = collabViews(srcTable);
  const destViews = collabViews(destTable);

  // Build dest view lookup: by id and by (name, type) — a view's type is immutable, so a
  // same-named view of a different type can never converge and must not be adopted.
  const destViewsById = new Map(destViews.map((v) => [v.id, v]));
  const destViewsByNameType = new Map(destViews.map((v) => [`${v.name}|${v.type}`, v]));
  const matchedDestViewIds = new Set();

  for (const sv of srcViews) {
    // Resolve dest view: idmap first (same type only), then by (name, type) fallback.
    let dv = null;
    const mappedDestId = idmap.views && idmap.views[sv.id];
    if (mappedDestId) dv = destViewsById.get(mappedDestId) ?? null;
    if (dv && dv.type !== sv.type) dv = null; // stale name-only mapping across types
    if (!dv) dv = destViewsByNameType.get(`${sv.name}|${sv.type}`) ?? null;

    if (!dv) {
      onlyInSource.push(sv.name);
      continue;
    }
    matchedDestViewIds.add(dv.id);

    const scope = `view:${sv.name}`;
    const srcConfig = sv.config || {};
    const destConfig = dv.config || {};

    // 2. Canonicalize both configs for content comparison.
    //    Source: stripRecordRefs=true (matches what apply will write)
    //    Dest:   stripRecordRefs=false (keep dest's existing record refs so dangling ones diverge)
    const srcCanon = JSON.parse(canonicalizeViewConfig(srcConfig, srcFldNames, srcSelNames, true, idmap));
    const destCanon = JSON.parse(canonicalizeViewConfig(destConfig, destFldNames, destSelNames, false, idmap));

    // 3. Per-facet comparison.
    const filtersSrcStr = JSON.stringify(srcCanon.filters);
    const filtersDestStr = JSON.stringify(destCanon.filters);
    if (filtersSrcStr !== filtersDestStr) {
      entries.push({ scope, key: 'filters', source: srcCanon.filters, dest: destCanon.filters, class: classOf('filters') });
    }

    // sorts content (set + direction, NOT order — order is best-effort below).
    // The canonical `sorts` array is ordered — but we want content equivalence ignoring order.
    // Sort both sides by their name-key for a set-like content comparison.
    const sortsSrcContent = JSON.stringify([...srcCanon.sorts].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    const sortsDestContent = JSON.stringify([...destCanon.sorts].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    if (sortsSrcContent !== sortsDestContent) {
      entries.push({ scope, key: 'sorts', source: srcCanon.sorts, dest: destCanon.sorts, class: classOf('sorts') });
    }

    // groups content.
    const groupsSrcContent = JSON.stringify([...srcCanon.groups].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    const groupsDestContent = JSON.stringify([...destCanon.groups].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    if (groupsSrcContent !== groupsDestContent) {
      entries.push({ scope, key: 'groups', source: srcCanon.groups, dest: destCanon.groups, class: classOf('groups') });
    }

    // column VISIBILITY SET (drift).
    const visSrcStr = JSON.stringify({ visible: srcCanon.columns.visible, hidden: srcCanon.columns.hidden });
    const visDestStr = JSON.stringify({ visible: destCanon.columns.visible, hidden: destCanon.columns.hidden });
    if (visSrcStr !== visDestStr) {
      entries.push({ scope, key: 'columnVisibility', source: srcCanon.columns, dest: destCanon.columns, class: classOf('columnVisibility') });
    }

    // column ORDER (best-effort) — only when visibility sets match.
    if (visSrcStr === visDestStr) {
      const srcColOrder = columnOrderNames(srcConfig, srcFldNames);
      const destColOrder = columnOrderNames(destConfig, destFldNames);
      if (srcColOrder.join('\0') !== destColOrder.join('\0')) {
        entries.push({ scope, key: 'columnOrder', source: srcColOrder, dest: destColOrder, class: classOf('columnOrder') });
      }
    }

    // frozen column count (drift).
    if (srcCanon.frozen !== destCanon.frozen) {
      entries.push({ scope, key: 'frozenColumnCount', source: srcCanon.frozen, dest: destCanon.frozen, class: classOf('frozenColumnCount') });
    }

    // colorConfig (drift).
    if (JSON.stringify(srcCanon.color) !== JSON.stringify(destCanon.color)) {
      entries.push({ scope, key: 'colorConfig', source: srcCanon.color, dest: destCanon.color, class: classOf('colorConfig') });
    }

    // cover (drift).
    if (JSON.stringify(srcCanon.cover) !== JSON.stringify(destCanon.cover)) {
      entries.push({ scope, key: 'cover', source: srcCanon.cover, dest: destCanon.cover, class: classOf('cover') });
    }

    // calendar (drift).
    if (JSON.stringify(srcCanon.calendar) !== JSON.stringify(destCanon.calendar)) {
      entries.push({ scope, key: 'calendar', source: srcCanon.calendar, dest: destCanon.calendar, class: classOf('calendar') });
    }

    // rowHeight (drift).
    if (srcCanon.rowHeight !== destCanon.rowHeight) {
      entries.push({ scope, key: 'rowHeight', source: srcCanon.rowHeight, dest: destCanon.rowHeight, class: classOf('rowHeight') });
    }

    // form (drift).
    if (JSON.stringify(srcCanon.form) !== JSON.stringify(destCanon.form)) {
      entries.push({ scope, key: 'form', source: srcCanon.form, dest: destCanon.form, class: classOf('form') });
    }

    // sort clause ORDER (best-effort) — only when sort content matches.
    // Relies on the canonical {columnId, ascending} shape for sorts and {columnId, order} for groups;
    // extra properties on sort/group objects are intentionally ignored by both sortOrderKeys and groupOrderKeys.
    if (sortsSrcContent === sortsDestContent) {
      const srcSortOrder = sortOrderKeys(srcConfig, srcFldNames);
      const destSortOrder = sortOrderKeys(destConfig, destFldNames);
      if (srcSortOrder.join('\0') !== destSortOrder.join('\0')) {
        entries.push({ scope, key: 'sortOrder', source: srcSortOrder, dest: destSortOrder, class: classOf('sortOrder') });
      }
    }

    // group clause ORDER (best-effort) — only when group content matches.
    if (groupsSrcContent === groupsDestContent) {
      const srcGroupOrder = groupOrderKeys(srcConfig, srcFldNames);
      const destGroupOrder = groupOrderKeys(destConfig, destFldNames);
      if (srcGroupOrder.join('\0') !== destGroupOrder.join('\0')) {
        entries.push({ scope, key: 'groupOrder', source: srcGroupOrder, dest: destGroupOrder, class: classOf('groupOrder') });
      }
    }
  }

  // Collect dest-only views.
  for (const dv of destViews) {
    if (!matchedDestViewIds.has(dv.id)) {
      onlyInDest.push(dv.name);
    }
  }

  return { entries, onlyInSource, onlyInDest };
}

/**
 * Top-level compare: diff two base snapshots and return the full diff tree.
 *
 * Table matching strategy:
 *  1. For each src table, look up dest table id via idmap.tables[srcTable.id].
 *  2. If no idmap entry, fall back to matching by table name in dest.
 *
 * @param {{ baseId: string, tables: Array<{id:string, name:string, primaryFieldId:string, fields:Array, views:Array, sections?:Array}> }} srcSnap
 * @param {{ baseId: string, tables: Array<{id:string, name:string, primaryFieldId:string, fields:Array, views:Array, sections?:Array}> }} destSnap
 * @param {{ tables: Record<string,string>, fields: Record<string,{destFld:string,choices:Record<string,string>}>, views: Record<string,string> }} idmap
 * @returns {{
 *   sourceBaseId: string,
 *   destBaseId: string,
 *   identical: boolean,
 *   converged: boolean,
 *   summary: { drift: number, bestEffort: number, notSynced: number, onlyInSourceTables: number, onlyInDestTables: number },
 *   tables: Array,
 *   onlyInSourceTables: string[],
 *   onlyInDestTables: string[]
 * }}
 */
export function compare(srcSnap, destSnap, idmap) {
  const onlyInSourceTables = [];
  const onlyInDestTables = [];
  const tables = [];

  // Build dest table lookup: by id and by name.
  const destById = new Map(destSnap.tables.map((t) => [t.id, t]));
  const destByName = new Map(destSnap.tables.map((t) => [t.name, t]));
  const matchedDestIds = new Set();

  // Build global field-id→name maps for computed sig resolution across all tables.
  const srcGlobalFldNames = snapFldNames(srcSnap);
  const destGlobalFldNames = snapFldNames(destSnap);
  // Build global table-id→name maps for link field foreignTableId canonicalization.
  const srcGlobalTblNames = snapTblNames(srcSnap);
  const destGlobalTblNames = snapTblNames(destSnap);

  for (const st of srcSnap.tables) {
    // Resolve dest table: idmap first, then by-name fallback.
    let dt = null;
    const mappedDestId = idmap.tables && idmap.tables[st.id];
    if (mappedDestId) dt = destById.get(mappedDestId) ?? null;
    if (!dt) dt = destByName.get(st.name) ?? null;

    if (!dt) {
      onlyInSourceTables.push(st.name);
      continue;
    }
    matchedDestIds.add(dt.id);

    const tableResult = compareTable(st, dt, idmap, srcGlobalFldNames, destGlobalFldNames, srcGlobalTblNames, destGlobalTblNames);
    tables.push(tableResult);
  }

  // Collect dest-only tables.
  for (const dt of destSnap.tables) {
    if (!matchedDestIds.has(dt.id)) {
      onlyInDestTables.push(dt.name);
    }
  }

  // Aggregate counts by class across all entries in all matched tables.
  let drift = 0;
  let bestEffort = 0;
  let notSynced = 0;

  for (const tableResult of tables) {
    for (const entry of tableResult.entries) {
      if (entry.class === 'drift') drift++;
      else if (entry.class === 'best-effort') bestEffort++;
      else if (entry.class === 'not-synced') notSynced++;
    }
  }

  // Compute verdicts.
  const totalEntries = drift + bestEffort + notSynced;
  const identical =
    totalEntries === 0 &&
    onlyInSourceTables.length === 0 &&
    onlyInDestTables.length === 0 &&
    tables.every((t) => t.fields.onlyInSource.length === 0 && t.fields.onlyInDest.length === 0 &&
      t.views.onlyInSource.length === 0 && t.views.onlyInDest.length === 0);
  // converged = the sync would produce no remaining changes.
  // Missing items (onlyInSourceTables, per-table fields.onlyInSource, views.onlyInSource) represent
  // createTable/createField/createView operations the sync WOULD make, so they break convergence.
  // onlyInDest* are orphans — the sync reports but never deletes them, so they must NOT affect converged.
  const converged =
    drift === 0 &&
    onlyInSourceTables.length === 0 &&
    tables.every((t) => t.fields.onlyInSource.length === 0 && t.views.onlyInSource.length === 0);

  return {
    sourceBaseId: srcSnap.baseId,
    destBaseId: destSnap.baseId,
    identical,
    converged,
    summary: {
      drift,
      bestEffort,
      notSynced,
      onlyInSourceTables: onlyInSourceTables.length,
      onlyInDestTables: onlyInDestTables.length,
    },
    tables,
    onlyInSourceTables,
    onlyInDestTables,
  };
}

/**
 * Compare a source table against a dest table using the provided idmap.
 *
 * Covers:
 *  - description drift
 *  - primary field NAME drift
 *  - field-level diffs (via compareFields)
 *  - view-level diffs (via compareViews), incl. view order (best-effort)
 *  - section diffs (not-synced — reported but not acted on)
 *
 * @param {{ id:string, name:string, primaryFieldId:string, description?:string, fields:Array, views:Array, sections?:Array }} srcTable
 * @param {{ id:string, name:string, primaryFieldId:string, description?:string, fields:Array, views:Array, sections?:Array }} destTable
 * @param {{ tables:Record<string,string>, fields:Record<string,{destFld:string,choices:Record<string,string>}>, views:Record<string,string> }} idmap
 * @returns {{ name:string, status:'same'|'differs', entries:Array, fields:{onlyInSource:string[],onlyInDest:string[]}, views:{onlyInSource:string[],onlyInDest:string[]} }}
 */
export function compareTable(srcTable, destTable, idmap, srcGlobalFldNames, destGlobalFldNames, srcGlobalTblNames, destGlobalTblNames) {
  const entries = [];

  // 1. Description drift.
  const srcDesc = srcTable.description ?? null;
  const destDesc = destTable.description ?? null;
  if (srcDesc !== destDesc) {
    entries.push({ scope: 'table', key: 'description', source: srcDesc, dest: destDesc, class: classOf('description') });
  }

  // 2. Primary field NAME drift.
  const srcPrimary = srcTable.fields.find((f) => f.id === srcTable.primaryFieldId);
  const destPrimary = destTable.fields.find((f) => f.id === destTable.primaryFieldId);
  if (srcPrimary && destPrimary && srcPrimary.name !== destPrimary.name) {
    entries.push({ scope: 'table', key: 'primaryFieldName', source: srcPrimary.name, dest: destPrimary.name, class: classOf('primaryFieldName') });
  }

  // 3. Field-level comparison.
  const fieldResult = compareFields(srcTable, destTable, idmap, srcGlobalFldNames, destGlobalFldNames, srcGlobalTblNames, destGlobalTblNames);
  entries.push(...fieldResult.entries);

  // 4. View-level comparison.
  const viewResult = compareViews(srcTable, destTable, idmap);
  entries.push(...viewResult.entries);

  // 5. View ORDER (best-effort): compare matched view name sequence.
  const srcCollabViews = collabViews(srcTable);
  const destCollabViews = collabViews(destTable);
  const srcViewNames = srcCollabViews.map((v) => v.name);
  // Build matched dest view order: for each src view that was matched, find its dest position.
  const destViewsByName = new Map(destCollabViews.map((v, i) => [v.name, i]));
  // Build dest order of matched src views (only matched ones, not onlyInSource).
  const onlySrcSet = new Set(viewResult.onlyInSource);
  const srcMatchedViewNames = srcViewNames.filter((n) => !onlySrcSet.has(n));
  // Sort srcMatchedViewNames by their dest iteration order.
  const destOrderedViewNames = [...srcMatchedViewNames].sort(
    (a, b) => (destViewsByName.get(a) ?? Infinity) - (destViewsByName.get(b) ?? Infinity),
  );
  if (srcMatchedViewNames.join('\0') !== destOrderedViewNames.join('\0')) {
    entries.push({
      scope: 'table',
      key: 'viewOrder',
      source: srcMatchedViewNames,
      dest: destOrderedViewNames,
      class: classOf('viewOrder'),
    });
  }

  // 6. Sections comparison (not-synced) — compare by name+viewNames; ignore the vsc… id.
  const stripId = (arr) => (arr || []).map(({ name, viewNames }) => ({ name, viewNames }));
  const srcSections = srcTable.sections || [];
  const destSections = destTable.sections || [];
  if (JSON.stringify(stripId(srcSections)) !== JSON.stringify(stripId(destSections))) {
    entries.push({
      scope: 'table',
      key: 'sections',
      source: srcSections,
      dest: destSections,
      class: classOf('sections'),
    });
  }

  // 7. Compute status.
  const hasDiffs =
    entries.length > 0 ||
    fieldResult.onlyInSource.length > 0 ||
    fieldResult.onlyInDest.length > 0 ||
    viewResult.onlyInSource.length > 0 ||
    viewResult.onlyInDest.length > 0;

  return {
    name: srcTable.name,
    status: hasDiffs ? 'differs' : 'same',
    entries,
    fields: { onlyInSource: fieldResult.onlyInSource, onlyInDest: fieldResult.onlyInDest },
    views: { onlyInSource: viewResult.onlyInSource, onlyInDest: viewResult.onlyInDest },
  };
}
