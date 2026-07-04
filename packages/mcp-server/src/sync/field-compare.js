// field-compare.js — shared field-comparison helpers used by both diff.js and compare.js.
// Pure module: no fs, no network, no Date.now, no Math.random.

import { canonicalizeComputed } from './remap.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a regex that matches any field ID key in the given map.
 * @param {Record<string, string>} idToName
 * @returns {RegExp|null}
 */
function buildIdRegex(idToName) {
  const ids = Object.keys(idToName);
  if (ids.length === 0) return null;
  const escaped = ids
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'g');
}

/**
 * Replace every occurrence of a field ID found in `idToName` within `str`
 * with `{{<fieldName>}}`.
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

// ── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Stable, key-sorted JSON so equal options compare equal regardless of key insertion order.
 * @param {unknown} obj
 * @returns {string}
 */
export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',')}}`;
}

/**
 * Set of choice names for a select-like field, or null if not a select.
 * @param {object|null} typeOptions
 * @returns {Set<string>|null}
 */
export function choiceNames(typeOptions) {
  const ch = typeOptions && typeOptions.choices;
  return ch ? new Set(Object.values(ch).map((c) => c.name)) : null;
}

/**
 * Whether a non-computed field's typeOptions genuinely needs an update, aligned with what
 * apply actually does (so plan converges to zero instead of re-emitting phantom updates):
 *  - select/multiSelect: apply MERGES choices additively (never drops, invariant 7), so an
 *    update is needed only when SOURCE has a choice name DEST lacks. dest ⊇ src ⇒ equal.
 *    (Existing-choice colour/order are kept by apply's merge, so they're not flagged here.)
 *  - other types: a real typeOptions diff, but skip when source options are empty — apply
 *    can't clear options non-destructively and sending {} is a no-op that never converges.
 * @param {{ typeOptions: object|null }} sf  source field
 * @param {{ typeOptions: object|null }} df  dest field
 * @returns {boolean}
 */
export function scalarTypeOptionsChanged(sf, df) {
  const srcChoices = choiceNames(sf.typeOptions);
  if (srcChoices) {
    const destChoices = choiceNames(df.typeOptions) || new Set();
    for (const n of srcChoices) if (!destChoices.has(n)) return true; // a source choice missing in dest
    return false; // dest already has every source choice
  }
  if (stableStringify(sf.typeOptions ?? null) === stableStringify(df.typeOptions ?? null)) return false;
  // ponytail: source has no options to push and we don't strip dest options (destructive, M4) → skip
  return !!(sf.typeOptions && Object.keys(sf.typeOptions).length > 0);
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
export function computedSig(field, fldNames) {
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
 * Canonical signature for a link (foreignKey/multipleRecordLinks) field's typeOptions.
 * Link options carry base-scoped ids that ALWAYS differ across bases:
 *  - foreignTableId → resolved to the referenced table NAME (stable cross-base)
 *  - symmetricColumnId (Airtable-managed reciprocal) and viewIdForRecordSelection
 *    (base-scoped view id) → dropped entirely
 * so two semantically equivalent links compare equal — the raw scalar signature can
 * never converge for links and used to emit a phantom updateField on every plan.
 *
 * @param {{ type:string, typeOptions:object|null }} field
 * @param {Record<string, string>} tblNames  tableId → name for the relevant base
 * @returns {string}
 */
export function linkSig(field, tblNames) {
  const opts = field.typeOptions;
  if (!opts) return 'L|' + field.type + '|null';
  const { symmetricColumnId: _sym, viewIdForRecordSelection: _view, foreignTableId, ...rest } = opts; // eslint-disable-line no-unused-vars
  return 'L|' + field.type + '|' + stableStringify({
    ...rest,
    foreignTableName: (tblNames && tblNames[foreignTableId]) ?? foreignTableId ?? null,
  });
}

/**
 * Comparable signature for a field.
 * - Computed fields canonicalize field-ID references to field names so
 *   cross-base ID churn is invisible.
 * - Scalar fields compare type + stable-serialised typeOptions + description.
 *
 * @param {{ type:string, typeOptions:object|null, description:string|null, isComputed:boolean }} field
 * @param {Record<string, string>} fldNames  fieldId → name for the relevant base
 * @returns {string}
 */
export function fieldSignature(field, fldNames) {
  if (field.isComputed) {
    return computedSig(field, fldNames) + '|' + (field.description ?? '');
  }
  return 'S|' + field.type + '|' + stableStringify(field.typeOptions ?? null) + '|' + (field.description ?? '');
}
