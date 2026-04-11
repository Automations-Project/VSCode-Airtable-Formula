#!/usr/bin/env node
/**
 * Programmatic login runner for the VS Code extension.
 *
 * Same flow as login.js but designed for non-interactive use:
 *   - Reads credentials from environment variables only (no CLI args for security)
 *   - Outputs structured JSON to stdout
 *   - Uses exit codes for success/failure
 *
 * Environment variables:
 *   AIRTABLE_EMAIL           — (required) Airtable account email
 *   AIRTABLE_PASSWORD        — (required) Airtable account password
 *   AIRTABLE_OTP_SECRET      — (optional) TOTP 2FA base32 secret
 *   AIRTABLE_PROFILE         — (optional) profile dir name (default: .chrome-profile)
 *   AIRTABLE_BROWSER_CHANNEL — (optional) patchright channel (chrome|msedge|chromium)
 *   AIRTABLE_BROWSER_PATH    — (optional) absolute path to browser executable
 *
 * Exit codes:
 *   0 — login succeeded
 *   1 — login failed or fatal error
 *
 * Stdout JSON:
 *   { "ok": true,  "userId": "usrXXX" }
 *   { "ok": false, "error": "..." }
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

let OTPAuth;
try {
  OTPAuth = await import('otpauth');
} catch {
  // otpauth not available — 2FA won't work but login without it will
}

function output(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function generateTOTP(secretBase32) {
  if (!OTPAuth) {
    throw new Error('otpauth module not available — cannot generate TOTP');
  }
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

async function main() {
  const email = process.env.AIRTABLE_EMAIL;
  const password = process.env.AIRTABLE_PASSWORD;
  const otpSecret = process.env.AIRTABLE_OTP_SECRET || null;
  const profileDir = path.join(__dirname, '..', process.env.AIRTABLE_PROFILE || '.chrome-profile');
  const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
  const browserPath    = process.env.AIRTABLE_BROWSER_PATH || undefined;

  if (!email || !password) {
    output({ ok: false, error: 'AIRTABLE_EMAIL and AIRTABLE_PASSWORD environment variables are required' });
    process.exit(1);
  }

  let context;
  try {
    console.error(`[login-runner] Launching ${browserChannel}...`);
    console.error(`[login-runner] Profile: ${profileDir}`);

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
    await page.waitForTimeout(3000);

    try {
      // Step 1: Email
      console.error('[login-runner] Entering email...');
      const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await emailInput.click();
      await emailInput.fill(email);

      // Step 2: Continue
      console.error('[login-runner] Clicking continue...');
      const continueBtn = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next"), button:has-text("Sign in")').first();
      await continueBtn.click();
      await page.waitForTimeout(3000);

      // Step 3: Password
      console.error('[login-runner] Entering password...');
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
      await passwordInput.click();
      await passwordInput.fill(password);

      // Step 4: Sign in
      console.error('[login-runner] Clicking Sign In...');
      const signInBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
      await signInBtn.click();
      await page.waitForTimeout(3000);

      // Step 5: TOTP 2FA
      if (otpSecret) {
        console.error('[login-runner] Handling TOTP 2FA...');
        const otpInput = page.locator('input[name="code"]');
        try {
          await otpInput.waitFor({ state: 'visible', timeout: 15000 });
          const code = generateTOTP(otpSecret);
          console.error(`[login-runner] Generated TOTP code: ${code}`);
          await otpInput.fill(code);
          await page.keyboard.press('Enter');
          console.error('[login-runner] TOTP code submitted');
        } catch (e) {
          console.error(`[login-runner] TOTP step failed: ${e.message}`);
        }
      }

      console.error('[login-runner] Automated steps completed. Polling for auth...');
    } catch (err) {
      console.error(`[login-runner] Automated step failed: ${err.message}`);
      // Continue to poll — user may complete manually or partial automation may succeed
    }

    // Poll for authentication (max 60s for programmatic use)
    let loggedIn = false;
    let userId = null;
    const maxAttempts = 30;

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
      console.error(`[login-runner] Login verified! User: ${userId}`);
      output({ ok: true, userId });
    } else {
      console.error('[login-runner] Login not detected after timeout');
      output({ ok: false, error: 'Login not detected after 60 seconds' });
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
