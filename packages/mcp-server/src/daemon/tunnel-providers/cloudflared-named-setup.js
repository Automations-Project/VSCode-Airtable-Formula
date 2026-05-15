/**
 * Cloudflared named-tunnel setup helpers.
 *
 * Wraps the `cloudflared` CLI to drive a persistent (named) tunnel. Named
 * tunnels require an origin cert (`~/.cloudflared/cert.pem`), a tunnel UUID
 * + credentials file, and a YAML config that maps a hostname -> local port.
 *
 * This module ships the setup primitives only; provider registration lives in
 * cloudflared-named.js. The dashboard/CLI call these helpers during the
 * one-time setup flow.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { safeAtomicWriteFileSync } from '../../safe-write.js';
import { spawn as nodeSpawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { getTunnelBinaryPath } from '../install-tunnel.js';
import { getHomeDir } from '../../paths.js';

const CONFIG_FILENAME = 'cloudflared-named.yml';
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const CERT_POLL_INTERVAL_MS = 250;

// ─────────────────────────────────────────────────────────────────────
// cloudflared login
// ─────────────────────────────────────────────────────────────────────

/**
 * Runs `cloudflared tunnel login`. Opens a browser. Blocks until the cert
 * lands at `~/.cloudflared/cert.pem` (or throws on timeout / abort). The
 * login subprocess is best-effort terminated on resolve/reject.
 *
 * @param {{
 *   configDir: string,
 *   binaryPath?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   certPath?: string,
 *   forwardOutput?: boolean,
 *   dependencies?: { spawn?: typeof nodeSpawn },
 * }} options
 * @returns {Promise<{ ok: boolean, certPath: string, stderr?: string }>}
 */
