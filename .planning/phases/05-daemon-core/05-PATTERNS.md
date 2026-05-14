# Phase 5: Daemon Core — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 8 (5 new, 3 modified)
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/daemon/lockfile.js` | utility | file-I/O | `VSCode-Perplexity-MCP/.../daemon/lockfile.ts` (port source) | direct port — ESM JS conversion |
| `packages/mcp-server/src/daemon/token.js` | utility | file-I/O | `VSCode-Perplexity-MCP/.../daemon/token.ts` (port source) | direct port — ESM JS conversion |
| `packages/mcp-server/src/daemon/server.js` | service | request-response + event-driven | `VSCode-Perplexity-MCP/.../daemon/server.ts` (port source, OAuth stripped) | direct port — ESM JS conversion + OAuth excision |
| `packages/mcp-server/src/daemon/launcher.js` | service | request-response + event-driven | `VSCode-Perplexity-MCP/.../daemon/launcher.ts` (port source, tunnel stripped) | direct port — ESM JS conversion + tunnel excision |
| `packages/mcp-server/src/daemon/index.js` | utility | N/A | `packages/mcp-server/src/paths.js` (module export style) | style-match |
| `packages/mcp-server/src/index.js` | service | request-response | `VSCode-Perplexity-MCP/.../daemon/attach.ts` (logic to fold in) | direct port — fold attach logic into existing entry |
| `packages/extension/src/mcp/daemon-manager.ts` | service | request-response + file-I/O | `packages/extension/src/mcp/auth-manager.ts` | role-match (class shape, dispose, EventEmitter pattern) |
| `packages/extension/src/mcp/registration.ts` | provider | request-response | `packages/extension/src/mcp/registration.ts` (self — modify in place) | self-modify — duck-type pattern already present |

---

## Pattern Assignments

### `packages/mcp-server/src/daemon/lockfile.js` (utility, file-I/O)

**Port source:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/lockfile.ts`

**What changes from the reference:**
- TypeScript → plain ESM JavaScript (no types, use JSDoc `@typedef` for the record shape)
- Replace `import { getConfigDir } from "../profiles.js"` with `import { getHomeDir } from "../paths.js"`
- Call `getHomeDir()` wherever reference calls `getConfigDir()`
- Add `port_lsp` field to `DaemonLockRecord` JSDoc typedef (type: `number | null`)
- Remove `cloudflaredPid` field from the record schema and `normalizeRecord`
- `normalizeRecord` must validate `port_lsp` as `asOptionalInteger` (same helper pattern, new field)
- File extension stays `.js` (not `.mjs`)

**Imports pattern** (reference lockfile.ts lines 1-3, adapted):
```javascript
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHomeDir } from '../paths.js';
```

**Lockfile record typedef** (Airtable-specific, not in reference):
```javascript
/**
 * @typedef {Object} DaemonLockRecord
 * @property {number} pid
 * @property {string} uuid
 * @property {number} port
 * @property {number|null} port_lsp
 * @property {string} bearerToken
 * @property {string} version
 * @property {string} startedAt
 * @property {string|null} tunnelUrl
 */
```

**Core acquire pattern** (reference lockfile.ts lines 32-75 — copy verbatim, strip TS types):
```javascript
export function acquire(record, options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  const normalized = normalizeRecord(record);
  mkdirSync(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (error) {
      if (isExistsError(error)) {
        if (attempt === 0 && tryReclaimStale(lockPath)) {
          continue;
        }
        return false;
      }
      throw error;
    }
    let wrote = false;
    try {
      writeFileSync(fd, serialize(normalized), 'utf8');
      wrote = true;
    } finally {
      closeSync(fd);
      if (!wrote) rmSync(lockPath, { force: true });
    }
    return true;
  }
  return false;
}
```

**isStale + isProcessAlive** (reference lockfile.ts lines 152-169, 255-265 — copy verbatim):
```javascript
export function isStale(record, options = {}) {
  if (!record) return true;
  if (!Number.isInteger(record.pid) || record.pid <= 0) return true;
  if (!record.uuid || typeof record.uuid !== 'string') return true;
  if (options.echoedUuid && options.echoedUuid !== record.uuid) return true;
  return !isProcessAlive(record.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}
```

