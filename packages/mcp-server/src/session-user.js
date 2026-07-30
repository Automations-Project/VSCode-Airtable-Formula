/**
 * Shared "is anybody actually signed in?" helpers for the login/health probes.
 *
 * Issue #21: every poll loop treated ANY 200 from /v0.3/getUserProperties as
 * proof of login, so `npx airtable-user-mcp login` printed
 * "✅ Login verified! User: undefined" and closed the browser ~2s after opening
 * it — before an SSO round trip (or a human typing a password) could finish.
 *
 * Facts behind the fix (live probes against airtable.com, 2026-07):
 *   1. getUserProperties NEVER carries identity. Its AUTHENTICATED 200 body is
 *      eight feature-flag booleans: {"gemini":false,"libra":false,…}. There is no
 *      `data.userId` anywhere in it — that is why the checkmark printed
 *      `undefined` on every login, successful or not.
 *   2. A COOKIELESS caller gets 401 from it ("No cookie presented. Please
 *      re-login"), so an ACCEPTED call does carry real signal. It is not
 *      conclusive: the issue reporter demonstrably reached a state where a
 *      stale/partial profile cookie was still accepted here while their SSO
 *      session was not usable. We could not reproduce that state.
 *   3. The signed-in user id lives in page HTML as "sessionUserId":"usr…" — the
 *      SPA reads it there and builds its own /v0.3/user/<usr…>/… URLs from it.
 *      PRESENT ⇒ signed in. ABSENT proves nothing by itself: it is equally what
 *      you see when the wrong page loaded, the render had not finished, or
 *      Airtable renamed the key. (Corroborating with other keys does NOT help
 *      and was checked: the anonymous /login page DOES contain "csrfToken", and
 *      anonymous pages have no "isLoggedIn" key at all, so its absence is mute.)
 *
 * That asymmetry decides where the identity read is a GATE and where it is only
 * advice. In a login poll a human is waiting and the status alone provably
 * cannot separate "not signed in yet" from "signed in", so a real id is
 * required. At server init the cookie has ALREADY been accepted over direct HTTP
 * (fact 2), so a missing id is logged and ignored — see auth._verifySession:
 * gating there turns one scrape drift into a total outage of all 71 tools.
 *
 * The predicate lives in Node, OUTSIDE page.evaluate(): playwright ships the
 * callback's own source to the browser, so a callback referencing an import
 * would throw in-page. That is why the in-page half is a source STRING
 * (page.evaluate accepts one) returning raw { status, userId } for Node to judge.
 */

/** `usr` + 14 alphanumerics (observed length 17); `{14,}` matches remap.js's house style. */
const USER_ID_RE = /^usr[A-Za-z0-9]{14,}$/;

/** Where the id actually lives — see fact 3 above. Exported so auth.js can hand
 *  its source into a page.evaluate() without keeping a second copy of it. */
export const SESSION_USER_ID_IN_HTML = /"sessionUserId"\s*:\s*"(usr[A-Za-z0-9]{14,})"/;

/**
 * Login poll cadence, shared by every loop that waits for a sign-in. There used
 * to be four copies of that loop and they had already drifted — one polled for
 * 60s while the other three polled for 300s — and divergence between copies is
 * how issue #21 survived this long. 150 × 2s = 5 minutes: every one of these
 * loops has to tolerate SSO plus a 2FA code typed by hand.
 */
export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_ATTEMPTS = 150;
/** Derived, never hand-written: the budget in every user-facing timeout message. */
export const POLL_BUDGET_LABEL = `${(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 60_000} minutes`;

export function isUserId(value) {
  return typeof value === 'string' && USER_ID_RE.test(value);
}

/** Pull the signed-in user id out of an Airtable page's HTML. null when absent. */
export function scrapeSessionUserId(html) {
  const m = typeof html === 'string' ? html.match(SESSION_USER_ID_IN_HTML) : null;
  return m && isUserId(m[1]) ? m[1] : null;
}

/**
 * The login verdict. A 2xx alone is NOT proof of login (issue #21) — a real user
 * id has to come with it. Only for the strict sites: a login poll and the
 * spawned health-check, where a human is waiting and a false green IS the bug.
 */
