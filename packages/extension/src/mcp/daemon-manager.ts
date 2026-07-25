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

  /**
   * Characters that may abut an argv entry: whitespace, or quoting. Used on BOTH sides of every
   * match. `=` is deliberately absent — it is legal INSIDE a path on every platform, so treating
   * it as a boundary means `<needle>=2` matches `<needle>`. That cost a false kill on each side
   * in turn: `--user-data-dir=<profile>=2` (a browser on a DIFFERENT directory) for criterion (b),
   * and `…/dist/mcp/index.mjs=1 daemon start` (a DIFFERENT file) for criterion (a).
   */
  private static readonly ARG_BOUNDARY = /[\s"']/;
  /**
   * The ONE asymmetry, and it is leading-side only: a PATH may legitimately follow `=`
   * (`--script=<path>`), so criterion (a) — which matches a path — accepts `=` before its match.
   * Criterion (b) matches a FLAG, which never legitimately follows `=`, so it uses
   * `ARG_BOUNDARY` on both sides and thereby rejects `--foo=--user-data-dir=<p>` and
   * `--user-data-dir=/other=--user-data-dir=<p>`. Nothing accepts `=` on the TRAILING side.
   */
  private static readonly PATH_LEAD_BOUNDARY = /[\s"'=]/;
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
   * Does `haystack` contain `needle` as a whole argv token?
   *
   * TRAILING side: start/end of string, whitespace or a quote (`ARG_BOUNDARY`) — never `=`.
   * LEADING side: the same, unless the caller passes `PATH_LEAD_BOUNDARY` to also allow `=`
   * (criterion (a) only; see that constant for why the two differ).
   *
   * Probed rather than asserted: `…/index.mjs.bak`, `…/index.mjson`, `…/index.mjs=1`,
   * `<profile>-backup`, `<profile>.old`, `<profile>/Default` and `<profile>=2` are all misses,
   * because `.`, `-`, `/`, `s` and `=` are none of them boundary characters. The claim this
   * docblock used to make — "a longer neighbouring path can NEVER satisfy it" — was false for
   * exactly one character, `=`, which was in the boundary set on both sides.
   *
   * Both arguments must already be in `_canon` form. One implementation, one parameter: the two
   * criteria share this matcher deliberately, because a second hand-rolled predicate is how they
   * drifted apart in the first place.
   */
  private static _containsPathToken(
    haystack: string,
    needle: string,
    leadingBoundary: RegExp = DaemonManager.ARG_BOUNDARY,
  ): boolean {
    if (!needle) return false;
    for (let from = 0; ; ) {
      const i = haystack.indexOf(needle, from);
      if (i < 0) return false;
      const before = i === 0 ? '' : haystack[i - 1];
      const afterIdx = i + needle.length;
      const after = afterIdx >= haystack.length ? '' : haystack[afterIdx];
      if ((before === '' || leadingBoundary.test(before))
        && (after === '' || DaemonManager.ARG_BOUNDARY.test(after))) return true;
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
   * The exact persistent browser profile THIS install hands the daemon, in `_canon` form.
   *
   * `buildDaemonEnv()` pins `AIRTABLE_USER_MCP_HOME = configDir`, and the server resolves its
   * profile as `<AIRTABLE_USER_MCP_HOME>/.chrome-profile` (`mcp-server/src/paths.js`
   * `getProfileDir()`), which is also the literal path `registration.ts` and `auth-manager.ts`
   * use. So `<configDir>/.chrome-profile` IS the profile — no guessing, no `os.homedir()`
   * fallback that could attribute another OS user's browser to us.
   *
   * Returns null for an empty/relative configDir, for the same reason `_bundledEntryPath()` does:
   * a relative join would yield the bare fragment `.chrome-profile` and match another app's.
   */
  private _profileDir(): string | null {
    const root = this.configDir;
    if (typeof root !== 'string' || root.trim().length === 0) return null;
    if (!DaemonManager.ABSOLUTE_LIKE.test(root)) return null;
    return DaemonManager._stripTrailingSep(DaemonManager._canon(path.join(root, '.chrome-profile')));
  }

  /** Trailing separators are not part of a directory's identity (`_canon` already made them `/`). */
  private static _stripTrailingSep(p: string): string {
    return p.replace(/\/+$/, '');
  }

  /**
   * Chrome-family process images (argv[0] basename, lower-cased, `.exe` stripped) — the ONLY
   * images criterion (b) will ever kill. DERIVED from what this project actually launches:
   *
   *  - `mcp-server/src/auth.js` launches patchright with `channel: AIRTABLE_BROWSER_CHANNEL ||
   *    'chrome'` (documented values `chrome|msedge|chromium`) and an optional explicit
   *    `AIRTABLE_BROWSER_PATH` executable.
   *  - patchright-core's channel registry resolves those channels to `chrome.exe` / `msedge.exe`
   *    (win32), `/opt/google/chrome{,-beta,-unstable,-canary}/chrome` and
   *    `/opt/microsoft/msedge{,-beta,-dev}/msedge` (linux), and `…/MacOS/Google Chrome[ Beta|Dev|
   *    Canary]` / `…/MacOS/Microsoft Edge[ Beta|Dev|Canary]` (darwin).
   *  - patchright-core's DOWNLOADED-browser registry resolves to `chrome`/`chrome.exe`,
   *    `Google Chrome for Testing`, `Chromium` (older mac layout — see `browser-download.ts`),
   *    `chrome-headless-shell[.exe]` and `headless_shell`.
   *  - `browser-detect.ts` additionally hands patchright a system Chromium (`chromium`,
   *    `chromium-browser`, `…/MacOS/Chromium`), Chrome (`google-chrome`,
   *    `google-chrome-stable`), Edge (`microsoft-edge`, `microsoft-edge-stable`) or Brave
   *    (`brave.exe`, `brave`, `brave-browser`, `…/MacOS/Brave Browser`).
   *
   * CROSS-REFERENCE — `mcp-server/src/process-tree.js` (`isOwnedBrowserCommandLine`) solves the
   * same problem for the SERVER. The two are now the SAME predicate: this class is the reference
   * and process-tree.js is a line-for-line port of it (it cannot import this file — the MCP server
   * is a standalone npm package). The one deliberate difference is downstream of attribution:
   * process-tree kills process TREES, so it skips Chromium helpers (`--type=`), whereas this sweep
   * kills pids individually and therefore keeps them.
   *
   * THE DRIFT IS TEST-ENFORCED, not comment-enforced. Both implementations are asserted against
   * ONE committed vector, `packages/shared/test-fixtures/process-attribution-cases.json`, by this
   * package's `src/test/daemon-manager.test.ts` and the server's `test/test-process-tree.test.js`.
   * Change the predicate here without changing it there (or vice versa) and the side that was NOT
   * changed fails. Five previous drifts each shipped a force-kill of an innocent process.
   */
  private static readonly CHROME_FAMILY_IMAGES: ReadonlySet<string> = new Set([
    'chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell', 'headless_shell',
    'google chrome for testing',
    'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable',
    'google chrome', 'google chrome beta', 'google chrome dev', 'google chrome canary',
    'msedge', 'microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'microsoft-edge-dev',
    'microsoft edge', 'microsoft edge beta', 'microsoft edge dev', 'microsoft edge canary',
    'brave', 'brave-browser', 'brave browser',
  ]);

  /**
   * macOS helper images (`Google Chrome Helper`, `… Helper (Renderer)`, …). They carry the same
   * `--user-data-dir` as their root browser, so without this they would be *reported* as
   * unattributable on every macOS stop — pure noise for processes that are demonstrably ours.
   */
  private static readonly CHROME_FAMILY_HELPER =
    /^(?:google chrome(?: for testing| beta| dev| canary)?|microsoft edge(?: beta| dev| canary)?|chromium|brave browser) helper(?: \([^)]*\))?$/;

  /**
   * Exec-wrappers that replace themselves with the real image, shifting it out of argv[0]. A
   * LEADING run of these is skipped so `env chrome …` / `xvfb-run /usr/bin/chromium …` are still
   * attributable. Deliberately tiny and allowlisted: any other leading token (`vim`, `node`,
   * `python3`, `notepad.exe`, …) means the browser-looking token is that program's ARGUMENT, not
   * the process image, and the command line is then NOT attributable — the exact confusion this
   * whole criterion exists to prevent. A wrapper form we do not list (`xvfb-run -a chrome …`,
   * `snap run chromium`, `flatpak run …`) simply fails to attribute: reported, never killed.
   */
  private static readonly WRAPPER_IMAGES: ReadonlySet<string> = new Set([
    'env', 'nohup', 'xvfb-run', 'dbus-run-session', 'setarch', 'stdbuf',
  ]);

  /**
   * A ROOTED path in `_canon` form: absolute POSIX (`/…`), UNC (`\\srv` → `//srv`), drive-rooted
   * Windows (`c:/…`), or explicitly relative (`./…`, `../…`). Deliberately NOT matched: a bare
   * relative path (`x/chrome`, `tools/chrome`, `sub/msedge`) and a drive-RELATIVE Windows path
   * (`c:x/chrome`) — the shapes that let a browser-named file masquerade as a process image.
   */
  private static readonly ROOTED = /^(?:[a-z]:\/|\/|\.\.?\/)/;

  /**
   * A token that CANNOT be the continuation of an unquoted path that contains spaces, because it
   * is itself rooted, quoted, or flag-shaped. NOTE what this does NOT cover: a bare relative path
   * (`x/chrome`) is indistinguishable from a path continuation by inspection alone — that gap is
   * closed by the separate `ROOTED` and bundle-marker requirements in `_imageName`, NOT here.
   */
  private static readonly NEW_ARG_LIKE = /^(?:[a-z]:\/|\/|\.|["'-])/;

  /**
   * The only structural proof that an unquoted, SPACE-CONTAINING string is one path rather than a
   * program plus arguments: the macOS app-bundle layout. Every Chrome-family image whose real path
   * contains a space is a bundle executable — `…/Google Chrome.app/Contents/MacOS/Google Chrome`,
   * `…/Google Chrome Helper.app/…`, `…/Google Chrome for Testing.app/…`, Edge, Brave, Chromium.
   *
   * The marker ALONE proves nothing — `git add x.app/contents/macos/chrome` contains it too — so
   * `_macBundleExec()` additionally enforces the bundle's own naming rule, and a Windows-spelled
   * command line is refused the multi-token path entirely (Windows has no `.app` executables).
   */
  private static readonly MAC_BUNDLE_MARKER = '.app/contents/macos/';

  /**
   * Is this command line written in a WINDOWS path spelling? Decided from the RAW string, before
   * `_canon` erases the distinction by folding `\` into `/`: a backslash anywhere, or a
   * drive-rooted token. Used to refuse the macOS-bundle branch of `_imageName` on Windows, where
   * `.app/Contents/MacOS/…` is not an executable layout and therefore proves nothing about
   * argv[0]'s extent. Spelling, NOT host platform: the same command line must attribute the same
   * way on every machine — that is what lets `packages/shared/test-fixtures/
   * process-attribution-cases.json` assert both forms on both packages regardless of the runner's
   * OS. (An escaped-space POSIX path, `/home/u/my\ apps/chrome`, reads as Windows-spelled here and
   * simply fails to attribute — the safe direction.)
   */
  private static _isWindowsSpelling(raw: string, canonCmd: string): boolean {
    return raw.includes('\\') || /(?:^|[\s"'])[a-z]:\//.test(canonCmd);
  }

  /**
   * The executable name of a macOS app-bundle path, or `''` if the string is not one.
   *
   * A real bundle names its executable after the bundle: `Google Chrome.app/Contents/MacOS/Google
   * Chrome`, `Google Chrome Helper.app/…/Google Chrome Helper (Renderer)`, `Google Chrome for
   * Testing.app/…/Google Chrome for Testing`, `Brave Browser.app/…/Brave Browser`. So the segment
   * before `.app` must equal the executable, or be its prefix followed by ` (` (the helper
   * variants). That naming rule is what the marker alone was missing: it rejects
   * `x.app/contents/macos/chrome`, `Foo.App/Contents/MacOS/Chrome` and every other
   * "a browser-named file that happens to sit under some .app" spelling, on either platform.
   *
   * The LAST marker occurrence is used because helpers nest inside the outer browser bundle.
   */
  private static _macBundleExec(joined: string): string {
    const at = joined.lastIndexOf(DaemonManager.MAC_BUNDLE_MARKER);
    if (at < 0) return '';
    const bundle = joined.slice(joined.lastIndexOf('/', at) + 1, at);
    const exec = joined.slice(at + DaemonManager.MAC_BUNDLE_MARKER.length);
    if (!bundle || !exec || exec.includes('/')) return '';
    if (exec !== bundle && !exec.startsWith(`${bundle} (`)) return '';
    return exec;
  }

  /**
   * argv[0]'s basename, lower-cased and `.exe`-stripped, from a `_canon`-form command line — or
   * `''` when argv[0] cannot be identified unambiguously.
   *
   * Process enumeration hands us a FLAT STRING, and an unquoted argv[0] may itself contain spaces,
   * so argv[0]'s extent has to be recovered. The rules, and the reason each one exists:
   *
   *   1. A quoted leading token IS argv[0] — the launcher's own quoting is its statement of the
   *      extent, which is exactly why quoted Windows paths with spaces still work. Two guards
   *      against a MIS-PARSE presenting somebody's argument as the image: a token containing
   *      whitespace must be `ROOTED`, and none of its later sub-tokens may be `NEW_ARG_LIKE`.
   *      Those reject `"vim /home/u/chrome" …` and `"C:\Program Files\vim\vim.exe C:\x\chrome" …`
   *      while leaving `"C:\Program Files\Google\Chrome\Application\chrome.exe"` intact. What they
   *      do NOT do is second-guess a quoted single path: if a command line claims argv[0] is
   *      `"/usr/bin/vim x/chrome"`, the image really is a file named `chrome`, and only a process
   *      naming ITSELF that way could produce it.
   *   2. Otherwise: take the text before the first flag-shaped token (`\s["']?-{1,2}\S`), skip a
   *      leading run of `WRAPPER_IMAGES`, and then
   *        - ONE token left  → that is argv[0] (`chrome.exe`, `/opt/chromium`, `./chrome`, `vim`);
   *        - MORE than one   → argv[0] may span them ONLY when all four hold:
   *            (a) the first token is `ROOTED`,
   *            (b) no later token is `NEW_ARG_LIKE`,
   *            (c) the command line is not Windows-spelled (`_isWindowsSpelling`), and
   *            (d) the join is a macOS bundle path whose executable obeys the bundle's naming
   *                rule (`_macBundleExec`).
   *          (c)+(d) are what make this exhaustive rather than a list of patched examples. A bare
   *          relative argument (`vim x/chrome`, `git add sub/msedge`) is SYNTACTICALLY IDENTICAL
   *          to a legitimate space-containing path (`/applications/google chrome.app/…`), so no
   *          rule over tokens alone can separate them; only the bundle LAYOUT can, and the layout
   *          is meaningless on Windows and meaningless when the executable is not named after its
   *          bundle. The marker alone — which is all this used to require — accepted
   *          `/usr/bin/git add x.app/contents/macos/chrome`,
   *          `/usr/bin/tar cf a x.app/contents/macos/chrome`,
   *          `notepad.exe x.app\contents\macos\chrome.exe`, `7z.exe e Foo.App\Contents\MacOS\Chrome`
   *          and `\\srv\share\notepad.exe x.app\contents\macos\chrome`.
   *
   * CONSEQUENCE, stated because it is a real narrowing: an UNQUOTED Windows image path containing
   * spaces (`C:\Program Files\Google\Chrome\Application\chrome.exe --user-data-dir=…`) does not
   * attribute — it is reported, not killed. Keeping it would mean accepting
   * `C:\Windows\System32\notepad.exe x\chrome.exe --user-data-dir=…` as a browser, since the two
   * are the same shape. Verified against live `Win32_Process` during review: every Chrome-family
   * entry, root and `--type=` children alike, emits a QUOTED argv[0], so rule 1 covers Windows.
   *
   * RESIDUAL, stated rather than papered over — and it is now POSIX-only and narrow: a
   * POSIX-spelled command line that hands another program a CORRECTLY-NAMED bundle executable
   * path, e.g. `/usr/bin/vim x/Google Chrome.app/Contents/MacOS/Google Chrome
   * --user-data-dir=<our profile>`. That string is byte-for-byte a real macOS browser invocation;
   * nothing short of asking the filesystem can separate them, and it still requires the caller to
   * pass our exact profile flag. Everything else enumerated in the `IMAGE CONJUNCT` tests and in
   * `packages/shared/test-fixtures/process-attribution-cases.json` resolves to `''`.
   */
  private static _imageName(cmd: string, winSpelling: boolean): string {
    const quote = cmd[0];
    if (quote === '"' || quote === '\'') {
      const end = cmd.indexOf(quote, 1);
      const token = (end > 0 ? cmd.slice(1, end) : cmd.slice(1)).trim();
      if (/\s/.test(token)) {
        if (!DaemonManager.ROOTED.test(token)) return '';
        const sub = token.split(/\s+/);
        if (sub.slice(1).some(t => DaemonManager.NEW_ARG_LIKE.test(t))) return '';
      }
      return DaemonManager._basename(token);
    }
    const flag = /\s["']?-{1,2}\S/.exec(cmd);
    const head = (flag ? cmd.slice(0, flag.index) : cmd).trim();
    let tokens = head.split(/\s+/).filter(Boolean);
    while (tokens.length > 1
      && DaemonManager.WRAPPER_IMAGES.has(DaemonManager._basename(tokens[0]))) {
      tokens = tokens.slice(1);
    }
    if (tokens.length === 0) return '';
    if (tokens.length === 1) return DaemonManager._basename(tokens[0]);
    if (!DaemonManager.ROOTED.test(tokens[0])) return '';
    if (tokens.slice(1).some(t => DaemonManager.NEW_ARG_LIKE.test(t))) return '';
    if (winSpelling) return '';
    return DaemonManager._basename(DaemonManager._macBundleExec(tokens.join(' ')));
  }

  /** Basename of a `_canon`-form path: quotes trimmed, text after the last `/`, `.exe` dropped. */
  private static _basename(p: string): string {
    const s = p.trim().replace(/^["']+/, '').replace(/["']+$/, '');
    const base = s.slice(s.lastIndexOf('/') + 1);
    return base.endsWith('.exe') ? base.slice(0, -'.exe'.length) : base;
  }

  /** Is this command line's process image a Chrome-family browser we could have launched? */
  private static _isChromeFamilyImage(cmd: string, winSpelling: boolean): boolean {
    const image = DaemonManager._imageName(cmd, winSpelling);
    return DaemonManager.CHROME_FAMILY_IMAGES.has(image)
      || DaemonManager.CHROME_FAMILY_HELPER.test(image);
  }

  private static readonly USER_DATA_DIR_FLAG = '--user-data-dir=';

  /**
   * Does argv carry `--user-data-dir=<profileDir>` for EXACTLY this directory?
   *
   * Deliberately built on the SAME `_containsPathToken` boundary check criterion (a) uses — one
   * matching primitive for both criteria is what stops them drifting apart again. `flag+dir` is
   * matched as a whole argv token, so:
   *   - `…/.chrome-profile-backup`, `…/.chrome-profile.old` → the following `-`/`.` is not an
   *     argv boundary → MISS;
   *   - `…/.chrome-profile/Default` (a subdirectory) → following `/` → MISS;
   *   - `--user-data-dir=/mnt/backup/home/u/…/.chrome-profile` → `flag+dir` never appears
   *     contiguously → MISS;
   *   - a longer flag ending in `user-data-dir=` → the preceding character is not a boundary
   *     → MISS.
   *   - a NESTED spelling — `--foo=--user-data-dir=<dir>`, or
   *     `--user-data-dir=/other=--user-data-dir=<dir>` (a browser pointed at a DIFFERENT profile,
   *     which it would have been a false kill to accept) → the flag must begin an argv entry, and
   *     `ARG_BOUNDARY` excludes `=` from the characters that may abut an argv entry → MISS.
   * The three needle spellings cover the quotings argv actually arrives in: bare,
   * `"--user-data-dir=C:/Users/a b/…"` (Node quotes the WHOLE argument when it contains a space —
   * the opening quote is itself a boundary), and `--user-data-dir="…"` / `'…'`. The bare form
   * also covers POSIX `ps -o args=`, which joins argv with spaces and quotes nothing, so a home
   * directory containing a space still matches. A trailing separator is the same directory.
   *
   * Both arguments must already be in `_canon` form — that is what makes the comparison
   * case-insensitive and `\` vs `/` tolerant.
   */
  private static _hasUserDataDirArg(cmd: string, profileDir: string): boolean {
    if (!profileDir) return false;
    const flag = DaemonManager.USER_DATA_DIR_FLAG;
    for (const dir of [profileDir, `${profileDir}/`]) {
      if (DaemonManager._containsPathToken(cmd, `${flag}${dir}`)) return true;
      if (DaemonManager._containsPathToken(cmd, `${flag}"${dir}"`)) return true;
      if (DaemonManager._containsPathToken(cmd, `${flag}'${dir}'`)) return true;
    }
    return false;
  }

  /**
   * Does this (`_canon`-form) command line claim OUR exact browser profile via `--user-data-dir`?
   * Independent of *what* the process is — used both as half of ownership criterion (b) and as
   * the fail-safe REPORTING predicate for a profile holder we cannot attribute.
   */
  private _claimsOurProfile(canonCmd: string): boolean {
    const profileDir = this._profileDir();
    return profileDir !== null && DaemonManager._hasUserDataDirArg(canonCmd, profileDir);
  }

  /**
   * Positive ownership test — the ONLY kill criterion.
   *
   * (a) the exact bundled `<extensionPath>/dist/mcp/index.mjs` this install spawns, matched as a
   *     whole argv token, AND the `daemon`/`start` subcommand shape `_spawnDetached()` always
   *     emits. BOTH conjuncts are required: the path alone only proves the file is *mentioned*
   *     in the argv, not that the process is *running* it. `code <bundled path>` (the user
   *     opening our file in an editor), an Explorer double-click, `node --check <path>` or a
   *     build tool listing it would otherwise be force-killed WITH THEIR PROCESS TREE — for the
   *     editor case that is the user's unsaved work and the extension host running this sweep.
   *     This is the same "our file appears in someone else's argv" hazard that rules out using a
   *     bare `.airtable-user-mcp` fragment as a criterion; or
   * (b) a Chrome-family browser process ACTUALLY RUNNING our persistent profile. Like (a), this
   *     requires TWO conjuncts:
   *       1. the process image is one of the Chrome-family binaries this project can launch
   *          (`CHROME_FAMILY_IMAGES` / `CHROME_FAMILY_HELPER`, derived from patchright's channel +
   *          download registries and `browser-detect.ts`). "Image" means argv[0]'s basename as
   *          recovered by `_imageName()` from a flat command-line string: a quoted argv[0], a
   *          single-token argv[0], or — only on a POSIX-spelled command line, and only when the
   *          join is a correctly-named macOS bundle executable — a space-containing one; with a
   *          leading run of exec wrappers (`env`, `xvfb-run`, …) skipped. Anything `_imageName()`
   *          cannot pin down yields no image and cannot satisfy this conjunct. The spellings this
   *          rejects, and the one POSIX-only residual it does not, are enumerated in
   *          `_imageName()`'s docblock, in the `IMAGE CONJUNCT` tests, and in the cross-package
   *          vector `packages/shared/test-fixtures/process-attribution-cases.json`, AND
   *       2. argv carries `--user-data-dir=<profileDir>` for the EXACT resolved
   *          `<configDir>/.chrome-profile` (`_profileDir()`), matched as a whole argv token —
   *          same canonicalization as criterion (a), and `ARG_BOUNDARY` on BOTH sides, so
   *          `<profile>=2` (a different directory) is a miss just as `<profile>-backup` is.
   *
   *     CORRECTION — the docblock this replaces asserted criterion (b) was "already correctly
   *     scoped" and "UNCHANGED from the original". That claim was FALSE, and it is why two review
   *     passes let the criterion through. What it actually did was
   *       `cmd.indexOf('.airtable-user-mcp') >= 0 && cmd.indexOf('.chrome-profile', …) > …`
   *     — a loose two-fragment substring scan with no executable requirement and no argument
   *     matching. Any process whose command line merely MENTIONED the profile path was force-
   *     killed WITH ITS PROCESS TREE: an editor holding `…/.chrome-profile/Default/Preferences`,
   *     a `grep -r`/`rg` over the config dir, a file manager, a backup job — and
   *     `…/.chrome-profile-backup` or another app's Chrome pointed at a *different*
   *     `--user-data-dir` under `~/.airtable-user-mcp` matched just as readily. That is exactly
   *     the "our path appears in someone else's argv" hazard criterion (a) was hardened against
   *     one branch above; (b) is now closed the same way, and fails safe the same way — a
   *     profile holder we cannot positively attribute is left ALIVE and reported.
   */
  private _isOwnedCommandLine(commandLine: string): boolean {
    const cmd = DaemonManager._canon(commandLine);
    const entry = this._bundledEntryPath();
    if (entry
      && DaemonManager._containsPathToken(cmd, DaemonManager._canon(entry), DaemonManager.PATH_LEAD_BOUNDARY)
      && DaemonManager._hasDaemonStartShape(commandLine)) return true;
    return this._claimsOurProfile(cmd)
      && DaemonManager._isChromeFamilyImage(cmd, DaemonManager._isWindowsSpelling(commandLine, cmd));
  }

  /**
   * `index.mjs` … `daemon` … `start`, in that order, anywhere in argv — the shape
   * `_spawnDetached()` always emits (`[serverPath, 'daemon', 'start', …]`).
   *
   * This was the OLD kill criterion **on its own**, which is what made the sweep dangerous. It is
   * never sufficient now. It serves two purposes:
   *   1. as a REQUIRED CONJUNCT of ownership criterion (a) — proving the process is *running* our
   *      bundled entry as a daemon rather than merely naming the file; and
   *   2. as the REPORTING predicate — a process with this shape that fails ownership is surfaced
   *      as "looked like a stray daemon, ownership unverified" so the user still learns about a
   *      leftover from another install instead of it being silently executed.
   */
  private static _hasDaemonStartShape(commandLine: string): boolean {
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
      } else if (DaemonManager._hasDaemonStartShape(proc.commandLine)
        || this._claimsOurProfile(DaemonManager._canon(proc.commandLine))) {
        // Reported, never killed: a stray daemon of ANOTHER install (criterion a's shape), or
        // something holding our exact profile that is not a browser we could have launched
        // (criterion b's argument without criterion b's image).
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
   * ownership test (it can only ever return too much, never too little): criterion (a) always
   * carries `index.mjs`, and criterion (b) always carries `--user-data-dir=<…>/.chrome-profile`
   * because `_profileDir()` is `<configDir>` joined with that exact literal.
   *
   * POSIX: `ps -A -ww -o pid= -o args=` — a fixed argv with nothing interpolated.
   */
  private _listProcesses(platform: NodeJS.Platform = process.platform): SweptProcess[] {
    if (platform === 'win32') {
      const script =
        // Windows PowerShell 5.1 writes redirected stdout in the console OEM codepage (e.g. 437),
        // but we decode as utf8. Without this an install root containing non-ASCII
        // (`C:\Users\José\.vscode\extensions\…`) arrives mojibaked (`Jos\uFFFD`), criterion (a)
        // can never match, and our OWN orphan gets reported as unowned instead of swept — the
        // feature silently stops working for those users. Fails safe (never a false kill).
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
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
