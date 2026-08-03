import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getPrompts, renderPrompt } from '../prompts.js';
import express from 'express';
import { AirtableAuth } from '../auth.js';
import { AirtableClient } from '../client.js';
import { ToolConfigManager } from '../tool-config.js';
import { withToolDispatchContext } from '../page-scheduler.js';
import { ensureToken, rotateToken, getTokenPath, onTokenRotate } from './token.js';
import { takeDaemonExit, withDaemonExitOwner } from './exit-intent.js';
import { clearStopSentinel, writeStopSentinel } from './stop-sentinel.js';
import { setInjectedCredentials } from './cred-store.js';
import { getTunnelProvider, writeTunnelSettings } from './tunnel-providers/index.js';
import {
  runCloudflaredLogin,
  createNamedTunnel,
  writeTunnelConfig,
  readNamedTunnelConfig,
  routeTunnelDns,
} from './tunnel-providers/cloudflared-named-setup.js';
import { getTunnelBinaryPath } from './install-tunnel.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolveServerVersion() {
  try {
    const versionFile = path.join(__dirname, '..', 'version.json');
    const raw = readFileSync(versionFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.mcpServer === 'string') return parsed.mcpServer;
  } catch { /* fall through */ }
  try {
    return require('../../package.json').version;
  } catch { /* unknown */ }
  return 'unknown';
}

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679,
  6697, 10080,
]);

// Bind failures on a NON-ZERO fixed port that should degrade to an ephemeral port instead of
// crashing the daemon: the port is already in use (EADDRINUSE), sits in a Windows reserved/excluded
// port range or is otherwise permission-denied (EACCES — the "listen EACCES 127.0.0.1:8723" case
// that killed every startup when the default port landed in an excluded range), or is not assignable
// (EADDRNOTAVAIL). Any of these on a fixed port → retry on port 0.
const FIXED_PORT_FALLBACK_CODES = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']);

export async function listenAvoidingBlockedPorts(server, requestedPort, host) {
  // A fixed port (requestedPort > 0) gets one shot; if it's unavailable (in use, excluded/denied,
  // not assignable) or turns out to be a browser-blocked port, we fall back to an OS-assigned
  // ephemeral port so the daemon always starts. The bound port is read back and persisted to the
  // lockfile, so clients still discover it. With requestedPort 0 we simply retry on ephemeral ports
  // until one is not browser-blocked.
  let port = requestedPort;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    } catch (error) {
      if (port !== 0 && FIXED_PORT_FALLBACK_CODES.has(error?.code)) {
        // fixed port unavailable (taken/excluded/denied) → fall back to an ephemeral port
        console.error(`[airtable-user-mcp] fixed daemon port ${port} unavailable (${error.code}) — falling back to an automatic port.`);
        port = 0;
        continue;
      }
      throw error;
    }

    const boundPort = getBoundPort(server);
    if (!FETCH_BLOCKED_PORTS.has(boundPort)) {
      return;
    }

    await new Promise((resolve) => server.close(() => resolve()));
    port = 0; // blocked port → next attempt uses an ephemeral port
  }

  // Unreachable in practice — the first fallback sets port=0 and OS ephemeral ports (>=32768) are
  // never in FETCH_BLOCKED_PORTS (all <=10080), so iteration 2 always binds and returns. But do NOT
  // fall through returning undefined with the server closed/unbound: the caller reads getBoundPort()
  // and would throw the misleading "Daemon server is not listening on a TCP port." Fail clearly.
  throw new Error(`Daemon could not bind a usable (non-browser-blocked) port after 5 attempts (requested port ${requestedPort}).`);
}

function getBoundPort(server) {
  const address = server?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Daemon server is not listening on a TCP port.');
  }
  return address.port;
}

