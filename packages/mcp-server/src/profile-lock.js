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
 * is a stale instance that is safe to kill — unless a live foreign daemon owns
 * the profile (see process-tree.evictProfileSquatters).
 *
 * This module provides:
 *   - `isProfileLockError` — recognise the lock-contention failure shape.
 *   - `killProfileHolders` — best-effort, NEVER-throws kill of the stale
 *     Chrome/Edge root process(es) whose command line references our profile.
 *
 * The kill is REACTIVE only — it is invoked after actually hitting the lock,
 * never proactively before a launch (which could kill a legitimate instance).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getHomeDir } from './paths.js';
import {
  evictProfileSquatters,
  findProfileBrowserPids,
  terminateProcessTree,
} from './process-tree.js';

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
 * Prefer ownership-guarded eviction when configDir is known. Falls back to
 * direct tree kill for callers that only pass profileDir (legacy tests inject
 * `exec`/`platform`).
 *
 * @param {string} profileDir absolute path to the persistent profile directory
 * @param {object} [opts]
 * @param {NodeJS.Platform} [opts.platform=process.platform]
 * @param {(file: string, args: string[], opts?: object) => Promise<any>} [opts.exec]
 * @param {string} [opts.configDir]
 * @param {boolean} [opts.legacy] force legacy powershell/pkill path (unit tests)
 * @returns {Promise<{ killed: boolean, platform: string, error?: string, refusedReason?: string|null, pids?: number[] }>}
 */
export async function killProfileHolders(
  profileDir,
  { platform = process.platform, exec = execFileAsync, configDir, legacy = false } = {},
) {
  try {
    const home = configDir ?? getHomeDir();
    // Explicit legacy opt-in for unit tests that spy on powershell/pkill args.
    if (legacy) {
      return legacyKillProfileHolders(profileDir, { platform, exec });
    }

    const result = await evictProfileSquatters(profileDir, home, {
      platform,
      exec,
      findPids: findProfileBrowserPids,
      terminate: terminateProcessTree,
      settleMs: 300,
    });
    if (result.refusedReason) {
      return {
        killed: false,
        platform,
        refusedReason: result.refusedReason,
        pids: [],
      };
    }
    return {
      killed: result.evicted.length > 0,
      platform,
      pids: result.evicted,
      refusedReason: null,
    };
  } catch (err) {
    // Do NOT fall back to unguarded kill — that can murder a foreign daemon's
    // Chrome if eviction threw for an unrelated reason. Surface the error.
    return {
      killed: false,
      platform,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Legacy path kept for injectable-exec unit tests. */
async function legacyKillProfileHolders(profileDir, { platform, exec }) {
  try {
    if (platform === 'win32') {
      const escaped = String(profileDir).replace(/'/g, "''");
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.CommandLine -notlike '*--type=*' } | ` +
        `ForEach-Object { taskkill /PID $_.ProcessId /T /F }`;
      await exec('powershell', ['-NoProfile', '-Command', script]);
    } else {
      await exec('pkill', ['-f', String(profileDir)]);
    }
    return { killed: true, platform };
  } catch (err) {
    return { killed: false, platform, error: err instanceof Error ? err.message : String(err) };
  }
}
