import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { trace } from './debug-tracer.js';
import { getHomeDir, getProfileDir } from './paths.js';
import { HttpTransport } from './http-transport.js';
import { loadByoCredentials } from './byo-credentials.js';
import { directLogin } from './direct-login.js';
import { isProfileLockError, killProfileHolders } from './profile-lock.js';
import { PageScheduler } from './page-scheduler.js';
import { killProfileBrowserTree } from './process-tree.js';
import { SESSION_USER_ID_IN_HTML, probeFailureReason } from './session-user.js';

/** Generate a page-load-id (pgl + 13 base36 chars) using crypto, not Math.random. */
function genPageLoadId() {
  // 10 bytes → ~13 base36 chars when converted as BigInt
  const hex = randomBytes(10).toString('hex');
  return 'pgl' + BigInt('0x' + hex).toString(36).slice(0, 13).padStart(13, '0');
}

/**
 * The diagnostic to show for a rejected session probe. A status-0 transport
 * failure carries NO body — its `error` (describeFetchError's CA-cert / proxy
 * advice) is then the only clue there is, and dropping it printed a bare
 * "Session invalid (0): …\nResponse: " for exactly the failures that most
 * needed explaining.
 */
function sessionErrorDetail(result) {
  return String(result?.body || result?.error || '(no response body)').substring(0, 200);
}

/**
 * True only for object literals (`{...}`) and `Object.create(null)` bags —
 * the shapes safe to spread `_csrf` into without silently destroying data.
 * False for `null`/`undefined`, arrays, and any object whose prototype isn't
 * exactly `Object.prototype` or `null` — this excludes `Date`, `Map`, `Set`,
 * `RegExp`, `URL`, `Buffer`, and instances of any class. Spreading one of
 * those (`{...new Date(), _csrf}`) silently discards every bit of the
 * original value, shipping a near-empty body with no error.
 *
 * Prototype identity, not duck-typing, is deliberate: it's the only check
 * that reliably excludes class instances (a `[object Object]` toString-tag
 * check would NOT — a plain class instance reports the same generic tag as
 * a literal). Cross-realm objects (a literal built in another vm context or
 * iframe, whose `Object.prototype` is a distinct object) would therefore
 * misreport as non-plain here; that's accepted, not overlooked — this
 * server's request bodies are always constructed in-process, same Node
 * realm, with no vm sandbox or cross-frame boundary in play.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _chromium = null;
async function getChromium() {
  if (_chromium) return _chromium;
  try {
    const mod = await import('patchright');
    _chromium = mod.chromium;
    return _chromium;
  } catch (err) {
    throw new Error(
      'Browser automation requires patchright. Run `npx airtable-user-mcp install-browser` to set it up.\n' +
      `Original error: ${err.message}`
    );
  }
}

/** Idle time before the browser is parked. 0 disables. Default 30 minutes. */
function resolveIdleParkMs() {
  const raw = process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
  if (raw === undefined || raw === null) return 30 * 60_000;
  const trimmed = String(raw).trim();
  if (trimmed === '') return 30 * 60_000;
  const parsed = Number(trimmed);
  // Only an explicit, well-formed 0 (or negative) disables parking. Garbage used to
  // land here too, so a typo — "30m", "1_800_000", a stray quote — silently pinned a
  // ~300-600MB Chromium tree resident forever, and the env var that was meant to tune
  // parking switched it off instead. Unparseable now means "I didn't understand you,
  // keep the default", which is the safe direction to fail.
  if (!Number.isInteger(parsed)) return 30 * 60_000;
  if (parsed <= 0) return 0;
  return parsed;
}

export { resolveIdleParkMs };

/**
 * Airtable session authenticator using Playwright persistent browser context.
 *
 * Architecture:
 *   - Single browser/profile owner per process
 *   - PageScheduler serializes exclusive work (runExclusive / runBarrier)
 *   - Idle browser parking frees Chromium RSS while keeping cookie credentials
 *   - Automatic session recovery on 401/403
 *   - secretSocketId capture via network interception
 *   - CSRF extraction with multiple fallback strategies
 *
 * Flow:
 *   1. First run: `node src/login.js` opens Chrome with persistent profile
 *   2. User logs in manually (session stored in Chrome profile dir)
 *   3. MCP server launches headless Chrome with same profile for API calls
 *   4. API traffic goes over direct HTTP; browser is for login/recovery only
 *   5. After idle, browser is parked; next recovery path resurrects it
 */
export class AirtableAuth {
  constructor(options = {}) {
    this.profileDir = options.profileDir || getProfileDir();
    this.configDir = options.configDir || getHomeDir();
    this.context = null;
    this.page = null;
    this.isLoggedIn = false;
    this.userId = null;
    this.csrfToken = null;

    // Credential source. 'browser' (default) launches Chromium and mints
    // cookies+CSRF from a persistent profile. 'byo' skips the browser entirely
    // and uses a pasted session cookie (AIRTABLE_COOKIE / credentials.json).
    // 'direct-login' (Phase B) will replicate the HAR login flow over HTTP.
    this._authMode = (process.env.AIRTABLE_AUTH_MODE || 'browser').toLowerCase();

    // PageScheduler — serializes exclusive auth/API work and provides barriers
    // for park/close so we never yank the page from under an in-flight call.
    this._maxQueueSize = Number(process.env.AIRTABLE_MAX_AUTH_QUEUE) || 64;
    this._rateDelayMs = Number(process.env.AIRTABLE_RATE_DELAY_MS) || 0;
    this._scheduler = options.scheduler || new PageScheduler({
      maxQueue: this._maxQueueSize,
      rateDelayMs: this._rateDelayMs,
    });
    this._idleParkMs = options.idleParkMs !== undefined ? options.idleParkMs : resolveIdleParkMs();
    this._parkTimer = null;
    // Single-flight guard for the underlying _doInit() launch — held until it TRULY settles, so a
    // retry after a watchdog timeout re-attaches instead of starting a second Chromium (see _doInitBounded).
    this._doInitInner = null;
    this._killBrowserTree = options.killBrowserTree || killProfileBrowserTree;
    this._unsubBusy = null;
    this._subscribeBusy();

    // Per-app secretSocketId cache (captured from network traffic).
    // LRU-bounded so long-running servers with many bases don't grow this
    // indefinitely.
    this._secretSocketIds = new Map();
    this._maxSocketIdCache = 50;

    // Direct-HTTP transport. API calls now go straight out over node HTTP
    // (fetch by default; impit via AIRTABLE_HTTP_CLIENT=impit) using the
    // credential snapshot below — the browser is only used for login/refresh
    // and secretSocketId capture.
    this._httpTransport = new HttpTransport({ client: process.env.AIRTABLE_HTTP_CLIENT });
    // Captured session credentials for direct HTTP: { cookieHeader, csrfToken }.
    // Populated by _snapshotCredentials() during init/recovery.
    this._credentials = null;

    // Direct-login (browser-free) credential minter. Injectable for tests so
    // the impit/TOTP HTTP flow can be driven over canned responses.
    this._directLogin = options.directLogin || directLogin;

    // Chromium factory seam. When null we lazy-load the real patchright chromium
    // via the module getChromium(); tests inject a fake chromium here.
    this._getChromium = options.getChromium || null;
    // Profile-lock recovery seams. The persistent .chrome-profile is
    // MCP-EXCLUSIVE, so a Chrome still holding its lock (crash/leak → exit 21)
    // is a stale instance safe to kill. _launchContext kills the holder and
    // retries the launch ONCE. Both the killer and the inter-attempt wait are
    // injectable so tests never touch a real process or sleep.
    this._killProfileHolders = options.killProfileHolders || ((dir) =>
      killProfileHolders(dir, { configDir: this.configDir }));
    this._relaunchWaitMs = options.relaunchWaitMs ?? 600;

    // Reference to the page-level 'request' listener so we can detach it on
    // _doInit's context-close step rather than leak it per session-recovery.
    this._networkHandler = null;

    // Session recovery state
    this._recovering = false;
    this._initPromise = null;
    // Circuit-breaker: if the session keeps getting rejected (403/401, or page.evaluate keeps
    // failing) even AFTER re-auth, stop looping recovery futilely (a dead/blocked/expired login —
    // observed as endless "403 → recover → 403"). Counts CONSECUTIVE recoveries; any 2xx resets it.
    // Past the threshold, mark the session dead and fail fast with a re-login message.
    this._recoveryStreak = 0;
    this._sessionDead = false;
    // Trip instrumentation: when the circuit-breaker latches (_sessionDead), record
    // the triggering HTTP status + a short reason so callers (e.g. the records job)
    // can tell a throttle trip (403/429/503) from genuine auth loss (401) or a
    // network/page-eval failure afterward. Null while the session is alive.
    this._lastTripStatus = null;
    this._lastTripReason = null;
    // A short, secrets-safe snippet of Airtable's response BODY at the trip — Airtable's 403/4xx JSON
    // states the ACTUAL reason (permission / CSRF / rate / forbidden action), which a bare status code
    // hides. Surfaced via getLastTrip() so a records-job abort tells us WHY, not just "403".
    this._lastTripBody = null;
    this._sessionDeadAfter = Number(process.env.AIRTABLE_SESSION_DEAD_AFTER) || 8;
    this._rlSleep = (ms) => new Promise((r) => setTimeout(r, ms)); // injectable for tests
  }

