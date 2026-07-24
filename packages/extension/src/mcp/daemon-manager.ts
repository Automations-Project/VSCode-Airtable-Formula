import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, rmSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { minutesToIdleParkMs } from '../settings.js';

export interface DaemonStatus {
  running: boolean;
  healthy: boolean;
  /** The lockfile exists but its recorded pid is NOT alive — the daemon crashed/was killed without
   *  releasing it. `running` stays true (so stopDaemon can still reclaim the lock), but consumers that
   *  need a LIVE daemon (ensureDaemon) treat `stale` like not-running and spawn a replacement. */
  stale: boolean;
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
  running: false, healthy: false, stale: false, pid: null, port: null,
  port_lsp: null, bearerToken: null, tunnelUrl: null, uptime: null, uuid: null,
};

/** A process observed by the orphan sweep, with the command line used for ownership attribution. */
export interface SweptProcess {
  pid: number;
  commandLine: string;
}

export interface OrphanSweepResult {
  /** PIDs positively attributed to THIS extension install and force-killed. */
  killed: number[];
  /**
   * Processes that look like a stray Airtable daemon but could NOT be positively attributed to
   * this extension install. Deliberately LEFT RUNNING (fail-safe) and reported so the user can
   * decide. Never killed.
   */
  skipped: SweptProcess[];
}

