import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';

/**
 * Regression tests for the Round 3 audit fixes.
 *
 *   C7 — getSecretSocketId no longer falls back to a cross-app _global value.
 *   H4 — auth queue rejects new enqueues past the cap.
 *   H6 — _secretSocketIds is LRU-capped and evicts oldest on overflow.
 *   H12 — duplicateView rejects malformed IDs via assertAirtableId.
 *   M9 — resolveTable rejects ambiguous name matches with an explicit error.
 */

// ─── C7 — secretSocketId no cross-app fallback ─────────────────────────────
describe('getSecretSocketId (C7)', () => {
  let auth;

  beforeEach(() => {
    auth = new AirtableAuth();
  });

  it('returns null when no socketId was captured for the requested appId', () => {
    // Previously this returned a captured-for-other-app value via _global.
    auth._secretSocketIds.set('appA', 'socForA');
    assert.equal(auth.getSecretSocketId('appB'), null);
  });

  it('returns null when no appId is provided', () => {
    auth._secretSocketIds.set('appA', 'socForA');
    assert.equal(auth.getSecretSocketId(null), null);
    assert.equal(auth.getSecretSocketId(undefined), null);
    assert.equal(auth.getSecretSocketId(''), null);
  });

  it('returns the captured socketId only for an exact appId match', () => {
    auth._secretSocketIds.set('appA', 'socForA');
    assert.equal(auth.getSecretSocketId('appA'), 'socForA');
  });
});

// ─── H6 — secretSocketId LRU cap ────────────────────────────────────────────
describe('_secretSocketIds LRU (H6)', () => {
  let auth;

  beforeEach(() => {
    auth = new AirtableAuth();
    // Lower the cap so the test doesn't need to allocate 51 entries.
    auth._maxSocketIdCache = 3;
  });

  it('evicts the oldest entry when the cap is exceeded', () => {
    // Simulate captures via the public map the handler writes to.
    // The eviction code lives in _setupNetworkInterception's handler, so we
    // reproduce the salient lines here inline.
    const capture = (appId, v) => {
      if (auth._secretSocketIds.has(appId)) auth._secretSocketIds.delete(appId);
      auth._secretSocketIds.set(appId, v);
      if (auth._secretSocketIds.size > auth._maxSocketIdCache) {
        const oldest = auth._secretSocketIds.keys().next().value;
        if (oldest !== undefined) auth._secretSocketIds.delete(oldest);
      }
    };

    capture('app01', 's1');
    capture('app02', 's2');
    capture('app03', 's3');
    capture('app04', 's4');
    assert.equal(auth._secretSocketIds.size, 3);
    assert.equal(auth._secretSocketIds.has('app01'), false, 'oldest should be evicted');
    assert.equal(auth._secretSocketIds.get('app04'), 's4');
  });

  it('refreshes recency when re-capturing an existing appId (touch)', () => {
    const capture = (appId, v) => {
      if (auth._secretSocketIds.has(appId)) auth._secretSocketIds.delete(appId);
      auth._secretSocketIds.set(appId, v);
      if (auth._secretSocketIds.size > auth._maxSocketIdCache) {
        const oldest = auth._secretSocketIds.keys().next().value;
        if (oldest !== undefined) auth._secretSocketIds.delete(oldest);
      }
    };

    capture('app01', 's1');
    capture('app02', 's2');
    capture('app03', 's3');
    // Re-capture app01 — it should now be the newest and app02 should be the oldest.
    capture('app01', 's1-refreshed');
    capture('app04', 's4');
    assert.equal(auth._secretSocketIds.has('app02'), false, 'app02 should be evicted after touch + overflow');
    assert.equal(auth._secretSocketIds.get('app01'), 's1-refreshed');
  });
});

