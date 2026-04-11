/**
 * Per-app TTL cache for Airtable schema data.
 *
 * Two cache types per appId:
 *   - scaffolding: lightweight table listing (from getApplicationScaffoldingData)
 *   - full: complete schema with fields and views (from application/read)
 *
 * Mutations invalidate the full cache for the affected appId immediately.
 */

const DEFAULT_TTL_MS = 15_000; // 15 seconds

export class SchemaCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    // Map<appId, { data, timestamp }>
    this._scaffolding = new Map();
    this._full = new Map();
  }

  // ─── Scaffolding Cache ────────────────────────────────────────

  getScaffolding(appId) {
    return this._getEntry(this._scaffolding, appId);
  }

  setScaffolding(appId, data) {
    this._scaffolding.set(appId, { data, timestamp: Date.now() });
  }

  // ─── Full Schema Cache ────────────────────────────────────────

  getFull(appId) {
    return this._getEntry(this._full, appId);
  }

  setFull(appId, data) {
    this._full.set(appId, { data, timestamp: Date.now() });
  }

  // ─── Invalidation ─────────────────────────────────────────────

  /**
   * Invalidate caches for an app after a mutation.
   * Clears both full and scaffolding since field changes affect both.
   */
  invalidate(appId) {
    this._full.delete(appId);
    this._scaffolding.delete(appId);
  }

  invalidateAll() {
    this._full.clear();
    this._scaffolding.clear();
  }

  // ─── Internals ────────────────────────────────────────────────

  _getEntry(map, appId) {
    const entry = map.get(appId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      map.delete(appId);
      return null;
    }
    return entry.data;
  }
}
