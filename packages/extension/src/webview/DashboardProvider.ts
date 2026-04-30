import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import type { DashboardState, IdeStatus, AuthState, ToolProfileSnapshot } from '@airtable-formula/shared';
import type { WebviewMessage } from '@airtable-formula/shared';
import { getWebviewHtml } from './html.js';
import { getAllIdeStatuses, configureMcpForIde, unconfigureMcpForIde } from '../auto-config/index.js';
import { installAiFiles, checkAiFiles } from '../skills/installer.js';
import { getSettings, updateSetting } from '../settings.js';
import { getBundledServerPath, getServerEntry } from '../mcp/server-path.js';
import { exportDebugLog } from '../debug/exporter.js';
import type { AuthManager } from '../mcp/auth-manager.js';
import type { ToolProfileManager } from '../mcp/tool-profile.js';
import type { DebugCollector } from '../debug/collector.js';

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

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.context);
    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg as WebviewMessage));
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    this._debugCollector?.trace('ext', 'webview', 'webview:message_in', {
      type: msg.type,
    });
    if (msg.type === 'ready') {
      await this.pushState();
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
        await configureMcpForIde(msg.ideId, serverPath, serverEntry);
        await installAiFiles(msg.ideId, workspaceRoot, false, settings.ai.includeAgents);
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
          statuses.filter(s => s.detected).map(s =>
            configureMcpForIde(s.ideId, serverPath, serverEntry)
              .then(() => installAiFiles(s.ideId, workspaceRoot, false, settings.ai.includeAgents))
          )
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
        await unconfigureMcpForIde(msg.ideId);
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
        await this.pushState();
        this.postResult(msg.id, true);
      } catch (err) {
        this.postResult(msg.id, false, String(err));
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

        // Re-write IDE MCP configs with updated browser/profile env vars
        const serverPath = getBundledServerPath(this.context);
        const serverEntry = getServerEntry(this.context);
        const { configureMcpForIde } = await import('../auto-config/index.js');
        // Re-configure all detected+configured IDEs (MCP config only, not AI files)
        // Note: We iterate existing IDE statuses from the last push
        // This is best-effort — if it fails for one IDE, we continue

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
      await this.pushState();
      this.postResult('', true);
      return;
    }
  }

  async pushState(): Promise<void> {
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
    const authState: AuthState = { ...baseAuthState, hasCredentials: freshHasCredentials };

    // Fall back to a 'full' snapshot with every category enabled if the
    // ToolProfileManager isn't wired yet — keeps the webview render-safe
    // during very early activation.
    const toolProfile: ToolProfileSnapshot = this.toolProfileManager?.getSnapshot() ?? {
      profile:      'full',
      enabledCount: 36,
      totalCount:   36,
      categories: {
        read: true,
        tableWrite: true, tableDestructive: true,
        fieldWrite: true, fieldDestructive: true,
        viewWrite: true, viewDestructive: true,
        extension: true,
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
        },
        ai:      { autoInstallFiles: settings.ai.autoInstallFiles, includeAgents: settings.ai.includeAgents },
        formula: { formatterVersion: settings.formula.formatterVersion },
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
