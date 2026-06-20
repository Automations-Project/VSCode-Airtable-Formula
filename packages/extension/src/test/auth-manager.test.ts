import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';

// Mock vscode before importing the module under test.
vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  Disposable: vi.fn(),
  workspace: { getConfiguration: vi.fn(() => ({ get: (_k: string, d: unknown) => d, inspect: () => undefined })) },
  ConfigurationTarget: { Global: 1 },
  window: { showWarningMessage: vi.fn() },
}));

// getSettings is read inside checkSession — control mcp.useDaemon per test.
let useDaemon = true;
vi.mock('../settings.js', () => ({
  getSettings: () => ({ mcp: { useDaemon }, auth: { browserChoice: undefined } }),
}));

import { AuthManager } from '../mcp/auth-manager.js';

type DaemonStatusStub = {
  running: boolean; healthy: boolean; port: number | null; bearerToken: string | null;
};

const makeAuthManager = (statusStub: DaemonStatusStub) => {
  const daemonManager = { getDaemonStatus: async () => statusStub } as any;
  return new AuthManager({} as any, '/tmp/ext', daemonManager);
};

describe('AuthManager.checkSession routes through the daemon (single browser owner)', () => {
  let server: http.Server | undefined;
  let port = 0;
  let handler: http.RequestListener = (_req, res) => { res.writeHead(404); res.end(); };

  beforeEach(async () => {
    useDaemon = true;
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as import('net').AddressInfo).port;
  });

  afterEach(async () => {
    if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
  });

  it('reports "valid" from the daemon session-health endpoint without forking a browser', async () => {
    handler = (req, res) => {
      expect(req.url).toBe('/daemon/session-health');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: true, userId: 'usr999' }));
    };
    const am = makeAuthManager({ running: true, healthy: true, port, bearerToken: 'tok' });
    const state = await (am as any)._checkViaDaemon();
    expect(state).not.toBeNull();
    expect(state.status).toBe('valid');
    expect(state.userId).toBe('usr999');
  });

  it('reports "expired" when the daemon says the session is invalid', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: false, error: 'Session expired: redirected to /login' }));
    };
    const am = makeAuthManager({ running: true, healthy: true, port, bearerToken: 'tok' });
    const state = await (am as any)._checkViaDaemon();
    expect(state.status).toBe('expired');
    expect(state.error).toMatch(/expired/i);
  });

  it('falls back (returns null) when the daemon predates the endpoint (404)', async () => {
    handler = (_req, res) => { res.writeHead(404); res.end('Cannot GET /daemon/session-health'); };
    const am = makeAuthManager({ running: true, healthy: true, port, bearerToken: 'tok' });
    const state = await (am as any)._checkViaDaemon();
    expect(state).toBeNull();
  });

  it('falls back (returns null) when no healthy daemon is running', async () => {
    const am = makeAuthManager({ running: false, healthy: false, port: null, bearerToken: null });
    const state = await (am as any)._checkViaDaemon();
    expect(state).toBeNull();
  });

  it('falls back (returns null) when mcp.useDaemon is disabled', async () => {
    useDaemon = false;
    const am = makeAuthManager({ running: true, healthy: true, port, bearerToken: 'tok' });
    const state = await (am as any)._checkViaDaemon();
    expect(state).toBeNull();
  });
});
