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
import { POLL_BUDGET_LABEL, pollForSessionUser } from './session-user.js';

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

    // A 2xx here is NOT proof of login — only a real user id is (see
    // session-user.js / issue #21), so an anonymous answer keeps polling
    // instead of ending the loop 2s in.
    const { userId, closed, reason } = await pollForSessionUser(page);

    if (userId) {
      console.error(`[manual-login] Login verified! User: ${userId}`);
      output({ ok: true, userId });
    } else if (closed) {
      // Closing the window is how a user abandons a login — a normal outcome,
      // still a failure.
      console.error('[manual-login] Browser closed before sign-in completed');
      output({ ok: false, error: 'Browser closed before sign-in completed — run login again and finish signing in.' });
      process.exit(1);
    } else {
      console.error(`[manual-login] Login not detected after ${POLL_BUDGET_LABEL} — ${reason}`);
      output({ ok: false, error: `Login not detected after ${POLL_BUDGET_LABEL} — ${reason}` });
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
