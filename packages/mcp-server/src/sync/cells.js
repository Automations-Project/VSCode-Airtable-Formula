import { isComputedType } from './snapshot.js';

const ARRAY_DEFERRED = new Set(['multipleRecordLinks', 'multipleAttachments']);

export function isWritableForRecords(field) {
  return !isComputedType(field.type) && !ARRAY_DEFERRED.has(field.type);
}

function choiceMap(field, idmap) { return (idmap.fields?.[field.id]?.choices) || {}; }

export function coercePass1Cell(field, srcValue, idmap) {
  if (!isWritableForRecords(field)) return { write: false };
  if (srcValue == null) return { write: true, value: srcValue };
  if (field.type === 'select') {
    const d = choiceMap(field, idmap)[srcValue];
    return d ? { write: true, value: d } : { write: false };
  }
  if (field.type === 'multiSelect') {
    const cm = choiceMap(field, idmap);
    const mapped = (Array.isArray(srcValue) ? srcValue : []).map((s) => cm[s]).filter(Boolean);
    if (mapped.length !== (srcValue?.length ?? 0)) return { write: false }; // partial choice map → skip + report upstream
    return { write: true, value: mapped };
  }
  return { write: true, value: srcValue }; // text/number/currency/date/checkbox/...
}

export function partitionLinkValue(srcValue, idmap) {
  const recs = idmap.records || {};
  const resolved = [], unresolved = [];
  for (const s of (Array.isArray(srcValue) ? srcValue : [])) {
    if (recs[s]) resolved.push(recs[s]); else unresolved.push(s);
  }
  return { resolved, unresolved };
}
