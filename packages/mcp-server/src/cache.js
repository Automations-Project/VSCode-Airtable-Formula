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
const DEFAULT_MAX_ENTRIES = 50; // per-map cap — full-schema payloads can reach ~1MB each

export class SchemaCache {
  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    // Map<appId, { data, timestamp }>  — Map keeps insertion order, which
    // we use for simple LRU-ish eviction (evict oldest when size exceeds cap).
    this._scaffolding = new Map();
    this._full = new Map();
  }

  // ─── Scaffolding Cache ────────────────────────────────────────

  getScaffolding(appId) {
    return this._getEntry(this._scaffolding, appId);
  }

  setScaffolding(appId, data) {
    this._setEntry(this._scaffolding, appId, data);
  }

  // ─── Full Schema Cache ────────────────────────────────────────

  getFull(appId) {
    return this._getEntry(this._full, appId);
  }

  setFull(appId, data) {
    this._setEntry(this._full, appId, data);
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
    // Refresh insertion order so frequently-used bases stay warm while
    // the LRU eviction chops the oldest.
    map.delete(appId);
    map.set(appId, entry);
    return entry.data;
  }

  _setEntry(map, appId, data) {
    // If we'd exceed the cap, evict oldest (Map iteration order = insertion order)
    if (!map.has(appId) && map.size >= this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    // Re-insert to move to most-recent end
    map.delete(appId);
    map.set(appId, { data, timestamp: Date.now() });
  }
}
