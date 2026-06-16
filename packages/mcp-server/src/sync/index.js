import { createHash } from 'node:crypto';
import { snapshotBase } from './snapshot.js';
import { matchByName, saveIdmap, savePlan, saveState, loadPlan, loadIdmap } from './idmap.js';
import { computePlan } from './diff.js';
import { renderPlan, renderApplyResult } from './report.js';
import { applyPlan } from './apply.js';
import { newJournal, loadJournal, saveJournal } from './journal.js';

const ENGINE_VERSION = '2b';

/**
 * Produce a deterministic SHA-256 fingerprint of a schema snapshot.
 * Order-independent: tables are sorted before hashing.
 *
 * @param {{ tables: Array<{id:string, name:string, fields:Array<{id:string,name:string,type:string}>}> }} snap
 * @returns {string}  hex digest
 */
export function fingerprintSchema(snap) {
  const basis = snap.tables
    .map((t) => `${t.id}:${t.name}:` + t.fields.map((f) => `${f.id}=${f.name}=${f.type}`).join(','))
    .sort()
    .join('|');
  return createHash('sha256').update(basis).digest('hex');
}

/**
 * Compute a schema plan. `planId` is supplied by the caller (tool handler) so
 * the engine stays deterministic/testable.
 *
 * @param {{ client: object, sourceBaseId: string, destBaseId: string, planId: string }} opts
 * @returns {Promise<{ human: string, machine: object }>}
 */
export async function plan({ client, sourceBaseId, destBaseId, planId }) {
  const src = await snapshotBase(client, sourceBaseId);
  const dest = await snapshotBase(client, destBaseId);
  const idmap = matchByName(src, dest);
  const base = computePlan(src, dest, idmap);
  const fullPlan = {
    planId,
    engineVersion: ENGINE_VERSION,
    destFingerprint: fingerprintSchema(dest),
    ...base,
  };
  saveIdmap(sourceBaseId, destBaseId, idmap);
  savePlan(sourceBaseId, destBaseId, fullPlan);
  saveState(sourceBaseId, destBaseId, {
    sourceBaseId,
    destBaseId,
    engineVersion: ENGINE_VERSION,
    lastPlanId: planId,
  });
  return renderPlan(fullPlan);
}

export async function apply({ client, sourceBaseId, destBaseId, planId, runStartedAt }) {
  const fullPlan = loadPlan(sourceBaseId, destBaseId, planId);
  if (!fullPlan) throw new Error(`No saved plan "${planId}" for ${sourceBaseId} -> ${destBaseId}. Run mode=plan first.`);

  const destSnapshot = await snapshotBase(client, destBaseId);
  if (fingerprintSchema(destSnapshot) !== fullPlan.destFingerprint) {
    return renderApplyResult({ planId, aborted: true, reason: 'DRIFT', warnings: [{ code: 'DRIFT', message: `Destination changed since plan ${planId}. Re-run mode=plan.` }] });
  }

  const journal = loadJournal(sourceBaseId, destBaseId, planId) ?? newJournal(planId, runStartedAt);
  const idmap = journal.actions.length > 0 ? mergeIdmaps(sourceBaseId, destBaseId, fullPlan) : JSON.parse(JSON.stringify(fullPlan.idmap));

  const result = await applyPlan({
    client, plan: fullPlan, destAppId: destBaseId, destSnapshot, idmap, journal,
    persist: (m, j) => { saveIdmap(sourceBaseId, destBaseId, m); saveJournal(sourceBaseId, destBaseId, j); },
  });
  saveState(sourceBaseId, destBaseId, { sourceBaseId, destBaseId, engineVersion: ENGINE_VERSION, lastPlanId: planId, lastApplyAt: runStartedAt });
  return renderApplyResult(result);
}

// On resume, merge the persisted (grown) idmap over the plan's base matches so this-run
// creations from a prior crashed run survive.
function mergeIdmaps(sourceBaseId, destBaseId, fullPlan) {
  const m = loadIdmap(sourceBaseId, destBaseId);
  return { tables: { ...fullPlan.idmap.tables, ...m.tables }, fields: { ...fullPlan.idmap.fields, ...m.fields } };
}
