import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
  statSync: vi.fn(() => ({ isFile: () => true })),
}));
const selectedChoice = vi.hoisted(() => ({
  value: undefined as import('../settings.js').HostBrowserChoice | undefined,
}));

vi.mock('fs', () => fsMock);
vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (_key: string, fallback: unknown) => fallback,
      inspect: vi.fn(),
    })),
  },
  ConfigurationTarget: { Global: 1 },
  window: { showWarningMessage: vi.fn() },
}));
vi.mock('../settings.js', () => ({
  getSettings: () => ({
    mcp: { useDaemon: true, authMode: 'browser' },
    auth: {
      autoRefresh: true,
      refreshIntervalHours: 12,
      browserChoice: selectedChoice.value,
    },
  }),
}));

import { detectAllBrowsers } from '../mcp/browser-detect.js';
import { AuthManager } from '../mcp/auth-manager.js';

describe('detectAllBrowsers stable host identifiers', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    fsMock.existsSync.mockReset();
    fsMock.statSync.mockClear();
    selectedChoice.value = undefined;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('assigns fixed IDs to every detected system browser', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fsMock.existsSync.mockImplementation(candidate => (
      candidate === '/usr/bin/google-chrome'
      || candidate === '/usr/bin/microsoft-edge'
      || candidate === '/usr/bin/chromium'
      || candidate === '/usr/bin/brave-browser'
    ));

    expect(detectAllBrowsers()).toEqual([
      {
        found: true,
        id: 'chrome',
        channel: 'chrome',
        executablePath: '/usr/bin/google-chrome',
        label: 'Google Chrome',
      },
      {
        found: true,
        id: 'edge',
        channel: 'msedge',
        executablePath: '/usr/bin/microsoft-edge',
        label: 'Microsoft Edge',
      },
      {
        found: true,
        id: 'chromium',
        channel: 'chromium',
        executablePath: '/usr/bin/chromium',
        label: 'Chromium',
      },
      {
        found: true,
        id: 'brave',
        channel: 'chromium',
        executablePath: '/usr/bin/brave-browser',
        label: 'Brave Browser',
      },
    ]);
  });

  it('assigns the fixed bundled Chromium ID without probing a webview path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fsMock.existsSync.mockReturnValue(false);

    expect(detectAllBrowsers('/host/global/chromium')).toEqual([
      {
        found: true,
        id: 'bundled-chromium',
        channel: 'chromium',
        executablePath: '/host/global/chromium',
        label: 'Bundled Chromium',
        downloaded: true,
      },
    ]);
  });
});

describe('AuthManager browser state redaction', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fsMock.existsSync.mockReset();
    fsMock.statSync.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('resolves a persisted detected choice by stable ID and omits its path from state', () => {
    fsMock.existsSync.mockImplementation(candidate => candidate === '/usr/bin/microsoft-edge');
    selectedChoice.value = {
      mode: 'custom',
      channel: 'msedge',
      executablePath: '/persisted/old-edge',
      label: 'Microsoft Edge',
      detectedId: 'edge',
    };
    const manager = new AuthManager({} as any, '/extension');

    const selected = manager.refreshBrowserDetection();

    expect(selected).toEqual({
      found: true,
      id: 'edge',
      channel: 'msedge',
      executablePath: '/usr/bin/microsoft-edge',
      label: 'Microsoft Edge',
    });
    expect(manager.state.browser).toEqual({
      found: true,
      id: 'edge',
      channel: 'msedge',
      label: 'Microsoft Edge',
    });
    expect(manager.state.browserChoice).toEqual({
      mode: 'detected',
      browserId: 'edge',
      label: 'Microsoft Edge',
    });
    expect(JSON.stringify(manager.state)).not.toContain('/usr/bin/microsoft-edge');
    expect(JSON.stringify(manager.state)).not.toContain('/persisted/old-edge');
  });

  it('keeps a host-picked executable private and labels it as a custom choice', () => {
    fsMock.existsSync.mockReturnValue(false);
    selectedChoice.value = {
      mode: 'custom',
      channel: 'chromium',
      executablePath: '/host/custom-brave',
      label: 'custom-brave',
    };
    const manager = new AuthManager({} as any, '/extension');

    expect(manager.refreshBrowserDetection()).toEqual({
      found: true,
      id: 'custom-browser',
      channel: 'chromium',
      executablePath: '/host/custom-brave',
      label: 'custom-brave',
    });
    expect(manager.state.browser).toEqual({ found: false });
    expect(manager.state.browserChoice).toEqual({
      mode: 'custom',
      label: 'custom-brave',
    });
    expect(JSON.stringify(manager.state)).not.toContain('/host/custom-brave');
  });
});
