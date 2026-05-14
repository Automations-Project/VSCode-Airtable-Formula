# Phase 5: Daemon Core -- Research

**Researched:** 2026-05-14
**Domain:** Node.js daemon process management, MCP HTTP transport, VS Code extension lifecycle integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Entry Point Migration Strategy**
`index.js` becomes the attach proxy. It checks for a running daemon via lockfile; if healthy bridges stdio to HTTP; if not, polls 15 seconds then falls back to in-process stdio. No `--no-daemon` flag at CLI; fallback is automatic. `AIRTABLE_NO_DAEMON` env var skips daemon attach entirely.

**D-02: AuthManager vs DaemonManager -- Split Classes**
`AuthManager` stays focused on SecretStorage + login + health-check spawning. New `DaemonManager` (`src/mcp/daemon-manager.ts`) owns spawn/poll/stop/restart/lockfile/probeHealth. `AuthManager` receives `DaemonManager` via constructor injection; calls `daemonManager.ensureDaemon()` before credential hand-off when `useDaemon` is true.

**D-03: HTTP MCP Definition -- Duck-typing + Fallback**
`registration.ts` duck-types `McpHttpServerDefinition` using the same pattern as `McpStdioServerDefinition`. Returns HTTP definition only when all three conditions are met: `useDaemon` enabled AND daemon healthy AND `McpHttpServerDefinition` exists in vscode. Falls back to `McpStdioServerDefinition` otherwise.

**D-04: Daemon Opt-out -- Both VS Code Setting and Env Var**
VS Code setting `airtableFormula.mcp.useDaemon` (boolean, default true). Env var `AIRTABLE_NO_DAEMON` (any non-empty value) takes priority. Setting description: "Start and use a shared daemon process for MCP server. Disable to use a direct per-session process (legacy behavior)."

### Claude's Discretion

None specified.

### Deferred Ideas (OUT OF SCOPE)

- Daemon status indicator in VS Code status bar (Phase 8)
- `port_lsp` lockfile field population (Phase 6)
- `tunnelUrl` lockfile field population (Phase 7)
- Token rotation UI command (Phase 8)
- `--no-daemon` CLI flag as explicit argument (covered by env var)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DAEMON-01 | Existing `npx airtable-user-mcp` stdio config keeps working unchanged | D-01 attach proxy with silent in-process fallback; `AIRTABLE_NO_DAEMON` escape hatch |
| DAEMON-02 | Multiple MCP clients share one session when daemon is running | Single daemon process holds one AirtableAuth/AirtableClient; all HTTP clients share it |
| DAEMON-03 | Daemon starts automatically when VS Code extension activates | `DaemonManager.ensureDaemon()` called from `AuthManager.init()` on extension activation |
| DAEMON-04 | Daemon recovers from stale lockfile without user intervention | `isStale()` checks live pid; `tryReclaimStale()` removes dead lockfile; `ensureDaemon` retries |
| DAEMON-05 | Daemon exposes `/daemon/health` and `/daemon/events` (SSE) guarded by bearer token | Express routes with `requireBearer` middleware; SSE fan-out via `sseClients` set |
| DAEMON-06 | User can stop/restart daemon from VS Code extension Setup tab | `DaemonManager.stopDaemon()` / `restartDaemon()` exposed to extension commands |
| DAEMON-07 | Bearer token persists across daemon restarts; token rotation command available | `daemon.token` file in config dir; `rotateToken()` function; `/daemon/rotate-token` endpoint |
| EXT-01 | Extension's `McpServerDefinitionProvider` returns HTTP definition when daemon healthy, stdio otherwise | Duck-typed `McpHttpServerDefinition` check in `registration.ts` (D-03) |
| EXT-02 | `auth-manager.ts` extended to spawn/monitor daemon instead of direct MCP process | Constructor injection of `DaemonManager`; `ensureDaemon()` call before credential hand-off |
| EXT-03 | Extension passes auth env vars (bearer token, config dir) to daemon via `buildDaemonEnv` pattern | `buildDaemonEnv()` helper on `DaemonManager`; passes `AIRTABLE_*` vars to spawned daemon |
</phase_requirements>

---

## Summary

Phase 5 ports four daemon files from the VSCode-Perplexity-MCP reference implementation and wires them into the Airtable mcp-server and VS Code extension. The reference implementation is fully read and well-understood -- the port is primarily a search-and-replace of Perplexity-specific identifiers plus Airtable-specific schema changes (add `port_lsp`, drop `cloudflaredPid`, use `getHomeDir()` from `paths.js`).

The MCP SDK at version 1.29.0 in this workspace bundles Express 5.2.1, `express-rate-limit`, and `cors` as its own dependencies. The `StreamableHTTPServerTransport` and `StreamableHTTPClientTransport` are available via `@modelcontextprotocol/sdk/server/streamableHttp.js` and `@modelcontextprotocol/sdk/client/streamableHttp.js`. The Perplexity server.ts uses a large number of OAuth 2.1 features that are out-of-scope for Airtable; the Airtable port strips these entirely, keeping only the bearer-auth + SSE + health + MCP endpoint surface.

