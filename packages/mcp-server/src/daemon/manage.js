/**
 * `manage_daemon` — the model-facing daemon control surface.
 *
 * Pure-ish orchestration so it is testable with node --test and no live daemon:
 * every side-effecting collaborator arrives through `deps`. The tool handler in
 * index.js supplies the real ones.
 *
 * THREE THINGS THAT ARE NOT NEGOTIABLE HERE
 * -----------------------------------------
 * 1. Nothing in this file exits the process. `stop`/`restart` only STAGE an
 *    intent (see exit-intent.js); express fires it after the response flushes.
 * 2. No read ever mutates. In particular `status` never passes
 *    `reclaimStale:true` (it deletes/rewrites lockfiles) and never touches
 *    /daemon/session-health (it can launch Chromium via ensureLoggedIn()).
 * 3. `bearerToken` is never returned to anyone, in any mode — matching the CLI
 *    (`daemon status` redacts it) and the dashboard (DashboardProvider excludes it).
 */
import { getHomeDir } from '../paths.js';
import { getLockfilePath } from './lockfile.js';
import { getDaemonStatus, adminRequest, ensureDaemon, restartDaemon, spawnDetachedDaemon } from './launcher.js';
import { readTunnelSettings } from './tunnel-providers/index.js';
import { requestDaemonExit } from './exit-intent.js';
import { clearStopSentinel, readStopSentinel, writeStopSentinel } from './stop-sentinel.js';

export const MANAGE_DAEMON_ACTIONS = Object.freeze([
  'status', 'start', 'restart', 'stop', 'tunnel_enable', 'tunnel_disable', 'token_rotate',
]);

/**
 * Actions refused for a caller that reached us through the tunnel.
 *
 * `/mcp` is the ONLY route a tunnel caller can reach — every other /daemon/*
 * route 404s for them (server.js tunnel allowlist, T-07-12: a remote caller must
 * not even discover that /daemon/shutdown exists). Answering daemon
 * administration on the /mcp plane would hand back exactly what that allowlist
 * takes away, so the whole mutating surface is local-only and `status` comes
 * back redacted. The spec names token_rotate and tunnel_* explicitly; start/
 * stop/restart are included on the same argument — a remote stop is a denial of
 * service against the machine's owner, and /daemon/shutdown is precisely what
 * the allowlist already hides.
 */
const LOCAL_ONLY_ACTIONS = Object.freeze(new Set([
  'start', 'restart', 'stop', 'tunnel_enable', 'tunnel_disable', 'token_rotate',
]));

const CLI = 'npx airtable-user-mcp';

/** What to run instead, per action, when a tunnel caller is refused. */
const LOCAL_ONLY_HINT = Object.freeze({
  start:          `\`${CLI} daemon start\``,
  stop:           `\`${CLI} daemon stop\``,
  restart:        `\`${CLI} daemon stop\` then \`${CLI} daemon start\``,
  tunnel_enable:  'the VS Code dashboard Setup tab → Remote Access',
  tunnel_disable: 'the VS Code dashboard Setup tab → Remote Access',
  token_rotate:   'the VS Code dashboard Setup tab → Rotate token',
});

/** Fields stripped from `status` for a tunnel-origin caller. */
const REDACTED_FOR_TUNNEL = Object.freeze(['pid', 'port', 'port_lsp', 'uuid', 'lockPath', 'configDir']);

function refusal(action, why, instead) {
  // Honest non-error refusal, per the perplexity_login precedent: say no, say
  // why, and say what to run — never a failed attempt dressed as an error.
  return {
    action,
    ok: false,
    refused: true,
    reason: why,
    runInstead: instead,
  };
}

