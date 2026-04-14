import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function getVersion() {
  const pkg = require('../package.json');
  return pkg.version;
}

function printHelp() {
  const v = getVersion();
  process.stdout.write(`airtable-user-mcp v${v}

Usage:
  npx airtable-user-mcp                  Start MCP server (stdio)
  npx airtable-user-mcp login            Log in via browser
  npx airtable-user-mcp logout           Clear saved session
  npx airtable-user-mcp status           Show session & browser info
  npx airtable-user-mcp doctor           Run diagnostics
  npx airtable-user-mcp install-browser  Download Chromium (~170MB)
  npx airtable-user-mcp --version        Print version
  npx airtable-user-mcp --help           Show this help

Environment:
  AIRTABLE_USER_MCP_HOME    Override config dir (default: ~/.airtable-user-mcp)
  AIRTABLE_NO_BROWSER       Skip patchright, use manual session only
  AIRTABLE_HEADLESS_ONLY    Run browser in headless mode
  AIRTABLE_LOG_LEVEL        debug | info | warn | error
\n`);
}

function getConfigDir() {
  return process.env.AIRTABLE_USER_MCP_HOME || path.join(os.homedir(), '.airtable-user-mcp');
}

export async function runCli(args) {
  const cmd = args[0];

  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(getVersion() + '\n');
    return true;
  }

  if (cmd === '--help' || cmd === '-h') {
    printHelp();
    return true;
  }

  if (cmd === 'status') {
    const fs = await import('node:fs');
    const configDir = getConfigDir();
    const sessionPath = path.join(configDir, 'session.json');
    const hasSession = fs.existsSync(sessionPath);
    process.stdout.write(`airtable-user-mcp v${getVersion()}\n`);
    process.stdout.write(`Config dir: ${configDir}\n`);
    process.stdout.write(`Node: ${process.version}\n`);
    process.stdout.write(`Platform: ${process.platform} ${process.arch}\n`);
    process.stdout.write(`Session: ${hasSession ? 'found' : 'not found'}\n`);
    return true;
  }

  if (cmd === 'doctor') {
    const fs = await import('node:fs');
    const configDir = getConfigDir();
    process.stdout.write(`airtable-user-mcp v${getVersion()}\n`);
    process.stdout.write(`Node: ${process.version}\n`);
    process.stdout.write(`Platform: ${process.platform} ${process.arch}\n`);
    process.stdout.write(`Config dir: ${configDir}\n`);
    process.stdout.write(`Config dir exists: ${fs.existsSync(configDir)}\n`);

    try {
      await import('patchright');
      process.stdout.write('Patchright: installed\n');
    } catch {
      process.stdout.write('Patchright: not installed (run install-browser)\n');
    }

    try {
      await import('otpauth');
      process.stdout.write('OTP support: available\n');
    } catch {
      process.stdout.write('OTP support: not available (otpauth not installed)\n');
    }

    return true;
  }

  if (cmd === 'login') {
    const { default: runLogin } = await import('./login.js');
    await runLogin();
    return true;
  }

  if (cmd === 'logout') {
    const fs = await import('node:fs/promises');
    const profileDir = process.env.AIRTABLE_PROFILE_DIR
      || path.join(getConfigDir(), '.chrome-profile');
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
      process.stdout.write('Browser session cleared.\n');
    } catch {
      process.stdout.write('No session to clear.\n');
    }
    // Also remove legacy session.json if it exists
    try {
      const sessionPath = path.join(getConfigDir(), 'session.json');
      await (await import('node:fs/promises')).unlink(sessionPath);
    } catch {
      // ignore
    }
    return true;
  }

  if (cmd === 'install-browser') {
    process.stderr.write('Installing Chromium via patchright-core...\n');
    try {
      execFileSync('npx', ['patchright-core', 'install', 'chromium'], { stdio: 'inherit' });
      process.stderr.write('Done. Chromium is ready.\n');
    } catch (err) {
      process.stderr.write(`Failed to install Chromium: ${err.message}\n`);
      process.stderr.write('Make sure patchright is installed: npm install patchright\n');
      process.exitCode = 1;
    }
    return true;
  }

  if (cmd) {
    process.stderr.write(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exitCode = 1;
    return true;
  }

  // No args — caller should start the MCP server
  return false;
}
