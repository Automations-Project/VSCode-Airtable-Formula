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

/**
 * Find root browser pids whose command line carries our profile path.
 * Prefers `--user-data-dir=<dir>` marker; also matches bare profileDir for
 * Chromium variants that embed the path without the flag form.
 * Excludes helper processes (`--type=renderer`, gpu, etc.).
 * Win32 also restricts to chrome.exe / msedge.exe / chromium.exe.
 */
export async function findProfileBrowserPids(
  userDataDir,
  { platform = process.platform, exec = execFile } = {},
) {
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
    const { stdout } = await exec('pgrep', ['-f', '--', marker], { timeout: 10_000 });
    pids = parsePids(stdout);
  } catch {
    // pgrep exits 1 on "no match"
    try {
      const { stdout } = await exec('pgrep', ['-f', '--', String(userDataDir)], { timeout: 10_000 });
      pids = parsePids(stdout);
    } catch {
      return [];
    }
  }
  return filterRootBrowserPids(pids, exec);
}

/**
 * Drop Chromium helper processes (`--type=...`) so we only kill root browsers.
 * Linux: /proc/<pid>/cmdline. macOS/BSD: ps -p <pid> -o args=.
 */
async function filterRootBrowserPids(pids, exec) {
  const roots = [];
  for (const pid of pids) {
    const args = await readProcessArgs(pid, exec);
    if (!args) continue;
    if (args.includes('--type=')) continue;
    roots.push(pid);
  }
  return roots;
}

async function readProcessArgs(pid, exec) {
  // Prefer /proc on Linux (no shell).
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return raw.replace(/\0/g, ' ');
  } catch {
    // not Linux or pid gone
  }
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