The mcp-server package uses plain JavaScript (`.js`, no TypeScript build). The daemon files in the port source are TypeScript. The Airtable daemon files should be written as plain `.js` (ESM) to stay consistent with the existing package, with JSDoc types for clarity. No new TypeScript build step is needed for mcp-server.

**Primary recommendation:** Port daemon files as ESM JavaScript (`.js`) inside `packages/mcp-server/src/daemon/`, update `index.js` to become the attach proxy, add `DaemonManager` class to the extension, duck-type HTTP definition in registration.ts, and add the `useDaemon` setting to package.json.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lockfile acquire/release/stale | MCP Server (daemon process) | -- | Daemon owns its own lockfile lifecycle; no VS Code involvement needed |
| Daemon HTTP server (MCP + health + SSE) | MCP Server (daemon process) | -- | Runs as a detached Node child process, not inside VS Code |
| Stdio-to-HTTP bridge (attach proxy) | MCP Server (index.js) | -- | The stdin/stdout proxy that existing MCP clients talk to |
| Daemon spawn + lifecycle management | VS Code Extension (DaemonManager) | -- | Only VS Code knows when to start/stop; daemon is extension-managed |
| Bearer token persistence | MCP Server (daemon.token file) | VS Code Extension (reads it) | Token file lives in config dir, extension reads via lockfile record |
| MCP registration (HTTP vs stdio fallback) | VS Code Extension (registration.ts) | -- | Extension decides which transport definition to return |
| Auth credential forwarding to daemon | VS Code Extension (DaemonManager.buildDaemonEnv) | -- | SecretStorage lives in extension; passed as env vars to daemon spawn |
| Session health / login flows | VS Code Extension (AuthManager) | -- | Unchanged responsibility; AuthManager delegates daemon start to DaemonManager |

---

## Standard Stack

### Core (VERIFIED: workspace node_modules)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | `StreamableHTTPServerTransport`, `StreamableHTTPClientTransport`, `StdioServerTransport`, `McpServer` | Already in workspace; bundles all needed transport classes |
| `express` | 5.2.1 | HTTP server framework for daemon | Bundled by SDK itself -- no separate install needed |
| `node:crypto` | built-in | `randomUUID()`, `randomBytes()` for bearer token generation | Built-in; no install needed |
| `node:child_process` | built-in | `spawn()` with `detached: true` for daemon process | Built-in |
| `node:fs` | built-in | Lockfile operations (`openSync`, `writeFileSync`, `renameSync`, `rmSync`) | Built-in |

### Supporting (ASSUMED)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:timers/promises` | built-in | `setTimeout as delay` for polling loops | Already in Node 20+ |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `express` (SDK-bundled) | `@hono/node-server` (also SDK-bundled) | Perplexity uses Express; simpler to port directly; Hono is available but would require rewriting all route handlers |
| `daemon.token` separate file | Bearer token embedded in lockfile only | Token file separates rotation concern from lockfile; if lockfile is replaced by new daemon, token survives and lockfile heals (this is the Perplexity pattern; keep it) |
| TypeScript daemon files | Plain JS daemon files | Existing mcp-server has no TypeScript build; JS is consistent with the rest of the package; JSDoc for types is sufficient |
| `helmet` for security headers | Omit | Not installed; loopback-only in Phase 5 (no tunnel until Phase 7); safe to omit |

**Installation:** No new npm packages required. The MCP SDK (already installed) bundles Express. Node built-ins cover crypto, fs, child_process, and timers.

---

## Architecture Patterns

### System Architecture Diagram

```
npx airtable-user-mcp / MCP client (stdio)
    |
    v
index.js (attach proxy -- D-01)
    | AIRTABLE_NO_DAEMON set?
    |--- YES --> run in-process MCP server (old behavior, unchanged)
    |
    | read daemon.lock -> port + bearerToken
    | if no lock OR unhealthy: poll 15s
    |     +- if still unreachable: run in-process fallback
    |
    v
StreamableHTTPClientTransport -------------------------------------------->+
    | (bridges stdio <-> HTTP)                                             |
    |                                                                      |
    |                                               daemon process         |
    |                                               (detached, spawned by  |
    |                                                VS Code extension)    |
    |                                               daemon/server.js       |
    |                                                      |               |
    |                                               Express HTTP server    |
    |                                               +-- POST /mcp          |
    |                                               |   StreamableHTTP     |
    |                                               |   ServerTransport    |
    |                                               |   -> AirtableAuth +  |
    |                                               |      AirtableClient  |
    |                                               +-- GET /daemon/health |
    |                                               +-- GET /daemon/events |
    |                                               +-- POST /daemon/      |
    |                                                   shutdown           |
    |                                               +-- POST /daemon/      |
    |                                                   rotate-token       |
    |                                                                      |
    +-------------------------- HTTP bearer auth <--------------------------+

VS Code Extension (extension.ts)
    |
    +-- AuthManager.init()
    |       +- DaemonManager.ensureDaemon() --> spawnDetachedDaemon()
    |                   |                       +- spawn node index.js daemon start
    |                   |                          (detached, stdio: ignore)
    |                   +- poll 200ms until /daemon/health responds OK
    |
    +-- registration.ts (provideMcpServerDefinitions)
    |       +-- useDaemon enabled?
    |       +-- daemonManager.probeHealth() returns ok?
    |       +-- (vscode as any).McpHttpServerDefinition exists?
    |               +-- YES: return McpHttpServerDefinition(url, bearer header)
    |               +-- NO:  return McpStdioServerDefinition (existing behavior)
    |
    +-- Commands: stopDaemon / restartDaemon -> DaemonManager
```