  /** Reset the dead-session circuit-breaker (e.g., after the user re-authenticates). */
  resetSessionHealth() {
    this._sessionDead = false;
    this._recoveryStreak = 0;
    this._lastTripStatus = null;
    this._lastTripReason = null;
    this._lastTripBody = null;
  }

  /** True once the circuit-breaker has latched (every subsequent _apiCall short-circuits). */
  isSessionDead() {
    return this._sessionDead;
  }

  /**
   * The status/reason that latched the dead-session breaker, or null while alive.
   * Lets callers distinguish a throttle trip (403/429/503) from genuine auth loss
   * (401) or a network/page-eval failure after the fact.
   */
  getLastTrip() {
    return this._sessionDead
      ? { status: this._lastTripStatus, reason: this._lastTripReason, body: this._lastTripBody }
      : null;
  }

  /** Capture a short, secrets-safe snippet of the response body that tripped the breaker. Airtable
   *  error bodies are small JSON with the real reason; we keep ~300 chars and never log cookies. */
  _captureTripBody(result) {
    try {
      // Fall back to `error`: a status-0 transport failure has NO body, and those
      // (CA-cert / proxy / DNS) are exactly the failures this field exists to
      // explain — a records-job abort reason embeds it, and it was arriving empty.
      const raw = (typeof result?.body === 'string' && result.body)
        ? result.body
        : (result?.error ? String(result.error) : '');
      this._lastTripBody = raw ? raw.replace(/\s+/g, ' ').slice(0, 300) : null;
    } catch { this._lastTripBody = null; }
  }

  // ─── Initialization ──────────────────────────────────────────

