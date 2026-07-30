import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';
import { sessionVerdict } from '../src/health-check.js';
import { pollForSessionUser } from '../src/session-user.js';

/**
 * SITE-level tests for issue #21's fix. test-session-user.test.js pins the shared
 * helpers; these pin the four places that decide something with them, because a
 * helper with teeth proves nothing if a call site stops using it — or uses it in
 * the wrong place.
 *
 * The one design constraint behind all four (live probes against airtable.com,
 * 2026-07): "sessionUserId":"usr…" in page HTML is a sound POSITIVE signal, but
 * its ABSENCE is ambiguous — signed out, wrong page, incomplete render, or a
 * renamed key all look identical. So identity gates only where a human is waiting
 * on a green light (login polls, the spawned health-check) and is advisory where
 * failing means an outage (server init, whose cookie Airtable already accepted).
 */

function auth(overrides = {}) {
  const a = new AirtableAuth({ profileDir: '/fake/profile', configDir: '/fake/config' });
  return Object.assign(a, overrides);
}

describe('auth._verifySession — identity is ADVISORY at init, never a gate', () => {
  // The anti-regression that matters most. A throw here propagates through
  // _doInit's catch (which closes the context and nulls page/context), so every
  // one of the 71 tools fails; via _recoverSession it also counts toward the
  // dead-session breaker, turning one scrape drift into a latched outage and a
  // records job into a per-row Chromium relaunch march.
  it('a 200 with NO readable session user must NOT throw, and must not invent a userId', async () => {
    const a = auth({
      page: {
        // page.content() provably throws mid-navigation, and the previous pass
        // read the id from it — "could not read" was indistinguishable from
        // "nobody is signed in".
        async content() { throw new Error('Unable to retrieve content because the page is navigating and changing the content.'); },
      },
      _rawApiCall: async () => ({ status: 200, body: '{"gemini":false,"libra":false}' }),
    });

    await a._verifySession();

    assert.equal(a.isLoggedIn, true, 'Airtable accepted the cookie — the session is usable');
    assert.equal(a.userId, null, 'unknown identity is reported as unknown, never guessed');
  });

  it('a 200 with a signed-out-looking page must NOT throw either — absence proves nothing', async () => {
    const a = auth({
      page: { async content() { return '<html><body>Sign in</body></html>'; } },
      _rawApiCall: async () => ({ status: 200, body: '{"gemini":false}' }),
    });

    await a._verifySession();

    assert.equal(a.isLoggedIn, true);
    assert.equal(a.userId, null);
  });

  it('a status-0 verify says NETWORK/TLS/proxy and carries result.error — not "the login has expired"', async () => {
    const a = auth({
      page: { async content() { return ''; } },
      _rawApiCall: async () => ({
        status: 0,
        error: 'fetch failed: unable to get local issuer certificate — set NODE_EXTRA_CA_CERTS',
      }),
    });

    await assert.rejects(() => a._verifySession(), (err) => {
      assert.match(err.message, /could not be reached/i, 'headline names the real failure');
      assert.match(err.message, /NETWORK\/TLS\/proxy/i);
      assert.match(err.message, /unable to get local issuer certificate/, 'the transport detail survives');
      assert.doesNotMatch(err.message, /login has expired/i, 'status 0 is never an auth verdict');
      return true;
    });
    assert.equal(a.isLoggedIn, false);
  });
});

describe('auth.checkSessionHealth — honest status verdict, no identity gate', () => {
  it('a 2xx is valid and reports only the id it actually knows', async () => {
    const a = auth({ page: {}, userId: null });
    a.ensureLoggedIn = async () => {};
    a.get = async () => ({ ok: true, status: 200 });

    assert.deepEqual(await a.checkSessionHealth(), { valid: true, userId: null });
  });

  it('a rejected probe carries a populated error, not a bare status', async () => {
    const a = auth({ page: {} });
    a.ensureLoggedIn = async () => {};
    a.get = async () => ({ ok: false, status: 401 });

    const health = await a.checkSessionHealth();
    assert.equal(health.valid, false);
    assert.equal(health.status, 401);
    assert.match(health.error, /HTTP 401/);
  });
});

describe('health-check.js sessionVerdict — STRICT, because a human reads this light', () => {
  it('200 with no user id is NOT valid — that verdict is issue #21 itself', () => {
    const verdict = sessionVerdict({ status: 200, userId: null });
    assert.equal(verdict.valid, false);
    assert.equal(verdict.status, 200);
    assert.match(verdict.error, /no signed-in user/);
  });

  it('200 with a real user id is valid', () => {
    assert.deepEqual(sessionVerdict({ status: 200, userId: 'usrjYwJtwMvPtHYMW' }), {
      valid: true,
      userId: 'usrjYwJtwMvPtHYMW',
    });
  });
});

describe('pollForSessionUser — the one copy of the login poll', () => {
  function fakePage(evaluate) {
    const page = { sleeps: 0, evals: 0 };
    page.waitForTimeout = async () => { page.sleeps++; };
    page.evaluate = async () => { page.evals++; return evaluate(page.evals); };
    return page;
  }

  it('keeps polling through an anonymous 200 instead of declaring success', async () => {
    const page = fakePage(() => ({ status: 200, userId: null }));

    const result = await pollForSessionUser(page, 3);

    assert.equal(result.userId, null, 'a 2xx alone never ends the poll');
    assert.match(result.reason, /no signed-in user/);
    assert.equal(page.evals, 3, 'the full budget was actually spent waiting');
    assert.equal(page.sleeps, 3, 'and every iteration paid its delay');
  });

  it('stops as soon as a real user id appears', async () => {
    const page = fakePage((n) => ({ status: 200, userId: n < 2 ? null : 'usrjYwJtwMvPtHYMW' }));

    assert.deepEqual(await pollForSessionUser(page, 10), { userId: 'usrjYwJtwMvPtHYMW' });
    assert.equal(page.evals, 2);
  });

  it('reports a closed window as abandoned, not as a timeout', async () => {
    const page = fakePage(() => { throw new Error('Target page, context or browser has been closed'); });

    assert.deepEqual(await pollForSessionUser(page, 10), { userId: null, closed: true });
    assert.equal(page.evals, 1);
  });

  it('retries a navigation — that is the only failure worth swallowing', async () => {
    const page = fakePage((n) => {
      if (n === 1) throw new Error('Execution context was destroyed, most likely because of a navigation');
      return { status: 200, userId: 'usrjYwJtwMvPtHYMW' };
    });

    assert.deepEqual(await pollForSessionUser(page, 10), { userId: 'usrjYwJtwMvPtHYMW' });
  });

  it('RE-THROWS a crash instead of spinning the budget and blaming a timeout', async () => {
    const page = fakePage(() => { throw new Error('Page crashed'); });

    await assert.rejects(() => pollForSessionUser(page, 150), /Page crashed/);
    assert.equal(page.evals, 1, 'no 150-iteration burn, no bogus "not detected after 5 minutes"');
  });
});
