import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE_DIR = path.join(__dirname, '..', process.env.AIRTABLE_PROFILE || '.chrome-profile');

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
    this.profileDir = options.profileDir || DEFAULT_PROFILE_DIR;
    this.context = null;
    this.page = null;
    this.isLoggedIn = false;
    this.userId = null;
    this.csrfToken = null;

    // Request queue — serializes all browser-backed API calls
    this._queue = [];
    this._processing = false;

    // Per-app secretSocketId cache (captured from network traffic)
    this._secretSocketIds = new Map();

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
    // Close existing context if recovering
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }

    const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
    const browserPath    = process.env.AIRTABLE_BROWSER_PATH || undefined;
    console.error(`[auth] Launching headless ${browserChannel} with persistent profile...`);
    const launchOpts = {
      headless: true,
      channel: browserChannel,
      viewport: null,
    };
    if (browserPath) launchOpts.executablePath = browserPath;
    const chromium = await getChromium();
    this.context = await chromium.launchPersistentContext(this.profileDir, launchOpts);

    this.page = this.context.pages()[0] || await this.context.newPage();

    // Intercept network traffic to capture secretSocketId
    this._setupNetworkInterception();

    // Navigate and wait for the app to be ready (not a blind timeout)
    await this.page.goto('https://airtable.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this._waitForAppReady();

    console.error('[auth] Page URL:', this.page.url());

    await this._extractCsrf();
    await this._verifySession();
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
    this.page.on('request', (request) => {
      try {
        const url = request.url();
        // Capture secretSocketId from Airtable's internal requests
        if (url.includes('airtable.com') && request.method() === 'POST') {
          const postData = request.postData();
          if (postData) {
            const socketIdMatch = postData.match(/secretSocketId[=:]([^&"]+)/);
            if (socketIdMatch) {
              // Try to figure out which app this belongs to
              const appMatch = url.match(/(app[A-Za-z0-9]+)/);
              const appId = appMatch ? appMatch[1] : '_global';
              this._secretSocketIds.set(appId, decodeURIComponent(socketIdMatch[1]));
              console.error(`[auth] Captured secretSocketId for ${appId}`);
            }
          }
        }
      } catch {
        // Silently ignore interception errors
      }
    });
  }

  getSecretSocketId(appId) {
    return this._secretSocketIds.get(appId) || this._secretSocketIds.get('_global') || null;
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
      console.error('[auth] Session verified!', this.userId ? `User: ${this.userId}` : '(userId not in payload)');
    } else {
      this.isLoggedIn = false;
      throw new Error(
        `Session invalid (${result.status}). Run "node src/login.js" to log in first.\n` +
        `Response: ${result.body?.substring(0, 200)}`
      );
    }
  }

  /**
   * Attempt session recovery: close browser, relaunch, re-verify.
   * Only one recovery attempt at a time.
   */
  async _recoverSession() {
    if (this._recovering) return;
    this._recovering = true;
    try {
      console.error('[auth] Session expired. Attempting recovery...');
      this.isLoggedIn = false;
      this._initPromise = null;
      await this._doInit();
      console.error('[auth] Session recovered successfully.');
    } finally {
      this._recovering = false;
    }
  }

  // ─── Request Queue ────────────────────────────────────────────

  /**
   * Enqueue a request. All browser-backed calls go through here to prevent
   * concurrent page.evaluate() calls from corrupting each other.
   */
  _enqueue(fn) {
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

    if (contentType === 'json') {
      return this.page.evaluate(async ({ url, body, appId, timeZone }) => {
        const headers = {
          'Content-Type': 'application/json',
          'x-airtable-inter-service-client': 'webClient',
          'x-airtable-page-load-id': 'pgl' + Math.random().toString(36).substring(2, 15),
          'x-requested-with': 'XMLHttpRequest',
          'x-user-locale': 'en',
          'x-time-zone': timeZone,
        };
        if (appId) headers['x-airtable-application-id'] = appId;

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          return { status: res.status, body: await res.text() };
        } catch (e) {
          return { status: 0, body: '', error: e.message };
        }
      }, { url, body, appId, timeZone });
    }

    return this.page.evaluate(async ({ url, method, body, appId, timeZone, csrfToken }) => {
      const headers = {
        'x-airtable-inter-service-client': 'webClient',
        'x-airtable-page-load-id': 'pgl' + Math.random().toString(36).substring(2, 15),
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
    }, { url, method, body, appId, timeZone, csrfToken });
  }

  // ─── Queued API Call (with session recovery) ──────────────────

  async _apiCall(method, urlPath, body = null, appId = null, contentType = 'form') {
    return this._enqueue(async () => {
      await this.ensureLoggedIn();

      let result;
      try {
        result = await this._rawApiCall(method, urlPath, body, appId, contentType);
      } catch (evalError) {
        // page.evaluate itself failed (browser crashed, context destroyed)
        if (!this._recovering) {
          console.error(`[auth] page.evaluate failed: ${evalError.message}. Recovering...`);
          await this._recoverSession();
          return this._rawApiCall(method, urlPath, body, appId, contentType);
        }
        throw evalError;
      }

      // Session expired or network failure — attempt one recovery and retry
      const needsRecovery = result.status === 401 || result.status === 403 || result.error;
      if (needsRecovery && !this._recovering) {
        console.error(`[auth] API call failed (status=${result.status}, error=${result.error || 'none'}). Recovering...`);
        await this._recoverSession();
        return this._rawApiCall(method, urlPath, body, appId, contentType);
      }

      return result;
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
        await this.init();
      }
    } catch {
      // page.url() can throw if browser crashed — force re-init
      console.error('[auth] Browser context lost. Re-initializing...');
      this.isLoggedIn = false;
      await this.init();
    }
  }

  async get(url, appId) {
    const result = await this._apiCall('GET', url, null, appId);
    return this._wrapResponse(result);
  }

  async postForm(url, params, appId) {
    const result = await this._apiCall('POST', url, params, appId, 'form');
    return this._wrapResponse(result);
  }

  async postJSON(url, body, appId) {
    const result = await this._apiCall('POST', url, body, appId, 'json');
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
