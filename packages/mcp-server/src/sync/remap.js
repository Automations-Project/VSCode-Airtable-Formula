// Canonicalize computed-field configs so cross-base comparisons ignore field-ID churn:
// every fld... reference is replaced with the referenced field's name.
const FLD_TOKEN = /fld[A-Za-z0-9]+/g;

function subIds(str, fldIdToName) {
  if (typeof str !== 'string') return str;
  return str.replace(FLD_TOKEN, (id) => `{{${fldIdToName[id] ?? id}}}`);
}

export function canonicalizeComputed(type, typeOptions, fldIdToName) {
  const opts = typeOptions || {};
  // Pull the formula expression under whichever key the API used.
  const formula = opts.formulaTextParsed ?? opts.formulaText ?? opts.formula ?? '';
  const relation = opts.relationColumnId ?? opts.recordLinkFieldId ?? '';
  const target = opts.foreignTableRollupColumnId ?? opts.fieldIdInLinkedTable ?? '';
  return JSON.stringify({
    type,
    formula: subIds(formula, fldIdToName),
    relation: fldIdToName[relation] ?? relation,
    target: fldIdToName[target] ?? target,
    // result aggregation type (rollup) is value-stable across bases
    result: opts.result?.type ?? null,
  });
}

// ── Source→dest reference rewrite (the apply path's single source of truth) ──
function jsonClone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function fldLookup(idmap) {
  const m = {};
  for (const [src, v] of Object.entries(idmap.fields || {})) if (v && v.destFld) m[src] = v.destFld;
  return m;
}
function selLookup(idmap) {
  const m = {};
  for (const v of Object.values(idmap.fields || {})) for (const [s, d] of Object.entries((v && v.choices) || {})) m[s] = d;
  return m;
}

// Replace {column_value_fldXXX} and {fldXXX} tokens inside curly braces only.
// Bare `fldXXX` text outside braces is left untouched — the input form Airtable
// accepts is `{fldXXX}`, NOT the stored `{column_value_fldXXX}`, and bare ids
// outside braces are not formula references.
function subFormulaTokens(str, lookup) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(?:column_value_)?((?:fld|sel)[A-Za-z0-9]+)\}/g, (_m, id) => `{${lookup[id] ?? id}}`);
}

const SINGLE_ID_REF_KEYS = ['relationColumnId', 'recordLinkFieldId', 'foreignTableRollupColumnId', 'fieldIdInLinkedTable'];
const FORMULA_KEYS = ['formulaText', 'formulaTextParsed', 'formula'];

export function remapRefs(typeOptions, idmap) {
  if (typeOptions == null || typeof typeOptions !== 'object') return typeOptions;
  const flds = fldLookup(idmap);
  const refTokens = { ...flds, ...selLookup(idmap) };
  const tbls = idmap.tables || {};
  const out = jsonClone(typeOptions);

  for (const k of FORMULA_KEYS) if (typeof out[k] === 'string') out[k] = subFormulaTokens(out[k], refTokens);
  for (const k of SINGLE_ID_REF_KEYS) if (out[k] && flds[out[k]]) out[k] = flds[out[k]];
  if (out.foreignTableId && tbls[out.foreignTableId]) out.foreignTableId = tbls[out.foreignTableId];
  const dep = out.dependencies && out.dependencies.referencedColumnIdsForValue;
  if (Array.isArray(dep)) out.dependencies.referencedColumnIdsForValue = dep.map((id) => flds[id] ?? id);

  return out;
}

// ── Writable computed payload (strip read-only keys; emit input-form formulaText) ──
const COMPUTED_FORMAT_KEYS = [
  'format', 'precision', 'symbol', 'negative', 'percentV2', 'separatorFormat', 'shouldShowThousandsSeparator',
  'dateFormat', 'timeFormat', 'timeZone', 'isDateTime', 'shouldDisplayTimeZone', 'displayType',
];
function formulaExpr(opts) { return opts.formulaText ?? opts.formulaTextParsed ?? opts.formula ?? ''; }

