/**
 * Human-readable and machine-readable rendering of a schema sync plan.
 */

/**
 * Render a plan into a human-readable summary and a machine-readable copy.
 *
 * @param {{ actions: object[], orphans: object[], warnings: object[] }} plan
 * @returns {{ human: string, machine: object }}
 */
export function renderPlan(plan) {
  const counts = {};
  for (const a of plan.actions) counts[a.kind] = (counts[a.kind] || 0) + 1;
  const lines = ['Schema plan:'];
  for (const k of ['createTable', 'reconcilePrimary', 'createField', 'updateField']) {
    if (counts[k]) lines.push(`  ${k}: ${counts[k]}`);
  }
  lines.push(`  orphans: ${plan.orphans.length} (reported, not changed)`);
  if (plan.warnings.length) {
    lines.push('  warnings:');
    for (const w of plan.warnings) lines.push(`    - ${w.code}: ${w.message}`);
  }
  return { human: lines.join('\n'), machine: plan };
}