/**
 * @param {{action:string, provider?:string, domain?:string, reason?:string}} params
 * @param {{
 *   configDir?: string,
 *   auth?: any,
 *   runtime?: { uuid?: string|null, port?: number|null, startedAt?: string|null },
 *   origin?: 'local'|'tunnel',
 *   version?: string,
 *   provenance?: object|null,
 *   request?: typeof adminRequest,
 *   spawnDaemon?: typeof spawnDetachedDaemon,
 *   stageExit?: typeof requestDaemonExit,
 * }} deps
 */
export async function manageDaemon(params = {}, deps = {}) {
  const action = params.action;
  if (!MANAGE_DAEMON_ACTIONS.includes(action)) {
    throw new Error(
      `Unknown action "${action}". Use: ${MANAGE_DAEMON_ACTIONS.join(', ')}.`,
    );
  }

  const configDir = deps.configDir ?? getHomeDir();
  const origin = deps.origin === 'tunnel' ? 'tunnel' : 'local';

  if (origin === 'tunnel' && LOCAL_ONLY_ACTIONS.has(action)) {
    return refusal(
      action,
      `"${action}" is local-only and this request arrived through the tunnel. A tunnel caller can reach /mcp and nothing else; daemon administration stays on the loopback plane.`,
      `${LOCAL_ONLY_HINT[action]} — on the machine hosting the daemon. From there, manage_daemon action="${action}" also works.`,
    );
  }

  const status = await readDaemonState(configDir, deps);

  switch (action) {
    case 'status':   return buildStatus(status, origin, deps);
    case 'start':    return await doStart(status, deps);
    case 'stop':     return await doStop(status, params, deps);
    case 'restart':  return await doRestart(status, deps);
    case 'tunnel_enable':  return await doTunnel(status, 'enable', params, deps);
    case 'tunnel_disable': return await doTunnel(status, 'disable', params, deps);
    case 'token_rotate':   return await doTokenRotate(status, deps);
    default:         throw new Error(`Unhandled action "${action}".`);
  }
}

// ─── State ────────────────────────────────────────────────────

/**
 * Read-only view of the daemon. `reclaimStale` is deliberately NOT passed:
 * getDaemonStatus deletes the lockfile (launcher.js release/replace) when it is,
 * and no status read in this tool is allowed to mutate anything.
 */
async function readDaemonState(configDir, deps) {
  const state = await getDaemonStatus({ configDir, healthTimeoutMs: 2_000 });
  const record = state.record;
  const runtimeUuid = deps.runtime?.uuid ?? null;
  // Am-I-the-holder needs BOTH halves. `runtime.uuid` is set only by the process
  // that actually acquired the lock, and the lockfile must still name that uuid —
  // so a stdio process cannot claim the role (no uuid) and neither can one whose
  // pid was recycled onto a lockfile written by a dead daemon (uuid mismatch).
  const isHolder = Boolean(
    record && runtimeUuid && record.pid === process.pid && record.uuid === runtimeUuid,
  );
  return { ...state, configDir, record, isHolder };
}

function uptimeMsFrom(startedAt) {
  const t = Date.parse(startedAt ?? '');
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
}

// ─── status ───────────────────────────────────────────────────

