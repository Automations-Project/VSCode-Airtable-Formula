import * as vscode from 'vscode';
import * as path from 'path';
import { fork } from 'child_process';
import type { AuthState, BrowserDownloadState } from '@airtable-formula/shared';
import { getSettings } from '../settings.js';
import { detectBrowser, type BrowserProbe } from './browser-detect.js';
import type { BrowserDownloadManager } from './browser-download.js';
import { processStderrChunk } from '../debug/stderr-parser.js';
import type { DebugCollector } from '../debug/collector.js';

const SECRET_PREFIX = 'airtableFormula';
const SECRET_EMAIL      = `${SECRET_PREFIX}.email`;
const SECRET_PASSWORD   = `${SECRET_PREFIX}.password`;
const SECRET_OTP_SECRET = `${SECRET_PREFIX}.otpSecret`;

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

  private _state: AuthState = { status: 'unknown', hasCredentials: false };
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _disposed = false;
  private _browser: BrowserProbe = { found: false };
  private _downloadManager?: BrowserDownloadManager;
  private _downloadListener?: vscode.Disposable;
  private _debugCollector?: DebugCollector;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly extensionPath: string,
  ) {}

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
    this._browser = detectBrowser(downloadedPath);
    this._updateState({
      browser: {
        found:      this._browser.found,
        channel:    this._browser.channel,
        label:      this._browser.label,
        downloaded: this._browser.downloaded,
      },
    });
    return this._browser;
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

  async clearCredentials(): Promise<void> {
    await this.secrets.delete(SECRET_EMAIL);
    await this.secrets.delete(SECRET_PASSWORD);
    await this.secrets.delete(SECRET_OTP_SECRET);
    this._updateState({ status: 'unknown', hasCredentials: false, userId: undefined, error: undefined });
  }

  async hasCredentials(): Promise<boolean> {
    const email = await this.getEmail();
    const password = await this.getPassword();
    return !!(email && password);
  }

  /**
   * Get credentials as env vars for passing to child processes.
   * Returns undefined if no credentials are stored.
   */
  async getCredentialsEnv(): Promise<Record<string, string> | undefined> {
    const email = await this.getEmail();
    const password = await this.getPassword();
    if (!email || !password) return undefined;

    const env: Record<string, string> = {
      AIRTABLE_EMAIL: email,
      AIRTABLE_PASSWORD: password,
    };
    const otp = await this.getOtpSecret();
    if (otp) env.AIRTABLE_OTP_SECRET = otp;
    return env;
  }

  // ─── Health Check ────────────────────────────────────────────

  async checkSession(): Promise<AuthState> {
    // Preflight — no point spawning the child process if no browser exists
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
      const result = await this._spawnScript('health-check.mjs', this._browserEnv());
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

  // ─── Login ───────────────────────────────────────────────────

  async login(): Promise<AuthState> {
    // Preflight — need a browser before we even check credentials
    const probe = this.refreshBrowserDetection();
    if (!probe.found) {
      this._updateState({
        status: 'chrome-missing',
        error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
      });
      return this._state;
    }

    const creds = await this.getCredentialsEnv();
    if (!creds) {
      this._updateState({ status: 'error', error: 'No credentials stored. Save credentials first.' });
      return this._state;
    }

    this._updateState({ status: 'logging-in' });

    try {
      const result = await this._spawnScript('login-runner.mjs', { ...creds, ...this._browserEnv() });
      const now = new Date().toISOString();

      if (result.ok) {
        this._updateState({
          status: 'valid',
          userId: result.userId || undefined,
          lastLogin: now,
          lastChecked: now,
          error: undefined,
        });
      } else {
        this._updateState({
          status: 'error',
          lastChecked: now,
          error: result.error || 'Login failed',
        });
      }
    } catch (err) {
      this._updateState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
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

    // Also run a check shortly after startup (10s delay)
    setTimeout(() => {
      void this._autoRefreshCycle();
    }, 10_000);
  }

  stopAutoRefresh(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  restartAutoRefresh(): void {
    this.startAutoRefresh();
  }

  // ─── Init ────────────────────────────────────────────────────

  async init(): Promise<void> {
    const hasCreds = await this.hasCredentials();
    const probe = this.refreshBrowserDetection();
    this._updateState({
      hasCredentials: hasCreds,
      // If no browser is installed, reflect that immediately so the UI can
      // prompt the user rather than waiting for their first login attempt.
      ...(probe.found ? {} : { status: 'chrome-missing' as const }),
    });
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

    // Skip auto-refresh entirely if we already know no browser is available —
    // re-probe first in case the user just installed Chrome mid-session.
    const probe = this.refreshBrowserDetection();
    if (!probe.found) return;

    const state = await this.checkSession();

    // If session expired and we have credentials, attempt re-login
    if (state.status === 'expired') {
      const hasCreds = await this.hasCredentials();
      if (hasCreds) {
        console.log('[AuthManager] Session expired, attempting auto-login...');
        await this.login();
      }
    }
  }

  private _updateState(partial: Partial<AuthState>): void {
    this._state = { ...this._state, ...partial };
    this._onDidChange.fire(this._state);
  }

  /**
   * Spawn a bundled MCP helper script as a child process.
   * Returns parsed JSON from stdout.
   */
  private _spawnScript(scriptName: string, extraEnv?: Record<string, string>): Promise<any> {
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

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${scriptName} timed out after 120s`));
      }, 120_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
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
        reject(err);
      });
    });
  }
}