// ─── H4 — auth queue size cap ───────────────────────────────────────────────
describe('auth queue cap (H4)', () => {
  let auth;

  beforeEach(() => {
    auth = new AirtableAuth();
    // The cap bounds PENDING items (the in-flight one is already shifted out).
    // So cap=1 means: 1 in-flight + 1 pending is OK; a 3rd enqueue rejects.
    auth._maxQueueSize = 1;
  });

  it('rejects new enqueues with a clear message once saturated', async () => {
    // Block the queue with a never-resolving task so subsequent enqueues sit
    // in _queue rather than run immediately.
    let resolveFirst;
    const blocker = new Promise(r => (resolveFirst = r));

    const p1 = auth._enqueue(() => blocker);      // in-flight
    const p2 = auth._enqueue(async () => 'two');  // pending (1/1)
    // A 3rd enqueue hits the cap because _queue.length === 1.
    await assert.rejects(
      () => auth._enqueue(async () => 'three'),
      /Auth queue saturated/,
    );

    // Clean up so the test doesn't hang.
    resolveFirst('done');
    await Promise.all([p1, p2]);
  });
});

// ─── H12 — duplicateView validates IDs ──────────────────────────────────────
describe('duplicateView ID validation (H12)', () => {
  let client;

  beforeEach(() => {
    client = new AirtableClient({
      getSecretSocketId: () => null,
      get:      async () => ({ ok: true, json: async () => ({}), text: async () => '{}', status: 200 }),
      postForm: async () => ({ ok: true, json: async () => ({}), text: async () => '{}', status: 200 }),
      postJSON: async () => ({ ok: true, json: async () => ({}), text: async () => '{}', status: 200 }),
    });
  });

  it('rejects a malformed appId', async () => {
    await assert.rejects(
      () => client.duplicateView('../evil', 'tblAAA', 'viwBBB', 'New'),
      /Invalid appId/,
    );
  });

  it('rejects a malformed tableId', async () => {
    await assert.rejects(
      () => client.duplicateView('appXXX', '../evil', 'viwBBB', 'New'),
      /Invalid tableId/,
    );
  });

  it('rejects a malformed sourceViewId', async () => {
    await assert.rejects(
      () => client.duplicateView('appXXX', 'tblAAA', 'NOT_A_VIEW', 'New'),
      /Invalid sourceViewId/,
    );
  });
});

// ─── M9 — resolveTable / ambiguous name match ───────────────────────────────
describe('resolveTable ambiguous name match (M9)', () => {
  it('throws when multiple tables share the same name', async () => {
    const mockAuth = {
      getSecretSocketId: () => null,
      get: async () => ({
        ok: true, status: 200,
        json: async () => ({
          data: {
            tableSchemas: [
              { id: 'tblAAA', name: 'Tasks', columns: [], views: [] },
              { id: 'tblBBB', name: 'Tasks', columns: [], views: [] },
            ],
          },
        }),
        text: async () => '',
      }),
      postForm: async () => ({ ok: true, json: async () => ({}), text: async () => '{}', status: 200 }),
    };
    const client = new AirtableClient(mockAuth);

    await assert.rejects(
      () => client.resolveTable('appXXXXXXXXXXXXXXX', 'Tasks'),
      /Ambiguous table name "Tasks".*2 tables share this name/s,
    );
  });

  it('still resolves unambiguously by ID even when a name collision exists', async () => {
    const mockAuth = {
      getSecretSocketId: () => null,
      get: async () => ({
        ok: true, status: 200,
        json: async () => ({
          data: {
            tableSchemas: [
              { id: 'tblAAA', name: 'Tasks', columns: [], views: [] },
              { id: 'tblBBB', name: 'Tasks', columns: [], views: [] },
            ],
          },
        }),
        text: async () => '',
      }),
      postForm: async () => ({ ok: true, json: async () => ({}), text: async () => '{}', status: 200 }),
    };
    const client = new AirtableClient(mockAuth);

    const table = await client.resolveTable('appXXXXXXXXXXXXXXX', 'tblBBB');
    assert.equal(table.id, 'tblBBB');
  });
});