**normalizeRecord — Airtable-specific diff** (add `port_lsp`, drop `cloudflaredPid`):
```javascript
function normalizeRecord(value) {
  // ... (same validation helpers as reference) ...
  return {
    pid,
    port,
    uuid,
    bearerToken,
    version,
    startedAt,
    port_lsp: asOptionalInteger(record.port_lsp, 'port_lsp'),  // NEW — Phase 6 populates
    tunnelUrl: asOptionalString(record.tunnelUrl, 'tunnelUrl'), // same as reference
    // cloudflaredPid: REMOVED — Phase 7 manages tunnel separately
  };
}
```

---

### `packages/mcp-server/src/daemon/token.js` (utility, file-I/O)

**Port source:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/token.ts`

**What changes from the reference:**
- TypeScript → plain ESM JavaScript
- Replace `import { getConfigDir } from "../profiles.js"` with `import { getHomeDir } from "../paths.js"`
- Replace `safeAtomicWriteFileSync` (not available in Airtable mcp-server) with `writeFileSync` + `renameSync` inline atomic pattern
- `applyPrivatePermissions` on Windows: wrap `restrictWindowsAcl` entire body in `try/catch`, emit `console.warn` on failure instead of throwing (Pitfall 4 from RESEARCH.md)
- Remove `spawnSync` import if using `try/catch` softened path; keep `spawnSync` for the `icacls` call itself

**Imports pattern** (reference token.ts lines 1-6, adapted):
```javascript
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHomeDir } from '../paths.js';
```

**getLockfilePath analog** (reference token.ts lines 20-22, adapted):
```javascript
export function getTokenPath(configDir = getHomeDir()) {
  return join(configDir, 'daemon.token');
}
```

**writeToken — atomic write without safeAtomicWriteFileSync** (replaces reference's `safeAtomicWriteFileSync`):
```javascript
function writeToken(record, options = {}) {
  const tokenPath = options.tokenPath ?? getTokenPath();
  mkdirSync(dirname(tokenPath), { recursive: true });
  const tmp = tokenPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, tokenPath);
  try {
    applyPrivatePermissions(tokenPath);
  } catch (err) {
    console.warn('[airtable-mcp] token file permission restriction failed (non-fatal):', err.message);
  }
}
```

**Windows ACL softened** (Pitfall 4 — reference token.ts lines 113-125, softened):
```javascript
function restrictWindowsAcl(tokenPath) {
  try {
    const username = process.env.USERNAME;
    const domain = process.env.USERDOMAIN;
    const target = domain && username ? `${domain}\\${username}` : username;
    if (!target) throw new Error('Cannot resolve Windows username');
    const result = spawnSync('icacls', [tokenPath, '/inheritance:r', '/grant:r', `${target}:(R,W)`], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`icacls failed: ${detail}`);
    }
  } catch (err) {
    // Soft failure — token file written without restricted ACL
    console.warn('[airtable-mcp] Windows token ACL restriction failed (non-fatal):', err.message);
  }
}
```

---

### `packages/mcp-server/src/daemon/server.js` (service, request-response + event-driven)

**Port source:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/server.ts`

**What changes from the reference:**
- TypeScript → plain ESM JavaScript
- Remove all OAuth 2.1 imports and routes: `mcpAuthRouter`, `requireBearerAuth`, `PerplexityOAuthProvider`, `ConsentCoordinator`, `oauthProvider`, all `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/*` routes, `onOAuthConsentRequest`, `resolveOAuthConsent`, `listOAuthConsents`, `revokeOAuthConsents` callbacks/methods
- Remove `helmet` import and `app.use(helmet(...))` — not installed, loopback-only in Phase 5
- Remove `audit.js` (`appendAuditEntry`, `readAuditTail`, `getAuditLogPath`) — no audit module in Airtable mcp-server
- Remove `security.js` (`createSecurity`) — no security module in Airtable mcp-server
- Remove `tunnel*` callbacks from `StartDaemonServerOptions` (tunnel is Phase 7)
- Remove `computeRequestSource`, `pathIsTunnelAllowed`, `TUNNEL_ALLOWLIST` (loopback-only)
- Remove homepage/robots/favicon routes
- Replace `PerplexityClient` with `AirtableAuth` + `AirtableClient`
- Replace `registerTools`, `registerResources`, `registerPrompts` with Airtable equivalents from `index.js`
- Replace `getEnabledTools(loadToolConfig())` with `ToolConfigManager` from `tool-config.js`
- Replace `getPackageVersion()` with the `resolveServerVersion()` pattern from `index.js`
- Replace `"perplexity"` server name string with `"airtable-user-mcp"`
- Change `x-perplexity-client-id` header references to `x-airtable-client-id`
- The `requireBearer` middleware stays (simplified without `req._pplx` / `req.auth` assignment)
- `listenAvoidingBlockedPorts` and `FETCH_BLOCKED_PORTS` — copy verbatim from reference (lines 919-958)
- `getBoundPort` helper — copy verbatim (reference lines 898-904)

