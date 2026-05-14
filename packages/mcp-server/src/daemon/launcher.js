import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getHomeDir } from '../paths.js';
import { startDaemonServer } from './server.js';
import { acquire, getLockfilePath, isStale, read, release, replace } from './lockfile.js';
import { ensureToken, getTokenPath, readToken } from './token.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolveServerVersion() {
  try {
    const versionFile = join(__dirname, '..', 'version.json');
    const raw = readFileSync(versionFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.mcpServer === 'string') return parsed.mcpServer;
  } catch { /* fall through */ }
  try {
    return require('../../package.json').version;
  } catch { /* unknown */ }
  return 'unknown';
}

function resolveCliEntry() {
  const mjsPath = fileURLToPath(new URL('../index.mjs', import.meta.url));
  if (existsSync(mjsPath)) return mjsPath;
  return fileURLToPath(new URL('../index.js', import.meta.url));
}

async function probeHealth(record, options = {}) {
  if (!record.port || record.port <= 0) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);

  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/daemon/health`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${record.bearerToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function adminRequest(record, path, options) {
  const response = await fetch(`http://127.0.0.1:${record.port}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${record.bearerToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Daemon admin request failed (${response.status}): ${detail || response.statusText}`);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return await response.json();
  return await response.text().catch(() => null);
}

function toConnectionInfo(record, health) {
  return {
    pid: record.pid,
    uuid: record.uuid,
    port: record.port,
    url: `http://127.0.0.1:${record.port}`,
    bearerToken: record.bearerToken,
    version: record.version,
    startedAt: record.startedAt,
    tunnelUrl: record.tunnelUrl ?? null,
  };
}

function isAddressInUseError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.code === 'EADDRINUSE';
}

