import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { trace } from './debug-tracer.js';
import { getProfileDir } from './paths.js';
import { HttpTransport } from './http-transport.js';
import { loadByoCredentials } from './byo-credentials.js';
import { directLogin } from './direct-login.js';
import { isProfileLockError, killProfileHolders } from './profile-lock.js';

/** Generate a page-load-id (pgl + 13 base36 chars) using crypto, not Math.random. */
function genPageLoadId() {
  // 10 bytes → ~13 base36 chars when converted as BigInt
  const hex = randomBytes(10).toString('hex');
  return 'pgl' + BigInt('0x' + hex).toString(36).slice(0, 13).padStart(13, '0');
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

/**
 * Airtable session authenticator using Playwright persistent browser context.
 *
 * Architecture:
 *   - Single browser/profile owner per process
 *   - Global request queue serializes all browser-backed calls
 *   - Automatic session recovery on 401/403
 *   - secretSocketId capture via network interception
 *   - CSRF extraction with multiple fallback strategies
 *
 * Flow:
 *   1. First run: `node src/login.js` opens Chrome with persistent profile
 *   2. User logs in manually (session stored in Chrome profile dir)
 *   3. MCP server launches headless Chrome with same profile for API calls
 *   4. All requests serialized through the queue and executed via page.evaluate
 */
export class AirtableAuth {
  constructor(options = {}) {
    this.profileDir = options.profileDir || getProfileDir();
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

    // Request queue — serializes all browser-backed API calls.
    // Bounded so a runaway LLM loop cannot blow up memory even when the
    // upstream semaphore lets thousands of tool calls through over time.
    this._queue = [];
    this._processing = false;
    this._maxQueueSize = Number(process.env.AIRTABLE_MAX_AUTH_QUEUE) || 64;
    this._rateDelayMs = Number(process.env.AIRTABLE_RATE_DELAY_MS) || 0;

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
    this._killProfileHolders = options.killProfileHolders || killProfileHolders;
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
    this._sessionDeadAfter = Number(process.env.AIRTABLE_SESSION_DEAD_AFTER) || 8;
    this._rlSleep = (ms) => new Promise((r) => setTimeout(r, ms)); // injectable for tests
  }

  /** Reset the dead-session circuit-breaker (e.g., after the user re-authenticates). */
  resetSessionHealth() {
    this._sessionDead = false;
    this._recoveryStreak = 0;
  }

  // ─── Initialization ──────────────────────────────────────────

  async init() {
    // Deduplicate concurrent init calls
    if (this._initPromise) return this._initPromise;
    if (this.context && this.isLoggedIn) return;

    this._initPromise = this._doInitBounded();
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
  // caller's retry/budget can proceed; a late-arriving context is closed to avoid leaking
  // a Chromium onto the contended profile.
  async _doInitBounded() {
    const ms = Number(process.env.AIRTABLE_INIT_TIMEOUT_MS) || 90_000;
    let timer;
    let timedOut = false;
    const inner = this._doInit();
    inner.then(() => { if (timedOut) this.context?.close?.().catch(() => {}); }, () => {});
    try {
      return await Promise.race([
        inner,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`session init/recovery exceeded ${ms / 1000}s — the browser profile may be locked by another process (profile contention)`));
          }, ms);
        }),
      ]);
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
        `BYO_CREDENTIALS_INVALID: the provided AIRTABLE_COOKIE/credentials.json cookie was rejected (status ${result.status}) — refresh it from a logged-in browser`
      );
    }
    try {
      const data = JSON.parse(result.body);
      this.userId = data?.data?.userId || null;
    } catch {
      this.userId = null;
    }
    console.error('[auth] BYO session verified!', this.userId ? `User: ${this.userId}` : '(userId not in payload)');
  }

  /**
   * Direct-login init: no browser. Replicate the HAR login flow over HTTP
   * (impit + TOTP) to mint fresh session cookies + csrf, then drive all API
   * calls through the direct-HTTP transport with them. directLogin() itself
   * validates the session (checks the session cookie is present and re-scrapes
   * an authed page), so no separate browser verify is needed.
   */
  async _doInitDirectLogin() {
    console.error('[auth] AIRTABLE_AUTH_MODE=direct-login — browser-free login via impit + TOTP (no browser).');
    this._credentials = await this._directLogin();
    this.csrfToken = this._credentials?.csrfToken ?? null;
    this.isLoggedIn = true;
    console.error('[auth] direct-login complete.');
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

  // ─── CSRF Extraction ─────────────────────────────────────────

  async _extractCsrf() {
    this.csrfToken = await this.page.evaluate(() => {
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
    });

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
      try {
        const data = JSON.parse(result.body);
        this.userId = data?.data?.userId || null;
      } catch {
        this.userId = null;
      }
      this.isLoggedIn = true;
      trace('auth', 'auth:session_check', { success: true, user_id: this.userId });
      console.error('[auth] Session verified!', this.userId ? `User: ${this.userId}` : '(userId not in payload)');
    } else {
      this.isLoggedIn = false;
      const sessionError = `Session invalid (${result.status}). Run "node src/login.js" to log in first.\nResponse: ${result.body?.substring(0, 200)}`;
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
          throw new Error(
            'BYO_CREDENTIALS_EXPIRED: cookie no longer valid — paste a fresh cookie into ~/.airtable-user-mcp/credentials.json or AIRTABLE_COOKIE'
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

  // ─── Request Queue ────────────────────────────────────────────

  /**
   * Enqueue a request. All browser-backed calls go through here to prevent
   * concurrent page.evaluate() calls from corrupting each other.
   *
   * H4 — the queue is bounded. When saturated we reject new calls rather than
   * accept unbounded backlog; callers can surface this as a retry prompt to
   * the LLM or drop the tool call gracefully.
   */
  _enqueue(fn) {
    if (this._queue.length >= this._maxQueueSize) {
      return Promise.reject(new Error(
        `Auth queue saturated (${this._queue.length}/${this._maxQueueSize}). ` +
        `Retry after in-flight browser calls drain, or set AIRTABLE_MAX_AUTH_QUEUE to raise the cap.`
      ));
    }
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const { fn, resolve, reject } = this._queue.shift();
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
      // Optional inter-call delay to stay under Airtable's 5 req/s limit.
      // Set AIRTABLE_RATE_DELAY_MS=200 to enable; default 0 (no delay).
      if (this._rateDelayMs > 0 && this._queue.length > 0) {
        await new Promise(r => setTimeout(r, this._rateDelayMs));
      }
    }

    this._processing = false;
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
        requestBody = JSON.stringify(body);
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
      let deadline = Date.now() + HARD_TIMEOUT_MS; // extended by intentional rate-limit backoff waits
      let attempt = 0;    // browser-recovery (relaunch) attempts
      let rlAttempt = 0;  // rate-limit/throttle backoff attempts (same session, no relaunch)
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
          if (++this._recoveryStreak >= this._sessionDeadAfter) {
            this._sessionDead = true;
            throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive rate-limit/throttle responses (status=${result.status}) that did not clear after backoff — the account is throttled or the login is blocked. Let the limit reset (wait), or re-authenticate (run \`login\`), then retry.`);
          }
          const delay = Math.min(30_000, 1000 * (2 ** rlAttempt)) + Math.floor(Math.random() * 500);
          console.error(`[auth] ${result.status} (rate-limit/throttle) — backing off ${delay}ms on the same session, no relaunch (streak ${this._recoveryStreak})...`);
          await this._rlSleep(delay);
          deadline += delay; // an intentional backoff wait is not a stall — don't let it trip the budget
          rlAttempt++;
          continue;
        }

        // Genuine auth loss (401) or network failure — relaunch the session.
        const needsRecovery = result.status === 401 || result.error;
        if (needsRecovery && !this._recovering && attempt < MAX_RETRIES) {
          if (++this._recoveryStreak >= this._sessionDeadAfter) {
            this._sessionDead = true;
            throw new Error(`SESSION_INVALID: ${this._recoveryStreak} consecutive auth failures (status=${result.status}) across recoveries — the Airtable login has expired or been blocked. Re-authenticate (run \`login\`) and retry.`);
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
      if (res.ok) {
        let userId = this.userId;
        try {
          const data = await res.json();
          userId = data?.data?.userId ?? userId;
        } catch { /* keep cached userId */ }
        return { valid: true, userId: userId ?? null };
      }
      return { valid: false, status: res.status };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
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
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }
}