export interface StopResult {
  stopped: boolean;
  forced: boolean;
  reason?: string;
  /** PIDs force-killed by forceStop()'s ownership-scoped orphan sweep (absent for plain stopDaemon). */
  killedOrphans?: number[];
  /** Daemon-looking processes forceStop() left alive because ownership could not be established. */
  skippedUnowned?: SweptProcess[];
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
  /**
   * Timestamp (ms) of the last spawn attempt. Suppresses further spawns for a startup window so
   * overlapping ensureDaemon() callers — or a lockfile-watch storm — cannot each launch a daemon.
   * Without it, N callers each held a local `spawned` flag and each ran `_spawnDetached()`; a
   * lockfile-watch → credential-push → ensureDaemon chain re-fired on every daemon.lock write and
   * each firing spawned another process (a runaway start/restart loop that OOM'd the machine).
   * A timestamp beats a single-flight promise here: check-and-set is synchronous (no await between),
   * so it holds regardless of how a fast-resolving spawn and a slow status read interleave.
   */
  private _lastSpawnAt = 0;
  /** Window during which a fresh spawn is suppressed after one is attempted (~ the startup budget). */
  private static readonly SPAWN_SUPPRESS_MS = 15_000;

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
      const pid = typeof record.pid === 'number' ? record.pid : null;
      // STALE-LOCK DETECTION — the fix for "Timed out waiting for daemon startup" after a crash.
      // A lockfile whose recorded daemon pid is no longer alive is STALE (the daemon died/was killed
      // without releasing it — e.g. the OOM crash, or an orphaned daemon). `running` stays true so
      // stopDaemon can still reclaim the lock, but `stale:true` tells ensureDaemon to spawn a
      // replacement (the new daemon's launcher reclaims the stale lock via lockfile.acquire →
      // tryReclaimStale). WITHOUT this, a stale lock wedges ensureDaemon: running:true + healthy:false
      // means it can neither return (not healthy) nor spawn (the branch requires !running || stale) →
      // it polls to the deadline and throws. (EPERM in _isPidAlive counts as alive — a permission
      // probe is never a dead process.) Skip the 2s health fetch on a dead pid.
      const stale = pid != null && pid > 0 && !this._isPidAlive(pid);
      if (stale) {
        console.warn(`[DaemonManager] stale daemon.lock (pid ${pid} not alive) — a fresh daemon will reclaim it.`);
      }
      const port = typeof record.port === 'number' && Number.isInteger(record.port)
        && record.port >= 1 && record.port <= 65535 ? record.port : null;
      const bearerToken = typeof record.bearerToken === 'string' ? record.bearerToken : null;
      const healthy = !stale && port != null && bearerToken != null
        ? await this._httpHealthCheck(port, bearerToken)
        : false;
      const status: DaemonStatus = {
        running: true,
        healthy,
        stale,
        pid,
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
    const args = [serverPath, 'daemon', 'start'];
    // Fixed daemon port (0 = OS-ephemeral). Read fresh each spawn so a settings
    // change takes effect on the next (re)start without reloading the window.
    const daemonPort = vscode.workspace.getConfiguration('airtableFormula').get<number>('mcp.daemonPort', 0);
    if (Number.isInteger(daemonPort) && daemonPort > 0 && daemonPort <= 65535) args.push('--port', String(daemonPort));
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...this.buildDaemonEnv() },
    });
    child.unref();
  }

  async ensureDaemon(options?: { timeoutMs?: number; implicit?: boolean }): Promise<DaemonConnectionInfo> {
    if (this._disposed) throw new Error('DaemonManager disposed');
    // An EXPLICIT call is a deliberate user action (Start / Restart / authMode change) — it must not
    // be throttled by the anti-runaway spawn window. Clear the latch AND the suppression timestamp so
    // it can spawn immediately even within SPAWN_SUPPRESS_MS of a prior spawn (a crash-then-Start, or a
    // restart that just stopped the daemon). Implicit callers (definition provider, credential handoff,
    // the lockfile-watch chain) keep the window — that is what breaks the runaway loop. The reset is
    // synchronous and before any await, so three concurrent EXPLICIT calls still collapse to one spawn:
    // each resets to 0, then the first to reach the check writes the timestamp and the others suppress.
    if (!options?.implicit) { this._userStopped = false; this._lastSpawnAt = 0; }
    const deadline = Date.now() + (options?.timeoutMs ?? 15_000);
    let spawnedThisCall = false;
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
      // Spawn at most once PER CALL (spawnedThisCall) AND at most once per startup window ACROSS all
      // calls (_lastSpawnAt) — so many overlapping ensureDaemon() callers converge on a single daemon
      // instead of each spawning one. Spawn when there is no live daemon: either no lockfile
      // (!running) OR a STALE lockfile whose daemon pid is dead (status.stale) — the spawned daemon
      // reclaims the stale lock. Without the `|| status.stale`, a crash-orphaned lockfile wedges here.
      if ((!status.running || status.stale) && !spawnedThisCall) {
        if (options?.implicit && this._userStopped) {
          throw new Error('Daemon was explicitly stopped by the user; not respawning implicitly.');
        }
        // check-and-set is synchronous (no await between the read and the write), so two callers
        // can't both pass the window check — the second sees the timestamp the first just wrote.
        if (Date.now() - this._lastSpawnAt > DaemonManager.SPAWN_SUPPRESS_MS) {
          this._lastSpawnAt = Date.now();
          // Log the spawn failure (e.g. missing server script) so the eventual "Timed out waiting for
          // daemon startup" has a diagnosable cause; the poll below still re-evaluates.
          await this._spawnDetached().catch((e) => {
            console.warn('[DaemonManager] _spawnDetached failed:', e instanceof Error ? e.message : 'unknown error');
          });
        }
        // Whether we spawned or deferred to another caller's in-flight spawn, stop trying to spawn
        // from this call; just poll the deadline for the daemon to come up.
        spawnedThisCall = true;
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
   *
   * The sweep is OWNERSHIP-SCOPED: only processes provably belonging to this extension install
   * are killed. Daemon-looking processes that cannot be attributed are left running and returned
   * in `skippedUnowned` so the caller can tell the user "N left running, ownership unverified".
   */
  async forceStop(): Promise<StopResult> {
    const result = await this.stopDaemon();
    const sweep = this._sweepOrphans();
    this._reclaimLockfile();

    const notes: string[] = [];
    if (result.reason) notes.push(result.reason);
    if (sweep.killed.length > 0) notes.push(`Force-killed ${sweep.killed.length} stray process(es).`);
    if (sweep.skipped.length > 0) {
      notes.push(
        `${sweep.skipped.length} process(es) left running — could not verify they belong to this ` +
        `extension (PID ${sweep.skipped.map(p => p.pid).join(', ')}).`,
      );
    }
    const reason = notes.length > 0 ? notes.join(' ') : undefined;

    return {
      stopped: result.stopped || sweep.killed.length > 0,
      forced: result.forced || sweep.killed.length > 0,
      ...(reason !== undefined ? { reason } : {}),
      killedOrphans: sweep.killed,
      skippedUnowned: sweep.skipped,
    };
  }

  // ─── Ownership-scoped orphan sweep ─────────────────────────────────────────
  //
  // A process is killed ONLY when its command line carries an identifier that can belong to
  // nothing but THIS extension install. Anything that merely *looks* like an Airtable daemon is
  // left alive and reported. There is no generic `index.mjs … daemon … start` kill criterion —
  // that unscoped substring match used to force-kill (with `/T`, i.e. the whole process tree)
  // any unrelated Node process whose argv happened to contain those three fragments.

  /** Characters that may legally abut a path inside an argv string (separator or quoting). */
  private static readonly ARGV_BOUNDARY = /[\s"'=]/;
  /** `C:\…`, `\\server\share…` or `/…` — guards against an empty/relative extensionPath. */
  private static readonly ABSOLUTE_LIKE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

  /**
   * Canonical form for command-line comparison: `\` → `/`, lower-cased.
   *
   * Case folding is what makes Windows path matching correct (`C:\Users\…` vs `c:\users\…`);
   * applying it on POSIX too is a negligible widening (it would take two real installs whose
   * absolute paths differ only in letter case to collide) and keeps ONE code path.
   *
   * Quotes are deliberately NOT stripped — they are treated as argv boundaries instead, so
   * `"C:\p\dist\mcp\index.mjs"` matches while `C:\p\dist\mcp\index.mjs.bak` does not.
   */
  private static _canon(s: string): string {
    return String(s).replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Does `haystack` contain `needle` as a whole argv token? The characters immediately before
   * and after the match must be a boundary (start/end of string, whitespace, quote or `=`), so a
   * longer neighbouring path (`…/index.mjs.bak`, `…/index.mjson`) can never satisfy it.
   * Both arguments must already be in `_canon` form.
   */
  private static _containsPathToken(haystack: string, needle: string): boolean {
    if (!needle) return false;
    for (let from = 0; ; ) {
      const i = haystack.indexOf(needle, from);
      if (i < 0) return false;
      const before = i === 0 ? '' : haystack[i - 1];
      const afterIdx = i + needle.length;
      const after = afterIdx >= haystack.length ? '' : haystack[afterIdx];
      if ((before === '' || DaemonManager.ARGV_BOUNDARY.test(before))
        && (after === '' || DaemonManager.ARGV_BOUNDARY.test(after))) return true;
      from = i + 1;
    }
  }

  /**
   * The exact bundled entry `_spawnDetached()` launches — the strongest ownership proof there is.
   * Returns null when `extensionPath` is empty or relative, because `path.join('', 'dist', …)`
   * would yield the relative fragment `dist/mcp/index.mjs` and match half the machine.
   */
  private _bundledEntryPath(): string | null {
    const root = this.extensionPath;
    if (typeof root !== 'string' || root.trim().length === 0) return null;
    if (!DaemonManager.ABSOLUTE_LIKE.test(root)) return null;
    return path.join(root, 'dist', 'mcp', 'index.mjs');
  }

  /**
   * Positive ownership test — the ONLY kill criterion.
   *
   * (a) the exact bundled `<extensionPath>/dist/mcp/index.mjs` this install spawns, matched as a
   *     whole argv token; or
   * (b) a Chromium still squatting our persistent profile — `.airtable-user-mcp` followed by
   *     `.chrome-profile`. Semantics are UNCHANGED from the original (already correctly scoped)
   *     `%.airtable-user-mcp%.chrome-profile%` filter: both fragments, in that order. It is
   *     scoped to our unique config-dir fragment so it can never hit an unrelated app's Chrome
   *     that merely happens to have `.chrome-profile` in its args.
   */
  private _isOwnedCommandLine(commandLine: string): boolean {
    const cmd = DaemonManager._canon(commandLine);
    const entry = this._bundledEntryPath();
    if (entry && DaemonManager._containsPathToken(cmd, DaemonManager._canon(entry))) return true;
    const i = cmd.indexOf('.airtable-user-mcp');
    return i >= 0 && cmd.indexOf('.chrome-profile', i + '.airtable-user-mcp'.length) > i;
  }

  /**
   * The OLD, unscoped kill criterion (`index.mjs` … `daemon` … `start`, in order, anywhere in
   * argv). It is NO LONGER a kill criterion. It only decides what gets *reported* as
   * "looked like a stray daemon, but ownership could not be established" so the user still learns
   * about a leftover process from a different install instead of it being silently executed.
   */
  private static _looksLikeStrayDaemon(commandLine: string): boolean {
    const cmd = DaemonManager._canon(commandLine);
    const a = cmd.indexOf('index.mjs');
    if (a < 0) return false;
    const b = cmd.indexOf('daemon', a + 'index.mjs'.length);
    if (b < 0) return false;
    return cmd.indexOf('start', b + 'daemon'.length) > b;
  }

  /**
   * Kill orphaned daemons of THIS install and stray Chromes holding our profile, independent of
   * the lockfile. Best-effort; never throws. Ambiguity always resolves to *not* killing.
   */
  private _sweepOrphans(platform: NodeJS.Platform = process.platform): OrphanSweepResult {
    const killed: number[] = [];
    const skipped: SweptProcess[] = [];
    let processes: SweptProcess[];
    try {
      processes = this._listProcesses(platform);
    } catch {
      return { killed, skipped };
    }
    for (const proc of processes) {
      if (proc.pid === process.pid) continue;
      if (this._isOwnedCommandLine(proc.commandLine)) {
        this._killTree(proc.pid, platform);
        killed.push(proc.pid);
      } else if (DaemonManager._looksLikeStrayDaemon(proc.commandLine)) {
        skipped.push(proc);
      }
    }
    for (const proc of skipped) {
      console.warn(`[DaemonManager] orphan sweep left pid ${proc.pid} alive — not attributable to this extension install: ${proc.commandLine}`);
    }
    return { killed, skipped };
  }

  /**
   * Enumerate candidate processes as `{pid, commandLine}`; the ownership decision is then made in
   * JS by `_isOwnedCommandLine`, never by the query language.
   *
   * Windows: PowerShell + `Get-CimInstance Win32_Process` (`wmic` is deprecated and absent on
   * recent Windows builds; this mirrors `mcp-server/src/process-tree.js`). The two pre-filter
   * markers travel via the ENVIRONMENT and are never interpolated into the script, so no path can
   * inject script or alter match semantics — and the markers are separator-free literals, so no
   * WQL/`LIKE` escaping question arises at all. The pre-filter is a strict SUPERSET of the
   * ownership test (it can only ever return too much, never too little).
   *
   * POSIX: `ps -A -ww -o pid= -o args=` — a fixed argv with nothing interpolated.
   */
  private _listProcesses(platform: NodeJS.Platform = process.platform): SweptProcess[] {
    if (platform === 'win32') {
      const script =
        '$a=$env:AIRTABLE_SWEEP_MARK_A; $b=$env:AIRTABLE_SWEEP_MARK_B; ' +
        'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { ' +
        '$c = $_.CommandLine.ToLowerInvariant(); ' +
        'if ($c.Contains($a) -or $c.Contains($b)) { "$($_.ProcessId)`t$($_.CommandLine)" } }';
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...process.env,
            // Lower-case, separator-free literals — matched against a lower-cased command line.
            AIRTABLE_SWEEP_MARK_A: 'index.mjs',
            AIRTABLE_SWEEP_MARK_B: '.chrome-profile',
          },
        },
      );
      return this._parseProcessList(out);
    }
    const out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=', '-o', 'args='], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return this._parseProcessList(out);
  }

  /**
   * Parse `<pid><TAB-or-space><command line>` lines (PowerShell and `ps` output alike) into unique
   * positive PIDs. Our own pid is always dropped.
   */
  private _parseProcessList(output: string): SweptProcess[] {
    const out: SweptProcess[] = [];
    const seen = new Set<number>();
    for (const line of String(output).split(/\r?\n/)) {
      const m = /^\s*(\d+)[ \t]+(\S.*)$/.exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || seen.has(pid)) continue;
      seen.add(pid);
      out.push({ pid, commandLine: m[2].trim() });
    }
    return out;
  }

  /** Force-kill a positively-owned process (and, on Windows, its tree). Never throws. */
  private _killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
    try {
      if (platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch { /* already gone */ }
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

  /**
   * Push byo/direct-login credentials to the RUNNING daemon over its
   * bearer-authenticated endpoint (C4). The daemon stores them IN MEMORY only
   * and re-inits auth on its next call — creds never reach the daemon via env
   * or disk (buildDaemonEnv stays creds-free by design).
   *
   * Reads {port, bearerToken} from the daemon lockfile (via getDaemonStatus,
   * the manager's single lockfile reader). Best-effort: returns false on any
   * failure (daemon not running, unreachable, non-2xx). The payload and its
   * fields are NEVER logged.
   */
  async pushAuthCredentials(payload: {
    authMode: 'byo' | 'direct-login';
    cookie?: string;
    csrf?: string;
    email?: string;
    password?: string;
    totpSecret?: string;
  }): Promise<boolean> {
    if (this._disposed) return false;
    try {
      const status = await this.getDaemonStatus();
      if (!status.running || status.port == null || !status.bearerToken) return false;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const resp = await fetch(`http://127.0.0.1:${status.port}/daemon/auth-credentials`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${status.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!resp.ok) {
          console.warn(`[DaemonManager] pushAuthCredentials: daemon returned HTTP ${resp.status}`);
          return false;
        }
        const body = await resp.json().catch(() => null) as { ok?: boolean } | null;
        return body?.ok === true;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      // Concise, secret-free warning only — NEVER log the payload.
      console.warn(`[DaemonManager] pushAuthCredentials failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return false;
    }
  }

  buildDaemonEnv(): Record<string, string> {
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
    // Transport selection (airtableFormula.mcp.authMode / .httpClient). Only inject non-defaults
    // so an externally-set env still applies when the setting is left at its default.
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    const authMode = cfg.get<string>('mcp.authMode', 'browser');
    if (authMode && authMode !== 'browser') env.AIRTABLE_AUTH_MODE = authMode;
    if (cfg.get<string>('mcp.httpClient', 'fetch') === 'impit') env.AIRTABLE_HTTP_CLIENT = 'impit';
    // Idle browser parking (minutes → ms). Always inject so the daemon matches
    // the dashboard setting even at the default (30). 0 disables parking.
    const idleMinutes = cfg.get<number>('mcp.browserIdleParkMinutes', 30);
    env.AIRTABLE_BROWSER_IDLE_PARK_MS = String(minutesToIdleParkMs(idleMinutes));
    // NOTE: credentials are DELIBERATELY never injected into the daemon env —
    // they reach a running daemon only via the bearer-authed
    // /daemon/auth-credentials endpoint (see pushAuthCredentials).
    return env;
  }

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
  }
}
