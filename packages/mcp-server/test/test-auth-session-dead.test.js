import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

// Regression: when the Airtable session is dead/blocked, EVERY API call 403s → recover → 403,
// which previously looped futilely for minutes (observed: 9+ min, 0 progress). The circuit-breaker
// counts consecutive recoveries (reset by any 2xx) and, past the threshold, marks the session dead
// and fails fast with a re-login message instead of looping.
function deadSessionAuth() {
  const a = new AirtableAuth();
  a._sessionDeadAfter = 3;                 // trip within one call's MAX_RETRIES for the test
  a.context = {}; a.isLoggedIn = true;     // ensureLoggedIn becomes a no-op
  a.page = { url: () => 'https://airtable.com/' };
  a._doInit = async () => { a.context = {}; a.isLoggedIn = true; }; // recovery "succeeds"
  a._rawApiCall = async () => ({ status: 403, body: '' });          // every call 403s
  return a;
}

describe('AirtableAuth — dead-session circuit-breaker', () => {
  it('aborts with SESSION_INVALID after N consecutive 403-recoveries (no infinite loop)', async () => {
    const a = deadSessionAuth();
    await assert.rejects(() => a.get('/v0.3/x', 'app1'), /SESSION_INVALID/);
    assert.equal(a._sessionDead, true);
    // once dead, subsequent calls fail fast (no further browser relaunches)
    await assert.rejects(() => a.get('/v0.3/y', 'app1'), /SESSION_INVALID/);
  });

  it('a 2xx resets the streak — transient blips do NOT trip the breaker', async () => {
    const a = deadSessionAuth();
    let n = 0;
    a._rawApiCall = async () => (++n <= 2 ? { status: 403, body: '' } : { status: 200, body: '{}' });
    const res = await a.get('/v0.3/x', 'app1'); // 403, 403, then 200
    assert.equal(res.status, 200);
    assert.equal(a._recoveryStreak, 0);
    assert.equal(a._sessionDead, false);
  });

  it('resetSessionHealth clears the dead flag (after a re-login)', () => {
    const a = deadSessionAuth();
    a._sessionDead = true; a._recoveryStreak = 9;
    a.resetSessionHealth();
    assert.equal(a._sessionDead, false);
    assert.equal(a._recoveryStreak, 0);
  });
});
