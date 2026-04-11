#!/usr/bin/env node
/**
 * Login to Airtable via automated Chrome browser with Patchright.
 *
 * Supports: email/password + optional TOTP 2FA.
 *
 * Usage:
 *   npm run login                                  (uses env vars)
 *   node src/login.js                              (uses env vars)
 *   node src/login.js --email X --password Y       (explicit)
 *   node src/login.js --email X --password Y --otp-secret Z
 *   node src/login.js --profile .chrome-profile-prod  (custom profile dir)
 *
 * Environment variables:
 *   AIRTABLE_EMAIL, AIRTABLE_PASSWORD, AIRTABLE_OTP_SECRET
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) opts.email = args[++i];
    else if (args[i] === '--password' && args[i + 1]) opts.password = args[++i];
    else if (args[i] === '--otp-secret' && args[i + 1]) opts.otpSecret = args[++i];
    else if (args[i] === '--profile' && args[i + 1]) opts.profile = args[++i];
    // Legacy positional args support
    else if (!opts.email) opts.email = args[i];
    else if (!opts.password) opts.password = args[i];
  }
  return {
    email: opts.email || process.env.AIRTABLE_EMAIL,
    password: opts.password || process.env.AIRTABLE_PASSWORD,
    otpSecret: opts.otpSecret || process.env.AIRTABLE_OTP_SECRET || null,
    profileDir: path.join(__dirname, '..', opts.profile || '.chrome-profile'),
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

async function main() {
  const { email, password, otpSecret, profileDir } = parseArgs();

  if (!email || !password) {
    console.error('ERROR: Provide credentials via env vars or arguments:');
    console.error('  node src/login.js --email <email> --password <pass> [--otp-secret <secret>]');
    console.error('  Or set AIRTABLE_EMAIL, AIRTABLE_PASSWORD, AIRTABLE_OTP_SECRET in .env');
    process.exit(1);
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
        console.log(`  Generated TOTP code: ${code}`);
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
  let loggedIn = false;
  let attempts = 0;

  while (!loggedIn && attempts < 150) {
    attempts++;
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
        console.log('✅ Login verified! User:', result.userId);
      }
    } catch {
      // Page navigating, keep waiting
    }
  }

  if (!loggedIn) {
    console.error('❌ Login not detected after 5 minutes.');
    await context.close();
    process.exit(1);
  }

  console.log('\nSession stored in Chrome profile.');
  console.log('MCP server will use this session headlessly.');
  console.log('\nClosing browser...');
  await context.close();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
