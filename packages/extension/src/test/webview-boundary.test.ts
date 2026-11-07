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
  reapplyMcpForIde: vi.fn(async () => true),
  hasForeignMcpEntry: vi.fn(async () => false),
  updateWebviewSetting: vi.fn(async () => undefined),
  detectAllBrowsers: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(async () => []),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  ideConfigs: {} as Record<string, { capabilities: string[] }>,
}));

const skill = vi.hoisted(() => {
  const env = { home: '/h', workspaceRoot: null, version: '0', skillSourceDir: '/s', detectedIdes: [] };
  return {
    env,
    scope: 'global' as 'global' | 'project',   // ai.installScope the settings mock answers
    installSkill: vi.fn(async () => ({ written: [], failed: [] })),
    checkSkill: vi.fn(async () => ({})),
    removeSkill: vi.fn(async () => ({ removed: [], failed: [] })),
    listSkillClients: vi.fn(async () => [{ id: 'agents', name: 'Standard skills folder', dir: '~/.agents/skills', status: 'missing', canonical: true }]),
    skillEnv: vi.fn(async () => env),
  };
});

vi.mock('../auto-config/index.js', () => ({
  getAllIdeStatuses: dependencies.getAllIdeStatuses,
  configureMcpForIde: dependencies.configureMcpForIde,
  reapplyMcpForIde: dependencies.reapplyMcpForIde,
  hasForeignMcpEntry: dependencies.hasForeignMcpEntry,
  unconfigureMcpForIde: vi.fn(),
  configureLspForIde: vi.fn(),
  unconfigureLspForIde: vi.fn(),
  configureOfficialAirtableMcp: vi.fn(),
  unconfigureOfficialAirtableMcp: vi.fn(),
  isOfficialAirtableConfigured: vi.fn(),
}));
vi.mock('../auto-config/ide-configs.js', () => ({ IDE_CONFIGS: dependencies.ideConfigs }));
vi.mock('../skills/installer.js', () => ({
  installSkill: skill.installSkill,
  checkSkill: skill.checkSkill,
  removeSkill: skill.removeSkill,
  listSkillClients: skill.listSkillClients,
}));
vi.mock('../skills/host-env.js', () => ({ skillEnv: skill.skillEnv }));
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
    ai: { autoInstallFiles: true, installScope: skill.scope },
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
  readFile: dependencies.readFile,
  writeFile: dependencies.writeFile,
  mkdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(async () => undefined),
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
    dependencies.readFile.mockReset();
    skill.scope = 'global';
    vscodeMock.configValues.clear();
    for (const key of Object.keys(dependencies.ideConfigs)) delete dependencies.ideConfigs[key];
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
    ['gemini-cli', 'https://github.com/google-gemini/gemini-cli'],
  ] as const)('maps %s docs to the fixed host URL', async (ideId, expected) => {
    // The URL lives in the real IDE_CONFIGS (from the client table); this file mocks the module.
    const real = await vi.importActual<typeof import('../auto-config/ide-configs.js')>('../auto-config/ide-configs.js');
    dependencies.ideConfigs[ideId] = real.IDE_CONFIGS[ideId];
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

    // The rewrite re-applies (only entries we wrote); it never calls the explicit Setup path.
    expect(dependencies.reapplyMcpForIde).toHaveBeenCalledTimes(1);
    expect(dependencies.configureMcpForIde).not.toHaveBeenCalled();
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

  it('action:installSkill runs one scope-wide install and answers the action', async () => {
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:installSkill', id: 'skill1' });

    await waitForResult('skill1');
    expect(skill.installSkill).toHaveBeenCalledOnce();
    expect(skill.installSkill).toHaveBeenCalledWith('global', skill.env);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'skill1', ok: true });
  });

  it('action:removeSkill runs removeSkill with the configured scope', async () => {
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:removeSkill', id: 'skill2' });

    await waitForResult('skill2');
    expect(skill.removeSkill).toHaveBeenCalledOnce();
    expect(skill.removeSkill).toHaveBeenCalledWith('global', skill.env);
    expect(skill.installSkill).not.toHaveBeenCalled();
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'skill2', ok: true });
  });

  it('action:removeSkill in project scope with no folder open warns instead of answering removed', async () => {
    skill.scope = 'project';
    skill.skillEnv.mockResolvedValueOnce({ ...skill.env, workspaceRoot: null });
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:removeSkill', id: 'skill3' });

    await waitForResult('skill3');
    expect(skill.removeSkill).not.toHaveBeenCalled();
    const warning = 'Open a folder to install the AI skill into a project, or switch airtableFormula.ai.installScope to global.';
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(warning);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'skill3', ok: false, error: warning });
  });

  it('action:setupAll installs the skill once, not once per IDE', async () => {
    dependencies.ideConfigs.cursor = { capabilities: ['mcp'] };
    dependencies.ideConfigs['claude-code'] = { capabilities: ['mcp'] };
    dependencies.getAllIdeStatuses.mockResolvedValueOnce([
      { ideId: 'cursor', detected: true },
      { ideId: 'claude-code', detected: true },
    ]);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupAll', id: 'setup1' });

    await waitForResult('setup1');
    expect(dependencies.configureMcpForIde).toHaveBeenCalledTimes(2);
    expect(skill.installSkill).toHaveBeenCalledOnce();
    expect(skill.installSkill).toHaveBeenCalledWith('global', skill.env);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'setup1', ok: true });
  });

  it('action:setupAll with one failing client configures the others, installs the skill, pushes state, and warns naming it', async () => {
    dependencies.ideConfigs.cursor = { capabilities: ['mcp'] };
    dependencies.ideConfigs['claude-code'] = { capabilities: ['mcp'] };
    dependencies.ideConfigs.zed = { capabilities: ['mcp'] };
    dependencies.getAllIdeStatuses.mockResolvedValueOnce([
      { ideId: 'cursor', label: 'Cursor', detected: true },
      { ideId: 'claude-code', label: 'Claude Code', detected: true },
      { ideId: 'zed', label: 'Zed', detected: true },
    ] as never);
    // Calls start in status order: cursor, claude-code, zed.
    dependencies.configureMcpForIde
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('~/.claude.json is not valid JSON (line 1, column 3). Nothing was written.'))
      .mockResolvedValueOnce(undefined);
    const { provider, inboundMessage } = mountProvider();
    const pushState = vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupAll', id: 'setup2' });

    await waitForResult('setup2');
    expect(dependencies.configureMcpForIde).toHaveBeenCalledTimes(3);
    expect(dependencies.configureMcpForIde).toHaveBeenCalledWith('zed', expect.anything(), expect.anything());
    expect(skill.installSkill).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalled();
    const warning = 'Airtable Formula: could not configure Claude Code: ~/.claude.json is not valid JSON (line 1, column 3). Nothing was written.';
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(warning);
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'setup2', ok: false, error: warning });
  });

  it('action:setupAll leaves a hand-written entry alone and reports it as already configured, not as a failure', async () => {
    dependencies.ideConfigs.cursor = { capabilities: ['mcp'] };
    dependencies.ideConfigs.zed = { capabilities: ['mcp'] };
    dependencies.getAllIdeStatuses.mockResolvedValueOnce([
      { ideId: 'cursor', label: 'Cursor', detected: true },
      { ideId: 'zed', label: 'Zed', detected: true },
    ] as never);
    // Checked in status order: Cursor has none of the user's own, Zed has a hand-written entry.
    dependencies.hasForeignMcpEntry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupAll', id: 'setup3' });

    await waitForResult('setup3');
    expect(dependencies.configureMcpForIde).toHaveBeenCalledTimes(1);
    expect(dependencies.configureMcpForIde).toHaveBeenCalledWith('cursor', expect.anything(), expect.anything());
    expect(skill.installSkill).toHaveBeenCalledOnce();
    expect(vscodeMock.showWarningMessage).not.toHaveBeenCalled();
    expect(vscodeMock.showInformationMessage).toHaveBeenCalledWith(
      'Airtable Formula: Zed already configured with an airtable-user-mcp entry you wrote; left as is.',
    );
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'setup3', ok: true });
  });

  it("a card's Set up asks before replacing a hand-written entry; Cancel writes nothing", async () => {
    dependencies.ideConfigs.zed = { capabilities: ['mcp'], label: 'Zed' } as never;
    dependencies.hasForeignMcpEntry.mockResolvedValueOnce(true);
    vscodeMock.showWarningMessage.mockResolvedValueOnce(undefined);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupIde', id: 'card01', ideId: 'zed' });

    await waitForResult('card01');
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith('Replace the airtable-user-mcp entry you wrote in Zed?', { modal: true }, 'Replace');
    expect(dependencies.configureMcpForIde).not.toHaveBeenCalled();
    expect(skill.installSkill).not.toHaveBeenCalled();
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'card01', ok: false, error: 'Cancelled', cancelled: true });
  });

  it("a card's Set up on a hand-written entry writes ours after Replace", async () => {
    dependencies.ideConfigs.zed = { capabilities: ['mcp'], label: 'Zed' } as never;
    dependencies.hasForeignMcpEntry.mockResolvedValueOnce(true);
    vscodeMock.showWarningMessage.mockResolvedValueOnce('Replace' as never);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupIde', id: 'card02', ideId: 'zed' });

    await waitForResult('card02');
    expect(dependencies.configureMcpForIde).toHaveBeenCalledWith('zed', expect.anything(), expect.anything());
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'card02', ok: true });
  });

  it("a card's Set up with no hand-written entry does not ask", async () => {
    dependencies.ideConfigs.cursor = { capabilities: ['mcp'], label: 'Cursor' } as never;
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'action:setupIde', id: 'card03', ideId: 'cursor' });

    await waitForResult('card03');
    expect(vscodeMock.showWarningMessage).not.toHaveBeenCalled();
    expect(dependencies.configureMcpForIde).toHaveBeenCalledWith('cursor', expect.anything(), expect.anything());
  });

  it('the settings rewrite still rewrites the other clients when one fails, and warns naming it', async () => {
    dependencies.getAllIdeStatuses.mockResolvedValueOnce([
      { ideId: 'cursor', label: 'Cursor', mcpConfigured: true },
      { ideId: 'zed', label: 'Zed', mcpConfigured: true },
    ] as never);
    dependencies.reapplyMcpForIde.mockRejectedValueOnce(new Error('bad file')).mockResolvedValueOnce(true);
    const { provider } = mountProvider();

    await expect(provider.applyConfigurationSideEffect('mcp.serverSource')).resolves.toBeUndefined();

    expect(dependencies.reapplyMcpForIde).toHaveBeenCalledTimes(2);
    expect(dependencies.reapplyMcpForIde).toHaveBeenCalledWith('zed', expect.anything(), expect.anything());
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith('Airtable Formula: could not configure Cursor: bad file');
  });

  describe('prompt saves refresh the skill recipes', () => {
    const installedRow = { id: 'agents', name: 'Standard skills folder', dir: '~/.agents/skills', status: 'installed', canonical: true };
    const prompt = { name: 'custom-one', description: 'd', arguments: [], template: 't', isBuiltin: false, isModified: false };

    const save = async () => {
      const { provider, inboundMessage } = mountProvider();
      vi.spyOn(provider as any, '_writePromptConfig').mockResolvedValue(undefined);
      vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);
      inboundMessage({ type: 'action:save-prompt', id: 'saveprompt1', prompt });
      await waitForResult('saveprompt1');
    };

    it('save-prompt refreshes the skill when it is installed somewhere', async () => {
      skill.listSkillClients.mockResolvedValueOnce([installedRow] as any);
      await save();
      expect(skill.installSkill).toHaveBeenCalledOnce();
      expect(skill.installSkill).toHaveBeenCalledWith('global', skill.env);
    });

    it('save-prompt refreshes an outdated skill too', async () => {
      skill.listSkillClients.mockResolvedValueOnce([{ ...installedRow, status: 'outdated' }] as any);
      await save();
      expect(skill.installSkill).toHaveBeenCalledOnce();
    });

    it('save-prompt does not install the skill when it is missing everywhere', async () => {
      await save();
      expect(skill.installSkill).not.toHaveBeenCalled();
    });

    it('save-prompt never re-installs a project-scope skill, even where it is installed', async () => {
      skill.scope = 'project';
      skill.listSkillClients.mockResolvedValue([installedRow] as any);
      try {
        await save();
      } finally {
        skill.listSkillClients.mockReset();
      }
      expect(skill.installSkill).not.toHaveBeenCalled();
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'saveprompt1', ok: true });
    });

    it.each([
      ['action:delete-prompt', 'Delete'],
      ['action:reset-prompt', 'Reset'],
    ] as const)('%s refreshes the skill when it is installed', async (type, button) => {
      vscodeMock.showWarningMessage.mockResolvedValueOnce(button);
      skill.listSkillClients.mockResolvedValueOnce([installedRow] as any);
      const { provider, inboundMessage } = mountProvider();
      vi.spyOn(provider as any, '_writePromptConfig').mockResolvedValue(undefined);
      vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);
      inboundMessage({ type, id: 'prompt9', name: 'custom-one' });
      await waitForResult('prompt9');
      expect(skill.installSkill).toHaveBeenCalledOnce();
    });

    it('a failing refresh does not fail the prompt save, and is reported as a warning', async () => {
      skill.listSkillClients.mockResolvedValueOnce([installedRow] as any);
      skill.installSkill.mockRejectedValueOnce(new Error('disk full'));
      await save();
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'saveprompt1', ok: true });
      expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });

    it('per-folder install failures are reported as a warning without failing the save', async () => {
      skill.listSkillClients.mockResolvedValueOnce([installedRow] as any);
      skill.installSkill.mockResolvedValueOnce({ written: [], failed: [{ dir: '~/.agents/skills', message: 'EACCES' }] } as any);
      await save();
      expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'saveprompt1', ok: true });
      expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    });

    it('the refresh runs after the write and before the state push', async () => {
      skill.listSkillClients.mockResolvedValueOnce([installedRow] as any);
      const { provider, inboundMessage } = mountProvider();
      const write = vi.spyOn(provider as any, '_writePromptConfig').mockResolvedValue(undefined);
      const push = vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);
      inboundMessage({ type: 'action:save-prompt', id: 'saveprompt1', prompt });
      await waitForResult('saveprompt1');
      const install = skill.installSkill.mock.invocationCallOrder[0];
      expect(write.mock.invocationCallOrder[0]).toBeLessThan(install);
      expect(install).toBeLessThan(push.mock.invocationCallOrder[0]);
    });
  });

  it.each([
    ['[]', '[]'],
    ['overrides as a list and custom as an object', JSON.stringify({ overrides: [], custom: {} })],
  ])('a prompts.json holding %s still saves as { overrides, custom: [saved] }', async (_label, file) => {
    dependencies.readFile.mockResolvedValue(file);
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);
    const prompt = { name: 'custom-one', description: 'd', arguments: [], template: 't' };

    inboundMessage({ type: 'action:save-prompt', id: 'saveprompt2', prompt: { ...prompt, isBuiltin: false, isModified: false } });

    await waitForResult('saveprompt2');
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'saveprompt2', ok: true });
    const [, data] = dependencies.writeFile.mock.calls.at(-1)!;
    expect(JSON.parse(data)).toEqual({ overrides: {}, custom: [prompt] });
  });

  it('state:update carries the client ledger from listSkillClients', async () => {
    const { provider } = mountProvider();

    await provider.pushState();

    const stateMessage = vscodeMock.postMessage.mock.calls
      .map(call => call[0])
      .find(message => message.type === 'state:update');
    expect(stateMessage.payload.aiSkillClients).toEqual([
      { id: 'agents', name: 'Standard skills folder', dir: '~/.agents/skills', status: 'missing', canonical: true },
    ]);
    expect(skill.listSkillClients).toHaveBeenCalledWith('global', skill.env);
    expect(stateMessage.payload.settings.ai).toEqual({ autoInstallFiles: true, installScope: 'global' });
    expect(parseExtensionMessage(stateMessage)).toEqual({ ok: true, value: stateMessage });
  });

  it('persists ai.installScope through the generic setting arm', async () => {
    const { provider, inboundMessage } = mountProvider();
    vi.spyOn(provider, 'pushState').mockResolvedValue(undefined);

    inboundMessage({ type: 'setting:change', id: 'scope1', change: { key: 'ai.installScope', value: 'project' } });

    await waitForResult('scope1');
    expect(dependencies.updateWebviewSetting).toHaveBeenCalledWith({ key: 'ai.installScope', value: 'project' });
    expect(vscodeMock.postMessage).toHaveBeenCalledWith({ type: 'action:result', id: 'scope1', ok: true });
  });
});
