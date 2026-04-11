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
});
