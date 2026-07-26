import { describe, expect, it } from 'vitest';
import {
  parseExtensionMessage,
  parseWebviewMessage,
} from '../webview-contract.js';

const completeDashboardState = {
  ideStatuses: [
    {
      ideId: 'cursor',
      label: 'Cursor',
      detected: true,
      version: '1.2.3',
      mcpConfigured: true,
      mcpServerHealthy: true,
      lspConfigured: true,
      lspManualStep: 'Restart Cursor',
      aiFiles: {
        skills: 'ok',
        rules: 'missing',
        workflows: 'partial',
        agents: 'ok',
      },
    },
  ],
  versions: {
    extension: '2.0.0',
    mcpServerBundled: '1.0.0',
    mcpServerPublished: '1.0.1',
    bundledFromGitSha: '0123456789abcdef',
  },
  aiFilesCount: 4,
  loading: false,
  settings: {
    mcp: {
      autoConfigureOnInstall: true,
      notifyOnUpdates: false,
      toolProfile: {
        profile: 'custom',
        enabledCount: 8,
        totalCount: 16,
        categories: {
          read: true,
          recordRead: true,
          tableWrite: false,
          tableDestructive: false,
          fieldWrite: true,
          fieldDestructive: false,
          recordDestructive: false,
          viewWrite: true,
          viewDestructive: false,
          viewSection: true,
          viewSectionDestructive: false,
          formWrite: true,
          extension: false,
          recordWrite: true,
          sync: false,
        },
      },
      serverSource: 'bundled',
      daemonPort: 3210,
      authMode: 'browser',
      httpClient: 'fetch',
      useDaemon: true,
      browserIdleParkMinutes: 15,
    },
    ai: {
      autoInstallFiles: true,
      includeAgents: false,
    },
    formula: {
      formatterVersion: 'v2',
    },
    script: {
      beautifyStyle: 'singleQuote',
      minifyLevel: 'aggressive',
    },
    auth: {
      autoRefresh: true,
      refreshIntervalHours: 24,
      loginMode: 'auto',
      browserChoice: {
        mode: 'detected',
        browserId: 'chrome',
        label: 'Google Chrome',
      },
    },
    debug: {
      enabled: true,
      verboseHttp: false,
      bufferSize: 500,
    },
  },
  auth: {
    status: 'valid',
    userId: 'usr123',
    lastChecked: '2026-07-26T12:00:00.000Z',
    lastLogin: '2026-07-26T11:00:00.000Z',
    error: '',
    hasCredentials: true,
    hasCookie: false,
    browser: {
      found: true,
      id: 'chrome',
      channel: 'chrome',
      label: 'Google Chrome',
      downloaded: false,
    },
    browserDownload: {
      status: 'downloading',
      progress: 50,
      error: '',
    },
    availableBrowsers: [
      { found: false },
      {
        found: true,
        id: 'bundled-chromium',
        channel: 'chromium',
        label: 'Bundled Chromium',
        downloaded: true,
      },
    ],
    browserChoice: {
      mode: 'custom',
      label: 'Custom browser',
    },
  },
  debug: {
    enabled: true,
    sessionActive: false,
    eventCount: 12,
    bufferCapacity: 500,
    verboseHttp: false,
  },
  storage: {
    entries: [
      {
        id: 'browser-profile',
        label: 'Browser profile',
        sizeBytes: 1024,
        exists: true,
      },
      {
        id: 'tool-config',
        label: 'Tool config',
        exists: false,
      },
    ],
  },
  tunnel: {
    status: 'active',
    url: 'https://example.ngrok.app',
    provider: 'ngrok',
    ngrokAuthtokenSet: true,
    autoDisabledReason: {
      failures: 5,
      windowMs: 60000,
      ip: '127.0.0.1',
    },
    namedTunnelHostname: null,
  },
  daemon: {
    running: true,
    healthy: true,
    port: 3210,
    port_lsp: 3211,
    tunnelUrl: 'https://example.ngrok.app',
    uptime: 60000,
    starting: false,
  },
  officialAirtable: {
    patSet: true,
    ideConfigured: {
      cursor: true,
      'claude-code': false,
    },
  },
  prompts: {
    prompts: [
      {
        name: 'inspect-base',
        description: 'Inspect a base',
        arguments: [
          { name: 'appId', description: 'Base', required: true },
        ],
        template: '{appId}',
        isBuiltin: false,
        isModified: false,
      },
    ],
  },
};

