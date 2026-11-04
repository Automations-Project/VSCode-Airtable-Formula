import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => {
  const configValues = new Map<string, unknown>();
  const update = vi.fn(async (key: string, value: unknown) => {
    configValues.set(key, value);
  });
  const uri = (value: string) => ({
    fsPath: value,
    path: value.replaceAll('\\', '/'),
    scheme: value.startsWith('https://') ? 'https' : 'file',
    authority: value.startsWith('https://') ? new URL(value).host : '',
    toString: () => value,
  });
  return {
    configValues,
    update,
    uri,
    openExternal: vi.fn(async () => true),
    showOpenDialog: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    postMessage: vi.fn(async () => true),
  };
});

vi.mock('vscode', () => ({
  Uri: {
    parse: vi.fn((value: string) => vscodeMock.uri(value)),
    file: vi.fn((value: string) => vscodeMock.uri(value)),
    joinPath: vi.fn((base: { fsPath: string }, ...parts: string[]) => (
      vscodeMock.uri([base.fsPath, ...parts].join('/'))
    )),
  },
  env: {
    openExternal: vscodeMock.openExternal,
    clipboard: { writeText: vi.fn() },
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: vi.fn(() => ({
      get: (key: string, fallback: unknown) => vscodeMock.configValues.get(key) ?? fallback,
      update: vscodeMock.update,
    })),
    fs: {
      readFile: vi.fn(async () => new TextEncoder().encode(
        JSON.stringify({ mcpServer: '9.9.9' }),
      )),
    },
    openTextDocument: vi.fn(),
  },
  window: {
    showOpenDialog: vscodeMock.showOpenDialog,
    showSaveDialog: vi.fn(),
    showInputBox: vi.fn(),
    showWarningMessage: vscodeMock.showWarningMessage,
    showErrorMessage: vscodeMock.showErrorMessage,
    showInformationMessage: vscodeMock.showInformationMessage,
    showTextDocument: vi.fn(),
    withProgress: vi.fn(),
  },
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { Notification: 15 },
}));

const dependencies = vi.hoisted(() => ({
  getAllIdeStatuses: vi.fn(async () => []),
  configureMcpForIde: vi.fn(async () => undefined),
  updateWebviewSetting: vi.fn(async () => undefined),
  detectAllBrowsers: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(async () => []),
}));