export function toWritableComputedOptions(type, opts) {
  const o = opts || {};
  const fmt = {};
  for (const k of COMPUTED_FORMAT_KEYS) if (k in o) fmt[k] = o[k];
  switch (type) {
    case 'formula':
      return { formulaText: formulaExpr(o), ...fmt };
    case 'rollup':
      return { relationColumnId: o.relationColumnId, foreignTableRollupColumnId: o.foreignTableRollupColumnId, formulaText: formulaExpr(o), ...fmt };
    case 'lookup':
    case 'multipleLookupValues':
      return { relationColumnId: o.relationColumnId, foreignTableRollupColumnId: o.foreignTableRollupColumnId };
    case 'count':
      // Internal API stores/expects the link under relationColumnId (like rollup); the public
      // REST name recordLinkFieldId is never present in snapshot data and createField passes
      // count typeOptions through untranslated → emit the internal key or it 422s "options not valid".
      return { relationColumnId: o.relationColumnId ?? o.recordLinkFieldId };
    default:
      return o;
  }
}

// ── View-config source→dest rewrite (analogue of remapRefs, for views) ──
function destFldId(idmap, src) { const v = (idmap.fields || {})[src]; return v && v.destFld ? v.destFld : src; }
function destSelId(idmap, src) {
  for (const v of Object.values(idmap.fields || {})) { const d = ((v && v.choices) || {})[src]; if (d) return d; }
  return src;
}
// A filter LEAF whose value references a record/collaborator id — or a structured/dynamic
// value carrying SOURCE field/table/row ids — cannot be resolved in the dest: records and
// users are not synced (and ids differ across bases regardless). Detect by value SHAPE, which
// needs NO source field-type context (those types aren't carried into apply). Portable
// sentinels (current-user "me", null, booleans) are not id-shaped → kept. Forward-compat: once
// records sync (M3), a populated idmap.records lets these REMAP instead of strip — see canon note.
const RECORD_REF_ID = /^(rec|usr)[A-Za-z0-9]{14,}$/;
// Remap a record-ref leaf VALUE via idmap.records.
//  stripUnresolved=true  (source/write path): src rec ids -> dest ids; ids with no mapping are DROPPED;
//                         returns undefined if nothing resolves (caller drops the whole leaf).
//  stripUnresolved=false (dest canonical path): keep values as-is when unmapped (dest already holds dest ids).
function remapRecRefValue(value, idmap, stripUnresolved) {
  const recs = (idmap && idmap.records) || {};
  // Structured/dynamic objects (columnId/rowId/tableId) carry source-side ids that can't be
  // remapped from a records map — treat as unresolvable: drop on write path, keep on dest path.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return stripUnresolved ? undefined : value;
  }
  const mapOne = (v) => (typeof v === 'string' ? (recs[v] ?? (stripUnresolved ? undefined : v)) : v);
  if (Array.isArray(value)) {
    const out = value.map(mapOne).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  return mapOne(value);
}
function isRecordRefValue(value) {
  if (typeof value === 'string') return RECORD_REF_ID.test(value);
  if (Array.isArray(value)) return value.some((v) => typeof v === 'string' && RECORD_REF_ID.test(v));
  if (value && typeof value === 'object') return 'columnId' in value || 'rowId' in value || 'tableId' in value;
  return false;
}
function collectRecordRefIds(set) {
  const ids = [];
  for (const f of set || []) {
    if (f.filterSet) { ids.push(...collectRecordRefIds(f.filterSet)); continue; }
    if (!isRecordRefValue(f.value)) continue;
    if (typeof f.value === 'string') ids.push(f.value);
    else if (Array.isArray(f.value)) ids.push(...f.value.filter((v) => typeof v === 'string' && RECORD_REF_ID.test(v)));
    else ids.push('<dynamic>');
  }
  return ids;
}
// Source record/collaborator ids that view-filter strip will drop (for the apply-side warning).
export function collectFilterRecordRefs(config) {
  return (config && config.filters && Array.isArray(config.filters.filterSet)) ? collectRecordRefIds(config.filters.filterSet) : [];
}
// Remap resolvable refs (fld/choice ids) and STRIP unresolvable record/collaborator-ref leaves,
// pruning groups emptied by stripping (bottom-up). Mirrored exactly by canonFilterSet so a
// stripped source filter canonicalizes identically to the stripped dest readback → converges.
function remapFilterSet(set, idmap) {
  const out = [];
  for (const f of set) {
    if (f.filterSet) {
      const inner = remapFilterSet(f.filterSet, idmap);
      if (inner.length === 0) continue;
      out.push({ ...(f.type ? { type: f.type } : {}), conjunction: f.conjunction, filterSet: inner });
      continue;
    }
    if (isRecordRefValue(f.value)) {
      const v = remapRecRefValue(f.value, idmap, true);   // write path always strips unresolved
      if (v === undefined) continue;                       // nothing resolved -> drop leaf
      out.push({ columnId: destFldId(idmap, f.columnId), operator: f.operator, value: v });
      continue;
    }
    const o = { columnId: destFldId(idmap, f.columnId), operator: f.operator, value: f.value };
    if (typeof f.value === 'string') o.value = destSelId(idmap, f.value);
    else if (Array.isArray(f.value)) o.value = f.value.map((v) => (typeof v === 'string' ? destSelId(idmap, v) : v));
    out.push(o);
  }
  return out;
}
export function remapViewConfig(config, idmap) {
  if (config == null || typeof config !== 'object') return config;
  const c = JSON.parse(JSON.stringify(config));
  if (c.filters && Array.isArray(c.filters.filterSet)) c.filters = { conjunction: c.filters.conjunction, filterSet: remapFilterSet(c.filters.filterSet, idmap) };
  if (Array.isArray(c.sorts)) c.sorts = c.sorts.map((s) => ({ columnId: destFldId(idmap, s.columnId), ascending: s.ascending }));
  if (Array.isArray(c.groupLevels)) c.groupLevels = c.groupLevels.map((g) => ({ columnId: destFldId(idmap, g.columnId), order: g.order, emptyGroupState: g.emptyGroupState }));
  if (Array.isArray(c.columnOrder)) c.columnOrder = c.columnOrder.map((co) => ({ columnId: destFldId(idmap, co.columnId), visibility: co.visibility }));
  if (c.colorConfig) {
    const cc = { ...c.colorConfig };
    if (cc.selectColumnId) cc.selectColumnId = destFldId(idmap, cc.selectColumnId);
    // Conditional colour rules filter on specific RECORD ids — can't remap, would leak/error. Drop defensively.
    delete cc.colorDefinitions;
    c.colorConfig = cc;
  }
  if (c.cover && c.cover.coverColumnId) c.cover = { ...c.cover, coverColumnId: destFldId(idmap, c.cover.coverColumnId) };
  if (c.calendar && Array.isArray(c.calendar.dateColumnRanges)) c.calendar = { dateColumnRanges: c.calendar.dateColumnRanges.map((r) => ({ startColumnId: destFldId(idmap, r.startColumnId), ...(r.endColumnId ? { endColumnId: destFldId(idmap, r.endColumnId) } : {}) })) };
  return c;
}