### Recommended Project Structure

```
packages/mcp-server/src/
+-- daemon/
|   +-- lockfile.js     # acquire/release/replace/isStale (ported from reference)
|   +-- token.js        # ensureToken/readToken/rotateToken (ported from reference)
|   +-- server.js       # Express + StreamableHTTPServerTransport (ported, OAuth stripped)
|   +-- launcher.js     # ensureDaemon/startDaemon/stopDaemon/spawnDetachedDaemon (ported)
|   +-- index.js        # re-exports for clean import surface
+-- index.js            # MODIFIED: becomes attach proxy (D-01)
+-- cli.js              # MODIFIED: add 'daemon start' subcommand
+-- paths.js            # unchanged -- getHomeDir() is already the config dir source

packages/extension/src/mcp/
+-- daemon-manager.ts   # NEW: DaemonManager class (D-02)
+-- auth-manager.ts     # MODIFIED: inject DaemonManager, call ensureDaemon
+-- registration.ts     # MODIFIED: duck-type McpHttpServerDefinition (D-03)
```

### Pattern 1: Lockfile Atomic Acquire

**What:** Uses `openSync(path, "wx")` to atomically create the lockfile. If `EEXIST`, attempts to reclaim if stale (dead PID) before returning false. Capped at one retry to avoid infinite loops.

**When to use:** Daemon startup, before any HTTP server is bound.

**Key logic (from reference lockfile.ts, verified):**
- `openSync(lockPath, "wx")` -- exclusive create; throws EEXIST if lockfile already exists
- On EEXIST: call `tryReclaimStale(lockPath)` which checks if the existing lockfile's PID is dead
- If stale: `rmSync(lockPath, { force: true })` then continue loop
- If live: return false (another daemon is running; attach to it)
- Cap at 2 attempts total to prevent infinite loops on races

**Airtable change from reference:** Replace `getConfigDir()` (Perplexity profiles system) with `getHomeDir()` from `paths.js`.

### Pattern 2: Bearer Token Persistence (separate from lockfile)

**What:** Token is stored in `daemon.token` (separate from `daemon.lock`). This survives daemon restarts -- when a new daemon starts, it reads the existing token file so clients using the old lockfile's bearer can still authenticate after the lockfile is replaced.

**Critical:** `ensureToken()` reads existing token if present; only generates a new one on first run. `rotateToken()` bumps version and writes a new random token using `randomBytes(32).toString('base64url')`.

**Token file schema:**
```
{
  "bearerToken": "<32-byte base64url>",
  "version": 1,
  "createdAt": "<ISO 8601>",
  "rotatedAt": "<ISO 8601>"
}
```

**Windows note:** Token file permissions use `icacls` on Windows to restrict ACL to the current user only. On Unix, `chmod 600`. The Airtable port should wrap Windows ACL in try/catch (see Pitfall 4).

### Pattern 3: Detached Daemon Spawn

**What:** The extension calls `spawnDetachedDaemon()` which spawns `node index.js daemon start` with `detached: true, stdio: 'ignore'` then immediately calls `child.unref()`. The daemon process becomes independent of the parent.

**Airtable adaptation:**
- The CLI entry `index.js` needs a new `daemon start` subcommand in `cli.js` that calls `startDaemon()`
- The spawner must strip `AIRTABLE_NO_DAEMON` from the inherited env
- The spawner injects `AIRTABLE_USER_MCP_HOME` as the config dir

**Spawn env handling:**
```javascript
// Source: reference launcher.ts (verified, read directly) -- adapted for Airtable
const env = { ...process.env };
delete env.AIRTABLE_NO_DAEMON;
delete env.AIRTABLE_HEADLESS_ONLY;
// spawn with env: { ...env, AIRTABLE_USER_MCP_HOME: configDir }
```

### Pattern 4: Attach Proxy in index.js

**What:** `index.js` is modified so that before starting in-process MCP, it checks `AIRTABLE_NO_DAEMON`, reads lockfile, probes health, and if daemon is healthy creates a stdio-HTTP bridge.