function buildStatus(state, origin, deps) {
  const { record, isHolder, configDir } = state;
  const auth = deps.auth ?? null;
  const tunnelSettings = safe(() => readTunnelSettings(configDir), {});

  const out = {
    action: 'status',
    ok: true,
    caller: { origin },
    process: {
      // The single fact the model could not previously see: whether the tools it
      // is calling run inside the daemon or inside a private stdio server.
      transport: isHolder ? 'daemon-http' : (record ? 'stdio (a daemon is running in another process)' : 'stdio (no daemon)'),
      isDaemonHolder: isHolder,
      pid: process.pid,
      version: deps.version ?? null,
      provenance: deps.provenance ?? null,
    },
    daemon: record
      ? {
          running: state.running,
          healthy: state.healthy,
          stale: state.stale,
          pid: record.pid,
          uuid: record.uuid,
          port: record.port,
          port_lsp: record.port_lsp ?? null,
          version: record.version,
          startedAt: record.startedAt,
          uptimeMs: uptimeMsFrom(record.startedAt),
          tunnelUrl: record.tunnelUrl ?? null,
          lockPath: getLockfilePath(configDir),
        }
      : null,
    stopSentinel: safe(() => readStopSentinel({ configDir }), null),
    tunnel: {
      enabled: tunnelSettings.enabled ?? false,
      provider: tunnelSettings.provider ?? null,
      autoDisabled: tunnelSettings.autoDisabled ?? false,
      url: record?.tunnelUrl ?? null,
    },
    // The reason this tool exists. All three were previously reachable only from
    // the extension over HTTP, so a model watching a sync job die could not tell
    // "daemon gone" from "session dead" from "browser busy".
    session: {
      authMode: (process.env.AIRTABLE_AUTH_MODE || 'browser').toLowerCase(),
      httpClient: process.env.AIRTABLE_HTTP_CLIENT || 'fetch',
      sessionDead: safe(() => auth?.isSessionDead?.() ?? null, null),
      // getLastTrip().body carries Airtable's actual 4xx response text — the real
      // reason a bare 403 hides (permission vs CSRF vs rate vs forbidden action).
      lastTrip: safe(() => auth?.getLastTrip?.() ?? null, null),
      busy: safe(() => auth?.getBusyState?.() ?? null, null),
    },
    configDir,
  };

  if (origin === 'tunnel') return redactForTunnel(out);
  return out;
}

/**
 * Blank out host-identifying fields for a tunnel caller. pid/port are the ones
 * the spec names; uuid and the on-disk paths ride along because they are the
 * same class of information (they name the machine and let a remote caller aim
 * at a specific local process). bearerToken is never in this object at all.
 */
function redactForTunnel(status) {
  const scrub = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
      if (REDACTED_FOR_TUNNEL.includes(key)) obj[key] = null;
      else if (typeof obj[key] === 'object') scrub(obj[key]);
    }
    return obj;
  };
  scrub(status);
  status.redacted = [...REDACTED_FOR_TUNNEL];
  status.redactionNote =
    'Host-identifying fields are withheld from tunnel callers. Run manage_daemon on the machine hosting the daemon for the full picture.';
  return status;
}

function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

// ─── start ────────────────────────────────────────────────────

/**
 * A second server on the same persistent Chrome profile is the project's known
 * worst failure mode: two Chromiums on one profile makes Chrome exit 21, which
 * this codebase historically surfaced as "session dead / network error". If this
 * process already has the profile open, spawning a daemon that will open it too
 * is exactly that bug, so refuse instead.
 */
function profileContentionRisk(deps) {
  const auth = deps.auth ?? null;
  const mode = (process.env.AIRTABLE_AUTH_MODE || 'browser').toLowerCase();
  if (mode === 'byo' || mode === 'direct-login') return false; // browser-free — no profile to contend for
  return Boolean(auth?.context);
}

async function doStart(state, deps) {
  const { configDir, isHolder, record } = state;

  if (isHolder) {
    clearStopSentinel({ configDir });
    return {
      action: 'start', ok: true, started: false, noop: true,
      note: `This process IS the daemon (pid ${process.pid}, port ${record.port}). Nothing to start.`,
    };
  }

  if (state.running && state.healthy && record) {
    clearStopSentinel({ configDir });
    return {
      action: 'start', ok: true, started: false, noop: true,
      daemon: { pid: record.pid, port: record.port, version: record.version, startedAt: record.startedAt },
      note: 'A healthy daemon is already running; attached to it rather than starting a second one.',
    };
  }

  if (profileContentionRisk(deps)) {
    return refusal(
      'start',
      'This server already has Chromium open on the shared persistent profile. Starting a daemon now would put a second Chromium on the same profile — Chrome exits with code 21 and the failure surfaces as a bogus "session dead".',
      `Close this MCP server first, then \`${CLI} daemon start\`; or set AIRTABLE_AUTH_MODE=byo / direct-login, which never opens a browser.`,
    );
  }

  clearStopSentinel({ configDir });
  const spawnDaemon = deps.spawnDaemon ?? spawnDetachedDaemon;
  const connection = await ensureDaemon({ configDir, spawnDaemon });
  return {
    action: 'start', ok: true, started: true,
    daemon: { pid: connection.pid, port: connection.port, url: connection.url, version: connection.version, startedAt: connection.startedAt },
  };
}