// Canonical, id-free, name-based string for a convergent diff compare (ids→names; auto-ids/width dropped).
function viewNameOf(map, id) { return map[id] ?? id; }
// Mirror remapFilterSet: strip record/collaborator-ref leaves and prune emptied groups so a
// source filter canonicalizes identically to the stripped dest readback. Also UNWRAP singleton
// groups (collapse-agnostic): Airtable may store a 1-element nested group as a bare leaf on
// readback — unwrapping on BOTH sides keeps it convergent either way. (Records aren't synced, so
// rec-ref leaves drop on both sides; once they do sync, this is where name-resolution lands — M3.)
// Airtable's internal API stores the same emptiness predicate two equivalent ways (varies by field
// type / era): {isNotEmpty, null} ≡ {!=, ""} and {isEmpty, null} ≡ {=, ""}. A source base holds the
// named-operator form; the dest holds the =/!= form after the sync applied it → false `filters` drift
// in mode=diff and perpetual applyViewConfig re-emit. Collapse the =/!= forms to the named operator,
// but ONLY when the value is genuinely empty — real values (incl. 0/false) are left untouched.
function normEmptyPredicate(op, val) {
  const empty = val === '' || val === null || val === undefined;
  if (empty && (op === 'isNotEmpty' || op === '!=')) return { op: 'isNotEmpty', val: null };
  if (empty && (op === 'isEmpty' || op === '=')) return { op: 'isEmpty', val: null };
  return { op, val };
}

