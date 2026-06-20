import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, rmSync } from 'fs';
import { spawn, execFileSync } from 'child_process';

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
  /** Graceful-shutdown wait before kill escalation (overridable in tests). */
  private _stopWaitMs = 10_000;

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
      const deadline = Date.now() + this._stopWaitMs;
      while (Date.now() < deadline) {
        if (!this._lockfileExists()) return { stopped: true, forced: false };
        await this._delay(200);
      }
      // Acknowledged but the lock never released — fall through to escalation.
    }

    const pid = status.pid;
    const pidAlive = typeof pid === 'number' && pid > 0 && this._isPidAlive(pid);

    // 3) Escalate to kill ONLY with proven daemon identity: /daemon/health,
    //    authenticated with the lockfile's bearer, echoing the lockfile's
    //    uuid. NEITHER an accepted nor a rejected shutdown response proves
    //    identity by itself — a stale lock whose port was reused by an
    //    unrelated local service can produce either (catch-all routes 200
    //    anything and ignore the bearer header), while the recorded pid may
    //    belong to an innocent recycled process.
    const provenOurDaemon = outcome !== 'unreachable'
      && status.port != null && status.bearerToken != null
      && await this._verifyDaemonIdentity(status.port, status.bearerToken, status.uuid);

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
   * Stop the daemon AND kill anything the lockfile can't see: orphaned daemon
   * processes (whose lock was lost/deleted while the process lived) and stray
   * Chrome instances still holding the persistent profile. This is what the
   * "Stop" button calls — graceful stop alone is a no-op when the lock is gone,
   * which leaves a browser holding the profile (Chrome exit code 21 for
   * everything after).
   */
  async forceStop(): Promise<StopResult> {
    const result = await this.stopDaemon();
    const killed = this._sweepOrphans();
    this._reclaimLockfile();
    if (killed > 0) {
      return {
        stopped: true,
        forced: true,
        reason: `${result.reason ? result.reason + ' ' : ''}Force-killed ${killed} stray process(es).`,
      };
    }
    return result;
  }

  /**
   * Kill orphaned airtable-mcp daemons and stray profile-holding Chromes by
   * scanning command lines — independent of the lockfile. Best-effort.
   *
   * ponytail: matches by `.chrome-profile` / `index.mjs … daemon start` across
   * the whole user session, so it also nukes daemons from other installs that
   * share ~/.airtable-user-mcp. That's the intent of a "force stop".
   */
  private _sweepOrphans(): number {
    const pids = new Set<number>();
    try {
      if (process.platform === 'win32') {
        for (const filter of ["CommandLine like '%.chrome-profile%'", "CommandLine like '%index.mjs%daemon%start%'"]) {
          try {
            const out = execFileSync('wmic', ['process', 'where', filter, 'get', 'ProcessId', '/format:list'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
            for (const pid of this._parsePids(out)) if (pid !== process.pid) pids.add(pid);
          } catch { /* no matches → wmic exits non-zero */ }
        }
        for (const pid of pids) {
          try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); } catch { /* already gone */ }
        }
        return pids.size;
      }
      // POSIX: pkill kills directly; we can't easily count, so report 0.
      for (const pat of ['\\.chrome-profile', 'index\\.mjs.*daemon.*start']) {
        try { execFileSync('pkill', ['-9', '-f', pat], { stdio: 'ignore', timeout: 5000 }); } catch { /* none matched */ }
      }
      return 0;
    } catch {
      return pids.size;
    }
  }

  /** Extract unique positive PIDs from `wmic … get ProcessId /format:list` output. */
  private _parsePids(wmicOutput: string): number[] {
    const out: number[] = [];
    for (const m of wmicOutput.matchAll(/ProcessId=(\d+)/g)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
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
    const stop = await this.stopDaemon();
    if (!stop.stopped) {
      // Proceeding would let ensureDaemon() find the old daemon's lockfile
      // and "restart" by reconnecting to the very process that refused to die.
      throw new Error(`Restart aborted — the running daemon could not be stopped: ${stop.reason ?? 'unknown reason'}`);
    }
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
      // We spawn `process.execPath` which, in the extension host, is the editor's
      // Electron binary — not Node. Without this it would launch the editor (or
      // do nothing useful) instead of running the daemon script, so the lockfile
      // never appears and ensureDaemon() times out. Harmless when execPath is
      // already real Node (the flag is ignored).
      ELECTRON_RUN_AS_NODE: '1',
    };
    if (credEnv) Object.assign(env, credEnv);
    return env;
  }

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
  }
}