vi.mock('../auto-config/index.js', () => ({
  getAllIdeStatuses: dependencies.getAllIdeStatuses,
  configureMcpForIde: dependencies.configureMcpForIde,
  unconfigureMcpForIde: vi.fn(),
  configureLspForIde: vi.fn(),
  unconfigureLspForIde: vi.fn(),
  configureOfficialAirtableMcp: vi.fn(),
  unconfigureOfficialAirtableMcp: vi.fn(),
  isOfficialAirtableConfigured: vi.fn(),
}));
vi.mock('../auto-config/ide-configs.js', () => ({ IDE_CONFIGS: {} }));
vi.mock('../skills/installer.js', () => ({ installAiFiles: vi.fn(), checkAiFiles: vi.fn() }));
vi.mock('../settings.js', () => ({
  getSettings: () => ({
    mcp: {
      autoConfigureOnInstall: true,
      notifyOnUpdates: true,
      serverSource: 'bundled',
      useDaemon: true,
      daemonPort: 8723,
      authMode: 'browser',
      httpClient: 'fetch',
      browserIdleParkMinutes: 30,
    },
    ai: { autoInstallFiles: true, includeAgents: false },
    formula: { formatterVersion: 'v2' },
    script: { beautifyStyle: 'default', minifyLevel: 'standard' },
    auth: {
      autoRefresh: true,
      refreshIntervalHours: 12,
      loginMode: 'manual',
      browserChoice: { mode: 'auto' },
    },
    debug: { enabled: true, bufferSize: 1000, verboseHttp: false },
  }),
  updateSetting: dependencies.updateWebviewSetting,
  updateWebviewSetting: dependencies.updateWebviewSetting,
}));
vi.mock('../mcp/browser-detect.js', () => ({
  detectAllBrowsers: dependencies.detectAllBrowsers,
}));
vi.mock('../mcp/server-path.js', () => ({
  getBundledServerPath: vi.fn(() => '/extension/dist/mcp/server.cjs'),
  getServerEntry: vi.fn(() => '/extension/dist/mcp/server.cjs'),
}));
vi.mock('../debug/exporter.js', () => ({ exportDebugLog: vi.fn() }));
vi.mock('../mcp/prompt-defs.js', () => ({
  BUILTIN_PROMPT_DEFS: [],
  BUILTIN_NAMES: new Set<string>(),
}));
vi.mock('../webview/html.js', () => ({ getWebviewHtml: vi.fn(() => '<html></html>') }));
vi.mock('fs/promises', () => ({
  stat: dependencies.stat,
  readdir: dependencies.readdir,
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as vscode from 'vscode';
import { parseExtensionMessage } from '@airtable-formula/shared';
import { DashboardProvider } from '../webview/DashboardProvider.js';

type InboundMessage = (input: unknown) => void;

const makeContext = () => ({
  extensionUri: vscodeMock.uri('/extension'),
  extensionPath: '/extension',
  globalStorageUri: vscodeMock.uri('/host/global-storage'),
  extension: { packageJSON: { version: '9.9.9' } },
  globalState: {
    get: vi.fn((key: string, fallback?: unknown) => (
      key === 'npmVersionCheckTimestamp' ? Date.now() : fallback
    )),
    update: vi.fn(),
  },
  secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
}) as any;

const mountProvider = () => {
  let inboundMessage: InboundMessage = () => {
    throw new Error('webview listener was not registered');
  };
  const view = {
    visible: true,
    webview: {
      options: {},
      html: '',
      postMessage: vscodeMock.postMessage,
      onDidReceiveMessage: vi.fn((listener: InboundMessage) => {
        inboundMessage = listener;
        return { dispose: vi.fn() };
      }),
    },
    onDidChangeVisibility: vi.fn(),
  } as any;
  const provider = new DashboardProvider(makeContext());
  provider.resolveWebviewView(view);
  return {
    provider,
    view,
    inboundMessage: (input: unknown) => inboundMessage(input),
  };
};

const waitForResult = async (id: string) => {
  await vi.waitFor(() => {
    expect(vscodeMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'action:result', id }),
    );
  });
};

describe('DashboardProvider webview trust boundary', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.configValues.clear();
    dependencies.stat.mockImplementation(async (itemPath: string) => ({
      isDirectory: () => itemPath.endsWith('.chrome-profile') || itemPath.endsWith('chromium'),
      size: 12,
    }));
    dependencies.detectAllBrowsers.mockReturnValue([
      {
        found: true,
        id: 'chrome',
        channel: 'chrome',
        executablePath: '/host/chrome',
        label: 'Google Chrome',
      },
    ]);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('drops a malformed message before dispatching a side effect', async () => {
    const { provider, inboundMessage } = mountProvider();
    const debugCollector = { trace: vi.fn() };
    provider.setDebugCollector(debugCollector as any);

    inboundMessage({
      type: 'action:openStoragePath',
      id: 'abc123',
      path: 'C:\\Windows\\System32',
    });

    await vi.waitFor(() => {
      expect(vscode.env.openExternal).not.toHaveBeenCalled();
      expect(debugCollector.trace).toHaveBeenCalledWith(
        'ext',
        'webview',
        'webview:message_rejected',
        expect.objectContaining({ type: 'action:openStoragePath' }),
      );
    });
  });

  it('rejects an unknown link ID at the registered parser boundary', async () => {
    const { provider, inboundMessage } = mountProvider();
    const debugCollector = { trace: vi.fn() };
    provider.setDebugCollector(debugCollector as any);

    inboundMessage({ type: 'action:openLink', id: 'abc123', link: 'evil' });

    await vi.waitFor(() => {
      expect(vscode.env.openExternal).not.toHaveBeenCalled();
      expect(debugCollector.trace).toHaveBeenCalledWith(
        'ext',
        'webview',
        'webview:message_rejected',
        expect.objectContaining({ type: 'action:openLink' }),
      );
    });
  });

  it('maps docs to the fixed Marketplace URL', async () => {
    const { inboundMessage } = mountProvider();

    inboundMessage({
      type: 'action:openLink',
      id: 'abc123',
      link: 'docs',
    });

    await vi.waitFor(() => {
      expect(vscode.env.openExternal).toHaveBeenCalledWith(
        expect.objectContaining({
          scheme: 'https',
          authority: 'marketplace.visualstudio.com',
        }),
      );
    });
  });

  it.each([
    ['cursor', 'https://cursor.com/download'],
    ['windsurf', 'https://windsurf.com/download'],
    ['windsurf-next', 'https://windsurf.com/download'],
    ['claude-code', 'https://docs.claude.com/en/docs/claude-code/quickstart'],
    ['claude-desktop', 'https://claude.ai/download'],
    ['cline', 'https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev'],
    ['amp', 'https://ampcode.com/'],
    ['opencode', 'https://opencode.ai'],
    ['codex-cli', 'https://github.com/openai/codex'],
    ['zed', 'https://zed.dev/download'],
    ['helix', 'https://helix-editor.com'],
    ['neovim', 'https://neovim.io'],
  ] as const)('maps %s docs to the fixed host URL', async (ideId, expected) => {
    const { inboundMessage } = mountProvider();

    inboundMessage({ type: 'action:openIdeDocs', id: 'abc123', ideId });

    await vi.waitFor(() => {
      expect(vscode.env.openExternal).toHaveBeenCalledWith(
        expect.objectContaining({ scheme: 'https', toString: expect.any(Function) }),
      );
      expect((vscodeMock.openExternal.mock.calls[0][0] as { toString(): string }).toString()).toBe(expected);
    });
  });

  it.each([
    ['browser-profile', '.chrome-profile'],
    ['tool-config', 'tools-config.json'],
    ['bundled-chromium', '/downloaded/chromium'],
  ] as const)('resolves %s from a freshly computed host inventory', async (entryId, suffix) => {
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      getBrowserStorageDir: () => '/downloaded/chromium',
    } as any);

    inboundMessage({ type: 'action:openStoragePath', id: 'abc123', entryId });

    await waitForResult('abc123');
    const opened = vscodeMock.openExternal.mock.calls[0][0] as { fsPath: string };
    expect(opened.fsPath).toContain(suffix);
    expect(dependencies.stat).toHaveBeenCalled();
  });

  it('does not open a stale storage ID whose latest inventory entry is absent', async () => {
    dependencies.stat.mockRejectedValue(new Error('gone'));
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      getBrowserStorageDir: () => '/downloaded/chromium',
    } as any);

    inboundMessage({
      type: 'action:openStoragePath',
      id: 'abc123',
      entryId: 'browser-profile',
    });

    await waitForResult('abc123');
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(vscodeMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abc123', ok: false }),
    );
  });

  it('strips every host path from the storage snapshot sent to the webview', async () => {
    const { provider } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      getBrowserStorageDir: () => '/downloaded/chromium',
    } as any);

    const info = await (provider as any)._computeStorageInfo();

    expect(info.entries).toEqual([
      expect.objectContaining({ id: 'browser-profile', exists: true }),
      expect.objectContaining({ id: 'tool-config', exists: true }),
      expect.objectContaining({ id: 'bundled-chromium', exists: true }),
    ]);
    expect(JSON.stringify(info)).not.toContain('.chrome-profile');
    expect(JSON.stringify(info)).not.toContain('tools-config.json');
    expect(JSON.stringify(info)).not.toContain('/downloaded/chromium');
  });

  it('resolves a detected browser ID against the latest host detection result', async () => {
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      refreshBrowserDetection: vi.fn(),
      getDownloadedBrowserExecutablePath: vi.fn(),
    } as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({
      type: 'action:setBrowserChoice',
      id: 'abc123',
      choice: { mode: 'detected', browserId: 'chrome' },
    });

    await waitForResult('abc123');
    expect(dependencies.detectAllBrowsers).toHaveBeenCalled();
    expect(vscodeMock.update).toHaveBeenCalledWith(
      'auth.browserChoice',
      {
        mode: 'custom',
        channel: 'chrome',
        executablePath: '/host/chrome',
        label: 'Google Chrome',
        detectedId: 'chrome',
      },
      1,
    );
  });

  it('does not persist a stale detected browser ID', async () => {
    dependencies.detectAllBrowsers.mockReturnValue([]);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({
      type: 'action:setBrowserChoice',
      id: 'abc123',
      choice: { mode: 'detected', browserId: 'chrome' },
    });

    await waitForResult('abc123');
    expect(vscodeMock.update).not.toHaveBeenCalled();
    expect(vscodeMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abc123', ok: false }),
    );
  });

  it.each([
    ['win32', 'C:\\Browsers\\chrome.exe', 'chrome'],
    ['win32', 'C:\\Browsers\\msedge.exe', 'msedge'],
    ['win32', 'C:\\Browsers\\chromium.exe', 'chromium'],
    ['win32', 'C:\\Browsers\\brave.exe', 'chromium'],
    ['linux', '/opt/google-chrome-stable', 'chrome'],
    ['linux', '/opt/google/chrome/chrome', 'chrome'],
    ['linux', '/opt/microsoft-edge-stable', 'msedge'],
    ['linux', '/opt/microsoft/msedge/msedge', 'msedge'],
    ['linux', '/opt/chromium-browser', 'chromium'],
    ['linux', '/opt/brave-browser', 'chromium'],
  ] as const)(
    'accepts exact %s Chromium-family executable %s',
    async (platform, executablePath, channel) => {
      Object.defineProperty(process, 'platform', { value: platform });
      vscodeMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: executablePath }]);
      const { provider, inboundMessage } = mountProvider();
      vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

      inboundMessage({ type: 'action:selectCustomBrowser', id: 'pickok1' });

      await waitForResult('pickok1');
      expect(vscodeMock.update).toHaveBeenCalledWith(
        'auth.browserChoice',
        expect.objectContaining({
          mode: 'custom',
          channel,
          executablePath,
        }),
        1,
      );
    },
  );

  it.each([
    ['Google Chrome.app', 'Google Chrome', 'chrome'],
    ['Microsoft Edge.app', 'Microsoft Edge', 'msedge'],
    ['Chromium.app', 'Chromium', 'chromium'],
    ['Brave Browser.app', 'Brave Browser', 'chromium'],
  ] as const)(
    'accepts the exact macOS %s bundle layout',
    async (bundleName, executableName, channel) => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vscodeMock.showOpenDialog.mockResolvedValueOnce([
        { fsPath: `/Applications/${bundleName}` },
      ]);
      const { provider, inboundMessage } = mountProvider();
      vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

      inboundMessage({ type: 'action:selectCustomBrowser', id: 'macok01' });

      await waitForResult('macok01');
      expect(vscodeMock.update).toHaveBeenCalledWith(
        'auth.browserChoice',
        expect.objectContaining({
          mode: 'custom',
          channel,
          executablePath: expect.stringMatching(
            new RegExp(
              `${bundleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]Contents[\\\\/]MacOS[\\\\/]${executableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            ),
          ),
        }),
        1,
      );
    },
  );

  it.each([
    ['win32', 'C:\\Temp\\chrome-helper.exe'],
    ['win32', 'C:\\Temp\\fake-chromium.exe'],
    ['win32', 'C:\\Temp\\msedge-old.exe'],
    ['win32', 'C:\\Temp\\brave-browser.exe.bak'],
    ['linux', '/tmp/google-chrome-wrapper'],
    ['linux', '/tmp/chromium-helper'],
    ['linux', '/tmp/microsoft-edge-old'],
    ['linux', '/tmp/brave-browser-wrapper'],
    ['linux', '/tmp/constructor'],
    ['linux', '/tmp/toString'],
    ['darwin', '/Applications/Google Chrome Helper.app'],
    ['darwin', '/tmp/Google Chrome'],
    ['darwin', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper'],
  ] as const)(
    'rejects deceptive %s near-match %s',
    async (platform, executablePath) => {
      Object.defineProperty(process, 'platform', { value: platform });
      vscodeMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: executablePath }]);
      const { provider, inboundMessage } = mountProvider();
      vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

      inboundMessage({ type: 'action:selectCustomBrowser', id: 'badpick' });

      await waitForResult('badpick');
      expect(vscodeMock.update).not.toHaveBeenCalled();
      expect(vscodeMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'badpick',
          ok: false,
          error: 'Unsupported browser executable',
        }),
      );
    },
  );

  it('writes no custom path when the picker returns a non-browser executable', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vscodeMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/host/firefox' }]);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:selectCustomBrowser', id: 'badpick' });

    await waitForResult('badpick');
    expect(vscodeMock.update).not.toHaveBeenCalled();
  });

  it('posts matching setting results only after persistence, side effects, and pushed state', async () => {
    const order: string[] = [];
    dependencies.updateWebviewSetting.mockImplementationOnce(async () => { order.push('persist'); });
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      restartAutoRefresh: vi.fn(() => { order.push('effect'); }),
    } as any);
    vi.spyOn(provider, 'pushState').mockImplementation(async () => { order.push('state'); });
    vscodeMock.postMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'action:result') order.push('result');
      return true;
    });

    inboundMessage({
      type: 'setting:change',
      id: 'setting1',
      change: { key: 'auth.autoRefresh', value: false },
    });

    await waitForResult('setting1');
    expect(order).toEqual(['persist', 'effect', 'state', 'result']);
    const result = {
      type: 'action:result',
      id: 'setting1',
      ok: true,
    };
    expect(vscodeMock.postMessage).toHaveBeenCalledWith(result);
    expect(parseExtensionMessage(result)).toEqual({ ok: true, value: result });
  });

  it('posts a matching failed setting result when persistence fails', async () => {
    dependencies.updateWebviewSetting.mockRejectedValueOnce(new Error('persistence failed'));
    const { inboundMessage } = mountProvider();

    inboundMessage({
      type: 'setting:change',
      id: 'setting2',
      change: { key: 'auth.loginMode', value: 'auto' },
    });

    await waitForResult('setting2');
    expect(vscodeMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'action:result',
        id: 'setting2',
        ok: false,
        error: expect.stringContaining('persistence failed'),
      }),
    );
  });

  it('keeps mcp.useDaemon snapshot-only and rejects it before configuration', async () => {
    const { provider, inboundMessage } = mountProvider();
    const debugCollector = { trace: vi.fn() };
    provider.setDebugCollector(debugCollector as any);

    inboundMessage({
      type: 'setting:change',
      id: 'readonly1',
      change: { key: 'mcp.useDaemon', value: false },
    });

    await vi.waitFor(() => {
      expect(debugCollector.trace).toHaveBeenCalledWith(
        'ext',
        'webview',
        'webview:message_rejected',
        expect.objectContaining({ type: 'setting:change' }),
      );
    });
    expect(dependencies.updateWebviewSetting).not.toHaveBeenCalled();
    expect(vscodeMock.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'readonly1', ok: true }),
    );
  });

  it('routes tool profiles and categories only through ToolProfileManager', async () => {
    const { provider, inboundMessage } = mountProvider();
    const manager = {
      setProfile: vi.fn(async () => undefined),
      toggleCategory: vi.fn(async () => undefined),
    };
    provider.setToolProfileManager(manager as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({
      type: 'setting:change',
      id: 'profile',
      change: { key: 'mcp.toolProfile', value: 'read-only' },
    });
    inboundMessage({
      type: 'setting:change',
      id: 'category',
      change: { key: 'mcp.category', category: 'read', value: false },
    });

    await waitForResult('profile');
    await waitForResult('category');
    expect(manager.setProfile).toHaveBeenCalledWith('read-only');
    expect(manager.toggleCategory).toHaveBeenCalledWith('read', false);
    expect(dependencies.updateWebviewSetting).not.toHaveBeenCalled();
  });

  it('persists daemonPort without an automatic restart', async () => {
    const { provider, inboundMessage } = mountProvider();
    const applyEffect = vi.spyOn(provider, 'applyConfigurationSideEffect');
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({
      type: 'setting:change',
      id: 'port01',
      change: { key: 'mcp.daemonPort', value: 9000 },
    });

    await waitForResult('port01');
    expect(dependencies.updateWebviewSetting).toHaveBeenCalledWith({
      key: 'mcp.daemonPort',
      value: 9000,
    });
    expect(applyEffect).not.toHaveBeenCalled();
  });

  it('single-flights duplicate webview and configuration-event effects by key for one tick', async () => {
    let release!: () => void;
    const effect = new Promise<void>(resolve => { release = resolve; });
    const { provider } = mountProvider();
    const restartAutoRefresh = vi.fn(() => effect);
    provider.setAuthManager({ onDidChange: vi.fn(), restartAutoRefresh } as any);

    const first = provider.applyConfigurationSideEffect('auth.autoRefresh');
    const duplicate = provider.applyConfigurationSideEffect('auth.autoRefresh');
    release();
    await Promise.all([first, duplicate]);

    expect(restartAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('retains a completed setting effect until the next event-loop tick', async () => {
    const { provider } = mountProvider();
    const restartAutoRefresh = vi.fn();
    provider.setAuthManager({ onDidChange: vi.fn(), restartAutoRefresh } as any);

    await provider.applyConfigurationSideEffect('auth.autoRefresh');
    await provider.applyConfigurationSideEffect('auth.autoRefresh');
    expect(restartAutoRefresh).toHaveBeenCalledTimes(1);

    await new Promise(resolve => setTimeout(resolve, 0));
    await provider.applyConfigurationSideEffect('auth.autoRefresh');
    expect(restartAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('single-flights the daemon restart shared by webview and configuration events', async () => {
    const { provider } = mountProvider();
    const daemonManager = {
      getDaemonStatus: vi.fn(async () => ({
        running: true,
        healthy: true,
        port: 8723,
        bearerToken: 'host-only',
      })),
      restartDaemon: vi.fn(async () => undefined),
    };
    (provider as any)._daemonManager = daemonManager;
    (provider as any)._mcpChanged = { fire: vi.fn() };

    await Promise.all([
      provider.applyConfigurationSideEffect('mcp.authMode'),
      provider.applyConfigurationSideEffect('mcp.authMode'),
    ]);

    expect(daemonManager.restartDaemon).toHaveBeenCalledTimes(1);
  });

  it('rejects a transport effect when restarted-daemon credentials were not delivered', async () => {
    const { provider } = mountProvider();
    const daemonManager = {
      getDaemonStatus: vi.fn(async () => ({
        running: true,
        healthy: true,
        port: 8723,
        bearerToken: 'host-only',
      })),
      restartDaemon: vi.fn(async () => undefined),
    };
    (provider as any)._daemonManager = daemonManager;
    (provider as any)._mcpChanged = { fire: vi.fn() };
    (provider as any)._pushDaemonCredsIfNeeded = vi.fn(async () => false);

    await expect(
      provider.applyConfigurationSideEffect('mcp.authMode'),
    ).rejects.toThrow('credentials could not be updated');
  });

  it('single-flights the IDE rewrite shared by webview and configuration events', async () => {
    dependencies.getAllIdeStatuses.mockResolvedValueOnce([
      { ideId: 'cursor', mcpConfigured: true },
    ]);
    const { provider } = mountProvider();

    await Promise.all([
      provider.applyConfigurationSideEffect('mcp.serverSource'),
      provider.applyConfigurationSideEffect('mcp.serverSource'),
    ]);

    expect(dependencies.configureMcpForIde).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['action:delete-prompt', 'Delete prompt "custom-one"?', 'Delete'],
    ['action:reset-prompt', 'Reset prompt "custom-one" to its built-in definition?', 'Reset'],
  ] as const)('uses a native modal before %s mutation', async (type, copy, button) => {
    vscodeMock.showWarningMessage.mockResolvedValueOnce(button);
    const { provider, inboundMessage } = mountProvider();
    const mutate = vi.spyOn(provider as any, '_writePromptConfig').mockResolvedValue(undefined);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type, id: 'prompt1', name: 'custom-one' });

    await waitForResult('prompt1');
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(copy, { modal: true }, button);
    expect(vscodeMock.showWarningMessage.mock.invocationCallOrder[0])
      .toBeLessThan(mutate.mock.invocationCallOrder[0]);
  });

  it.each(['action:delete-prompt', 'action:reset-prompt'] as const)(
    'posts explicit cancellation for %s',
    async type => {
      vscodeMock.showWarningMessage.mockResolvedValueOnce(undefined);
      const { provider, inboundMessage } = mountProvider();
      const mutate = vi.spyOn(provider as any, '_writePromptConfig').mockResolvedValue(undefined);

      inboundMessage({ type, id: 'prompt2', name: 'custom-one' });

      await waitForResult('prompt2');
      expect(mutate).not.toHaveBeenCalled();
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({
        type: 'action:result',
        id: 'prompt2',
        ok: false,
        error: 'Cancelled',
        cancelled: true,
      });
    },
  );

  it('uses fixed host copy for unsaved-prompt confirmation and returns the native choice', async () => {
    vscodeMock.showWarningMessage.mockResolvedValueOnce('Discard');
    const { inboundMessage } = mountProvider();

    inboundMessage({
      type: 'confirmation:request',
      id: 'confirm1',
      kind: 'discard-prompt-edits',
    });

    await vi.waitFor(() => {
      expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(
        'Discard unsaved prompt changes?',
        { modal: true },
        'Discard',
      );
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({
        type: 'confirmation:result',
        id: 'confirm1',
        confirmed: true,
      });
    });
  });

  it('traces rejected credentials without credential contents', async () => {
    const { provider, inboundMessage } = mountProvider();
    const debugCollector = { trace: vi.fn() };
    provider.setDebugCollector(debugCollector as any);

    inboundMessage({
      type: 'action:saveCredentials',
      id: 'abc123',
      email: 'user@example.test',
      password: 'top-secret-password',
      otpSecret: '',
      extra: true,
    });

    await vi.waitFor(() => expect(debugCollector.trace).toHaveBeenCalled());
    expect(JSON.stringify(debugCollector.trace.mock.calls)).not.toContain('top-secret-password');
    expect(JSON.stringify(debugCollector.trace.mock.calls)).not.toContain('user@example.test');
  });

  it('settles auth:saveCookie with the exact request ID after success', async () => {
    const id = '0123456789abcdef01234567';
    const saveCookie = vi.fn().mockResolvedValue(undefined);
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      saveCookie,
    } as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({
      type: 'auth:saveCookie',
      id,
      cookie: 'session=top-secret',
    });

    await waitForResult(id);
    expect(saveCookie).toHaveBeenCalledWith('session=top-secret');
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({
      type: 'action:result',
      id,
      ok: true,
    });
  });

  it('settles auth:saveCookie with a secret-safe failure for the exact request ID', async () => {
    const id = '1123456789abcdef01234567';
    const secret = 'session=top-secret';
    const saveCookie = vi
      .fn()
      .mockRejectedValue(new Error(`keychain rejected ${secret}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      saveCookie,
    } as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'auth:saveCookie', id, cookie: secret });

    await waitForResult(id);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({
      type: 'action:result',
      id,
      ok: false,
      error: 'Failed to save the Airtable session cookie',
    });
    expect(JSON.stringify(vscodeMock.postMessage.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vscodeMock.showErrorMessage.mock.calls)).not.toContain(
      secret,
    );
    warn.mockRestore();
  });

  it('settles auth:clearCookie with the exact request ID after success', async () => {
    const id = '2123456789abcdef01234567';
    const clearCookie = vi.fn().mockResolvedValue(undefined);
    const dropDaemonCredentials = vi.fn().mockResolvedValue(undefined);
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      clearCookie,
      dropDaemonCredentials,
    } as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'auth:clearCookie', id });

    await waitForResult(id);
    expect(clearCookie).toHaveBeenCalledOnce();
    expect(dropDaemonCredentials).toHaveBeenCalledOnce();
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({
      type: 'action:result',
      id,
      ok: true,
    });
  });

  it('settles auth:clearCookie with a secret-safe failure for the exact request ID', async () => {
    const id = '3123456789abcdef01234567';
    const secret = 'session=top-secret';
    const clearCookie = vi
      .fn()
      .mockRejectedValue(new Error(`keychain rejected ${secret}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { provider, inboundMessage } = mountProvider();
    provider.setAuthManager({
      onDidChange: vi.fn(),
      clearCookie,
    } as any);
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'auth:clearCookie', id });

    await waitForResult(id);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({
      type: 'action:result',
      id,
      ok: false,
      error: 'Failed to clear the saved Airtable session cookie',
    });
    expect(JSON.stringify(vscodeMock.postMessage.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vscodeMock.showErrorMessage.mock.calls)).not.toContain(
      secret,
    );
    warn.mockRestore();
  });

  it.each([
    ['auth:saveCookie', '4123456789abcdef01234567'],
    ['auth:clearCookie', '5123456789abcdef01234567'],
  ] as const)(
    'settles %s when the authentication manager is unavailable',
    async (type, id) => {
      const { inboundMessage } = mountProvider();

      inboundMessage(
        type === 'auth:saveCookie'
          ? { type, id, cookie: 'session=top-secret' }
          : { type, id },
      );

      await waitForResult(id);
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({
        type: 'action:result',
        id,
        ok: false,
        error: 'Airtable authentication is unavailable',
      });
    },
  );

  it('sets localResourceRoots to exactly dist/webview under the extension URI', () => {
    const { view } = mountProvider();

    expect(view.webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [
        expect.objectContaining({ fsPath: '/extension/dist/webview' }),
      ],
    });
  });

  it('publishes useDaemon as read-only state with the current idle-park setting', async () => {
    const { provider } = mountProvider();

    await provider.pushState();

    const stateMessage = vscodeMock.postMessage.mock.calls
      .map(call => call[0])
      .find(message => message.type === 'state:update');
    expect(stateMessage.payload.settings.mcp).toEqual(
      expect.objectContaining({
        useDaemon: true,
        browserIdleParkMinutes: 30,
      }),
    );
    expect(parseExtensionMessage(stateMessage)).toEqual({
      ok: true,
      value: stateMessage,
    });
  });
});
