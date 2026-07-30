#!/usr/bin/env node
/**
 * Lightweight session health check for programmatic use.
 *
 * Launches a headless Chromium-based browser with the persistent profile,
 * calls getUserProperties, and outputs a JSON result to stdout. Designed to
 * be spawned by the VS Code extension as a child process.
 *
 * Environment variables:
 *   AIRTABLE_PROFILE         — profile directory name (default: .chrome-profile)
 *   AIRTABLE_BROWSER_CHANNEL — patchright channel (chrome|msedge|chromium, default: chrome)
 *   AIRTABLE_BROWSER_PATH    — optional absolute path to browser executable
 *
 * Exit codes:
 *   0 — check completed (see JSON output for valid/invalid)
 *   1 — fatal error (e.g. Chrome failed to launch)
 *
 * Stdout JSON:
 *   { "valid": true,  "userId": "usrXXX" }
 *   { "valid": false, "status": 401, "error": "Session expired" }
 *   { "valid": false, "error": "Chrome launch failed: ..." }
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { unlink } from 'node:fs/promises';
import { getProfileDir } from './paths.js';
import { SESSION_PROBE_SOURCE, isAuthenticatedProbe, probeFailureReason, POLL_INTERVAL_MS } from './session-user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = getProfileDir();
const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
const browserPath    = process.env.AIRTABLE_BROWSER_PATH || undefined;

let _chromium = null;
async function getChromium() {
  if (_chromium) return _chromium;
  try {
    const mod = await import('patchright');
    _chromium = mod.chromium;
    return _chromium;
  } catch (err) {
    throw new Error(
      'Browser automation requires patchright. Run `npx airtable-user-mcp install-browser` to set it up.\n' +
      `Original error: ${err.message}`
    );
  }
}

function output(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * The verdict, exported so it can be tested without launching Chrome.
 *
 * STRICT on purpose, unlike auth._verifySession: this runs where a human is
 * waiting on a green/red light, and "a 2xx means signed in" is issue #21 itself
 * — Airtable's authenticated getUserProperties body is eight feature-flag
 * booleans with no identity in it at all (live probes, 2026-07), so a stale or
 * partial profile cookie can be accepted here while the profile is not usably
 * signed in. A real page-bootstrap user id is required.
 */
export function sessionVerdict(probe) {
  return isAuthenticatedProbe(probe)
    ? { valid: true, userId: probe.userId }
    : { valid: false, status: probe?.status, error: probeFailureReason(probe) };
}

async function main() {
  let context;
  try {
    const launchOpts = {
      headless: true,
      channel: browserChannel,
      viewport: null,
    };
    if (browserPath) launchOpts.executablePath = browserPath;
    const chromium = await getChromium();
    try {
      context = await chromium.launchPersistentContext(profileDir, launchOpts);
    } catch (launchErr) {
      // Chrome exits immediately (exit code 21) when it can't acquire the profile
      // lock — typically a stale LOCK file left by a previous crash. Clear it and
      // retry once before giving up.
      const staleLock = path.join(profileDir, 'Default', 'LOCK');
      await unlink(staleLock).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
      context = await chromium.launchPersistentContext(profileDir, launchOpts);
    }

    const page = context.pages()[0] || await context.newPage();

    await page.goto('https://airtable.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for app to be minimally ready
    try {
      await Promise.race([
        page.waitForSelector('#__NEXT_DATA__', { timeout: 8000 }),
        page.waitForSelector('[data-testid="user-menu-button"]', { timeout: 8000 }),
        page.waitForFunction(() => document.body && document.body.innerHTML.length > 1000, { timeout: 8000 }),
      ]);
    } catch {
      await page.waitForTimeout(2000);
    }

    // A 2xx alone never proved the profile was signed in (issue #21) — the
    // verdict needs a real user id from the page bootstrap too.
    //
    // Probe a few times, not once: the marker arrives with the bootstrap, and on a
    // slow render a single shot reports a healthy session as signed out. The
    // extension answers an `expired` verdict by relaunching Chrome to auto-login,
    // so a false red costs a full launch against the single-owner profile.
    let probe = await page.evaluate(SESSION_PROBE_SOURCE);
    for (let i = 0; i < 2 && !isAuthenticatedProbe(probe); i++) {
      await page.waitForTimeout(POLL_INTERVAL_MS);
      probe = await page.evaluate(SESSION_PROBE_SOURCE);
    }
    output(sessionVerdict(probe));
  } catch (e) {
    output({ valid: false, error: e.message });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

// Run only when this file IS the process entry point — the extension forks it,
// so argv[1] is this script. Same guard login.js uses, and it is what lets a test
// import sessionVerdict() without launching a browser.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch(e => {
    output({ valid: false, error: e.message });
    process.exit(1);
  });
}
