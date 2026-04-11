import * as vscode from 'vscode';
import * as os from 'os';
import type { DashboardState, IdeStatus, AuthState, ToolProfileSnapshot } from '@airtable-formula/shared';
import type { WebviewMessage } from '@airtable-formula/shared';
import { getWebviewHtml } from './html.js';
import { getAllIdeStatuses, configureMcpForIde } from '../auto-config/index.js';
import { installAiFiles, checkAiFiles } from '../skills/installer.js';
import { getSettings, updateSetting } from '../settings.js';
import { getBundledServerPath } from '../mcp/server-path.js';
import type { AuthManager } from '../mcp/auth-manager.js';
import type { ToolProfileManager } from '../mcp/tool-profile.js';

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'airtable-formula.dashboard';
  private view?: vscode.WebviewView;
  private authManager?: AuthManager;
  private toolProfileManager?: ToolProfileManager;

  constructor(private readonly context: vscode.ExtensionContext) {}

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
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        const settings = getSettings();
        await configureMcpForIde(msg.ideId, serverPath);
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
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        const settings = getSettings();
        const statuses = await getAllIdeStatuses();
        await Promise.all(
          statuses.filter(s => s.detected).map(s =>
            configureMcpForIde(s.ideId, serverPath)
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
        await this.authManager?.clearCredentials();
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
    if (msg.type === 'action:openToolConfig') {
      try {
        await this.toolProfileManager?.openConfigFile();
        this.postResult(msg.id, true);
      } catch (err) {
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
      enabledCount: 32,
      totalCount:   32,
      categories: {
        read: true, fieldWrite: true, fieldDestructive: true,
        viewWrite: true, viewDestructive: true, extension: true,
      },
    };

    const mcpServerBundled = await this.readBundledMcpVersion();
    const mcpServerPublished = await this.checkPublishedVersion(mcpServerBundled);

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
        },
        ai:      { autoInstallFiles: settings.ai.autoInstallFiles, includeAgents: settings.ai.includeAgents },
        formula: { formatterVersion: settings.formula.formatterVersion },
        auth:    { autoRefresh: settings.auth.autoRefresh, refreshIntervalHours: settings.auth.refreshIntervalHours },
      },
      auth: authState,
    };

    this.view.webview.postMessage({ type: 'state:update', payload: state });
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
