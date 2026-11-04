#!/usr/bin/env node
/**
 * Login to Airtable via automated Chrome browser with Patchright.
 *
 * Supports: email/password + optional TOTP 2FA.
 *
 * Usage:
 *   npm run login                                  (uses env vars)
 *   node src/login.js                              (uses env vars)
 *   node src/login.js --email X                     (email only; secrets use env vars)
 *   node src/login.js --profile .chrome-profile-prod  (custom profile dir)
 *
 * Environment variables:
 *   AIRTABLE_EMAIL, AIRTABLE_PASSWORD, AIRTABLE_OTP_SECRET
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProfileDir } from './paths.js';
import { POLL_BUDGET_LABEL, pollForSessionUser } from './session-user.js';

dotenv.config();

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

async function getOtpauth() {
  try {
    return await import('otpauth');
  } catch {
    throw new Error('OTP support requires otpauth. Install it with: npm install otpauth');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  // Secrets are NOT accepted on the command line. Anything in argv lands in
  // /proc/<pid>/cmdline — which is world-readable, unlike /proc/<pid>/environ —
  // and in shell history, for the whole ~5 minute login poll. A captured base32
  // TOTP seed is a permanent 2FA bypass. The rest of the codebase already avoids
  // this deliberately: login-runner.js invented an IPC protocol so credentials
  // "never enter this process's environment".
  //
  // Supply them via AIRTABLE_PASSWORD / AIRTABLE_OTP_SECRET. `login.json` is a
  // direct-login.js input, not an input to this browser-login command. Email is
  // not a secret and remains accepted here.
  const REJECTED = new Set(['--password', '--otp-secret']);
  for (let i = 0; i < args.length; i++) {
    if (REJECTED.has(args[i])) {
      process.stderr.write(
        `${args[i]} is not supported: command-line arguments are world-readable via the process list.\n` +
        'Set AIRTABLE_PASSWORD / AIRTABLE_OTP_SECRET in the environment. For login.json, use AIRTABLE_AUTH_MODE=direct-login.\n',
      );
      process.exit(2);
    }
    if (args[i] === '--email' && args[i + 1]) opts.email = args[++i];
    else if (args[i] === '--profile' && args[i + 1]) opts.profile = args[++i];
    else if (!opts.email) opts.email = args[i];
  }
  return {
    email: opts.email || process.env.AIRTABLE_EMAIL,
    password: opts.password || process.env.AIRTABLE_PASSWORD,
    otpSecret: opts.otpSecret || process.env.AIRTABLE_OTP_SECRET || null,
    profileDir: opts.profile ? path.resolve(opts.profile) : getProfileDir(),
  };
}

async function generateTOTP(secretBase32) {
  const { TOTP, Secret } = await getOtpauth();
  const totp = new TOTP({
    secret: Secret.fromBase32(secretBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

async function mainManual(profileDir) {
  console.log('Opening browser for manual login...');
  console.log(`Profile: ${profileDir}`);
  console.log('Please log in to Airtable in the browser window that opens.\n');

  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  });

  let outerError;
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://airtable.com/login', { waitUntil: 'domcontentloaded' });

    // A 2xx from the probe is NOT proof of login — only a real user id is (see
    // session-user.js / issue #21), so an anonymous answer keeps polling.
    const { userId, closed, reason } = await pollForSessionUser(page);

    if (closed) {
      // Closing the window is how a user abandons a login — a normal exit, not
      // an unhandled waitForTimeout rejection. Still a FAILURE: exiting 0 here
      // reintroduced issue #21 through the exit code, so `login && daemon start`
      // would march on as though somebody had signed in.
      console.log('\nBrowser closed before sign-in completed. Run login again to finish signing in.');
      process.exitCode = 1;
      return;
    }
    if (!userId) throw new Error(`Login not detected after ${POLL_BUDGET_LABEL} — ${reason}`);

    console.log('✅ Login verified! User:', userId);
    console.log('\nSession stored in Chrome profile.');
    console.log('MCP server will use this session headlessly.');
    console.log('\nClosing browser...');
    console.log('Done!');
  } catch (err) {
    outerError = err;
  } finally {
    try { await context.close(); } catch { /* best-effort */ }
  }
  if (outerError) throw outerError;
}