**Bridge mechanism:**
- `StdioServerTransport` (from `@modelcontextprotocol/sdk/server/stdio.js`) -- talks to the MCP CLIENT via the process's stdin/stdout
- `StreamableHTTPClientTransport` (from `@modelcontextprotocol/sdk/client/streamableHttp.js`) -- talks to the daemon HTTP SERVER
- Wiring: `stdio.onmessage = msg => http.send(msg)` and `http.onmessage = msg => stdio.send(msg)`
- Both transports started with `Promise.all([stdio.start(), http.start()])`
- On either transport closing: close both

**Critical naming note:** The "Server" and "Client" suffixes in transport names refer to the MCP protocol role, not the HTTP role. `StdioServerTransport` is for processes that serve MCP over stdio; `StreamableHTTPClientTransport` is for processes that consume MCP over HTTP. The attach proxy is an MCP server (to the stdio client) that is also an HTTP client (to the daemon).

### Pattern 5: McpHttpServerDefinition Duck-typing

**What:** VS Code's `McpHttpServerDefinition` may not exist in all builds. Same duck-typing pattern as `McpStdioServerDefinition` used today.

**Existing pattern in registration.ts (verified):**
```typescript
const ctor = (vscode as unknown as { McpStdioServerDefinition?: McpCtor }).McpStdioServerDefinition;
```

**HTTP definition pattern to apply:**
```typescript
const httpCtor = (vscode as unknown as { McpHttpServerDefinition?: McpCtor }).McpHttpServerDefinition;
if (httpCtor && useDaemon && daemonHealthy) {
  // Constructor shape is [ASSUMED] -- see Open Questions
  return [new httpCtor({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } })];
}
// else fall through to McpStdioServerDefinition
```

### Pattern 6: ensureDaemon Poll Loop

**What:** Extension calls `ensureDaemon()` which polls every 200ms up to 15s deadline. On first check if daemon is not running, spawns it (once). Returns `DaemonConnectionInfo` on success, throws on timeout.

**Airtable-specific:** Pass `treatSelfAsZombie: true` when calling `getDaemonStatus()` from within the extension host, so any lockfile with `pid === process.pid` (zombie from prior activation) is reclaimed automatically.

### Anti-Patterns to Avoid

- **Never use `.exec()` in while/poll loops for regex** -- project security rule. Use `text.matchAll(pattern)` with `for...of`.
- **Never import `helmet`** -- not installed; daemon is loopback-only in Phase 5.
- **Never loop the lockfile acquire indefinitely** -- capped at 2 attempts with explicit stale reclaim; always return false cleanly.
- **Never use `process.kill(pid, 0)` without checking EPERM** -- EPERM means the process IS alive (owned by another user); only ESRCH means dead. Reference `isProcessAlive()` handles this correctly.
- **Never let startDaemonServer throw without releasing the lockfile** -- Bug-3 from reference: if Express fails to bind, lockfile must be released in the catch block before re-throwing.
- **Never snapshot bearerToken** in the server return value -- use a getter (`get bearerToken()`) so token rotation is reflected live after `rotateToken()` calls.
- **Never skip the FETCH_BLOCKED_PORTS retry logic** -- OS occasionally assigns blocked ephemeral ports (6666, 10080, etc.); use `listenAvoidingBlockedPorts()` helper from reference.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP transport for MCP | Custom JSON-RPC over HTTP | `StreamableHTTPServerTransport` + `StreamableHTTPClientTransport` from SDK 1.29.0 | SDK handles session management, content-type negotiation, and MCP framing |
| Stdio proxy bridge | Custom pipe-based bridge | `StdioServerTransport` + `StreamableHTTPClientTransport` message handler pairing | Already tested in Perplexity reference; transports handle partial message buffering |
| Bearer token generation | Custom UUID or hash | `randomBytes(32).toString('base64url')` | Cryptographically secure, URL-safe, no dependencies |
| Blocked port detection | Manual port testing | `FETCH_BLOCKED_PORTS` set (spec-defined list) | Missing any entry causes silent attach failures |
| Lockfile atomic create | `writeFileSync` with existence check then write | `openSync(path, "wx")` | Atomic; eliminates TOCTOU race between existence check and write |

**Key insight:** The transport layer complexity is entirely handled by the MCP SDK. Custom transport code would reintroduce all the session management edge cases the SDK already solves.

---

## Runtime State Inventory

> Omitted -- this is a greenfield feature phase, not a rename/refactor phase.

---

## Common Pitfalls

### Pitfall 1: Daemon Token vs Lockfile Bearer Token Drift

**What goes wrong:** After `rotateToken()`, the lockfile still has the old bearer token. Extension or attach proxy reads old token from lockfile, gets 401 from daemon.

**Why it happens:** Token rotation writes `daemon.token` file but doesn't automatically rewrite the lockfile. The lockfile `bearerToken` field drifts.

