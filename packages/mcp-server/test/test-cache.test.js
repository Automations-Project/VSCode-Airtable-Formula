import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SchemaCache } from '../src/cache.js';

describe('SchemaCache', () => {
  let cache;

  beforeEach(() => {
    cache = new SchemaCache(100); // 100ms TTL for fast tests
  });

  describe('scaffolding cache', () => {
    it('returns null for uncached app', () => {
      assert.equal(cache.getScaffolding('appXXX'), null);
    });

    it('returns cached data within TTL', () => {
      const data = { tables: [{ id: 'tbl1', name: 'Tasks' }] };
      cache.setScaffolding('appXXX', data);
      assert.deepEqual(cache.getScaffolding('appXXX'), data);
    });

    it('returns null after TTL expires', async () => {
      cache.setScaffolding('appXXX', { tables: [] });
      await new Promise(r => setTimeout(r, 150));
      assert.equal(cache.getScaffolding('appXXX'), null);
    });

    it('isolates apps from each other', () => {
      cache.setScaffolding('app1', { id: 1 });
      cache.setScaffolding('app2', { id: 2 });
      assert.deepEqual(cache.getScaffolding('app1'), { id: 1 });
      assert.deepEqual(cache.getScaffolding('app2'), { id: 2 });
    });
  });

  describe('full schema cache', () => {
    it('returns null for uncached app', () => {
      assert.equal(cache.getFull('appXXX'), null);
    });

    it('returns cached data within TTL', () => {
      const data = { data: { tableSchemas: [] } };
      cache.setFull('appXXX', data);
      assert.deepEqual(cache.getFull('appXXX'), data);
    });

    it('returns null after TTL expires', async () => {
      cache.setFull('appXXX', { data: {} });
      await new Promise(r => setTimeout(r, 150));
      assert.equal(cache.getFull('appXXX'), null);
    });
  });

  describe('invalidation', () => {
    it('invalidate() clears both caches for one app', () => {
      cache.setScaffolding('appXXX', { s: 1 });
      cache.setFull('appXXX', { f: 1 });
      cache.invalidate('appXXX');
      assert.equal(cache.getScaffolding('appXXX'), null);
      assert.equal(cache.getFull('appXXX'), null);
    });

    it('invalidate() does not affect other apps', () => {
      cache.setFull('app1', { f: 1 });
      cache.setFull('app2', { f: 2 });
      cache.invalidate('app1');
      assert.equal(cache.getFull('app1'), null);
      assert.deepEqual(cache.getFull('app2'), { f: 2 });
    });

    it('invalidateAll() clears everything', () => {
      cache.setFull('app1', { f: 1 });
      cache.setScaffolding('app2', { s: 2 });
      cache.invalidateAll();
      assert.equal(cache.getFull('app1'), null);
      assert.equal(cache.getScaffolding('app2'), null);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when full schema cap is exceeded', () => {
      // Small cap for fast testing
      const lru = new (cache.constructor)(60_000, 3);
      lru.setFull('a', { n: 1 });
      lru.setFull('b', { n: 2 });
      lru.setFull('c', { n: 3 });
      assert.deepEqual(lru.getFull('a'), { n: 1 });

      // Adding a 4th app evicts the oldest (after a was just read, c is oldest)
      lru.setFull('d', { n: 4 });
      assert.deepEqual(lru.getFull('d'), { n: 4 });
      // `a` was just read so it's most-recently-used; `b` should be oldest.
      assert.equal(lru.getFull('b'), null, 'b should have been evicted as LRU');
      assert.deepEqual(lru.getFull('a'), { n: 1 }, 'a should survive as MRU');
      assert.deepEqual(lru.getFull('c'), { n: 3 }, 'c should still be present');
    });

    it('evicts scaffolding cache independently from full cache', () => {
      const lru = new (cache.constructor)(60_000, 2);
      lru.setScaffolding('a', { s: 1 });
      lru.setScaffolding('b', { s: 2 });
      lru.setScaffolding('c', { s: 3 });
      assert.equal(lru.getScaffolding('a'), null, 'a should have been evicted');
      assert.deepEqual(lru.getScaffolding('b'), { s: 2 });
      assert.deepEqual(lru.getScaffolding('c'), { s: 3 });
    });

    it('refreshes insertion order on get (touch behavior)', () => {
      const lru = new (cache.constructor)(60_000, 2);
      lru.setFull('a', { n: 1 });
      lru.setFull('b', { n: 2 });
      // Touch `a` to make it most-recently-used
      assert.deepEqual(lru.getFull('a'), { n: 1 });
      // Now add `c` — should evict `b` (oldest), not `a`
      lru.setFull('c', { n: 3 });
      assert.deepEqual(lru.getFull('a'), { n: 1 }, 'a stays because it was touched');
      assert.equal(lru.getFull('b'), null, 'b evicted as LRU');
      assert.deepEqual(lru.getFull('c'), { n: 3 });
    });
  });
});
