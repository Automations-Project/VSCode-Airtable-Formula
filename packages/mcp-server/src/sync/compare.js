// compare.js — base-schema comparator helpers (pure: no fs, no network, no Date.now/Math.random)

import { stableStringify, choiceNames, scalarTypeOptionsChanged, computedSig } from './field-compare.js';

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
export function compareFields(srcTable, destTable, idmap) {
  const entries = [];
  const onlyInSource = [];
  const onlyInDest = [];

  // Build name→field map for dest for by-name fallback and unmatched detection.
  const destByName = new Map(destTable.fields.map((f) => [f.name, f]));
  // Track which dest field ids were matched so we can find dest-only fields
  // (using id rather than name prevents a single dest field from being claimed twice
  // if two src fields share the same name in an edge case).
  const matchedDestIds = new Set();

  // Build id→name maps for each side so computed sigs can normalise references.
  const srcFldNames = tableFieldNameMap(srcTable);
  const destFldNames = tableFieldNameMap(destTable);

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