**How to avoid:** `startDaemon` calls `syncLockfile(server.bearerToken)` in the `onTokenRotated` callback. The `getDaemonStatus` function also falls back to reading `daemon.token` directly if the lockfile bearer returns 401, and heals the lockfile.

**Warning signs:** `probeHealth()` returns null despite the daemon running; health endpoint returns 401.

### Pitfall 2: Zombie Daemon from Prior Extension Activation

**What goes wrong:** Extension activates, then the daemon runs inside the extension host process (process.pid matches lockfile pid). Next activation finds a "healthy" lockfile but no separate daemon process.

**Why it happens:** If `startDaemon()` is called in-process (misconfigured launcher or test mode), `process.pid` matches the lockfile PID.

**How to avoid:** Pass `treatSelfAsZombie: true` to `getDaemonStatus()` when called from the extension host. This causes any lockfile with `pid === process.pid` to be treated as stale and reclaimed.

**Warning signs:** Extension activates but VS Code MCP client shows connecting to itself; no detached process visible in Task Manager.

### Pitfall 3: Port 0 Assigns a WHATWG Fetch Blocked Port

**What goes wrong:** `httpServer.listen(0)` gets an ephemeral port like 6666 or 10080. Every `fetch()` call to the daemon URL then throws `TypeError: bad port`. Health probes return null.

**Why it happens:** WHATWG fetch spec explicitly blocks certain port numbers for security reasons.

**How to avoid:** Use `listenAvoidingBlockedPorts()` helper from reference -- retries up to 5 times if port 0 assigns a blocked port. Final attempt returns the blocked port anyway so callers see a real error.

**Warning signs:** `ensureDaemon` times out; daemon process is alive but health probe always returns null.

### Pitfall 4: Windows `icacls` ACL Restriction Failure on Token File

**What goes wrong:** On Windows, writing `daemon.token` with restricted permissions calls `icacls` which fails in some environments (CI, Docker, enterprise).

**Why it happens:** `USERNAME` or `USERDOMAIN` env vars may be missing or malformed.

**How to avoid:** Wrap `applyPrivatePermissions()` in try/catch; log failure as warning but do not throw. The token file is still written; just without restricted permissions. The reference implementation throws -- the Airtable port should soften to a warning.

**Warning signs:** Token file creation fails on Windows; daemon fails to start.

### Pitfall 5: resolveCliEntry Path Wrong in Bundle vs Source

**What goes wrong:** `resolveCliEntry()` looks for `cli.mjs` (compiled TypeScript), but in Airtable the mcp-server uses source `cli.js` (not `cli.mjs`) when run directly.

**Why it happens:** The Perplexity project builds TypeScript to `.mjs`. Airtable mcp-server uses source `.js` files directly. When bundled by esbuild into the extension, all files become `.mjs`.

**How to avoid:** Implement `resolveCliEntry()` to check for `.mjs` first (bundled path used in extension), then fall back to `.js` (source path used in npx/dev). Reference already uses this pattern.

### Pitfall 6: Bundled index.mjs Polls 15s Before Falling Back (Unnecessary Delay)

**What goes wrong:** When the extension falls back to `McpStdioServerDefinition` (daemon not healthy), it runs the bundled `index.mjs`. That file now has attach proxy logic that polls 15s before falling back to in-process stdio.

**Why it happens:** The entire `index.js` is now the attach proxy; the old in-process behavior is the fallback.

**How to avoid:** In `registration.ts`, when building the stdio fallback definition env, add `AIRTABLE_NO_DAEMON: '1'`. This makes the bundled `index.mjs` skip the attach-proxy logic entirely and run in-process immediately.

### Pitfall 7: AirtableClient / AirtableAuth as Long-Lived Singletons

**What goes wrong:** `AirtableAuth` and `AirtableClient` in the existing mcp-server were designed for per-invocation use. As daemon singletons they may accumulate state, leak Chromium pages, or handle concurrent requests unsafely.

**Why it happens:** The existing code has not been tested as a long-lived singleton.

**How to avoid:** For Phase 5, accept this risk since the daemon is single-tenant (loopback only). Add a note to the Phase 5 verification plan to test concurrent tool calls. Phase 5 does not need to solve this perfectly -- Phase 6/7 will surface issues if any exist.

---

## Code Examples

### Daemon Lock Record Schema (Airtable-specific)

```javascript
// Source: CONTEXT.md (locked decision -- finalized lockfile schema)
// Differences from Perplexity: adds port_lsp, drops cloudflaredPid
const lockRecord = {
  pid: process.pid,               // number -- running process PID
  uuid: randomUUID(),             // string -- stable identifier for this daemon instance
  port: 0,                        // number -- HTTP port (0 initially, updated after bind)
  port_lsp: null,                 // number|null -- LSP TCP port (null until Phase 6)
  bearerToken: token,             // string -- from daemon.token file
  version: PKG_VERSION,           // string -- mcp-server package version
  startedAt: new Date().toISOString(),  // ISO 8601
  tunnelUrl: null,                // string|null -- null until Phase 7
};
```

