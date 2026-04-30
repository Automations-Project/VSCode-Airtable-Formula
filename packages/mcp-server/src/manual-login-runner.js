#!/usr/bin/env node
/**
 * Manual login runner — opens a visible browser for the user to log in.
 *
 * No credentials are passed. The user types email/password/2FA themselves.
 * Browser autofill from the persistent profile may pre-fill fields.
 *
 * Environment variables:
 *   AIRTABLE_PROFILE_DIR       — (optional) absolute profile path
 *   AIRTABLE_BROWSER_CHANNEL   — (optional) patchright channel
 *   AIRTABLE_BROWSER_PATH      — (optional) browser executable path
 *
 * Stdout JSON:
 *   { "ok": true,  "userId": "usrXXX" }
 *   { "ok": false, "error": "..." }
 */
import path from 'path';
import { getProfileDir } from './paths.js';

const profileDir = getProfileDir();
const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
const browserPath = process.env.AIRTABLE_BROWSER_PATH || undefined;

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
    console.error(`[manual-login] Launching visible ${browserChannel}...`);
    console.error(`[manual-login] Profile: ${profileDir}`);

    const launchOpts = {
      headless: false,
      channel: browserChannel,
      viewport: null,
    };
    if (browserPath) launchOpts.executablePath = browserPath;

    const chromium = await getChromium();
    context = await chromium.launchPersistentContext(profileDir, launchOpts);

    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://airtable.com/login', { waitUntil: 'domcontentloaded' });

    console.error('[manual-login] Browser opened. Waiting for user to log in...');

    // Poll for authentication (5-minute timeout)
    let loggedIn = false;
    let userId = null;
    const maxAttempts = 150; // 150 * 2s = 300s = 5 minutes

    for (let i = 0; i < maxAttempts; i++) {
      await page.waitForTimeout(2000);
      try {
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
              return { ok: true, userId: data?.data?.userId };
            }
            return { ok: false, status: res.status };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        });

        if (result.ok) {
          loggedIn = true;
          userId = result.userId;
          break;
        }
      } catch {
        // Page navigating, keep waiting
      }
    }

    if (loggedIn) {
      console.error(`[manual-login] Login verified! User: ${userId}`);
      output({ ok: true, userId });
    } else {
      console.error('[manual-login] Login not detected after 5 minutes');
      output({ ok: false, error: 'Login not detected after 5 minutes' });
      process.exit(1);
    }
  } catch (e) {
    output({ ok: false, error: e.message });
    process.exit(1);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch(e => {
  output({ ok: false, error: e.message });
  process.exit(1);
});