function canonFilterSet(set, fldNames, selNames, strip, idmap) {
  const out = [];
  for (const f of set) {
    if (f.filterSet) {
      const inner = canonFilterSet(f.filterSet, fldNames, selNames, strip, idmap);
      if (inner.length === 0) continue;
      if (inner.length === 1) { out.push(inner[0]); continue; }
      out.push({ c: f.conjunction, n: inner });
      continue;
    }
    if (isRecordRefValue(f.value)) {
      const v = remapRecRefValue(f.value, idmap, strip); // strip param drives strip-vs-keep of unresolved
      if (v === undefined) continue;                      // dropped
      out.push({ col: viewNameOf(fldNames, f.columnId), op: f.operator, val: typeof v === 'string' ? viewNameOf(selNames, v) : v });
      continue;
    }
    const mappedVal = typeof f.value === 'string' ? viewNameOf(selNames, f.value) : f.value;
    const n = normEmptyPredicate(f.operator, mappedVal);
    out.push({ col: viewNameOf(fldNames, f.columnId), op: n.op, val: n.val });
  }
  return out;
}
// stripRecordRefs: TRUE for the SOURCE side (canonicalize as what apply will WRITE — rec/collab
// leaves dropped), FALSE for the DEST side (its raw actual filter). Asymmetry is deliberate: it
// makes a dest that still holds a dangling rec filter (from a prior buggy sync) diverge from the
// stripped source → one cleanup apply → then both read empty/equal → converges.
export function canonicalizeViewConfig(config, fldNames, selNames, stripRecordRefs = true, idmap) {
  const c = config || {};
  const fset = (c.filters && Array.isArray(c.filters.filterSet)) ? canonFilterSet(c.filters.filterSet, fldNames, selNames, stripRecordRefs, idmap) : [];
  return JSON.stringify({
    filters: fset.length ? { conj: c.filters.conjunction, set: fset } : null,
    sorts: (c.sorts || []).map((s) => ({ col: viewNameOf(fldNames, s.columnId), asc: s.ascending })),
    groups: (c.groupLevels || []).map((g) => ({ col: viewNameOf(fldNames, g.columnId), order: g.order })),
    // Compare WHICH columns are visible vs hidden (each as an order-agnostic set), not their
    // left-to-right order. Apply reliably sets visibility (setViewColumns verify-retry) but the
    // internal API's reorder is unreliable under bulk, so comparing exact order would re-flag
    // forever. Column ORDER is therefore best-effort (applied, not gated on convergence).
    columns: {
      visible: (c.columnOrder || []).filter((co) => co.visibility).map((co) => viewNameOf(fldNames, co.columnId)).sort(),
      hidden: (c.columnOrder || []).filter((co) => !co.visibility).map((co) => viewNameOf(fldNames, co.columnId)).sort(),
    },
    frozen: c.frozenColumnCount ?? null,
    // Only the select-driven colour rule is syncable; 'colorDefinitions' (conditional rules
    // whose filters reference specific RECORD ids) are out of scope — exclude so they don't re-flag.
    color: (c.colorConfig && c.colorConfig.type === 'selectColumn') ? { col: viewNameOf(fldNames, c.colorConfig.selectColumnId) } : null,
    cover: c.cover ? { col: viewNameOf(fldNames, c.cover.coverColumnId), fit: c.cover.coverFitType } : null,
    calendar: c.calendar ? (c.calendar.dateColumnRanges || []).map((r) => ({ s: viewNameOf(fldNames, r.startColumnId), e: r.endColumnId ? viewNameOf(fldNames, r.endColumnId) : null })) : null,
    rowHeight: c.rowHeight ?? null,
    form: c.form ?? null,
  });
}
