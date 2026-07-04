/**
 * Chrome persistent-profile lock recovery.
 *
 * The MCP drives Airtable through a single headless Chrome that owns a
 * MCP-EXCLUSIVE persistent profile at `~/.airtable-user-mcp/.chrome-profile`.
 * When a Chrome instance crashes or leaks, its process can linger and keep the
 * profile's SingletonLock held, so the very next `launchPersistentContext()`
 * fails immediately with Chrome exit code 21
 * ("Target page, context or browser has been closed", exitCode=21).
 *
 * Because the profile is only ever used by OUR Chrome, any process holding it
 * is a stale instance that is safe to kill. This module provides:
 *   - `isProfileLockError` — recognise the lock-contention failure shape.
 *   - `killProfileHolders` — best-effort, NEVER-throws kill of the stale
 *     Chrome/Edge root process(es) whose command line references our profile.
 *
 * The kill is REACTIVE only — it is invoked after actually hitting the lock,
 * never proactively before a launch (which could kill a legitimate instance).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Recognise the failure shape of a locked/contended Chrome persistent profile.
 *
 * Matches (case-insensitive) the several ways Playwright/patchright + Chrome
 * surface the same underlying "profile already in use" condition:
 *   - exit code 21 (Chrome's ProcessSingleton bail-out)
 *   - "Target page, context or browser has been closed"
 *   - Chromium's own SingletonLock / ProcessSingleton messages
 *   - "user data directory is already in use"
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isProfileLockError(err) {
  const message = String(err?.message ?? err ?? '');
  return /exit\s*code\s*21|exitcode=21|has been closed|SingletonLock|ProcessSingleton|user data directory is already in use|failed to create a ProcessSingleton/i.test(
    message,
  );
}

/**
 * Best-effort kill of any stale Chrome/Edge process holding OUR persistent
 * profile directory. NEVER throws — a failure here just means the retry will
 * fail again and the real error propagates.
 *
 * win32: enumerate chrome.exe/msedge.exe via CIM, keep only ROOT processes
 *        (command line references our profileDir but is NOT a `--type=` child
 *        renderer/gpu/utility process), then `taskkill /T /F` the whole tree.
 * posix: `pkill -f <profileDir>` — matches any process whose command line
 *        contains the profile path.
 *
 * @param {string} profileDir absolute path to the persistent profile directory
 * @param {object} [opts]
 * @param {NodeJS.Platform} [opts.platform=process.platform]
 * @param {(file: string, args: string[]) => Promise<any>} [opts.exec] injectable runner (default: promisified execFile)
 * @returns {Promise<{ killed: boolean, platform: string, error?: string }>}
 */
export async function killProfileHolders(profileDir, { platform = process.platform, exec = execFileAsync } = {}) {
  try {
    if (platform === 'win32') {
      // Escape single quotes for embedding in the single-quoted PowerShell strings.
      const escaped = String(profileDir).replace(/'/g, "''");
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.CommandLine -notlike '*--type=*' } | ` +
        `ForEach-Object { taskkill /PID $_.ProcessId /T /F }`;
      await exec('powershell', ['-NoProfile', '-Command', script]);
    } else {
      // pkill exits non-zero (1) when nothing matched — that's not an error for us.
      await exec('pkill', ['-f', String(profileDir)]);
    }
    return { killed: true, platform };
  } catch (err) {
    // Swallow everything: a non-zero exit (no match), a missing binary, a
    // permission error — none of these should ever escape this helper.
    return { killed: false, platform, error: err instanceof Error ? err.message : String(err) };
  }
}