**Imports pattern** (Airtable-specific, not in reference):
```javascript
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { AirtableAuth } from '../auth.js';
import { AirtableClient } from '../client.js';
import { ToolConfigManager } from '../tool-config.js';
import { ensureToken, getTokenPath, rotateToken } from './token.js';
```

**requireBearer — simplified for Airtable** (reference server.ts lines 308-330, stripped of req.auth/req._pplx):
```javascript
const requireBearer = (req, res, next) => {
  const header = req.headers?.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match ? match[1] : null;
  if (provided !== currentToken.bearerToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};
```

**getClient lazy-init pattern** (reference server.ts lines 170-190, adapted for Airtable):
```javascript
const getClient = async () => {
  if (!client) {
    const auth = new AirtableAuth();
    client = new AirtableClient(auth);
  }
  if (!clientInitPromise) {
    const pending = auth.init();
    pending.catch(() => { client = undefined; clientInitPromise = null; });
    clientInitPromise = pending;
  }
  await clientInitPromise;
  return client;
};
```

**MCP endpoint handler** (reference server.ts lines 661-709, tool registration adapted):
```javascript
app.all('/mcp', requireBearer, async (req, res, next) => {
  try {
    const mcpServer = new McpServer({ name: 'airtable-user-mcp', version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Register tools via existing tool-config pattern
    const toolConfig = new ToolConfigManager();
    // ... registerTools(mcpServer, getClient, toolConfig.getEnabledTools()) ...

    await mcpServer.connect(transport);
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      activeMcpClosers.delete(cleanup);
      await mcpServer.close().catch(() => undefined);
    };
    activeMcpClosers.add(cleanup);
    res.on('close', () => void cleanup());
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    next(error);
  }
});
```

**SSE endpoint** (reference server.ts lines 528-538 — copy verbatim, strip OAuth):
```javascript
app.get('/daemon/events', requireBearer, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: daemon:ready\ndata: ${JSON.stringify(getHealth())}\n\n`);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
});
```

**shutdown/rotate-token/heartbeat** (reference server.ts lines 552-575 — copy verbatim, strip tunnel routes):
- Copy `/daemon/shutdown`, `/daemon/rotate-token`, `/daemon/heartbeat` exactly
- Omit `/daemon/enable-tunnel`, `/daemon/disable-tunnel`, all `/daemon/oauth-*` routes

**get bearerToken live getter** (reference server.ts lines 786-792 — copy verbatim):
```javascript
// In the returned server object:
get bearerToken() {
  return currentToken.bearerToken;
},
```

**listenAvoidingBlockedPorts + FETCH_BLOCKED_PORTS** — copy verbatim from reference server.ts lines 919-958. The set and function body are identical in both repos.

**Bug-3 lockfile release on Express bind failure** (reference server.ts lines 719-730 — copy verbatim, keep in caller/launcher not server):
```javascript
// In startDaemonServer, after listenAvoidingBlockedPorts throws:
try { httpServer.close(); } catch { /* ignore */ }
httpServer = undefined;
throw error;
```

---

### `packages/mcp-server/src/daemon/launcher.js` (service, event-driven + CRUD)

**Port source:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/launcher.ts`

