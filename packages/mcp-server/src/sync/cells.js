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
// omits every member of this set from the primitive batch: links/attachments go to Pass 2/3,
// and multiSelect/collaborator arrays converge separately via collectArrayChoiceUpdates +
// client.setArrayChoiceCell (add/remove item APIs). policy.js also builds its fieldMappings
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

// Extract a choice / collaborator id from a select-cell element: a plain id string, or an
// object like { id } / { userId } / { foreignRowId }. Mirrors records.js `arrayChoiceIds` so the
// CREATE path (here) and the UPDATE path (collectArrayChoiceUpdates) normalize choices identically
// — otherwise object-shaped snapshot elements are skipped on CREATE but converge on UPDATE.
function choiceElemId(e) {
  if (typeof e === 'string') return e || null;
  if (e && typeof e === 'object') return e.id ?? e.userId ?? e.foreignRowId ?? null;
  return null;
}

export function coercePass1Cell(field, srcValue, idmap) {
  if (!isWritableForRecords(field)) return { write: false };
  if (srcValue == null) return { write: true, value: srcValue };
  if (field.type === 'select' || field.type === 'singleSelect') {
    const id = choiceElemId(srcValue);
    const d = id == null ? undefined : choiceMap(field, idmap)[id];
    return d ? { write: true, value: d } : { write: false };
  }
  if (field.type === 'multiSelect' || field.type === 'multipleSelects') {
    const cm = choiceMap(field, idmap);
    const ids = (Array.isArray(srcValue) ? srcValue : []).map(choiceElemId).filter((x) => x != null);
    const mapped = ids.map((s) => cm[s]).filter(Boolean);
    if (mapped.length !== ids.length) return { write: false }; // partial choice map → skip + report upstream
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
