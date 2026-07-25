import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const execFile = promisify(execFileCb);

/**
 * Process-tree termination and browser-profile squatter eviction.
 *
 * Orphan Chromium processes hold the profile ProcessSingleton so later
 * launchPersistentContext calls get forwarded ("Opening in existing browser
 * session") and the new chrome exits while the orphan keeps the RAM.
 */

/**
 * Terminate a process AND its children.
 * Windows: taskkill /T /F.
 * POSIX: SIGTERM the root, then walk children (pgrep -P), then SIGKILL stragglers.
 */
export async function terminateProcessTree(pid, { platform = process.platform, exec = execFile } = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  if (platform === 'win32') {
    await exec('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10_000,
    }).catch(() => undefined);
    return;
  }

  const descendants = await collectDescendantPids(pid, exec).catch(() => []);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // root already gone
  }
  for (const child of descendants) {
    try {
      process.kill(child, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await delay(1_000);
  for (const target of [pid, ...descendants]) {
    try {
      process.kill(target, 0);
      process.kill(target, 'SIGKILL');
    } catch {
      // ESRCH — exited after SIGTERM
    }
  }
}

/** BFS children of `rootPid` via `pgrep -P` (best-effort). */
async function collectDescendantPids(rootPid, exec) {
  const out = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    const parent = queue.shift();
    let stdout = '';
    try {
      ({ stdout } = await exec('pgrep', ['-P', String(parent)], { timeout: 5_000 }));
    } catch {
      continue;
    }
    for (const tok of String(stdout).split(/\s+/)) {
      const child = Number.parseInt(tok, 10);
      if (!Number.isInteger(child) || child <= 0 || seen.has(child) || child === process.pid) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

// ─── Positive-attribution primitives ──────────────────────────────────────────
//
// CROSS-REFERENCE: these mirror `_canon`, `_containsPathToken`, `ARGV_BOUNDARY`,
// `ABSOLUTE_LIKE`, `_stripTrailingSep`, `CHROME_FAMILY_IMAGES`, `_imageName` and
// `_hasUserDataDirArg` in `packages/extension/src/mcp/daemon-manager.ts`
// (`_sweepOrphans` ownership criterion (b)). They are REIMPLEMENTED rather than imported
// because `packages/mcp-server` is a standalone npm package (`airtable-user-mcp`) that must
// not depend on the extension package. Same defect class, same fix — keep the two in sync
// by hand, and change both when either changes.
//
// The defect class: "a process whose command line merely MENTIONS our profile path is force-
// killed WITH ITS PROCESS TREE". Third occurrence in this codebase (after `_sweepOrphans`
// criteria (a) and (b)). The cure is always the same shape — kill only on POSITIVE
// attribution, built from two independent conjuncts (it IS a browser we could have launched,
// AND it claims OUR exact profile as a whole argv token) — and fail safe: anything not
// positively attributable is left alive.

/** Characters that may legally abut a path inside an argv string (separator or quoting). */
const ARGV_BOUNDARY = /[\s"'=]/;
/** `C:\…`, `\\server\share…` or `/…` — guards against an empty/relative userDataDir. */
const ABSOLUTE_LIKE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * Canonical form for command-line comparison: `\` → `/`, lower-cased.
 * Case folding is what makes Windows path matching correct; on POSIX it is a negligible
 * widening (two real profile dirs differing only in letter case would have to collide) and
 * keeps ONE code path. Quotes are deliberately NOT stripped — they are argv boundaries.
 */
function canon(s) {
  return String(s).replace(/\\/g, '/').toLowerCase();
}

/** Trailing separators are not part of a directory's identity (`canon` already made them `/`). */
function stripTrailingSep(p) {
  return p.replace(/\/+$/, '');
}

/**
 * Does `haystack` contain `needle` as a whole argv token? The characters immediately before
 * and after the match must be a boundary (start/end of string, whitespace, quote or `=`), so
 * a longer neighbouring path can never satisfy it. Both args must be in `canon` form.
 */
function containsPathToken(haystack, needle) {
  if (!needle) return false;
  for (let from = 0; ; ) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : haystack[i - 1];
    const afterIdx = i + needle.length;
    const after = afterIdx >= haystack.length ? '' : haystack[afterIdx];
    if ((before === '' || ARGV_BOUNDARY.test(before)) && (after === '' || ARGV_BOUNDARY.test(after))) {
      return true;
    }
    from = i + 1;
  }
}

/**
 * Chrome-family process images (argv[0] basename, lower-cased, `.exe` stripped) — the ONLY
 * images this module will ever kill. DERIVED from what this project can actually launch:
 *
 *  - `src/auth.js` launches patchright with `channel: AIRTABLE_BROWSER_CHANNEL || 'chrome'`
 *    (documented values `chrome|msedge|chromium`) plus an optional explicit
 *    `AIRTABLE_BROWSER_PATH` executable.
 *  - patchright-core's channel registry resolves those channels to `chrome.exe`/`msedge.exe`
 *    (win32), `/opt/google/chrome{,-beta,-unstable,-canary}/chrome` and
 *    `/opt/microsoft/msedge{,-beta,-dev}/msedge` (linux), and
 *    `…/MacOS/Google Chrome[ Beta|Dev|Canary]` / `…/MacOS/Microsoft Edge[ …]` (darwin).
 *  - patchright-core's DOWNLOADED-browser registry (driven by the extension's
 *    `browser-download.ts`) resolves to `chrome`/`chrome.exe`, `Google Chrome for Testing`,
 *    `Chromium` (mac layout), `chrome-headless-shell[.exe]` and `headless_shell`.
 *  - the extension's `browser-detect.ts` additionally hands patchright a system Chromium
 *    (`chromium`, `chromium-browser`, `…/MacOS/Chromium`), Chrome (`google-chrome`,
 *    `google-chrome-stable`), Edge (`microsoft-edge`, `microsoft-edge-stable`) or Brave
 *    (`brave.exe`, `brave`, `brave-browser`, `…/MacOS/Brave Browser`).
 *
 * This is the POSIX equivalent of the process-NAME filter the win32 branch below already
 * applies (`chrome.exe`/`msedge.exe`/`chromium.exe`), widened to the images the other
 * platforms and the downloaded/Brave paths actually produce.
 *
 * Chromium HELPER images (`Google Chrome Helper (Renderer)`, …) are deliberately absent:
 * this function selects ROOT browsers to kill, and helpers always carry `--type=` (rejected
 * a step earlier) and die with their root's process tree anyway. Omitting them can only
 * under-kill, which is the direction this module must fail in.
 */
const CHROME_FAMILY_IMAGES = new Set([
  'chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell', 'headless_shell',
  'google chrome for testing',
  'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable',
  'google chrome', 'google chrome beta', 'google chrome dev', 'google chrome canary',
  'msedge', 'microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'microsoft-edge-dev',
  'microsoft edge', 'microsoft edge beta', 'microsoft edge dev', 'microsoft edge canary',
  'brave', 'brave-browser', 'brave browser',
]);

/**
 * argv[0]'s basename, lower-cased and `.exe`-stripped, from a `canon`-form command line.
 *
 * Handles the shapes process enumeration actually yields:
 *   `"/path/with space/chrome" --user-data-dir=…`                       (quoted image)
 *   `/opt/google/chrome/chrome --user-data-dir=…`                       (bare)
 *   `/applications/google chrome.app/contents/macos/google chrome --…`  (bare, spaces)
 * For the unquoted forms the image is everything before the first flag-shaped token, so a
 * path containing spaces survives. A command line with no flag at all (`vim /some/file`)
 * keeps its whole text as the "image", whose basename is a filename — never a browser name.
 */
function imageName(cmd) {
  let head;
  const quote = cmd[0];
  if (quote === '"' || quote === "'") {
    const end = cmd.indexOf(quote, 1);
    head = end > 0 ? cmd.slice(1, end) : cmd.slice(1);
  } else {
    const flag = /\s-{1,2}\S/.exec(cmd);
    head = flag ? cmd.slice(0, flag.index) : cmd;
  }
  head = head.trim().replace(/["']+$/, '');
  const base = head.slice(head.lastIndexOf('/') + 1);
  return base.endsWith('.exe') ? base.slice(0, -'.exe'.length) : base;
}

/** Is this command line's process image a Chrome-family browser we could have launched? */
function isChromeFamilyImage(cmd) {
  return CHROME_FAMILY_IMAGES.has(imageName(cmd));
}

const USER_DATA_DIR_FLAG = '--user-data-dir=';

/**
 * Does argv carry `--user-data-dir=<profileDir>` for EXACTLY this directory?
 *
 * `flag+dir` is matched as a whole argv token, so:
 *   - `<profile>-backup`, `<profile>.old` → the following `-`/`.` is not a boundary → MISS;
 *   - `<profile>/Default` (a subdirectory) → the following `/` (or, for the `<dir>/` needle,
 *     the following `D`) is not a boundary → MISS;
 *   - `--user-data-dir=/mnt/backup<profile>` → `flag+dir` never appears contiguously → MISS;
 *   - another OS user's identically-named `/home/other/.chrome-profile` → different absolute
 *     string → MISS;
 *   - a longer flag ending in `user-data-dir=` → the preceding char is not a boundary → MISS.
 * The three needle spellings cover the quotings argv arrives in: bare, `"--user-data-dir=…"`
 * (whole argument quoted — the opening quote is itself a boundary) and `--user-data-dir="…"`.
 * The bare form also covers POSIX `ps -o args=` / `/proc/<pid>/cmdline`, which join argv with
 * spaces and quote nothing, so a home directory containing a space still matches. A trailing
 * separator is the same directory.
 *
 * Both args must be in `canon` form — that is what makes the comparison case-insensitive and
 * `\` vs `/` tolerant.
 */
function hasUserDataDirArg(cmd, profileDir) {
  if (!profileDir) return false;
  for (const dir of [profileDir, `${profileDir}/`]) {
    if (containsPathToken(cmd, `${USER_DATA_DIR_FLAG}${dir}`)) return true;
    if (containsPathToken(cmd, `${USER_DATA_DIR_FLAG}"${dir}"`)) return true;
    if (containsPathToken(cmd, `${USER_DATA_DIR_FLAG}'${dir}'`)) return true;
  }
  return false;
}

/**
 * Find root browser pids that are ACTUALLY RUNNING our persistent profile.
 *
 * A pid is returned only on POSITIVE attribution — never because our profile path merely
 * appears somewhere in its command line:
 *   1. the process image (argv[0]'s basename) is a Chrome-family binary this project can
 *      launch (`CHROME_FAMILY_IMAGES`), AND
 *   2. argv carries `--user-data-dir=<userDataDir>` for the EXACT directory, matched as a
 *      whole argv token (`hasUserDataDirArg`), AND
 *   3. it is not a Chromium helper (`--type=…`) — those die with their root's tree.
 * Anything whose command line cannot be read at all is left ALIVE.
 *
 * FALLBACK REMOVED (the hole this replaces). The previous implementation ran
 *   try   { pgrep -f -- `--user-data-dir=<dir>` }
 *   catch { pgrep -f -- `<dir>` }              // ← ANY process mentioning the profile path
 * and passed the result to a filter that dropped only `--type=` helpers, with NO executable
 * filter on POSIX at all. Because `pgrep` exits 1 on "no match", the bare-directory fallback
 * fired in the NORMAL case (no squatter present), so on Linux/macOS
 * `vim ~/.airtable-user-mcp/.chrome-profile/Default/Preferences` — or a `grep -r`, an `rg`,
 * a `find`, an `rsync` backup, a file manager — was SIGTERMed then SIGKILLed together with
 * its children by `terminateProcessTree`, automatically, during ordinary operation
 * (`profile-lock.evictProfileSquatters` on lock acquisition, `killProfileBrowserTree` on
 * browser park/close).
 *
 * The fallback is gone rather than merely image-filtered, because it is provably incapable of
 * contributing a killable pid: the bare-dir query is a strict superset of the marker query,
 * so the only processes it ADDS are those that do NOT carry `--user-data-dir=<dir>` — and
 * requirement 2 above rejects every one of them. It existed to catch "Chromium variants that
 * embed the path without the flag form", but no such variant exists: Chromium's
 * `base::CommandLine` parser only understands `--switch=value` (a space-separated
 * `--user-data-dir /path` is parsed as an empty-valued switch plus a positional URL and does
 * NOT claim the profile), and patchright/Playwright always emits the `=` form. Every real
 * squatter — a leaked headless Chrome, a stale Edge, a user's Brave opened on our profile —
 * carries the marker and is still found. Keeping a query whose entire marginal yield is
 * unkillable would only mean enumerating the user's editors for no benefit.
 *
 * Win32 keeps its existing query unchanged: it already restricts to
 * chrome.exe / msedge.exe / chromium.exe (the filter POSIX was missing).
 */
export async function findProfileBrowserPids(
  userDataDir,
  { platform = process.platform, exec = execFile, readProc } = {},
) {
  // An empty or relative userDataDir would turn every match below into a bare fragment that
  // matches half the machine. Nothing is attributable → kill nothing.
  const dir = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (!dir || !ABSOLUTE_LIKE.test(dir)) return [];

  const marker = `--user-data-dir=${userDataDir}`;

  if (platform === 'win32') {
    // Marker travels via ENV so PowerShell's own command line doesn't self-match.
    // Name filter restores chrome/msedge-only targeting (legacy killProfileHolders).
    const script =
      "Get-CimInstance Win32_Process | Where-Object { " +
      "($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe' -or $_.Name -eq 'chromium.exe') -and " +
      "$_.CommandLine -and (" +
      "$_.CommandLine.Contains($env:AIRTABLE_EVICT_MARKER) -or $_.CommandLine.Contains($env:AIRTABLE_EVICT_DIR)" +
      ") -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }";
    try {
      const { stdout } = await exec(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          windowsHide: true,
          timeout: 15_000,
          env: {
            ...process.env,
            AIRTABLE_EVICT_MARKER: marker,
            AIRTABLE_EVICT_DIR: String(userDataDir),
          },
        },
      );
      return parsePids(stdout);
    } catch {
      return [];
    }
  }

  let pids = [];
  try {
    // CANDIDATE GENERATION ONLY — never the authority on what gets killed. `pgrep -f` treats
    // its pattern as an ERE (so `.` in `.chrome-profile` is a wildcard) and matches
    // substrings; `filterOwnedBrowserPids` below re-checks every candidate literally, as a
    // whole argv token, against a Chrome-family image. `pgrep` exits 1 on "no match" — there
    // is deliberately no bare-directory fallback (see the docblock above).
    const { stdout } = await exec('pgrep', ['-f', '--', marker], { timeout: 10_000 });
    pids = parsePids(stdout);
  } catch {
    return [];
  }
  return filterOwnedBrowserPids(pids, stripTrailingSep(canon(dir)), exec, readProc);
}

/**
 * Keep only pids positively attributable to a Chrome-family browser running OUR exact
 * profile; drop everything else. Fails safe in every ambiguous case.
 * Linux: /proc/<pid>/cmdline. macOS/BSD: ps -p <pid> -o args=.
 *
 * @param {number[]} pids           candidates from `pgrep`
 * @param {string}   profileDir     our profile dir, already `canon`-ed + trailing-sep-stripped
 */
async function filterOwnedBrowserPids(pids, profileDir, exec, readProc = readProcCmdline) {
  const roots = [];
  for (const pid of pids) {
    const args = await readProcessArgs(pid, exec, readProc);
    // Unreadable / empty command line (pid gone, kernel thread, EPERM) → not attributable.
    if (!args || !args.trim()) continue;
    const cmd = canon(args);
    // Chromium helper (renderer/gpu/utility/zygote) — dies with its root browser's tree.
    if (cmd.includes('--type=')) continue;
    // Conjunct 1: is it a browser this project could have launched? This is the check POSIX
    // was missing entirely, and it is what keeps `vim`/`grep`/`rg`/`find`/`rsync`/a file
    // manager holding a path under the profile out of `terminateProcessTree`.
    if (!isChromeFamilyImage(cmd)) continue;
    // Conjunct 2: does it claim OUR exact profile, as a whole argv token? Rejects a browser
    // on a DIFFERENT `--user-data-dir`, `<profile>-backup`, `<profile>/Default`,
    // `/mnt/backup<profile>` and another OS user's identically-named path.
    if (!hasUserDataDirArg(cmd, profileDir)) continue;
    roots.push(pid);
  }
  return roots;
}

// Default /proc reader (Linux fast-path, no shell). Returns the space-joined cmdline (may be '' for
// a kernel thread), or null when /proc is unavailable (not Linux / pid gone) so the caller falls
// back to `ps`. Injectable so tests can bypass the runner's REAL /proc (whose low PIDs 55/66/77 are
// kernel threads with empty cmdlines — that made the mocked `ps` path unreachable and the test fail
// only on Linux CI).
function readProcCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return null;
  }
}

async function readProcessArgs(pid, exec, readProc = readProcCmdline) {
  const fromProc = readProc(pid);
  if (fromProc != null) return fromProc;
  try {
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'args='], { timeout: 5_000 });
    return String(stdout || '');
  } catch {
    return '';
  }
}

function parsePids(stdout) {
  return String(stdout)
    .split(/\s+/)
    .map((tok) => Number.parseInt(tok, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Kill browser processes squatting `userDataDir` — with an ownership guard.
 *
 * If a LIVE daemon other than us holds `<configDir>/daemon.lock`, refuse:
 * that Chrome belongs to the other daemon.
 */
export async function evictProfileSquatters(
  userDataDir,
  configDir,
  {
    platform = process.platform,
    exec = execFile,
    findPids = findProfileBrowserPids,
    terminate = terminateProcessTree,
    settleMs = 300,
  } = {},
) {
  const lockPath = join(configDir, 'daemon.lock');
  if (existsSync(lockPath)) {
    try {
      const record = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (
        Number.isInteger(record.pid) &&
        record.pid > 0 &&
        record.pid !== process.pid &&
        isProcessAlive(record.pid)
      ) {
        return { evicted: [], refusedReason: 'foreign-daemon-owns-profile' };
      }
    } catch {
      // Unreadable lock — nobody provably owns the profile; eviction may proceed.
    }
  }

  const pids = await findPids(userDataDir, { platform, exec });
  if (pids.length === 0) return { evicted: [], refusedReason: null };

  console.error(
    `[airtable-mcp] evicting orphaned browser process(es) ${pids.join(', ')} squatting ${userDataDir} ` +
      `(no live daemon owns this profile).`,
  );
  for (const pid of pids) {
    await terminate(pid, { platform, exec });
  }
  if (settleMs > 0) await delay(settleMs);
  return { evicted: pids, refusedReason: null };
}

/**
 * Best-effort kill of profile holders without ownership guard.
 * Used when the caller already knows it owns the profile (park/close of self).
 * NEVER throws.
 *
 * OWNERSHIP-GUARD ASSESSMENT (does this need `evictProfileSquatters`' daemon.lock check?).
 * Verdict: NO — deliberately left unguarded, and the tightened pid source is what makes that
 * defensible.
 *
 *  - Before this change the absence of a guard was alarming: `findProfileBrowserPids` could
 *    return ANY process mentioning the profile path, so "kill without asking" meant killing a
 *    user's editor. That is now impossible — the only pids reachable here are Chrome-family
 *    browsers running `--user-data-dir=<our exact profile>`. The blast radius went from
 *    "arbitrary user processes and their children" to "a browser on our own profile".
 *  - Both call sites (`auth.js` `_park()` and `close()`) run INSIDE the PageScheduler barrier
 *    immediately after we closed our own context, precisely to reap the orphan `chrome.exe`
 *    that `context.close()` leaves behind. By construction the target is our own leak.
 *  - The residual case a guard would cover is narrow: a second airtable-user-mcp instance
 *    sharing the same `AIRTABLE_USER_MCP_HOME` whose browser holds the profile. That is
 *    already unreachable in practice (the profile is MCP-exclusive and Chromium's
 *    ProcessSingleton admits one holder), and the ACQUISITION path — the one that runs before
 *    we own anything — is guarded: `profile-lock.killProfileHolders` goes through
 *    `evictProfileSquatters`, which refuses on a live foreign daemon.
 *  - Adding the guard here would have a concrete cost in the opposite direction: with
 *    `AIRTABLE_NO_DAEMON=1` (stdio standalone) a live daemon.lock belongs to a DIFFERENT pid,
 *    so the guard would refuse, and the orphaned-Chromium RAM leak this function exists to fix
 *    would come back unfixed for that transport.
 * If a future change ever widens the pid source again, this verdict must be revisited.
 */
export async function killProfileBrowserTree(
  userDataDir,
  { platform = process.platform, exec = execFile, findPids = findProfileBrowserPids, terminate = terminateProcessTree } = {},
) {
  try {
    const pids = await findPids(userDataDir, { platform, exec });
    for (const pid of pids) {
      await terminate(pid, { platform, exec });
    }
    return { killed: pids.length > 0, pids, platform };
  } catch (err) {
    return {
      killed: false,
      pids: [],
      platform,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