**What changes from the reference:**
- TypeScript → plain ESM JavaScript
- Remove all tunnel-related imports and code: `getTunnelBinaryPath`, `StartedTunnel`, `TunnelState`, `getTunnelProvider`, `readTunnelSettings`, `enableTunnelRuntime`, `disableTunnelRuntime`, all `tunnelState` / `tunnelController` / `publishTunnelState` logic
- Remove Perplexity-specific imports: `PerplexityClient`, `getActiveName`, `watchActiveProfile`, `watchReinit`, `watchActiveProfile`
- Remove `enableDaemonTunnel`, `disableDaemonTunnel` exports
- Remove all OAuth functions: `listOAuthConsents`, `revokeOAuthConsent`, `revokeAllOAuthConsents`, `listOAuthClients`, `revokeOAuthClient`, `revokeAllOAuthClients`
- Replace `getConfigDir()` from `../profiles.js` with `getHomeDir()` from `../paths.js`
- Replace `getPackageVersion()` with `resolveServerVersion()` from `index.js` (or inline same pattern)
- `DaemonLockRecord` typedef: add `port_lsp`, remove `cloudflaredPid`
- `spawnDetachedDaemon`: strip `PERPLEXITY_*` env var deletes; instead delete `AIRTABLE_NO_DAEMON`, `AIRTABLE_HEADLESS_ONLY`; inject `AIRTABLE_USER_MCP_HOME`; use `resolveCliEntry()` which checks `.mjs` then `.js`
- `startDaemon`: remove `PerplexityClient` instantiation, remove tunnel startup, remove `watchReinit`/`watchActiveProfile`; the `buildRecord` and `syncLockfile` helpers stay unchanged
- `startDaemon`: the `provisional` record uses Airtable schema (add `port_lsp: null`, remove `cloudflaredPid`)

**Imports pattern** (Airtable-specific, stripped of tunnel/Perplexity deps):
```javascript
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { getHomeDir } from '../paths.js';
import { startDaemonServer } from './server.js';
import { acquire, getLockfilePath, isStale, read, release, replace } from './lockfile.js';
import { ensureToken, getTokenPath, readToken } from './token.js';
```

**getDaemonStatus** (reference launcher.ts lines 92-194 — copy verbatim, replace `getConfigDir()` → `getHomeDir()`):
```javascript
export async function getDaemonStatus(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const lockPath = getLockfilePath(configDir);
  const tokenPath = getTokenPath(configDir);
  const record = read({ lockPath });
  // ... rest identical to reference ...
}
```

**ensureDaemon** (reference launcher.ts lines 196-226 — copy verbatim):
```javascript
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
      await (options.spawnDaemon ?? spawnDetachedDaemon)({ configDir });
      launched = true;
    }
    await delay(options.pollIntervalMs ?? 200);
  }
  throw new Error(`Timed out waiting for daemon startup in ${configDir}.`);
}
```

**startDaemon — Airtable-simplified** (reference launcher.ts lines 228-539, with tunnel/watchers stripped):
```javascript
export async function startDaemon(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const lockPath = getLockfilePath(configDir);
  const tokenPath = getTokenPath(configDir);
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 200;
  const version = options.version ?? resolveServerVersion();

  for (let attempt = 0; attempt < retries; attempt++) {
    // ... same structure as reference but no tunnel, no profile watchers ...
    const provisional = {
      pid: process.pid, uuid, port: options.port ?? 0,
      port_lsp: null,   // Phase 6 will populate
      bearerToken: token.bearerToken,
      version, startedAt,
      tunnelUrl: null,  // Phase 7 will populate
    };
    if (!acquire(provisional, { lockPath })) { await delay(retryDelayMs); continue; }
    // ... server = await startDaemonServer(...) ...
    // syncLockfile, SIGINT/SIGTERM handlers, close/finalize pattern — copy verbatim
  }
}
```

**spawnDetachedDaemon — Airtable-specific env** (reference launcher.ts lines 919-949, adapted):
```javascript
async function spawnDetachedDaemon(options) {
  const cliEntry = resolveCliEntry();
  const args = [cliEntry, 'daemon', 'start'];

  const env = { ...process.env };
  delete env.AIRTABLE_NO_DAEMON;
  delete env.AIRTABLE_HEADLESS_ONLY;

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...env,
      AIRTABLE_USER_MCP_HOME: options.configDir,
    },
  });
  child.unref();
}

function resolveCliEntry() {
  // Pitfall 5: check .mjs first (bundled), then .js (source)
  const mjsPath = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  if (existsSync(mjsPath)) return mjsPath;
  return fileURLToPath(new URL('../cli.js', import.meta.url));
}
```

