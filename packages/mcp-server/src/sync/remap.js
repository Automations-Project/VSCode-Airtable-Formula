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
      return { recordLinkFieldId: o.recordLinkFieldId };
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
function remapFilterSet(set, idmap) {
  return set.map((f) => {
    if (f.filterSet) return { ...(f.type ? { type: f.type } : {}), conjunction: f.conjunction, filterSet: remapFilterSet(f.filterSet, idmap) };
    const out = { columnId: destFldId(idmap, f.columnId), operator: f.operator, value: f.value };
    if (typeof f.value === 'string') out.value = destSelId(idmap, f.value);
    else if (Array.isArray(f.value)) out.value = f.value.map((v) => (typeof v === 'string' ? destSelId(idmap, v) : v));
    return out;
  });
}
export function remapViewConfig(config, idmap) {
  if (config == null || typeof config !== 'object') return config;
  const c = JSON.parse(JSON.stringify(config));
  if (c.filters && Array.isArray(c.filters.filterSet)) c.filters = { conjunction: c.filters.conjunction, filterSet: remapFilterSet(c.filters.filterSet, idmap) };
  if (Array.isArray(c.sorts)) c.sorts = c.sorts.map((s) => ({ columnId: destFldId(idmap, s.columnId), ascending: s.ascending }));
  if (Array.isArray(c.groupLevels)) c.groupLevels = c.groupLevels.map((g) => ({ columnId: destFldId(idmap, g.columnId), order: g.order, emptyGroupState: g.emptyGroupState }));
  if (Array.isArray(c.columnOrder)) c.columnOrder = c.columnOrder.map((co) => ({ columnId: destFldId(idmap, co.columnId), visibility: co.visibility }));
  if (c.colorConfig && c.colorConfig.selectColumnId) c.colorConfig = { ...c.colorConfig, selectColumnId: destFldId(idmap, c.colorConfig.selectColumnId) };
  if (c.cover && c.cover.coverColumnId) c.cover = { ...c.cover, coverColumnId: destFldId(idmap, c.cover.coverColumnId) };
  if (c.calendar && Array.isArray(c.calendar.dateColumnRanges)) c.calendar = { dateColumnRanges: c.calendar.dateColumnRanges.map((r) => ({ startColumnId: destFldId(idmap, r.startColumnId), ...(r.endColumnId ? { endColumnId: destFldId(idmap, r.endColumnId) } : {}) })) };
  return c;
}

// Canonical, id-free, name-based string for a convergent diff compare (ids→names; auto-ids/width dropped).
function viewNameOf(map, id) { return map[id] ?? id; }
function canonFilterSet(set, fldNames, selNames) {
  return set.map((f) => f.filterSet
    ? { c: f.conjunction, n: canonFilterSet(f.filterSet, fldNames, selNames) }
    : { col: viewNameOf(fldNames, f.columnId), op: f.operator, val: typeof f.value === 'string' ? viewNameOf(selNames, f.value) : f.value });
}
export function canonicalizeViewConfig(config, fldNames, selNames) {
  const c = config || {};
  return JSON.stringify({
    filters: c.filters ? { conj: c.filters.conjunction, set: canonFilterSet(c.filters.filterSet || [], fldNames, selNames) } : null,
    sorts: (c.sorts || []).map((s) => ({ col: viewNameOf(fldNames, s.columnId), asc: s.ascending })),
    groups: (c.groupLevels || []).map((g) => ({ col: viewNameOf(fldNames, g.columnId), order: g.order })),
    columns: (c.columnOrder || []).map((co) => ({ col: viewNameOf(fldNames, co.columnId), vis: co.visibility })),
    frozen: c.frozenColumnCount ?? null,
    color: c.colorConfig ? { type: c.colorConfig.type, col: viewNameOf(fldNames, c.colorConfig.selectColumnId) } : null,
    cover: c.cover ? { col: viewNameOf(fldNames, c.cover.coverColumnId), fit: c.cover.coverFitType } : null,
    calendar: c.calendar ? (c.calendar.dateColumnRanges || []).map((r) => ({ s: viewNameOf(fldNames, r.startColumnId), e: r.endColumnId ? viewNameOf(fldNames, r.endColumnId) : null })) : null,
    rowHeight: c.rowHeight ?? null,
    form: c.form ?? null,
  });
}