// ─── stop ─────────────────────────────────────────────────────

async function doStop(state, params, deps) {
  const { configDir, isHolder, record } = state;
  const stageExit = deps.stageExit ?? requestDaemonExit;

  if (isHolder) {
    // The handler MUST return normally. server.js fires the exit from the
    // response's 'finish' event — see exit-intent.js for the deadlock this
    // avoids.
    stageExit({ action: 'stop', by: 'manage_daemon', reason: params.reason ?? null });
    return {
      action: 'stop', ok: true, stopping: true,
      pid: process.pid,
      sentinel: 'daemon.stopped will be written as this process exits, so the extension will not silently respawn it.',
      note: 'The daemon exits immediately after this response is flushed. Any next tool call re-enters through whatever transport your client has configured.',
    };
  }

  if (state.running && state.healthy && record) {
    // Another process holds the daemon: use its own shutdown route, which is the
    // same respond-then-exit shape (server.js POST /daemon/shutdown).
    const request = deps.request ?? adminRequest;
    await request(record, '/daemon/shutdown', { method: 'POST' });
    writeStopSentinel({ configDir, pid: record.pid, uuid: record.uuid, by: 'manage_daemon', reason: params.reason ?? null });
    return { action: 'stop', ok: true, stopped: true, via: '/daemon/shutdown', pid: record.pid };
  }

  return {
    action: 'stop', ok: true, stopped: false, noop: true,
    note: record
      ? 'A lockfile exists but the daemon is not answering; nothing to stop. It will be reclaimed by the next start.'
      : 'No daemon is running.',
  };
}

// ─── restart ──────────────────────────────────────────────────

async function doRestart(state, deps) {
  const { configDir, isHolder, record } = state;
  const stageExit = deps.stageExit ?? requestDaemonExit;
  const spawnDaemon = deps.spawnDaemon ?? spawnDetachedDaemon;

  if (isHolder) {
    // No sentinel: a restart is not a stop. server.js clears any stale one.
    stageExit({ action: 'restart', by: 'manage_daemon' });
    return {
      action: 'restart', ok: true, restarting: true,
      pid: process.pid,
      note: 'This process exits after the response is flushed and a detached replacement is spawned. Poll manage_daemon status (or ~/.airtable-user-mcp/daemon.lock) for the new pid — expect a couple of seconds.',
    };
  }

  if (profileContentionRisk(deps)) {
    return refusal(
      'restart',
      'This server already has Chromium open on the shared persistent profile; the replacement daemon would open a second one on the same profile (Chrome exit 21, reported as "session dead").',
      `Close this MCP server first, then \`${CLI} daemon start\`.`,
    );
  }

  clearStopSentinel({ configDir });

  if (!record) {
    const connection = await ensureDaemon({ configDir, spawnDaemon });
    return {
      action: 'restart', ok: true, restarted: false, started: true,
      note: 'No daemon was running; started one instead.',
      daemon: { pid: connection.pid, port: connection.port, url: connection.url, version: connection.version },
    };
  }

  const result = await restartDaemon({ configDir, spawnDaemon });
  return {
    action: 'restart', ok: true, restarted: true, stoppedPrevious: result.stopped,
    daemon: {
      pid: result.connection.pid, port: result.connection.port,
      url: result.connection.url, version: result.connection.version,
    },
  };
}

// ─── tunnel ───────────────────────────────────────────────────