**stopDaemon** (reference launcher.ts lines 547-629 — copy verbatim, replace `getConfigDir()` → `getHomeDir()`).

**probeHealth** (reference launcher.ts lines 840-875, rename debug env var):
```javascript
async function probeHealth(record, options = {}) {
  if (!record.port || record.port <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/daemon/health`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${record.bearerToken}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

---

### `packages/mcp-server/src/daemon/index.js` (utility, N/A)

**Analog:** `packages/mcp-server/src/paths.js` (named export style)

**Pattern** — re-export everything from the four daemon modules:
```javascript
export * from './lockfile.js';
export * from './token.js';
export * from './server.js';
export * from './launcher.js';
```

No default export. Same style as `paths.js` which uses named exports only.

---

### `packages/mcp-server/src/index.js` — MODIFIED (service, request-response)

**Analog for new attach-proxy logic:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/attach.ts`

**Analog for existing in-process fallback:** current `packages/mcp-server/src/index.js` (lines 1-end)

**What changes:**
- The top of the file (CLI dispatch block, lines 1-8) gains the attach-proxy logic BEFORE the existing MCP server code
- The `AIRTABLE_NO_DAEMON` env var check must come first — if set, skip to existing in-process path
- The daemon attach logic replaces the function body of the `if (cliArgs.length === 0)` (implicit) path
- Existing MCP server code (from `import { Server }` onward) becomes the in-process fallback triggered by the attach proxy
- Pitfall 6: when registration.ts returns a stdio definition, it adds `AIRTABLE_NO_DAEMON: '1'` to env — so the bundled index.mjs always uses in-process path from the extension. This env check prevents the 15s poll delay.

**Attach proxy logic to prepend** (derived from attach.ts, adapted for Airtable):
```javascript
// At top of file, BEFORE existing MCP server imports:
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureDaemon } from './daemon/launcher.js';
import { read as readLockfile } from './daemon/lockfile.js';
import { getHomeDir } from './paths.js';

