import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { AirtableAuth } from '../auth.js';
import { AirtableClient } from '../client.js';
import { ToolConfigManager } from '../tool-config.js';
import { ensureToken, rotateToken, getTokenPath } from './token.js';
import { getTunnelProvider, writeTunnelSettings } from './tunnel-providers/index.js';

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

async function listenAvoidingBlockedPorts(server, requestedPort, host) {
  const maxAttempts = requestedPort === 0 ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      server.listen(requestedPort, host);
    });

    const boundPort = getBoundPort(server);
    if (!FETCH_BLOCKED_PORTS.has(boundPort)) {
      return;
    }

    await new Promise((resolve) => server.close(() => resolve()));
  }
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
function isTunnelRequest(req) {
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
  let closed = false;
  let activeTunnel = null;

  // 401-burst tripwire constants (D-06)
  const BURST_FAILURE_COUNT = 10;
  const BURST_WINDOW_MS = 60_000;
  let authFailureCount = 0;
  let burstWindowStart = Date.now();
  let tunnelAutoDisabled = false;

  let auth;
  let client;
  let clientInitPromise = null;

  const getClient = async () => {
    if (!auth) { auth = new AirtableAuth(); }
    if (!client) { client = new AirtableClient(auth); }
    if (!clientInitPromise) {
      const pending = auth.init();
      pending.catch(() => { client = undefined; clientInitPromise = null; });
      clientInitPromise = pending;
    }
    await clientInitPromise;
    return client;
  };

  const toolConfig = new ToolConfigManager();
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
      publishEvent('daemon:tunnel-auto-disabled', { failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
      options.onTunnelAutoDisable?.({ failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
    }
  };

  const requireBearer = (req, res, next) => {
    const header = req.headers?.authorization ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const provided = match ? match[1] : null;
    if (provided !== currentToken.bearerToken) {
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

  app.all('/mcp', requireBearer, async (req, res, next) => {
    try {
      const mcpServer = new Server(
        { name: 'airtable-user-mcp', version },
        { capabilities: { tools: { listChanged: true } } },
      );
      toolConfig.bindServer(mcpServer);
      mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: options.getTools ? await options.getTools(toolConfig) : [],
      }));
      mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (!options.callTool) {
          return { content: [{ type: 'text', text: 'Daemon not fully initialized' }], isError: true };
        }
        return options.callTool(request, getClient, toolConfig);
      });

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

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
      await transport.handleRequest(req, res, req.body);
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
  };
}
