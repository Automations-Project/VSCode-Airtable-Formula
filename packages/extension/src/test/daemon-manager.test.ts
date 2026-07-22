import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock vscode before importing modules that depend on it
vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  Disposable: vi.fn(),
  McpHttpServerDefinition: undefined,
  // buildDaemonEnv reads mcp.authMode / mcp.httpClient off the workspace config;
  // return the caller-supplied default so the base env stays at its defaults.
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    })),
  },
}));

// RED state — DaemonManager import will fail (module not yet created in 05-06-PLAN.md)
// and createHttpDefinition is not yet exported from registration.ts (05-07-PLAN.md).
import { DaemonManager } from '../mcp/daemon-manager.js';
import { createHttpDefinition } from '../mcp/registration.js';

// Test scaffolds for EXT-01 (HTTP definition duck-type) and EXT-03 (buildDaemonEnv)
// Requirements: DAEMON-01, DAEMON-03, DAEMON-07, EXT-01, EXT-03

describe('DaemonManager.buildDaemonEnv', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'test-daemon-manager-' + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  it('includes AIRTABLE_USER_MCP_HOME set to configDir', () => {
    const result = dm.buildDaemonEnv();
    expect(result.AIRTABLE_USER_MCP_HOME).toBe(tmpDir);
  });

  it('includes AIRTABLE_HEADLESS_ONLY equal to "1"', () => {
    const result = dm.buildDaemonEnv();
    expect(result.AIRTABLE_HEADLESS_ONLY).toBe('1');
  });

  it('sets ELECTRON_RUN_AS_NODE=1 so the Electron host binary runs the daemon as Node', () => {
    // process.execPath in the extension host is the editor's Electron binary;
    // without this flag the spawned child launches the editor instead of the
    // daemon → no lockfile → "Timed out waiting for daemon startup".
    const result = dm.buildDaemonEnv();
    expect(result.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('never injects credential keys into the daemon env (creds go via the endpoint, not env)', () => {
    const result = dm.buildDaemonEnv();
    // The daemon must NEVER receive credentials in its environment — they reach
    // a running daemon only over the bearer-authed /daemon/auth-credentials
    // endpoint (pushAuthCredentials). buildDaemonEnv is transport/config only.
    expect(result.AIRTABLE_EMAIL).toBeUndefined();
    expect(result.AIRTABLE_PASSWORD).toBeUndefined();
    expect(result.AIRTABLE_TOTP_SECRET).toBeUndefined();
    expect(result.AIRTABLE_OTP_SECRET).toBeUndefined();
    expect(result.AIRTABLE_COOKIE).toBeUndefined();
    expect(result.AIRTABLE_CSRF).toBeUndefined();
  });

  it('injects AIRTABLE_BROWSER_IDLE_PARK_MS from browserIdleParkMinutes (default 30 → 1800000)', () => {
    const result = dm.buildDaemonEnv();
    expect(result.AIRTABLE_BROWSER_IDLE_PARK_MS).toBe(String(30 * 60_000));
  });
});

describe('DaemonManager.getDaemonStatus', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'test-daemon-status-' + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  it('returns running:false when daemon.lock does not exist in configDir', async () => {
    const status = await dm.getDaemonStatus();
    expect(status.running).toBe(false);
  });

  const writeLock = (pid: number, port = 8723) => {
    fs.writeFileSync(path.join(tmpDir, 'daemon.lock'), JSON.stringify({
      pid, uuid: 'uuid-1', port, port_lsp: null, bearerToken: 'tok',
      version: '0.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    }));
  };

  it('flags a STALE lock (dead pid) so ensureDaemon can respawn, without a wasted health fetch', async () => {
    // Regression: a crashed daemon leaves a lockfile with a dead pid. getDaemonStatus used to report
    // running:true/healthy:false for it → ensureDaemon could neither return (unhealthy) nor spawn
    // (its branch required !running) → "Timed out waiting for daemon startup". Now `stale:true` lets
    // ensureDaemon spawn a replacement while `running` stays true so stopDaemon can still reclaim.
    writeLock(999999);
    (dm as any)._isPidAlive = vi.fn(() => false);
    const healthSpy = vi.fn(async () => true);
    (dm as any)._httpHealthCheck = healthSpy;
    const status = await dm.getDaemonStatus();
    expect(status.stale).toBe(true);
    expect(status.running).toBe(true);
    expect(status.healthy).toBe(false);
    expect((dm as any)._isPidAlive).toHaveBeenCalledWith(999999);
    expect(healthSpy).not.toHaveBeenCalled(); // no 2s fetch to a known-dead daemon
  });

  it('keeps stale:false / running:true for a LIVE pid even when unhealthy (a still-starting daemon must not be culled)', async () => {
    writeLock(4242);
    (dm as any)._isPidAlive = vi.fn(() => true);
    (dm as any)._httpHealthCheck = vi.fn(async () => false); // not yet serving
    const status = await dm.getDaemonStatus();
    expect(status.running).toBe(true);
    expect(status.stale).toBe(false);
    expect(status.healthy).toBe(false);
  });
});

describe('DaemonManager.probeHealth', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'test-daemon-probe-' + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  it('returns false when getDaemonStatus returns running:false', async () => {
    // No daemon.lock in tmpDir — getDaemonStatus returns running:false
    const result = await dm.probeHealth();
    expect(result).toBe(false);
  });
});

describe('DaemonManager.stopDaemon', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;
  let server: import('http').Server | undefined;

  const writeLock = (port: number, pid = process.pid, token = 'test-token') => {
    fs.writeFileSync(path.join(tmpDir, 'daemon.lock'), JSON.stringify({
      pid, uuid: 'uuid-1', port, port_lsp: null, bearerToken: token,
      version: '0.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    }));
  };
  const lockExists = () => fs.existsSync(path.join(tmpDir, 'daemon.lock'));

  const listen = async (handler: import('http').RequestListener): Promise<number> => {
    const http = await import('http');
    server = http.createServer(handler);
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    return (server!.address() as import('net').AddressInfo).port;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-daemon-stop-'));
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  afterEach(async () => {
    if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns stopped:true immediately when no lockfile exists', async () => {
    const result = await dm.stopDaemon();
    expect(result.stopped).toBe(true);
    expect(result.forced).toBe(false);
  });

  it('graceful: waits for the daemon to release its lockfile before resolving', async () => {
    const port = await listen((req, res) => {
      if (req.method === 'POST' && req.url === '/daemon/shutdown') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        // Simulate the daemon releasing the lock shortly after replying
        setTimeout(() => fs.rmSync(path.join(tmpDir, 'daemon.lock'), { force: true }), 150);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    writeLock(port);

    const result = await dm.stopDaemon();
    expect(result.stopped).toBe(true);
    expect(result.forced).toBe(false);
    expect(lockExists()).toBe(false);
  });

  it('rejected shutdown with PROVEN identity (health echoes lock uuid): escalates to kill', async () => {
    const port = await listen((req, res) => {
      if (req.method === 'GET' && req.url === '/daemon/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uuid: 'uuid-1' }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"Unauthorized"}');
    });
    writeLock(port, 12345, 'stale-token');

    let killed = false;
    (dm as any)._killPid = vi.fn(() => { killed = true; });
    (dm as any)._isPidAlive = vi.fn(() => !killed);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).toHaveBeenCalledWith(12345);
    expect(result.stopped).toBe(true);
    expect(result.forced).toBe(true);
    expect(lockExists()).toBe(false);
  });

  it('rejected shutdown WITHOUT proven identity: does NOT kill (PID reuse), reclaims the lock', async () => {
    // Simulates a stale lock whose port was reused by an unrelated HTTP
    // service: it answers (non-2xx) but cannot echo the lockfile uuid.
    const port = await listen((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found"}');
    });
    writeLock(port, process.pid);

    (dm as any)._killPid = vi.fn();
    (dm as any)._isPidAlive = vi.fn(() => true);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(lockExists()).toBe(false);
  });

  it('accepted shutdown from an impostor (2xx, no uuid proof): does NOT kill, reclaims the lock', async () => {
    // A catch-all local service can 200 a POST /daemon/shutdown while
    // ignoring the bearer header — and it will never release our lockfile.
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': req.url === '/daemon/health' ? 'text/html' : 'application/json' });
      res.end(req.url === '/daemon/health' ? '<html>not the daemon</html>' : '{"ok":true}');
    });
    writeLock(port, process.pid);
    (dm as any)._stopWaitMs = 300;
    (dm as any)._killPid = vi.fn();
    (dm as any)._isPidAlive = vi.fn(() => true);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(lockExists()).toBe(false);
  });

  it('accepted shutdown but wedged daemon (uuid proven): escalates to kill', async () => {
    const port = await listen((req, res) => {
      if (req.method === 'GET' && req.url === '/daemon/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uuid: 'uuid-1' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      // Wedged: never releases the lockfile
    });
    writeLock(port, 23456);
    (dm as any)._stopWaitMs = 300;
    let killed = false;
    (dm as any)._killPid = vi.fn(() => { killed = true; });
    (dm as any)._isPidAlive = vi.fn(() => !killed);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).toHaveBeenCalledWith(23456);
    expect(result.stopped).toBe(true);
    expect(result.forced).toBe(true);
    expect(lockExists()).toBe(false);
  });

  it('unreachable daemon with dead pid: reclaims the stale lock without killing anything', async () => {
    writeLock(1, 999_999); // port 1 — nothing listening
    (dm as any)._killPid = vi.fn();
    (dm as any)._isPidAlive = vi.fn(() => false);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
    expect(lockExists()).toBe(false);
  });

  it('unreachable daemon with live pid: does NOT kill (PID-reuse safety) but reclaims the lock', async () => {
    writeLock(1, process.pid);
    (dm as any)._killPid = vi.fn();
    (dm as any)._isPidAlive = vi.fn(() => true);

    const result = await dm.stopDaemon();
    expect((dm as any)._killPid).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(lockExists()).toBe(false);
  });
});

describe('DaemonManager.forceStop', () => {
  it('sweeps orphaned processes after the lock-based stop and reports the count', async () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    (dm as any).stopDaemon = vi.fn(async () => ({ stopped: true, forced: false }));
    (dm as any)._sweepOrphans = vi.fn(() => 3);
    (dm as any)._reclaimLockfile = vi.fn();

    const r = await dm.forceStop();
    expect((dm as any)._sweepOrphans).toHaveBeenCalled();
    expect(r.stopped).toBe(true);
    expect(r.forced).toBe(true);
    expect(r.reason).toMatch(/3/);
  });

  it('returns the lock-based result unchanged when nothing stray is found', async () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    (dm as any).stopDaemon = vi.fn(async () => ({ stopped: true, forced: false }));
    (dm as any)._sweepOrphans = vi.fn(() => 0);
    (dm as any)._reclaimLockfile = vi.fn();

    const r = await dm.forceStop();
    expect(r.forced).toBe(false);
  });
});

describe('DaemonManager._parsePids', () => {
  it('extracts unique positive pids from wmic /format:list output', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    const out = 'ProcessId=1234\r\n\r\nProcessId=5678\r\n\r\nProcessId=1234\r\n';
    expect((dm as any)._parsePids(out)).toEqual([1234, 5678]);
  });

  it('returns empty array when there are no matches', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    expect((dm as any)._parsePids('No Instance(s) Available.')).toEqual([]);
  });
});

describe('DaemonManager.restartDaemon', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-daemon-restart-'));
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aborts (throws) when the running daemon could not be stopped', async () => {
    (dm as any).stopDaemon = vi.fn(async () => ({ stopped: false, forced: true, reason: 'process 1 did not exit' }));
    (dm as any)._spawnDetached = vi.fn();
    await expect(dm.restartDaemon()).rejects.toThrow(/could not be stopped/);
    expect((dm as any)._spawnDetached).not.toHaveBeenCalled();
  });
});

