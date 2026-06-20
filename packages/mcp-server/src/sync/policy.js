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