describe('parseWebviewMessage', () => {
  it('accepts a declared external link id', () => {
    expect(parseWebviewMessage({
      type: 'action:openLink',
      id: 'abc123',
      link: 'docs',
    })).toEqual({
      ok: true,
      value: { type: 'action:openLink', id: 'abc123', link: 'docs' },
    });
  });

  it.each([
    {
      name: 'raw URL',
      value: {
        type: 'action:openLink',
        id: 'abc123',
        link: 'docs',
        url: 'https://evil.test',
      },
    },
    {
      name: 'host-only setting',
      value: {
        type: 'setting:change',
        id: 'abc123',
        change: { key: 'mcp.serverPathOverride', value: 'C:\\evil\\server.mjs' },
      },
    },
    {
      name: 'custom executable',
      value: {
        type: 'action:setBrowserChoice',
        id: 'abc123',
        choice: { mode: 'custom', executablePath: 'C:\\evil.exe' },
      },
    },
    {
      name: 'raw storage path',
      value: {
        type: 'action:openStoragePath',
        id: 'abc123',
        path: 'C:\\Windows\\System32',
      },
    },
  ])('rejects $name payloads', ({ value }) => {
    expect(parseWebviewMessage(value).ok).toBe(false);
  });

  it('rejects duplicate prompt argument names', () => {
    const result = parseWebviewMessage({
      type: 'action:save-prompt',
      id: 'abc123',
      prompt: {
        name: 'inspect-base',
        description: 'Inspect a base',
        arguments: [
          { name: 'appId', description: 'Base', required: true },
          { name: 'appId', description: 'Duplicate', required: false },
        ],
        template: '{appId}',
        isBuiltin: false,
        isModified: false,
      },
    });

    expect(result).toMatchObject({ ok: false, type: 'action:save-prompt' });
  });

  it('rejects inherited message fields', () => {
    const input = Object.assign(
      Object.create({ type: 'action:refresh' }),
      { id: 'abc123' },
    );

    expect(parseWebviewMessage(input).ok).toBe(false);
  });

  it('rejects oversized action ids', () => {
    expect(parseWebviewMessage({
      type: 'action:refresh',
      id: 'a'.repeat(33),
    }).ok).toBe(false);
  });

  it('accepts every webview message arm', () => {
    const messages = [
      { type: 'ready' },
      { type: 'action:setupIde', id: 'abc123', ideId: 'cursor' },
      { type: 'action:setupAll', id: 'abc123' },
      { type: 'action:refresh', id: 'abc123' },
      { type: 'action:login', id: 'abc123' },
      { type: 'action:logout', id: 'abc123' },
      { type: 'action:status', id: 'abc123' },
      {
        type: 'action:saveCredentials',
        id: 'abc123',
        email: 'dev@example.test',
        password: 'correct horse battery staple',
        otpSecret: '',
      },
      { type: 'auth:saveCookie', id: 'abc123', cookie: 'session=value' },
      { type: 'auth:clearCookie', id: 'abc123' },
      { type: 'action:install-browser', id: 'abc123' },
      { type: 'action:removeBrowser', id: 'abc123' },
      { type: 'action:openToolConfig', id: 'abc123' },
      { type: 'action:unconfigureIde', id: 'abc123', ideId: 'claude-code' },
      { type: 'action:debug.startSession', id: 'abc123' },
      { type: 'action:debug.stopAndExport', id: 'abc123' },
      { type: 'action:debug.export', id: 'abc123' },
      {
        type: 'setting:change',
        id: 'abc123',
        change: { key: 'auth.autoRefresh', value: true },
      },
      { type: 'action:manualLogin', id: 'abc123' },
      { type: 'action:openLink', id: 'abc123', link: 'github' },
      { type: 'action:openIdeDocs', id: 'abc123', ideId: 'zed' },
      {
        type: 'action:openStoragePath',
        id: 'abc123',
        entryId: 'tool-config',
      },
      { type: 'action:backupSession', id: 'abc123' },
      { type: 'action:restoreSession', id: 'abc123' },
      { type: 'action:selectCustomBrowser', id: 'abc123' },
      {
        type: 'action:setBrowserChoice',
        id: 'abc123',
        choice: { mode: 'auto' },
      },
      {
        type: 'tunnel:enable',
        id: 'abc123',
        provider: 'cf-named',
        authtoken: 'secret',
        domain: 'tunnel.example.test',
      },
      { type: 'tunnel:disable', id: 'abc123' },
      {
        type: 'tunnel:set-ngrok-authtoken',
        id: 'abc123',
        authtoken: 'secret',
      },
      { type: 'daemon:start', id: 'abc123' },
      { type: 'daemon:stop', id: 'abc123' },
      { type: 'daemon:restart', id: 'abc123' },
      { type: 'daemon:copy-bearer-token', id: 'abc123' },
      { type: 'daemon:rotate-token', id: 'abc123' },
      { type: 'action:save-airtable-pat', id: 'abc123', pat: 'pat123' },
      { type: 'action:copy-airtable-pat', id: 'abc123' },
      {
        type: 'action:configure-official-airtable',
        id: 'abc123',
        ideId: 'windsurf',
      },
      {
        type: 'action:unconfigure-official-airtable',
        id: 'abc123',
        ideId: 'neovim',
      },
      {
        type: 'action:save-prompt',
        id: 'abc123',
        prompt: {
          name: 'inspect-base',
          description: 'Inspect a base',
          arguments: [
            { name: 'appId', description: 'Base', required: true },
          ],
          template: '{appId}',
          isBuiltin: false,
          isModified: false,
        },
      },
      { type: 'action:delete-prompt', id: 'abc123', name: 'inspect-base' },
      { type: 'action:reset-prompt', id: 'abc123', name: 'inspect-base' },
      {
        type: 'confirmation:request',
        id: 'abc123',
        kind: 'discard-prompt-edits',
      },
    ];

    for (const message of messages) {
      expect(parseWebviewMessage(message), message.type).toEqual({
        ok: true,
        value: message,
      });
    }
  });

  it('accepts every setting change arm', () => {
    const changes = [
      { key: 'auth.autoRefresh', value: false },
      { key: 'auth.refreshIntervalHours', value: 168 },
      { key: 'auth.loginMode', value: 'manual' },
      { key: 'mcp.autoConfigureOnInstall', value: true },
      { key: 'mcp.notifyOnUpdates', value: false },
      { key: 'mcp.authMode', value: 'direct-login' },
      { key: 'mcp.httpClient', value: 'impit' },
      { key: 'mcp.serverSource', value: 'npx' },
      { key: 'mcp.daemonPort', value: 65535 },
      { key: 'mcp.browserIdleParkMinutes', value: 525600 },
      { key: 'mcp.toolProfile', value: 'safe-write' },
      { key: 'mcp.category', category: 'viewSection', value: true },
      { key: 'formula.formatterVersion', value: 'v1' },
      { key: 'script.beautifyStyle', value: 'semicolonFree' },
      { key: 'script.minifyLevel', value: 'extreme' },
      { key: 'ai.autoInstallFiles', value: true },
      { key: 'ai.includeAgents', value: false },
      { key: 'debug.enabled', value: true },
      { key: 'debug.verboseHttp', value: false },
      { key: 'debug.bufferSize', value: 10000 },
    ];

    for (const change of changes) {
      const message = { type: 'setting:change', id: 'abc123', change };
      expect(parseWebviewMessage(message), change.key).toEqual({
        ok: true,
        value: message,
      });
    }
  });

  it.each([
    { key: 'auth.refreshIntervalHours', value: 0 },
    { key: 'mcp.daemonPort', value: 65536 },
    { key: 'mcp.browserIdleParkMinutes', value: -1 },
    { key: 'debug.bufferSize', value: 99 },
    { key: 'mcp.category', category: 'unknown', value: true },
    { key: 'auth.autoRefresh', value: 1 },
  ])('rejects invalid setting change $key', (change) => {
    expect(parseWebviewMessage({
      type: 'setting:change',
      id: 'abc123',
      change,
    }).ok).toBe(false);
  });

  it.each([
    '',
    'https://example.test',
    'example.test/path',
    'example.test?token=x',
    'example.test#fragment',
    'example test',
  ])('rejects invalid tunnel domain %s', (domain) => {
    expect(parseWebviewMessage({
      type: 'tunnel:enable',
      id: 'abc123',
      provider: 'ngrok',
      domain,
    }).ok).toBe(false);
  });

  it('enforces prompt count, name, argument, description, and template limits', () => {
    const basePrompt = {
      name: 'inspect-base',
      description: 'Inspect a base',
      arguments: [
        { name: 'appId', description: 'Base', required: true },
      ],
      template: '{appId}',
      isBuiltin: false,
      isModified: false,
    };
    const invalidPrompts = [
      { ...basePrompt, name: 'Inspect Base' },
      { ...basePrompt, description: 'd'.repeat(2049) },
      { ...basePrompt, template: 't'.repeat(16385) },
      {
        ...basePrompt,
        arguments: Array.from(
          { length: 17 },
          (_, index) => ({
            name: `arg${index}`,
            description: '',
            required: false,
          }),
        ),
      },
      {
        ...basePrompt,
        arguments: [
          { name: '1invalid', description: '', required: true },
        ],
      },
      {
        ...basePrompt,
        arguments: [
          { name: 'appId', description: 'd'.repeat(2049), required: true },
        ],
      },
    ];

    for (const prompt of invalidPrompts) {
      expect(parseWebviewMessage({
        type: 'action:save-prompt',
        id: 'abc123',
        prompt,
      }).ok).toBe(false);
    }
  });
});