### Extension DaemonManager Interface (TypeScript)

```typescript
// Source: derived from CONTEXT.md D-02 + reference launcher.ts (verified, read directly)
export interface DaemonStatus {
  running: boolean;
  healthy: boolean;
  pid: number | null;
  port: number | null;
  port_lsp: number | null;
  bearerToken: string | null;
  tunnelUrl: string | null;
  uptime: number | null;  // ms since startedAt
}

export interface DaemonConnectionInfo {
  pid: number;
  uuid: string;
  port: number;
  url: string;           // http://127.0.0.1:{port}
  bearerToken: string;
  version: string;
  startedAt: string;
}

export class DaemonManager implements vscode.Disposable {
  constructor(
    private readonly configDir: string,
    private readonly extensionPath: string,
  ) {}

  ensureDaemon(options?: { timeoutMs?: number }): Promise<DaemonConnectionInfo>
  stopDaemon(): Promise<void>
  restartDaemon(): Promise<DaemonConnectionInfo>
  getDaemonStatus(): Promise<DaemonStatus>
  probeHealth(): Promise<boolean>
  buildDaemonEnv(credEnv?: Record<string, string>): Record<string, string>
  dispose(): void
}
```

### buildDaemonEnv Pattern (EXT-03)

```typescript
// Source: derived from CONTEXT.md EXT-03 and reference spawnDetachedDaemon (verified)
// AIRTABLE_* vars passed; never PERPLEXITY_*
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

### requireBearer Middleware Pattern (daemon/server.js)

```javascript
// Source: reference server.ts (verified, read directly) -- simplified for Airtable (no OAuth)
// Note: Bearer token is read from the live `currentToken` variable, not a snapshot,
// so token rotation is reflected immediately without restarting middleware.
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

### SSE Events Endpoint (daemon/server.js)

```javascript
// Source: reference server.ts (verified, read directly)
// Stripped of tunnel/OAuth concerns for Phase 5
const sseClients = new Set();

const publishEvent = (event, payload) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of sseClients) {
    response.write(frame);
  }
};

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

### listenAvoidingBlockedPorts Helper

```javascript
// Source: reference server.ts (verified, read directly)
// WHATWG fetch blocks these ports -- OS occasionally assigns them as ephemeral ports
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

async function listenAvoidingBlockedPorts(server, requestedPort, host) {
  const maxAttempts = requestedPort === 0 ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve, reject) => {
      server.once('error', err => { server.removeAllListeners('listening'); reject(err); });
      server.once('listening', () => { server.removeAllListeners('error'); resolve(); });
      server.listen(requestedPort, host);
    });
    const addr = server.address();
    const boundPort = addr.port;
    if (!FETCH_BLOCKED_PORTS.has(boundPort)) return;
    // Retry on blocked port
    await new Promise(resolve => server.close(() => resolve()));
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Server` from `sdk/server/index.js` | `McpServer` from `sdk/server/mcp.js` | SDK 1.x | `McpServer` is the higher-level builder API. Reference uses `McpServer`. Airtable mcp-server currently uses `Server` directly. The daemon can use either; `McpServer` is preferred for parity with reference. |
| Stdio-only MCP transport | `StreamableHTTPServerTransport` for HTTP | SDK 1.x | Enables multi-client session sharing |
| Direct process per MCP client | Shared daemon with HTTP transport | This phase | Single Chromium session, faster auth, reduced memory |
| `SSEServerTransport` | `StreamableHTTPServerTransport` | SDK 1.x | SSE transport deprecated; Streamable HTTP is current standard |

**Deprecated/outdated:**
- `SSEServerTransport` -- use `StreamableHTTPServerTransport` instead. [CITED: SDK 1.29.0 server/ directory -- SSE still present but Streamable HTTP is the current pattern in reference implementation]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `McpHttpServerDefinition` constructor takes `{ url, headers }` object shape in VS Code 1.100 | Code Examples, Pattern 5 | If constructor takes positional args or different key names, duck-type call in registration.ts will throw silently and fall back to stdio |
| A2 | `McpHttpServerDefinition` exists as a named export in VS Code 1.100 API | Standard Stack, EXT-01 | If not yet shipped, HTTP definition always falls back to stdio -- safe but daemon won't be used by VS Code; user must wait for VS Code update |
| A3 | The existing `AirtableAuth` + `AirtableClient` classes work correctly as long-lived singletons inside a daemon process | Architecture | Chromium profile locking and session state may surface edge cases as singletons; accepted risk for Phase 5 |
| A4 | Express 5.2.1 (SDK-bundled) is compatible with the route/middleware patterns from the reference (which used Express 5 as well) | Standard Stack | Reference project uses the same SDK version (1.29.0) so Express version should match |

---

## Open Questions

1. **McpHttpServerDefinition VS Code API signature**
   - What we know: VS Code 1.100 is the minimum engine. The existing code duck-types `McpStdioServerDefinition`. A companion HTTP definition is expected.
   - What's unclear: Exact constructor signature (positional args vs object literal; exact property names for URL and headers; whether `version` is also required).
   - Recommendation: Planner should include a Wave 0 task to check VS Code 1.100 release notes or `@types/vscode` for `McpHttpServerDefinition`. If absent, the duck-type check returns false and falls back to stdio safely -- no blocking issue.

2. **AirtableAuth singleton safety in long-lived daemon**
   - What we know: `AirtableAuth` uses patchright with a persistent profile. Current code creates a new instance per invocation.
   - What's unclear: Concurrent tool call safety when held as a singleton.
   - Recommendation: Accept risk for Phase 5 (single-tenant loopback only). Document in verification plan.

3. **bundle-mcp.mjs update for daemon start entry point**
   - What we know: `bundle-mcp.mjs` bundles `index.js`, `login-runner.js`, `health-check.js`, `manual-login-runner.js`. The daemon needs to spawn `node dist/mcp/index.mjs daemon start`.
   - What's unclear: Whether a separate daemon entry point bundle is needed, or whether `index.mjs` itself handles `daemon start` via the cli.js subcommand path.
   - Recommendation: No new bundle entry needed -- `daemon start` is handled by cli.js (already bundled into index.mjs). `spawnDetachedDaemon` in the extension's `DaemonManager` calls `node dist/mcp/index.mjs daemon start`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@modelcontextprotocol/sdk` | All daemon transport | YES | 1.29.0 | -- |
