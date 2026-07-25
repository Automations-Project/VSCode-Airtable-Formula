import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { fork } from 'child_process';
import { unlink } from 'node:fs/promises';
import type { AuthState, BrowserDownloadState } from '@airtable-formula/shared';
import { getSettings } from '../settings.js';
import { detectBrowser, detectAllBrowsers, type BrowserProbe } from './browser-detect.js';
import type { BrowserDownloadManager } from './browser-download.js';
import type { DaemonManager } from './daemon-manager.js';
import { processStderrChunk } from '../debug/stderr-parser.js';
import type { DebugCollector } from '../debug/collector.js';

const SECRET_PREFIX = 'airtableFormula';
const SECRET_EMAIL      = `${SECRET_PREFIX}.email`;
const SECRET_PASSWORD   = `${SECRET_PREFIX}.password`;
const SECRET_OTP_SECRET = `${SECRET_PREFIX}.otpSecret`;
const SECRET_COOKIE     = `${SECRET_PREFIX}.cookie`;

const PROFILE_DIR = path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
const CONFIG_DIR = path.join(os.homedir(), '.airtable-user-mcp');

/**
 * Manages Airtable session authentication for the MCP server.
 *
 * Responsibilities:
 *   - Store/retrieve credentials via VS Code SecretStorage (OS keychain)
 *   - Spawn health-check and login-runner child processes
 *   - Periodic auto-refresh timer
 *   - Emit auth state changes for the dashboard
 */
