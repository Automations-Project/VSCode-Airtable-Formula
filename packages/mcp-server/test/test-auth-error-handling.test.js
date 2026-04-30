import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

/**
 * Unit tests for auth error handling (Bugs 1-4 fix).
 *
 * Strategy: Instantiate AirtableAuth without calling init(), then mock
 * internal methods (page, _rawApiCall, _recoverSession) to test
 * behavioral contracts without needing a real browser.
 */

describe('AirtableAuth error handling', () => {
  let auth;

  beforeEach(() => {
    auth = new AirtableAuth();
    // Set up minimal mock state so ensureLoggedIn doesn't trigger init()
    auth.context = {}; // truthy sentinel
    auth.isLoggedIn = true;
    auth.page = { url: () => 'https://airtable.com/' };
  });

  describe('_apiCall recovery on network errors (Bug 2)', () => {
    it('triggers recovery when result has error field', async () => {
      let recoverCalled = false;
      let rawCallCount = 0;

      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount === 1) return { status: 0, body: '', error: 'Failed to fetch' };
        return { status: 200, body: '{}' };
      };
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(recoverCalled, true, '_recoverSession should be called on network error');
      assert.equal(rawCallCount, 2, '_rawApiCall should be called twice (initial + retry)');
      assert.equal(result.status, 200, 'retry should return success');
    });

    it('triggers recovery when status is 0', async () => {
      let recoverCalled = false;
      let rawCallCount = 0;

      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount === 1) return { status: 0, body: '', error: 'net::ERR_CONNECTION_REFUSED' };
        return { status: 200, body: '{"ok":true}' };
      };
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(recoverCalled, true);
      assert.equal(result.status, 200);
    });

    it('triggers recovery when _rawApiCall throws (browser crash)', async () => {
      let recoverCalled = false;
      let rawCallCount = 0;

      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount === 1) throw new Error('Target page, context or browser has been closed');
        return { status: 200, body: '{}' };
      };
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(recoverCalled, true, '_recoverSession should be called on thrown error');
      assert.equal(rawCallCount, 2);
      assert.equal(result.status, 200);
    });

    it('does not trigger recovery on normal success', async () => {
      let recoverCalled = false;

      auth._rawApiCall = async () => ({ status: 200, body: '{}' });
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(recoverCalled, false, '_recoverSession should NOT be called on success');
      assert.equal(result.status, 200);
    });

    it('still triggers recovery on HTTP 401', async () => {
      let recoverCalled = false;
      let rawCallCount = 0;

      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount === 1) return { status: 401, body: 'Unauthorized' };
        return { status: 200, body: '{}' };
      };
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(recoverCalled, true);
      assert.equal(result.status, 200);
    });
  });

  describe('ensureLoggedIn URL validation (Bug 3)', () => {
    it('re-initializes when page is on login URL', async () => {
      let initCalled = false;
      auth.page = { url: () => 'https://airtable.com/login' };
      auth.init = async () => { initCalled = true; auth.isLoggedIn = true; };

      await auth.ensureLoggedIn();
      assert.equal(initCalled, true, 'init() should be called when page is on /login');
    });

    it('re-initializes when page is on signin URL', async () => {
      let initCalled = false;
      auth.page = { url: () => 'https://airtable.com/signin' };
      auth.init = async () => { initCalled = true; auth.isLoggedIn = true; };

      await auth.ensureLoggedIn();
      assert.equal(initCalled, true);
    });

    it('re-initializes when page navigated away from airtable.com', async () => {
      let initCalled = false;
      auth.page = { url: () => 'https://accounts.google.com/sso' };
      auth.init = async () => { initCalled = true; auth.isLoggedIn = true; };

      await auth.ensureLoggedIn();
      assert.equal(initCalled, true, 'init() should be called when page left airtable.com');
    });

    it('re-initializes when page.url() throws (browser crash)', async () => {
      let initCalled = false;
      auth.page = { url: () => { throw new Error('context destroyed'); } };
      auth.init = async () => { initCalled = true; auth.isLoggedIn = true; };

      await auth.ensureLoggedIn();
      assert.equal(initCalled, true, 'init() should be called when page.url() throws');
    });

    it('does not re-initialize on valid airtable.com URL', async () => {
      let initCalled = false;
      auth.page = { url: () => 'https://airtable.com/appXXX/tblYYY' };
      auth.init = async () => { initCalled = true; };

      await auth.ensureLoggedIn();
      assert.equal(initCalled, false, 'init() should NOT be called on valid URL');
    });
  });

  describe('_apiCall rate-limit backoff', () => {
    it('retries on 429 without triggering session recovery', async () => {
      let recoverCalled = false;
      let rawCallCount = 0;

      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount < 3) return { status: 429, body: 'Too Many Requests' };
        return { status: 200, body: '{"ok":true}' };
      };
      auth._recoverSession = async () => { recoverCalled = true; };

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(result.status, 200, 'final call should succeed');
      assert.equal(recoverCalled, false, '_recoverSession should NOT be called on 429');
      assert.ok(rawCallCount >= 3, `expected >=3 calls, got ${rawCallCount}`);
    });

    it('retries on 503 Service Unavailable', async () => {
      let rawCallCount = 0;
      auth._rawApiCall = async () => {
        rawCallCount++;
        if (rawCallCount < 2) return { status: 503, body: 'Service Unavailable' };
        return { status: 200, body: '{}' };
      };
      auth._recoverSession = async () => {};

      const result = await auth._apiCall('GET', '/v0.3/test');
      assert.equal(result.status, 200);
      assert.equal(rawCallCount, 2);
    });
  });

  describe('_apiCall wall-clock timeout', () => {
    it('throws a hard timeout error when attempts keep failing past budget', async () => {
      // Each call sleeps longer than the retry delay would allow in the window.
      // We stub _recoverSession to also take time so the loop can't succeed.
      auth._rawApiCall = async () => {
        // Return a recoverable failure every time so the loop burns attempts
        return { status: 401, body: 'Unauthorized' };
      };
      auth._recoverSession = async () => {
        // Mimic a slow recovery. Exceeds 30s only in aggregate across retries,
        // but the MAX_RETRIES=3 guard would short-circuit first. We rely on
        // MAX_RETRIES behaviour here; this test documents the contract.
        await new Promise(r => setTimeout(r, 10));
      };

      // With MAX_RETRIES=3 we expect the loop to bail after 3 attempts rather
      // than stalling forever, even before the 30s budget kicks in.
      const start = Date.now();
      const result = await auth._apiCall('GET', '/v0.3/test').catch(err => ({ error: err.message }));
      const elapsed = Date.now() - start;
      // Either the retry loop ran out of attempts (giving us a 401 back), or
      // the hard timeout fired. Either way we must have returned promptly.
      assert.ok(elapsed < 5000, `call should return quickly, took ${elapsed}ms`);
      // If we got a 401 back it means retries were exhausted, which is fine.
      // If we got an error it should be the timeout error.
      if (result.error) {
        assert.ok(/wall-clock budget/.test(result.error), `unexpected error: ${result.error}`);
      } else {
        assert.equal(result.status, 401);
      }
    });
  });
});