// AIRTABLE_NO_DAEMON bypass — must be first check
if (!process.env.AIRTABLE_NO_DAEMON) {
  const lockRecord = readLockfile({ lockPath: /* getHomeDir() + '/daemon.lock' */ });
  if (lockRecord) {
    // poll up to 15s for daemon, then bridge or fall through to in-process
    try {
      const daemon = await ensureDaemon({ configDir: getHomeDir(), startTimeoutMs: 15_000 });
      // bridge: StdioServerTransport <-> StreamableHTTPClientTransport
      const stdio = new StdioServerTransport(process.stdin, process.stdout);
      const http = new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${daemon.bearerToken}`,
            'x-airtable-client-id': `daemon-attach-${process.pid}`,
          },
        },
      });
      // wire onmessage, start, await completion — copy settle pattern from attach.ts lines 85-142
      // ... then process.exit(0)
    } catch {
      // Fallback: run in-process stdio (existing behavior below)
      process.stderr.write('[airtable-mcp] daemon unreachable; falling back to in-process stdio\n');
    }
  }
}
// Existing in-process MCP server code continues unchanged...
```

**Key difference from attach.ts:** No `fallbackStdio` option parameter — fallback is always automatic and silent (single `process.stderr.write` + continue to existing code). The `DaemonAttachError` class is not needed.

---

### `packages/extension/src/mcp/daemon-manager.ts` (service, request-response + file-I/O)

**Analog:** `packages/extension/src/mcp/auth-manager.ts`

**Pattern to copy from auth-manager.ts:**
- `vscode.Disposable` implementation shape (lines 29-43)
- `private readonly _onDidChange = new vscode.EventEmitter<T>()` pattern (line 31)
- `private _disposed = false` guard in all async methods (line 35)
- Constructor with `private readonly` params (lines 41-44)
- `dispose()` method: stop timers, dispose EventEmitter (lines 427-432)
- `_spawnScript` → replaced by `spawnDetachedDaemon` call (daemon-manager owns spawn logic differently)
- `CONFIG_DIR` constant pattern → `this.configDir` constructor param instead (D-02 says configDir is passed in)

**Imports pattern** (modeled on auth-manager.ts lines 1-10):
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { getSettings } from '../settings.js';
```

**Class shape** (from RESEARCH.md Code Examples section + auth-manager.ts class structure):
```typescript
export class DaemonManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DaemonStatus>();
  public readonly onDidChange = this._onDidChange.event;

  private _disposed = false;
  private _status: DaemonStatus = { running: false, healthy: false, pid: null, port: null, port_lsp: null, bearerToken: null, tunnelUrl: null, uptime: null };

  constructor(
    private readonly configDir: string,
    private readonly extensionPath: string,
  ) {}

  async ensureDaemon(options?: { timeoutMs?: number }): Promise<DaemonConnectionInfo> { ... }
  async stopDaemon(): Promise<void> { ... }
  async restartDaemon(): Promise<DaemonConnectionInfo> { ... }
  async getDaemonStatus(): Promise<DaemonStatus> { ... }
  async probeHealth(): Promise<boolean> { ... }
  buildDaemonEnv(credEnv?: Record<string, string>): Record<string, string> { ... }

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
  }
}
```

**buildDaemonEnv** (EXT-03 pattern from RESEARCH.md, modeled on auth-manager's `_browserEnv` + `getCredentialsEnv`):
```typescript
buildDaemonEnv(credEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    AIRTABLE_USER_MCP_HOME: this.configDir,
    AIRTABLE_HEADLESS_ONLY: '1',
    NODE_PATH: path.join(this.extensionPath, 'dist', 'node_modules'),
  };
  if (credEnv) Object.assign(env, credEnv);
  return env;
}
```

**spawnDetachedDaemon** (extension-side spawn, modeled on auth-manager's `_spawnScript` but detached):
```typescript
private async _spawnDetached(): Promise<void> {
  const serverPath = path.join(this.extensionPath, 'dist', 'mcp', 'index.mjs');
  const credEnv = await this._getCredEnv();  // caller injects via ensureDaemon options
  const child = spawn(process.execPath, [serverPath, 'daemon', 'start'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ...this.buildDaemonEnv(credEnv),
    },
  });
  child.unref();
}
```

**probeHealth** (HTTP health check, modeled on reference launcher.ts probeHealth, adapted for TypeScript):
```typescript
async probeHealth(): Promise<boolean> {
  const status = await this.getDaemonStatus();
  if (!status.running || !status.port || !status.bearerToken) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${status.port}/daemon/health`, {
      headers: { Authorization: `Bearer ${status.bearerToken}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
```

**getDaemonStatus — reads lockfile from configDir** (no external process, pure file read):
```typescript
async getDaemonStatus(): Promise<DaemonStatus> {
  try {
    const lockPath = path.join(this.configDir, 'daemon.lock');
    const raw = await fs.readFile(lockPath, 'utf8');
    const record = JSON.parse(raw);
    const healthy = await this.probeHealth();
    return { running: true, healthy, pid: record.pid, port: record.port, port_lsp: record.port_lsp ?? null, bearerToken: record.bearerToken, tunnelUrl: record.tunnelUrl ?? null, uptime: record.startedAt ? Date.now() - Date.parse(record.startedAt) : null };
  } catch {
    return { running: false, healthy: false, pid: null, port: null, port_lsp: null, bearerToken: null, tunnelUrl: null, uptime: null };
  }
}
```

**ensureDaemon — 200ms poll, 15s deadline, treatSelfAsZombie** (from RESEARCH.md Pattern 6):
```typescript
async ensureDaemon(options?: { timeoutMs?: number }): Promise<DaemonConnectionInfo> {
  if (this._disposed) throw new Error('DaemonManager disposed');
  const deadline = Date.now() + (options?.timeoutMs ?? 15_000);
  let spawned = false;
  while (Date.now() < deadline) {
    const status = await this.getDaemonStatus();
    if (status.running && status.healthy && status.port && status.bearerToken) {
      return { pid: status.pid!, uuid: '', port: status.port, url: `http://127.0.0.1:${status.port}`, bearerToken: status.bearerToken, version: '', startedAt: '' };
    }
    if (!status.running && !spawned) {
      await this._spawnDetached();
      spawned = true;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for daemon startup.');
}
```

---

### `packages/extension/src/mcp/registration.ts` — MODIFIED (provider, request-response)

**Analog:** current `packages/extension/src/mcp/registration.ts` (self-modify)

**Existing duck-type pattern to mirror** (registration.ts lines 15-22):
```typescript
// EXISTING — McpStdioServerDefinition duck-type (lines 15-22):
const ctor = (vscode as unknown as { McpStdioServerDefinition?: McpCtor }).McpStdioServerDefinition;
if (!ctor) throw new Error('McpStdioServerDefinition is not available...');
try {
  return new ctor(label, command, args, env, version);
} catch {
  return new ctor({ label, command, args, env, version });
}
```

**New HTTP duck-type to add** (D-03, same pattern as above):
```typescript
function createHttpDefinition(url: string, bearerToken: string): unknown {
  const httpCtor = (vscode as unknown as { McpHttpServerDefinition?: McpCtor }).McpHttpServerDefinition;
  if (!httpCtor) return null;
  try {
    return new httpCtor({ url, headers: { Authorization: `Bearer ${bearerToken}` } });
  } catch {
    return new httpCtor(url, { Authorization: `Bearer ${bearerToken}` });
  }
}
```

**provideMcpServerDefinitions — new branch** (D-03 decision logic):
```typescript
provideMcpServerDefinitions: async () => {
  try {
    const settings = getSettings();
    if (settings.mcp.useDaemon) {
      const status = await daemonManager.getDaemonStatus();
      if (status.healthy && status.port && status.bearerToken) {
        const def = createHttpDefinition(`http://127.0.0.1:${status.port}/mcp`, status.bearerToken);
        if (def) return [def];
      }
    }
    // Fallback: stdio (existing path)
    // Pitfall 6: inject AIRTABLE_NO_DAEMON so bundled index.mjs skips 15s poll
    const env: Record<string, string> = {
      ...existingEnvBuildingLogic,
      AIRTABLE_NO_DAEMON: '1',  // NEW — prevents 15s poll delay in stdio fallback
    };
    return [createStdioDefinition(MCP_SERVER_LABEL, 'node', [serverPath], env, version)];
  } catch (err) {
    console.error('[AirtableFormula] MCP provider error:', err);
    return [];
  }
}
```

**Signature change:** `registerMcpProvider` receives `daemonManager?: DaemonManager` as an additional parameter (after `authManager`).

---

### `packages/extension/package.json` — MODIFIED (config)

**Analog:** existing `airtableFormula.mcp.*` boolean setting blocks (package.json lines 333-504)

**Pattern to copy** (from `airtableFormula.mcp.autoConfigureOnInstall` at line 335):
```json
"airtableFormula.mcp.useDaemon": {
  "type": "boolean",
  "default": true,
  "description": "Start and use a shared daemon process for MCP server. Disable to use a direct per-session process (legacy behavior)."
}
```

Insert this after the `airtableFormula.mcp.notifyOnUpdates` block (line 348) and before the `airtableFormula.mcp.serverSource` block (line 350). This keeps all daemon-related settings at the top of the `mcp.*` group, following the pattern of grouping related settings together.

---

## Shared Patterns

### Module Export Style (mcp-server ESM JavaScript)
**Source:** `packages/mcp-server/src/paths.js` (lines 14-27), `packages/mcp-server/src/cli.js` (lines 40+)
**Apply to:** All four new `packages/mcp-server/src/daemon/*.js` files

Pattern: named `export function` / `export { ... }` style, no `module.exports`. Top-level `await` is acceptable (the package is `"type": "module"` ESM). Import paths use `.js` extension explicitly. `import ... from 'node:fs'` style with `node:` prefix for builtins.

```javascript
// Named exports only — no default export on utility modules
export function getHomeDir() { ... }
export function getLockfilePath(configDir = getHomeDir()) { ... }
```

### getHomeDir() as Config Dir
**Source:** `packages/mcp-server/src/paths.js` lines 16-18
**Apply to:** `lockfile.js`, `token.js`, `launcher.js`

```javascript
import { getHomeDir } from '../paths.js';
// All calls to getConfigDir() in Perplexity source → getHomeDir()
const configDir = options.configDir ?? getHomeDir();
```

### TypeScript Class Shape (extension)
**Source:** `packages/extension/src/mcp/auth-manager.ts` lines 29-44
**Apply to:** `packages/extension/src/mcp/daemon-manager.ts`

```typescript
export class DaemonManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DaemonStatus>();
  public readonly onDidChange = this._onDidChange.event;
  private _disposed = false;

  constructor(
    private readonly configDir: string,
    private readonly extensionPath: string,
  ) {}

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
  }
}
```

### Extension Imports (TypeScript)
**Source:** `packages/extension/src/mcp/auth-manager.ts` lines 1-10
**Apply to:** `packages/extension/src/mcp/daemon-manager.ts`

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { getSettings } from '../settings.js';
```

### Duck-Type Pattern for VS Code APIs
**Source:** `packages/extension/src/mcp/registration.ts` lines 9, 15-22
**Apply to:** `packages/extension/src/mcp/registration.ts` (new `McpHttpServerDefinition` branch)

```typescript
type McpCtor = new (...args: unknown[]) => unknown;
// Pattern: cast vscode as unknown, then as object with optional property
const ctor = (vscode as unknown as { McpStdioServerDefinition?: McpCtor }).McpStdioServerDefinition;
```

### VSCode Setting Pattern (package.json)
**Source:** `packages/extension/package.json` lines 335-339 (`airtableFormula.mcp.autoConfigureOnInstall`)
**Apply to:** New `airtableFormula.mcp.useDaemon` setting

```json
"airtableFormula.mcp.useDaemon": {
  "type": "boolean",
  "default": true,
  "description": "..."
}
```

### Error Handling in async methods (extension)
**Source:** `packages/extension/src/mcp/auth-manager.ts` lines 285-291 (checkSession catch block)
**Apply to:** `DaemonManager.ensureDaemon`, `DaemonManager.stopDaemon`, `DaemonManager.probeHealth`

```typescript
try {
  // ... operation ...
} catch (err) {
  // Return safe default / rethrow with context
  return false; // or return null status
}
```

---

## No Analog Found

No files in this phase lack an analog. All files are either direct ports from the Perplexity reference or modifications to existing files with well-understood patterns.

---

## Critical Airtable-vs-Perplexity Diff Summary

| Perplexity Reference | Airtable Port | Scope |
|----------------------|---------------|-------|
| `getConfigDir()` from `../profiles.js` | `getHomeDir()` from `../paths.js` | All 4 daemon JS files |
| `DaemonLockRecord.cloudflaredPid` | Removed | lockfile.js, launcher.js |
| `DaemonLockRecord.port_lsp` | Added (type: `number \| null`) | lockfile.js, launcher.js |
| `PerplexityClient` | `AirtableClient` + `AirtableAuth` | server.js, launcher.js |
| `PERPLEXITY_NO_DAEMON` | `AIRTABLE_NO_DAEMON` | launcher.js, index.js |
| `PERPLEXITY_HEADLESS_ONLY` | `AIRTABLE_HEADLESS_ONLY` | launcher.js |
| `PERPLEXITY_CONFIG_DIR` | `AIRTABLE_USER_MCP_HOME` | launcher.js spawnDetachedDaemon |
| `"perplexity"` MCP server name | `"airtable-user-mcp"` | server.js |
| `x-perplexity-client-id` header | `x-airtable-client-id` | server.js |
| OAuth 2.1 routes + provider | Removed entirely | server.js |
| `helmet` import | Removed (not installed) | server.js |
| `createSecurity()` middleware | Removed (not available) | server.js |
| `appendAuditEntry()` | Removed (no audit.js) | server.js |
| Tunnel routes (`/daemon/enable-tunnel` etc.) | Removed (Phase 7) | server.js, launcher.js |
| `watchReinit`, `watchActiveProfile` | Removed (no profile system) | launcher.js |
| `safeAtomicWriteFileSync` | Inline `writeFileSync` + `renameSync` | token.js |
| `restrictWindowsAcl` throws on failure | Softened to `console.warn` (Pitfall 4) | token.js |
| TypeScript (`.ts`) | Plain ESM JavaScript (`.js`) | All 4 daemon files |
| `PERPLEXITY_DEBUG` env var in probeHealth | Remove debug trace (or use `AIRTABLE_DEBUG`) | launcher.js |

---

## Metadata

**Analog search scope:** `packages/mcp-server/src/`, `packages/extension/src/mcp/`, `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/`
**Files scanned:** 12 (4 reference port sources, 4 current codebase analogs, 4 supporting files)
**Pattern extraction date:** 2026-05-14
