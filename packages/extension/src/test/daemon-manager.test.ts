import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// `execFileSync` is the ONLY process-control primitive the orphan sweep reaches for
// (process listing on both platforms + taskkill on Windows). Mock just that binding and
// leave the rest of child_process real — `spawn` is still used by _spawnDetached.
const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn((..._args: unknown[]): string => ''),
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: execFileSyncMock };
});

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
    (dm as any)._sweepOrphans = vi.fn(() => ({ killed: [11, 22, 33], skipped: [] }));
    (dm as any)._reclaimLockfile = vi.fn();

    const r = await dm.forceStop();
    expect((dm as any)._sweepOrphans).toHaveBeenCalled();
    expect(r.stopped).toBe(true);
    expect(r.forced).toBe(true);
    expect(r.reason).toMatch(/3/);
    expect(r.killedOrphans).toEqual([11, 22, 33]);
    expect(r.skippedUnowned).toEqual([]);
  });

  it('returns the lock-based result unchanged when nothing stray is found', async () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    (dm as any).stopDaemon = vi.fn(async () => ({ stopped: true, forced: false }));
    (dm as any)._sweepOrphans = vi.fn(() => ({ killed: [], skipped: [] }));
    (dm as any)._reclaimLockfile = vi.fn();

    const r = await dm.forceStop();
    expect(r.forced).toBe(false);
    expect(r.reason).toBeUndefined();
    expect(r.killedOrphans).toEqual([]);
    expect(r.skippedUnowned).toEqual([]);
  });

  it('surfaces unowned-but-daemon-looking processes through StopResult without claiming they were killed', async () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    (dm as any).stopDaemon = vi.fn(async () => ({ stopped: true, forced: false }));
    (dm as any)._sweepOrphans = vi.fn(() => ({
      killed: [],
      skipped: [{ pid: 4242, commandLine: 'node /opt/other/index.mjs daemon start' }],
    }));
    (dm as any)._reclaimLockfile = vi.fn();

    const r = await dm.forceStop();
    // Nothing was killed → not "forced".
    expect(r.forced).toBe(false);
    expect(r.killedOrphans).toEqual([]);
    expect(r.skippedUnowned).toEqual([{ pid: 4242, commandLine: 'node /opt/other/index.mjs daemon start' }]);
    expect(r.reason).toMatch(/left running/i);
    expect(r.reason).toMatch(/4242/);
  });
});

describe('DaemonManager._parseProcessList', () => {
  it('extracts unique positive pids + command lines from PowerShell tab-separated output', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    const out = '1234\tC:\\a\\index.mjs daemon start\r\n5678\tchrome.exe --x\r\n1234\tdupe\r\n';
    expect((dm as any)._parseProcessList(out)).toEqual([
      { pid: 1234, commandLine: 'C:\\a\\index.mjs daemon start' },
      { pid: 5678, commandLine: 'chrome.exe --x' },
    ]);
  });

  it('extracts pids + args from `ps -A -o pid= -o args=` space-separated output', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    const out = '  901 node /opt/a/index.mjs daemon start\n 1002 /usr/bin/chrome --user-data-dir=/x\n';
    expect((dm as any)._parseProcessList(out)).toEqual([
      { pid: 901, commandLine: 'node /opt/a/index.mjs daemon start' },
      { pid: 1002, commandLine: '/usr/bin/chrome --user-data-dir=/x' },
    ]);
  });

  it('returns empty array when there are no matches', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    expect((dm as any)._parseProcessList('No Instance(s) Available.')).toEqual([]);
    expect((dm as any)._parseProcessList('')).toEqual([]);
  });

  it('never yields our own pid (self-kill guard at the parse boundary)', () => {
    const dm = new DaemonManager('/tmp/x', '/tmp/y');
    const out = `${process.pid}\tnode /tmp/y/dist/mcp/index.mjs daemon start\n77\tother\n`;
    expect((dm as any)._parseProcessList(out)).toEqual([{ pid: 77, commandLine: 'other' }]);
  });
});

