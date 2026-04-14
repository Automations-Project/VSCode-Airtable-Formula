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
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
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
    context = await chromium.launchPersistentContext(profileDir, launchOpts);

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

    const result = await page.evaluate(async () => {
      try {
        const res = await fetch('/v0.3/getUserProperties', {
          headers: {
            'x-airtable-inter-service-client': 'webClient',
            'x-requested-with': 'XMLHttpRequest',
          },
        });
        if (res.ok) {
          const data = await res.json();
          return { valid: true, userId: data?.data?.userId || null };
        }
        return { valid: false, status: res.status };
      } catch (e) {
        return { valid: false, error: e.message };
      }
    });

    output(result);
  } catch (e) {
    output({ valid: false, error: e.message });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch(e => {
  output({ valid: false, error: e.message });
  process.exit(1);
});
