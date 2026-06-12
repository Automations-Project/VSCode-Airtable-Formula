import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { getHomeDir, getProfileDir } from './paths.js';

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
  npx airtable-user-mcp daemon start                          Start the shared daemon process
  npx airtable-user-mcp daemon stop                           Stop the running daemon
  npx airtable-user-mcp daemon status                         Show daemon status (JSON)
  npx airtable-user-mcp daemon install-tunnel                 Download the cloudflared binary
  npx airtable-user-mcp daemon setup-tunnel named [--name N] --hostname H
                                                              Set up a Cloudflare named tunnel
  npx airtable-user-mcp --version        Print version
  npx airtable-user-mcp --help           Show this help

Environment:
  AIRTABLE_USER_MCP_HOME    Override config dir (default: ~/.airtable-user-mcp)
  AIRTABLE_NO_BROWSER       Skip patchright, use manual session only
  AIRTABLE_HEADLESS_ONLY    Run browser in headless mode
  AIRTABLE_LOG_LEVEL        debug | info | warn | error
  AIRTABLE_NO_DAEMON        Skip daemon; run in-process stdio directly
\n`);
}

// Kept as a thin wrapper for call-site clarity; the single source of truth is paths.js.
const getConfigDir = getHomeDir;

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
    const profileDir = getProfileDir();
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
      // H13 \u2014 Windows needs .cmd resolution (npx is a batch file, not a binary).
      // Using `shell: true` handles both: the command line is passed through
      // the OS shell which picks up the correct npx invocation for the
      // platform.
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      execFileSync(npxCmd, ['patchright-core', 'install', 'chromium'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      process.stderr.write('Done. Chromium is ready.\n');
    } catch (err) {
      process.stderr.write(`Failed to install Chromium: ${err.message}\n`);
      process.stderr.write('Make sure patchright is installed: npm install patchright\n');
      process.exitCode = 1;
    }
    return true;
  }

  if (cmd === 'daemon') {
    const subcmd = args[1];
    if (subcmd === 'start') {
      const { startDaemon } = await import('./daemon/launcher.js');
      const result = await startDaemon({ configDir: process.env.AIRTABLE_USER_MCP_HOME });
      // If we started the daemon (not just attached to an existing one), block
      // until it shuts down so the process stays alive as the daemon.
      if (!result.attached) await result.closed;
      return true;
    }
    if (subcmd === 'install-tunnel') {
      const { installCloudflared } = await import('./daemon/install-tunnel.js');
      const { getHomeDir } = await import('./paths.js');
      const configDir = process.env.AIRTABLE_USER_MCP_HOME ?? getHomeDir();
      process.stderr.write('Downloading cloudflared binary...\n');
      const result = await installCloudflared({ configDir });
      process.stdout.write(`cloudflared ${result.version} installed to ${result.binaryPath}\n`);
      return true;
    }
    if (subcmd === 'setup-tunnel') {
      const provider = args[2];
      if (provider !== 'named') {
        process.stderr.write('Usage: airtable-user-mcp daemon setup-tunnel named [--name <tunnel-name>] --hostname <hostname>\n');
        process.stderr.write('Currently only "named" (Cloudflare named tunnel) requires setup.\n');
        process.exitCode = 1;
        return true;
      }

      // Parse --hostname and --name flags
      let hostname = '';
      let tunnelName = '';
      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--hostname' && args[i + 1]) { hostname = args[++i]; }
        else if (args[i] === '--name' && args[i + 1]) { tunnelName = args[++i]; }
      }

      const {
        runCloudflaredLogin,
        createNamedTunnel,
        writeTunnelConfig,
        readNamedTunnelConfig,
      } = await import('./daemon/tunnel-providers/cloudflared-named-setup.js');
      const { getTunnelBinaryPath } = await import('./daemon/install-tunnel.js');
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');

      const configDir = getConfigDir();
      const binaryPath = getTunnelBinaryPath(configDir);

      if (!existsSync(binaryPath)) {
        process.stderr.write('cloudflared binary not found. Install it first:\n');
        process.stderr.write('  npx airtable-user-mcp daemon install-tunnel\n');
        process.exitCode = 1;
        return true;
      }

      // Step 1: Login (if cert missing)
      const certPath = join(homedir(), '.cloudflared', 'cert.pem');
      if (!existsSync(certPath)) {
        process.stderr.write('Running cloudflared tunnel login — a browser window will open.\n');
        process.stderr.write('Log in to your Cloudflare account and select the zone for your tunnel hostname.\n');
        await runCloudflaredLogin({ configDir, binaryPath, forwardOutput: true });
        process.stderr.write('Cloudflare login complete.\n');
      } else {
        process.stderr.write('Cloudflare cert already present — skipping login.\n');
      }

      // Step 2: Collect hostname interactively if not provided
      if (!hostname) {
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        hostname = await new Promise(resolve =>
          rl.question('Enter the hostname for this tunnel (e.g. mcp.example.com): ', ans => {
            rl.close();
            resolve(ans.trim());
          }),
        );
      }
      if (!hostname) {
        process.stderr.write('Hostname is required.\n');
        process.exitCode = 1;
        return true;
      }

      // Idempotent: skip create if already configured for this hostname
      const existing = readNamedTunnelConfig(configDir);
      if (existing) {
        process.stderr.write(`Named tunnel already configured: ${existing.hostname} (uuid=${existing.uuid})\n`);
        process.stdout.write('Setup complete — enable the tunnel from the dashboard or restart the daemon.\n');
        return true;
      }

      // Step 3: Create named tunnel (run + route dns)
      if (!tunnelName) tunnelName = hostname.split('.')[0].slice(0, 32) || 'airtable-mcp';
      process.stderr.write(`Creating Cloudflare named tunnel "${tunnelName}" → ${hostname}…\n`);
      const tunnel = await createNamedTunnel({ configDir, name: tunnelName, hostname, binaryPath });
      process.stderr.write(`Tunnel created: uuid=${tunnel.uuid}  credentials: ${tunnel.credentialsPath}\n`);
      process.stderr.write('DNS route installed.\n');

      // Step 4: Write YAML config
      writeTunnelConfig({ configDir, uuid: tunnel.uuid, hostname, port: 7400, credentialsPath: tunnel.credentialsPath });
      process.stdout.write(`\nSetup complete!\n`);
      process.stdout.write(`  Tunnel: ${tunnelName} (${tunnel.uuid})\n`);
      process.stdout.write(`  URL:    https://${hostname}\n`);
      process.stdout.write(`\nEnable the tunnel from the VS Code dashboard, or run:\n`);
      process.stdout.write(`  npx airtable-user-mcp daemon start\n`);
      return true;
    }

    if (subcmd === 'stop') {
      const { stopDaemon } = await import('./daemon/launcher.js');
      await stopDaemon({ configDir: process.env.AIRTABLE_USER_MCP_HOME });
      process.stdout.write('Daemon stopped.\n');
      return true;
    }
    if (subcmd === 'status') {
      const { getDaemonStatus } = await import('./daemon/launcher.js');
      const status = await getDaemonStatus({ configDir: process.env.AIRTABLE_USER_MCP_HOME });
      // Redact the bearer token — `daemon status` output lands in shell
      // history, terminal scrollback, and pasted bug reports. The token is
      // readable from ~/.airtable-user-mcp/daemon.token when actually needed.
      const redacted = JSON.stringify(
        status,
        (key, value) => (key === 'bearerToken' && typeof value === 'string' ? '[redacted]' : value),
        2,
      );
      process.stdout.write(redacted + '\n');
      return true;
    }
    process.stderr.write('Unknown daemon subcommand: ' + (subcmd ?? '(none)') + '\n');
    process.stderr.write('Usage: airtable-user-mcp daemon [start|stop|status]\n');
    process.exitCode = 1;
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