| `express` (via SDK bundled dep) | daemon/server.js | YES | 5.2.1 | -- |
| `node:crypto` (randomUUID, randomBytes) | daemon/token.js | YES | Node 20 built-in | -- |
| `node:child_process` (spawn) | daemon/launcher.js | YES | Node 20 built-in | -- |
| `node:fs` (openSync wx mode) | daemon/lockfile.js | YES | Node 20 built-in | -- |
| `node:timers/promises` (delay) | daemon/launcher.js | YES | Node 20 built-in | -- |
| `helmet` | (optional security headers) | NO | -- | Omit -- loopback-only in Phase 5, no tunnel |
| VS Code `McpHttpServerDefinition` | registration.ts | UNKNOWN | -- | Falls back to stdio (safe, non-blocking) |

**Missing dependencies with no fallback:** None -- all required dependencies are available in the workspace.

**Missing dependencies with fallback:**
- `helmet` -- not installed. Omit from daemon/server.js entirely (loopback HTTP only in Phase 5).
- `McpHttpServerDefinition` -- if absent, duck-type check returns false and stdio fallback is used. Daemon starts and serves correctly; VS Code just uses stdio to connect.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` (mcp-server unit tests), `vitest` (extension) |
| Config file | `packages/mcp-server/package.json` scripts.test: `node --test "test/*.test.js"` |
| Quick run command | `pnpm -F airtable-user-mcp test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DAEMON-01 | `AIRTABLE_NO_DAEMON` bypasses daemon and runs in-process | unit | `node --test packages/mcp-server/test/test-daemon-attach.test.js` | NO -- Wave 0 |
| DAEMON-04 | Stale lockfile (dead PID) is reclaimed automatically | unit | `node --test packages/mcp-server/test/test-lockfile.test.js` | NO -- Wave 0 |
| DAEMON-05 | `/daemon/health` requires bearer auth; returns health JSON | unit | `node --test packages/mcp-server/test/test-daemon-server.test.js` | NO -- Wave 0 |
| DAEMON-07 | Bearer token persists in daemon.token; rotation writes new token | unit | `node --test packages/mcp-server/test/test-token.test.js` | NO -- Wave 0 |
| EXT-01 | registration.ts returns HTTP definition when `McpHttpServerDefinition` exists and daemon healthy | unit | `pnpm -F airtable-formula vitest run -t "daemon HTTP definition"` | NO -- Wave 0 |
| EXT-03 | `buildDaemonEnv` includes `AIRTABLE_USER_MCP_HOME` and auth vars | unit | `pnpm -F airtable-formula vitest run -t "buildDaemonEnv"` | NO -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm -F airtable-user-mcp test` (mcp-server unit tests, <30s)
- **Per wave merge:** `pnpm test` (full monorepo suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/mcp-server/test/test-lockfile.test.js` -- covers DAEMON-04 (stale reclaim, atomic acquire)
- [ ] `packages/mcp-server/test/test-token.test.js` -- covers DAEMON-07 (ensureToken, rotateToken)
- [ ] `packages/mcp-server/test/test-daemon-server.test.js` -- covers DAEMON-05 (bearer auth, health endpoint, SSE)
- [ ] `packages/mcp-server/test/test-daemon-attach.test.js` -- covers DAEMON-01 (AIRTABLE_NO_DAEMON bypass, in-process fallback)
- [ ] `packages/extension/src/test/daemon-manager.test.ts` -- covers EXT-01, EXT-03 (buildDaemonEnv, probeHealth mock, duck-type HTTP definition)

