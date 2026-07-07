import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import type { DashboardState, IdeStatus, AuthState, ToolProfileSnapshot, DaemonStatusInfo } from '@airtable-formula/shared';
import type { WebviewMessage } from '@airtable-formula/shared';
import { getWebviewHtml } from './html.js';
import { getAllIdeStatuses, configureMcpForIde, unconfigureMcpForIde, configureLspForIde, unconfigureLspForIde, configureOfficialAirtableMcp, unconfigureOfficialAirtableMcp, isOfficialAirtableConfigured } from '../auto-config/index.js';
import { IDE_CONFIGS } from '../auto-config/ide-configs.js';
import type { IdeId } from '@airtable-formula/shared';
import { installAiFiles, checkAiFiles } from '../skills/installer.js';
import { getSettings, updateSetting } from '../settings.js';
import { getBundledServerPath, getServerEntry } from '../mcp/server-path.js';
import { exportDebugLog } from '../debug/exporter.js';
import type { AuthManager } from '../mcp/auth-manager.js';
import type { ToolProfileManager } from '../mcp/tool-profile.js';
import type { DebugCollector } from '../debug/collector.js';
import type { DaemonManager } from '../mcp/daemon-manager.js';
import { BUILTIN_PROMPT_DEFS, BUILTIN_NAMES } from '../mcp/prompt-defs.js';

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'airtable-formula.dashboard';
  private view?: vscode.WebviewView;
  private authManager?: AuthManager;
  private toolProfileManager?: ToolProfileManager;
  private _debugCollector?: DebugCollector;
  private _storageCache?: { info: import('@airtable-formula/shared').StorageInfo; ts: number };

  constructor(private readonly context: vscode.ExtensionContext) {}

  setDebugCollector(collector: DebugCollector): void {
    this._debugCollector = collector;
  }

  setAuthManager(authManager: AuthManager): void {
    this.authManager = authManager;
    authManager.onDidChange(state => {
      this.view?.webview.postMessage({ type: 'auth:state', payload: state });
    });
  }

  setToolProfileManager(mgr: ToolProfileManager): void {
    this.toolProfileManager = mgr;
  }

  private _daemonManager?: DaemonManager;
  private _daemonStarting = false;
  private _lockfileWatcher?: import('fs').FSWatcher;
  /** Coalesces the burst of fs.watch events a single lockfile write emits into one reaction, so
   *  the cred-push / mcp-sync chain runs once per real change instead of N times per write. */
  private _lockfileDebounce?: ReturnType<typeof setTimeout>;
  private _mcpChanged?: vscode.EventEmitter<void>;
  /** Daemon HTTP port VS Code was last provisioned with. Lets us detect an EXTERNAL daemon
   *  restart (CLI/OS) onto a new ephemeral port and re-provision the MCP definition only then. */
  private _lastMcpPort: number | null | undefined = undefined;

  setDaemonManager(mgr: DaemonManager): void {
    this._daemonManager = mgr;
    void this._initLockfileWatch();
    // A daemon already running at activation (byo/direct-login) needs its creds delivered
    // without waiting for the dashboard to open. setAuthManager runs first, so authManager is set.
    void this._pushDaemonCredsIfNeeded();
  }

  /** The MCP-definitions change emitter — firing it makes VS Code re-provision the MCP servers,
   *  which respawns the stdio server with a fresh env (how authMode/httpClient take effect in
   *  no-daemon mode, where there is no daemon to restart). */
  setMcpChanged(emitter: vscode.EventEmitter<void>): void {
    this._mcpChanged = emitter;
  }

  private async _initLockfileWatch(): Promise<void> {
    const fsMod = await import('fs');
    const configDir = path.join(os.homedir(), '.airtable-user-mcp');
    try {
      this._lockfileWatcher?.close();
      clearTimeout(this._lockfileDebounce);
      this._lockfileWatcher = fsMod.watch(configDir, { persistent: false }, (_, filename) => {
        if (filename === 'daemon.lock') {
          // Debounce: one lockfile write fires several fs.watch events, and a restart writes it more
          // than once. Coalesce into a single reaction ~250ms after the burst settles so we don't
          // stampede the cred-push / mcp-sync chain (which each read daemon status) per raw event.
          clearTimeout(this._lockfileDebounce);
          this._lockfileDebounce = setTimeout(() => {
            void this.pushState();
            // Catch an EXTERNAL daemon restart onto a new port. Our own start/restart/stop handlers
            // already fire _mcpChanged, so skip while we are the one (re)starting. An external restart
            // also loses the daemon's in-memory creds — re-deliver them FIRST (push-then-sync), so the
            // daemon has creds before VS Code reconnects on the (possibly new) port.
            if (!this._daemonStarting) {
              void (async () => { await this._pushDaemonCredsIfNeeded(); await this._syncMcpDefinition(); })();
            }
          }, 250);
        }
      });
      this._lockfileWatcher.on('error', () => { /* transient FS errors — ignore */ });
    } catch { /* configDir doesn't exist yet — re-initialized after first daemon start */ }
    // Seed the last-known port WITHOUT firing, so _syncMcpDefinition only fires on a real change.
    try {
      const s = await this._daemonManager?.getDaemonStatus();
      this._lastMcpPort = s?.running ? (s.port ?? null) : null;
    } catch { /* best-effort */ }
  }

  /**
   * Re-provision the MCP server definition (registration.ts reads the live lockfile port) IFF the
   * daemon's HTTP port changed since VS Code last provisioned it — so an external daemon restart
   * onto a new ephemeral port is picked up instead of leaving VS Code on a stale URI. Records the
   * current port; best-effort (never throws).
   */
  private async _syncMcpDefinition(): Promise<void> {
    try {
      const s = await this._daemonManager?.getDaemonStatus();
      const port = s?.running ? (s.port ?? null) : null;
      if (port !== this._lastMcpPort) {
        this._lastMcpPort = port;
        this._mcpChanged?.fire();
      }
    } catch { /* best-effort */ }
  }

  /** Fire _mcpChanged for a KNOWN daemon lifecycle change (our start/restart/stop, authMode change),
   *  recording the current port so the detect-mode _syncMcpDefinition() does not then re-fire. */
  private async _fireMcpChanged(): Promise<void> {
    try { const s = await this._daemonManager?.getDaemonStatus(); this._lastMcpPort = s?.running ? (s.port ?? null) : null; }
    catch { /* best-effort — still fire below */ }
    this._mcpChanged?.fire();
  }

  /**
   * When running the daemon transport with a credential-based auth mode
   * (byo / direct-login), push the stored credentials to the running daemon
   * over its bearer-authenticated /daemon/auth-credentials endpoint. The daemon
   * deliberately gets no creds in its env or on disk — this endpoint is the ONLY
   * channel. Fully best-effort: every await is guarded and nothing throws to the
   * webview. No secret value is ever logged.
   */
  private async _pushDaemonCredsIfNeeded(): Promise<boolean> {
    try {
      const settings = getSettings();
      const authMode = settings.mcp.authMode;
      // Nothing to push in these cases — treat as success (true).
      if (!settings.mcp.useDaemon) return true;
      if (authMode !== 'byo' && authMode !== 'direct-login') return true;

      const dm = this._daemonManager;
      const am = this.authManager;
      if (!dm || !am) return true;

      // Only push to a daemon that is actually up AND healthy. Pushing to a still-starting daemon
      // is pointless, and — critically — must never itself cause a spawn: this runs from the
      // lockfile watcher, so a spawn here would rewrite the lockfile and re-fire the watcher.
      const status = await dm.getDaemonStatus();
      if (!status.running || !status.healthy) return true;

      if (authMode === 'byo') {
        const cookie = await am.getCookie();
        if (!cookie) return true;
        // CSRF is auto-scraped server-side from the cookie's session — not stored/sent here.
        // false ONLY when a real push failed.
        return await dm.pushAuthCredentials({ authMode, cookie });
      } else {
        // { ensureDaemon: false }: we already confirmed the daemon is healthy above; never let the
        // credential read spawn one (that is the runaway-loop trigger).
        const creds = await am.getCredentials({ ensureDaemon: false });
        if (!creds) return true;
        return await dm.pushAuthCredentials({
          authMode,
          email: creds.email,
          password: creds.password,
          ...(creds.otpSecret ? { totpSecret: creds.otpSecret } : {}),
        });
      }
    } catch (err) {
      // An unexpected throw means delivery could NOT be confirmed — report it as a failure so the
      // explicit-action callers (saveCookie/saveCredentials/authMode change) can warn the user. The
      // background callers (`void this._pushDaemonCredsIfNeeded()`) ignore the return, so this never
      // adds noise there. Log the error (message only — the secret payload is never logged, here or
      // in pushAuthCredentials) for diagnosis.
      console.warn('[DashboardProvider] credential push threw:', err instanceof Error ? err.message : 'unknown error');
      return false;
    }
  }

  /**
   * After the keychain credentials are cleared in a daemon + byo/direct-login
   * setup, the running daemon still holds the injected credentials in memory.
   * Restart it so it re-spawns creds-free — with the keychain now empty it has
   * nothing to load, so the stale in-memory copy is dropped. Fully best-effort:
   * every await is guarded and nothing throws to the webview.
   */
  private async _restartDaemonAfterCredClear(): Promise<void> {
    try {
      const settings = getSettings();
      const authMode = settings.mcp.authMode;
      if (!settings.mcp.useDaemon) return;
      if (authMode !== 'byo' && authMode !== 'direct-login') return;
      const dm = this._daemonManager;
      if (!dm) return;
      const status = await dm.getDaemonStatus();
      if (!status?.running) return;
      try {
        await dm.restartDaemon();
      } catch (restartErr) {
        // The daemon still holds the (now-cleared) creds in memory. A restart would
        // drop them but it failed — force-stop so the stale in-memory session dies.
        console.warn('[DashboardProvider] daemon restart after credential clear failed:', restartErr instanceof Error ? restartErr.message : 'unknown error');
        try {
          await dm.forceStop();
          vscode.window.showErrorMessage('Credentials were cleared from the keychain, but the running daemon could not be restarted to drop its in-memory session. It was force-stopped — restart it when ready.');
        } catch (stopErr) {
          console.warn('[DashboardProvider] daemon force-stop after failed restart also failed:', stopErr instanceof Error ? stopErr.message : 'unknown error');
          vscode.window.showErrorMessage('Credentials cleared, but the daemon may still hold your session in memory — stop/restart it manually to fully clear it.');
        }
      }
    } catch (err) {
      console.warn('[DashboardProvider] daemon restart after credential clear failed:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.context);
    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg as WebviewMessage));
    // Re-sync when the sidebar is re-opened — daemon/tunnel/auth state may
    // have changed while the view was hidden and no watcher fired since.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.pushState();
        // An externally-restarted daemon (CLI/OS) loses its in-memory creds and may be on a new
        // port — re-deliver creds FIRST, then re-provision the MCP def if the port changed, so the
        // daemon has creds before the definition is re-provisioned. Best-effort.
        void (async () => { await this._pushDaemonCredsIfNeeded(); await this._syncMcpDefinition(); })();
      }
    });
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    this._debugCollector?.trace('ext', 'webview', 'webview:message_in', {
      type: msg.type,
    });
    if (msg.type === 'ready') {
      await this.pushState();
      // An externally-restarted daemon (CLI/OS) loses its in-memory creds and may be on a new
      // port — re-deliver creds FIRST, then re-provision the MCP def if the port changed, so the
      // daemon has creds before the definition is re-provisioned. Best-effort.
      void (async () => { await this._pushDaemonCredsIfNeeded(); await this._syncMcpDefinition(); })();
      return;
    }
    if (msg.type === 'action:refresh') {
      await this.pushState();
      this.postResult(msg.id, true);
      return;
    }
    if (msg.type === 'action:setupIde') {
      try {
        const serverPath = getBundledServerPath(this.context);
        const serverEntry = getServerEntry(this.context);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        const settings = getSettings();
        const caps = IDE_CONFIGS[msg.ideId].capabilities;
        if (caps.includes('mcp')) await configureMcpForIde(msg.ideId, serverPath, serverEntry);
        if (caps.includes('lsp')) await configureLspForIde(msg.ideId);
        if (caps.includes('mcp')) await installAiFiles(msg.ideId, workspaceRoot, false, settings.ai.includeAgents);
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        vscode.window.showErrorMessage(`Setup failed for ${msg.ideId}: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:setupAll') {
      try {
        const serverPath = getBundledServerPath(this.context);
        const serverEntry = getServerEntry(this.context);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        const settings = getSettings();
        const statuses = await getAllIdeStatuses();
        await Promise.all(
          statuses.filter(s => s.detected).map(async s => {
            const caps = IDE_CONFIGS[s.ideId].capabilities;
            if (caps.includes('mcp')) await configureMcpForIde(s.ideId, serverPath, serverEntry);
            if (caps.includes('lsp')) await configureLspForIde(s.ideId);
            if (caps.includes('mcp')) await installAiFiles(s.ideId, workspaceRoot, false, settings.ai.includeAgents);
          })
        );
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:unconfigureIde') {
      try {
        const caps = IDE_CONFIGS[msg.ideId].capabilities;
        if (caps.includes('mcp')) await unconfigureMcpForIde(msg.ideId);
        if (caps.includes('lsp')) await unconfigureLspForIde(msg.ideId);
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        vscode.window.showErrorMessage(`Unconfigure failed for ${msg.ideId}: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:saveCredentials') {
      try {
        await this.authManager?.saveCredentials(msg.email, msg.password, msg.otpSecret || undefined);
        // If in a daemon + byo/direct-login setup, deliver the fresh creds to the
        // running daemon over its endpoint (never env/disk). Best-effort.
        const pushed = await this._pushDaemonCredsIfNeeded();
        await this.pushState();
        if (!pushed) {
          vscode.window.showWarningMessage('Credentials saved to the keychain, but the running daemon could not be updated — restart the daemon to apply them.');
        }
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'auth:saveCookie') {
      try {
        // No auth manager wired → nowhere to store the cookie; skip the success message.
        if (!this.authManager) return;
        // CSRF is auto-scraped server-side from the cookie's authed session, so it's not collected here.
        await this.authManager.saveCookie(msg.cookie);
        const pushed = await this._pushDaemonCredsIfNeeded();
        await this.pushState();
        if (!pushed) {
          // Cookie is safely in the keychain, but the running daemon didn't take it.
          vscode.window.showWarningMessage('Cookie saved to the keychain, but the running daemon could not be updated — restart the daemon to apply it.');
        } else {
          // Confirm the save — never echo the cookie value.
          vscode.window.showInformationMessage('Airtable session cookie saved to the keychain.');
        }
      } catch (err) {
        // Never surface the cookie — log only a concise, secret-free message + a user-facing error
        // (a silent failure would leave the "Not set" chip with no explanation).
        const m = err instanceof Error ? err.message : 'unknown error';
        console.warn('[DashboardProvider] saveCookie failed:', m);
        vscode.window.showErrorMessage(`Failed to save the Airtable cookie to the keychain: ${m}`);
      }
      return;
    }
    if (msg.type === 'auth:clearCookie') {
      if (!this.authManager) return;
      try {
        await this.authManager.clearCookie();
        // Drop the daemon's in-memory copy of the (now-cleared) cookie.
        await this._restartDaemonAfterCredClear();
      } catch (err) {
        // Never echo the cookie value — surface a concise, secret-free error.
        const m = err instanceof Error ? err.message : 'unknown error';
        console.warn('[DashboardProvider] clearCookie failed:', m);
        vscode.window.showErrorMessage(`Failed to clear the saved cookie: ${m}`);
      } finally {
        // Always refresh the UI so the chip reflects the real keychain state.
        await this.pushState();
      }
      return;
    }
    if (msg.type === 'action:login') {
      try {
        await this.authManager?.login();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:logout') {
      try {
        const confirm = await vscode.window.showWarningMessage(
          'This will clear your Airtable browser session and any stored credentials. You\'ll need to log in again.',
          { modal: true },
          'Logout',
        );
        if (confirm === 'Logout') {
          await this.authManager!.logout();
          // Logout clears the keychain — drop the daemon's in-memory creds too.
          await this._restartDaemonAfterCredClear();
          await this.pushState();
          this.postResult(msg.id, true);
        } else {
          // User dismissed the modal — surface that so the webview doesn't
          // flip into a "logged out" state on a no-op.
          this.postResult(msg.id, false, 'Cancelled');
        }
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:manualLogin') {
      try {
        await this.authManager!.manualLogin();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:status') {
      try {
        await this.authManager?.checkSession();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:install-browser') {
      try {
        await this.authManager?.downloadBrowser();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:removeBrowser') {
      try {
        await this.authManager?.removeDownloadedBrowser();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:openStoragePath') {
      try {
        await vscode.env.openExternal(vscode.Uri.file(msg.path));
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:openToolConfig') {
      try {
        await this.toolProfileManager?.openConfigFile();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:debug.startSession') {
      this._debugCollector?.startSession();
      await this.pushState();
      this.postResult(msg.id, true);
      return;
    }
    if (msg.type === 'action:debug.stopAndExport') {
      const session = this._debugCollector?.stopSession() ?? null;
      const extVersion = String((this.context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
      if (this._debugCollector) {
        const uri = await exportDebugLog(this._debugCollector, session, extVersion, getSettings().debug.bufferSize);
        if (uri) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        }
      }
      await this.pushState();
      this.postResult(msg.id, true);
      return;
    }
    if (msg.type === 'action:debug.export') {
      const extVersion = String((this.context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
      if (this._debugCollector) {
        const uri = await exportDebugLog(this._debugCollector, null, extVersion, getSettings().debug.bufferSize);
        if (uri) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        }
      }
      await this.pushState();
      this.postResult(msg.id, true);
      return;
    }
    if (msg.type === 'action:selectCustomBrowser') {
      try {
        const filters: Record<string, string[]> = process.platform === 'win32'
          ? { 'Executables': ['exe'] }
          : process.platform === 'darwin'
            ? { 'Applications': ['app'] }
            : {};

        const result = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters,
          title: 'Select a Chromium-based browser',
        });

        if (result?.[0]) {
          let execPath = result[0].fsPath;
          if (process.platform === 'darwin' && execPath.endsWith('.app')) {
            const appName = path.basename(execPath, '.app');
            execPath = path.join(execPath, 'Contents', 'MacOS', appName);
          }

          const base = path.basename(execPath).toLowerCase();
          const isChromium = ['chrome', 'chromium', 'edge', 'msedge', 'brave'].some(n => base.includes(n));
          if (!isChromium) {
            vscode.window.showWarningMessage('Only Chromium-based browsers are supported (Chrome, Edge, Chromium, Brave).');
          }

          const choice = { mode: 'custom' as const, executablePath: execPath, label: path.basename(execPath) };
          const cfg = vscode.workspace.getConfiguration('airtableFormula');
          await cfg.update('auth.browserChoice', choice, vscode.ConfigurationTarget.Global);
          this.authManager?.refreshBrowserDetection();
          await this.rewriteConfiguredIdeMcpEntries();
          await this.pushState();
        }
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:setBrowserChoice') {
      try {
        const cfg = vscode.workspace.getConfiguration('airtableFormula');
        await cfg.update('auth.browserChoice', msg.choice, vscode.ConfigurationTarget.Global);
        this.authManager?.refreshBrowserDetection();
        await this.rewriteConfiguredIdeMcpEntries();
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }
    if (msg.type === 'action:backupSession') {
      try {
        const { backupSession } = await import('../mcp/session-backup.js');
        const date = new Date().toISOString().slice(0, 10);
        const dest = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`airtable-session-backup-${date}.zip`),
          filters: { 'Zip Archives': ['zip'] },
        });
        if (!dest) { this.postResult(msg.id, true); return; }

        const password = await vscode.window.showInputBox({
          prompt: 'Enter a password to encrypt the backup (leave empty for unencrypted)',
          password: true,
        });

        await backupSession(dest.fsPath, password || undefined);
        vscode.window.showInformationMessage(`Session backed up to ${dest.fsPath}`);
        this.postResult(msg.id, true);
      } catch (err) {
        vscode.window.showErrorMessage(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:restoreSession') {
      try {
        const { restoreSession, isEncryptedFile } = await import('../mcp/session-backup.js');
        const files = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'Zip Archives': ['zip'] },
        });
        if (!files?.[0]) { this.postResult(msg.id, true); return; }

        const fileData = await (await import('fs/promises')).readFile(files[0].fsPath);
        let password: string | undefined;
        if (isEncryptedFile(fileData)) {
          password = await vscode.window.showInputBox({
            prompt: 'Enter the backup password',
            password: true,
          });
          if (password === undefined) { this.postResult(msg.id, true); return; }
        }

        const confirm = await vscode.window.showWarningMessage(
          'This will replace your current session data. Continue?',
          { modal: true },
          'Restore',
        );
        if (confirm !== 'Restore') { this.postResult(msg.id, true); return; }

        await restoreSession(files[0].fsPath, password);

        const { secureDirectory } = await import('../mcp/secure-permissions.js');
        const osMod = await import('os');
        const pathMod = await import('path');
        await secureDirectory(pathMod.join(osMod.homedir(), '.airtable-user-mcp'));
        await this.authManager?.checkSession();

        vscode.window.showInformationMessage('Session restored successfully');
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        vscode.window.showErrorMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'setting:change') {
      // Open external URL (used by footer links)
      if (msg.key === '_openUrl' && typeof msg.value === 'string') {
        vscode.env.openExternal(vscode.Uri.parse(msg.value));
        return;
      }
      // Route tool profile changes through the manager so it updates both
      // VS Code settings and the on-disk config atomically.
      if (msg.key === 'mcp.toolProfile' && this.toolProfileManager) {
        await this.toolProfileManager.setProfile(msg.value as any);
      } else if (msg.key.startsWith('mcp.categories.') && this.toolProfileManager) {
        const cat = msg.key.replace('mcp.categories.', '') as any;
        await this.toolProfileManager.toggleCategory(cat, msg.value as boolean);
      } else {
        await updateSetting(msg.key, msg.value);
      }
      // Restart auto-refresh if auth settings changed
      if (msg.key.startsWith('auth.')) {
        this.authManager?.restartAutoRefresh();
      }
      // Transport settings (authMode / httpClient) are injected into the daemon
      // env at spawn time (buildDaemonEnv), so a running daemon must be
      // restarted for the change to take effect.
      if (msg.key === 'mcp.authMode' || msg.key === 'mcp.httpClient') {
        const dm = this._daemonManager;
        if (dm) {
          void dm.getDaemonStatus().then(async status => {
            if (status?.running) {
              // Daemon mode: restart so the new AIRTABLE_AUTH_MODE/HTTP_CLIENT env re-injects.
              // Guard the lockfile watcher against our own restart so it does not double-fire
              // (cleared in finally); _fireMcpChanged records the port so the watcher's detect
              // path also finds no change.
              this._daemonStarting = true;
              try {
                await dm.restartDaemon();
                // Fresh daemon is creds-free in env by design — deliver byo/direct-login
                // creds over the endpoint so the new auth mode has what it needs.
                const pushed = await this._pushDaemonCredsIfNeeded();
                if (!pushed) {
                  void vscode.window.showWarningMessage('Auth mode changed and the daemon restarted, but its credentials could not be updated — restart the daemon to apply them.');
                }
                // The restart may have changed the port — re-query the definition provider
                // so VS Code rebuilds the HTTP URI from the current daemon.lock.
                await this._fireMcpChanged();
                await this.pushState();
              } catch (err) {
                vscode.window.showErrorMessage(`Daemon restart failed: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                this._daemonStarting = false;
              }
              return;
            }
            // No-daemon (stdio) mode: no daemon to restart — re-provision the MCP servers so VS Code
            // respawns the stdio server with the fresh env.
            await this._fireMcpChanged();
            await this.pushState();
          });
        } else {
          // No daemon manager wired → still re-provision for a stdio server.
          void this._fireMcpChanged();
        }
      }
      await this.pushState();
      // No postResult here — setting:change has no id field and the webview
      // does not register a pending action for it; posting action:result with
      // id:'' would break acknowledgement routing.
      return;
    }

    if (msg.type === 'tunnel:set-ngrok-authtoken') {
      try {
        await this.context.secrets.store('airtable-formula.ngrok.authtoken', msg.authtoken);
        this.postResult(msg.id, true);
      } catch (err) { this.postResult(msg.id, false, String(err)); }
      return;
    }

    if (msg.type === 'tunnel:enable') {
      try {
        const status = await this._daemonManager?.getDaemonStatus();
        if (!status?.running || !status.port || !status.bearerToken) {
          void vscode.window.showErrorMessage('Cannot enable tunnel: daemon is not running. Start the daemon first via the Setup tab.');
          this.postResult(msg.id, false, 'Daemon not running');
          return;
        }
        // For ngrok: store the authtoken when provided inline, then read it back from SecretStorage.
        // This ensures store-then-use is atomic within the same handler (fixes T-07-21 race condition).
        let authtoken: string | undefined = msg.authtoken;
        if (msg.provider === 'ngrok') {
          if (authtoken) {
            await this.context.secrets.store('airtable-formula.ngrok.authtoken', authtoken);
          } else {
            authtoken = await this.context.secrets.get('airtable-formula.ngrok.authtoken') ?? undefined;
          }
        }

        // cf-named with an explicit hostname: run named-create FIRST. The
        // daemon's enable-tunnel starts from the on-disk YAML, so without
        // this pre-step a changed hostname would be silently ignored and the
        // old one kept serving. named-create is idempotent for the same
        // hostname and reconfigures (route dns + YAML rewrite) for a new one.
        if (msg.provider === 'cf-named' && msg.domain) {
          try {
            const createResp = await fetch(`http://127.0.0.1:${status.port}/daemon/tunnel/named-create`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${status.bearerToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ hostname: msg.domain }),
              signal: AbortSignal.timeout(60_000),
            });
            if (!createResp.ok) {
              const b = await createResp.json().catch(() => ({})) as Record<string, unknown>;
              const createErr = typeof b.error === 'string' ? b.error : `HTTP ${createResp.status}`;
              if (/not installed|login required|cert/i.test(createErr)) {
                // First-time setup missing — fall through; enable-tunnel's
                // error path routes into the full setup wizard below.
              } else {
                // Real failure (e.g. DNS route rejected). Abort rather than
                // silently starting the tunnel on the previous hostname.
                void vscode.window.showErrorMessage(`Tunnel hostname configuration failed: ${createErr}`);
                this.postResult(msg.id, false, createErr);
                await this.pushState();
                return;
              }
            }
          } catch { /* daemon unreachable — the enable call below surfaces it */ }
        }

        const enableResp = await fetch(`http://127.0.0.1:${status.port}/daemon/enable-tunnel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${status.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider: msg.provider, authtoken, domain: msg.domain }),
        });

        if (!enableResp.ok) {
          const body = await enableResp.json().catch(() => ({})) as Record<string, unknown>;
          const errMsg = typeof body.error === 'string' ? body.error : `HTTP ${enableResp.status}`;
          const action = body.action as { kind?: string } | undefined;

          if (body.needsInstall === true) {
            // cloudflared binary missing — offer to auto-download, then retry
            const choice = await vscode.window.showErrorMessage(
              `Tunnel binary not found: ${errMsg}`,
              'Download cloudflared',
              'Cancel',
            );
            if (choice === 'Download cloudflared') {
              await this._installCloudflared(status, msg);
            } else {
              this.postResult(msg.id, false, errMsg);
            }
          } else if (msg.provider === 'cf-named' && (action?.kind === 'run-command' || action?.kind === 'cf-named-setup')) {
            // Named tunnel needs login and/or create — run the full setup flow then retry
            await this._ensureCfNamedSetup(status, msg);
          } else {
            void vscode.window.showErrorMessage(`Tunnel enable failed: ${errMsg}`);
            this.postResult(msg.id, false, errMsg);
          }
          await this.pushState();
          return;
        }

        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        void vscode.window.showErrorMessage(`Tunnel enable failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'tunnel:disable') {
      try {
        const status = await this._daemonManager?.getDaemonStatus();
        if (status?.running && status.port && status.bearerToken) {
          await fetch(`http://127.0.0.1:${status.port}/daemon/disable-tunnel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${status.bearerToken}` },
          });
        }
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) { this.postResult(msg.id, false, String(err)); }
      return;
    }

    if (msg.type === 'daemon:start' || msg.type === 'daemon:restart') {
      // Fire-and-forget: push a "starting" state immediately so the UI shows
      // feedback, then run ensureDaemon in the background (can take ~15s).
      this._daemonStarting = true;
      void this.pushState();
      const dm = this._daemonManager;
      if (dm) {
        this.postResult(msg.id, true);
        // Start = attach-if-healthy (idempotent, reuses a running daemon); Restart = force stop+respawn.
        // Previously both routed through restartDaemon(), so pressing Start killed a healthy
        // daemon and respawned it on a new port — the reported "forgets the running process" bug.
        (msg.type === 'daemon:restart' ? dm.restartDaemon() : dm.ensureDaemon())
          // A freshly (re)started daemon is spawned creds-free by design; in byo/direct-login
          // mode it needs the keychain creds delivered over its endpoint, or every tool call fails.
          // A (re)start with an ephemeral daemonPort (default 0) yields a NEW port —
          // fire mcpChanged so VS Code re-queries the definition provider and rebuilds
          // the HTTP URI from the current daemon.lock, instead of keeping the stale one.
          .then(async () => { this._daemonStarting = false; void this._initLockfileWatch(); await this._pushDaemonCredsIfNeeded(); await this._fireMcpChanged(); return this.pushState(); })
          .catch(err => {
            this._daemonStarting = false;
            vscode.window.showErrorMessage(`Daemon start failed: ${err instanceof Error ? err.message : String(err)}`);
            void this.pushState();
          });
      } else {
        this._daemonStarting = false;
        void this.pushState();
        this.postResult(msg.id, false, 'Daemon manager unavailable');
      }
      return;
    }

    if (msg.type === 'daemon:stop') {
      // Clear any in-flight (possibly stuck) start so the UI doesn't keep
      // showing "Starting…/running" after a Stop — that's what makes Stop look
      // like it did nothing / acted like a restart.
      this._daemonStarting = false;
      try {
        // forceStop: graceful stop + sweep of orphaned daemons / stray profile
        // browsers the lockfile can't see (otherwise "Stop" is a no-op when the
        // lock is missing and a browser keeps holding the profile).
        const result = await this._daemonManager?.forceStop();
        await this.pushState();
        if (result && !result.stopped) {
          const reason = result.reason ?? 'Daemon did not exit.';
          vscode.window.showErrorMessage(`Daemon stop failed: ${reason}`);
          this.postResult(msg.id, false, reason);
        } else {
          if (result?.reason) {
            // Stopped, but with a caveat (e.g. stale lock cleaned up) — inform, don't alarm.
            vscode.window.showInformationMessage(`Daemon stopped: ${result.reason}`);
          }
          // Re-query the definition provider so VS Code drops the now-dead HTTP URI.
          try { await this._fireMcpChanged(); } catch { /* best-effort */ }
          this.postResult(msg.id, true);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Daemon stop failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'daemon:copy-bearer-token') {
      // Token is read directly from the lockfile on the extension host — it
      // never enters the webview DOM (D-07, T-08-01).
      try {
        const fsMod = await import('fs');
        const lockPath = path.join(os.homedir(), '.airtable-user-mcp', 'daemon.lock');
        const raw = fsMod.readFileSync(lockPath, 'utf8');
        const lock = JSON.parse(raw) as Record<string, unknown>;
        const token = typeof lock.bearerToken === 'string' ? lock.bearerToken : null;
        if (!token) {
          void vscode.window.showErrorMessage('Bearer token not found — is the daemon running?');
          this.postResult(msg.id, false, 'Token not found');
          return;
        }
        await vscode.env.clipboard.writeText(token);
        void vscode.window.showInformationMessage('Bearer token copied to clipboard.');
        this.postResult(msg.id, true);
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not copy bearer token: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'daemon:rotate-token') {
      try {
        const status = await this._daemonManager?.getDaemonStatus();
        if (!status?.running || !status.port || !status.bearerToken) {
          void vscode.window.showErrorMessage('Cannot rotate token: daemon is not running.');
          this.postResult(msg.id, false, 'Daemon not running');
          return;
        }
        const resp = await fetch(`http://127.0.0.1:${status.port}/daemon/rotate-token`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${status.bearerToken}` },
        });
        if (!resp.ok) {
          void vscode.window.showErrorMessage(`Token rotation failed: HTTP ${resp.status}`);
          this.postResult(msg.id, false, `HTTP ${resp.status}`);
          return;
        }
        void vscode.window.showInformationMessage('Bearer token rotated. Use "Copy Token" to get the new value.');
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        void vscode.window.showErrorMessage(`Token rotation failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:save-airtable-pat') {
      try {
        if (msg.pat) {
          await this.context.secrets.store('airtable-formula.airtable.pat', msg.pat);
          void vscode.window.showInformationMessage('Airtable PAT saved securely.');
        } else {
          await this.context.secrets.delete('airtable-formula.airtable.pat');
        }
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:copy-airtable-pat') {
      try {
        const pat = await this.context.secrets.get('airtable-formula.airtable.pat');
        if (!pat) {
          void vscode.window.showErrorMessage('No Airtable PAT saved. Enter your token first.');
          this.postResult(msg.id, false, 'No PAT');
          return;
        }
        await vscode.env.clipboard.writeText(pat);
        void vscode.window.showInformationMessage('Airtable PAT copied to clipboard.');
        this.postResult(msg.id, true);
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not copy PAT: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:configure-official-airtable') {
      try {
        const pat = await this.context.secrets.get('airtable-formula.airtable.pat');
        if (!pat) {
          void vscode.window.showErrorMessage('No Airtable PAT saved. Enter your Personal Access Token first.');
          this.postResult(msg.id, false, 'No PAT');
          return;
        }
        await configureOfficialAirtableMcp(msg.ideId, pat);
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        void vscode.window.showErrorMessage(`Configure failed: ${err instanceof Error ? err.message : String(err)}`);
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:unconfigure-official-airtable') {
      try {
        await unconfigureOfficialAirtableMcp(msg.ideId);
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
      }
      return;
    }

    if (msg.type === 'action:save-prompt') {
      try {
        await this._writePromptConfig(cfg => {
          const { isBuiltin, isModified, ...def } = msg.prompt;
          if (isBuiltin || BUILTIN_NAMES.has(def.name)) {
            cfg.overrides = cfg.overrides ?? {};
            cfg.overrides[def.name] = def;
          } else {
            cfg.custom = cfg.custom ?? [];
            const idx = (cfg.custom as { name: string }[]).findIndex(p => p.name === def.name);
            if (idx >= 0) cfg.custom[idx] = def; else cfg.custom.push(def);
          }
        });
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) { this.postResult(msg.id, false, String(err)); }
      return;
    }

    if (msg.type === 'action:delete-prompt') {
      try {
        await this._writePromptConfig(cfg => {
          cfg.custom = ((cfg.custom ?? []) as { name: string }[]).filter(p => p.name !== msg.name);
        });
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) { this.postResult(msg.id, false, String(err)); }
      return;
    }

    if (msg.type === 'action:reset-prompt') {
      try {
        await this._writePromptConfig(cfg => {
          if (cfg.overrides) delete cfg.overrides[msg.name];
        });
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) { this.postResult(msg.id, false, String(err)); }
      return;
    }
  }

  // pushState is async and reads daemon.lock / settings from disk; concurrent
  // runs (e.g. several fs.watch events in a burst) can finish out of order and
  // post a STALE state:update last. Serialize: one run at a time, and coalesce
  // requests that arrive mid-run into a single trailing re-run.
  private _pushInFlight: Promise<void> | null = null;
  private _pushQueued = false;

  pushState(): Promise<void> {
    // The lockfile watcher fails silently when ~/.airtable-user-mcp doesn't
    // exist yet (cold start before any daemon spawn). Retry here — by the
    // time state changes are worth pushing, the daemon has created the dir.
    if (!this._lockfileWatcher && this._daemonManager) void this._initLockfileWatch();
    if (this._pushInFlight) {
      this._pushQueued = true;
      return this._pushInFlight;
    }
    this._pushInFlight = (async () => {
      try {
        do {
          this._pushQueued = false;
          await this._computeAndPostState();
        } while (this._pushQueued);
      } finally {
        this._pushInFlight = null;
      }
    })();
    return this._pushInFlight;
  }

  private async _computeAndPostState(): Promise<void> {
    if (!this.view) return;
    this._debugCollector?.trace('ext', 'webview', 'webview:message_out', {
      type: 'state:update',
    });
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const settings = getSettings();
    const ideStatuses = await getAllIdeStatuses();

    const enriched: IdeStatus[] = await Promise.all(
      ideStatuses.map(async s => ({
        ...s,
        aiFiles: s.detected ? await checkAiFiles(s.ideId, workspaceRoot) : s.aiFiles,
      }))
    );

    // Always query SecretStorage fresh for hasCredentials — the AuthManager's
    // cached _state starts as { hasCredentials: false } and is only updated
    // when init() finishes. If pushState runs before init() completes (which
    // happens on cold starts with the dashboard pinned), the cached state
    // reports stale hasCredentials. Querying directly avoids that race.
    const baseAuthState: AuthState = this.authManager?.state ?? { status: 'unknown', hasCredentials: false };
    const freshHasCredentials = this.authManager ? await this.authManager.hasCredentials() : false;
    const freshHasCookie = this.authManager ? await this.authManager.hasCookie() : false;
    const authState: AuthState = { ...baseAuthState, hasCredentials: freshHasCredentials, hasCookie: freshHasCookie };

    // Fall back to a 'full' snapshot with every category enabled if the
    // ToolProfileManager isn't wired yet — keeps the webview render-safe
    // during very early activation.
    const toolProfile: ToolProfileSnapshot = this.toolProfileManager?.getSnapshot() ?? {
      profile:      'full',
      enabledCount: 66,
      totalCount:   66,
      categories: {
        read: true,                 recordRead: true,
        tableWrite: true,           tableDestructive: true,
        fieldWrite: true,           fieldDestructive: true,
        recordDestructive: true,    viewWrite: true,
        viewDestructive: true,      viewSection: true,
        viewSectionDestructive: true, formWrite: true,
        recordWrite: true,          extension: true,
        sync: true,
      },
    };

    const mcpServerBundled = await this.readBundledMcpVersion();
    const mcpServerPublished = await this.checkPublishedVersion(mcpServerBundled);
    const storage = await this._computeStorageInfo();

    const debugState = this._debugCollector ? {
      enabled: this._debugCollector.enabled,
      sessionActive: this._debugCollector.isSessionActive,
      eventCount: this._debugCollector.eventCount,
      bufferCapacity: getSettings().debug.bufferSize,
      verboseHttp: getSettings().debug.verboseHttp,
    } : undefined;

    const state: DashboardState = {
      ideStatuses: enriched,
      versions: {
        extension: this.getExtensionVersion(),
        mcpServerBundled,
        mcpServerPublished,
      },
      aiFilesCount: enriched.reduce((n, s) => n + Object.values(s.aiFiles).filter(v => v === 'ok').length, 0),
      loading: false,
      settings: {
        mcp:     {
          autoConfigureOnInstall: settings.mcp.autoConfigureOnInstall,
          notifyOnUpdates:        settings.mcp.notifyOnUpdates,
          toolProfile,
          serverSource:           settings.mcp.serverSource,
          daemonPort:             settings.mcp.daemonPort,
          authMode:               settings.mcp.authMode,
          httpClient:             settings.mcp.httpClient,
        },
        ai:      { autoInstallFiles: settings.ai.autoInstallFiles, includeAgents: settings.ai.includeAgents },
        formula: { formatterVersion: settings.formula.formatterVersion },
        script:  { beautifyStyle: settings.script.beautifyStyle, minifyLevel: settings.script.minifyLevel },
        auth:    {
          autoRefresh: settings.auth.autoRefresh,
          refreshIntervalHours: settings.auth.refreshIntervalHours,
          loginMode: settings.auth.loginMode,
          browserChoice: settings.auth.browserChoice,
        },
        debug:   { enabled: settings.debug.enabled, verboseHttp: settings.debug.verboseHttp, bufferSize: settings.debug.bufferSize },
      },
      auth: authState,
      debug: debugState,
      storage,
      tunnel:          await this._computeTunnelState(),
      daemon:          await this._computeDaemonStatusInfo(),
      officialAirtable: await this._computeOfficialAirtableState(),
      prompts:          await this._computePromptsState(),
    };

    this.view.webview.postMessage({ type: 'state:update', payload: state });
  }

  private async _computeStorageInfo(): Promise<import('@airtable-formula/shared').StorageInfo> {
    const now = Date.now();
    if (this._storageCache && now - this._storageCache.ts < 60_000) {
      return this._storageCache.info;
    }

    const fsP = await import('fs/promises');
    const pathMod = await import('path');
    const osMod = await import('os');

    const configDir = pathMod.join(osMod.homedir(), '.airtable-user-mcp');
    const profileDir = pathMod.join(configDir, '.chrome-profile');
    const toolConfig = pathMod.join(configDir, 'tools-config.json');

    const entries: import('@airtable-formula/shared').StorageEntry[] = [];

    entries.push(await this._storageEntry('Browser Profile', profileDir, fsP));
    entries.push(await this._storageEntry('Tool Config', toolConfig, fsP));

    // Bundled Chromium (if applicable)
    if (this.authManager) {
      const dlMgr = (this.authManager as any)._downloadManager;
      if (dlMgr) {
        const storageDir: string = dlMgr.getStorageDir();
        entries.push(await this._storageEntry('Bundled Chromium', storageDir, fsP));
      }
    }

    const info = { entries };
    this._storageCache = { info, ts: now };
    return info;
  }

  private async _storageEntry(label: string, itemPath: string, fsP: typeof import('fs/promises')): Promise<import('@airtable-formula/shared').StorageEntry> {
    try {
      const stat = await fsP.stat(itemPath);
      let sizeBytes: number;
      if (stat.isDirectory()) {
        sizeBytes = await this._dirSize(itemPath, fsP);
      } else {
        sizeBytes = stat.size;
      }
      return { label, path: itemPath, sizeBytes, exists: true };
    } catch {
      return { label, path: itemPath, exists: false };
    }
  }

  private async _dirSize(dirPath: string, fsP: typeof import('fs/promises')): Promise<number> {
    let total = 0;
    try {
      const pathMod = await import('path');
      const entries = await fsP.readdir(dirPath, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          try {
            const p = pathMod.join(entry.parentPath ?? entry.path, entry.name);
            const s = await fsP.stat(p);
            total += s.size;
          } catch {
            // skip
          }
        }
      }
    } catch {
      // empty or inaccessible
    }
    return total;
  }

  private async _computeTunnelState(): Promise<import('@airtable-formula/shared').TunnelState | undefined> {
    try {
      const pathMod = await import('path');
      const osMod = await import('os');
      const fsMod = await import('fs');
      const configDir = pathMod.join(osMod.homedir(), '.airtable-user-mcp');
      const settingsPath = pathMod.join(configDir, 'tunnel-settings.json');
      const lockPath = pathMod.join(configDir, 'daemon.lock');

      // Read tunnel-settings.json for provider + enabled state
      let provider: import('@airtable-formula/shared').TunnelProviderId = 'cf-quick';
      let enabled = false;
      let autoDisabled = false;
      let autoDisabledReason: import('@airtable-formula/shared').TunnelAutoDisabledReason | null = null;
      if (fsMod.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fsMod.readFileSync(settingsPath, 'utf8'));
          if (['cf-quick', 'ngrok', 'cf-named'].includes(settings.provider)) {
            provider = settings.provider;
          }
          enabled = settings.enabled === true;
          autoDisabled = settings.autoDisabled === true;
          if (autoDisabled && settings.autoDisabledReason && typeof settings.autoDisabledReason.failures === 'number') {
            autoDisabledReason = {
              failures: settings.autoDisabledReason.failures,
              windowMs: typeof settings.autoDisabledReason.windowMs === 'number' ? settings.autoDisabledReason.windowMs : 0,
              ip: typeof settings.autoDisabledReason.ip === 'string' ? settings.autoDisabledReason.ip : null,
            };
          }
        } catch { /* use defaults */ }
      }

      // Read lockfile for tunnelUrl
      let tunnelUrl: string | null = null;
      if (fsMod.existsSync(lockPath)) {
        try {
          const lock = JSON.parse(fsMod.readFileSync(lockPath, 'utf8'));
          tunnelUrl = typeof lock.tunnelUrl === 'string' ? lock.tunnelUrl : null;
        } catch { /* no tunnelUrl */ }
      }

      // Check SecretStorage for ngrok authtoken
      const ngrokAuthtokenSet = !!(await this.context.secrets.get('airtable-formula.ngrok.authtoken'));

      // Read the named-tunnel hostname from cloudflared-named.yml (written by
      // the daemon's writeTunnelConfig — fixed mechanical format, same
      // `- hostname:` extraction as the daemon's parseConfigYaml).
      let namedTunnelHostname: string | null = null;
      const namedConfigPath = pathMod.join(configDir, 'cloudflared-named.yml');
      if (fsMod.existsSync(namedConfigPath)) {
        try {
          const rawYaml = fsMod.readFileSync(namedConfigPath, 'utf8');
          for (const line of rawYaml.split(/\r?\n/)) {
            const m = line.trim().match(/^- hostname:\s*(.+)$/u);
            if (m) {
              const value = m[1].trim();
              namedTunnelHostname = value.startsWith('"') && value.endsWith('"')
                ? value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                : value;
              break;
            }
          }
        } catch { /* unreadable — treat as not configured */ }
      }

      // Determine TunnelStatus
      let status: import('@airtable-formula/shared').TunnelStatus = 'disabled';
      if (tunnelUrl) {
        status = 'active';
      } else if (!enabled && autoDisabled) {
        status = 'auto-disabled'; // 401-burst auto-disable: show warning banner
      } else if (enabled) {
        status = 'starting'; // enabled but no URL yet — may be starting
      }

      return {
        status,
        url: tunnelUrl,
        provider,
        ngrokAuthtokenSet,
        autoDisabledReason,
        namedTunnelHostname,
      };
    } catch {
      return undefined;
    }
  }

  private async _computeDaemonStatusInfo(): Promise<DaemonStatusInfo | undefined> {
    try {
      const status = await this._daemonManager?.getDaemonStatus();
      if (!status?.running) {
        // Surface "starting" indicator so the webview can show progress feedback
        // while ensureDaemon polls in the background.
        if (this._daemonStarting) {
          return { running: false, healthy: false, port: null, port_lsp: null, tunnelUrl: null, uptime: null, starting: true };
        }
        // Explicit "stopped" object, NOT undefined: undefined is dropped during
        // webview message serialization, so the store's spread keeps the stale
        // "Running" card. A concrete value overwrites it → the UI shows Stopped.
        return { running: false, healthy: false, port: null, port_lsp: null, tunnelUrl: null, uptime: null, starting: false };
      }
      return {
        running:   status.running,
        healthy:   status.healthy,
        port:      status.port,
        port_lsp:  status.port_lsp,
        tunnelUrl: status.tunnelUrl,
        uptime:    status.uptime,
        starting:  this._daemonStarting,
        // bearerToken intentionally excluded (D-07, T-08-01)
        // pid intentionally excluded (T-08-02)
      };
    } catch {
      return undefined;
    }
  }

  private async _computeOfficialAirtableState(): Promise<import('@airtable-formula/shared').OfficialAirtableMcpState> {
    const patSet = !!(await this.context.secrets.get('airtable-formula.airtable.pat'));
    const ideIds = Object.keys(IDE_CONFIGS) as IdeId[];
    const results = await Promise.all(ideIds.map(async ideId => ({
      ideId,
      configured: await isOfficialAirtableConfigured(ideId),
    })));
    const ideConfigured: Partial<Record<IdeId, boolean>> = {};
    for (const { ideId, configured } of results) {
      ideConfigured[ideId] = configured;
    }
    return { patSet, ideConfigured };
  }

  private async _computePromptsState(): Promise<import('@airtable-formula/shared').PromptsState> {
    const configPath = path.join(os.homedir(), '.airtable-user-mcp', 'prompts.json');
    let userConfig: { overrides?: Record<string, { name: string; description: string; arguments: import('@airtable-formula/shared').PromptArg[]; template: string }>; custom?: import('@airtable-formula/shared').PromptDef[] } = {};
    try {
      const raw = await (await import('fs/promises')).readFile(configPath, 'utf8');
      userConfig = JSON.parse(raw);
    } catch { /* no config yet */ }

    const prompts: import('@airtable-formula/shared').PromptDef[] = BUILTIN_PROMPT_DEFS.map(p => {
      const override = userConfig.overrides?.[p.name];
      return override
        ? { ...override, isBuiltin: true, isModified: true }
        : { ...p, isBuiltin: true, isModified: false };
    });

    for (const c of (userConfig.custom ?? [])) {
      prompts.push({ ...c, isBuiltin: false, isModified: false });
    }

    return { prompts };
  }

  private async _writePromptConfig(mutate: (cfg: { overrides: Record<string, unknown>; custom: unknown[] }) => void): Promise<void> {
    const configPath = path.join(os.homedir(), '.airtable-user-mcp', 'prompts.json');
    const fsP = await import('fs/promises');
    let cfg: { overrides: Record<string, unknown>; custom: unknown[] } = { overrides: {}, custom: [] };
    try {
      const raw = await fsP.readFile(configPath, 'utf8');
      cfg = JSON.parse(raw);
      if (!cfg.overrides) { cfg.overrides = {}; }
      if (!cfg.custom) { cfg.custom = []; }
    } catch { /* no config yet */ }
    mutate(cfg);
    await fsP.mkdir(path.dirname(configPath), { recursive: true });
    const data = JSON.stringify(cfg, null, 2) + '\n';
    const tmp = configPath + '.tmp';
    try {
      await fsP.writeFile(tmp, data, 'utf8');
      await fsP.rename(tmp, configPath);
    } catch (err) {
      await fsP.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  private async _installCloudflared(
    daemonStatus: import('../mcp/daemon-manager.js').DaemonStatus,
    originalMsg: Extract<import('@airtable-formula/shared').WebviewMessage, { type: 'tunnel:enable' }>,
  ): Promise<void> {
    const serverPath = path.join(this.context.extensionPath, 'dist', 'mcp', 'index.mjs');
    const configDir = path.join(os.homedir(), '.airtable-user-mcp');

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Downloading cloudflared binary…', cancellable: false },
      async () => {
        const { spawn } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [serverPath, 'daemon', 'install-tunnel'], {
            stdio: 'ignore',
            env: { ...process.env, AIRTABLE_USER_MCP_HOME: configDir },
          });
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`install-tunnel exited ${code}`)));
          child.on('error', reject);
        });
      },
    );

    // Retry enabling the tunnel now that the binary is present
    const retryResp = await fetch(`http://127.0.0.1:${daemonStatus.port}/daemon/enable-tunnel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemonStatus.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: originalMsg.provider, domain: originalMsg.domain }),
    }).catch(() => null);

    if (!retryResp?.ok) {
      const body = await retryResp?.json().catch(() => ({})) as Record<string, unknown>;
      void vscode.window.showErrorMessage(`Tunnel enable failed after install: ${body.error ?? retryResp?.status}`);
      this.postResult(originalMsg.id, false, String(body.error ?? retryResp?.status));
    } else {
      this.postResult(originalMsg.id, true);
    }
    await this.pushState();
  }

  private async _ensureCfNamedSetup(
    daemonStatus: import('../mcp/daemon-manager.js').DaemonStatus,
    originalMsg: Extract<import('@airtable-formula/shared').WebviewMessage, { type: 'tunnel:enable' }>,
  ): Promise<void> {
    const port = daemonStatus.port!;
    const token = daemonStatus.bearerToken!;
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Cloudflare Named Tunnel Setup', cancellable: false },
        async (progress) => {
          // Step 1: Login (no-op if cert already present)
          progress.report({ message: 'Authenticating with Cloudflare… (complete login in browser if prompted)' });
          const loginResp = await fetch(`${base}/daemon/tunnel/named-login`, {
            method: 'POST', headers,
            signal: AbortSignal.timeout(11 * 60 * 1000),
          });
          if (!loginResp.ok) {
            const b = await loginResp.json().catch(() => ({})) as Record<string, unknown>;
            throw new Error(`Cloudflare login failed: ${b.error ?? loginResp.status}`);
          }

          // Step 2: Create tunnel (no-op if already configured)
          let hostname = originalMsg.domain;
          if (!hostname) {
            // Last-resort prompt — the Setup tab has a Hostname field, but the
            // flow can also be reached from commands that never showed it.
            hostname = await vscode.window.showInputBox({
              title: 'Cloudflare Named Tunnel',
              prompt: 'Hostname for the tunnel — a domain you manage in Cloudflare',
              placeHolder: 'mcp.your-domain.com',
              ignoreFocusOut: true,
              validateInput: (v) => (v.trim().length === 0 ? 'Hostname is required for first-time setup' : undefined),
            });
            hostname = hostname?.trim() || undefined;
          }
          if (!hostname) throw new Error('Named tunnel requires a hostname (domain). Enter it in the Hostname field under the tunnel provider in the Setup tab.');
          progress.report({ message: `Creating tunnel for ${hostname}…` });
          const createResp = await fetch(`${base}/daemon/tunnel/named-create`, {
            method: 'POST', headers,
            body: JSON.stringify({ hostname }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!createResp.ok) {
            const b = await createResp.json().catch(() => ({})) as Record<string, unknown>;
            throw new Error(`Tunnel creation failed: ${b.error ?? createResp.status}`);
          }

          // Step 3: Retry enable-tunnel now that setup is complete — with the
          // RESOLVED hostname (originalMsg.domain may have been empty).
          progress.report({ message: 'Starting tunnel…' });
          const enableResp = await fetch(`${base}/daemon/enable-tunnel`, {
            method: 'POST', headers,
            body: JSON.stringify({ provider: originalMsg.provider, domain: hostname }),
            signal: AbortSignal.timeout(90_000),
          });
          if (!enableResp.ok) {
            const b = await enableResp.json().catch(() => ({})) as Record<string, unknown>;
            throw new Error(typeof b.error === 'string' ? b.error : `HTTP ${enableResp.status}`);
          }
        },
      );
      this.postResult(originalMsg.id, true);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Named tunnel setup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.postResult(originalMsg.id, false, String(err));
    }
  }

  async disableTunnel(): Promise<void> {
    const status = await this._daemonManager?.getDaemonStatus();
    if (status?.running && status.port && status.bearerToken) {
      await fetch(`http://127.0.0.1:${status.port}/daemon/disable-tunnel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${status.bearerToken}` },
      }).catch(() => undefined);
    }
    await this.pushState();
  }

  // Re-writes the MCP entry in every IDE that already has one, so env changes
  // (browserChoice, serverSource, profile dir) propagate immediately instead
  // of going stale until the user next runs Setup for that IDE.
  private async rewriteConfiguredIdeMcpEntries(): Promise<void> {
    const serverPath = getBundledServerPath(this.context);
    const serverEntry = getServerEntry(this.context);
    const statuses = await getAllIdeStatuses();
    await Promise.all(
      statuses
        .filter(s => s.mcpConfigured)
        .map(async s => {
          try {
            await configureMcpForIde(s.ideId, serverPath, serverEntry);
          } catch (err) {
            this._debugCollector?.trace('ext', 'error', 'mcp_config:rewrite_failed', { ideId: s.ideId }, String(err));
            console.error(`[airtable-formula] Failed to re-apply MCP config for ${s.ideId}:`, err);
          }
        }),
    );
  }

  private postResult(id: string, ok: boolean, error?: string): void {
    this.view?.webview.postMessage({ type: 'action:result', id, ok, error });
  }

  private async readBundledMcpVersion(): Promise<string> {
    try {
      const uri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mcp', 'version.json');
      const bytes = await vscode.workspace.fs.readFile(uri);
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      return typeof manifest.mcpServer === 'string' ? manifest.mcpServer : 'unknown';
    } catch (err) {
      this._debugCollector?.trace('ext', 'error', 'mcp_version:read_failed', {}, String(err));
      console.error('[airtable-formula] Failed to read MCP version manifest', err);
      return 'unknown';
    }
  }

  private getExtensionVersion(): string {
    return (this.context.extension.packageJSON as { version?: string }).version ?? 'unknown';
  }

  private async checkPublishedVersion(bundledVersion: string): Promise<string | undefined> {
    try {
      const lastCheck = this.context.globalState.get<number>('npmVersionCheckTimestamp', 0);
      const now = Date.now();
      if (now - lastCheck < 24 * 60 * 60 * 1000) {
        return this.context.globalState.get<string>('npmVersionCheckResult');
      }
      const resp = await fetch('https://registry.npmjs.org/airtable-user-mcp');
      if (!resp.ok) return undefined;
      const data = (await resp.json()) as { 'dist-tags'?: { latest?: string } };
      const latest = data?.['dist-tags']?.latest;
      await this.context.globalState.update('npmVersionCheckTimestamp', now);
      await this.context.globalState.update('npmVersionCheckResult', latest);
      if (latest && this.isNewerVersion(latest, bundledVersion)) return latest;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private isNewerVersion(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true;
      if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
  }

  async refresh(): Promise<void> { await this.pushState(); }
}