/**
 * B4 — ownership-scoped orphan sweep.
 *
 * The sweep used to kill by an UNSCOPED command-line substring match
 * (`%index.mjs%daemon%start%` / `index\.mjs.*daemon.*start`) and escalate with
 * `taskkill /T /F` — force-killing an unrelated Node process *and its whole process tree*
 * whenever its argv merely contained those fragments. These tests pin the replacement:
 * kill ONLY on positive attribution to this extension install; report everything else.
 */
describe('DaemonManager._sweepOrphans — ownership-scoped matching', () => {
  const WIN_ROOT = 'C:\\Users\\admin\\.vscode\\extensions\\nskha.airtable-formula-2.1.32';
  const POSIX_ROOT = '/home/u/.vscode/extensions/nskha.airtable-formula-2.1.32';

  /**
   * Build a manager whose process listing is fixed and whose kill primitive is recorded.
   * `_listProcesses` and `_killTree` are the two process primitives — everything else is
   * pure matching logic running for real.
   */
  const sweep = (
    extensionPath: string,
    processes: Array<{ pid: number; commandLine: string }>,
    platform: NodeJS.Platform = 'win32',
  ) => {
    const dm = new DaemonManager('/tmp/cfg', extensionPath);
    const listed = vi.fn(() => processes);
    const killTree = vi.fn();
    (dm as any)._listProcesses = listed;
    (dm as any)._killTree = killTree;
    const result = (dm as any)._sweepOrphans(platform) as {
      killed: number[];
      skipped: Array<{ pid: number; commandLine: string }>;
    };
    return { result, killTree, killedPids: killTree.mock.calls.map(c => c[0] as number) };
  };

  // ── Positive: the real bundled path this install spawns ────────────────────

  it('POSITIVE (Windows): kills the process running THIS install\'s bundled dist\\mcp\\index.mjs', () => {
    const { result, killedPids } = sweep(WIN_ROOT, [
      { pid: 4001, commandLine: `"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${WIN_ROOT}\\dist\\mcp\\index.mjs" daemon start` },
    ]);
    expect(killedPids).toEqual([4001]);
    expect(result.killed).toEqual([4001]);
    expect(result.skipped).toEqual([]);
  });

  it('POSITIVE (POSIX): kills the `/`-separated equivalent', () => {
    const { result, killedPids } = sweep(
      POSIX_ROOT,
      [{ pid: 4002, commandLine: `node ${POSIX_ROOT}/dist/mcp/index.mjs daemon start` }],
      'linux',
    );
    expect(killedPids).toEqual([4002]);
    expect(result.killed).toEqual([4002]);
    expect(result.skipped).toEqual([]);
  });

  it('POSITIVE (Windows): matches case-insensitively and across \\ vs / separators', () => {
    const { killedPids } = sweep(WIN_ROOT, [
      // Windows argv can arrive with either separator and any casing — both are the same file.
      { pid: 4003, commandLine: `code.exe C:/USERS/ADMIN/.VSCODE/EXTENSIONS/NSKHA.AIRTABLE-FORMULA-2.1.32/DIST/MCP/INDEX.MJS daemon start` },
    ]);
    expect(killedPids).toEqual([4003]);
  });

  it('POSITIVE: a quoted argv path (spaces in the install root) still matches', () => {
    const spaced = 'C:\\Users\\a b\\.vscode\\extensions\\nskha.airtable-formula-2.1.32';
    const { killedPids } = sweep(spaced, [
      { pid: 4004, commandLine: `"C:\\Code.exe" "${spaced}\\dist\\mcp\\index.mjs" daemon start` },
    ]);
    expect(killedPids).toEqual([4004]);
  });

  // ── Negative: the exact cases the old unscoped pattern force-killed ─────────

  it('NEGATIVE (Windows): an unrelated project\'s `index.mjs --daemon start` is NOT killed and IS reported as unowned', () => {
    const cmd = 'node C:\\other\\project\\dist\\index.mjs --daemon start';
    const { result, killTree } = sweep(WIN_ROOT, [{ pid: 5001, commandLine: cmd }]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped).toEqual([{ pid: 5001, commandLine: cmd }]);
  });

  it('NEGATIVE (POSIX): `node /opt/other/index.mjs daemon start` is NOT killed and IS reported as unowned', () => {
    const cmd = 'node /opt/other/index.mjs daemon start';
    const { result, killTree } = sweep(POSIX_ROOT, [{ pid: 5002, commandLine: cmd }], 'linux');
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped).toEqual([{ pid: 5002, commandLine: cmd }]);
  });

  it('NEGATIVE (adjacent name): `…/dist/mcp/index.mjs.bak` and a sibling install root are NOT killed', () => {
    const sibling = 'C:\\Users\\admin\\.vscode\\extensions\\nskha.airtable-formula-2.1.31';
    const { result, killTree } = sweep(WIN_ROOT, [
      // Longer filename that merely STARTS with our entry path.
      { pid: 5003, commandLine: `node ${WIN_ROOT}\\dist\\mcp\\index.mjs.bak daemon start` },
      { pid: 5004, commandLine: `node ${WIN_ROOT}\\dist\\mcp\\index.mjson daemon start` },
      // A different extension install root (previous version) — not ours to kill.
      { pid: 5005, commandLine: `node ${sibling}\\dist\\mcp\\index.mjs daemon start` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped.map(p => p.pid)).toEqual([5003, 5004, 5005]);
  });

  it('FAIL-SAFE: a matched-but-unverifiable process is left ALIVE and appears in the skipped report', () => {
    // Looks exactly like our daemon (Electron host + dist/mcp/index.mjs + daemon start) but the
    // install root is somebody else's. Ambiguity must resolve to NOT killing.
    const cmd = 'Code.exe D:\\somewhere\\else\\dist\\mcp\\index.mjs daemon start';
    const { result, killTree } = sweep(WIN_ROOT, [{ pid: 5006, commandLine: cmd }]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped).toEqual([{ pid: 5006, commandLine: cmd }]);
  });

  it('FAIL-SAFE: an empty / relative extensionPath yields NO bundled-path kills (no bare `dist/mcp/index.mjs` match)', () => {
    for (const root of ['', '   ', 'dist-relative', './rel']) {
      const { result, killTree } = sweep(root, [
        { pid: 5007, commandLine: 'node dist/mcp/index.mjs daemon start' },
        { pid: 5008, commandLine: 'node /srv/app/dist/mcp/index.mjs daemon start' },
      ], 'linux');
      expect(killTree).not.toHaveBeenCalled();
      expect(result.killed).toEqual([]);
      expect(result.skipped.map(p => p.pid)).toEqual([5007, 5008]);
    }
  });

  it('never kills our own pid even if its command line would match', () => {
    const { result, killTree } = sweep(WIN_ROOT, [
      { pid: process.pid, commandLine: `node ${WIN_ROOT}\\dist\\mcp\\index.mjs daemon start` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
  });

  it('reports nothing for ordinary processes (no false "unowned" noise)', () => {
    const { result, killTree } = sweep(WIN_ROOT, [
      { pid: 6001, commandLine: 'C:\\Windows\\explorer.exe' },
      { pid: 6002, commandLine: 'node C:\\proj\\server.js --start' },
      { pid: 6003, commandLine: '"C:\\Program Files\\Google\\Chrome\\chrome.exe" --user-data-dir=C:\\Users\\admin\\AppData\\Local\\Google\\Chrome' },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('returns an empty result (killing nothing) when process enumeration fails', () => {
    const dm = new DaemonManager('/tmp/cfg', WIN_ROOT);
    (dm as any)._listProcesses = vi.fn(() => { throw new Error('powershell.exe not found'); });
    const killTree = vi.fn();
    (dm as any)._killTree = killTree;
    expect((dm as any)._sweepOrphans('win32')).toEqual({ killed: [], skipped: [] });
    expect(killTree).not.toHaveBeenCalled();
  });

  // ── Chrome-profile pattern — already correctly scoped, must NOT regress ─────

  it('CHROME PROFILE: still kills a Chromium squatting ~/.airtable-user-mcp/.chrome-profile (Windows)', () => {
    const { result, killedPids } = sweep(WIN_ROOT, [
      { pid: 7001, commandLine: '"C:\\Program Files\\Google\\Chrome\\chrome.exe" --user-data-dir=C:\\Users\\admin\\.airtable-user-mcp\\.chrome-profile --headless' },
    ]);
    expect(killedPids).toEqual([7001]);
    expect(result.killed).toEqual([7001]);
  });

  it('CHROME PROFILE: still kills the POSIX equivalent, including helper processes', () => {
    const { killedPids } = sweep(POSIX_ROOT, [
      { pid: 7002, commandLine: '/opt/chromium --user-data-dir=/home/u/.airtable-user-mcp/.chrome-profile' },
      { pid: 7003, commandLine: '/opt/chromium --type=renderer --user-data-dir=/home/u/.airtable-user-mcp/.chrome-profile' },
    ], 'linux');
    expect(killedPids).toEqual([7002, 7003]);
  });

  it('CHROME PROFILE: NOT widened — `.chrome-profile` alone, or `.airtable-user-mcp` alone, never kills', () => {
    const { result, killTree } = sweep(WIN_ROOT, [
      // Some other app's Chrome profile dir.
      { pid: 7004, commandLine: 'chrome.exe --user-data-dir=C:\\Users\\admin\\.other-app\\.chrome-profile' },
      // The user simply has our CONFIG file open in an editor / tailing a log.
      { pid: 7005, commandLine: 'Code.exe C:\\Users\\admin\\.airtable-user-mcp\\tools-config.json' },
      // Right fragments, WRONG ORDER — the original filter was ordered, keep it ordered.
      { pid: 7006, commandLine: 'chrome.exe --user-data-dir=C:\\x\\.chrome-profile\\.airtable-user-mcp' },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  // ── Metacharacters in the install path must not change match semantics ──────

  it('ESCAPING: a path containing % _ [ ] . and a space matches literally and nothing else', () => {
    // Every character here is a metacharacter in at least one of the languages the old
    // implementation interpolated the path into: WQL LIKE (`%`, `_`, `[`) or a pkill ERE
    // (`.`, `[`, `\`). If any of them were still interpreted, the near-misses below would match.
    const root = 'C:\\Users\\a b\\.vscode\\extensions\\pub.name-1.0_x[1]%';
    const { result, killedPids } = sweep(root, [
      { pid: 8001, commandLine: `"C:\\Code.exe" "${root}\\dist\\mcp\\index.mjs" daemon start` },
      // `.` interpreted as regex "any char"
      { pid: 8002, commandLine: `node C:\\Users\\a b\\.vscode\\extensions\\pubXname-1.0_x[1]%\\dist\\mcp\\index.mjs daemon start` },
      // `[1]` interpreted as a regex/WQL character class matching `1`
      { pid: 8003, commandLine: `node C:\\Users\\a b\\.vscode\\extensions\\pub.name-1.0_x1%\\dist\\mcp\\index.mjs daemon start` },
      // `_` interpreted as the WQL single-character wildcard
      { pid: 8004, commandLine: `node C:\\Users\\a b\\.vscode\\extensions\\pub.name-1.0Zx[1]%\\dist\\mcp\\index.mjs daemon start` },
      // `%` interpreted as the WQL multi-character wildcard
      { pid: 8005, commandLine: `node C:\\Users\\a b\\.vscode\\extensions\\pub.name-1.0_x[1]-AND-MORE\\dist\\mcp\\index.mjs daemon start` },
    ]);
    expect(killedPids).toEqual([8001]);
    expect(result.killed).toEqual([8001]);
    expect(result.skipped.map(p => p.pid)).toEqual([8002, 8003, 8004, 8005]);
  });
});

describe('DaemonManager._listProcesses / _killTree — process primitives', () => {
  const ROOT = 'C:\\Users\\admin\\.vscode\\extensions\\pub.name-1.0_x[1]%';

  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('');
  });

  it('Windows: enumerates via Get-CimInstance and never interpolates the install path into the script', () => {
    const dm = new DaemonManager('/tmp/cfg', ROOT);
    execFileSyncMock.mockReturnValue('4001\tCode.exe x\\dist\\mcp\\index.mjs daemon start\r\n');

    const listed = (dm as any)._listProcesses('win32');
    expect(listed).toEqual([{ pid: 4001, commandLine: 'Code.exe x\\dist\\mcp\\index.mjs daemon start' }]);

    const [file, args, opts] = execFileSyncMock.mock.calls[0] as [string, string[], any];
    expect(file).toBe('powershell.exe');
    // wmic is deprecated/absent on recent Windows — the codebase's process-tree.js uses CIM.
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    const script = args[args.indexOf('-Command') + 1];
    expect(script).toContain('Get-CimInstance Win32_Process');
    expect(script).not.toContain('wmic');
    // THE escaping guarantee: no part of the install path reaches the script text, so
    // `%`, `_`, `[`, `.`, `\` and spaces cannot alter match semantics or inject script.
    expect(script).not.toContain(ROOT);
    expect(script).not.toContain('pub.name');
    expect(script).not.toContain('[1]');
    expect(script).not.toContain('%');
    // Pre-filter markers travel via the environment as fixed lower-case literals.
    expect(opts.env.AIRTABLE_SWEEP_MARK_A).toBe('index.mjs');
    expect(opts.env.AIRTABLE_SWEEP_MARK_B).toBe('.chrome-profile');
    expect(opts.windowsHide).toBe(true);
  });

  it('POSIX: enumerates via `ps` with a fixed argv (nothing interpolated, no pkill pattern)', () => {
    const dm = new DaemonManager('/tmp/cfg', '/opt/ext');
    execFileSyncMock.mockReturnValue(' 901 node /opt/ext/dist/mcp/index.mjs daemon start\n');

    const listed = (dm as any)._listProcesses('linux');
    expect(listed).toEqual([{ pid: 901, commandLine: 'node /opt/ext/dist/mcp/index.mjs daemon start' }]);

    const [file, args] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(file).toBe('ps');
    expect(args).toEqual(['-A', '-ww', '-o', 'pid=', '-o', 'args=']);
    // The old implementation shelled out to `pkill -9 -f '<pattern>'`, which both killed by
    // regex and could not report what it hit. It must be gone.
    expect(execFileSyncMock.mock.calls.some(c => c[0] === 'pkill')).toBe(false);
  });

  it('Windows: kills a positively-owned pid with taskkill /T /F', () => {
    const dm = new DaemonManager('/tmp/cfg', ROOT);
    (dm as any)._killTree(4321, 'win32');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'taskkill', ['/PID', '4321', '/T', '/F'], expect.objectContaining({ windowsHide: true }),
    );
  });

  it('refuses to kill our own pid or a non-positive pid', () => {
    const dm = new DaemonManager('/tmp/cfg', ROOT);
    (dm as any)._killTree(process.pid, 'win32');
    (dm as any)._killTree(0, 'win32');
    (dm as any)._killTree(-1, 'win32');
    expect(execFileSyncMock).not.toHaveBeenCalled();
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
