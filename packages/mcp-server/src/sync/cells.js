import { isComputedType } from './snapshot.js';

// Array-type cells whose raw source value must NOT be written verbatim by buildCreate/UpdateCells:
// links carry source rec-ids that need src→dest remapping (handled by the link-fold path in Pass 1
// + Pass 2), attachments need the cross-base transfer (Pass 3). `foreignKey` is the INTERNAL link
// type and `multipleAttachment` (singular) the INTERNAL attachment type (snapshot passes types
// through verbatim — real snapshots carry the internal spellings) — omitting either would write raw
// source values (rec-ids / expiring signed attachment URLs) at create time.
const ARRAY_DEFERRED = new Set(['multipleRecordLinks', 'foreignKey', 'multipleAttachments', 'multipleAttachment']);

// ALL array-shaped cell types, public + internal spellings. The Pass-1 UPDATE path
// (`updateRecords` → per-cell `updatePrimitiveCell`) cannot write arrays, so buildUpdateCells
// defers every member of this set (links/attachments to Pass 2/3; select/collaborator arrays
// with a RECORD_ARRAY_UPDATE_DEFERRED warning). policy.js also builds its fieldMappings
// array-type rejection from this set.
export const ARRAY_CELL_TYPES = new Set([
  ...ARRAY_DEFERRED,
  'multiSelect', 'multipleSelects',
  'multiCollaborator', 'multipleCollaborators',
]);

/**
 * Extract the record ID from a link-cell element.
 * Link-cell elements can be plain strings ('recXxx') or objects ({ foreignRowId: 'recXxx' } or { id: 'recXxx' }).
 *
 * @param {string | object} x - link-cell element
 * @returns {string | null} - the rec-id string, or null if not found
 */
export function linkRecId(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    return x.foreignRowId ?? x.id ?? null;
  }
  return null;
}

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
  for (const elem of (Array.isArray(srcValue) ? srcValue : [])) {
    const srcRecId = linkRecId(elem);
    if (srcRecId === null) continue; // skip garbage elements
    if (recs[srcRecId]) resolved.push(recs[srcRecId]); else unresolved.push(srcRecId);
  }
  return { resolved, unresolved };
}

const TEXT_DEST_TYPES = new Set(['text', 'multilineText', 'richText', 'phone', 'email', 'url', 'singleLineText']);

export function coerceMappedValue(srcValue, destType) {
  if (srcValue == null) return { write: true, value: srcValue };
  if (Array.isArray(srcValue) || typeof srcValue === 'object') return { write: false };
  if (TEXT_DEST_TYPES.has(destType)) return { write: true, value: String(srcValue) };
  return { write: true, value: srcValue }; // number/currency/percent/date/checkbox/duration/rating/...
}