  async init() {
    // Deduplicate concurrent init calls. Assign _initPromise synchronously
    // before any await so two callers cannot both launch Chromium.
    if (this._initPromise) return this._initPromise;
    if (this.context && this.isLoggedIn) return;

    // Participate in PageScheduler exclusivity so park/close barriers cannot
    // tear down a mid-flight launch (and so idle-park sees init as busy).
    // Nested ensureLoggedIn/_enqueue paths pass through via schedulerDepth.
    this._initPromise = this._scheduler.runExclusive('init', () => this._doInitBounded());
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  // Bound the browser (re)launch so a locked/contended .chrome-profile can't block
  // the serialized request queue forever. `_doInit` -> `launchPersistentContext` has no
  // built-in timeout; without this watchdog a single hung relaunch (profile contention,
  // chrome exit 21) stalls every queued request indefinitely. On timeout we reject so the
  // caller's retry/budget can proceed.
  //
  // Single-flight: the timeout only unblocks the CALLER — the real `_doInit` keeps running
  // detached. A retry (or a concurrent `_recoverSession`) must RE-ATTACH to that in-flight launch
  // via `_doInitInner`, never start a SECOND Chromium on the MCP-EXCLUSIVE profile (the double-launch
  // bug). Nothing is force-closed on timeout: `_doInit` closes its own context on failure, and on a
  // late SUCCESS `this.context` is a warm session kept for the next call (idle-park frees its RSS).
  async _doInitBounded() {
    const ms = Number(process.env.AIRTABLE_INIT_TIMEOUT_MS) || 90_000;
    if (!this._doInitInner) {
      const started = this._doInit();
      this._doInitInner = started;
      // Release the guard only when the real launch TRULY settles (success or failure). The dual
      // handler also swallows a late inner rejection so it doesn't surface as an unhandled rejection
      // after the race has already timed out.
      const clear = () => { if (this._doInitInner === started) this._doInitInner = null; };
      started.then(clear, clear);
    }
    const inner = this._doInitInner;
    let timer;
    try {
      const settled = await Promise.race([
        inner,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`session init/recovery exceeded ${ms / 1000}s — the browser profile may be locked by another process (profile contention)`));
          }, ms);
        }),
      ]);
      // A completed _doInit means the session was FRESHLY verified (browser mode
      // ends in _verifySession; byo/direct-login end in their own live check), so
      // a dead-session breaker latched by the previous session is stale — clear it.
      // Without this, a browser-mode user who re-authenticates (dashboard "Log in" →
      // /daemon/release-browser → close() → this re-init) keeps hitting the
      // _apiCall short-circuit until the daemon is restarted.
      //
      // GUARDED twice, because resetSessionHealth() also zeroes _recoveryStreak:
      //  - _recovering: an init driven by the INTERNAL recovery loop
      //    (_recoverSession) must NOT reset, or the breaker could never latch —
      //    its whole job is to count failures that persist ACROSS successful
      //    recoveries (the observed "403/401 → recover → same failure" storm).
      //  - _sessionDead: only a LATCHED breaker is cleared. A PARTIAL streak must
      //    survive, otherwise an alternating "recovery throws (watchdog timeout /
      //    profile contention) → next call's ensureLoggedIn re-inits fine → API
      //    still 401s" pattern resets the count every cycle and never reaches the
      //    threshold — an unbounded Chromium relaunch loop, i.e. exactly what the
      //    breaker exists to stop. Un-sticking a latched breaker is the whole
      //    user-facing win here and it survives this narrowing.
      if (!this._recovering && this._sessionDead) this.resetSessionHealth();
      return settled;
    } finally {
      clearTimeout(timer);
    }
  }

  async _doInit() {
    // ── Browser-free credential modes ──────────────────────────────
    // These never launch Chromium: there is no this.page/this.context. All
    // browser-touching helpers below must therefore be guarded against a null
    // page (see _snapshotCredentials / ensureLoggedIn / _recoverSession / close).
    if (this._authMode === 'byo') {
      return this._doInitByo();
    }
    if (this._authMode === 'direct-login') {
      return this._doInitDirectLogin();
    }

    // Close existing context if recovering. Detach the prior network listener
    // from the old page so we don't leak a handler per recovery cycle.
    if (this.context) {
      if (this.page && this._networkHandler) {
        try { this.page.removeListener('request', this._networkHandler); } catch { /* page may be dead */ }
      }
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
      this._networkHandler = null;
    }

    const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
    const browserPath    = process.env.AIRTABLE_BROWSER_PATH || undefined;
    console.error(`[auth] Launching headless ${browserChannel} with persistent profile...`);
    trace('auth', 'auth:browser_launch', {
      browser_type: browserChannel,
      headless: true,
      has_custom_path: !!browserPath,
    });
    const launchOpts = {
      headless: true,
      channel: browserChannel,
      viewport: null,
    };
    if (browserPath) launchOpts.executablePath = browserPath;
    const chromium = this._getChromium ? await this._getChromium() : await getChromium();
    this.context = await this._launchContext(chromium, launchOpts);

    // M5 — if anything after launchPersistentContext throws (page creation,
    // navigation, CSRF extraction, session verification), close the context
    // on the way out. Without this we'd leak a Chromium process per failed
    // init, and subsequent init() calls can't resume cleanly.
    try {
      this.page = this.context.pages()[0] || await this.context.newPage();

      // Intercept network traffic to capture secretSocketId
      this._setupNetworkInterception();

      // Navigate and wait for the app to be ready (not a blind timeout)
      await this.page.goto('https://airtable.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this._waitForAppReady();

      console.error('[auth] Page URL:', this.page.url());

      await this._extractCsrf();
      // Snapshot cookies + CSRF BEFORE verifying — _verifySession now issues a
      // direct-HTTP call (not an in-page fetch) and needs the Cookie header.
      // (The plan said "after _extractCsrf/_verifySession"; it must precede the
      // verify call now that verify no longer runs inside the browser.)
      await this._snapshotCredentials();
      await this._verifySession();
      trace('auth', 'auth:csrf_captured', {
        success: !!this.csrfToken,
      });
      // Re-arm the idle-park busy listener in case a prior close()
      // (release-browser / non-shutdown close) unsubscribed it. Idempotent.
      this._subscribeBusy();
      // Start the idle-park clock: a daemon that inits and then never gets a
      // tool call would otherwise hold Chromium forever (busy events only fire
      // on scheduled work).
      this.scheduleIdlePark();
    } catch (err) {
      // Don't leak a running browser when init fails.
      try { await this.context.close(); } catch { /* best-effort */ }
      this.context = null;
      this.page = null;
      this._networkHandler = null;
      throw err;
    }
  }

  /**
   * Launch the persistent browser context, recovering ONCE from a locked profile.
   *
   * The persistent `.chrome-profile` is MCP-EXCLUSIVE — only our headless Chrome
   * ever opens it. So if launchPersistentContext fails with a profile-lock error
   * (Chrome exit 21 / SingletonLock — a crashed or leaked Chrome still holding
   * the lock), the holder is a stale instance safe to kill. We kill it, wait
   * briefly for the lock to clear, then retry the launch EXACTLY once.
   *
   * REACTIVE only: we never kill before the first launch (that could take down a
   * legitimately-running instance). We only act after actually colliding with
   * the lock, when we are the one trying to launch. Any non-lock error — and a
   * still-failing retry — propagates unchanged, so browser behavior is otherwise
   * identical.
   */
  async _launchContext(chromium, launchOpts) {
    try {
      return await chromium.launchPersistentContext(this.profileDir, launchOpts);
    } catch (err) {
      if (!isProfileLockError(err)) throw err;
      console.error('[auth] Chrome profile locked (exit 21) — killing stale holder and retrying once...');
      await this._killProfileHolders(this.profileDir);
      await new Promise((resolve) => setTimeout(resolve, this._relaunchWaitMs));
      // Retry ONCE. If this throws too, it propagates unchanged.
      return await chromium.launchPersistentContext(this.profileDir, launchOpts);
    }
  }

  /**
   * BYO (bring-your-own cookie) init: no browser. Load the pasted cookie+csrf,
   * mark logged-in, then verify the cookie is actually accepted by a real
   * direct-HTTP call. A rejected cookie fails fast with an actionable error
   * rather than letting every subsequent tool call 401.
   */
  async _doInitByo() {
    console.error('[auth] AIRTABLE_AUTH_MODE=byo — using pasted cookie credentials (no browser).');
    this._credentials = await loadByoCredentials();
    this.csrfToken = this._credentials.csrfToken ?? null;
    this.isLoggedIn = true;

    // Direct-HTTP validity check. _rawApiCall reads this._credentials.
    const result = await this._rawApiCall('GET', '/v0.3/getUserProperties');
    if (!(result.status >= 200 && result.status < 300)) {
      this.isLoggedIn = false;
      throw new Error(
        `BYO_CREDENTIALS_INVALID: the provided AIRTABLE_COOKIE/credentials.json cookie was rejected (status ${result.status}) — refresh it from a logged-in browser.\nResponse: ${sessionErrorDetail(result)}`
      );
    }
    // Identity is only ever a by-product here: byo has no page, and the id exists
    // nowhere in an API response (getUserProperties' authenticated 200 body is 8
    // feature-flag booleans — live probes, 2026-07). loadByoCredentials knows it
    // only when it happened to fetch a page for the csrf scrape, i.e. when no csrf
    // was supplied. Null otherwise, never invented, and never a gate.
    this.userId = this._credentials.userId ?? null;
    console.error('[auth] BYO session verified!', this.userId ? `User: ${this.userId}` : '(user id unavailable — byo has no page to read it from)');
  }

  /**
   * Direct-login init: no browser. Replicate the HAR login flow over HTTP
   * (impit + TOTP) to mint fresh session cookies + csrf, then drive all API
   * calls through the direct-HTTP transport with them. directLogin() itself
   * validates the session — it requires a signed-in user id in the authed page it
   * fetches, not merely a session cookie in the jar — so no separate verify here.
   */
  async _doInitDirectLogin() {
    console.error('[auth] AIRTABLE_AUTH_MODE=direct-login — browser-free login via impit + TOTP (no browser).');
    this._credentials = await this._directLogin();
    this.csrfToken = this._credentials?.csrfToken ?? null;
    this.userId = this._credentials?.userId ?? null;
    this.isLoggedIn = true;
    console.error('[auth] direct-login complete.', this.userId ? `User: ${this.userId}` : '');
  }

  /**
   * Wait for the Airtable app to be ready instead of a blind 5s timeout.
   * Looks for signs of a loaded SPA: __NEXT_DATA__, a logged-in avatar,
   * or at minimum the body being non-empty. Falls back to 3s if nothing matches.
   */
  async _waitForAppReady() {
    try {
      await Promise.race([
        this.page.waitForSelector('#__NEXT_DATA__', { timeout: 10000 }),
        this.page.waitForSelector('[data-testid="user-menu-button"]', { timeout: 10000 }),
        this.page.waitForSelector('.userAvatar', { timeout: 10000 }),
        this.page.waitForFunction(() => {
          // Wait until the page has meaningful content
          return document.body && document.body.innerHTML.length > 1000;
        }, { timeout: 10000 }),
      ]);
    } catch {
      // Fallback: wait a short fixed time if no selector matched
      await this.page.waitForTimeout(3000);
    }

    // After waiting, check if we landed on a login/redirect page
    const url = this.page.url();
    if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
      throw new Error(
        `Session expired: page redirected to ${url}. Run "npx airtable-user-mcp login" to log in again.`
      );
    }
  }

  // ─── Network Interception (secretSocketId capture) ───────────

  _setupNetworkInterception() {
    // Store the handler so _doInit can removeListener on context close — this
    // avoids stacking up a handler per session recovery.
    this._networkHandler = (request) => {
      try {
        const url = request.url();
        // Capture secretSocketId from Airtable's internal requests
        if (url.includes('airtable.com') && request.method() === 'POST') {
          const postData = request.postData();
          if (postData) {
            const socketIdMatch = postData.match(/secretSocketId[=:]([^&"]+)/);
            if (socketIdMatch) {
              // Only cache per exact appId. URLs with no app-id prefix are
              // skipped — we refuse to store a "global" fallback because
              // getSecretSocketId must never hand base B a socketId captured
              // for base A.
              const appMatch = url.match(/(app[A-Za-z0-9]+)/);
              if (appMatch) {
                const appId = appMatch[1];
                // LRU: refresh insertion order on write, evict oldest if over cap.
                if (this._secretSocketIds.has(appId)) this._secretSocketIds.delete(appId);
                this._secretSocketIds.set(appId, decodeURIComponent(socketIdMatch[1]));
                if (this._secretSocketIds.size > this._maxSocketIdCache) {
                  const oldest = this._secretSocketIds.keys().next().value;
                  if (oldest !== undefined) this._secretSocketIds.delete(oldest);
                }
                console.error(`[auth] Captured secretSocketId for ${appId}`);
              }
            }
          }
        }
      } catch {
        // Silently ignore interception errors
      }
    };
    this.page.on('request', this._networkHandler);
  }

  getSecretSocketId(appId) {
    // Only return a socketId captured for this exact appId. A cross-app
    // fallback was a correctness bug: a socketId captured from base A would
    // get silently used for a mutation on base B. Better to return null and
    // let Airtable respond with a retriable error than risk a cross-base
    // signed call.
    if (!appId) return null;
    return this._secretSocketIds.get(appId) || null;
  }

  // ─── Credential Snapshot (direct-HTTP) ───────────────────────

  /**
   * Snapshot the profile's session credentials so direct-HTTP calls can carry
   * the same auth the browser had. Reads the browser context's cookies (incl.
   * HttpOnly) and keeps only airtable-domain cookies as a Cookie header, plus
   * the CSRF token already extracted by _extractCsrf().
   *
   * Called during init (before _verifySession) and after each refresh/recovery
   * so a re-login's fresh cookies take effect immediately.
   */
  async _snapshotCredentials() {
    // Browser-only. In byo/direct-login modes there is no page — never wipe the
    // pasted credentials with an empty snapshot.
    if (!this.page) return;
    let cookieHeader = '';
    try {
      const cookies = await this.page.context().cookies();
      cookieHeader = cookies
        .filter((c) => (c.domain || '').includes('airtable'))
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
    } catch (err) {
      console.error(`[auth] Failed to snapshot session cookies: ${err.message}`);
    }
    this._credentials = { cookieHeader, csrfToken: this.csrfToken };
  }

  // ─── CSRF + session-user Extraction ──────────────────────────

  /**
   * Read BOTH page-only credentials in ONE page.evaluate: the csrf token and the
   * signed-in user id.
   *
   * The user id is read here, and not from page.content(), for two reasons.
   * content() serializes the whole multi-MB DOM and ships it over CDP to Node
   * just so we can regex 17 characters out of it — and it THROWS mid-navigation
   * ("Unable to retrieve content because the page is navigating and changing the
   * content"), which is indistinguishable from "nobody is signed in". Inside this
   * evaluate the id is a by-product of a call we already make.
   *
   * No API response can supply it: getUserProperties' AUTHENTICATED 200 body is
   * eight feature-flag booleans with no identity in it at all (live probes against
   * airtable.com, 2026-07) — which is why a failed login used to print
   * "Login verified! User: undefined" (issue #21). The SPA reads it from the page
   * bootstrap and builds its own /v0.3/user/<usr…>/… URLs from it.
   *
   * Both reads are NON-FATAL when they come up empty: warn and carry on.
   */
  async _extractCsrf() {
    const read = await this.page.evaluate((userIdPattern) => {
      const findCsrf = () => {
        // 1. Script tags containing csrfToken in JSON
        for (const s of document.querySelectorAll('script')) {
          const text = s.textContent || '';
          const m = text.match(/"csrfToken"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
        }
        // 2. __NEXT_DATA__
        const nextEl = document.getElementById('__NEXT_DATA__');
        if (nextEl) {
          try {
            const d = JSON.parse(nextEl.textContent);
            if (d?.props?.pageProps?.csrfToken) return d.props.pageProps.csrfToken;
          } catch {}
        }
        // 3. Meta tag
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.content;
        // 4. Window variables
        for (const key of Object.keys(window)) {
          try {
            const obj = window[key];
            if (obj && typeof obj === 'object' && obj.csrfToken) return obj.csrfToken;
          } catch {}
        }
        return null;
      };
      const m = document.documentElement.innerHTML.match(new RegExp(userIdPattern));
      return { csrfToken: findCsrf(), sessionUserId: m ? m[1] : null };
    }, SESSION_USER_ID_IN_HTML.source);

    this.csrfToken = read?.csrfToken ?? null;
    this.userId = read?.sessionUserId ?? null;

    if (this.csrfToken) {
      // Never log any portion of the CSRF token — even a prefix is a secret leak to stderr/logs.
      console.error('[auth] CSRF token found');
    } else {
      console.error('[auth] WARNING: CSRF token not found. Mutations may fail.');
    }
  }

  // ─── Session Verification & Recovery ──────────────────────────

  async _verifySession() {
    const result = await this._rawApiCall('GET', '/v0.3/getUserProperties');

    if (result.status === 200) {
      this.isLoggedIn = true;
      trace('auth', 'auth:session_check', { success: true, user_id: this.userId });
      if (this.page && !this.userId) {
        // ADVISORY, never a gate. Airtable ACCEPTED this cookie over direct HTTP,
        // and a cookieless caller gets 401 from this endpoint (live probes,
        // 2026-07) — so the status carries real signal, while a missing
        // "sessionUserId" in the page does not: it reads the same whether the
        // profile is signed out, the wrong page loaded, the render was incomplete,
        // or Airtable renamed the key. Failing here would propagate through
        // _doInit's catch (context closed, page nulled) and _recoverSession's
        // dead-session breaker, so one scrape drift would take down all 71 tools
        // and turn a records job into a per-row Chromium relaunch march. Let real
        // API calls fail with real errors instead. Strictness belongs where a
        // human is waiting and a false green IS the bug: the login polls and the
        // spawned health-check.
        console.error(
          '[auth] WARNING: no "sessionUserId" in the loaded page — the session cookie was accepted, ' +
          'so continuing without an identity. If tool calls now fail with auth errors, the profile is ' +
          'signed out: run "npx airtable-user-mcp login", or log in from the extension dashboard.'
        );
      }
      console.error('[auth] Session verified!', this.userId ? `User: ${this.userId}` : '(user id unavailable)');
    } else {
      this.isLoggedIn = false;
      // status 0 FIRST: it means the transport never got an HTTP response at all.
      // "Session invalid (0)" wearing the expired-login hint is the exact string
      // that sent issue #21's reporter after the wrong problem. A cookieless
      // caller gets a real 401 from this endpoint (live probes, 2026-07), so
      // no-response is never an auth verdict.
      const hint = result.status === 0
        ? 'airtable.com could not be reached — this is a NETWORK/TLS/proxy failure, NOT an expired login. '
          + 'Behind a TLS-inspecting proxy set NODE_EXTRA_CA_CERTS (Node ignores the OS trust store); otherwise check HTTPS_PROXY/NO_PROXY and connectivity'
        : this._authMode === 'byo'
          ? 'the provided cookie was rejected — save a fresh Airtable session cookie (byo recovers only from a re-pasted cookie)'
          : this._authMode === 'direct-login'
            ? 'direct-login credentials were rejected — check AIRTABLE_EMAIL / AIRTABLE_PASSWORD / AIRTABLE_TOTP_SECRET (direct-login re-authenticates itself on the next call)'
            : 'the Airtable login has expired — re-authenticate (open the extension dashboard and log in), or use AIRTABLE_AUTH_MODE=direct-login so long unattended jobs re-authenticate themselves';
      const sessionError = `Session invalid (${result.status}): ${hint}.\nResponse: ${sessionErrorDetail(result)}`;
      trace('auth', 'auth:session_check', { success: false }, sessionError);
      throw new Error(sessionError);
    }
  }

  /**
   * Attempt session recovery: close browser, relaunch, re-verify.
   * Only one recovery attempt at a time.
   *
   * Sets _initPromise atomically so that if a separate init() call arrives
   * mid-recovery, it will await the SAME _doInit() rather than kick off its
   * own Chromium launch.
   */
  async _recoverSession() {
    if (this._recovering) return;
    this._recovering = true;
    try {
      // BYO mode has no browser to relaunch. Re-load the credentials (the user
      // may have refreshed the file/env with a fresh cookie) and re-verify.
      if (this._authMode === 'byo') {
        console.error('[auth] BYO session rejected. Re-loading credentials...');
        this.isLoggedIn = false;
        this._credentials = await loadByoCredentials();
        this.csrfToken = this._credentials.csrfToken ?? null;
        const result = await this._rawApiCall('GET', '/v0.3/getUserProperties');
        if (!(result.status >= 200 && result.status < 300)) {
          // The detail matters as much here as at init (_doInitByo has it): a
          // status-0 TLS/proxy failure otherwise tells a byo user to re-paste a
          // cookie that was never the problem.
          throw new Error(
            `BYO_CREDENTIALS_EXPIRED: cookie no longer valid — paste a fresh cookie into ~/.airtable-user-mcp/credentials.json or AIRTABLE_COOKIE.\nResponse: ${sessionErrorDetail(result)}`
          );
        }
        this.isLoggedIn = true;
        console.error('[auth] BYO session recovered with re-loaded credentials.');
        return;
      }

      // Direct-login mode has no browser to relaunch. Re-run the HTTP login
      // flow to mint fresh cookies/csrf.
      if (this._authMode === 'direct-login') {
        console.error('[auth] direct-login session rejected. Re-running login for fresh cookies...');
        this.isLoggedIn = false;
        try {
          this._credentials = await this._directLogin();
        } catch (err) {
          throw new Error(`SESSION_INVALID: direct-login refresh failed — ${err.message}`);
        }
        this.csrfToken = this._credentials?.csrfToken ?? null;
        this.isLoggedIn = true;
        console.error('[auth] direct-login session recovered.');
        return;
      }

      console.error('[auth] Session expired. Attempting recovery...');
      this.isLoggedIn = false;
      // Atomic assignment — init() observes this as already-in-progress and
      // awaits the same promise, preventing a parallel _doInit().
      // Bounded so a hung relaunch (locked profile) can't block the queue forever.
      const recovery = this._doInitBounded();
      this._initPromise = recovery;
      try {
        await recovery;
      } finally {
        this._initPromise = null;
      }
      // Re-snapshot so the relaunched session's fresh cookies/CSRF drive
      // subsequent direct-HTTP calls. (_doInit already snapshots before its
      // verify; this is belt-and-suspenders in case that ordering changes.)
      await this._snapshotCredentials();
      console.error('[auth] Session recovered successfully.');
    } finally {
      this._recovering = false;
    }
  }

  // ─── Request Scheduler ──────────────────────────────────────

  /**
   * Enqueue exclusive work through the PageScheduler.
   * Bounded; saturated queue rejects rather than growing without bound.
   */
  _enqueue(fn, label = 'auth') {
    return this._scheduler.runExclusive(label, fn);
  }

  getBusyState() {
    return this._scheduler.getBusyState();
  }

  onBusyChange(listener) {
    return this._scheduler.onBusyChange(listener);
  }

  // Idempotent subscribe to scheduler busy events that arm/cancel idle-park.
  // Called from the constructor AND at the end of a successful browser _doInit,
  // so that a prior close() (which unsubscribes for full teardown — e.g.
  // /daemon/release-browser) does NOT leave the browser resident forever: the
  // next init re-arms the listener. Guarded so a plain recovery re-init (listener
  // still live) never double-subscribes and leaks a handler.
  _subscribeBusy() {
    if (this._unsubBusy) return;
    this._unsubBusy = this._scheduler.onBusyChange((state) => {
      if (state.busy) this.cancelIdlePark();
      else this.scheduleIdlePark();
    });
  }

  scheduleIdlePark() {
    if (this._idleParkMs <= 0 || !this.context || this._parkTimer) return;
    if (this._authMode === 'byo' || this._authMode === 'direct-login') return;
    this._parkTimer = setTimeout(() => {
      this._parkTimer = null;
      void this.parkBrowser().catch(() => {
        // Parking is an optimization; a failed park must never hurt anything.
      });
    }, this._idleParkMs);
    // Never keep a short-lived CLI/stdio process alive just to park a browser.
    this._parkTimer.unref?.();
  }

  cancelIdlePark() {
    if (this._parkTimer) {
      clearTimeout(this._parkTimer);
      this._parkTimer = null;
    }
  }

  /**
   * Close the browser, keep the daemon and cookie credentials.
   *
   * Deliberately NOT full shutdown: a parked daemon is still logged in
   * (cookies in `_credentials`, session resumable). Only the browser handles
   * are dropped; auth state survives so cookie-only HTTP keeps working.
   */
  async parkBrowser() {
    return this._scheduler.runBarrier(async () => {
      if (!this.context) return;
      // Inside runBarrier, getBusyState().busy is always true (barrierActive).
      // Abort only when the exclusive pipeline still has real work: active op,
      // queued waiters, or inter-op rate delay — not because of this barrier.
      const busy = this._scheduler.getBusyState();
      if (busy.queued > 0 || busy.active || busy.delaying) return;
      if (this._authMode === 'byo' || this._authMode === 'direct-login') return;

      // Ensure credentials are snapshotted before we drop the browser.
      try {
        if (!this._credentials?.cookieHeader) await this._snapshotCredentials();
      } catch { /* best-effort */ }

      // Without a cookie header, cookie-only park would leave isLoggedIn true
      // with no HTTP path and force a full Chromium relaunch next call.
      if (!this._credentials?.cookieHeader) {
        // Bailing here does NOT strand the browser, though it reads like it does:
        // scheduleIdlePark() nulled _parkTimer before calling us, so nothing is armed
        // at this instant. The re-arm comes from _subscribeBusy — we are inside
        // runBarrier, so the scheduler is busy now and fires a busy→idle edge the
        // moment this returns, which calls scheduleIdlePark() again. Retry is
        // automatic; an explicit re-arm here is redundant, not defensive.
        // Pinned by "a cookie-less park RE-ARMS the timer" in test-auth-idle-park —
        // that test fails only if BOTH paths are gone, which is the real invariant.
        console.error('[auth] idle park deferred — no cookie snapshot available; will retry when idle again.');
        return;
      }

      console.error(
        `[auth] parking idle browser (no page work for ${Math.round(this._idleParkMs / 60_000)}m) — ` +
          `cookie HTTP continues; next recovery path will bring Chromium back.`,
      );

      const contextToClose = this.context;
      if (this.page && this._networkHandler) {
        try { this.page.removeListener('request', this._networkHandler); } catch { /* page may be dead */ }
      }
      await contextToClose.close().catch(() => {});
      // Only clear handles if nothing reassigned context during close.
      if (this.context === contextToClose) {
        this.context = null;
        this.page = null;
        this._networkHandler = null;
      }

      // Hard-kill orphan chrome.exe that context.close() left behind (Windows).
      // Safe under the barrier: init cannot launch concurrently.
      await this._killBrowserTree(this.profileDir).catch(() => {});
    });
  }

  // ─── Raw API Call (no queue, no recovery) ─────────────────────

  async _rawApiCall(method, urlPath, body = null, appId = null, contentType = 'form', evalTimeoutMs = 15_000) {
    const url = urlPath.startsWith('http') ? urlPath : `https://airtable.com${urlPath}`;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Generate page-load-id Node-side — `Math.random()` is not cryptographically
    // strong; genPageLoadId() uses node:crypto.
    const pageLoadId = genPageLoadId();

    // Direct HTTP now carries the session explicitly: the browser is no longer
    // the transport, so the profile's cookies + CSRF must ride on every request.
    const creds = this._credentials || {};
    const cookieHeader = creds.cookieHeader || '';
    const csrfToken = creds.csrfToken ?? this.csrfToken;

    // Build the SAME headers the in-page fetch sent, plus an explicit Cookie.
    let headers;
    let requestBody = null;
    if (contentType === 'json') {
      headers = {
        'Content-Type': 'application/json',
        'x-airtable-inter-service-client': 'webClient',
        'x-airtable-page-load-id': pageLoadId,
        'x-requested-with': 'XMLHttpRequest',
        'x-user-locale': 'en',
        'x-time-zone': timeZone,
      };
      if (appId) headers['x-airtable-application-id'] = appId;
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      // Honor caller's method — a body only rides on non-GET requests.
      if (body !== null && body !== undefined && method !== 'GET') {
        // Inject _csrf fresh, HERE, at send time — mirrors the form-encoded
        // branch below (params.set('_csrf', csrfToken)). A caller may have built
        // its body earlier (sometimes well before this call is dequeued behind
        // ensureLoggedIn()/backoff), and a concurrent session recovery can rotate
        // csrfToken in that window. Overwriting unconditionally means no JSON
        // caller — now or in the future — can ship a token staler than "current
        // at send time", the same guarantee form POSTs already have.
        // Only spread genuine plain objects (object literals / Object.create(null)
        // bags) into the _csrf injection. Arrays, and non-plain objects like
        // Date/Map/Set/RegExp/URL/Buffer/class instances, are passed through
        // UNCHANGED instead — spreading any of those (`{...new Date(), _csrf}`)
        // silently discards the original value, shipping a near-empty body
        // with no error. See isPlainObject() above for exactly what counts.
        const bodyIsPlainObject = isPlainObject(body);
        requestBody = JSON.stringify(bodyIsPlainObject && csrfToken ? { ...body, _csrf: csrfToken } : body);
      }
    } else {
      headers = {
        'x-airtable-inter-service-client': 'webClient',
        'x-airtable-page-load-id': pageLoadId,
        'x-requested-with': 'XMLHttpRequest',
        'x-user-locale': 'en',
        'x-time-zone': timeZone,
      };
      if (appId) headers['x-airtable-application-id'] = appId;
      if (body && method !== 'GET') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
      }
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      if (body && method !== 'GET') {
        const params = new URLSearchParams(body);
        if (csrfToken) params.set('_csrf', csrfToken);
        requestBody = params.toString();
      }
    }

    // Preserve the old per-call timeout semantics: page.evaluate had no built-in
    // timeout, so a hung request was raced against a configurable timer (default
    // 15s) and its rejection let _apiCall's catch trigger _recoverSession. Direct
    // HTTP keeps the same race — a stuck request still rejects promptly. Callers
    // handling large responses (e.g. getApplicationData) pass a higher timeout.
    // Clear the timer on settle — otherwise a pending setTimeout dangles for the
    // full evalTimeoutMs after every (fast) call, leaking timers now that this
    // is the universal request path (the old page.evaluate version left it
    // uncleared, but that only ran on the slow browser path).
    const withTimeout = (promise) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`HTTP request exceeded ${evalTimeoutMs / 1000}s; upstream may be unresponsive`)),
          evalTimeoutMs,
        );
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };

    return withTimeout(this._httpTransport.request({ method, url, headers, body: requestBody }));
  }

  // ─── Queued API Call (with session recovery & rate-limit backoff) ──────────────────

  async _apiCall(method, urlPath, body = null, appId = null, contentType = 'form', evalTimeoutMs = 15_000) {
    return this._enqueue(async () => {
      if (this._sessionDead) {
        throw new Error('SESSION_INVALID: Airtable rejected repeated requests even after re-authentication — the login has expired or been blocked. Re-authenticate (run `login`) and retry.');
      }
      await this.ensureLoggedIn();

      const MAX_RETRIES = 3;
      const HARD_TIMEOUT_MS = 30_000;
      // Browser-free modes (direct-login / byo): an expired session or a rotated
      // CSRF token surfaces on mutations as 403, not 401. There _recoverSession is
      // a single HTTP _directLogin / cookie reload — NO page-load burst — so
      // escalating a PERSISTENT 403 to re-auth is safe (unlike browser mode, where
      // a relaunch fires a burst that re-trips the ~5 req/s limit → 403 storm).
      const browserFree = this._authMode === 'direct-login' || this._authMode === 'byo';
      let deadline = Date.now() + HARD_TIMEOUT_MS; // extended by intentional rate-limit backoff waits
      let attempt = 0;    // browser-recovery (relaunch) attempts
      let rlAttempt = 0;  // rate-limit/throttle backoff attempts (same session, no relaunch)
      let http403Backoffs = 0; // 403s already given a throttle backoff this call (browser-free escalation gate)
      while (true) {
        if (Date.now() > deadline) {
          // Bail out rather than retry past the caller's patience budget.
          // A hung _recoverSession or repeated 429s shouldn't stall the queue.
          throw new Error(`API call exceeded ${HARD_TIMEOUT_MS / 1000}s wall-clock budget (method=${method}, url=${urlPath.slice(0, 60)}...)`);
        }
        let result;
        try {
          result = await this._rawApiCall(method, urlPath, body, appId, contentType, evalTimeoutMs);
        } catch (evalError) {
          // page.evaluate itself failed (browser crashed, context destroyed)
          if (!this._recovering && attempt < MAX_RETRIES) {
            if (++this._recoveryStreak >= this._sessionDeadAfter) {
              this._sessionDead = true;
              this._lastTripStatus = 0; // no HTTP status — request never completed
              this._lastTripReason = 'network/page-eval';
              throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive failures across recoveries (page.evaluate) — re-authenticate (run \`login\`) and retry.`);
            }
            console.error(`[auth] page.evaluate failed: ${evalError.message}. Recovering... (streak ${this._recoveryStreak})`);
            await this._recoverSession();
            attempt++;
            continue;
          }
          throw evalError;
        }

        // Rate-limit / throttle — 429 (Too Many Requests), 503 (Service Unavailable), and 403:
        // the internal API shares Airtable's ~5 req/s-per-base limit and answers a burst with 403.
        // BACK OFF and retry the SAME session — do NOT relaunch the browser. Relaunching on a
        // throttle 403 only makes it worse: each _recoverSession fires a burst of page-load requests
        // that re-trips the limit (observed as an endless 403→relaunch→403 storm). Exponential toward
        // the ~30s official penalty; intentional waits don't count against the work budget; the
        // dead-session circuit-breaker still bounds a throttle that never clears.
        if (result.status === 429 || result.status === 503 || result.status === 403) {
          // A 403 whose body is a PERMANENT per-request permission/validation error — writing a
          // COMPUTED field or a field the caller can't edit: `INVALID_PERMISSIONS` / "cannot be
          // updated" — is NOT throttle and NOT a session death. It fails identically on every retry
          // and on a fresh session, so throttling/re-auth is pointless and feeding it to the
          // dead-session breaker wrongly aborts the WHOLE records job (the 5-session "403 during
          // record sync" saga). Surface it as a distinct per-request error so the CALLER fails just
          // that row/cell and continues; do NOT touch _recoveryStreak or latch _sessionDead.
          if (result.status === 403 && /INVALID_PERMISSIONS|cannot be (updated|created)/i.test(result.body || '')) {
            const e = new Error(`FIELD_FORBIDDEN (403): ${String(result.body || '').replace(/\s+/g, ' ').slice(0, 300)}`);
            e.code = 'FIELD_FORBIDDEN';
            throw e;
          }
          // Browser-free 403 escalation: 429/503 (and the FIRST 403, and ALL 403s
          // in browser mode) stay pure throttle. But a 403 that PERSISTS past its
          // one allowed throttle backoff in direct-login/byo mode is a dead/rotated
          // session, not throttle — escalate to re-auth like the 401 path below,
          // bounded by the same attempt cap + single-flight guard. It still counts
          // toward _recoveryStreak so an unrecoverable 403 (IP/account block whose
          // _directLogin also 403s) latches _sessionDead instead of looping forever.
          const persist403 = result.status === 403 && browserFree && http403Backoffs >= 1;
          if (persist403 && !this._recovering && attempt < MAX_RETRIES) {
            if (++this._recoveryStreak >= this._sessionDeadAfter) {
              this._sessionDead = true;
              this._lastTripStatus = result.status;
              this._lastTripReason = 'auth-403-persist';
              this._captureTripBody(result);
              throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive 403s that did not clear after re-authentication — the login has expired or been blocked. Re-authenticate (run \`login\`) and retry.`);
            }
            console.error(`[auth] 403 persisted after backoff (${this._authMode}) — re-authenticating on the same session (streak ${this._recoveryStreak})...`);
            await this._recoverSession();
            attempt++;
            continue;
          }

          if (++this._recoveryStreak >= this._sessionDeadAfter) {
            this._sessionDead = true;
            this._lastTripStatus = result.status;
            this._lastTripReason = 'throttle';
            this._captureTripBody(result);
            throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive rate-limit/throttle responses (status=${result.status}) that did not clear after backoff — the account is throttled or the login is blocked. Let the limit reset (wait), or re-authenticate (run \`login\`), then retry.`);
          }
          const delay = Math.min(30_000, 1000 * (2 ** rlAttempt)) + Math.floor(Math.random() * 500);
          console.error(`[auth] ${result.status} (rate-limit/throttle) — backing off ${delay}ms on the same session, no relaunch (streak ${this._recoveryStreak})...`);
          await this._rlSleep(delay);
          deadline += delay; // an intentional backoff wait is not a stall — don't let it trip the budget
          rlAttempt++;
          if (result.status === 403) http403Backoffs++; // this 403 has now had its one throttle backoff
          continue;
        }

        // Genuine auth loss (401) or network failure — relaunch the session.
        const needsRecovery = result.status === 401 || result.error;
        if (needsRecovery && !this._recovering && attempt < MAX_RETRIES) {
          if (++this._recoveryStreak >= this._sessionDeadAfter) {
            this._sessionDead = true;
            this._lastTripStatus = result.status;
            this._lastTripReason = result.error ? 'network' : 'auth-401';
            this._captureTripBody(result);
            // Append the transport detail: this branch also latches on `result.error`
            // (status 0, no HTTP response), where "the login has expired" is simply
            // wrong and the CA-cert/proxy advice in `error` is the only real clue.
            throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive auth failures (status=${result.status}) across recoveries — the Airtable login has expired or been blocked. Re-authenticate (run \`login\`) and retry.${result.error ? `\nTransport error (status=0 means no HTTP response — network/TLS/proxy, not an expired login): ${result.error}` : ''}`);
          }
          console.error(`[auth] API call failed (status=${result.status}, error=${result.error || 'none'}). Recovering... (streak ${this._recoveryStreak})`);
          await this._recoverSession();
          attempt++;
          continue;
        }

        // Healthy response → reset the dead-session circuit-breaker.
        if (result.status >= 200 && result.status < 300) this._recoveryStreak = 0;
        return result;
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────

  async ensureLoggedIn() {
    // Browser-free modes (byo / direct-login): no browser context/page to
    // inspect for a redirect. Initialize once (byo loads+verifies the cookie;
    // direct-login mints cookies via the HTTP login flow); thereafter it's a
    // no-op — a mid-run 401 is handled by _apiCall's backoff → _recoverSession
    // (which re-loads/re-mints the credentials).
    if (this._authMode === 'byo' || this._authMode === 'direct-login') {
      if (!this._credentials) await this.init();
      return;
    }

    // Cookie-only park: browser was closed to free RSS but credentials remain.
    // Direct-HTTP tool calls must NOT pay a full Chromium bootstrap here —
    // recovery (_recoverSession) relaunches only when a 401/403 proves the
    // cookies are dead.
    if (!this.context && this.isLoggedIn && this._credentials?.cookieHeader) {
      return;
    }

    if (!this.context || !this.isLoggedIn) {
      await this.init();
      return;
    }

    // Detect if the page has been redirected away from Airtable (session expiry redirect)
    try {
      const currentUrl = this.page.url();
      if (!currentUrl.includes('airtable.com') ||
          currentUrl.includes('/login') ||
          currentUrl.includes('/signin')) {
        console.error(`[auth] Page redirected to ${currentUrl}. Re-initializing session...`);
        this.isLoggedIn = false;
        trace('auth', 'auth:refresh', { reason: 'page_redirected', url: currentUrl });
        await this.init();
      }
    } catch {
      // page.url() can throw if browser crashed — force re-init
      console.error('[auth] Browser context lost. Re-initializing...');
      this.isLoggedIn = false;
      trace('auth', 'auth:refresh', { reason: 'browser_context_lost' });
      await this.init();
    }
  }

  /**
   * Lightweight session check that reuses the already-open browser context —
   * it never launches a second Chrome. The daemon exposes this via
   * /daemon/session-health so the extension can verify the session through the
   * daemon's single shared browser instead of forking a competing health-check
   * (two Chromes on one persistent profile collide → Chrome exit code 21).
   *
   * @returns {Promise<{valid: boolean, userId?: string|null, status?: number, error?: string}>}
   */
  async checkSessionHealth() {
    try {
      await this.ensureLoggedIn();
      const res = await this.get('/v0.3/getUserProperties');
      // A 2xx IS the verdict here, and that is honest: Airtable accepted the
      // cookie, and a cookieless caller gets 401 from this endpoint (live probes,
      // 2026-07). The user id is REPORTED when known and is never a gate — it comes
      // from page/login HTML, which byo (no csrf scrape) and a parked browser
      // simply may not have, so requiring it would report a working session as
      // signed out. `userId` is whatever init/login actually learned, never a
      // guess: close() clears it so a stale id cannot stand in as proof.
      if (res.ok) return { valid: true, userId: this.userId ?? null };
      return { valid: false, status: res.status, error: probeFailureReason({ status: res.status }) };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Records-facing health gate. Probe the session via checkSessionHealth(); if
   * it's already valid, do nothing. In a browser-free mode (direct-login / byo)
   * a rejected probe is re-authenticated in place (_recoverSession is a single
   * HTTP login/cookie reload) and re-probed once. In browser mode we leave
   * recovery to the existing _apiCall wrapper and just report unhealthy.
   *
   * Never throws — degrades to { healthy:false } on any error so a long records
   * job can decide whether to continue or abort without a try/catch at the call
   * site.
   *
   * @returns {Promise<{healthy: boolean, recovered: boolean, error?: string}>}
   */
  async ensureSessionHealthy() {
    try {
      const probe = await this.checkSessionHealth();
      if (probe && probe.valid) return { healthy: true, recovered: false };

      const browserFree = this._authMode === 'direct-login' || this._authMode === 'byo';
      if (!browserFree) return { healthy: false, recovered: false };

      await this._recoverSession();
      const reprobe = await this.checkSessionHealth();
      return { healthy: !!(reprobe && reprobe.valid), recovered: true };
    } catch (err) {
      return { healthy: false, recovered: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async get(url, appId, { evalTimeoutMs = 15_000 } = {}) {
    const pattern = url.replace(/.*v0\.3\//, '').replace(/(app|tbl|viw|fld|rec|usr|wsp|sel|flt|blk|ext|col)[A-Za-z0-9]{10,}/g, '$1*');
    trace('http', 'http:request', { method: 'GET', endpoint_pattern: pattern, has_payload: false });
    const start = Date.now();
    const result = await this._apiCall('GET', url, null, appId, 'form', evalTimeoutMs);
    trace('http', 'http:response', { endpoint_pattern: pattern, status: result.status, duration_ms: Date.now() - start });
    return this._wrapResponse(result);
  }

  async postForm(url, params, appId) {
    // Mutations (all postForm callers) embed secretSocketId "when available".
    // Live smoke proved a field create SUCCEEDS via direct-HTTP WITHOUT a
    // secretSocketId, and the login-page→base nav-capture returned nothing while
    // adding ~8s — so we no longer navigate to capture one. We still inject an
    // id if the passive login-time interception happened to capture it.
    if (appId && params && typeof params === 'object' && !params.secretSocketId) {
      const sid = this.getSecretSocketId(appId);
      if (sid) params.secretSocketId = sid;
    }

    const pattern = url.replace(/.*v0\.3\//, '').replace(/(app|tbl|viw|fld|rec|usr|wsp|sel|flt|blk|ext|col)[A-Za-z0-9]{10,}/g, '$1*');
    trace('http', 'http:request', { method: 'POST', endpoint_pattern: pattern, has_payload: true });
    const start = Date.now();
    const result = await this._apiCall('POST', url, params, appId, 'form');
    trace('http', 'http:response', { endpoint_pattern: pattern, status: result.status, duration_ms: Date.now() - start });
    return this._wrapResponse(result);
  }

  async postJSON(url, body, appId) {
    const pattern = url.replace(/.*v0\.3\//, '').replace(/(app|tbl|viw|fld|rec|usr|wsp|sel|flt|blk|ext|col)[A-Za-z0-9]{10,}/g, '$1*');
    trace('http', 'http:request', { method: 'POST', endpoint_pattern: pattern, has_payload: true });
    const start = Date.now();
    const result = await this._apiCall('POST', url, body, appId, 'json');
    trace('http', 'http:response', { endpoint_pattern: pattern, status: result.status, duration_ms: Date.now() - start });
    return this._wrapResponse(result);
  }

  _wrapResponse(result) {
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => JSON.parse(result.body),
      text: async () => result.body,
    };
  }

  async close() {
    this.cancelIdlePark();
    if (this._unsubBusy) {
      try { this._unsubBusy(); } catch { /* ignore */ }
      this._unsubBusy = null;
    }
    return this._scheduler.runBarrier(async () => {
      if (this.page && this._networkHandler) {
        try { this.page.removeListener('request', this._networkHandler); } catch { /* page may be dead */ }
      }
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      this.context = null;
      this.page = null;
      this._networkHandler = null;
      this.isLoggedIn = false;
      this._credentials = null;
      // Drop the identity with the session that produced it. checkSessionHealth
      // reports this field, so a leftover id from a previous login would be served
      // as evidence about a session it knows nothing about.
      this.userId = null;
      // A full teardown ENDS the recovery loop the breaker exists to bound, so a
      // latched breaker must not survive it. close() is the daemon's
      // /daemon/release-browser path (run right before an interactive re-login) —
      // leaving _sessionDead latched here is what forced a daemon restart to
      // recover. Idle-park deliberately does NOT go through close(), so a parked
      // (still logged-in) session keeps its breaker state.
      this.resetSessionHealth();
      // Hard-kill orphan chrome.exe left after context.close() (esp. Windows).
      // Barrier serializes against init so we cannot kill a concurrent relaunch.
      await this._killBrowserTree(this.profileDir).catch(() => {});
    });
  }
}
