import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { getHomeDir } from '../paths.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

/**
 * Build a name→item Map from an array of objects with a `.name` property.
 * First occurrence wins; duplicates are silently dropped (diff phase warns).
 * @param {Array<{name: string}>} items
 * @returns {Map<string, object>}
 */
function indexByName(items) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.name)) m.set(it.name, it);
  }
  return m;
}

/**
 * Match choice IDs from a source field to dest field by choice name.
 * Returns `{}` if either field has no typeOptions.choices.
 * @param {{ typeOptions?: { choices?: object } }} srcField
 * @param {{ typeOptions?: { choices?: object } }} destField
 * @returns {Record<string, string>}  srcChoiceId → destChoiceId
 */
function matchChoices(srcField, destField) {
  const sc = srcField.typeOptions?.choices;
  const dc = destField.typeOptions?.choices;
  if (!sc || !dc) return {};
  const destByName = new Map(Object.values(dc).map((c) => [c.name, c.id]));
  const out = {};
  for (const c of Object.values(sc)) {
    const destId = destByName.get(c.name);
    if (destId) out[c.id] = destId;
  }
  return out;
}

/**
 * Produce an ID-map by matching tables, fields, and select choices by name.
 *
 * @param {{ tables: Array<{id:string, name:string, fields:Array<{id:string,name:string,typeOptions?:object}>}> }} srcSnap
 * @param {{ tables: Array<{id:string, name:string, fields:Array<{id:string,name:string,typeOptions?:object}>}> }} destSnap
 * @returns {{
 *   tables: Record<string,string>,
 *   fields: Record<string, { destFld: string, choices: Record<string,string> }>
 * }}
 */
export function matchByName(srcSnap, destSnap) {
  const destTables = indexByName(destSnap.tables);
  const tables = {};
  const fields = {};
  const views = {};

  for (const st of srcSnap.tables) {
    const dt = destTables.get(st.name);
    if (!dt) continue;
    tables[st.id] = dt.id;

    const destFields = indexByName(dt.fields);
    for (const sf of st.fields) {
      const df = destFields.get(sf.name);
      if (!df) continue;
      fields[sf.id] = { destFld: df.id, choices: matchChoices(sf, df) };
    }

    const destViews = indexByName((dt.views || []).filter((v) => !v.personalForUserId));
    for (const sv of (st.views || [])) {
      if (sv.personalForUserId) continue;
      const dv = destViews.get(sv.name);
      if (dv) views[sv.id] = dv.id;
    }
  }

  return { tables, fields, views };
}

// ── State I/O ──────────────────────────────────────────────────────────────

/**
 * Return the per-pair sync directory path.
 * Does NOT create the directory.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @returns {string}
 */
export function syncDir(sourceBaseId, destBaseId) {
  return join(getHomeDir(), 'sync', `${sourceBaseId}__${destBaseId}`);
}

/**
 * @param {string} dir   Parent directory (created if absent).
 * @param {string} file  File name within dir.
 * @param {object} obj   Value to JSON-serialise.
 */
function writeJson(dir, file, obj) {
  mkdirSync(dir, { recursive: true });
  safeAtomicWriteFileSync(join(dir, file), JSON.stringify(obj, null, 2));
}

/**
 * Persist an ID-map for a source→dest base pair.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {object} idmap
 */
export function saveIdmap(sourceBaseId, destBaseId, idmap) {
  writeJson(syncDir(sourceBaseId, destBaseId), 'idmap.json', idmap);
}

/**
 * Load a previously saved ID-map.  Returns `{ tables: {}, fields: {}, records: {} }` when
 * the file is absent or unparseable.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @returns {{ tables: Record<string,string>, fields: Record<string,object>, records: Record<string,string> }}
 */
export function loadIdmap(sourceBaseId, destBaseId) {
  const p = join(syncDir(sourceBaseId, destBaseId), 'idmap.json');
  if (!existsSync(p)) return { tables: {}, fields: {}, records: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { tables: {}, fields: {}, records: {} };
  }
}

/**
 * Persist a sync plan (schema diff output) for a base pair.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {{ planId: string }} plan
 */
export function savePlan(sourceBaseId, destBaseId, plan) {
  writeJson(syncDir(sourceBaseId, destBaseId), `plan-${plan.planId}.json`, plan);
}

/**
 * Persist sync execution state for a base pair.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {object} state
 */
export function saveState(sourceBaseId, destBaseId, state) {
  writeJson(syncDir(sourceBaseId, destBaseId), 'state.json', state);
}

/**
 * Load a previously saved sync plan.  Returns `null` when the file is absent
 * or unparseable.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {string} planId
 * @returns {object|null}
 */
export function loadPlan(sourceBaseId, destBaseId, planId) {
  const p = join(syncDir(sourceBaseId, destBaseId), `plan-${planId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Persist a schema diff for a source→dest base pair.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {{ diffId: string }} diff
 */
export function saveDiff(sourceBaseId, destBaseId, diff) {
  writeJson(syncDir(sourceBaseId, destBaseId), `diff-${diff.diffId}.json`, diff);
}

/**
 * Load a previously saved schema diff.  Returns `null` when the file is absent
 * or unparseable.
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @param {string} diffId
 * @returns {object|null}
 */
export function loadDiff(sourceBaseId, destBaseId, diffId) {
  const p = join(syncDir(sourceBaseId, destBaseId), `diff-${diffId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Return the diffId of the most recently written diff file for a base pair,
 * or `null` if no diff files exist (or the sync dir does not exist yet).
 * @param {string} sourceBaseId
 * @param {string} destBaseId
 * @returns {string|null}
 */
export function latestDiffId(sourceBaseId, destBaseId) {
  const dir = syncDir(sourceBaseId, destBaseId);
  if (!existsSync(dir)) return null;
  const DIFF_RE = /^diff-(.+)\.json$/;
  let best = null;
  let bestMtime = -Infinity;
  for (const name of readdirSync(dir)) {
    const m = DIFF_RE.exec(name);
    if (!m) continue;
    const mtime = statSync(join(dir, name)).mtimeMs;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = m[1];
    }
  }
  return best;
}
