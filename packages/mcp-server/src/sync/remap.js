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
