// Airtable's internal API STORES formula text with opaque {column_value_fldXXX} field
// refs, but on WRITE accepts {fldXXX} (id form) or {Field Name} (the native syntax users
// see in the formula editor). These helpers translate between the stored form and the
// human form. Non-field tokens (e.g. n8n placeholders like {ACCOUNT_TITLE_PLACEHOLDER})
// never match the fld-id pattern and pass through verbatim.

const STORED_REF = /\{(?:column_value_)?(fld[A-Za-z0-9]+)\}/g;
// A field NAME that itself looks like a ref token would be indistinguishable from a
// stored ref on re-upload (formulaRefsToIds would mangle it, or Airtable would resolve
// it as an id) — such names must not be emitted in name form.
const TOKEN_SHAPED_NAME = /^(?:column_value_)?(?:fld|sel)[A-Za-z0-9]+$/;

/**
 * Stored → human form: {column_value_fldX} and {fldX} → {Field Name}.
 * An unknown id — or a name that cannot round-trip through formula syntax (contains
 * braces, or is itself shaped like a ref token) — falls back to the id form {fldX},
 * which the write API accepts.
 */
export function formulaRefsToNames(text, fldIdToName) {
  if (typeof text !== 'string') return text;
  return text.replace(STORED_REF, (_m, id) => {
    const name = fldIdToName[id];
    return name && !/[{}]/.test(name) && !TOKEN_SHAPED_NAME.test(name) ? `{${name}}` : `{${id}}`;
  });
}

/**
 * Write-path normalization: {column_value_fldX} → {fldX}, the input form the API
 * accepts. {Field Name} refs and non-field placeholders are left untouched, so both
 * name-form files and legacy column_value_ downloads upload correctly.
 */
export function formulaRefsToIds(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{column_value_((?:fld|sel)[A-Za-z0-9]+)\}/g, '{$1}');
}

/** fldId → field name map across every table of an app-data payload. */
export function buildFieldNameMap(tables) {
  const map = {};
  for (const t of tables || []) {
    for (const f of t.columns || t.fields || []) map[f.id] = f.name;
  }
  return map;
}