export class AuthManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<AuthState>();
  public readonly onDidChange = this._onDidChange.event;

  private _state: AuthState = { status: 'unknown', hasCredentials: false, hasCookie: false };
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _initCheckTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed = false;
  private _browser: BrowserProbe = { found: false };
  private _downloadManager?: BrowserDownloadManager;
  private _downloadListener?: vscode.Disposable;
  private _debugCollector?: DebugCollector;
  private _daemonManager?: DaemonManager;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly extensionPath: string,
    daemonManager?: DaemonManager,
  ) {
    this._daemonManager = daemonManager;
  }

  /**
   * Attach an optional BrowserDownloadManager so the AuthManager can:
   *   - include the downloaded Chromium in browser probes as a last-resort fallback,
   *   - forward download state into AuthState so the dashboard can render progress.
   */
  attachDownloadManager(mgr: BrowserDownloadManager): void {
    this._downloadManager = mgr;
    this._downloadListener?.dispose();
    this._downloadListener = mgr.onDidChange(state => {
      this._updateState({ browserDownload: state });
      // When a download finishes successfully, re-probe so the UI immediately
      // flips from "chrome-missing" to the bundled Chromium.
      if (state.status === 'done') {
        this.refreshBrowserDetection();
        if (this._state.status === 'chrome-missing') {
          this._updateState({ status: 'unknown', error: undefined });
        }
      }
    });
    // Seed initial state
    this._updateState({ browserDownload: mgr.state });
  }

  setDebugCollector(collector: DebugCollector): void {
    this._debugCollector = collector;
  }

  /**
   * Kick off a bundled Chromium download. No-op if no download manager is
   * attached or if a download is already in flight.
   */
  async downloadBrowser(): Promise<BrowserDownloadState> {
    if (!this._downloadManager) {
      const err: BrowserDownloadState = { status: 'error', error: 'Download manager not attached' };
      this._updateState({ browserDownload: err });
      return err;
    }
    return this._downloadManager.download();
  }

  /** Remove the downloaded Chromium. */
  async removeDownloadedBrowser(): Promise<boolean> {
    if (!this._downloadManager) return false;
    const ok = await this._downloadManager.remove();
    this.refreshBrowserDetection();
    return ok;
  }

  get browser(): BrowserProbe { return this._browser; }

  /**
   * Re-run the browser probe and update state. Returns the fresh probe.
   * Called at init, before login, and before health checks.
   */
  refreshBrowserDetection(): BrowserProbe {
    const downloadedPath = this._downloadManager?.getExecutablePath();
    const allBrowsers = detectAllBrowsers(downloadedPath);

    // Use user's browser choice if set, otherwise first available
    const settings = getSettings();
    const choice = settings.auth.browserChoice;
    let selected: BrowserProbe;

    if (choice?.mode === 'custom' && choice.executablePath) {
      selected = {
        found: true,
        channel: (choice.channel as BrowserProbe['channel']) ?? 'chromium',
        executablePath: choice.executablePath,
        label: choice.label ?? 'Custom browser',
      };
    } else if (choice?.mode === 'auto' && choice.executablePath) {
      const match = allBrowsers.find(b => b.executablePath === choice.executablePath);
      selected = match ?? allBrowsers[0] ?? { found: false };
    } else {
      selected = allBrowsers[0] ?? { found: false };
    }

    this._browser = selected;
    this._updateState({
      browser: {
        found: selected.found,
        channel: selected.channel,
        label: selected.label,
        downloaded: selected.downloaded,
        executablePath: selected.executablePath,
      },
      availableBrowsers: allBrowsers.map(b => ({
        found: b.found,
        channel: b.channel,
        label: b.label,
        downloaded: b.downloaded,
        executablePath: b.executablePath,
      })),
    });
    return selected;
  }

  private _getLoginMode(): 'manual' | 'auto' {
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    return cfg.get('auth.loginMode', 'manual') as 'manual' | 'auto';
  }

  private _profileEnv(): Record<string, string> {
    return { AIRTABLE_PROFILE_DIR: PROFILE_DIR };
  }

  private async _applyPermissions(): Promise<void> {
    try {
      const { secureDirectory } = await import('./secure-permissions.js');
      await secureDirectory(CONFIG_DIR);
    } catch {
      // Permissions are best-effort — don't block login
    }
  }

  /**
   * Env vars to forward to child scripts so they launch with the detected
   * browser channel / executable, overriding the hard-coded `channel: 'chrome'`
   * default baked into the MCP scripts.
   */
  private _browserEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this._browser.channel) env.AIRTABLE_BROWSER_CHANNEL = this._browser.channel;
    if (this._browser.executablePath) env.AIRTABLE_BROWSER_PATH = this._browser.executablePath;
    return env;
  }

  get state(): AuthState { return this._state; }

  // ─── Credentials ─────────────────────────────────────────────

  async getEmail(): Promise<string | undefined> {
    return this.secrets.get(SECRET_EMAIL);
  }

  async getPassword(): Promise<string | undefined> {
    return this.secrets.get(SECRET_PASSWORD);
  }

  async getOtpSecret(): Promise<string | undefined> {
    return this.secrets.get(SECRET_OTP_SECRET);
  }

  // ─── BYO session cookie (authMode='byo') ─────────────────────
  //
  // Stored in the OS keychain like the email/password/otp triplet. The cookie
  // reaches the MCP server via env (stdio path, getCredentialsEnv) or the
  // bearer-authenticated /daemon/auth-credentials endpoint (daemon path) — it
  // is never written to disk (no plaintext credentials.json) and never logged.

  async getCookie(): Promise<string | undefined> {
    return this.secrets.get(SECRET_COOKIE);
  }

  // CSRF is not stored: for byo the server auto-scrapes it from the cookie's authed session.
  async saveCookie(cookie: string): Promise<void> {
    // Modes are NOT storage-exclusive: any stored email/password (direct-login)
    // are intentionally preserved so the user can switch between byo and
    // direct-login without re-entering credentials.
    await this.secrets.store(SECRET_COOKIE, cookie);
    this._updateState({ hasCookie: true });
  }

  async clearCookie(): Promise<void> {
    await this.secrets.delete(SECRET_COOKIE);
    this._updateState({ hasCookie: false });
  }

  async hasCookie(): Promise<boolean> {
    return !!(await this.getCookie());
  }

  async saveCredentials(email: string, password: string, otpSecret?: string): Promise<void> {
    await this.secrets.store(SECRET_EMAIL, email);
    await this.secrets.store(SECRET_PASSWORD, password);
    if (otpSecret) {
      await this.secrets.store(SECRET_OTP_SECRET, otpSecret);
    } else {
      await this.secrets.delete(SECRET_OTP_SECRET);
    }
    this._updateState({ hasCredentials: true });
  }

  // NOTE: a `clearCredentials()` helper used to live here — it deleted the same
  // four secrets as logout() but never dropped the daemon's copy, and it had zero
  // call sites. It was removed rather than repaired: a second, subtly weaker
  // credential-clearing entry point is exactly how the daemon kept serving a
  // "logged out" session. Use `logout()` (clears secrets AND the daemon session)
  // or `clearCookie()` (which pairs with dropDaemonCredentials at its call site).

  /**
   * THE logout path. Every entry point (Command Palette `airtable-formula.logout`
   * and the dashboard's `action:logout`) must go through this and nothing else:
   * clearing the keychain alone left a running daemon serving the old session, so
   * the user believed they had logged out while tool calls kept working.
   *
   * Clears, in order:
   *   1. the auto-refresh timer (so it can't re-launch a browser mid-wipe),
   *   2. the OS-keychain secrets,
   *   3. the daemon's live browser session (`/daemon/release-browser`) — this is
   *      the browser-mode credential drop AND it unlocks the persistent profile
   *      so the directory removal below can actually succeed on Windows,
   *   4. the on-disk Chrome profile,
   *   5. the daemon's in-memory byo/direct-login credentials (daemon restart).
   *
   * Step 3 can fail while the daemon is very much alive (its `healthy` flag comes
   * from a 2 s probe). That must NOT read as a successful logout, so an
   * unconfirmed release — or a profile wipe blocked by a still-running Chromium —
   * escalates to a daemon restart/force-stop, which drops the session either way
   * since daemon shutdown runs `auth.close()`. Step 4 is then retried, because a
   * surviving profile directory is a live session on disk: the replacement daemon
   * points at the same `AIRTABLE_PROFILE_DIR` and would authenticate from it.
   *
   * @returns `daemonSessionDropped:false` when the daemon may still be serving the
   *          session the user just logged out of, OR when the profile is still on
   *          disk. Either way the caller must not claim the session was cleared.
   */
  async logout(): Promise<{ daemonSessionDropped: boolean }> {
    // Stop the refresh timer first so it can't race against the profile wipe
    // and immediately re-launch the browser with stale (now-deleted) state.
    this.stopAutoRefresh();

    await this.secrets.delete(SECRET_EMAIL);
    await this.secrets.delete(SECRET_PASSWORD);
    await this.secrets.delete(SECRET_OTP_SECRET);
    await this.secrets.delete(SECRET_COOKIE);

    // Browser mode keeps its session in the daemon's live Chromium (cookies in
    // memory, profile dir held open). Releasing it drops that session and frees
    // the profile lock — without this, `fs.rm` below fails on Windows and the
    // daemon happily keeps answering tool calls with the "logged out" session.
    const release = await this._releaseDaemonBrowser();
    if (!release.released) {
      console.warn(`[AuthManager] daemon browser release not confirmed (${release.reason}) — escalating to a daemon restart`);
    }

    let profileWiped = await this._wipeBrowserProfile();

    // byo / direct-login creds live in the daemon's memory (cred-store), not on
    // disk — only a restart drops them. `force` extends that to browser mode when
    // the session may still be live: either the release was not confirmed, or the
    // profile could not be removed (something still holds it open, and the
    // daemon's Chromium is the usual suspect). Restarting is then the only way to
    // be sure the old session is gone.
    const dropped = await this.dropDaemonCredentials({ force: !release.released || !profileWiped });

    // Retry the wipe once after the daemon is down: its shutdown runs
    // auth.close() → _killBrowserTree, so a profile that was locked a moment ago
    // is free now. This retry is NOT optional — a profile left on disk still holds
    // live Airtable cookies, and the freshly spawned daemon points at the same
    // AIRTABLE_PROFILE_DIR, so its next tool call (or the dashboard refresh fired
    // right after logout) would simply log itself back in.
    if (!profileWiped) profileWiped = await this._wipeBrowserProfile();

    this._updateState({ status: 'unknown', hasCredentials: false, hasCookie: false, userId: undefined, error: undefined });
    // An un-wiped profile is a live session on disk, so it can never count as
    // dropped no matter how cleanly the daemon side went.
    return { daemonSessionDropped: (release.released || dropped) && profileWiped };
  }

  /** Remove the persistent Chrome profile. Returns false if it is still on disk. */
  private async _wipeBrowserProfile(): Promise<boolean> {
    const fs = await import('fs/promises');
    try {
      await fs.rm(PROFILE_DIR, { recursive: true, force: true });
      console.log('[AuthManager] Browser profile cleared');
      return true;
    } catch (err) {
      // `force: true` already swallows "not found", so this is a real failure —
      // typically EBUSY/EPERM on Windows while a Chromium still holds the dir.
      console.warn('[AuthManager] Failed to clear browser profile:', err);
      return false;
    }
  }

  /**
   * After the keychain credentials are cleared in a daemon + byo/direct-login
   * setup, the running daemon still holds the injected credentials in memory.
   * Restart it so it re-spawns creds-free — with the keychain now empty it has
   * nothing to load, so the stale in-memory copy is dropped. Fully best-effort:
   * every await is guarded and nothing throws to the caller.
   *
   * Called by `logout()` and by the dashboard's narrower "clear cookie" /
   * "clear credentials" actions (via DashboardProvider).
   *
   * @param opts.force restart regardless of auth mode. Browser mode normally has
   *        nothing here to drop (the session lives in the daemon's Chromium, which
   *        `_releaseDaemonBrowser` handles) — but when that release could not be
   *        confirmed, killing the process is the only remaining guarantee.
   * @returns true when the daemon is confirmed to no longer hold the session
   *          (including "there was nothing to drop"); false when it may still.
   */
  async dropDaemonCredentials(opts?: { force?: boolean }): Promise<boolean> {
    try {
      const settings = getSettings();
      const authMode = settings.mcp.authMode;
      if (!settings.mcp.useDaemon) return true;
      if (!opts?.force && authMode !== 'byo' && authMode !== 'direct-login') return true;
      const dm = this._daemonManager;
      if (!dm) return true;
      const status = await dm.getDaemonStatus();
      if (!status?.running) return true;
      try {
        await dm.restartDaemon();
        // The restarted daemon runs auth.close() on shutdown, so the old
        // process's browser session and in-memory credentials are both gone.
        return true;
      } catch (restartErr) {
        // The daemon still holds the (now-cleared) creds in memory. A restart would
        // drop them but it failed — force-stop so the stale in-memory session dies.
        console.warn('[AuthManager] daemon restart after credential clear failed:', restartErr instanceof Error ? restartErr.message : 'unknown error');
        try {
          const forced = await dm.forceStop();
          // The sweep never kills a process it cannot attribute to this install; if one was left
          // alive it may still be serving the cleared session, so say so rather than implying
          // everything is down.
          const leftAlive = forced?.skippedUnowned?.length
            ? ` ${forced.skippedUnowned.length} daemon-like process(es) were left running because ownership could not be verified (PID ${forced.skippedUnowned.map(p => p.pid).join(', ')}) — stop them manually if they are yours.`
            : '';
          vscode.window.showErrorMessage(`Credentials were cleared from the keychain, but the running daemon could not be restarted to drop its in-memory session. It was force-stopped — restart it when ready.${leftAlive}`);
          // Force-stop killed the process (and with it the browser session) — but a
          // process the sweep could not attribute is still out there serving.
          return !forced?.skippedUnowned?.length;
        } catch (stopErr) {
          console.warn('[AuthManager] daemon force-stop after failed restart also failed:', stopErr instanceof Error ? stopErr.message : 'unknown error');
          vscode.window.showErrorMessage('Credentials cleared, but the daemon may still hold your session in memory — stop/restart it manually to fully clear it.');
          return false;
        }
      }
    } catch (err) {
      console.warn('[AuthManager] daemon restart after credential clear failed:', err instanceof Error ? err.message : 'unknown error');
      return false;
    }
  }

  async hasCredentials(): Promise<boolean> {
    const email = await this.getEmail();
    const password = await this.getPassword();
    return !!(email && password);
  }

  /**
   * Read stored credentials from SecretStorage.
   * Returns undefined if no credentials are stored.
   */
  async getCredentials(opts?: { ensureDaemon?: boolean }): Promise<{ email: string; password: string; otpSecret?: string } | undefined> {
    // D-02: ensure daemon is running before handing off credentials.
    // Implicit + best-effort: credentials don't require the daemon, and this
    // path runs from provideMcpServerDefinitions — it must neither resurrect
    // a daemon the user explicitly stopped nor block login when the daemon
    // can't start.
    // Callers that push creds TO an already-running daemon (the lockfile-watch / dashboard re-push)
    // pass { ensureDaemon: false }: they must NOT trigger a spawn here, or a lockfile-watch →
    // getCredentials → ensureDaemon → spawn → lockfile-write → watch loop runs away (multiple procs).
    if (opts?.ensureDaemon !== false && getSettings().mcp.useDaemon && this._daemonManager) {
      try {
        await this._daemonManager.ensureDaemon({ implicit: true });
      } catch { /* user-stopped latch or startup failure — proceed without daemon */ }
    }
    const email = await this.getEmail();
    const password = await this.getPassword();
    if (!email || !password) return undefined;

    const otp = await this.getOtpSecret();
    return { email, password, ...(otp ? { otpSecret: otp } : {}) };
  }

  /**
   * Get credentials as env vars, shaped for the given auth mode. ONLY for the
   * VS Code MCP stdio definition (registration.ts), where VS Code owns the
   * spawn and env is the only channel. Helper scripts we fork ourselves receive
   * credentials over the IPC channel instead (_spawnScript) so they never
   * appear in the child's environment (/proc/<pid>/environ, process listings,
   * core dumps).
   *
   *   - 'byo'          → { AIRTABLE_COOKIE } only (CSRF is auto-scraped
   *                      server-side, never forwarded), or undefined when no
   *                      cookie is saved.
   *   - 'direct-login' → { AIRTABLE_EMAIL, AIRTABLE_PASSWORD, AIRTABLE_TOTP_SECRET }
   *                      (direct-login reads TOTP as AIRTABLE_TOTP_SECRET), or
   *                      undefined when no credentials are saved.
   *   - browser / undefined → { AIRTABLE_EMAIL, AIRTABLE_PASSWORD,
   *                      AIRTABLE_OTP_SECRET } (unchanged legacy behavior).
   *
   * NOTE: the daemon transport never uses this — daemon creds go via the
   * bearer-authenticated /daemon/auth-credentials endpoint (see
   * DaemonManager.pushAuthCredentials), never the daemon's env.
   */
  async getCredentialsEnv(authMode?: string): Promise<Record<string, string> | undefined> {
    if (authMode === 'byo') {
      const cookie = await this.getCookie();
      if (!cookie) return undefined;
      // CSRF is auto-scraped server-side from the cookie session — not forwarded.
      return { AIRTABLE_COOKIE: cookie };
    }

    if (authMode === 'direct-login') {
      // getCredentialsEnv builds env for the STDIO (non-daemon) spawn — it must
      // never trigger a daemon spawn from a credential read.
      const creds = await this.getCredentials({ ensureDaemon: false });
      if (!creds) return undefined;
      const env: Record<string, string> = {
        AIRTABLE_EMAIL: creds.email,
        AIRTABLE_PASSWORD: creds.password,
      };
      if (creds.otpSecret) env.AIRTABLE_TOTP_SECRET = creds.otpSecret;
      return env;
    }

    // Same rationale as the direct-login branch above.
    const creds = await this.getCredentials({ ensureDaemon: false });
    if (!creds) return undefined;

    const env: Record<string, string> = {
      AIRTABLE_EMAIL: creds.email,
      AIRTABLE_PASSWORD: creds.password,
    };
    if (creds.otpSecret) env.AIRTABLE_OTP_SECRET = creds.otpSecret;
    return env;
  }

  // ─── Health Check ────────────────────────────────────────────

  async checkSession(): Promise<AuthState> {
    // Prefer the daemon's SINGLE shared browser. This avoids forking a local
    // Chrome that would collide with the daemon over the persistent profile
    // (Chrome exit code 21 → the "session dead / network error" failure), and
    // it works even when no local browser is installed.
    const viaDaemon = await this._checkViaDaemon();
    if (viaDaemon) return viaDaemon;

    // byo / direct-login never touch a browser — the session is minted/refreshed
    // by the MCP server over direct-HTTP. The daemon check above is the only live
    // verification for them; with no daemon we can't probe, so surface a neutral
    // status instead of forking Chrome or reporting 'chrome-missing'.
    const mode = getSettings().mcp.authMode;
    if (mode === 'byo' || mode === 'direct-login') {
      // Neutral 'unknown' state: this isn't an error. The webview renders any
      // auth.error as a permanent yellow warning, so leave error undefined
      // (and clear any prior error) rather than putting an informational string there.
      this._updateState({
        status: 'unknown',
        lastChecked: new Date().toISOString(),
        error: undefined,
      });
      return this._state;
    }

    // No daemon (stdio mode) or a daemon that predates the endpoint — fall back
    // to forking our own health-check. Preflight: no browser, no point spawning.
    const probe = this.refreshBrowserDetection();
    if (!probe.found) {
      this._updateState({
        status: 'chrome-missing',
        error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
        lastChecked: new Date().toISOString(),
      });
      return this._state;
    }

    this._updateState({ status: 'checking' });

    try {
      let result = await this._spawnScript('health-check.mjs', { ...this._browserEnv(), ...this._profileEnv() });

      // Chrome exits immediately (exit code 21) when a stale LOCK file blocks
      // profile acquisition — common after a crash. Clear it and retry once.
      if (!result.valid && typeof result.error === 'string' && this._isChromeLockError(result.error)) {
        await this._clearChromeProfileLock();
        await new Promise<void>(r => setTimeout(r, 800));
        result = await this._spawnScript('health-check.mjs', { ...this._browserEnv(), ...this._profileEnv() });
      }

      const now = new Date().toISOString();

      if (result.valid) {
        this._updateState({
          status: 'valid',
          userId: result.userId || undefined,
          lastChecked: now,
          error: undefined,
        });
      } else {
        this._updateState({
          status: 'expired',
          lastChecked: now,
          error: result.error || `HTTP ${result.status}`,
        });
      }
    } catch (err) {
      this._updateState({
        status: 'error',
        lastChecked: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return this._state;
  }

  /**
   * Verify the session through the daemon's already-open browser.
   *
   * Returns the resulting AuthState when the daemon handled the check, or
   * `null` to signal the caller to fall back to forking a local health-check
   * (no daemon, daemon disabled, daemon unreachable, or a daemon too old to
   * expose /daemon/session-health).
   */
  private async _checkViaDaemon(): Promise<AuthState | null> {
    const dm = this._daemonManager;
    if (!dm || !getSettings().mcp.useDaemon) return null;

    let status: Awaited<ReturnType<DaemonManager['getDaemonStatus']>>;
    try {
      status = await dm.getDaemonStatus();
    } catch {
      return null;
    }
    if (!status.running || !status.healthy || status.port == null || !status.bearerToken) {
      return null;
    }

    this._updateState({ status: 'checking' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(`http://127.0.0.1:${status.port}/daemon/session-health`, {
        headers: { Authorization: `Bearer ${status.bearerToken}` },
        signal: controller.signal,
      });

      // Old daemon without the endpoint — fall back to the fork path.
      if (resp.status === 404) return null;

      const now = new Date().toISOString();
      if (!resp.ok) {
        this._updateState({ status: 'expired', lastChecked: now, error: `HTTP ${resp.status}` });
        return this._state;
      }

      const result = await resp.json().catch(() => null) as
        { valid?: boolean; userId?: string | null; status?: number; error?: string } | null;

      if (result?.valid) {
        this._updateState({ status: 'valid', userId: result.userId ?? undefined, lastChecked: now, error: undefined });
      } else {
        this._updateState({
          status: 'expired',
          lastChecked: now,
          error: result?.error || (result?.status ? `HTTP ${result.status}` : 'Session invalid'),
        });
      }
      return this._state;
    } catch {
      // Daemon became unreachable mid-check — fall back rather than show an error.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Ask the daemon to close its shared browser so an interactive (headful)
   * login can open the persistent profile exclusively, or — from logout — so it
   * stops serving the session the user just destroyed.
   *
   * For LOGIN this is best-effort: a failure is covered by the login runner's own
   * exit-21 retry. For LOGOUT the outcome matters, so the result is reported
   * rather than swallowed: `released:false` means the daemon may still be holding
   * a live session and the caller must escalate (restart/force-stop) instead of
   * telling the user they are logged out.
   *
   * `released:true` means "confirmed nothing is holding a session" — either the
   * daemon answered 2xx, or there is no daemon to ask.
   */
  private async _releaseDaemonBrowser(): Promise<{ released: boolean; reason?: string }> {
    const dm = this._daemonManager;
    if (!dm || !getSettings().mcp.useDaemon) return { released: true };

    let status: Awaited<ReturnType<DaemonManager['getDaemonStatus']>>;
    try {
      status = await dm.getDaemonStatus();
    } catch (err) {
      // We cannot even tell whether a daemon is running — assume the worst.
      return { released: false, reason: err instanceof Error ? err.message : 'daemon status unavailable' };
    }
    if (!status.running) return { released: true };
    // Running but unreachable: `healthy` comes from a 2s HTTP probe, so a slow or
    // busy daemon lands here while still very much alive and serving.
    if (!status.healthy || status.port == null || !status.bearerToken) {
      return { released: false, reason: 'the daemon is running but did not answer its health probe' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`http://127.0.0.1:${status.port}/daemon/release-browser`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${status.bearerToken}` },
        signal: controller.signal,
      });
      if (!res.ok) return { released: false, reason: `release-browser returned HTTP ${res.status}` };
      return { released: true };
    } catch (err) {
      return { released: false, reason: err instanceof Error ? err.message : 'release-browser request failed' };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Login ───────────────────────────────────────────────────

  async login(): Promise<AuthState> {
    // byo / direct-login have no browser login: byo's cookie authenticates
    // directly and direct-login replays email/password/TOTP server-side. The
    // stored credentials ARE the login — validate them via checkSession()
    // (the daemon's direct-HTTP check) instead of launching Chrome.
    const mode = getSettings().mcp.authMode;
    if (mode === 'byo' || mode === 'direct-login') {
      const hasCreds = mode === 'byo' ? await this.hasCookie() : await this.hasCredentials();
      if (!hasCreds) {
        this._updateState({ status: 'error', error: 'No credentials saved.' });
        return this._state;
      }
      return this.checkSession();
    }

    const probe = this.refreshBrowserDetection();
    if (!probe.found) {
      this._updateState({
        status: 'chrome-missing',
        error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
      });
      return this._state;
    }

    const loginMode = this._getLoginMode();

    if (loginMode === 'auto') {
      const creds = await this.getCredentials();
      if (!creds) {
        this._updateState({ status: 'error', error: 'No credentials stored. Save credentials first.' });
        return this._state;
      }
      this._updateState({ status: 'logging-in' });
      // Free the profile: the daemon's shared browser must let go before the
      // login runner can open the same persistent profile.
      await this._releaseDaemonBrowser();
      try {
        // Credentials go over the IPC channel, never the child environment.
        const result = await this._spawnScript('login-runner.mjs', {
          ...this._browserEnv(), ...this._profileEnv(),
        }, undefined, creds);
        const now = new Date().toISOString();
        if (result.ok) {
          this._updateState({ status: 'valid', userId: result.userId || undefined, lastLogin: now, lastChecked: now, error: undefined });
          await this._applyPermissions();
        } else {
          this._updateState({ status: 'error', lastChecked: now, error: result.error || 'Login failed' });
        }
      } catch (err) {
        this._updateState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      return this.manualLogin();
    }

    return this._state;
  }

  async manualLogin(): Promise<AuthState> {
    // byo / direct-login never open a browser — route to the same credential
    // validation as login() (the cookie / stored creds ARE the login).
    const mode = getSettings().mcp.authMode;
    if (mode === 'byo' || mode === 'direct-login') {
      const hasCreds = mode === 'byo' ? await this.hasCookie() : await this.hasCredentials();
      if (!hasCreds) {
        this._updateState({ status: 'error', error: 'No credentials saved.' });
        return this._state;
      }
      return this.checkSession();
    }

    const probe = this.refreshBrowserDetection();
    if (!probe.found) {
      this._updateState({
        status: 'chrome-missing',
        error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
      });
      return this._state;
    }

    this._updateState({ status: 'logging-in' });
    // Free the profile: the daemon's shared browser must let go before the
    // login runner can open the same persistent profile.
    await this._releaseDaemonBrowser();

    try {
      const result = await this._spawnScript(
        'manual-login-runner.mjs',
        { ...this._browserEnv(), ...this._profileEnv() },
        330_000,
      );
      const now = new Date().toISOString();

      if (result.ok) {
        this._updateState({ status: 'valid', userId: result.userId || undefined, lastLogin: now, lastChecked: now, error: undefined });
        await this._applyPermissions();
      } else {
        this._updateState({ status: 'error', lastChecked: now, error: result.error || 'Login failed' });
      }
    } catch (err) {
      this._updateState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }

    return this._state;
  }

  // ─── Auto-Refresh Timer ──────────────────────────────────────

  startAutoRefresh(): void {
    this.stopAutoRefresh();
    const settings = getSettings();
    if (!settings.auth.autoRefresh) return;

    const intervalMs = settings.auth.refreshIntervalHours * 60 * 60 * 1000;
    this._timer = setInterval(() => {
      void this._autoRefreshCycle();
    }, intervalMs);

    // Run an initial check shortly after startup. Tracked so restartAutoRefresh()
    // can cancel it — prevents stacked Chromium launches when auth settings change.
    this._initCheckTimer = setTimeout(() => {
      this._initCheckTimer = undefined;
      void this._autoRefreshCycle();
    }, 10_000);
  }

  stopAutoRefresh(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    if (this._initCheckTimer) {
      clearTimeout(this._initCheckTimer);
      this._initCheckTimer = undefined;
    }
  }

  restartAutoRefresh(): void {
    this.startAutoRefresh();
  }

  // ─── Init ────────────────────────────────────────────────────

  async init(): Promise<void> {
    // Migration: set loginMode for pre-update installs
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    const inspected = cfg.inspect('auth.loginMode');
    const isUnset = !inspected?.globalValue && !inspected?.workspaceValue && !inspected?.workspaceFolderValue;
    if (isUnset) {
      const hasCreds = await this.hasCredentials();
      const mode = hasCreds ? 'auto' : 'manual';
      await cfg.update('auth.loginMode', mode, vscode.ConfigurationTarget.Global);
      console.log(`[AuthManager] Migrated loginMode to '${mode}' (hasCreds=${hasCreds})`);
    }

    const hasCreds = await this.hasCredentials();
    const hasCookie = await this.hasCookie();

    const mode = getSettings().mcp.authMode;
    if (mode === 'byo' || mode === 'direct-login') {
      // No browser in these modes — don't probe or flag 'chrome-missing'. Leave
      // status 'unknown'; the daemon check (via checkSession / auto-refresh)
      // verifies the session without launching Chrome.
      this._updateState({ hasCredentials: hasCreds, hasCookie });
    } else {
      const probe = this.refreshBrowserDetection();
      this._updateState({
        hasCredentials: hasCreds,
        hasCookie,
        ...(probe.found ? {} : { status: 'chrome-missing' as const }),
      });
    }

    await this._applyPermissions();
    this.startAutoRefresh();
  }

  // ─── Disposal ────────────────────────────────────────────────

  dispose(): void {
    this._disposed = true;
    this.stopAutoRefresh();
    this._downloadListener?.dispose();
    this._onDidChange.dispose();
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private async _autoRefreshCycle(): Promise<void> {
    if (this._disposed) return;
    if (this._state.status === 'logging-in' || this._state.status === 'checking') return;

    // Only browser mode needs a local browser to refresh; byo / direct-login
    // verify via the daemon's direct-HTTP check and must not be blocked here.
    const mode = getSettings().mcp.authMode;
    if (mode !== 'byo' && mode !== 'direct-login') {
      const probe = this.refreshBrowserDetection();
      if (!probe.found) return;
    }

    const state = await this.checkSession();

    if (state.status === 'expired') {
      const loginMode = this._getLoginMode();
      if (loginMode === 'auto') {
        const hasCreds = await this.hasCredentials();
        if (hasCreds) {
          console.log('[AuthManager] Session expired, attempting auto-login...');
          await this.login();
        }
      } else {
        const action = await vscode.window.showWarningMessage(
          'Airtable session expired.',
          'Re-login in Browser',
        );
        if (action === 'Re-login in Browser') {
          void this.manualLogin();
        }
      }
    }
  }

  private _isChromeLockError(error: string): boolean {
    return (
      error.includes('browserType.launchPersistentContext') ||
      error.includes('Target page, context or browser has been closed') ||
      error.includes('exit code 21')
    );
  }

  private async _clearChromeProfileLock(): Promise<void> {
    try {
      await unlink(path.join(PROFILE_DIR, 'Default', 'LOCK'));
      console.log('[AuthManager] Cleared stale Chrome profile lock');
    } catch {
      // File absent or already cleared — no action needed
    }
  }

  private _updateState(partial: Partial<AuthState>): void {
    this._state = { ...this._state, ...partial };
    this._onDidChange.fire(this._state);
  }

  /**
   * Spawn a bundled MCP helper script as a child process.
   * Returns parsed JSON from stdout.
   *
   * `credentials` are delivered over the fork() IPC channel on the child's
   * request — never via env, which is world-visible on Linux through
   * /proc/<pid>/environ and survives in core dumps.
   */
  private _spawnScript(
    scriptName: string,
    extraEnv?: Record<string, string>,
    timeoutMs = 120_000,
    credentials?: { email: string; password: string; otpSecret?: string },
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(this.extensionPath, 'dist', 'mcp', scriptName);
      const nodeModulesPath = path.join(this.extensionPath, 'dist', 'node_modules');

      const child = fork(scriptPath, [], {
        cwd: path.join(this.extensionPath, 'dist', 'mcp'),
        env: {
          ...process.env,
          NODE_PATH: nodeModulesPath,
          ...extraEnv,
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        execArgv: ['--experimental-vm-modules'],
      });

      if (credentials) {
        child.on('message', (msg: unknown) => {
          if ((msg as { type?: string } | null)?.type === 'request-credentials') {
            try {
              child.send({
                type: 'credentials',
                email: credentials.email,
                password: credentials.password,
                otpSecret: credentials.otpSecret ?? null,
              });
            } catch {
              // Child exited between request and reply — close handler reports it
            }
          }
        });
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        const raw = data.toString();
        const nonDebug = this._debugCollector
          ? processStderrChunk(raw, this._debugCollector)
          : raw;
        if (nonDebug.trim()) {
          stderr += nonDebug;
          console.error(`[${scriptName}]`, nonDebug.trim());
        }
      });

      let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        // If the process ignores SIGTERM (hung browser, native patchright
        // wait, etc.), escalate to SIGKILL so we don't leave a zombie.
        sigkillTimer = setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch { /* already gone */ }
        }, 5_000);
        reject(new Error(`${scriptName} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        try {
          // Parse the last line of stdout as JSON
          const lines = stdout.trim().split('\n').filter(Boolean);
          const lastLine = lines[lines.length - 1];
          if (lastLine) {
            resolve(JSON.parse(lastLine));
          } else {
            reject(new Error(`${scriptName} produced no output. stderr: ${stderr.substring(0, 500)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse ${scriptName} output: ${stdout.substring(0, 200)}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        reject(err);
      });
    });
  }
}
