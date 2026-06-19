// compare.js — base-schema comparator helpers (pure: no fs, no network, no Date.now/Math.random)

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
