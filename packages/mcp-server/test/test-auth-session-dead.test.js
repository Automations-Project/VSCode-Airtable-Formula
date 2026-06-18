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
