import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';

export interface DaemonStatus {
  running: boolean;
  healthy: boolean;
  pid: number | null;
  port: number | null;
  port_lsp: number | null;
  bearerToken: string | null;
  tunnelUrl: string | null;
  uptime: number | null;
}

export interface DaemonConnectionInfo {
  pid: number;
  uuid: string;
  port: number;
  url: string;
  bearerToken: string;
  version: string;
  startedAt: string;
}

const EMPTY_STATUS: DaemonStatus = {
  running: false, healthy: false, pid: null, port: null,
  port_lsp: null, bearerToken: null, tunnelUrl: null, uptime: null,
};

export class DaemonManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DaemonStatus>();
  public readonly onDidChange = this._onDidChange.event;

  private _disposed = false;
  private _status: DaemonStatus = { ...EMPTY_STATUS };

  constructor(
    private readonly configDir: string,
    private readonly extensionPath: string,
  ) {}

  private async _httpHealthCheck(port: number, bearerToken: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/daemon/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDaemonStatus(): Promise<DaemonStatus> {
    try {
      const lockPath = path.join(this.configDir, 'daemon.lock');
      const raw = await fs.readFile(lockPath, 'utf8');
      const record = JSON.parse(raw) as Record<string, unknown>;
      const port = typeof record.port === 'number' ? record.port : null;
      const bearerToken = typeof record.bearerToken === 'string' ? record.bearerToken : null;
      const healthy = port != null && bearerToken != null
        ? await this._httpHealthCheck(port, bearerToken)
        : false;
      const status: DaemonStatus = {
        running: true,
        healthy,
        pid: typeof record.pid === 'number' ? record.pid : null,
        port,
        port_lsp: typeof record.port_lsp === 'number' ? record.port_lsp : null,
        bearerToken,
        tunnelUrl: typeof record.tunnelUrl === 'string' ? record.tunnelUrl : null,
        uptime: typeof record.startedAt === 'string' ? Date.now() - Date.parse(record.startedAt) : null,
      };
      this._status = status;
      return status;
    } catch {
      this._status = { ...EMPTY_STATUS };
      return { ...EMPTY_STATUS };
    }
  }

  async probeHealth(): Promise<boolean> {
    const status = await this.getDaemonStatus();
    return status.running && status.healthy;
  }

  private async _spawnDetached(): Promise<void> {
    const serverPath = path.join(this.extensionPath, 'dist', 'mcp', 'index.mjs');
    const child = spawn(process.execPath, [serverPath, 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...this.buildDaemonEnv() },
    });
    child.unref();
  }

  async ensureDaemon(options?: { timeoutMs?: number }): Promise<DaemonConnectionInfo> {
    if (this._disposed) throw new Error('DaemonManager disposed');
    const deadline = Date.now() + (options?.timeoutMs ?? 15_000);
    let spawned = false;
    while (Date.now() < deadline) {
      const status = await this.getDaemonStatus();
      if (status.running && status.healthy && status.port != null && status.bearerToken != null) {
        return {
          pid: status.pid ?? 0,
          uuid: '',
          port: status.port,
          url: `http://127.0.0.1:${status.port}`,
          bearerToken: status.bearerToken,
          version: '',
          startedAt: '',
        };
      }
      if (!status.running && !spawned) {
        await this._spawnDetached();
        spawned = true;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for daemon startup.');
  }

  async stopDaemon(): Promise<void> {
    const status = await this.getDaemonStatus();
    if (!status.running || status.port == null || status.bearerToken == null) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      await fetch(`http://127.0.0.1:${status.port}/daemon/shutdown`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${status.bearerToken}` },
        signal: controller.signal,
      });
    } catch {
      // daemon terminates itself; ignore network errors
    } finally {
      clearTimeout(timeout);
    }
  }

  async restartDaemon(): Promise<DaemonConnectionInfo> {
    await this.stopDaemon();
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    return this.ensureDaemon();
  }

  buildDaemonEnv(credEnv?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {
      AIRTABLE_USER_MCP_HOME: this.configDir,
      AIRTABLE_HEADLESS_ONLY: '1',
      NODE_PATH: path.join(this.extensionPath, 'dist', 'node_modules'),
    };
    if (credEnv) Object.assign(env, credEnv);
    return env;
  }

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
  }
}
