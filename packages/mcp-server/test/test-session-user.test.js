import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUserId,
  isAuthenticatedProbe,
  probeFailureReason,
  scrapeSessionUserId,
  isBrowserClosedError,
  isPageNavigatingError,
  POLL_BUDGET_LABEL,
  SESSION_PROBE_SOURCE,
} from '../src/session-user.js';

/**
 * Issue #21 — `npx airtable-user-mcp login` reported success and closed the
 * browser ~2s after opening it, leaving an unauthenticated profile behind and
 * every later tool call failing with "Session invalid (0)".
 *
 * Cause: all four login poll loops (+ health-check) accepted ANY 200 from
 * /v0.3/getUserProperties as proof of login, and read the user out of
 * `data.data.userId` — a path that does not exist in that response AT ALL.
 * Two live probes against airtable.com pin the real shapes:
 *
 *   authenticated 200 → {"gemini":false,"libra":false,…}   ← no identity, so the
 *                       first poll "succeeded" and printed "User: undefined"
 *   anonymous       → 401 {"errorType":"auth"…}, but the visitor DOES hold a
 *                     __Host-airtable-session cookie, so cookie presence proves
 *                     nothing either
 *   the id lives in the page bootstrap as "sessionUserId":"usr…"
 *
 * So the verdict now needs BOTH a 2xx and a real usr-id. These tests pin that
 * decision (the browser half is exercised by the runners themselves — a launch
 * is out of scope for a unit test).
 */

describe('isUserId', () => {
  it('accepts a real usr id (usr + 14 alphanumerics, as observed)', () => {
    assert.equal(isUserId('usrjYwJtwMvPtHYMW'), true);
  });

  it('rejects the values an anonymous / malformed payload actually yields', () => {
    for (const v of [undefined, null, '', 'undefined', 'usr', 'usrShort', 'recjYwJtwMvPtHYMW', 123, {}]) {
      assert.equal(isUserId(v), false, `expected ${JSON.stringify(v)} to be rejected`);
    }
  });
});

describe('isAuthenticatedProbe', () => {
  it('200 with a usr id => authenticated', () => {
    assert.equal(isAuthenticatedProbe({ status: 200, userId: 'usrjYwJtwMvPtHYMW' }), true);
  });

  it('anonymous 200 (no userId) => NOT authenticated — the whole bug', () => {
    assert.equal(isAuthenticatedProbe({ status: 200, userId: null }), false);
    assert.equal(isAuthenticatedProbe({ status: 200 }), false);
  });

  it('malformed / empty probe => NOT authenticated', () => {
    assert.equal(isAuthenticatedProbe(null), false);
    assert.equal(isAuthenticatedProbe({}), false);
    assert.equal(isAuthenticatedProbe({ status: 200, userId: 'undefined' }), false);
  });

  it('non-2xx => NOT authenticated, even with an id on the page', () => {
    assert.equal(isAuthenticatedProbe({ status: 401, userId: null }), false);
    assert.equal(isAuthenticatedProbe({ status: 401, userId: 'usrjYwJtwMvPtHYMW' }), false);
    assert.equal(isAuthenticatedProbe({ status: 0, error: 'fetch failed' }), false);
  });
});

describe('probeFailureReason', () => {
  it('names the anonymous case instead of leaving the next reporter guessing', () => {
    assert.match(probeFailureReason({ status: 200, userId: null }), /no signed-in user/);
  });

  it('distinguishes no-response from a rejected status', () => {
    assert.match(probeFailureReason(null), /never answered/);
    assert.match(probeFailureReason({ status: 0 }), /no HTTP response/);
    assert.match(probeFailureReason({ status: 401 }), /HTTP 401/);
    assert.match(probeFailureReason({ status: 0, error: 'fetch failed' }), /fetch failed/);
  });
});

describe('scrapeSessionUserId', () => {
  it('reads the id out of the page bootstrap', () => {
    const html = '<script>window.x={"isLoggedIn":true,"sessionUserId":"usrjYwJtwMvPtHYMW","foo":1}</script>';
    assert.equal(scrapeSessionUserId(html), 'usrjYwJtwMvPtHYMW');
  });

  it('returns null for a signed-out page and for non-strings', () => {
    assert.equal(scrapeSessionUserId('<html><body>Sign in</body></html>'), null);
    assert.equal(scrapeSessionUserId(undefined), null);
  });

  it('ignores the service pseudo-users Airtable ships in the same blob', () => {
    // "rawUsers":{"usrAISERVICE00000":…} appears on a logged-in page — matching
    // any usr-shaped string instead of the sessionUserId key would accept those.
    assert.equal(scrapeSessionUserId('{"rawUsers":{"usrAISERVICE00000":{"name":"AI"}}}'), null);
  });
});

describe('isBrowserClosedError', () => {
  it('recognises a user-closed window as such', () => {
    assert.equal(isBrowserClosedError(new Error('Target page, context or browser has been closed')), true);
    assert.equal(isBrowserClosedError(new Error('Protocol error (Runtime.evaluate): Target closed.')), true);
  });

  it('does not swallow a navigation — the poll must keep going', () => {
    assert.equal(isBrowserClosedError(new Error('Execution context was destroyed, most likely because of a navigation')), false);
    assert.equal(isBrowserClosedError(undefined), false);
  });
});

describe('isPageNavigatingError', () => {
  it('retries a navigation that raced an in-flight evaluate', () => {
    assert.equal(isPageNavigatingError(new Error('Execution context was destroyed, most likely because of a navigation')), true);
    assert.equal(isPageNavigatingError(new Error('Cannot find context with specified id')), true);
    assert.equal(isPageNavigatingError(new Error('Frame was detached')), true);
  });

  it('does NOT retry a crash — waitForTimeout rejects with "Page crashed", and swallowing it burned all 150 iterations in microseconds', () => {
    assert.equal(isPageNavigatingError(new Error('Page crashed')), false);
    assert.equal(isPageNavigatingError(new Error('Protocol error (Runtime.evaluate): Target closed.')), false);
    assert.equal(isPageNavigatingError(undefined), false);
  });
});

describe('POLL_BUDGET_LABEL', () => {
  it('is derived from the shared cadence, so no message can claim a budget the loop does not use', () => {
    assert.equal(POLL_BUDGET_LABEL, '5 minutes');
  });
});

describe('SESSION_PROBE_SOURCE', () => {
  it('is source TEXT, not a function — page.evaluate serializes callbacks, so an imported helper would break in-page', () => {
    assert.equal(typeof SESSION_PROBE_SOURCE, 'string');
    assert.match(SESSION_PROBE_SOURCE, /getUserProperties/);
    assert.match(SESSION_PROBE_SOURCE, /sessionUserId/);
  });
});