const TUNNEL_PROVIDERS = Object.freeze(['cf-quick', 'ngrok', 'cf-named']);

/**
 * Both tunnel actions go through the daemon's OWN express routes over loopback.
 * That is deliberate: `activeTunnel` is a closure variable inside
 * startDaemonServer, so anything that starts or stops a tunnel from outside that
 * closure leaves the server holding a stale handle. Interactive setup
 * (runCloudflaredLogin / createNamedTunnel — a readline prompt, up to a
 * 10-minute block, and a NEW Cloudflare tunnel per call) stays off this tool.
 */
async function doTunnel(state, verb, params, deps) {
  const { record } = state;
  const action = verb === 'enable' ? 'tunnel_enable' : 'tunnel_disable';

  if (!state.running || !state.healthy || !record) {
    return refusal(
      action,
      'Tunnels are owned by the daemon and no healthy daemon is running.',
      `\`${CLI} daemon start\` (or manage_daemon action="start"), then retry.`,
    );
  }

  const request = deps.request ?? adminRequest;

  if (verb === 'disable') {
    await request(record, '/daemon/disable-tunnel', { method: 'POST' });
    return { action, ok: true, enabled: false, note: 'Tunnel stopped and tunnel-settings.json set to enabled:false (no-op if none was running).' };
  }

  const provider = params.provider ?? readTunnelSettings(state.configDir).provider ?? 'cf-quick';
  if (!TUNNEL_PROVIDERS.includes(provider)) {
    return refusal(action, `Unknown tunnel provider "${provider}".`, `Use one of: ${TUNNEL_PROVIDERS.join(', ')}.`);
  }
  if (provider === 'ngrok') {
    return refusal(
      action,
      'The ngrok authtoken lives in VS Code SecretStorage and is never handed to the daemon process, so this tool cannot start an ngrok tunnel.',
      'Enable the ngrok tunnel from the VS Code dashboard Setup tab, or use provider="cf-quick".',
    );
  }

  try {
    const result = await request(record, '/daemon/enable-tunnel', {
      method: 'POST',
      body: { provider, domain: params.domain ?? null },
    });
    return { action, ok: true, enabled: true, provider, url: result?.url ?? null };
  } catch (error) {
    // 428 = binary/credentials not set up. That is a setup task with an
    // interactive step, not something to retry here.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('(428)')) {
      return refusal(
        action,
        `The daemon cannot start a "${provider}" tunnel yet: ${message}`,
        provider === 'cf-named'
          ? `\`${CLI} daemon install-tunnel\` then \`${CLI} daemon setup-tunnel named --hostname <host>\` (both have interactive steps).`
          : `\`${CLI} daemon install-tunnel\` to download the cloudflared binary, then retry.`,
      );
    }
    throw error;
  }
}

// ─── token_rotate ─────────────────────────────────────────────

async function doTokenRotate(state, deps) {
  const { record } = state;

  if (!state.running || !state.healthy || !record) {
    return refusal(
      'token_rotate',
      'The bearer token is owned by the running daemon and no healthy daemon is answering. Rotating the file alone would strand whichever process is still holding the old token.',
      `\`${CLI} daemon start\` (or manage_daemon action="start"), then retry.`,
    );
  }

  // Through the route, never the module function: the route also syncs the
  // lockfile (onTokenRotated → syncLockfile) and publishes daemon:token-rotated,
  // so the extension and the CLI both see the new token immediately.
  const request = deps.request ?? adminRequest;
  const result = await request(record, '/daemon/rotate-token', { method: 'POST' });
  return {
    action: 'token_rotate', ok: true, rotated: true,
    rotatedAt: result?.rotatedAt ?? null,
    version: result?.version ?? null,
    // The token itself is deliberately absent, in every mode.
    note: 'The new token is on disk at <configDir>/daemon.token and in the lockfile. Clients still holding the previous bearer will now get 401 and must re-read it; the VS Code extension picks it up from its lockfile watcher.',
  };
}
