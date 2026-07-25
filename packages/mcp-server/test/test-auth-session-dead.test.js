import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

// The internal API shares Airtable's ~5 req/s-per-base limit; a burst answers 403/429. The auth
// layer must BACK OFF and retry the SAME session (relaunching on a throttle 403 only fires more
// page-load requests and amplifies the limit — the observed 403→relaunch→403 storm). Genuine auth
// loss (401/network) still relaunches. A throttle that never clears trips the dead-session breaker.
function fakeAuth() {
  const a = new AirtableAuth();
  a._sessionDeadAfter = 3;          // trip quickly for the test
  a._rlSleep = async () => {};      // no real backoff waits
  a.context = {}; a.isLoggedIn = true;
  a.page = { url: () => 'https://airtable.com/' };
  a._doInitCalls = 0;
  a._doInit = async () => { a._doInitCalls++; a.context = {}; a.isLoggedIn = true; };
  return a;
}

describe('AirtableAuth — throttle backoff vs. recovery', () => {
  it('403 backs off on the SAME session (no relaunch) and trips the breaker if it never clears', async () => {
    const a = fakeAuth();
    a._rawApiCall = async () => ({ status: 403, body: '' });
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a._sessionDead, true);
    assert.equal(a._doInitCalls, 0); // KEY: a throttle 403 must NOT relaunch the browser
  });

  it('a 2xx after some 403s resets the streak — no relaunch, no false trip', async () => {
    const a = fakeAuth();
    let n = 0;
    a._rawApiCall = async () => (++n <= 2 ? { status: 403, body: '' } : { status: 200, body: '{}' });
    const res = await a.get('/v0.3/x', 'app1');
    assert.equal(res.status, 200);
    assert.equal(a._recoveryStreak, 0);
    assert.equal(a._doInitCalls, 0);
  });

  it('401 (genuine auth loss) DOES relaunch the session (recovery preserved)', async () => {
    const a = fakeAuth();
    a._rawApiCall = async () => ({ status: 401, body: '' });
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a._sessionDead, true);
    assert.ok(a._doInitCalls >= 1); // 401 → re-auth via relaunch
  });

  it('resetSessionHealth clears the dead flag (after a re-login)', () => {
    const a = fakeAuth();
    a._sessionDead = true; a._recoveryStreak = 9;
    a.resetSessionHealth();
    assert.equal(a._sessionDead, false);
    assert.equal(a._recoveryStreak, 0);
  });
});

// A latched breaker used to be unrecoverable in browser mode: _apiCall short-circuits on
// _sessionDead, and the only production resetSessionHealth() callers were the daemon's
// byo/direct-login credential endpoint and the sync records engine. A browser-mode user had
// to restart the daemon. Re-authentication must clear it — while STILL letting the breaker
// latch on failures that persist across the internal recovery loop.
describe('AirtableAuth — dead-session breaker resets on re-authentication', () => {
  function closable() {
    const a = fakeAuth();
    a.context = { close: async () => {} };
    a._killBrowserTree = async () => {};
    return a;
  }

  it('short-circuits every call once latched (pre-condition)', async () => {
    const a = closable();
    a._rawApiCall = async () => ({ status: 403, body: '' });
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);

    let attempts = 0;
    a._rawApiCall = async () => { attempts++; return { status: 200, body: '{}' }; };
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(attempts, 0, 'a latched breaker must not even attempt the request');
  });

  it('close() (the /daemon/release-browser + re-login path) clears it and the next call is ATTEMPTED', async () => {
    const a = closable();
    a._rawApiCall = async () => ({ status: 403, body: '' });
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);

    // The extension releases the daemon's browser before an interactive login.
    await a.close();
    assert.equal(a.isSessionDead(), false, 'a full teardown must not carry the breaker forward');

    let attempts = 0;
    a._rawApiCall = async () => { attempts++; return { status: 200, body: '{}' }; };
    const res = await a.get('/v0.3/x', 'app1');
    assert.equal(res.status, 200);
    assert.equal(attempts, 1, 'the re-authenticated session must actually issue the request');
    assert.ok(a._doInitCalls >= 1, 're-init ran after the teardown');
  });

  it('a successful EXTERNAL init clears a stale breaker', async () => {
    const a = closable();
    a._sessionDead = true; a._recoveryStreak = 9; a._lastTripStatus = 403;
    a.context = null; a.isLoggedIn = false;
    await a.init();
    assert.equal(a.isSessionDead(), false);
    assert.equal(a._recoveryStreak, 0);
    assert.equal(a.getLastTrip(), null);
  });

  it('an init driven by the INTERNAL recovery loop does NOT clear it (breaker can still latch)', async () => {
    const a = closable();
    a._sessionDead = true; a._recoveryStreak = 9;
    a._recovering = true;                 // exactly what _recoverSession sets
    await a._doInitBounded();
    assert.equal(a.isSessionDead(), true, 'recovery-driven re-init must not defuse the breaker');
    assert.equal(a._recoveryStreak, 9);
  });
});
