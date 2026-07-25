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

  const makeAuthManager = (opts?: {
    running?: boolean; healthy?: boolean; restartThrows?: boolean;
    statusThrows?: boolean; forceStopThrows?: boolean; skippedUnowned?: Array<{ pid: number }>;
  }) => {
    const daemonManager = {
      getDaemonStatus: async () => {
        if (opts?.statusThrows) throw new Error('lockfile unreadable');
        return {
          running: opts?.running ?? true,
          healthy: opts?.healthy ?? true,
          port,
          bearerToken: 'tok',
        };
      },
      restartDaemon: async () => {
        restarts++;
        order.push('restart-daemon');
        if (opts?.restartThrows) throw new Error('spawn failed');
        return {};
      },
      forceStop: async () => {
        forceStops++;
        if (opts?.forceStopThrows) throw new Error('sweep failed');
        return { skippedUnowned: opts?.skippedUnowned ?? [] };
      },
    } as any;
    const secrets = fakeSecrets();
    return { am: new AuthManager(secrets as any, '/tmp/ext', daemonManager), secrets };
  };

  it('browser mode: releases the daemon browser BEFORE wiping the profile', async () => {
    const { am, secrets } = makeAuthManager();
    const result = await am.logout();

    expect(result.daemonSessionDropped).toBe(true);
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

  // Regression guard for `daemonSessionDropped: (release.released || dropped) &&
  // profileWiped` → `(release.released && dropped) && profileWiped`. In byo/
  // direct-login, release-browser can report success trivially (there is no live
  // browser session to release), so `release.released` alone must never stand in
  // for a genuinely failed credential drop. With the old `||`, this exact
  // scenario reported `daemonSessionDropped: true` even though neither the
  // restart nor the force-stop actually dropped the daemon's in-memory session —
  // reverting the operator to `||` makes both assertions below fail.
  it('byo mode: release succeeds but the credential drop fails — must NOT report success', async () => {
    authMode = 'byo';
    const { am } = makeAuthManager({ restartThrows: true, forceStopThrows: true });
    const result = await am.logout();

    expect(hits).toContain('POST /daemon/release-browser'); // release.released === true
    expect(restarts).toBe(1);
    expect(forceStops).toBe(1);
    expect(result.daemonSessionDropped).toBe(false);
    expect(shownErrors.join(' ')).toMatch(/may still hold your session/i);
  });

  it('direct-login mode: release succeeds but the credential drop fails — must NOT report success', async () => {
    authMode = 'direct-login';
    const { am } = makeAuthManager({ restartThrows: true, forceStopThrows: true });
    const result = await am.logout();

    expect(hits).toContain('POST /daemon/release-browser');
    expect(result.daemonSessionDropped).toBe(false);
  });

  it('no daemon running: logout still clears the keychain and never throws', async () => {
    const { am, secrets } = makeAuthManager({ running: false, healthy: false });
    await expect(am.logout()).resolves.toEqual({ daemonSessionDropped: true });
    expect(hits).toHaveLength(0);
    expect(restarts).toBe(0);
    expect(secrets.deleted).toHaveLength(4);
  });

  it('mcp.useDaemon disabled: no daemon calls at all', async () => {
    useDaemon = false;
    authMode = 'byo';
    const { am } = makeAuthManager();
    const result = await am.logout();
    expect(hits).toHaveLength(0);
    expect(restarts).toBe(0);
    expect(result.daemonSessionDropped).toBe(true);   // nothing was holding it
  });
});

/**
 * The release can fail while the daemon is very much ALIVE — `healthy` comes from
 * a 2 s probe, and the POST can 5xx or time out. Silently skipping the release
 * there put us back in the original bug with a smaller window: Chromium keeps
 * serving, `fs.rm` fails EBUSY into a console.warn, and the user is told
 * "Logged out and session cleared." So an unconfirmed release must escalate to a
 * daemon restart (whose shutdown runs auth.close()) and, failing that, must be
 * reported to the caller.
 */
