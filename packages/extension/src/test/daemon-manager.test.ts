import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock vscode before importing modules that depend on it
vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  Disposable: vi.fn(),
  McpHttpServerDefinition: undefined,
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

  it('merges credEnv keys on top of base env', () => {
    const credEnv = { AIRTABLE_EMAIL: 'test@test.com' };
    const result = dm.buildDaemonEnv(credEnv);
    expect(result.AIRTABLE_EMAIL).toBe('test@test.com');
    expect(result.AIRTABLE_USER_MCP_HOME).toBe(tmpDir);
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

  it('rejected shutdown (401): escalates to killing the recorded pid and reclaims the lock', async () => {
    const port = await listen((_req, res) => {
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
    (dm as any)._spawnDetached = vi.fn();
    await dm.stopDaemon();
    await expect(dm.ensureDaemon({ timeoutMs: 400 })).rejects.toThrow(/Timed out/);
    expect((dm as any)._spawnDetached).toHaveBeenCalled();
    // Latch cleared — implicit calls may spawn again now
    await expect(dm.ensureDaemon({ implicit: true, timeoutMs: 400 })).rejects.toThrow(/Timed out/);
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
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );

    // Clean up
    delete (vscodeModule as unknown as Record<string, unknown>).McpHttpServerDefinition;
  });
});
