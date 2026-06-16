import { createHash } from 'node:crypto';
import { snapshotBase } from './snapshot.js';
import { matchByName, saveIdmap, savePlan, saveState } from './idmap.js';
import { computePlan } from './diff.js';
import { renderPlan } from './report.js';

const ENGINE_VERSION = '2a';

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
