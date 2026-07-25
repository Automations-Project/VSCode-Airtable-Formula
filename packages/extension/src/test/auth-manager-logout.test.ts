import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { readFileSync } from 'fs';

/**
 * Logout must be ONE path.
 *
 * The Command-Palette command (`airtable-formula.logout`) called
 * `authManager.logout()`, which only cleared the OS keychain and tried to delete
 * the Chrome profile. The daemon — which holds the live browser session in
 * memory (browser mode) or the injected byo/direct-login credentials
 * (cred-store) — was never told, so it kept serving tool calls with the session
 * the user believed they had just destroyed. Only the dashboard's logout button
 * did the daemon-side drop, and even that missed the browser-mode session.
 *
 * These tests pin the converged behaviour: `AuthManager.logout()` itself
 * releases the daemon browser and drops the daemon credentials, so every entry
 * point that calls it inherits the full drop.
 */

// The profile wipe is real fs work against the developer's own
// ~/.airtable-user-mcp/.chrome-profile — stub it out.
const { rmMock } = vi.hoisted(() => ({ rmMock: vi.fn(async () => {}) }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, default: { ...actual, rm: rmMock }, rm: rmMock };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, default: { ...actual, rm: rmMock }, rm: rmMock };
});

const shownErrors: string[] = [];
vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  Disposable: vi.fn(),
  workspace: { getConfiguration: vi.fn(() => ({ get: (_k: string, d: unknown) => d, inspect: () => undefined })) },
  ConfigurationTarget: { Global: 1 },
  window: {
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn((m: string) => { shownErrors.push(m); }),
  },
}));

let useDaemon = true;
let authMode: 'browser' | 'byo' | 'direct-login' = 'browser';
vi.mock('../settings.js', () => ({
  getSettings: () => ({ mcp: { useDaemon, authMode }, auth: { browserChoice: undefined } }),
}));

import { AuthManager } from '../mcp/auth-manager.js';

const PROFILE_DIR = path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');

const fakeSecrets = () => {
  const deleted: string[] = [];
  return {
    deleted,
    store: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    delete: vi.fn(async (k: string) => { deleted.push(k); }),
  };
};

describe('AuthManager.logout drops the daemon session as well as the keychain', () => {
  let server: http.Server | undefined;
  let port = 0;
  let hits: string[];
  let auths: (string | undefined)[];
  let order: string[];
  let restarts: number;
  let forceStops: number;

  beforeEach(async () => {
    useDaemon = true;
    authMode = 'browser';
    hits = []; auths = []; order = []; restarts = 0; forceStops = 0;
    shownErrors.length = 0;
    rmMock.mockClear();
    rmMock.mockImplementation(async () => { order.push('rm-profile'); });
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      auths.push(req.headers.authorization);
      order.push('release-browser');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as import('net').AddressInfo).port;
  });

  afterEach(async () => {
    if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
  });

  const makeAuthManager = (opts?: { running?: boolean; healthy?: boolean; restartThrows?: boolean }) => {
    const daemonManager = {
      getDaemonStatus: async () => ({
        running: opts?.running ?? true,
        healthy: opts?.healthy ?? true,
        port,
        bearerToken: 'tok',
      }),
      restartDaemon: async () => {
        restarts++;
        order.push('restart-daemon');
        if (opts?.restartThrows) throw new Error('spawn failed');
        return {};
      },
      forceStop: async () => { forceStops++; return { skippedUnowned: [] }; },
    } as any;
    const secrets = fakeSecrets();
    return { am: new AuthManager(secrets as any, '/tmp/ext', daemonManager), secrets };
  };

  it('browser mode: releases the daemon browser BEFORE wiping the profile', async () => {
    const { am, secrets } = makeAuthManager();
    await am.logout();

    expect(hits).toContain('POST /daemon/release-browser');
    expect(auths).toContain('Bearer tok');
    // Windows cannot delete a profile directory Chrome still holds open, and a
    // live daemon browser keeps serving the "logged out" session.
    expect(order.indexOf('release-browser')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('release-browser')).toBeLessThan(order.indexOf('rm-profile'));
    expect(rmMock).toHaveBeenCalledWith(PROFILE_DIR, { recursive: true, force: true });
    // Keychain still cleared — all four secrets.
    expect(secrets.deleted).toHaveLength(4);
    // Browser mode has no injected creds to drop, so no restart.
    expect(restarts).toBe(0);
  });

  it('byo mode: restarts the daemon so its in-memory credentials die', async () => {
    authMode = 'byo';
    const { am } = makeAuthManager();
    await am.logout();
    expect(restarts).toBe(1);
    expect(hits).toContain('POST /daemon/release-browser');
  });

  it('direct-login mode: force-stops the daemon when the restart fails', async () => {
    authMode = 'direct-login';
    const { am } = makeAuthManager({ restartThrows: true });
    await am.logout();
    expect(forceStops).toBe(1);
    expect(shownErrors.join(' ')).toMatch(/force-stopped/i);
  });

  it('no daemon running: logout still clears the keychain and never throws', async () => {
    const { am, secrets } = makeAuthManager({ running: false, healthy: false });
    await expect(am.logout()).resolves.toBeUndefined();
    expect(hits).toHaveLength(0);
    expect(restarts).toBe(0);
    expect(secrets.deleted).toHaveLength(4);
  });

  it('mcp.useDaemon disabled: no daemon calls at all', async () => {
    useDaemon = false;
    authMode = 'byo';
    const { am } = makeAuthManager();
    await am.logout();
    expect(hits).toHaveLength(0);
    expect(restarts).toBe(0);
  });
});

/**
 * Wiring guard: both logout entry points must delegate to AuthManager.logout()
 * rather than re-implementing a partial teardown. This is what regressed —
 * the Command-Palette command was wired straight to the keychain-only logout
 * while the dashboard grew the daemon drop separately.
 */
describe('every logout entry point routes through AuthManager.logout()', () => {
  const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  it('the Command-Palette command delegates (and clears nothing itself)', () => {
    const body = src('extension.ts').split("registerCommand('airtable-formula.logout'")[1] ?? '';
    const handler = body.slice(0, body.indexOf('registerCommand('));
    expect(handler).toMatch(/authManager\.logout\(\)/);
    expect(handler).not.toMatch(/secrets\.delete|fs\.rm|restartDaemon/);
  });

  it('the dashboard action delegates (and no longer needs its own drop)', () => {
    const body = src('webview/DashboardProvider.ts').split("msg.type === 'action:logout'")[1] ?? '';
    const handler = body.slice(0, body.indexOf("msg.type === 'action:manualLogin'"));
    expect(handler).toMatch(/authManager!?\.?logout\(\)/);
    expect(handler).not.toMatch(/secrets\.delete|fs\.rm|restartDaemon/);
  });
});