describe('DaemonManager user-stopped latch', () => {
  let tmpDir: string;
  let dm: InstanceType<typeof DaemonManager>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-daemon-latch-'));
    dm = new DaemonManager(tmpDir, '/tmp/test-ext-path');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('implicit ensureDaemon refuses to respawn after an explicit stop', async () => {
    (dm as any)._spawnDetached = vi.fn();
    await dm.stopDaemon(); // no lock — still sets the latch
    await expect(dm.ensureDaemon({ implicit: true, timeoutMs: 500 })).rejects.toThrow(/stopped/i);
    expect((dm as any)._spawnDetached).not.toHaveBeenCalled();
  });

  it('explicit ensureDaemon clears the latch and attempts a spawn', async () => {
    // _spawnDetached returns Promise<void>; ensureDaemon's single-flight guard calls .finally() on it.
    (dm as any)._spawnDetached = vi.fn().mockResolvedValue(undefined);
    await dm.stopDaemon();
    await expect(dm.ensureDaemon({ timeoutMs: 400 })).rejects.toThrow(/Timed out/);
    expect((dm as any)._spawnDetached).toHaveBeenCalled();
    // Latch cleared — implicit calls may spawn again now
    await expect(dm.ensureDaemon({ implicit: true, timeoutMs: 400 })).rejects.toThrow(/Timed out/);
  });

  it('concurrent ensureDaemon calls share ONE spawn (suppression window)', async () => {
    // The runaway-daemon bug: N overlapping ensureDaemon() callers each spawned a daemon. The
    // suppression window must collapse them to a single _spawnDetached() while no daemon is up.
    // The mock resolves immediately and never brings a daemon "up", so each call polls to its
    // deadline then rejects — but only the first attempt inside the window actually spawns.
    let spawns = 0;
    (dm as any)._spawnDetached = vi.fn(async () => { spawns++; });
    await Promise.all([
      dm.ensureDaemon({ timeoutMs: 300 }).catch(() => {}),
      dm.ensureDaemon({ timeoutMs: 300 }).catch(() => {}),
      dm.ensureDaemon({ timeoutMs: 300 }).catch(() => {}),
    ]);
    expect(spawns).toBe(1);
  });

  it('ensureDaemon SPAWNS when the lockfile is STALE (dead pid) instead of wedging → "Timed out"', async () => {
    // THE "Daemon start failed: Timed out" bug: a crash leaves a lockfile with a dead pid. ensureDaemon
    // must spawn a replacement (which reclaims the stale lock) rather than treating the corpse as a
    // running daemon and polling forever.
    fs.writeFileSync(path.join(tmpDir, 'daemon.lock'), JSON.stringify({
      pid: 999999, uuid: 'u', port: 8723, port_lsp: null, bearerToken: 't',
      version: '0.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    }));
    (dm as any)._isPidAlive = vi.fn(() => false); // dead → stale
    const spy = vi.fn().mockResolvedValue(undefined);
    (dm as any)._spawnDetached = spy;
    await expect(dm.ensureDaemon({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
    expect(spy).toHaveBeenCalled(); // it spawned; did NOT wedge on the stale lock
  });

  it('EXPLICIT ensureDaemon within the suppression window still spawns (window is reset at entry)', async () => {
    // Simulate "just spawned" — inside SPAWN_SUPPRESS_MS of now.
    (dm as any)._lastSpawnAt = Date.now();
    const spy = vi.fn().mockResolvedValue(undefined);
    (dm as any)._spawnDetached = spy;

    // Explicit call (no implicit:true) must reset _lastSpawnAt to 0 at entry, so
    // it spawns immediately instead of being throttled by the window. The stub
    // never brings a daemon up, so the call times out regardless — what matters
    // is that the spawn was attempted.
    await expect(dm.ensureDaemon({ timeoutMs: 300 })).rejects.toThrow(/Timed out/);
    expect(spy).toHaveBeenCalled();
  });

  it('IMPLICIT ensureDaemon within the suppression window stays suppressed', async () => {
    (dm as any)._lastSpawnAt = Date.now();
    const spy = vi.fn().mockResolvedValue(undefined);
    (dm as any)._spawnDetached = spy;

    // Implicit callers keep the window — this is what breaks the runaway spawn
    // loop. Not user-stopped, so it doesn't hit the latch-throw path; it should
    // simply poll to the deadline and time out WITHOUT ever spawning.
    await expect(dm.ensureDaemon({ implicit: true, timeoutMs: 300 })).rejects.toThrow(/Timed out/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createHttpDefinition', () => {
  it('returns null when McpHttpServerDefinition is not on vscode namespace', () => {
    // vscode mock does not include McpHttpServerDefinition — expect null
    const result = createHttpDefinition('http://127.0.0.1:3000/mcp', 'Bearer test-token');
    expect(result).toBeNull();
  });

  it('calls constructor with url and headers object when McpHttpServerDefinition present', async () => {
    // Temporarily add McpHttpServerDefinition to the vscode mock
    const mockCtor = vi.fn(() => ({}));
    const vscodeModule = await import('vscode');
    (vscodeModule as unknown as Record<string, unknown>).McpHttpServerDefinition = mockCtor;

    const result = createHttpDefinition('http://127.0.0.1:3000/mcp', 'Bearer test-token');
    expect(result).not.toBeNull();
    expect(mockCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://127.0.0.1:3000/mcp',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'x-airtable-client-id': 'vscode-airtable-formula',
        }),
      })
    );

    // Clean up
    delete (vscodeModule as unknown as Record<string, unknown>).McpHttpServerDefinition;
  });

  it('allows overriding client id', async () => {
    const mockCtor = vi.fn(() => ({}));
    const vscodeModule = await import('vscode');
    (vscodeModule as unknown as Record<string, unknown>).McpHttpServerDefinition = mockCtor;

    createHttpDefinition('http://127.0.0.1:3000/mcp', 'Bearer t', 'custom-window');
    expect(mockCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-airtable-client-id': 'custom-window' }),
      }),
    );

    delete (vscodeModule as unknown as Record<string, unknown>).McpHttpServerDefinition;
  });
});
