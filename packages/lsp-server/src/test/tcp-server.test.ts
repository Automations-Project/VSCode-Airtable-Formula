import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'net';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTcpServer } from '../tcp-server.js';

describe('startTcpServer', () => {
  let server: net.Server | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('binds to a port > 0 (OS-assigned)', async () => {
    tempDir = join(tmpdir(), `lsp-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    // Write a minimal daemon.lock so writeLspPort can read and update it
    const lockPath = join(tempDir, 'daemon.lock');
    const minimalLock = {
      pid: process.pid, uuid: 'test-uuid', port: 9999,
      port_lsp: null, bearerToken: 'test-token',
      version: '1.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(lockPath, JSON.stringify(minimalLock, null, 2) + '\n', 'utf8');

    server = await startTcpServer({ lockPath });
    const addr = server.address() as net.AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
  });

  it('writes port_lsp to daemon.lock after bind', async () => {
    tempDir = join(tmpdir(), `lsp-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const lockPath = join(tempDir, 'daemon.lock');
    const minimalLock = {
      pid: process.pid, uuid: 'test-uuid', port: 9999,
      port_lsp: null, bearerToken: 'test-token',
      version: '1.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(lockPath, JSON.stringify(minimalLock, null, 2) + '\n', 'utf8');

    server = await startTcpServer({ lockPath });
    const updated = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(typeof updated.port_lsp).toBe('number');
    expect(updated.port_lsp).toBeGreaterThan(0);
  });

  it('binds to 127.0.0.1 (loopback only, not 0.0.0.0)', async () => {
    tempDir = join(tmpdir(), `lsp-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const lockPath = join(tempDir, 'daemon.lock');
    const minimalLock = {
      pid: process.pid, uuid: 'test-uuid', port: 9999,
      port_lsp: null, bearerToken: 'test-token',
      version: '1.0.0', startedAt: new Date().toISOString(), tunnelUrl: null,
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(lockPath, JSON.stringify(minimalLock, null, 2) + '\n', 'utf8');

    server = await startTcpServer({ lockPath });
    const addr = server.address() as net.AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });
});
