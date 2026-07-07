import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

/**
 * Session-recovery bug fix — browser-free 403 escalation + trip instrumentation
 * + records-facing surface.
 *
 * In direct-login / byo (browser-free) modes an expired session or a rotated
 * CSRF token surfaces on mutations as HTTP 403, not 401. The old code classified
 * EVERY 403 as throttle (back off, never re-auth) so a long records job burned
 * its whole batch as SESSION_INVALID. The fix: a 403 that PERSISTS past one
 * throttle backoff in a browser-free mode escalates to _recoverSession (a single
 * HTTP _directLogin / cookie reload — no page-load burst), while browser mode
 * keeps 403 throttle-only (relaunch on 403 re-trips the ~5 req/s limit → storm).
 *
 * All network is stubbed on the instance — these never touch live Airtable.
 */

// AIRTABLE_AUTH_MODE is read in the constructor, so it must be set BEFORE `new`.
const MODE_ENV = 'AIRTABLE_AUTH_MODE';
let savedMode;
beforeEach(() => { savedMode = process.env[MODE_ENV]; });
afterEach(() => {
  if (savedMode === undefined) delete process.env[MODE_ENV];
  else process.env[MODE_ENV] = savedMode;
});

/** Build an auth in the given mode with all network + init stubbed out. */
function stubbedAuth(mode) {
  process.env[MODE_ENV] = mode;
  const a = new AirtableAuth();
  a._sessionDeadAfter = 3;              // trip the breaker quickly
  a._rlSleep = async () => {};          // no real backoff waits
  a.ensureLoggedIn = async () => {};    // skip init() entirely
  a._credentials = { cookieHeader: 'c=1', csrfToken: 'z' };
  a.isLoggedIn = true;
  return a;
}

