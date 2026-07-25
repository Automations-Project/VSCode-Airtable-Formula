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
  /** configDir (`AIRTABLE_USER_MCP_HOME`) — `<configDir>/.chrome-profile` is the owned profile. */
  const WIN_CFG = 'C:\\Users\\admin\\.airtable-user-mcp';
  const POSIX_CFG = '/home/u/.airtable-user-mcp';
  const WIN_PROFILE = `${WIN_CFG}\\.chrome-profile`;
  const POSIX_PROFILE = `${POSIX_CFG}/.chrome-profile`;

  /**
   * Build a manager whose process listing is fixed and whose kill primitive is recorded.
   * `_listProcesses` and `_killTree` are the two process primitives — everything else is
   * pure matching logic running for real.
   */
  const sweep = (
    extensionPath: string,
    processes: Array<{ pid: number; commandLine: string }>,
    platform: NodeJS.Platform = 'win32',
    // Criterion (b) resolves the owned browser profile as `<configDir>/.chrome-profile`, so the
    // profile-holder cases must pass the configDir their command lines are written against.
    configDir = '/tmp/cfg',
  ) => {
    const dm = new DaemonManager(configDir, extensionPath);
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

  it('NEGATIVE (our file as someone else\'s ARGUMENT): `code <bundled path>` is NOT killed', () => {
    // THE hazard the path-only criterion had: our bundled file merely MENTIONED in another
    // process's argv. `taskkill /T /F` here takes the user's editor, their unsaved work, and the
    // extension host running this sweep. Ownership requires the daemon/start subcommand shape
    // that _spawnDetached always emits, proving the process is RUNNING the file, not naming it.
    const { result, killTree } = sweep(WIN_ROOT, [
      { pid: 9001, commandLine: `"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${WIN_ROOT}\\dist\\mcp\\index.mjs"` },
      { pid: 9002, commandLine: `node --check ${WIN_ROOT}\\dist\\mcp\\index.mjs` },
      { pid: 9003, commandLine: `rg --files-with-matches daemon ${WIN_ROOT}\\dist\\mcp\\index.mjs` },
      // Explorer double-click / default-app open.
      { pid: 9004, commandLine: `"C:\\Windows\\System32\\NOTEPAD.EXE" ${WIN_ROOT}\\dist\\mcp\\index.mjs` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('NEGATIVE (path-suffix): a LONGER path that merely ENDS with our bundled path is NOT killed', () => {
    // Pins the leading-boundary half of _containsPathToken. Extended-length (`\\?\C:\…`) and
    // mounted-copy forms are the same bytes with a prefix — matching them would mean any path
    // whose tail equals ours is "ours".
    const { result, killTree } = sweep(WIN_ROOT, [
      { pid: 9101, commandLine: `node \\\\?\\${WIN_ROOT}\\dist\\mcp\\index.mjs daemon start` },
      { pid: 9102, commandLine: `node C:\\snapshots\\${WIN_ROOT.replace(/^C:\\/, '')}\\dist\\mcp\\index.mjs daemon start` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped.map(p => p.pid)).toEqual([9101, 9102]);
  });

  it('NEGATIVE (path-suffix, POSIX): `/mnt/backup` + our root is NOT killed', () => {
    const { result, killTree } = sweep(
      POSIX_ROOT,
      [{ pid: 9103, commandLine: `node /mnt/backup${POSIX_ROOT}/dist/mcp/index.mjs daemon start` }],
      'linux',
    );
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped.map(p => p.pid)).toEqual([9103]);
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

  // ── Chrome-profile criterion (b) — must keep working after the hardening ────

  it('CHROME PROFILE: still kills a Chromium squatting ~/.airtable-user-mcp/.chrome-profile (Windows)', () => {
    const { result, killedPids } = sweep(WIN_ROOT, [
      { pid: 7001, commandLine: `"C:\\Program Files\\Google\\Chrome\\chrome.exe" --user-data-dir=${WIN_PROFILE} --headless` },
    ], 'win32', WIN_CFG);
    expect(killedPids).toEqual([7001]);
    expect(result.killed).toEqual([7001]);
  });

  it('CHROME PROFILE: still kills the POSIX equivalent, including helper processes', () => {
    const { killedPids } = sweep(POSIX_ROOT, [
      { pid: 7002, commandLine: `/opt/chromium --user-data-dir=${POSIX_PROFILE}` },
      { pid: 7003, commandLine: `/opt/chromium --type=renderer --user-data-dir=${POSIX_PROFILE}` },
    ], 'linux', POSIX_CFG);
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
    ], 'win32', WIN_CFG);
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

/**
 * Criterion (b) — the browser-profile half of ownership.
 *
 * It used to be a two-fragment substring scan (`.airtable-user-mcp` … `.chrome-profile`, in
 * order) with NO executable requirement and NO argument matching, mis-documented as "already
 * correctly scoped". Anything whose command line merely MENTIONED the profile path — an editor
 * with `…/.chrome-profile/Default/Preferences` open, a `grep`/`rg` over the config dir, a file
 * manager, a backup job — was force-killed with its whole process tree by the dashboard Stop
 * button. These tests pin the replacement: kill ONLY a Chrome-family image that carries the EXACT
 * `--user-data-dir=<configDir>/.chrome-profile` argv token. Every case appears in both Windows
 * and POSIX command-line form.
 */
describe('DaemonManager._sweepOrphans — criterion (b): Chrome-family image AND exact --user-data-dir', () => {
  const WIN_ROOT = 'C:\\Users\\admin\\.vscode\\extensions\\nskha.airtable-formula-2.1.32';
  const POSIX_ROOT = '/home/u/.vscode/extensions/nskha.airtable-formula-2.1.32';
  const WIN_CFG = 'C:\\Users\\admin\\.airtable-user-mcp';
  const POSIX_CFG = '/home/u/.airtable-user-mcp';
  const WIN_PROFILE = `${WIN_CFG}\\.chrome-profile`;
  const POSIX_PROFILE = `${POSIX_CFG}/.chrome-profile`;

  const sweep = (
    configDir: string,
    processes: Array<{ pid: number; commandLine: string }>,
    platform: NodeJS.Platform,
    extensionPath: string,
  ) => {
    const dm = new DaemonManager(configDir, extensionPath);
    const killTree = vi.fn();
    (dm as any)._listProcesses = vi.fn(() => processes);
    (dm as any)._killTree = killTree;
    const result = (dm as any)._sweepOrphans(platform) as {
      killed: number[];
      skipped: Array<{ pid: number; commandLine: string }>;
    };
    return { result, killTree, killedPids: killTree.mock.calls.map(c => c[0] as number) };
  };
  const win = (processes: Array<{ pid: number; commandLine: string }>) =>
    sweep(WIN_CFG, processes, 'win32', WIN_ROOT);
  const posix = (processes: Array<{ pid: number; commandLine: string }>) =>
    sweep(POSIX_CFG, processes, 'linux', POSIX_ROOT);

  // ── POSITIVE: a real Chrome-family process on our exact profile IS killed ───

  it('POSITIVE (Windows): every Chrome-family image we can launch, on the exact profile, IS killed', () => {
    const { result, killedPids } = win([
      { pid: 1001, commandLine: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=${WIN_PROFILE} --headless` },
      { pid: 1002, commandLine: `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --user-data-dir=${WIN_PROFILE}` },
      // patchright's downloaded chromium + its headless shell.
      { pid: 1003, commandLine: `"C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win64\\chrome.exe" --user-data-dir=${WIN_PROFILE}` },
      { pid: 1004, commandLine: `"C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1187\\chrome-headless-shell-win64\\chrome-headless-shell.exe" --user-data-dir=${WIN_PROFILE}` },
      // Brave — browser-detect hands patchright its executablePath with channel 'chromium'.
      { pid: 1005, commandLine: `"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --user-data-dir=${WIN_PROFILE}` },
      // An UNQUOTED image path containing spaces (CIM reports both shapes).
      { pid: 1006, commandLine: `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --user-data-dir=${WIN_PROFILE}` },
    ]);
    expect(killedPids).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
    expect(result.skipped).toEqual([]);
  });

  it('POSITIVE (POSIX): system chrome/chromium/edge/brave, the mac app bundles and helpers, ARE killed', () => {
    const { result, killedPids } = posix([
      { pid: 2001, commandLine: `/opt/google/chrome/chrome --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2002, commandLine: `/usr/bin/chromium-browser --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2003, commandLine: `/opt/microsoft/msedge/msedge --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2004, commandLine: `/usr/bin/brave-browser --user-data-dir=${POSIX_PROFILE}` },
      // patchright download layouts: linux `chrome-linux64/chrome`, arm64 `headless_shell`.
      { pid: 2005, commandLine: `/home/u/.cache/ms-playwright/chromium-1187/chrome-linux64/chrome --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2006, commandLine: `/home/u/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell --user-data-dir=${POSIX_PROFILE}` },
      // macOS: app-bundle executables have SPACES in the image name, and helpers carry the flag too.
      { pid: 2007, commandLine: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2008, commandLine: `/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/140/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --user-data-dir=${POSIX_PROFILE}` },
      { pid: 2009, commandLine: `/Users/u/Library/Caches/ms-playwright/chromium-1187/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --user-data-dir=${POSIX_PROFILE}` },
    ]);
    expect(killedPids).toEqual([2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009]);
    expect(result.skipped).toEqual([]);
  });

  it('POSITIVE: a quoted argv (spaces in the config dir) and mixed case/separators still match', () => {
    const cfg = 'C:\\Users\\A B\\.airtable-user-mcp';
    const profile = `${cfg}\\.chrome-profile`;
    const { killedPids } = sweep(cfg, [
      // Node quotes the WHOLE argument when its value contains a space.
      { pid: 3001, commandLine: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "--user-data-dir=${profile}"` },
      // Only the VALUE quoted.
      { pid: 3002, commandLine: `chrome.exe --user-data-dir="${profile}"` },
      // Same file, other separator + other casing.
      { pid: 3003, commandLine: 'CHROME.EXE --user-data-dir=C:/USERS/A B/.AIRTABLE-USER-MCP/.CHROME-PROFILE' },
      // Trailing separator is the same directory.
      { pid: 3004, commandLine: `chrome.exe --user-data-dir=${profile}\\` },
    ], 'win32', WIN_ROOT);
    expect(killedPids).toEqual([3001, 3002, 3003, 3004]);
  });

  it('POSITIVE (POSIX): single-quoted value form still matches', () => {
    const { killedPids } = posix([
      { pid: 3005, commandLine: `/usr/bin/chromium --user-data-dir='${POSIX_PROFILE}'` },
    ]);
    expect(killedPids).toEqual([3005]);
  });

  it('POSITIVE (Windows): a BARE image with a whole-argument-quoted flag matches', () => {
    // Node quotes the whole argument when its value contains a space; the image itself may still
    // arrive unquoted. Pinning the shape explicitly — the other quoted cases all quote the image.
    const { killedPids } = win([
      { pid: 3006, commandLine: `chrome.exe "--user-data-dir=${WIN_PROFILE}"` },
      { pid: 3007, commandLine: `msedge.exe '--user-data-dir=${WIN_PROFILE}'` },
    ]);
    expect(killedPids).toEqual([3006, 3007]);
  });

  it('POSITIVE: a LEADING exec wrapper (env/nohup/xvfb-run) still resolves to the browser image', () => {
    // The wrapper execs the real browser, so argv[0] is the wrapper while the process IS ours.
    const { killedPids } = posix([
      { pid: 3101, commandLine: `env chrome --user-data-dir=${POSIX_PROFILE}` },
      { pid: 3102, commandLine: `xvfb-run /usr/bin/chromium --user-data-dir=${POSIX_PROFILE}` },
      { pid: 3103, commandLine: `nohup /opt/google/chrome/chrome --user-data-dir=${POSIX_PROFILE}` },
      { pid: 3104, commandLine: `/usr/bin/env /usr/bin/chromium-browser --user-data-dir=${POSIX_PROFILE}` },
    ]);
    expect(killedPids).toEqual([3101, 3102, 3103, 3104]);
  });

  // ── NEGATIVE: a browser-NAMED FILE as another program's argument ────────────

  it('NEGATIVE (Windows): a chrome-NAMED file passed to another program is NOT killed (it is not the image)', () => {
    // The image conjunct means argv[0], not "some pre-flag token that happens to be chrome-named".
    // Each of these carries our EXACT profile flag, so only the image test can save them.
    const cmds = [
      `NOTEPAD.EXE C:\\x\\chrome --user-data-dir=${WIN_PROFILE}`,
      `notepad.exe "C:\\x\\Google Chrome" --user-data-dir=${WIN_PROFILE}`,
      `node C:\\tools\\chrome --user-data-dir=${WIN_PROFILE}`,
      `"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\x\\chromium --user-data-dir=${WIN_PROFILE}`,
    ];
    const { result, killTree } = win(cmds.map((commandLine, i) => ({ pid: 9001 + i, commandLine })));
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    // Fail-safe: they hold our exact profile, so they are REPORTED rather than silently ignored.
    expect(result.skipped.map(p => p.pid)).toEqual([9001, 9002, 9003, 9004]);
  });

  it('NEGATIVE (POSIX): a chrome-NAMED file passed to vim/node/python is NOT killed (it is not the image)', () => {
    const cmds = [
      `vim /home/u/chrome --user-data-dir=${POSIX_PROFILE}`,
      `vim ./chrome --user-data-dir=${POSIX_PROFILE}`,
      `node /home/u/tools/chrome --user-data-dir=${POSIX_PROFILE}`,
      `python3 /opt/x/chromium --user-data-dir=${POSIX_PROFILE}`,
      `less "/home/u/Google Chrome" --user-data-dir=${POSIX_PROFILE}`,
    ];
    const { result, killTree } = posix(cmds.map((commandLine, i) => ({ pid: 9101 + i, commandLine })));
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
    expect(result.skipped.map(p => p.pid)).toEqual([9101, 9102, 9103, 9104, 9105]);
  });

  // ── NEGATIVE: an EDITOR holding a file under the profile ────────────────────

  it('NEGATIVE (Windows): an editor with a file under the profile open is NOT killed and NOT reported', () => {
    const { result, killTree } = win([
      { pid: 4001, commandLine: `"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${WIN_PROFILE}\\Default\\Preferences"` },
      { pid: 4002, commandLine: `"C:\\Windows\\System32\\NOTEPAD.EXE" ${WIN_PROFILE}\\Default\\Preferences` },
      { pid: 4003, commandLine: `"C:\\Program Files\\Microsoft VS Code\\Code.exe" --folder-uri file:///C:/Users/admin/.airtable-user-mcp/.chrome-profile` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('NEGATIVE (POSIX): vim/emacs/less on a file under the profile are NOT killed and NOT reported', () => {
    const { result, killTree } = posix([
      { pid: 4004, commandLine: `vim ${POSIX_PROFILE}/Default/Preferences` },
      { pid: 4005, commandLine: `emacs -nw ${POSIX_PROFILE}/Default/Preferences` },
      { pid: 4006, commandLine: `less ${POSIX_PROFILE}/DevToolsActivePort` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  // ── NEGATIVE: search tools / file managers / backup jobs ────────────────────

  it('NEGATIVE (Windows): rg/findstr/explorer/backup mentioning the profile are NOT killed', () => {
    const { result, killTree } = win([
      { pid: 5001, commandLine: `rg --files-with-matches airtable ${WIN_PROFILE}` },
      { pid: 5002, commandLine: `findstr /s /i cookie ${WIN_PROFILE}\\Default\\*` },
      { pid: 5003, commandLine: `C:\\Windows\\explorer.exe ${WIN_PROFILE}` },
      { pid: 5004, commandLine: `"C:\\Program Files\\7-Zip\\7z.exe" a backup.7z ${WIN_PROFILE}` },
      { pid: 5005, commandLine: `robocopy ${WIN_PROFILE} D:\\backup\\.chrome-profile /MIR` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('NEGATIVE (POSIX): grep/rg/find/rsync/nautilus mentioning the profile are NOT killed', () => {
    const { result, killTree } = posix([
      { pid: 5006, commandLine: `grep -r airtable ${POSIX_PROFILE}` },
      { pid: 5007, commandLine: `rg --hidden secretSocketId ${POSIX_PROFILE}` },
      { pid: 5008, commandLine: `find ${POSIX_PROFILE} -name SingletonLock` },
      { pid: 5009, commandLine: `rsync -a ${POSIX_PROFILE}/ /mnt/backup/.chrome-profile/` },
      { pid: 5010, commandLine: `nautilus ${POSIX_PROFILE}` },
      { pid: 5011, commandLine: `tar -czf profile.tgz ${POSIX_PROFILE}` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  // ── NEGATIVE: a real Chrome on somebody ELSE'S profile ─────────────────────

  it('NEGATIVE (Windows): Chrome/Edge with a DIFFERENT --user-data-dir is NOT killed', () => {
    const { result, killTree } = win([
      { pid: 6001, commandLine: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\Users\\admin\\AppData\\Local\\Google\\Chrome\\User Data' },
      { pid: 6002, commandLine: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"' },
      { pid: 6003, commandLine: 'msedge.exe --user-data-dir=C:\\Users\\admin\\.other-app\\.chrome-profile' },
      // Another OS user's install of THIS extension — still not ours to kill.
      { pid: 6004, commandLine: 'chrome.exe --user-data-dir=C:\\Users\\other\\.airtable-user-mcp\\.chrome-profile' },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('NEGATIVE (POSIX): Chrome/Chromium with a DIFFERENT --user-data-dir is NOT killed', () => {
    const { result, killTree } = posix([
      { pid: 6005, commandLine: '/opt/google/chrome/chrome --user-data-dir=/home/u/.config/google-chrome' },
      { pid: 6006, commandLine: '/usr/bin/chromium' },
      { pid: 6007, commandLine: '/usr/bin/chromium --user-data-dir=/home/u/.other-app/.chrome-profile' },
      { pid: 6008, commandLine: '/opt/google/chrome/chrome --user-data-dir=/home/other/.airtable-user-mcp/.chrome-profile' },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  // ── NEGATIVE: prefix / suffix / subdirectory near-misses ────────────────────

  it('NEGATIVE (Windows): a path that merely CONTAINS the profile dir as a substring is NOT killed', () => {
    const { result, killTree } = win([
      // Suffix: `…\.chrome-profile-backup` starts with our profile path.
      { pid: 7001, commandLine: `chrome.exe --user-data-dir=${WIN_PROFILE}-backup` },
      { pid: 7002, commandLine: `chrome.exe --user-data-dir=${WIN_PROFILE}.old` },
      // Subdirectory of our profile is a different --user-data-dir.
      { pid: 7003, commandLine: `chrome.exe --user-data-dir=${WIN_PROFILE}\\Default` },
      // Prefix: a mounted copy whose path ENDS with ours.
      { pid: 7004, commandLine: 'chrome.exe --user-data-dir=D:\\snapshots\\Users\\admin\\.airtable-user-mcp\\.chrome-profile' },
      // The parent config dir, not the profile.
      { pid: 7005, commandLine: `chrome.exe --user-data-dir=${WIN_CFG}` },
      // Our profile path present, but as a value of a DIFFERENT flag.
      { pid: 7006, commandLine: `chrome.exe --disk-cache-dir=${WIN_PROFILE} --user-data-dir=C:\\Users\\admin\\AppData\\Local\\Google\\Chrome\\User Data` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('NEGATIVE (POSIX): a path that merely CONTAINS the profile dir as a substring is NOT killed', () => {
    const { result, killTree } = posix([
      { pid: 7007, commandLine: `/usr/bin/chromium --user-data-dir=${POSIX_PROFILE}-backup` },
      { pid: 7008, commandLine: `/usr/bin/chromium --user-data-dir=${POSIX_PROFILE}.bak` },
      { pid: 7009, commandLine: `/usr/bin/chromium --user-data-dir=${POSIX_PROFILE}/Default` },
      { pid: 7010, commandLine: `/usr/bin/chromium --user-data-dir=/mnt/backup${POSIX_PROFILE}` },
      { pid: 7011, commandLine: `/usr/bin/chromium --user-data-dir=${POSIX_CFG}` },
      { pid: 7012, commandLine: `/usr/bin/chromium --disk-cache-dir=${POSIX_PROFILE} --user-data-dir=/home/u/.config/chromium` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  // ── FAIL-SAFE: the flag alone is never enough, and is reported instead ──────

  it('FAIL-SAFE (both platforms): a NON-browser process carrying our exact --user-data-dir is left alive and REPORTED', () => {
    const winCmd = `node C:\\tools\\wrapper.js --user-data-dir=${WIN_PROFILE}`;
    const w = win([{ pid: 8001, commandLine: winCmd }]);
    expect(w.killTree).not.toHaveBeenCalled();
    expect(w.result).toEqual({ killed: [], skipped: [{ pid: 8001, commandLine: winCmd }] });

    const posixCmd = `python3 /opt/tools/probe.py --user-data-dir=${POSIX_PROFILE}`;
    const p = posix([{ pid: 8002, commandLine: posixCmd }]);
    expect(p.killTree).not.toHaveBeenCalled();
    expect(p.result).toEqual({ killed: [], skipped: [{ pid: 8002, commandLine: posixCmd }] });
  });

  it('FAIL-SAFE: a Chrome-family image with NO --user-data-dir for our profile is neither killed nor reported', () => {
    const { result, killTree } = posix([
      { pid: 8003, commandLine: `/usr/bin/chromium ${POSIX_PROFILE}` },
      { pid: 8004, commandLine: `/opt/google/chrome/chrome file://${POSIX_PROFILE}/Default/Preferences` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toEqual({ killed: [], skipped: [] });
  });

  it('FAIL-SAFE: an empty or relative configDir yields NO profile kills (no bare `.chrome-profile` match)', () => {
    for (const cfg of ['', '   ', '.airtable-user-mcp', './rel']) {
      const { result, killTree } = sweep(cfg, [
        { pid: 8005, commandLine: 'chrome.exe --user-data-dir=.chrome-profile' },
        { pid: 8006, commandLine: `chrome.exe --user-data-dir=${WIN_PROFILE}` },
        { pid: 8007, commandLine: `/usr/bin/chromium --user-data-dir=${POSIX_PROFILE}` },
      ], 'win32', WIN_ROOT);
      expect(killTree).not.toHaveBeenCalled();
      expect(result).toEqual({ killed: [], skipped: [] });
    }
  });

  it('never kills our own pid even when it is a Chrome on our exact profile', () => {
    const { result, killTree } = win([
      { pid: process.pid, commandLine: `chrome.exe --user-data-dir=${WIN_PROFILE}` },
    ]);
    expect(killTree).not.toHaveBeenCalled();
    expect(result.killed).toEqual([]);
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
    // PowerShell 5.1 writes redirected stdout in the console OEM codepage; we decode utf8.
    // Without this, a non-ASCII install root (`C:\Users\José\…`) arrives mojibaked and our own
    // orphan is misreported as unowned. Must be the FIRST statement — before any output.
    expect(script.startsWith('[Console]::OutputEncoding=[Text.Encoding]::UTF8;')).toBe(true);
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