describe('parseExtensionMessage', () => {
  it('accepts every extension message arm', () => {
    const messages = [
      { type: 'state:update', payload: completeDashboardState },
      {
        type: 'ide:status',
        payload: [
          {
            ideId: 'helix',
            label: 'Helix',
            detected: false,
            mcpConfigured: false,
            aiFiles: {
              skills: 'missing',
              rules: 'missing',
              workflows: 'missing',
              agents: 'missing',
            },
          },
        ],
      },
      {
        type: 'auth:state',
        payload: {
          status: 'chrome-missing',
          hasCredentials: false,
          browserChoice: { mode: 'auto' },
        },
      },
      {
        type: 'action:result',
        id: 'abc123',
        ok: false,
        error: 'Cancelled',
        cancelled: true,
      },
      {
        type: 'confirmation:result',
        id: 'abc123',
        confirmed: true,
      },
    ];

    for (const message of messages) {
      expect(parseExtensionMessage(message), message.type).toEqual({
        ok: true,
        value: message,
      });
    }
  });

  it.each([
    {
      name: 'state:update',
      value: {
        type: 'state:update',
        payload: completeDashboardState,
        unexpected: true,
      },
    },
    {
      name: 'ide:status',
      value: {
        type: 'ide:status',
        payload: [],
        unexpected: true,
      },
    },
    {
      name: 'auth:state',
      value: {
        type: 'auth:state',
        payload: { status: 'unknown', hasCredentials: false },
        unexpected: true,
      },
    },
    {
      name: 'action:result',
      value: {
        type: 'action:result',
        id: 'abc123',
        ok: true,
        unexpected: true,
      },
    },
    {
      name: 'confirmation:result',
      value: {
        type: 'confirmation:result',
        id: 'abc123',
        confirmed: true,
        unexpected: true,
      },
    },
  ])('rejects an unexpected top-level field on $name', ({ value }) => {
    expect(parseExtensionMessage(value).ok).toBe(false);
  });

  it('rejects state:update with a non-array ideStatuses value', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        ideStatuses: 'not-an-array',
      },
    }).ok).toBe(false);
  });

  it('rejects auth:state with an unknown status', () => {
    expect(parseExtensionMessage({
      type: 'auth:state',
      payload: {
        status: 'compromised',
        hasCredentials: false,
      },
    }).ok).toBe(false);
  });

  it('rejects action:result with a non-boolean ok value', () => {
    expect(parseExtensionMessage({
      type: 'action:result',
      id: 'abc123',
      ok: 'yes',
    }).ok).toBe(false);
  });

  it('rejects a DashboardState browser executable path', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        auth: {
          ...completeDashboardState.auth,
          browserChoice: {
            mode: 'custom',
            label: 'Custom browser',
            executablePath: 'C:\\evil.exe',
          },
        },
      },
    }).ok).toBe(false);
  });

  it('rejects a found browser summary without a stable id', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        auth: {
          ...completeDashboardState.auth,
          browser: {
            found: true,
            channel: 'chrome',
            label: 'Google Chrome',
          },
        },
      },
    }).ok).toBe(false);
  });

  it('rejects custom-browser as a found detected browser id', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        auth: {
          ...completeDashboardState.auth,
          browser: {
            found: true,
            id: 'custom-browser',
            channel: 'chromium',
            label: 'Custom browser',
          },
        },
      },
    }).ok).toBe(false);
  });

  it('rejects a DashboardState storage entry carrying a raw path', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        storage: {
          entries: [
            {
              id: 'browser-profile',
              label: 'Browser profile',
              exists: true,
              path: 'C:\\Windows\\System32',
            },
          ],
        },
      },
    }).ok).toBe(false);
  });

  it.each([
    'https://tunnel.example.test',
    'tunnel.example.test/path',
    'tunnel.example.test?token=x',
    'tunnel example.test',
  ])('rejects malformed named tunnel hostname %s', (namedTunnelHostname) => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        tunnel: {
          ...completeDashboardState.tunnel,
          namedTunnelHostname,
        },
      },
    }).ok).toBe(false);
  });

  it('rejects inherited nested state fields', () => {
    expect(parseExtensionMessage({
      type: 'auth:state',
      payload: Object.assign(
        Object.create({ status: 'valid' }),
        { hasCredentials: true },
      ),
    }).ok).toBe(false);
  });

  it('rejects unexpected nested DashboardState fields', () => {
    expect(parseExtensionMessage({
      type: 'state:update',
      payload: {
        ...completeDashboardState,
        settings: {
          ...completeDashboardState.settings,
          mcp: {
            ...completeDashboardState.settings.mcp,
            serverPathOverride: 'C:\\evil\\server.mjs',
          },
        },
      },
    }).ok).toBe(false);
  });
});
