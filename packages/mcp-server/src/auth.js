import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { trace } from './debug-tracer.js';
import { getProfileDir } from './paths.js';

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

    // Request queue — serializes all browser-backed API calls.
    // Bounded so a runaway LLM loop cannot blow up memory even when the
    // upstream semaphore lets thousands of tool calls through over time.
    this._queue = [];
    this._processing = false;
    this._maxQueueSize = Number(process.env.AIRTABLE_MAX_AUTH_QUEUE) || 64;

    // Per-app secretSocketId cache (captured from network traffic).
    // LRU-bounded so long-running servers with many bases don't grow this
    // indefinitely.
    this._secretSocketIds = new Map();
    this._maxSocketIdCache = 50;

    // Reference to the page-level 'request' listener so we can detach it on
    // _doInit's context-close step rather than leak it per session-recovery.
    this._networkHandler = null;

    // Session recovery state
    this._recovering = false;
    this._initPromise = null;
  }

  // ─── Initialization ──────────────────────────────────────────

  async init() {
    // Deduplicate concurrent init calls
    if (this._initPromise) return this._initPromise;
    if (this.context && this.isLoggedIn) return;

    this._initPromise = this._doInit();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _doInit() {
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
    const chromium = await getChromium();
    this.context = await chromium.launchPersistentContext(this.profileDir, launchOpts);

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
      console.error('[auth] CSRF token found:', this.csrfToken.substring(0, 15) + '...');
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
      console.error('[auth] Session expired. Attempting recovery...');
      this.isLoggedIn = false;
      // Atomic assignment — init() observes this as already-in-progress and
      // awaits the same promise, preventing a parallel _doInit().
      const recovery = this._doInit();
      this._initPromise = recovery;
      try {
        await recovery;
      } finally {
        this._initPromise = null;
      }
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
    }

    this._processing = false;
  }

  // ─── Raw API Call (no queue, no recovery) ─────────────────────

  async _rawApiCall(method, urlPath, body = null, appId = null, contentType = 'form') {
    const url = urlPath.startsWith('http') ? urlPath : `https://airtable.com${urlPath}`;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const csrfToken = this.csrfToken;
    // Generate page-load-id Node-side — `Math.random()` inside page.evaluate
    // is still not cryptographically strong and we can't reach node:crypto
    // from the browser context.
    const pageLoadId = genPageLoadId();

    // H3 — per-evaluate timeout. Playwright has no built-in timeout on
    // page.evaluate; a CDP-dead Chromium can hang forever. We race against
    // a 15s timer and let _apiCall's catch trigger _recoverSession.
    const EVAL_TIMEOUT_MS = 15_000;
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`page.evaluate exceeded ${EVAL_TIMEOUT_MS / 1000}s; browser may be unresponsive`)),
        EVAL_TIMEOUT_MS,
      )),
    ]);

    if (contentType === 'json') {
      return withTimeout(this.page.evaluate(async ({ url, method, body, appId, timeZone, pageLoadId }) => {
        const headers = {
          'Content-Type': 'application/json',
          'x-airtable-inter-service-client': 'webClient',
          'x-airtable-page-load-id': pageLoadId,
          'x-requested-with': 'XMLHttpRequest',
          'x-user-locale': 'en',
          'x-time-zone': timeZone,
        };
        if (appId) headers['x-airtable-application-id'] = appId;

        try {
          // Honor caller's method — previously this was hardcoded to POST which
          // silently broke any GET/PUT/PATCH JSON call.
          const options = { method, headers };
          if (body !== null && body !== undefined && method !== 'GET') {
            options.body = JSON.stringify(body);
          }
          const res = await fetch(url, options);
          return { status: res.status, body: await res.text() };
        } catch (e) {
          return { status: 0, body: '', error: e.message };
        }
      }, { url, method, body, appId, timeZone, pageLoadId }));
    }

    return withTimeout(this.page.evaluate(async ({ url, method, body, appId, timeZone, csrfToken, pageLoadId }) => {
      const headers = {
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

      const options = { method, headers };
      if (body && method !== 'GET') {
        const params = new URLSearchParams(body);
        if (csrfToken) params.set('_csrf', csrfToken);
        options.body = params.toString();
      }

      try {
        const res = await fetch(url, options);
        return { status: res.status, body: await res.text() };
      } catch (e) {
        return { status: 0, body: '', error: e.message };
      }
    }, { url, method, body, appId, timeZone, csrfToken, pageLoadId }));
  }

  // ─── Queued API Call (with session recovery & rate-limit backoff) ──────────────────

  async _apiCall(method, urlPath, body = null, appId = null, contentType = 'form') {
    return this._enqueue(async () => {
      await this.ensureLoggedIn();

      const MAX_RETRIES = 3;
      const HARD_TIMEOUT_MS = 30_000;
      const deadline = Date.now() + HARD_TIMEOUT_MS;
      let attempt = 0;
      while (true) {
        if (Date.now() > deadline) {
          // Bail out rather than retry past the caller's patience budget.
          // A hung _recoverSession or repeated 429s shouldn't stall the queue.
          throw new Error(`API call exceeded ${HARD_TIMEOUT_MS / 1000}s wall-clock budget (method=${method}, url=${urlPath.slice(0, 60)}...)`);
        }
        let result;
        try {
          result = await this._rawApiCall(method, urlPath, body, appId, contentType);
        } catch (evalError) {
          // page.evaluate itself failed (browser crashed, context destroyed)
          if (!this._recovering && attempt < MAX_RETRIES) {
            console.error(`[auth] page.evaluate failed: ${evalError.message}. Recovering...`);
            await this._recoverSession();
            attempt++;
            continue;
          }
          throw evalError;
        }

        // Rate limited — exponential backoff (429 = Too Many Requests, 503 = Service Unavailable)
        if ((result.status === 429 || result.status === 503) && attempt < MAX_RETRIES) {
          const delay = 500 * (2 ** attempt);
          console.error(`[auth] Rate limited (${result.status}), retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
          continue;
        }

        // Session expired or network failure — attempt one recovery and retry
        const needsRecovery = result.status === 401 || result.status === 403 || result.error;
        if (needsRecovery && !this._recovering && attempt < MAX_RETRIES) {
          console.error(`[auth] API call failed (status=${result.status}, error=${result.error || 'none'}). Recovering...`);
          await this._recoverSession();
          attempt++;
          continue;
        }

        return result;
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────

  async ensureLoggedIn() {
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

  async get(url, appId) {
    const pattern = url.replace(/.*v0\.3\//, '').replace(/(app|tbl|viw|fld|rec|usr|wsp|sel|flt|blk|ext|col)[A-Za-z0-9]{10,}/g, '$1*');
    trace('http', 'http:request', { method: 'GET', endpoint_pattern: pattern, has_payload: false });
    const start = Date.now();
    const result = await this._apiCall('GET', url, null, appId);
    trace('http', 'http:response', { endpoint_pattern: pattern, status: result.status, duration_ms: Date.now() - start });
    return this._wrapResponse(result);
  }

  async postForm(url, params, appId) {
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