async function main() {
  const { email, password, otpSecret, profileDir } = parseArgs();

  if (!email || !password) {
    await mainManual(profileDir);
    return;
  }

  console.log('Opening Chrome with Patchright (undetected)...');
  console.log(`Profile: ${profileDir}`);
  console.log(`Email: ${email}`);
  console.log(`2FA: ${otpSecret ? 'TOTP enabled' : 'none'}\n`);

  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  });

  // Wrap everything past this point in try/finally so unexpected exceptions
  // (missing selectors, TOTP step crash, navigation errors) don't leave an
  // orphan Chrome window open that the user has to close manually.
  let outerError;
  try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://airtable.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  try {
    // ─── Step 1: Email ──────────────────────────────────────────
    console.log('Step 1: Entering email...');
    const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.click();
    await emailInput.fill(email);

    // ─── Step 2: Continue ───────────────────────────────────────
    console.log('Step 2: Clicking continue...');
    const continueBtn = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next"), button:has-text("Sign in")').first();
    await continueBtn.click();
    await page.waitForTimeout(3000);

    // ─── Step 3: Password ───────────────────────────────────────
    console.log('Step 3: Entering password...');
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.click();
    await passwordInput.fill(password);

    // ─── Step 4: Sign in ────────────────────────────────────────
    console.log('Step 4: Clicking Sign In...');
    const signInBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
    await signInBtn.click();
    await page.waitForTimeout(3000);

    // ─── Step 5: TOTP 2FA (if configured) ───────────────────────
    if (otpSecret) {
      console.log('Step 5: Handling TOTP 2FA...');

      // Airtable 2FA is a traditional form at /2fa/* with:
      //   input[name="code"] type="tel" placeholder="6-digit code"
      //   button "Submit"
      const otpInput = page.locator('input[name="code"]');

      try {
        await otpInput.waitFor({ state: 'visible', timeout: 15000 });
        const code = await generateTOTP(otpSecret);
        // Never log the live code — it's valid for 30s and stderr flows into
        // the extension's debug output channel / manual-test log.
        console.log('  Generated TOTP code: [REDACTED]');
        await otpInput.fill(code);

        // Submit the form by pressing Enter (most reliable — avoids hidden submit input issues)
        await page.keyboard.press('Enter');
        console.log('  ✅ TOTP code submitted');
      } catch (e) {
        console.log(`  ⚠️ TOTP step failed: ${e.message}`);
        console.log('  Please enter the 2FA code manually in the browser.');
      }
    }

    console.log('\n✅ Automated login steps completed. Waiting for auth verification...\n');
  } catch (err) {
    console.log(`⚠️  Automated login step failed: ${err.message}`);
    console.log('   Please complete login manually in the browser.\n');
  }

  // ─── Poll for authentication ──────────────────────────────────
  // A 2xx from the probe is NOT proof of login — only a real user id is (see
  // session-user.js / issue #21), so an anonymous answer keeps polling.
  const { userId, closed, reason } = await pollForSessionUser(page);

  if (closed) {
    // Closing the window is how a user abandons a login — a normal exit, not an
    // unhandled waitForTimeout rejection. Still a FAILURE: exiting 0 here
    // reintroduced issue #21 through the exit code, so `login && daemon start`
    // would march on as though somebody had signed in.
    console.log('\nBrowser closed before sign-in completed. Run login again to finish signing in.');
    process.exitCode = 1;
    return;
  }

  if (!userId) {
    // Throw so the outer finally closes the browser, then the top-level
    // main().catch sets exit code 1.
    throw new Error(`Login not detected after ${POLL_BUDGET_LABEL} — ${reason}`);
  }

  console.log('✅ Login verified! User:', userId);
  console.log('\nSession stored in Chrome profile.');
  console.log('MCP server will use this session headlessly.');
  console.log('\nClosing browser...');
  console.log('Done!');
  } catch (err) {
    // Capture so the finally block can still run before we re-throw.
    outerError = err;
  } finally {
    try { await context.close(); } catch { /* best-effort — browser may be gone */ }
  }
  if (outerError) throw outerError;
}

export default main;

// Run automatically only when this file is the entry point (node src/login.js).
// cli.js imports us and awaits `runLogin()` itself, so we must not auto-run in
// that case — otherwise we'd launch Chrome twice.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