describe('AuthManager.logout escalates when the browser release is not confirmed', () => {
  let server: http.Server | undefined;
  let port = 0;
  let restarts: number;
  let forceStops: number;
  let releaseStatus: number;

  beforeEach(async () => {
    useDaemon = true;
    authMode = 'browser';
    restarts = 0; forceStops = 0; releaseStatus = 200;
    shownErrors.length = 0;
    rmMock.mockClear();
    rmMock.mockImplementation(async () => {});
    server = http.createServer((_req, res) => {
      res.writeHead(releaseStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: releaseStatus < 400 }));
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as import('net').AddressInfo).port;
  });

  afterEach(async () => {
    if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
  });

  const make = (status: { running: boolean; healthy: boolean }, o?: { restartThrows?: boolean; forceStopThrows?: boolean; skippedUnowned?: Array<{ pid: number }> }) => {
    const daemonManager = {
      getDaemonStatus: async () => ({ ...status, port, bearerToken: 'tok' }),
      restartDaemon: async () => {
        restarts++;
        if (o?.restartThrows) throw new Error('spawn failed');
        return {};
      },
      forceStop: async () => {
        forceStops++;
        if (o?.forceStopThrows) throw new Error('sweep failed');
        return { skippedUnowned: o?.skippedUnowned ?? [] };
      },
    } as any;
    return new AuthManager(fakeSecrets() as any, '/tmp/ext', daemonManager);
  };

  it('daemon alive but health probe failed (browser mode): restarts it and reports success', async () => {
    const am = make({ running: true, healthy: false });
    const result = await am.logout();
    expect(restarts).toBe(1);                       // browser mode would NOT restart without the escalation
    expect(result.daemonSessionDropped).toBe(true); // the restart dropped it
  });

  it('release-browser returns a non-2xx: still escalates', async () => {
    releaseStatus = 503;
    const am = make({ running: true, healthy: true });
    const result = await am.logout();
    expect(restarts).toBe(1);
    expect(result.daemonSessionDropped).toBe(true);
  });

  it('escalation itself fails: logout reports the session was NOT dropped', async () => {
    const am = make({ running: true, healthy: false }, { restartThrows: true, forceStopThrows: true });
    const result = await am.logout();
    expect(restarts).toBe(1);
    expect(forceStops).toBe(1);
    expect(result.daemonSessionDropped).toBe(false);
    expect(shownErrors.join(' ')).toMatch(/may still hold your session/i);
  });

  it('force-stop that left an unattributable process alive is NOT reported as dropped', async () => {
    const am = make({ running: true, healthy: false }, { restartThrows: true, skippedUnowned: [{ pid: 4242 }] });
    const result = await am.logout();
    expect(forceStops).toBe(1);
    expect(result.daemonSessionDropped).toBe(false);
  });

  it('daemon status unreadable: assumes the worst and escalates', async () => {
    const daemonManager = {
      getDaemonStatus: async () => { throw new Error('lockfile unreadable'); },
      restartDaemon: async () => { restarts++; return {}; },
      forceStop: async () => { forceStops++; return { skippedUnowned: [] }; },
    } as any;
    const am = new AuthManager(fakeSecrets() as any, '/tmp/ext', daemonManager);
    const result = await am.logout();
    // getDaemonStatus throws inside dropDaemonCredentials too → nothing confirmed.
    expect(result.daemonSessionDropped).toBe(false);
  });

  it('no daemon running: nothing to escalate, reported as dropped', async () => {
    const am = make({ running: false, healthy: false });
    const result = await am.logout();
    expect(restarts).toBe(0);
    expect(forceStops).toBe(0);
    expect(result.daemonSessionDropped).toBe(true);
  });
});

/**
 * The profile directory is a live session ON DISK: it holds the Airtable cookies,
 * and every daemon points at the same AIRTABLE_PROFILE_DIR. So a wipe that fails
 * (EBUSY/EPERM on Windows, because the daemon's Chromium still has it open) means
 * the replacement daemon simply authenticates from it again on the next tool call
 * — or on the dashboard refresh fired immediately after logout. Dropping the
 * daemon's in-memory session while leaving that directory behind is the original
 * "you are not really logged out" bug wearing a different hat.
 */