---

## Security Domain

> Applicable -- daemon exposes HTTP endpoints with bearer auth.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer token in `Authorization: Bearer` header; `requireBearer` middleware; 401 on mismatch |
| V3 Session Management | no | No web sessions; token-per-daemon not per-client-session |
| V4 Access Control | yes | All `/daemon/*` endpoints require bearer; MCP endpoint requires bearer |
| V5 Input Validation | yes | Lockfile schema validated via `normalizeRecord()`; request bodies typed |
| V6 Cryptography | yes | `randomBytes(32).toString('base64url')` for token generation -- never hand-rolled |

### Known Threat Patterns for Loopback HTTP Daemon

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Other local processes reading `daemon.token` | Information Disclosure | File permissions: `chmod 600` on Unix; `icacls` user-only restriction on Windows (wrapped in try/catch) |
| Localhost port scanning to discover daemon | Information Disclosure | Lockfile holds port; no unauthenticated info disclosure on health endpoint (returns 401 without bearer) |
| Stale lockfile prevents daemon from starting | Denial of Service | `tryReclaimStale()` auto-reclaim; `treatSelfAsZombie` option for extension host |
| Bearer token logged in extension output | Information Disclosure | Bearer token must never appear in console.log/error calls -- only log `port` and `pid` from lockfile |
| WHATWG blocked port makes daemon unreachable | Denial of Service | `listenAvoidingBlockedPorts()` retries up to 5 times on port 0 |
| Force-kill leaves stale lockfile | Denial of Service | `isStale()` checks PID liveness via `process.kill(pid, 0)` before trusting any lockfile |

> Note: OAuth 2.1, tunnel allowlists, and per-source rate limiting from the Perplexity reference are explicitly out of scope for Phase 5. No tunnel until Phase 7, no OAuth per REQUIREMENTS.md.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 5 |
|-----------|-------------------|
| Security hook: never use `.exec()` in regex while loops | All regex in daemon files use `text.matchAll(pattern)` with `for...of` |
| GPG signing fails: use `git -c commit.gpgsign=false commit` | Planner must specify this flag for all commit steps |
| `pnpm check:tool-sync` must pass before committing | No tool-category changes in Phase 5; sync check passes trivially |
| Extension is CJS bundle via tsup; mcp-server is ESM | Daemon files in mcp-server use `import`/`export` (ESM); extension daemon-manager.ts uses TypeScript via tsup (CJS) |
| `src/vendor/` is copied post-build | No impact on daemon files |
| `bundle-mcp.mjs` bundles from `airtable-user-mcp` workspace | `daemon start` CLI subcommand flows through `cli.js` which is already bundled into `index.mjs`; no new esbuild entry point needed |
| `pnpm packx` runs full build + version bump + package | Ensure daemon files are included in `files` array of `packages/mcp-server/package.json` (`src/**/*.js` glob already covers them) |

---

## Sources

### Primary (HIGH confidence)
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\lockfile.ts` -- read directly
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\launcher.ts` -- read directly
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\server.ts` -- read directly
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\attach.ts` -- read directly
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\token.ts` -- read directly
- `packages/mcp-server/src/paths.js` -- read directly; confirms `getHomeDir()` as config dir source
- `packages/extension/src/mcp/registration.ts` -- read directly; existing duck-type pattern verified
- `packages/extension/src/mcp/auth-manager.ts` -- read directly; constructor injection target understood
- `packages/mcp-server/src/index.js` -- read directly; current entry point structure confirmed
- `packages/mcp-server/src/cli.js` -- read directly; existing subcommand structure confirmed
- `scripts/bundle-mcp.mjs` -- read directly; bundle pipeline understood
- `node_modules/@modelcontextprotocol/sdk/package.json` -- version 1.29.0 confirmed; Express 5.2.1 bundled dependency confirmed

### Secondary (MEDIUM confidence)
- `packages/mcp-server/package.json` -- no devDependencies, no TypeScript build step; confirms plain JS approach
- `packages/extension/tsconfig.json` -- confirms TypeScript + tsup for extension src/
- `packages/extension/package.json` -- existing MCP settings keys; `useDaemon` not present yet

### Tertiary (LOW confidence)
- VS Code `McpHttpServerDefinition` API shape -- not verified against VS Code 1.100 official API docs; marked as A1, A2 in assumptions log

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- directly verified via workspace node_modules
- Architecture: HIGH -- reference implementation read in full; port strategy is clear and well-bounded
- Pitfalls: HIGH -- extracted from Bug-N annotations in reference source code (read directly)
- McpHttpServerDefinition API: LOW -- not verified against VS Code 1.100 release notes

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (SDK and VS Code API stable; 30-day horizon reasonable)