export function isAuthenticatedProbe(probe) {
  return !!probe && probe.status >= 200 && probe.status < 300 && isUserId(probe.userId);
}

/**
 * Why a probe didn't count as signed in. Names the anonymous case explicitly so
 * the next bug report doesn't have to guess which half failed.
 */
export function probeFailureReason(probe) {
  if (!probe) return 'the browser never answered a session probe';
  if (probe.error) return `the session probe failed: ${probe.error}`;
  if (!probe.status) return 'the session probe got no HTTP response';
  if (probe.status < 200 || probe.status >= 300) return `Airtable answered HTTP ${probe.status}`;
  // An observation, not a conclusion: a missing marker reads the same whether the
  // profile is signed out, the wrong page loaded, or the render was incomplete.
  return `Airtable answered HTTP ${probe.status} but the loaded page carries no signed-in user`;
}

/**
 * A closed window/tab is how a user abandons a login — a normal outcome, not a
 * crash. Playwright surfaces it from waitForTimeout/evaluate as a rejection.
 */
export function isBrowserClosedError(err) {
  const msg = err && err.message ? String(err.message) : String(err ?? '');
  // "Target page, context or browser has been closed" / "Target closed". NOT
  // "Execution context was destroyed" — that one is a navigation, keep polling.
  return /target closed|has been closed/i.test(msg);
}

/**
 * The ONLY failure a session poll may retry: the page navigated out from under
 * an in-flight evaluate. Deliberately narrow, because the alternative is what
 * the previous pass shipped — a bare `catch {}` that also swallowed
 * "Page crashed". page.waitForTimeout is progress.wait(), which rejects on
 * ABORT and not only on close, and a crash aborts it; a swallowed rejection
 * there burns all 150 iterations in microseconds and then reports
 * "Login not detected after 5 minutes" ~0ms in, hiding the real error.
 */
export function isPageNavigatingError(err) {
  const msg = err && err.message ? String(err.message) : String(err ?? '');
  return /execution context was destroyed|cannot find context|frame (was|got) detached|page is navigating/i.test(msg);
}

/**
 * In-page session probe, as source text for page.evaluate() (see header note on
 * why this cannot be a function). Returns raw facts only — Node decides.
 */
export const SESSION_PROBE_SOURCE = `(async () => {
  let status = 0;
  let error;
  try {
    const res = await fetch('/v0.3/getUserProperties', {
      headers: {
        'x-airtable-inter-service-client': 'webClient',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    status = res.status;
  } catch (e) {
    error = e.message;
  }
  const m = document.documentElement.innerHTML.match(${SESSION_USER_ID_IN_HTML});
  return { status, userId: m ? m[1] : null, error };
})()`;

/**
 * Wait for a real signed-in user to show up in the page. The single copy of the
 * loop that login.js (×2), login-runner.js and manual-login-runner.js all ran
 * separately — see POLL_MAX_ATTEMPTS on why one copy matters.
 *
 * @returns {Promise<{userId: string|null, closed?: true, reason?: string}>}
 *   `{ userId }`               — signed in
 *   `{ userId: null, closed }` — the user closed the window (abandoned login)
 *   `{ userId: null, reason }` — budget exhausted, with the last probe's reason
 * Anything else THROWS with its real message; see isPageNavigatingError.
 */
export async function pollForSessionUser(page, maxAttempts = POLL_MAX_ATTEMPTS) {
  let lastProbe = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.waitForTimeout(POLL_INTERVAL_MS);
      lastProbe = await page.evaluate(SESSION_PROBE_SOURCE);
    } catch (err) {
      if (isBrowserClosedError(err)) return { userId: null, closed: true };
      // Never a blanket swallow: only a navigating page is retried, everything
      // else surfaces with its real message instead of a bogus timeout report.
      if (!isPageNavigatingError(err)) throw err;
      continue;
    }
    if (isAuthenticatedProbe(lastProbe)) return { userId: lastProbe.userId };
  }
  return { userId: null, reason: probeFailureReason(lastProbe) };
}