describe('AuthManager.logout retries the profile wipe after the daemon is down', () => {
  let server: http.Server | undefined;
  let port = 0;
  let restarts: number;
  let rmCalls: number;

  const busy = () => Object.assign(new Error('EBUSY: resource busy or locked, rm'), { code: 'EBUSY' });

  const make = (o?: { healthy?: boolean; running?: boolean }) => {
    const daemonManager = {
      getDaemonStatus: async () => ({
        running: o?.running ?? true,
        // healthy:false = the daemon missed its 2 s probe while alive and serving
        healthy: o?.healthy ?? false,
        port,
        bearerToken: 'tok',
      }),
      restartDaemon: async () => { restarts++; return {}; },
      forceStop: async () => ({ skippedUnowned: [] }),
    } as any;
    return new AuthManager(fakeSecrets() as any, '/tmp/ext', daemonManager);
  };

  beforeEach(async () => {
    useDaemon = true;
    authMode = 'browser';
    restarts = 0; rmCalls = 0;
    shownErrors.length = 0;
    rmMock.mockClear();
    // A real endpoint so `healthy:true` means the release genuinely succeeds —
    // otherwise every case here would escalate for the wrong reason.
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as import('net').AddressInfo).port;
  });

  afterEach(async () => {
    if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
  });

  it('wipe blocked, then freed by the restart: retried and reported as dropped', async () => {
    rmMock.mockImplementation(async () => {
      rmCalls++;
      if (rmCalls === 1) throw busy();   // daemon's Chromium still holds the dir
    });

    const result = await make().logout();

    expect(restarts).toBe(1);                          // escalation ran
    expect(rmCalls).toBe(2);                           // and the wipe was retried after it
    expect(result.daemonSessionDropped).toBe(true);    // profile really is gone now
  });

  it('a wipe that keeps failing is NEVER reported as a dropped session', async () => {
    rmMock.mockImplementation(async () => { rmCalls++; throw busy(); });

    const result = await make().logout();

    // The daemon side succeeded — but the cookies are still on disk and the next
    // daemon would log itself straight back in.
    expect(result.daemonSessionDropped).toBe(false);
    expect(rmCalls).toBe(2);
    expect(restarts).toBe(1);
  });

  it('a failed wipe escalates even when the browser release WAS confirmed', async () => {
    rmMock.mockImplementation(async () => { rmCalls++; throw busy(); });

    // healthy daemon + a release that would normally need no escalation in
    // browser mode: the stuck profile alone must still force the restart.
    const result = await make({ healthy: true }).logout();

    expect(restarts).toBe(1);
    expect(result.daemonSessionDropped).toBe(false);
  });

  it('does not retry when the first wipe succeeded', async () => {
    rmMock.mockImplementation(async () => { rmCalls++; });
    const result = await make({ healthy: true }).logout();
    expect(rmCalls).toBe(1);
    expect(restarts).toBe(0);
    expect(result.daemonSessionDropped).toBe(true);
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
    // "Logged out and session cleared" must be conditional on the daemon drop —
    // an unconditional success toast is the lie this whole task exists to remove.
    expect(handler).toMatch(/daemonSessionDropped/);
    expect(handler).toMatch(/showWarningMessage/);
  });

  it('no credential-clearing path bypasses logout()', () => {
    // A second, weaker "clear the secrets" helper is how the daemon kept serving a
    // logged-out session in the first place. logout() is the only method that may
    // delete the credential triplet.
    const am = src('mcp/auth-manager.ts');
    const deletions = am.match(/secrets\.delete\(SECRET_EMAIL\)/g) ?? [];
    expect(deletions).toHaveLength(1);   // only logout() deletes the triplet
    expect(am).not.toMatch(/async clearCredentials\s*\(/);
  });

  it('the dashboard action delegates (and no longer needs its own drop)', () => {
    const body = src('webview/DashboardProvider.ts').split("msg.type === 'action:logout'")[1] ?? '';
    const handler = body.slice(0, body.indexOf("msg.type === 'action:manualLogin'"));
    expect(handler).toMatch(/authManager!?\.?logout\(\)/);
    expect(handler).not.toMatch(/secrets\.delete|fs\.rm|restartDaemon/);
  });
});
