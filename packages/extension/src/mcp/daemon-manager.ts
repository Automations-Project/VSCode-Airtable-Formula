import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, rmSync } from 'fs';
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
  /** Lockfile uuid — used to verify daemon identity before kill escalation. */
  uuid: string | null;
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
  port_lsp: null, bearerToken: null, tunnelUrl: null, uptime: null, uuid: null,
};

export interface StopResult {
  stopped: boolean;
  forced: boolean;
  reason?: string;
}

export class DaemonManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DaemonStatus>();
  public readonly onDidChange = this._onDidChange.event;

  private _disposed = false;
  private _status: DaemonStatus = { ...EMPTY_STATUS };
  /**
   * Set when the user explicitly stops the daemon. Implicit ensureDaemon()
   * callers (MCP definition provider, credential handoff) respect it so the
   * daemon doesn't resurrect seconds after the user pressed Stop. Cleared by
   * any explicit start/restart.
   */
  private _userStopped = false;

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
      const port = typeof record.port === 'number' && Number.isInteger(record.port)
        && record.port >= 1 && record.port <= 65535 ? record.port : null;
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
        uuid: typeof record.uuid === 'string' && record.uuid.length > 0 ? record.uuid : null,
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

  async ensureDaemon(options?: { timeoutMs?: number; implicit?: boolean }): Promise<DaemonConnectionInfo> {
    if (this._disposed) throw new Error('DaemonManager disposed');
    if (!options?.implicit) this._userStopped = false;
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
        if (options?.implicit && this._userStopped) {
          throw new Error('Daemon was explicitly stopped by the user; not respawning implicitly.');
        }
        await this._spawnDetached();
        spawned = true;
      }
      await this._delay(200);
    }
    throw new Error('Timed out waiting for daemon startup.');
  }

  /**
   * Stop the daemon and only report success once it is actually gone.
   *
   * Mirrors the CLI launcher's stopDaemon semantics: graceful HTTP shutdown
   * (verifying the response — a 401 from a stale lockfile token is a
   * failure, not a success), wait for the daemon to release its lockfile,
   * escalate to killing the recorded pid when the daemon answers but won't
   * exit, and reclaim stale lockfiles so the UI can't get stuck showing a
   * dead daemon as "running".
   */
  async stopDaemon(): Promise<StopResult> {
    this._userStopped = true;
    const status = await this.getDaemonStatus();
    if (!status.running) return { stopped: true, forced: false };

    // 1) Graceful shutdown request. Distinguish: accepted / rejected (the
    //    port answered with an error status) / unreachable (no daemon there).
    let outcome: 'accepted' | 'rejected' | 'unreachable' = 'unreachable';
    if (status.port != null && status.bearerToken != null) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const res = await fetch(`http://127.0.0.1:${status.port}/daemon/shutdown`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${status.bearerToken}` },
          signal: controller.signal,
        });
        outcome = res.ok ? 'accepted' : 'rejected';
      } catch {
        outcome = 'unreachable';
      } finally {
        clearTimeout(timeout);
      }
    }

    // 2) Accepted — the daemon releases its lockfile as it exits; wait for it.
    if (outcome === 'accepted') {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (!this._lockfileExists()) return { stopped: true, forced: false };
        await this._delay(200);
      }
      // Daemon acknowledged but never exited — fall through to escalation.
    }

    const pid = status.pid;
    const pidAlive = typeof pid === 'number' && pid > 0 && this._isPidAlive(pid);

    // 3) Escalate to kill ONLY with proven daemon identity. An accepted
    //    (bearer-authenticated) shutdown proves it. A rejected response does
    //    NOT — it only proves SOMETHING answered on the port; a stale lock
    //    whose port was reused by an unrelated HTTP service also rejects,
    //    while the recorded pid may belong to an innocent recycled process.
    //    For rejected, require /daemon/health to echo the lockfile's uuid.
    const provenOurDaemon = outcome === 'accepted' || (
      outcome === 'rejected'
      && status.port != null && status.bearerToken != null
      && await this._verifyDaemonIdentity(status.port, status.bearerToken, status.uuid)
    );

    if (provenOurDaemon && pidAlive && typeof pid === 'number') {
      this._killPid(pid);
      const deadline = Date.now() + 3_000;
      let escalated = false;
      while (Date.now() < deadline && this._isPidAlive(pid)) {
        if (!escalated && Date.now() > deadline - 1_500) {
          this._killPid(pid, 'SIGKILL');
          escalated = true;
        }
        await this._delay(100);
      }
      if (this._isPidAlive(pid)) {
        return { stopped: false, forced: true, reason: `Daemon process ${pid} did not exit after kill.` };
      }
      this._reclaimLockfile();
      return { stopped: true, forced: true };
    }

    // 4) Unreachable or unproven identity: the lockfile is stale (dead pid),
    //    or whatever answers on the port could not be verified as our daemon.
    //    Reclaim the lock so the dashboard stops showing a phantom daemon,
    //    but leave the recorded pid untouched (PID-reuse safety).
    this._reclaimLockfile();
    return {
      stopped: true,
      forced: false,
      reason: pidAlive
        ? `Removed stale daemon.lock; process ${pid} could not be verified as the daemon and was left untouched.`
        : undefined,
    };
  }

  /**
   * Proof of identity for kill escalation: /daemon/health, authenticated with
   * the lockfile's bearer token, must echo the lockfile's uuid.
   */
  private async _verifyDaemonIdentity(port: number, bearerToken: string, uuid: string | null): Promise<boolean> {
    if (!uuid) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/daemon/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => null) as { uuid?: unknown } | null;
      return body?.uuid === uuid;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async restartDaemon(): Promise<DaemonConnectionInfo> {
    await this.stopDaemon();
    await this._delay(500);
    return this.ensureDaemon();
  }

  // ─── Stop helpers (instance methods so tests can stub process control) ──

  private _lockfileExists(): boolean {
    return existsSync(path.join(this.configDir, 'daemon.lock'));
  }

  private _reclaimLockfile(): void {
    try {
      rmSync(path.join(this.configDir, 'daemon.lock'), { force: true });
    } catch { /* best-effort */ }
  }

  private _isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }

  private _killPid(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
    try {
      process.kill(pid, signal);
    } catch { /* already gone */ }
  }

  private _delay(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
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
