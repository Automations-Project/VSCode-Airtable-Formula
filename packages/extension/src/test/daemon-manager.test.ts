import { describe, it, expect, vi, beforeEach } from 'vitest';
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