export function runCloudflaredLogin(options) {
  return new Promise((resolve, reject) => {
    const binaryPath = options.binaryPath ?? getTunnelBinaryPath(options.configDir);
    try {
      assertBinaryExists(binaryPath);
    } catch (err) {
      reject(err);
      return;
    }

    const certPath = options.certPath ?? defaultCertPath();
    // If a cert is already present at entry, the spawn + 250ms poll loop
    // would race: the first poll tick would see the existing cert and resolve
    // ok in ~300ms, killing cloudflared before it ever opened a browser.
    // runCloudflaredLogin is strictly "perform a login flow"; idempotent
    // "already configured" belongs in the provider's isSetupComplete.
    if (existsSync(certPath)) {
      reject(
        new Error(
          `cert already exists at ${certPath}; rename or delete it to re-run login.`,
        ),
      );
      return;
    }

    const spawnImpl = options.dependencies?.spawn ?? nodeSpawn;
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const child = spawnImpl(binaryPath, ['tunnel', 'login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stderrChunks = [];
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrChunks.push(text);
      if (options.forwardOutput) process.stderr.write(text);
    });
    // Some cloudflared builds emit the browse URL to stdout — capture both.
    // When forwarding, route stdout to PARENT STDERR (never parent stdout).
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrChunks.push(text);
      if (options.forwardOutput) process.stderr.write(text);
    });

    let settled = false;
    let pollTimer = null;
    let overallTimer = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (overallTimer) clearTimeout(overallTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      killChild(child);
    };

    const resolveOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: true, certPath, stderr: stderrChunks.join('') });
    };

    const rejectWith = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      rejectWith(new Error('cloudflared login aborted by caller.'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        rejectWith(new Error('cloudflared login aborted by caller.'));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    pollTimer = setInterval(() => {
      try {
        if (existsSync(certPath)) resolveOk();
      } catch {
        // ignore fs races; next tick will retry
      }
    }, CERT_POLL_INTERVAL_MS);

    overallTimer = setTimeout(() => {
      rejectWith(
        new Error(
          `cloudflared login timed out after ${Math.round(timeoutMs / 1000)}s — cert not written to ${certPath}.`,
        ),
      );
    }, timeoutMs);

    child.on('error', (err) => {
      rejectWith(new Error(`cloudflared login failed to start: ${err.message}`));
    });
    child.on('exit', () => {
      // If cert already present, resolve. Otherwise give the poller one more
      // chance before failing so we don't lose a race where exit fires before
      // the poll interval sees the file.
      if (settled) return;
      if (existsSync(certPath)) {
        resolveOk();
      }
      // Otherwise let the poll timer or overall timer handle completion.
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// cloudflared tunnel list
// ─────────────────────────────────────────────────────────────────────

/**
 * Runs `cloudflared tunnel list --output=json` and parses. Returns [] on
 * "no tunnels" (exit 0 + empty list). Throws on binary/cert problems.
 *
 * @param {{
 *   configDir: string,
 *   binaryPath?: string,
 *   dependencies?: { spawn?: typeof nodeSpawn },
 * }} options
 * @returns {Promise<Array<{ uuid: string, name: string, createdAt?: string, connections?: number }>>}
 */
export function listNamedTunnels(options) {
  return new Promise((resolve, reject) => {
    const binaryPath = options.binaryPath ?? getTunnelBinaryPath(options.configDir);
    try {
      assertBinaryExists(binaryPath);
    } catch (err) {
      reject(err);
      return;
    }
    const spawnImpl = options.dependencies?.spawn ?? nodeSpawn;
    const child = spawnImpl(binaryPath, ['tunnel', 'list', '--output=json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout?.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));

    child.on('error', (err) => {
      reject(new Error(`cloudflared list failed to start: ${err.message}`));
    });
    child.on('exit', (code) => {
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      if (code !== 0) {
        reject(new Error(`cloudflared tunnel list exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed === '' || trimmed === 'null') {
        resolve([]);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        reject(
          new Error(
            `cloudflared output not parseable: ${trimmed.slice(0, 200)}`,
          ),
        );
        return;
      }
      if (!Array.isArray(parsed)) {
        resolve([]);
        return;
      }
      const summaries = parsed
        .filter((entry) => !!entry && typeof entry === 'object')
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : '';
          const name = typeof entry.name === 'string' ? entry.name : '';
          const createdAt = typeof entry.created_at === 'string' ? entry.created_at : undefined;
          const connArr = Array.isArray(entry.connections) ? entry.connections : [];
          return { uuid: id, name, createdAt, connections: connArr.length };
        })
        .filter((entry) => entry.uuid.length > 0);
      resolve(summaries);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// cloudflared tunnel create + DNS route
// ─────────────────────────────────────────────────────────────────────

const CREATE_ID_REGEX = /Created tunnel\s+(\S+)\s+with id\s+([0-9a-f-]{8,})/i;
// Anchor the capture on the `.json` extension cloudflared always emits.
const CREDENTIALS_REGEX = /Tunnel credentials written to\s+(.+?\.json)/i;

/**
 * Runs `cloudflared tunnel create <name>`, parses the UUID + credentials
 * path out of stdout, then runs `cloudflared tunnel route dns <uuid>
 * <hostname>` to install the CNAME record.
 *
 * @param {{
 *   configDir: string,
 *   name: string,
 *   hostname: string,
 *   binaryPath?: string,
 *   signal?: AbortSignal,
 *   dependencies?: { spawn?: typeof nodeSpawn },
 * }} options
 * @returns {Promise<{ uuid: string, name: string, credentialsPath: string, createdAt?: string, connections?: number }>}
 */
export async function createNamedTunnel(options) {
  if (!options.name) throw new Error('createNamedTunnel: name is required.');
  if (!options.hostname) throw new Error('createNamedTunnel: hostname is required.');
  const binaryPath = options.binaryPath ?? getTunnelBinaryPath(options.configDir);
  assertBinaryExists(binaryPath);

  const spawnImpl = options.dependencies?.spawn ?? nodeSpawn;

  return runCapture(spawnImpl, binaryPath, ['tunnel', 'create', options.name], options.signal)
    .then(({ code, stdout, stderr }) => {
      if (code !== 0) {
        throw new Error(
          `cloudflared tunnel create exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
        );
      }
      const idMatch = stdout.match(CREATE_ID_REGEX) ?? stderr.match(CREATE_ID_REGEX);
      if (!idMatch) {
        throw new Error(
          `cloudflared create output missing tunnel id line. Output: ${(stdout + stderr).slice(0, 400)}`,
        );
      }
      const credMatch = stdout.match(CREDENTIALS_REGEX) ?? stderr.match(CREDENTIALS_REGEX);
      if (!credMatch) {
        throw new Error(
          `cloudflared create output missing credentials path line. Output: ${(stdout + stderr).slice(0, 400)}`,
        );
      }
      const uuid = idMatch[2];
      const credentialsPath = credMatch[1].trim();
      const parsedName = idMatch[1];
      return { uuid, name: parsedName || options.name, credentialsPath };
    })
    .then(async (tunnel) => {
      const { code, stdout, stderr } = await runCapture(
        spawnImpl,
        binaryPath,
        ['tunnel', 'route', 'dns', tunnel.uuid, options.hostname],
        options.signal,
      );
      if (code !== 0) {
        throw new Error(
          `cloudflared route dns exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
        );
      }
      return tunnel;
    });
}

// ─────────────────────────────────────────────────────────────────────
// cloudflared tunnel delete
// ─────────────────────────────────────────────────────────────────────

/**
 * Represents an active-connections or unknown delete failure.
 */
export class DeleteNamedTunnelError extends Error {
  /**
   * @param {string} message
   * @param {'active-connections' | 'unknown'} reason
   */
  constructor(message, reason) {
    super(message);
    this.name = 'DeleteNamedTunnelError';
    this.reason = reason;
  }
}

/**
 * Deletes a remote Cloudflare named tunnel. This is intentionally separate
 * from clearNamedTunnelConfig(): remote delete can fail even with --force
 * when DNS still routes traffic and active connections keep the tunnel alive.
 *
 * @param {{
 *   configDir: string,
 *   uuid: string,
 *   binaryPath?: string,
 *   signal?: AbortSignal,
 *   dependencies?: { spawn?: typeof nodeSpawn },
 * }} options
 * @returns {Promise<{ uuid: string }>}
 */
export async function deleteNamedTunnel(options) {
  const uuid = options.uuid.trim();
  if (!uuid) throw new Error('deleteNamedTunnel: uuid is required.');
  const binaryPath = options.binaryPath ?? getTunnelBinaryPath(options.configDir);
  assertBinaryExists(binaryPath);
  const spawnImpl = options.dependencies?.spawn ?? nodeSpawn;

  const { code, stdout, stderr } = await runCapture(
    spawnImpl,
    binaryPath,
    ['tunnel', 'delete', '--force', uuid],
    options.signal,
  );
  if (code !== 0) {
    const combined = `${stderr}\n${stdout}`.trim();
    if (isActiveConnectionDeleteFailure(combined)) {
      throw new DeleteNamedTunnelError(
        'cloudflared could not delete the tunnel because it still has active connections. Remove the DNS route/CNAME for this hostname, wait for connections to drain, then retry delete.',
        'active-connections',
      );
    }
    throw new DeleteNamedTunnelError(
      `cloudflared tunnel delete exited with code ${code}: ${combined}`,
      'unknown',
    );
  }
  return { uuid };
}

/**
 * @param {string} output
 * @returns {boolean}
 */
export function isActiveConnectionDeleteFailure(output) {
  const normalized = output.toLowerCase();
  return (
    /active connection/.test(normalized) ||
    /still has connections/.test(normalized) ||
    /cannot.*delete.*connections/.test(normalized) ||
    /unable.*delete.*connections/.test(normalized)
  );
}

/**
 * @param {typeof nodeSpawn} spawnImpl
 * @param {string} command
 * @param {readonly string[]} args
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runCapture(spawnImpl, command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk) => stderr.push(chunk.toString('utf8')));

    const onAbort = () => killChild(child);
    if (signal) {
      if (signal.aborted) {
        killChild(child);
        reject(new Error('cloudflared command aborted by caller.'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`cloudflared command failed to start: ${err.message}`));
    });
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Named-tunnel config.yml read/write
// ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} [configDir] Defaults to getHomeDir() if omitted.
 * @returns {string}
 */
export function getNamedTunnelConfigPath(configDir) {
  return join(configDir ?? getHomeDir(), CONFIG_FILENAME);
}

/**
 * Writes `<configDir>/cloudflared-named.yml` describing the tunnel ->
 * localhost mapping. Uses the temp-file + rename pattern from safe-write.js
 * and locks file mode to 0600 (POSIX) / user-only ACL (Windows).
 *
 * @param {{
 *   configDir: string,
 *   uuid: string,
 *   hostname: string,
 *   port: number,
 *   credentialsPath: string,
 * }} options
 * @returns {{ uuid: string, hostname: string, port: number, configPath: string, credentialsPath: string }}
 */
export function writeTunnelConfig(options) {
  if (!options.uuid) throw new Error('writeTunnelConfig: uuid is required.');
  if (!options.hostname) throw new Error('writeTunnelConfig: hostname is required.');
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error('writeTunnelConfig: port must be a positive number.');
  }
  if (!options.credentialsPath) {
    throw new Error('writeTunnelConfig: credentialsPath is required.');
  }

  const configPath = getNamedTunnelConfigPath(options.configDir);
  mkdirSync(dirname(configPath), { recursive: true });

  const yaml = serializeConfigYaml({
    uuid: options.uuid,
    hostname: options.hostname,
    port: options.port,
    credentialsPath: options.credentialsPath,
  });

  safeAtomicWriteFileSync(configPath, yaml, { encoding: 'utf8', mode: 0o600 });
  applyPrivatePermissions(configPath);

  return {
    uuid: options.uuid,
    hostname: options.hostname,
    port: options.port,
    configPath,
    credentialsPath: options.credentialsPath,
  };
}

/**
 * Reads + validates the config written by writeTunnelConfig. Returns null
 * if absent or malformed.
 *
 * @param {string} configDir
 * @returns {{ uuid: string, hostname: string, port: number, configPath: string, credentialsPath: string } | null}
 */
export function readNamedTunnelConfig(configDir) {
  const configPath = getNamedTunnelConfigPath(configDir);
  if (!existsSync(configPath)) return null;
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseConfigYaml(raw);
  if (!parsed) return null;
  return {
    uuid: parsed.uuid,
    hostname: parsed.hostname,
    port: parsed.port,
    credentialsPath: parsed.credentialsPath,
    configPath,
  };
}

/**
 * @param {string} configDir
 * @returns {boolean}
 */
export function clearNamedTunnelConfig(configDir) {
  const configPath = getNamedTunnelConfigPath(configDir);
  const existed = existsSync(configPath);
  rmSync(configPath, { force: true });
  return existed;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} binaryPath
 */
function assertBinaryExists(binaryPath) {
  if (!existsSync(binaryPath)) {
    throw new Error(
      `cloudflared not installed; run "daemon install-tunnel" first (expected at ${binaryPath}).`,
    );
  }
}

/**
 * @returns {string}
 */
function defaultCertPath() {
  return join(homedir(), '.cloudflared', 'cert.pem');
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // best-effort
  }
}

/**
 * @param {{ uuid: string, hostname: string, port: number, credentialsPath: string }} opts
 * @returns {string}
 */
function serializeConfigYaml(opts) {
  // Simple, stable YAML — cloudflared's ingress format is well-defined and
  // our values are mechanically generated (UUIDs, paths, hostnames).
  return [
    `tunnel: ${opts.uuid}`,
    `credentials-file: ${yamlQuoteIfNeeded(opts.credentialsPath)}`,
    'ingress:',
    `  - hostname: ${opts.hostname}`,
    `    service: http://127.0.0.1:${opts.port}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function yamlQuoteIfNeeded(value) {
  // Quote paths containing spaces, colons, or leading/trailing whitespace
  // chars so cloudflared's YAML parser picks up the full string.
  if (/^[A-Za-z0-9._/\\:-]+$/u.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * @param {string} raw
 * @returns {{ uuid: string, hostname: string, port: number, credentialsPath: string } | null}
 */
function parseConfigYaml(raw) {
  const lines = raw.split(/\r?\n/);
  let uuid = '';
  let credentialsPath = '';
  let hostname = '';
  let port = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const tunnelMatch = trimmed.match(/^tunnel:\s*(.+)$/u);
    if (tunnelMatch) {
      uuid = unquoteYaml(tunnelMatch[1].trim());
      continue;
    }
    const credsMatch = trimmed.match(/^credentials-file:\s*(.+)$/u);
    if (credsMatch) {
      credentialsPath = unquoteYaml(credsMatch[1].trim());
      continue;
    }
    const hostnameMatch = trimmed.match(/^- hostname:\s*(.+)$/u);
    if (hostnameMatch) {
      hostname = unquoteYaml(hostnameMatch[1].trim());
      continue;
    }
    const serviceMatch = trimmed.match(/^service:\s*http:\/\/127\.0\.0\.1:(\d+)\s*$/u);
    if (serviceMatch) {
      port = Number.parseInt(serviceMatch[1], 10);
      continue;
    }
  }
  if (!uuid || !hostname || !credentialsPath || !Number.isFinite(port) || port <= 0) {
    return null;
  }
  return { uuid, hostname, port, credentialsPath };
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquoteYaml(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

/**
 * @param {string} path
 */
function applyPrivatePermissions(path) {
  if (process.platform === 'win32') {
    const username = process.env.USERNAME;
    const domain = process.env.USERDOMAIN;
    const target = domain && username ? `${domain}\\${username}` : username ?? '';
    if (!target) return;
    spawnSync('icacls', [path, '/inheritance:r', '/grant:r', `${target}:(R,W)`], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return;
  }
  chmodSync(path, 0o600);
}