export async function getDaemonStatus(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const lockPath = getLockfilePath(configDir);
  const tokenPath = getTokenPath(configDir);
  const record = read({ lockPath });

  if (!record) {
    return {
      running: false,
      healthy: false,
      stale: false,
      healed: false,
      configDir,
      lockPath,
      tokenPath,
      record: null,
      health: null,
    };
  }

  if (options.treatSelfAsZombie && record.pid === process.pid) {
    if (options.reclaimStale) {
      release({ lockPath, expectedUuid: record.uuid });
    }
    return {
      running: false,
      healthy: false,
      stale: true,
      healed: false,
      configDir,
      lockPath,
      tokenPath,
      record,
      health: null,
    };
  }

  let healed = false;
  let health = await probeHealth(record, { timeoutMs: options.healthTimeoutMs });

  if (!health) {
    try {
      const tokenRecord = readToken({ tokenPath });
      if (tokenRecord && tokenRecord.bearerToken !== record.bearerToken) {
        health = await probeHealth(
          { ...record, bearerToken: tokenRecord.bearerToken },
          { timeoutMs: options.healthTimeoutMs },
        );
        if (health && options.reclaimStale) {
          try {
            const healedRecord = { ...record, bearerToken: tokenRecord.bearerToken };
            replace(healedRecord, { lockPath, expectedUuid: record.uuid });
            healed = true;
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // readToken may throw if file is malformed; treat as unhealthy
    }
  }

  const healthy = Boolean(health?.ok && health.uuid === record.uuid);
  const stale = !healthy && isStale(record, { echoedUuid: health?.uuid ?? null });

  if (stale && options.reclaimStale) {
    release({ lockPath, expectedUuid: record.uuid });
    return {
      running: false,
      healthy: false,
      stale: true,
      healed,
      configDir,
      lockPath,
      tokenPath,
      record,
      health,
    };
  }

  return {
    running: !stale,
    healthy,
    stale,
    healed,
    configDir,
    lockPath,
    tokenPath,
    record,
    health,
  };
}

export async function ensureDaemon(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const deadline = Date.now() + (options.startTimeoutMs ?? 15_000);
  let launched = false;

  while (Date.now() < deadline) {
    const status = await getDaemonStatus({
      configDir,
      reclaimStale: true,
      healthTimeoutMs: options.healthTimeoutMs,
      treatSelfAsZombie: options.treatSelfAsZombie,
    });
    if (status.running && status.healthy && status.record && status.health) {
      return toConnectionInfo(status.record, status.health);
    }

    if (!status.running && !launched) {
      await (options.spawnDaemon ?? spawnDetachedDaemon)({ configDir, host: options.host, port: options.port });
      launched = true;
    }

    await delay(options.pollIntervalMs ?? 200);
  }

  throw new Error(`Timed out waiting for daemon startup in ${configDir}.`);
}

export async function startDaemon(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const lockPath = getLockfilePath(configDir);
  const tokenPath = getTokenPath(configDir);
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 200;
  const version = options.version ?? resolveServerVersion();

  for (let attempt = 0; attempt < retries; attempt++) {
    const status = await getDaemonStatus({
      configDir,
      reclaimStale: true,
      healthTimeoutMs: options.healthTimeoutMs,
    });

    if (status.running && status.healthy && status.record && status.health) {
      return {
        attached: true,
        ...toConnectionInfo(status.record, status.health),
        close: async () => undefined,
        closed: Promise.resolve(),
      };
    }

    if (status.running) {
      await delay(retryDelayMs);
      continue;
    }

    const uuid = randomUUID();
    const startedAt = new Date().toISOString();
    const token = ensureToken({ tokenPath });
    const provisional = {
      pid: process.pid,
      uuid,
      port: typeof options.port === 'number' ? options.port : 0,
      port_lsp: null,
      bearerToken: token.bearerToken,
      version,
      startedAt,
      tunnelUrl: null,
    };

    if (!acquire(provisional, { lockPath })) {
      await delay(retryDelayMs);
      continue;
    }

    let server;
    let lspChild = null;
    let finalizePromise = null;
    let finalizeResolve;
    const closed = new Promise((resolve) => { finalizeResolve = resolve; });

    const buildRecord = (bearerToken = server?.bearerToken ?? token.bearerToken) => ({
      pid: process.pid,
      uuid,
      port: server?.port ?? provisional.port,
      port_lsp: null,
      bearerToken,
      version,
      startedAt,
      tunnelUrl: null,
    });

    const syncLockfile = (bearerToken = server?.bearerToken ?? token.bearerToken) => {
      replace(buildRecord(bearerToken), { lockPath, expectedUuid: uuid });
    };

    const finalize = async () => {
      if (!finalizePromise) {
        finalizePromise = (async () => {
          if (options.signal && abortHandler) {
            options.signal.removeEventListener('abort', abortHandler);
          }
          process.off('SIGINT', signalHandler);
          process.off('SIGTERM', signalHandler);
          // Send SIGTERM to LSP subprocess before releasing lockfile (D-02)
          lspChild?.kill('SIGTERM');
          release({ lockPath, expectedUuid: uuid });
          finalizeResolve?.();
        })();
      }
      await finalizePromise;
    };

    const signalHandler = () => { void close(); };
    const abortHandler = () => { void close(); };

    const close = async () => {
      if (server) {
        await server.stop().catch(() => undefined);
      }
      await finalize();
    };

    try {
      server = await startDaemonServer({
        host: options.host,
        port: options.port,
        uuid,
        version,
        configDir,
        bearerToken: token.bearerToken,
        onShutdown: finalize,
        onTokenRotated: async (nextToken) => {
          syncLockfile(nextToken.bearerToken);
        },
      });

      syncLockfile(server.bearerToken);

      // Spawn airtable-user-lsp --tcp as a tracked child (D-02)
      // LSP subprocess writes port_lsp to daemon.lock itself via lockfile-writer
      // Hold reference for SIGTERM on daemon shutdown
      try {
        // Resolve lsp-server binary: check installed alongside mcp-server (bundled in extension dist),
        // then check workspace/node_modules relative path (standalone users)
        let lspBin = null;
        const lspCandidates = [
          // Extension bundles lsp-server dist next to mcp-server dist
          join(__dirname, '..', '..', 'lsp', 'index.mjs'),
          // Workspace install path (e.g. packages/lsp-server/dist/index.mjs)
          fileURLToPath(new URL('../../lsp-server/dist/index.mjs', import.meta.url)),
        ];
        for (const candidate of lspCandidates) {
          if (existsSync(candidate)) { lspBin = candidate; break; }
        }

        if (lspBin) {
          lspChild = spawn(process.execPath, [lspBin, '--tcp'], {
            stdio: 'ignore',
            env: { ...process.env, AIRTABLE_USER_MCP_HOME: configDir },
            // NOT detached — daemon holds reference for SIGTERM (D-02)
          });
          lspChild.on('error', (err) => {
            console.error(`[airtable-mcp] LSP subprocess error: ${err.message}`);
            lspChild = null;
          });
          lspChild.on('exit', (code, signal) => {
            if (signal !== 'SIGTERM') {
              // Unexpected exit — log but do not crash the daemon
              console.error(`[airtable-mcp] LSP subprocess exited unexpectedly: code=${code} signal=${signal}`);
            }
            lspChild = null;
          });
          if (server.setLspChild) server.setLspChild(lspChild);
        } else {
          // LSP binary not found in expected locations — daemon continues without LSP
          // port_lsp remains null in lockfile
          console.error('[airtable-mcp] airtable-user-lsp binary not found; LSP features unavailable');
        }
      } catch (err) {
        // Non-fatal: daemon works without LSP subprocess
        console.error(`[airtable-mcp] Failed to spawn LSP subprocess: ${err instanceof Error ? err.message : String(err)}`);
      }

      process.on('SIGINT', signalHandler);
      process.on('SIGTERM', signalHandler);
      options.signal?.addEventListener('abort', abortHandler);

      return {
        attached: false,
        pid: process.pid,
        uuid,
        port: server.port,
        url: server.url,
        bearerToken: server.bearerToken,
        version,
        startedAt,
        tunnelUrl: null,
        close,
        closed,
      };
    } catch (error) {
      await server?.stop?.().catch(() => undefined);
      release({ lockPath, expectedUuid: uuid });

      if (isAddressInUseError(error)) {
        if (typeof options.port === 'number' && options.port > 0) {
          throw new Error(`Port ${options.port} is in use; daemon cannot start.`);
        }
        await delay(retryDelayMs);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to start daemon after ${retries} attempts.`);
}

export async function stopDaemon(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const status = await getDaemonStatus({
    configDir,
    reclaimStale: true,
    healthTimeoutMs: options.healthTimeoutMs,
  });

  if (!status.running || !status.record) {
    if (options.force && status.record) {
      try {
        release({ lockPath: getLockfilePath(configDir), expectedUuid: status.record.uuid });
      } catch { /* best-effort */ }
    }
    return { stopped: false, forced: false, pid: status.record?.pid ?? null };
  }

  const recordForShutdown = status.record;

  if (status.healthy) {
    try {
      await adminRequest(recordForShutdown, '/daemon/shutdown', { method: 'POST' });
    } catch (err) {
      if (!options.force) throw err;
    }
  }

  const deadline = Date.now() + (options.waitTimeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    const nextStatus = await getDaemonStatus({ configDir, reclaimStale: true, healthTimeoutMs: options.healthTimeoutMs });
    if (!nextStatus.running) {
      return { stopped: true, forced: false, pid: recordForShutdown.pid };
    }
    await delay(options.pollIntervalMs ?? 200);
  }

  if (!options.force) {
    throw new Error('Timed out waiting for daemon shutdown.');
  }

  const pid = recordForShutdown.pid;
  let signalled = false;
  try {
    process.kill(pid, 'SIGTERM');
    signalled = true;
    await delay(1000);
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
      await delay(500);
    } catch { /* process already gone */ }
  } catch { /* process may already be dead */ }

  try {
    release({ lockPath: getLockfilePath(configDir), expectedUuid: recordForShutdown.uuid });
  } catch { /* best-effort */ }

  return { stopped: signalled, forced: true, pid };
}

export async function restartDaemon(options = {}) {
  let stopped = false;
  try {
    const result = await stopDaemon({
      configDir: options.configDir,
      waitTimeoutMs: options.waitTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      healthTimeoutMs: options.healthTimeoutMs,
    });
    stopped = result.stopped;
  } catch {
    // Ignore — may already be down
  }

  const connection = await ensureDaemon({
    configDir: options.configDir,
    healthTimeoutMs: options.healthTimeoutMs,
    startTimeoutMs: options.startTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    spawnDaemon: options.spawnDaemon,
    treatSelfAsZombie: options.treatSelfAsZombie,
  });

  return { stopped, reSpawned: true, connection };
}

export async function spawnDetachedDaemon(options) {
  const configDir = options.configDir ?? getHomeDir();
  const cliEntry = resolveCliEntry();
  const args = [cliEntry, 'daemon', 'start'];
  if (typeof options.port === 'number') {
    args.push('--port', String(options.port));
  }

  const env = { ...process.env };
  delete env.AIRTABLE_NO_DAEMON;
  delete env.AIRTABLE_HEADLESS_ONLY;

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...env,
      AIRTABLE_USER_MCP_HOME: configDir,
    },
  });
  child.unref();
}
