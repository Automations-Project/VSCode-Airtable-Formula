import { isComputedType } from './snapshot.js';

// Reconciliation policy: two axes (extras keep|remove, conflicts source-wins|dest-wins)
// expressed as three named presets. See docs spec 2026-06-20-records-reconciliation-policy.
export const PRESETS = {
  mirror:   { extras: 'remove', conflicts: 'source-wins' },
  overlay:  { extras: 'keep',   conflicts: 'source-wins' },
  preserve: { extras: 'keep',   conflicts: 'dest-wins' },
};

export function resolvePolicy(globalPreset, overrides, tableName) {
  const name = (overrides && overrides[tableName]) || globalPreset || 'overlay';
  return PRESETS[name] || PRESETS.overlay;
}

export function isDeleting(globalPreset, overrides) {
  const removes = (p) => PRESETS[p]?.extras === 'remove';
  if (removes(globalPreset)) return true;
  return Object.values(overrides || {}).some(removes);
}

// Array-shaped source values can't be injected into a scalar dest field.
const ARRAY_SOURCE_TYPES = new Set(['multipleRecordLinks', 'foreignKey', 'multipleAttachments', 'multiSelect', 'multipleSelects', 'multipleLookupValues']);

export function validateFieldMappings(srcSnapshot, destSnapshot, fieldMappings) {
  const errors = [];
  const resolved = [];
  const srcTables = new Map((srcSnapshot.tables || []).map((t) => [t.name, t]));
  const dstTables = new Map((destSnapshot.tables || []).map((t) => [t.name, t]));

  for (const [table, mappings] of Object.entries(fieldMappings || {})) {
    const st = srcTables.get(table);
    const dt = dstTables.get(table);
    if (!st || !dt) { errors.push({ code: 'FIELD_MAP_TABLE_MISSING', table }); continue; }
    const srcByName = new Map(st.fields.map((f) => [f.name, f]));
    const dstByName = new Map(dt.fields.map((f) => [f.name, f]));
    const targetsSeen = new Map();

    for (const [srcName, destName] of Object.entries(mappings || {})) {
      const sf = srcByName.get(srcName);
      const df = dstByName.get(destName);
      if (!sf) { errors.push({ code: 'FIELD_MAP_SOURCE_MISSING', table, source: srcName }); continue; }
      if (!df) { errors.push({ code: 'FIELD_MAP_TARGET_MISSING', table, target: destName }); continue; }
      if (isComputedType(df.type)) { errors.push({ code: 'FIELD_MAP_TARGET_COMPUTED', table, target: destName }); continue; }
      if (ARRAY_SOURCE_TYPES.has(sf.type) || ARRAY_SOURCE_TYPES.has(df.type)) {
        errors.push({ code: 'FIELD_MAP_TYPE_INCOMPATIBLE', table, source: srcName, target: destName }); continue;
      }
      if (targetsSeen.has(destName)) {
        errors.push({ code: 'FIELD_MAP_COLLISION', table, target: destName }); continue;
      }
      targetsSeen.set(destName, srcName);
      resolved.push({ table, srcFieldId: sf.id, destFieldId: df.id, destType: df.type });
    }
  }
  return { errors, resolved };
}