describe('auth 403 → re-auth in browser-free modes (R1)', () => {
  it('direct-login: a 403 persisting past one backoff escalates to _recoverSession, then succeeds', async () => {
    const a = stubbedAuth('direct-login');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    let n = 0;
    // 403, 403, then 200 — the first 403 is a throttle backoff, the second escalates.
    a._rawApiCall = async () => (++n <= 2 ? { status: 403, body: '' } : { status: 200, body: '{}' });

    const res = await a.get('/v0.3/x', 'app1');
    assert.equal(res.status, 200);
    assert.ok(recoverCalls >= 1, '_recoverSession should fire for a persistent 403');
    assert.equal(a._recoveryStreak, 0, 'a 2xx resets the streak');
    assert.equal(a._sessionDead, false);
  });

  it('byo: a persistent 403 also escalates to _recoverSession', async () => {
    const a = stubbedAuth('byo');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    let n = 0;
    a._rawApiCall = async () => (++n <= 2 ? { status: 403, body: '' } : { status: 200, body: '{}' });

    const res = await a.get('/v0.3/x', 'app1');
    assert.equal(res.status, 200);
    assert.ok(recoverCalls >= 1, '_recoverSession should fire for a persistent 403 in byo mode');
  });

  it('direct-login: a single transient 403 that clears on backoff does NOT re-auth', async () => {
    const a = stubbedAuth('direct-login');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    let n = 0;
    // Only ONE 403, then 200 — the allowed first backoff clears it, no re-login.
    a._rawApiCall = async () => (++n === 1 ? { status: 403, body: '' } : { status: 200, body: '{}' });

    const res = await a.get('/v0.3/x', 'app1');
    assert.equal(res.status, 200);
    assert.equal(recoverCalls, 0, 'one transient 403 must clear via backoff, not re-login');
  });

  it('browser mode: 403 stays throttle-only — _recoverSession is NEVER called', async () => {
    const a = stubbedAuth('browser');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    a._rawApiCall = async () => ({ status: 403, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(recoverCalls, 0, 'browser mode must not relaunch on 403 (throttle-only)');
    assert.equal(a._sessionDead, true);
  });

  it('429 stays pure throttle even in direct-login mode (no re-auth)', async () => {
    const a = stubbedAuth('direct-login');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    a._rawApiCall = async () => ({ status: 429, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(recoverCalls, 0, '429 must never escalate to re-auth');
  });
});

describe('auth latch trip instrumentation (R2)', () => {
  it('direct-login: an unrecoverable 403 latches _sessionDead and records the trip status', async () => {
    const a = stubbedAuth('direct-login');
    a._recoverSession = async () => {};            // recovery no-ops → 403 never clears
    a._rawApiCall = async () => ({ status: 403, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);
    const trip = a.getLastTrip();
    assert.equal(trip.status, 403);
    assert.ok(typeof trip.reason === 'string' && trip.reason.length > 0);
  });

  it('a 401 latch records status 401', async () => {
    const a = stubbedAuth('direct-login');
    a._recoverSession = async () => {};
    a._rawApiCall = async () => ({ status: 401, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);
    assert.equal(a.getLastTrip().status, 401);
  });

  it('getLastTrip() returns null while the session is alive', () => {
    const a = stubbedAuth('direct-login');
    assert.equal(a.getLastTrip(), null);
    assert.equal(a.isSessionDead(), false);
  });
});

describe('auth resetSessionHealth clears trip fields (R2/R3)', () => {
  it('after a latch, resetSessionHealth clears the dead flag and the trip', async () => {
    const a = stubbedAuth('direct-login');
    a._recoverSession = async () => {};
    a._rawApiCall = async () => ({ status: 403, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);
    assert.notEqual(a.getLastTrip(), null);

    a.resetSessionHealth();
    assert.equal(a.isSessionDead(), false);
    assert.equal(a.getLastTrip(), null);
    assert.equal(a._recoveryStreak, 0);
  });
});

describe('auth ensureSessionHealthy (R3)', () => {
  it('a healthy probe returns { healthy:true, recovered:false } without recovering', async () => {
    const a = stubbedAuth('direct-login');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    a.checkSessionHealth = async () => ({ valid: true, userId: 'u1' });

    const out = await a.ensureSessionHealthy();
    assert.deepEqual(out, { healthy: true, recovered: false });
    assert.equal(recoverCalls, 0);
  });

  it('direct-login: an invalid probe recovers then re-probes → { healthy:true, recovered:true }', async () => {
    const a = stubbedAuth('direct-login');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    let probes = 0;
    a.checkSessionHealth = async () => (++probes === 1 ? { valid: false, status: 403 } : { valid: true, userId: 'u1' });

    const out = await a.ensureSessionHealthy();
    assert.equal(out.healthy, true);
    assert.equal(out.recovered, true);
    assert.equal(recoverCalls, 1);
  });

  it('browser mode: an invalid probe does NOT recover here → { healthy:false, recovered:false }', async () => {
    const a = stubbedAuth('browser');
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    a.checkSessionHealth = async () => ({ valid: false, status: 401 });

    const out = await a.ensureSessionHealthy();
    assert.deepEqual(out, { healthy: false, recovered: false });
    assert.equal(recoverCalls, 0);
  });

  it('never throws — a throwing probe degrades to { healthy:false }', async () => {
    const a = stubbedAuth('direct-login');
    a.checkSessionHealth = async () => { throw new Error('boom'); };

    const out = await a.ensureSessionHealthy();
    assert.equal(out.healthy, false);
  });
});

describe('auth bounded-loop guarantee under default config (R4)', () => {
  it('direct-login: default _sessionDeadAfter=8 (> MAX_RETRIES=3) still terminates — the 403 escalation exhausts its attempt budget and falls through to the throttle streak', async () => {
    const a = stubbedAuth('direct-login');
    a._sessionDeadAfter = 8; // GREATER than MAX_RETRIES=3 — proves the loop bounds itself even when
                              // the dead-session threshold outlives the recovery-attempt cap.
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; }; // no-op — session never heals, every call still 403s
    a._rawApiCall = async () => ({ status: 403, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a.isSessionDead(), true);
    assert.equal(a.getLastTrip().status, 403);
    // MAX_RETRIES=3 re-auth attempts are spent (persist403 branch), then every further 403
    // falls through to the plain throttle branch until the streak reaches _sessionDeadAfter.
    assert.equal(recoverCalls, 3, 'recovery attempts are bounded by MAX_RETRIES, not _sessionDeadAfter');
  });

  it('direct-login: 503 stays pure throttle — _recoverSession is NEVER called', async () => {
    const a = stubbedAuth('direct-login');
    a._sessionDeadAfter = 3;
    let recoverCalls = 0;
    a._recoverSession = async () => { recoverCalls++; };
    a._rawApiCall = async () => ({ status: 503, body: '' });

    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(recoverCalls, 0, '503 must never escalate to re-auth in any mode, including direct-login');
    assert.equal(a.isSessionDead(), true);
    assert.equal(a.getLastTrip().status, 503);
  });
});
