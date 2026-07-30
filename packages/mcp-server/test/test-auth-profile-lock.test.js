import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

/**
 * Chrome profile-lock recovery — auth side.
 *
 * `_launchContext` wraps chromium.launchPersistentContext so that a locked
 * MCP-exclusive profile (Chrome exit 21) is recovered by killing the stale
 * holder and retrying the launch ONCE. These tests drive `_launchContext`
 * directly over a fake chromium + a killProfileHolders spy — no real browser,
 * no real process ever touched. The relaunch wait is injected to 0.
 */

function exit21() {
  const err = new Error(
    'browserType.launchPersistentContext: Target page, context or browser has been closed',
  );
  err.exitCode = 21;
  return err;
}

describe('AirtableAuth._launchContext — profile-lock recovery', () => {
  it('recovers from an exit-21 lock: kills the holder once, then the retry succeeds', async () => {
    let killed = 0;
    let killedWith = null;
    const auth = new AirtableAuth({
      profileDir: '/fake/profile',
      relaunchWaitMs: 0,
      killProfileHolders: async (dir) => { killed++; killedWith = dir; return { killed: true }; },
    });

    const fakeContext = { __fake: true };
    let attempts = 0;
    const chromium = {
      async launchPersistentContext(dir, opts) {
        attempts++;
        if (attempts === 1) throw exit21(); // first launch hits the lock
        return fakeContext;                  // second launch (post-kill) succeeds
      },
    };

    const ctx = await auth._launchContext(chromium, { headless: true });
    assert.equal(ctx, fakeContext);
    assert.equal(attempts, 2, 'launch retried exactly once');
    assert.equal(killed, 1, 'killProfileHolders called exactly once');
    assert.equal(killedWith, '/fake/profile', 'kill targeted our profile dir');
  });

  it('does NOT kill on a non-lock error — it propagates unchanged, no retry', async () => {
    let killed = 0;
    const auth = new AirtableAuth({
      profileDir: '/fake/profile',
      relaunchWaitMs: 0,
      killProfileHolders: async () => { killed++; return { killed: true }; },
    });

    let attempts = 0;
    const chromium = {
      async launchPersistentContext() {
        attempts++;
        throw new Error('Executable doesn\'t exist at /path/chrome — download it first');
      },
    };

    await assert.rejects(() => auth._launchContext(chromium, {}), /Executable doesn't exist/);
    assert.equal(attempts, 1, 'no retry on a non-lock error');
    assert.equal(killed, 0, 'killProfileHolders never called for a non-lock error');
  });

  it('rethrows if the retry ALSO fails (kill did not free the lock)', async () => {
    let killed = 0;
    const auth = new AirtableAuth({
      profileDir: '/fake/profile',
      relaunchWaitMs: 0,
      killProfileHolders: async () => { killed++; return { killed: false }; },
    });

    let attempts = 0;
    const chromium = {
      async launchPersistentContext() {
        attempts++;
        throw exit21(); // still locked on both attempts
      },
    };

    await assert.rejects(() => auth._launchContext(chromium, {}), /exitCode=21|has been closed/i);
    assert.equal(attempts, 2, 'retried once, then gave up');
    assert.equal(killed, 1, 'kill attempted once before the retry');
  });

  it('happy path: a clean first launch never kills and never retries', async () => {
    let killed = 0;
    const auth = new AirtableAuth({
      relaunchWaitMs: 0,
      killProfileHolders: async () => { killed++; return { killed: true }; },
    });
    const fakeContext = { ok: true };
    let attempts = 0;
    const chromium = {
      async launchPersistentContext() { attempts++; return fakeContext; },
    };
    const ctx = await auth._launchContext(chromium, {});
    assert.equal(ctx, fakeContext);
    assert.equal(attempts, 1);
    assert.equal(killed, 0);
  });
});

describe('AirtableAuth._doInit — profile-lock recovery end-to-end', () => {
  // Minimal fake page/context that satisfies everything _doInit's browser
  // branch touches: newPage / pages / goto / on / evaluate / waitForSelector /
  // context().cookies() / url / removeListener / close.
  function fakePage() {
    return {
      _handlers: {},
      on(ev, fn) { this._handlers[ev] = fn; },
      removeListener() {},
      async goto() {},
      url() { return 'https://airtable.com/'; },
      async waitForSelector() { return {}; },
      async waitForFunction() { return true; },
      async waitForTimeout() {},
      // _extractCsrf reads BOTH page-only credentials in one evaluate: the csrf
      // token and the signed-in user id from the page bootstrap (getUserProperties
      // never carries an identity — issue #21).
      async evaluate() { return { csrfToken: 'CSRF-FROM-FAKE', sessionUserId: 'usrFAKE0000000000' }; },
      context() {
        return {
          cookies: async () => [{ name: 'brw', value: '1', domain: '.airtable.com' }],
        };
      },
    };
  }

  function fakeContext() {
    const page = fakePage();
    return {
      _page: page,
      pages() { return [page]; },
      async newPage() { return page; },
      async close() {},
    };
  }

  function makeAuth({ killSpy, launchImpl }) {
    const auth = new AirtableAuth({
      profileDir: '/fake/profile',
      relaunchWaitMs: 0,
      killProfileHolders: killSpy,
      getChromium: async () => ({ launchPersistentContext: launchImpl }),
    });
    // Stub the direct-HTTP verify so _verifySession sees a valid session
    // without any network. _snapshotCredentials runs for real over the fake
    // page cookies, then _verifySession issues this GET.
    // Real authenticated body shape: feature flags, no identity anywhere.
    auth._rawApiCall = async () => ({ status: 200, body: '{"gemini":false,"libra":false}' });
    return auth;
  }

  it('init() recovers from a locked profile, kills the holder once, and completes login', async () => {
    let killed = 0;
    let attempts = 0;
    const ctx = fakeContext();
    const auth = makeAuth({
      killSpy: async () => { killed++; return { killed: true }; },
      launchImpl: async () => {
        attempts++;
        if (attempts === 1) throw exit21();
        return ctx;
      },
    });

    await auth.init();

    assert.equal(attempts, 2, 'launch retried once after the lock');
    assert.equal(killed, 1, 'stale holder killed exactly once');
    assert.equal(auth.context, ctx);
    assert.equal(auth.isLoggedIn, true);
    assert.equal(auth.userId, 'usrFAKE0000000000');
  });

  it('init() with a clean launch never kills (default path unchanged)', async () => {
    let killed = 0;
    let attempts = 0;
    const ctx = fakeContext();
    const auth = makeAuth({
      killSpy: async () => { killed++; return { killed: true }; },
      launchImpl: async () => { attempts++; return ctx; },
    });

    await auth.init();

    assert.equal(attempts, 1);
    assert.equal(killed, 0);
    assert.equal(auth.isLoggedIn, true);
  });
});