/**
 * Detect whether an incoming request originated from a tunnel (i.e., not loopback).
 * Tunnel traffic carries X-Forwarded-For or cf-connecting-ip headers, or arrives
 * from a non-loopback IP.
 *
 * NOTE: X-Forwarded-For spoofing makes us MORE restrictive, never less — safe by design.
 * (D-07 threat model: T-07-14)
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isTunnelRequest(req) {
  if (req.headers?.['x-forwarded-for']) return true;
  if (req.headers?.['cf-connecting-ip']) return true;
  const ip = req.socket?.remoteAddress ?? '';
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return true;
  return false;
}

function homepageHtml(version) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Airtable User MCP</title>
<style>
*,::before,::after{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;overflow:hidden;position:relative}
.bg{position:fixed;inset:0;z-index:0;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(80px);opacity:.35;animation:drift 12s ease-in-out infinite alternate}
.orb1{width:500px;height:500px;background:#1868f7;top:-120px;left:-120px;animation-delay:0s}
.orb2{width:400px;height:400px;background:#0052cc;bottom:-80px;right:-80px;animation-delay:-4s}
.orb3{width:300px;height:300px;background:#00b4d8;top:40%;left:60%;animation-delay:-8s}
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(30px,20px) scale(1.08)}}
.card{position:relative;z-index:1;background:rgba(22,27,34,.85);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px 48px;max-width:520px;width:90%;text-align:center;backdrop-filter:blur(20px);box-shadow:0 20px 60px rgba(0,0,0,.6)}
.logo{font-size:2.4rem;font-weight:800;letter-spacing:-1px;background:linear-gradient(135deg,#4d8ef7 0%,#00b4d8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
.version{font-size:.72rem;color:#8b949e;margin-bottom:24px;font-family:monospace}
.desc{font-size:.95rem;color:#8b949e;line-height:1.6;margin-bottom:28px}
.endpoint{background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 14px;font-family:monospace;font-size:.8rem;color:#58a6ff;margin-bottom:28px;word-break:break-all}
.auth-note{background:rgba(255,186,5,.08);border:1px solid rgba(255,186,5,.2);border-radius:8px;padding:10px 14px;font-size:.78rem;color:#d29922;margin-bottom:28px;text-align:left;display:flex;gap:8px;align-items:flex-start}
.auth-note::before{content:'🔒';flex-shrink:0;font-size:.9rem}
.links{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.link{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:.8rem;font-weight:600;text-decoration:none;transition:all .15s ease;border:1px solid}
.link-primary{background:#1868f7;border-color:#1868f7;color:#fff}.link-primary:hover{background:#1557d6}
.link-ghost{background:transparent;border-color:rgba(255,255,255,.15);color:#e6edf3}.link-ghost:hover{border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.04)}
</style>
</head>
<body>
<div class="bg">
  <div class="orb orb1"></div>
  <div class="orb orb2"></div>
  <div class="orb orb3"></div>
</div>
<div class="card">
  <div class="logo">Airtable User MCP</div>
  <div class="version">v${version}</div>
  <p class="desc">A local MCP server that gives AI assistants full access to your Airtable workspaces — read, write, views, fields, forms, and more.</p>
  <div class="endpoint">${'POST /mcp'}</div>
  <div class="auth-note">This server requires a Bearer token. Get yours from the VS Code extension → Setup tab.</div>
  <div class="links">
    <a class="link link-primary" href="https://github.com/Automations-Project/airtable-user-mcp" target="_blank" rel="noopener">GitHub</a>
    <a class="link link-ghost" href="https://www.npmjs.com/package/airtable-user-mcp" target="_blank" rel="noopener">npm</a>
    <a class="link link-ghost" href="https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula" target="_blank" rel="noopener">VS Code Extension</a>
  </div>
</div>
</body>
</html>`;
}

function blockHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>401 — Unauthorized</title>
<style>
*,::before,::after{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.card{background:rgba(22,27,34,.95);border:1px solid rgba(248,81,73,.25);border-radius:16px;padding:40px 48px;max-width:440px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.icon{font-size:2.8rem;margin-bottom:16px}
.code{font-size:3rem;font-weight:800;letter-spacing:-2px;color:#f85149;margin-bottom:4px}
.label{font-size:.85rem;color:#8b949e;margin-bottom:20px;letter-spacing:.05em;text-transform:uppercase}
.desc{font-size:.88rem;color:#8b949e;line-height:1.6;margin-bottom:24px}
.hint{background:rgba(22,27,34,.6);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 14px;font-size:.78rem;color:#58a6ff;font-family:monospace}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔒</div>
  <div class="code">401</div>
  <div class="label">Unauthorized</div>
  <p class="desc">This MCP server requires a valid Bearer token in the <code>Authorization</code> header. Open the VS Code extension → Setup tab to copy your token and configure your AI client.</p>
  <div class="hint">Authorization: Bearer &lt;your-token&gt;</div>
</div>
</body>
</html>`;
}

export async function startDaemonServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;
  const version = options.version ?? resolveServerVersion();
  const tokenPath = getTokenPath(options.configDir);
  const initialToken = options.bearerToken
    ? {
        bearerToken: options.bearerToken,
        version: 1,
        createdAt: new Date().toISOString(),
        rotatedAt: new Date().toISOString(),
      }
    : ensureToken({ tokenPath });

  let currentToken = initialToken;
  // A rotation driven through the module-level rotateToken() — CLI, a tool
  // handler, anything that is not POST /daemon/rotate-token — cannot reach this
  // closure on its own. Subscribing makes adoption unconditional, so no rotation
  // can strand this process on a bearer nobody will present again.
  const unsubscribeTokenRotate = onTokenRotate((record, rotatedPath) => {
    if (rotatedPath !== tokenPath) return; // another configDir's daemon, not ours
    currentToken = record;
  });
  let closed = false;
  let activeTunnel = null;

  // 401-burst tripwire constants (D-06)
  const BURST_FAILURE_COUNT = 10;
  const BURST_WINDOW_MS = 60_000;
  let authFailureCount = 0;
  let burstWindowStart = Date.now();
  let tunnelAutoDisabled = false;

  // Prefer a shared auth/client from the host process (index.js) so /daemon/health
  // pageBusy, release-browser, and MCP tool calls all share one PageScheduler.
  // Without this, health reports a second idle AirtableAuth while tools use another.
  let auth = options.auth || null;
  let client = options.client || null;
  let clientInitPromise = null;

  const getClient = async () => {
    if (!auth) { auth = new AirtableAuth(); }
    if (!client) { client = new AirtableClient(auth); }
    if (!clientInitPromise) {
      const pending = auth.init();
      pending.catch(() => {
        // Only clear lazily-created instances — shared host auth must survive a failed init.
        if (!options.auth) {
          auth = undefined;
          client = undefined;
        }
        clientInitPromise = null;
      });
      clientInitPromise = pending;
    }
    await clientInitPromise;
    return client;
  };

  const toolConfig = new ToolConfigManager();
  await toolConfig.load();
  // Awaited, not fire-and-forget: startWatching() only assigns `_watcher` after an
  // internal `await mkdir`, so an un-awaited call lets stop() run stopWatching()
  // while `_watcher` is still null. The watcher is then created with nobody left to
  // close it, and the fs handle keeps the process alive after the daemon has shut
  // down — stopDaemon() waits out its timeout and escalates to SIGKILL.
  await toolConfig.startWatching();
  const startedAt = Date.now();
  const sseClients = new Set();
  const activeMcpClosers = new Set();

  const expressFactory = express;
  const app = expressFactory();

  // Tunnel allowlist — MUST run before express.json() and before requireBearer (D-07)
  // Prevents tunnel callers from reaching /daemon/* endpoints (including their auth errors)
  // Security: T-07-12 — tunnel caller never discovers /daemon/shutdown exists
  app.use((req, res, next) => {
    if (!isTunnelRequest(req)) return next();
    const p = req.path;
    if (p.startsWith('/mcp') || p === '/') return next();
    res.status(404).json({ error: 'Not found' });
  });

  app.use(expressFactory.json({ limit: '1mb' }));

  // Public homepage — accessible to anyone (loopback or tunnel)
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(homepageHtml(version));
  });

  const publishEvent = (event, payload) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of sseClients) {
      response.write(frame);
    }
  };

  // 401-burst tripwire tracker (D-06)
  // Only counts failures from tunnel-originated requests (isTunnelRequest = true).
  // Sliding window: resets when BURST_WINDOW_MS elapses between failures.
  // On threshold: publishes daemon:tunnel-auto-disabled SSE + calls onTunnelAutoDisable callback.
  const track401Burst = (req) => {
    if (!isTunnelRequest(req)) return; // only track tunnel-originated failures
    const now = Date.now();
    if (now - burstWindowStart > BURST_WINDOW_MS) {
      authFailureCount = 0;
      burstWindowStart = now;
    }
    authFailureCount++;
    if (authFailureCount >= BURST_FAILURE_COUNT && !tunnelAutoDisabled) {
      tunnelAutoDisabled = true;
      const ip = req.headers?.['cf-connecting-ip']
        ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        ?? null;
      // Stop the tunnel HERE, on the one handle this module owns. The launcher's
      // onTunnelAutoDisable callback used to be the only thing that stopped it,
      // and it could only see a tunnel the LAUNCHER had started at boot — so a
      // tunnel enabled from the dashboard (which fills this closure instead)
      // survived the tripwire entirely: `tunnelAutoDisabled` latched, the UI said
      // "Auto-disabled", and cloudflared kept serving the public hostname.
      // The callback is now bookkeeping only (settings + lockfile).
      if (activeTunnel) {
        const stopping = activeTunnel;
        activeTunnel = null;
        void stopping.stop().catch(() => undefined);
      }
      publishEvent('daemon:tunnel-auto-disabled', { failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
      options.onTunnelAutoDisable?.({ failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
    }
  };

  // Constant-time comparison — `===` short-circuits on the first differing
  // byte, which lets a tunnel-side attacker time their way through the token.
  const tokensMatch = (provided, expected) => {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };

  const requireBearer = (req, res, next) => {
    const header = req.headers?.authorization ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const provided = match ? match[1] : null;
    // Claude.ai custom connectors can't send an Authorization header (OAuth or
    // no-auth only), so the token may ride the URL instead: /mcp?token=<bearer>.
    // Same secret, same timing-safe compare — the Zapier/n8n secret-URL pattern.
    const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;
    if (queryToken !== null) {
      // The URL carries the secret on this path — keep it out of referrers and caches.
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
    }
    if (!tokensMatch(provided, currentToken.bearerToken)
      && !tokensMatch(queryToken, currentToken.bearerToken)) {
      track401Burst(req);  // 401-burst tripwire (D-06)
      const wantHtml = (req.headers?.accept ?? '').includes('text/html');
      if (wantHtml) {
        res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8').end(blockHtml());
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
      return;
    }
    next();
  };

  const getHealth = () => ({
    ok: true,
    pid: process.pid,
    uuid: options.uuid ?? null,
    version,
    port: getBoundPort(httpServer),
    uptimeMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    tunnelUrl: activeTunnel?.getState?.()?.url ?? null,
    // The daemon's EFFECTIVE runtime config, reported because it is not
    // necessarily the caller's. A standalone client (Claude Desktop, Cursor,
    // Cline, Amp) that finds a lockfile attach-proxies into whichever daemon is
    // already running — typically VS Code's — and the attach path reads only
    // AIRTABLE_NO_DAEMON and AIRTABLE_USER_MCP_HOME from the client's own env
    // (see the attach-proxy prologue in src/index.js). Every other variable that
    // client was configured with — AIRTABLE_AUTH_MODE, AIRTABLE_HTTP_CLIENT, the
    // browser channel, idle-park tuning — belongs to the daemon's process, not
    // theirs, and is silently void. Attaching anyway is deliberate: refusing
    // would put a second Chromium on the shared persistent profile, which is the
    // Chrome-exit-21 "session dead" crash class. So the mismatch is made
    // *visible* instead — one stderr line at attach time, and these fields, which
    // are the only way a caller can ask "whose settings am I actually running
    // under?" after the fact.
    authMode: (process.env.AIRTABLE_AUTH_MODE || 'browser').toLowerCase(),
    httpClient: process.env.AIRTABLE_HTTP_CLIENT || 'fetch',
    configDir: options.configDir ?? null,
    // Shared page/auth pipeline busy snapshot (tool name when runInToolContext is set).
    pageBusy: auth?.getBusyState?.() ?? {
      busy: false,
      active: null,
      queued: 0,
      delaying: false,
      updatedAt: new Date().toISOString(),
    },
  });

  app.get('/daemon/health', requireBearer, (_req, res) => {
    res.json(getHealth());
  });

  app.get('/daemon/events', requireBearer, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: daemon:ready\ndata: ${JSON.stringify(getHealth())}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.post('/daemon/heartbeat', requireBearer, (req, res) => {
    const clientId = typeof req.body?.clientId === 'string' && req.body.clientId.length > 0
      ? req.body.clientId
      : 'daemon-client';
    res.json({ ok: true, clientId });
  });

  // Session health — verified through the daemon's SINGLE shared browser.
  // The extension calls this instead of forking its own health-check Chrome;
  // two Chromes on one persistent profile collide (Chrome exit code 21), which
  // is the root cause of the "session dead / network error" failure mode.
  app.get('/daemon/session-health', requireBearer, async (_req, res) => {
    try {
      if (options.getSessionHealth) {
        res.json(await options.getSessionHealth());
        return;
      }
      await getClient();              // ensure the shared browser is initialized
      res.json(await auth.checkSessionHealth());
    } catch (error) {
      // init/verify threw (e.g. session expired → login redirect) — report it
      // as an invalid session rather than a 500 so the dashboard shows the
      // right state and offers re-login.
      res.json({ valid: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Release the shared browser so an interactive (headful) login can open the
  // persistent profile exclusively. The next getClient()/session-health call
  // re-initializes it, picking up the freshly-written session cookies.
  app.post('/daemon/release-browser', requireBearer, async (_req, res) => {
    try {
      if (auth) await auth.close().catch(() => {});
    } finally {
      // Only drop LAZILY-created instances. A shared host auth/client (options.auth —
      // the pageBusy fix) MUST keep its reference so MCP tools, /daemon/health pageBusy,
      // and idle-park all stay on ONE PageScheduler. Nulling it would spawn a SECOND
      // AirtableAuth on the next getClient()/session-health call — the dual-auth bug this
      // workstream fixes. close() above already freed the browser; the next call re-inits
      // the SAME shared instance (which re-arms the idle-park busy listener in _doInit).
      if (!options.auth) { auth = undefined; client = undefined; }
      clientInitPromise = null;
    }
    res.json({ ok: true });
  });

  // POST /daemon/auth-credentials (C2) — runtime credential channel.
  // The extension pushes byo/direct-login creds here instead of via env/disk
  // (the daemon deliberately gets no creds in its environment). The body is
  // stored IN MEMORY ONLY (src/daemon/cred-store.js) — NEVER persisted, NEVER
  // logged. Do not console.log / trace the body or any field value below.
  app.post('/daemon/auth-credentials', requireBearer, async (req, res) => {
    try {
      const body = req.body ?? {};
      const { authMode } = body;
      if (authMode !== 'byo' && authMode !== 'direct-login') {
        res.status(400).json({ ok: false, error: "authMode must be 'byo' or 'direct-login'" });
        return;
      }
      // Basic shape validation only — string-typed secrets, values never
      // inspected/logged (avoid leaking a secret into an error message).
      for (const key of ['cookie', 'csrf', 'email', 'password', 'totpSecret']) {
        if (body[key] !== undefined && typeof body[key] !== 'string') {
          res.status(400).json({ ok: false, error: `${key} must be a string` });
          return;
        }
      }

      setInjectedCredentials({
        authMode,
        cookie: body.cookie,
        csrf: body.csrf,
        email: body.email,
        password: body.password,
        totpSecret: body.totpSecret,
      });

      // Invalidate the CURRENT auth session so the next API call re-inits and
      // picks up the freshly-injected creds. Mirror getClient()'s lazy pattern
      // (create auth if absent), then reset the session state. AirtableAuth has
      // no single reset method that also clears _credentials, so we reset the
      // fields directly: for byo/direct-login, ensureLoggedIn() re-runs
      // _doInit whenever _credentials is null (which re-reads cred-store first);
      // isLoggedIn=false covers the browser path. We do NOT launch the browser
      // here — clearing clientInitPromise only marks the client stale so the
      // NEXT getClient() (i.e. the next MCP tool call) rebuilds it.
      if (!auth) { auth = new AirtableAuth(); }
      auth.isLoggedIn = false;
      auth._credentials = null;
      auth.csrfToken = null;
      auth.resetSessionHealth?.(); // clear the dead-session circuit-breaker
      clientInitPromise = null;

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/daemon/rotate-token', requireBearer, async (_req, res, next) => {
    try {
      currentToken = rotateToken({ tokenPath });
      await options.onTokenRotated?.(currentToken);
      publishEvent('daemon:token-rotated', {
        rotatedAt: currentToken.rotatedAt,
        version: currentToken.version,
      });
      res.json({ ok: true, rotatedAt: currentToken.rotatedAt, version: currentToken.version });
    } catch (error) {
      next(error);
    }
  });

  app.post('/daemon/shutdown', requireBearer, (req, res, next) => {
    res.json({ ok: true });
    setImmediate(() => {
      stop().catch(next);
    });
  });

  // POST /daemon/enable-tunnel (D-01, D-04)
  // body: { provider: 'cf-quick'|'ngrok'|'cf-named', authtoken?: string, domain?: string }
  // Requires loopback bearer auth — tunnel callers see 404 (allowlist middleware above).
  app.post('/daemon/enable-tunnel', requireBearer, async (req, res, next) => {
    try {
      const { provider, authtoken, domain } = req.body ?? {};
      // Stop existing tunnel if running
      if (activeTunnel) {
        await activeTunnel.stop().catch(() => undefined);
        activeTunnel = null;
      }
      // Check binary is available BEFORE writing settings, so a missing binary
      // doesn't leave settings stuck at enabled:true (which causes permanent "Starting..." in the UI).
      const p = getTunnelProvider(provider);
      const check = await p.isSetupComplete(options.configDir);
      if (!check.ready) {
        const needsInstall = check.action?.kind === 'install-binary';
        res.status(428).json({ ok: false, error: check.reason, needsInstall, action: check.action });
        return;
      }
      // Persist settings before starting (D-03)
      writeTunnelSettings(options.configDir, { enabled: true, provider, ngrokDomain: domain ?? null });
      activeTunnel = await p.start({
        port: getBoundPort(httpServer),
        configDir: options.configDir,
        authtoken,
        domain,
        onStateChange: (state) => {
          if (state.url) {
            options.onTunnelUrlChange?.(state.url);
          } else if (state.status === 'crashed' || state.status === 'disabled') {
            options.onTunnelUrlChange?.(null);
          }
        },
      });
      const url = await activeTunnel.waitUntilReady;
      publishEvent('daemon:tunnel-started', { url });
      tunnelAutoDisabled = false; // reset burst counter on successful enable
      res.json({ ok: true, url });
    } catch (err) {
      // If tunnel failed after settings were written, reset to disabled to prevent stuck "Starting..." state
      writeTunnelSettings(options.configDir, { enabled: false });
      options.onTunnelUrlChange?.(null);
      next(err);
    }
  });

  // POST /daemon/disable-tunnel (D-05)
  // Stops tunnel, writes enabled:false to tunnel-settings.json, publishes daemon:tunnel-stopped SSE.
  app.post('/daemon/disable-tunnel', requireBearer, async (_req, res, next) => {
    try {
      if (activeTunnel) {
        await activeTunnel.stop().catch(() => undefined);
        activeTunnel = null;
      }
      writeTunnelSettings(options.configDir, { enabled: false });
      options.onTunnelUrlChange?.(null);
      publishEvent('daemon:tunnel-stopped', {});
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /daemon/tunnel/named-login
  // Runs `cloudflared tunnel login` (opens a browser). Blocks until
  // ~/.cloudflared/cert.pem appears (up to 10 minutes) or returns early if
  // the cert already exists. Returns { ok: true, alreadyLoggedIn? }.
  app.post('/daemon/tunnel/named-login', requireBearer, async (_req, res, next) => {
    try {
      const certPath = join(homedir(), '.cloudflared', 'cert.pem');
      if (existsSync(certPath)) {
        res.json({ ok: true, alreadyLoggedIn: true });
        return;
      }
      const binaryPath = getTunnelBinaryPath(options.configDir);
      await runCloudflaredLogin({ configDir: options.configDir, binaryPath, forwardOutput: false, timeoutMs: 10 * 60 * 1000 });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /daemon/tunnel/named-create
  // body: { hostname: string, name?: string }
  // Creates a Cloudflare named tunnel (cloudflared tunnel create + route dns)
  // then writes cloudflared-named.yml. Returns early if config already exists.
  // Returns { ok: true, uuid, hostname, configPath }.
  app.post('/daemon/tunnel/named-create', requireBearer, async (req, res, next) => {
    try {
      const { hostname, name } = req.body ?? {};
      if (!hostname || typeof hostname !== 'string') {
        res.status(400).json({ ok: false, error: 'hostname is required' });
        return;
      }

      // Idempotent for the SAME hostname; a DIFFERENT hostname reconfigures
      // the existing tunnel in place (route dns + rewrite managed YAML) —
      // same uuid and credentials, no new tunnel. Without this branch a new
      // hostname was silently ignored and the old one kept serving.
      const existing = readNamedTunnelConfig(options.configDir);
      if (existing) {
        if (existing.hostname === hostname) {
          res.json({ ok: true, uuid: existing.uuid, hostname: existing.hostname, configPath: existing.configPath, alreadyConfigured: true });
          return;
        }
        const binaryPath = getTunnelBinaryPath(options.configDir);
        await routeTunnelDns({ configDir: options.configDir, uuid: existing.uuid, hostname, binaryPath });
        const rewritten = writeTunnelConfig({
          configDir: options.configDir,
          uuid: existing.uuid,
          hostname,
          port: getBoundPort(httpServer),
          credentialsPath: existing.credentialsPath,
        });
        res.json({ ok: true, uuid: existing.uuid, hostname, configPath: rewritten.configPath, reconfigured: true });
        return;
      }

      const binaryPath = getTunnelBinaryPath(options.configDir);
      const tunnelName = (typeof name === 'string' && name.trim())
        ? name.trim()
        : hostname.split('.')[0].slice(0, 32) || 'airtable-mcp';

      const tunnel = await createNamedTunnel({ configDir: options.configDir, name: tunnelName, hostname, binaryPath });
      let result;
      try {
        result = writeTunnelConfig({
          configDir: options.configDir,
          uuid: tunnel.uuid,
          hostname,
          port: getBoundPort(httpServer),
          credentialsPath: tunnel.credentialsPath,
        });
      } catch (writeErr) {
        throw new Error(
          `Tunnel created (uuid=${tunnel.uuid}) but config file write failed: ${writeErr.message}. ` +
          `Re-run the setup flow to complete configuration.`,
        );
      }
      res.json({ ok: true, uuid: tunnel.uuid, hostname, configPath: result.configPath });
    } catch (err) { next(err); }
  });

  // Carry out an exit intent staged by a tool handler (manage_daemon stop/restart).
  // Called only from the response's 'finish' event — see the /mcp route below and
  // exit-intent.js for the SDK deadlock that makes anything earlier unsafe.
  const runExitIntent = async (intent) => {
    try {
      if (intent.action === 'stop') {
        // Written HERE, not in the handler: only a stop that actually reached
        // the exit is a stop, and the extension's implicit ensureDaemon() reads
        // this file to know it must not respawn.
        writeStopSentinel({
          configDir: options.configDir,
          pid: process.pid,
          uuid: options.uuid ?? null,
          by: intent.by ?? 'manage_daemon',
          reason: intent.reason ?? null,
        });
      } else {
        clearStopSentinel({ configDir: options.configDir });
      }
      await stop();
      if (intent.action === 'restart') {
        // After stop(): onShutdown → finalize() has released the lockfile and
        // closeIdleConnections has freed the port, so the replacement can take
        // both. Dynamic import breaks the launcher↔server module cycle;
        // options.spawnDaemon is the test seam (a real detached child would
        // outlive the test run).
        const spawnDaemon = options.spawnDaemon ?? (await import('./launcher.js')).spawnDetachedDaemon;
        await spawnDaemon({ configDir: options.configDir, host, port: requestedPort });
      }
    } catch (error) {
      console.error(`[airtable-mcp] daemon ${intent.action} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  app.all('/mcp', requireBearer, async (req, res, next) => {
    try {
      // 'finish' fires after the response body has been handed to the OS — the
      // only point at which shutting the process down cannot truncate the answer
      // the model is waiting for. Registered BEFORE handleRequest so it is armed
      // no matter how fast the handler completes; a no-op when nothing staged.
      // AsyncLocalStorage associates stageExit() with this request. A concurrent
      // response cannot consume an intent it did not stage, even if it began
      // earlier and finishes in the stage-to-flush window.
      const exitOwner = Symbol('mcp-request');
      res.on('finish', () => {
        const intent = takeDaemonExit(exitOwner);
        if (intent) void runExitIntent(intent);
      });

      const mcpServer = new Server(
        { name: 'airtable-user-mcp', version },
        { capabilities: { tools: { listChanged: true }, prompts: {} } },
      );
      toolConfig.bindServer(mcpServer);
      mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: options.getTools ? await options.getTools(toolConfig) : [],
      }));
      mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        if (!options.callTool) {
          return { content: [{ type: 'text', text: 'Daemon not fully initialized' }], isError: true };
        }
        // Ambient tool label for PageScheduler busy-state (real MCP tool name),
        // plus the caller's origin. /mcp is the ONE route a tunnel caller can
        // reach (the allowlist 404s the rest), so a tool that administers the
        // daemon needs to know which side of that line it is answering — reusing
        // isTunnelRequest rather than inventing a second notion of "remote".
        return withToolDispatchContext(request, extra, () =>
          options.callTool(request, getClient, toolConfig),
          { origin: isTunnelRequest(req) ? 'tunnel' : 'local' },
        );
      });
      mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: getPrompts() }));
      mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        return renderPrompt(name, args ?? {});
      });

      // Stateless (new Server per request) — nothing is ever streamed mid-call, so answer
      // POSTs with plain application/json instead of an SSE stream.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

      // Postel shim: the SDK 406s any client whose Accept header doesn't list BOTH
      // application/json and text/event-stream. Responses here are plain JSON
      // (enableJsonResponse above), so upgrade lenient clients (curl, n8n HTTP nodes,
      // hand-rolled fetch) instead of failing their call with a cryptic 406.
      const accept = String(req.headers.accept || '');
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
        const upgraded = 'application/json, text/event-stream';
        req.headers.accept = upgraded;
        // The SDK builds its web-standard Request from rawHeaders, not req.headers.
        const raw = req.rawHeaders;
        for (let i = raw.length - 2; i >= 0; i -= 2) {
          if (String(raw[i]).toLowerCase() === 'accept') raw.splice(i, 2);
        }
        raw.push('Accept', upgraded);
      }

      let cleanedUp = false;
      const cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        activeMcpClosers.delete(cleanup);
        await mcpServer.close().catch(() => undefined);
      };
      activeMcpClosers.add(cleanup);
      res.on('close', () => { void cleanup(); });

      await mcpServer.connect(transport);
      await withDaemonExitOwner(exitOwner, () => transport.handleRequest(req, res, req.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });

  let httpServer = createServer(app);
  try {
    await listenAvoidingBlockedPorts(httpServer, requestedPort, host);
  } catch (error) {
    try { httpServer.close(); } catch { /* ignore */ }
    httpServer = undefined;
    throw error;
  }

  const runShutdownStep = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[airtable-mcp] daemon shutdown step '${label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stop = async () => {
    if (closed) return;
    closed = true;

    unsubscribeTokenRotate();
    try { toolConfig.stopWatching(); } catch { /* best-effort */ }

    // Close shared browser + tree-kill orphan Chromium before lock release.
    // Without this, Windows leaves chrome.exe holding the profile after stop.
    await runShutdownStep('auth-close', async () => {
      if (auth) await auth.close().catch(() => {});
      auth = undefined;
      client = undefined;
      clientInitPromise = null;
    });

    // Stop tunnel before closing SSE clients — tunnel stop may publish a final event
    await runShutdownStep('tunnel-stop', () => activeTunnel?.stop().catch(() => undefined));
    activeTunnel = null;

    await runShutdownStep('sse-clients', () => {
      for (const response of sseClients) {
        try { response.end(); } catch { /* individual teardown is best-effort */ }
      }
      sseClients.clear();
    });

    for (const cleanup of Array.from(activeMcpClosers)) {
      await runShutdownStep('mcp-cleanup', () => cleanup());
    }

    await runShutdownStep('on-shutdown', () => options.onShutdown?.() ?? undefined);

    if (httpServer) {
      // httpServer.close() only stops NEW connections; an idle keep-alive socket
      // (every client that just got a response) holds it open until
      // keepAliveTimeout — 5s of the daemon still owning port 8723, which is long
      // enough for a restart's replacement to lose the fixed port and silently
      // fall back to an ephemeral one.
      httpServer.closeIdleConnections?.();
      await runShutdownStep('http-close', () =>
        new Promise((resolve, reject) => {
          httpServer.close((error) => {
            if (error) { reject(error); return; }
            resolve();
          });
        }),
      );
    }
  };

  return {
    host,
    port: getBoundPort(httpServer),
    url: `http://${host}:${getBoundPort(httpServer)}`,
    get bearerToken() {
      return currentToken.bearerToken;
    },
    tokenPath,
    stop,
    publishEvent,
    getHealth,
    /**
     * Hand a tunnel started elsewhere (the launcher's boot auto-start) to this
     * module, so there is exactly ONE owner of the running tunnel.
     *
     * Without this the launcher kept its own `activeTunnel` that this closure
     * could not see, and the three paths that stop a tunnel each reached only
     * half the cases: `/daemon/disable-tunnel` was a silent no-op on a
     * boot-started tunnel (it reported ok and nulled the lockfile while
     * cloudflared kept serving), `/daemon/enable-tunnel`'s stop-the-existing
     * guard missed it and orphaned a second cloudflared, and the 401-burst
     * tripwire could only stop boot-started ones.
     */
    adoptTunnel(handle) {
      activeTunnel = handle;
    },
    /** The tunnel handle this module currently owns (read-only; null when none). */
    getActiveTunnel() {
      return activeTunnel;
    },
  };
}
