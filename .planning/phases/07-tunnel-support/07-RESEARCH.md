# Phase 7: Tunnel Support - Research

**Researched:** 2026-05-15
**Domain:** Daemon tunnel lifecycle, cloudflared/ngrok providers, VS Code webview state
**Confidence:** HIGH (all findings verified against source files read in this session)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship all three providers: `cf-quick` (cloudflared Quick Tunnel), `ngrok` (@ngrok/ngrok NAPI, lazy-loaded), `cf-named` (cloudflared Named Tunnel). All ported from Perplexity with Airtable renames.
- **D-02:** ngrok authtoken stored in VS Code SecretStorage (key `airtable-formula.ngrok.authtoken`). Extension reads from SecretStorage and injects into `POST /daemon/enable-tunnel` body. Daemon never writes authtoken to disk.
- **D-03:** Tunnel persistence in `~/.airtable-user-mcp/tunnel-settings.json` with schema `{ enabled: boolean, provider: "cf-quick"|"ngrok"|"cf-named", ngrokDomain: string|null }`. Single source of truth (works without VS Code open).
- **D-04:** Auto-start on daemon startup if `enabled: true` and provider is configured. On failure/crash: write `enabled: false` to settings file, clear `tunnelUrl` in lockfile. No auto-restart backoff — stays disabled until user re-enables.
- **D-05:** Add `airtableFormula.tunnel.disable` command to `packages/extension/package.json`. Calls `POST /daemon/disable-tunnel`. Enable is Setup tab button only.
- **D-06:** 401-burst auto-disable: `BURST_FAILURE_COUNT = 10`, `BURST_WINDOW_MS = 60_000`. Hardcoded constants. Publishes SSE `daemon:tunnel-auto-disabled` with `{ failures, windowMs, ip }`. Launcher callback writes `enabled: false` and clears lockfile `tunnelUrl`.
- **D-07:** Tunnel admin allowlist middleware: block `/daemon/*` for tunnel-originated requests. Detection: `X-Forwarded-For` (non-loopback), `X-Forwarded-Proto: https`, or `cf-connecting-ip`. Tunnel hits `/daemon/*` → 404. Tunnel hits `/mcp` → normal bearer-auth.

### Claude's Discretion

- cf-named login wizard implementation details (follow `cloudflared-named-setup.ts` pattern)
- `airtableFormula.tunnel.enable` command: not required, planner can add if cleaner
- ngrok optional domain field in Setup tab (saves to `tunnel-settings.json` `ngrokDomain`)
- `daemon install-tunnel` CLI subcommand placement in `daemon/index.js`

### Deferred Ideas (OUT OF SCOPE)

- cf-named login wizard UX details beyond Perplexity pattern
- Rate limiting beyond 401-burst (per-IP rate limits, UA blocklist)
- OAuth 2.1 for multi-user tunnel (SEC-01)
- Setup tab comprehensive redesign (Phase 8)
- Tunnel URL as auto-config transport (Phase 8)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUNNEL-01 | User can enable a Cloudflare or ngrok tunnel from the VS Code extension Setup tab | D-01, D-02, D-03; full UI-SPEC and webview message protocol documented below |
| TUNNEL-02 | Tunnel URL is written to lockfile and surfaced in the Setup tab dashboard | Lockfile already has `tunnelUrl` field in `normalizeRecord()`; daemon `replace()` pattern documented; DashboardState extension needed |
| TUNNEL-03 | Tunnel auto-disables on repeated auth failures (401 burst) and surfaces warning in UI | D-06; 401-burst middleware pattern from Perplexity `createSecurity()` documented; SSE event flow documented |
| TUNNEL-04 | User can switch tunnel provider (Cloudflare / ngrok) from settings | Provider picker in Setup tab; `tunnel-settings.json` as persistence; provider registry pattern documented |
</phase_requirements>

---

## Summary

Phase 7 ports the complete tunnel subsystem from `VSCode-Perplexity-MCP` into the Airtable daemon with targeted adaptations. The Perplexity source is mature, fully tested, and covers all three providers — it is a direct port, not a redesign. The three adaptations from Perplexity that require design attention are: (1) ngrok settings storage (Perplexity uses `ngrok.json` on disk; Airtable uses VS Code SecretStorage + tunnel-settings.json `ngrokDomain`), (2) tunnel-settings.json schema (Perplexity's `index.ts` stores only `activeProvider`; Airtable's D-03 schema adds `enabled` and `ngrokDomain`), and (3) the Airtable daemon is plain JavaScript (no TypeScript), so all ports are JS-to-JS translations of the `.ts` source files.

The Airtable mcp-server has no `safe-write.js` utility yet. The Perplexity `tunnel-providers/` and `cloudflared-named-setup.ts` both depend on `safeAtomicWriteFileSync` from `safe-write.js`. This utility must be added to `packages/mcp-server/src/` as the first prerequisite step. The implementation already exists in Perplexity (`safe-write.js`, 28 lines) and is trivially portable.

The `@ngrok/ngrok` package is **not currently in the Airtable mcp-server `package.json`**. It must be added as an `optionalDependency` to match the lazy-load pattern. The `cloudflared` binary is not a package — it is downloaded via `installCloudflared()` into `~/.airtable-user-mcp/bin/`.

**Primary recommendation:** Port in this order: (1) `safe-write.js` helper, (2) `cloudflared-pins.json` (copy as-is), (3) `tunnel.js` + `install-tunnel.js`, (4) tunnel providers (types → cf-quick → ngrok → cf-named → index), (5) server.js modifications (allowlist middleware + enable/disable endpoints + 401-burst tripwire), (6) launcher.js modifications (auto-start + finalize stop), (7) shared types + webview messages, (8) DashboardProvider tunnel message handling, (9) Setup tab UI, (10) extension package.json command registration.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tunnel process lifecycle (spawn/stop) | MCP Server Daemon | — | cloudflared and ngrok run as daemon subprocesses; daemon owns the process tree |
| Tunnel settings persistence | MCP Server Daemon | Extension (reads) | `tunnel-settings.json` is daemon-owned so it works without VS Code open |
| ngrok authtoken storage | VS Code Extension (SecretStorage) | — | Tokens must never be written to disk; SecretStorage is encrypted |
| 401-burst detection and tripwire | MCP Server Daemon (server.js) | — | Happens per-request; only the server has access to request context |
| Tunnel URL surfacing | Lockfile → Extension → Webview | — | Lockfile is the shared state bus; extension reads and pushes to dashboard |
| Tunnel enable/disable endpoints | MCP Server Daemon (server.js) | — | Admin HTTP endpoints already established by Phase 5 pattern |
| Tunnel section UI | Webview (React) | — | Follows existing Setup tab glass-panel pattern; no new components |
| Tunnel URL → lockfile write | MCP Server Daemon (launcher.js) | — | `replace()` pattern already used for port/token updates |
| `daemon install-tunnel` CLI subcommand | MCP Server CLI (daemon/index.js) | — | Follows Phase 5 pattern for `daemon start`, `daemon stop` |

---

## Standard Stack

### Core (already installed or being ported as files)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ngrok/ngrok` | to be added as optionalDep | ngrok in-process NAPI tunnel | Perplexity uses this; no binary to manage |
| `node:child_process` | built-in | cloudflared subprocess spawn | Standard for daemon child management |
| `node:crypto` | built-in | SHA-256 checksum verification for cloudflared download | Standard |
| `node:zlib` | built-in | gunzipSync for `.tgz` cloudflared archive extraction | Standard |
| `node:readline` | built-in | line-by-line parsing of cloudflared stdout/stderr for URL/ready detection | Standard |
| `express` | already in daemon | HTTP server + middleware stack | Already present in server.js |

### Supporting Files to Add

| File | Source | Purpose |
|------|--------|---------|
| `src/safe-write.js` | Port from Perplexity `safe-write.js` | Atomic write+rename for config files |
| `src/daemon/cloudflared-pins.json` | Copy from Perplexity as-is | Pinned cloudflared binary checksums (version 2026.3.0) |
| `src/daemon/tunnel.js` | Port from `tunnel.ts` | `startTunnel()`, `extractTunnelUrl()`, `TunnelState` |
| `src/daemon/install-tunnel.js` | Port from `install-tunnel.ts` | `installCloudflared()`, `getTunnelBinaryPath()` |
| `src/daemon/tunnel-providers/types.js` | Port from `types.ts` | `TunnelProvider` interface (JSDoc in JS) |
| `src/daemon/tunnel-providers/cloudflared-quick.js` | Port from `cloudflared-quick.ts` | cf-quick provider |
| `src/daemon/tunnel-providers/ngrok.js` | Port from `ngrok.ts` | ngrok NAPI provider, lazy load, `NgrokNativeMissingError` |
| `src/daemon/tunnel-providers/cloudflared-named.js` | Port from `cloudflared-named.ts` | cf-named provider, `createCloudflaredNamedProvider()` |
| `src/daemon/tunnel-providers/cloudflared-named-setup.js` | Port from `cloudflared-named-setup.ts` | cf-named setup wizard (login, create, route DNS) |
| `src/daemon/tunnel-providers/index.js` | Port from `index.ts` (adapted) | Provider registry, `readTunnelSettings()`, `writeTunnelSettings()` |

### Key Adaptation: ngrok Settings

Perplexity's `ngrok-config.ts` reads/writes `<configDir>/ngrok.json` (file on disk). **Airtable does NOT use this file.** Instead:
- `ngrokDomain` lives in `tunnel-settings.json` (already in D-03 schema)
- `authtoken` lives in VS Code SecretStorage — injected by extension into `POST /daemon/enable-tunnel` request body
- The Airtable ngrok provider's `start()` accepts authtoken from `options` (not from disk), so `ngrok-config.ts` is **not ported** — its domain-reading logic is absorbed into `tunnel-providers/index.js:readTunnelSettings()`

### Key Adaptation: tunnel-settings.json Schema

Perplexity's `index.ts` schema: `{ activeProvider, updatedAt }`
Airtable's D-03 schema: `{ enabled, provider, ngrokDomain }`

The field name changes: `activeProvider` → `provider`. The `enabled` and `ngrokDomain` fields are additions.

**Installation:**
```bash
# Add @ngrok/ngrok as optional dep to mcp-server
cd packages/mcp-server && npm install --save-optional @ngrok/ngrok
```

**Version verification:**
```bash
npm view @ngrok/ngrok version
```
[VERIFIED: npm view was not run in this session — version is ASSUMED to be current as of 2026-05. Use latest before writing package.json.]

---

## Architecture Patterns

### System Architecture Diagram

```
VS Code Extension (DashboardProvider)
    │  reads tunnel-settings.json (provider, enabled)
    │  reads lockfile (tunnelUrl)
    │  holds ngrok authtoken in SecretStorage
    │
    ├──► Setup Tab Webview
    │       ├─ Provider picker → { type: 'tunnel:enable', provider, authtoken?, domain? }
    │       ├─ Disable button → { type: 'tunnel:disable' }
    │       └─ SSE events → DashboardState.tunnel update
    │
    └──► Daemon HTTP Server (127.0.0.1:PORT)
            │
            ├── [Allowlist Middleware]  ← runs BEFORE requireBearer
            │       X-Forwarded-For / cf-connecting-ip present?
            │       → tunnel request: block /daemon/* with 404
            │       → loopback request: pass through
            │
            ├── [401-Burst Tripwire]  ← in requireBearer path
            │       Counts 401s per window
            │       → 10 failures/60s: fire onTunnelAutoDisable callback
            │       → publishEvent('daemon:tunnel-auto-disabled', {failures, windowMs, ip})
            │
            ├── POST /daemon/enable-tunnel
            │       body: { provider, authtoken?, domain? }
            │       → writeTunnelSettings({ enabled: true, provider, ngrokDomain })
            │       → startTunnel() via provider registry
            │       → on URL ready: replace(lockfile, {tunnelUrl})
            │       → publishEvent('daemon:tunnel-started', {url})
            │
            ├── POST /daemon/disable-tunnel
            │       → activeTunnel.stop()
            │       → writeTunnelSettings({ enabled: false })
            │       → replace(lockfile, {tunnelUrl: null})
            │       → publishEvent('daemon:tunnel-stopped', {})
            │
            └── GET /daemon/health  (includes tunnelUrl in response)

Launcher (startDaemon)
    After syncLockfile():
    │  reads tunnel-settings.json
    │  enabled: true + provider configured → startTunnel()
    │  onStateChange(url) → replace(lockfile, {tunnelUrl})
    │
    finalize():
    │  activeTunnel?.stop()
```

### Recommended Project Structure

```
packages/mcp-server/src/
├── safe-write.js                          # NEW: atomic write helper
├── daemon/
│   ├── cloudflared-pins.json              # NEW: copy from Perplexity
│   ├── tunnel.js                          # NEW: startTunnel(), extractTunnelUrl()
│   ├── install-tunnel.js                  # NEW: installCloudflared(), getTunnelBinaryPath()
│   ├── tunnel-providers/
│   │   ├── types.js                       # NEW: JSDoc interface declarations
│   │   ├── cloudflared-quick.js           # NEW: cf-quick provider
│   │   ├── ngrok.js                       # NEW: ngrok NAPI provider
│   │   ├── cloudflared-named.js           # NEW: cf-named provider
│   │   ├── cloudflared-named-setup.js     # NEW: cf-named CLI wizard helpers
│   │   └── index.js                       # NEW: registry + readTunnelSettings/writeTunnelSettings
│   ├── server.js                          # MODIFY: allowlist middleware, enable/disable endpoints, 401-burst
│   ├── launcher.js                        # MODIFY: auto-start tunnel, finalize stop
│   ├── lockfile.js                        # NO CHANGE (tunnelUrl already in normalizeRecord)
│   ├── token.js                           # NO CHANGE
│   └── index.js                           # MODIFY: add install-tunnel subcommand export
packages/shared/src/
│   ├── types.ts                           # MODIFY: add TunnelState, TunnelProviderId to DashboardState
│   └── messages.ts                        # MODIFY: add tunnel:enable, tunnel:disable, tunnel:set-ngrok-authtoken messages
packages/extension/src/
│   ├── webview/DashboardProvider.ts       # MODIFY: handle tunnel messages, SSE relay
│   └── package.json                       # MODIFY: add airtableFormula.tunnel.disable command
packages/webview/src/tabs/
│   └── Setup.tsx                          # MODIFY: add tunnel glass-panel section
```

### Pattern 1: startTunnel() — cloudflared subprocess lifecycle

[VERIFIED: read from `tunnel.ts`]

```javascript
// Source: VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel.ts
// Port: remove TypeScript types, translate to JS, keep function signatures identical

export function startTunnel(options) {
  // options: { command, args?, port, env?, onStateChange? }
  // Returns: { pid, waitUntilReady: Promise<string>, stop: () => Promise<void>, getState: () => TunnelState }
  
  // Key: cloudflared --config neutral.yml prevents user's ~/.cloudflared/config.yml
  // from injecting ingress rules that return 404 for Quick Tunnel subdomains
  const neutralConfigPath = ensureNeutralConfig(options.command);
  
  // URL extraction from stdout/stderr line scanning:
  // match /https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu
  
  // Windows kill: taskkill /PID <n> /T /F (SIGTERM unreliable on Windows)
  // POSIX kill: child.kill('SIGTERM')
}
```

### Pattern 2: Tunnel Admin Allowlist Middleware

[VERIFIED: read from Perplexity `server.ts` lines 817-846]

```javascript
// Source: VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/server.ts (computeRequestSource)
// This must run BEFORE requireBearer — tunnel caller should not reach /daemon/* at all

function isTunnelRequest(req) {
  // X-Forwarded-For header present (any value) → tunnel
  if (req.headers?.['x-forwarded-for']) return true;
  // CF-Connecting-IP present → Cloudflare tunnel
  if (req.headers?.['cf-connecting-ip']) return true;
  // socket IP is non-loopback → tunnel
  const ip = req.socket?.remoteAddress ?? '';
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return true;
  return false;
}

// Allowlist: only /mcp is accessible from tunnel
// All /daemon/* paths → 404
app.use((req, res, next) => {
  if (!isTunnelRequest(req)) return next();
  const path = req.path;
  if (path.startsWith('/mcp') || path === '/') return next();
  res.status(404).json({ error: 'Not found' });
});
```

**Critical note on allowlist scope:** The Perplexity allowlist includes OAuth paths (`/authorize`, `/token`, `/register`, `/.well-known/*`) because Perplexity has an OAuth server. Airtable Phase 7 does NOT have OAuth — the allowlist is simpler: only `/mcp` and `/` pass through from tunnel. All `/daemon/*` → 404.

### Pattern 3: 401-Burst Tripwire

[VERIFIED: read from CONTEXT.md D-06 + Perplexity server.ts lines 248-261]

The tripwire does NOT require porting Perplexity's full `createSecurity()` middleware (which also includes per-IP rate limiting, UA blocklist, slow-401 — all deferred to Phase 8). Phase 7 adds only the 401-burst counter inline in `server.js`.

```javascript
// Add to server.js — inline, no separate security module
const BURST_FAILURE_COUNT = 10;
const BURST_WINDOW_MS = 60_000;
let authFailureCount = 0;
let burstWindowStart = Date.now();
let tunnelAutoDisabled = false;

// In requireBearer middleware, after 401 is determined:
const track401Burst = (req) => {
  const now = Date.now();
  if (now - burstWindowStart > BURST_WINDOW_MS) {
    authFailureCount = 0;
    burstWindowStart = now;
  }
  authFailureCount++;
  if (authFailureCount >= BURST_FAILURE_COUNT && !tunnelAutoDisabled && isTunnelRequest(req)) {
    tunnelAutoDisabled = true;
    const ip = req.headers?.['cf-connecting-ip'] 
      ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() 
      ?? null;
    publishEvent('daemon:tunnel-auto-disabled', { failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
    options.onTunnelAutoDisable?.({ failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
  }
};
```

**Reset condition:** `tunnelAutoDisabled` resets when tunnel is re-enabled via `POST /daemon/enable-tunnel`.

### Pattern 4: Launcher Auto-Start + Finalize Stop

[VERIFIED: read from `launcher.js` `startDaemon()` — current code has `tunnelUrl: null` placeholder]

```javascript
// In startDaemon(), after syncLockfile(server.bearerToken):
let activeTunnel = null;

const startTunnelIfConfigured = async () => {
  const settings = readTunnelSettings(configDir);
  if (!settings.enabled) return;
  const provider = getTunnelProvider(settings.provider);
  const check = await provider.isSetupComplete(configDir);
  if (!check.ready) return; // not configured — skip silently
  
  // For ngrok: authtoken must come from the enable request, not from startup
  // If ngrok but no authtoken available at startup, skip (user must enable manually)
  if (settings.provider === 'ngrok') return; // ngrok requires authtoken from SecretStorage
  
  activeTunnel = await provider.start({
    port: server.port,
    configDir,
    onStateChange: (state) => {
      if (state.url) {
        replace({ ...buildRecord(), tunnelUrl: state.url }, { lockPath, expectedUuid: uuid });
      } else if (state.status === 'crashed' || state.status === 'disabled') {
        replace({ ...buildRecord(), tunnelUrl: null }, { lockPath, expectedUuid: uuid });
        writeTunnelSettings(configDir, { enabled: false });
      }
    },
  });
};

await startTunnelIfConfigured();

// In finalize():
activeTunnel?.stop().catch(() => undefined);
```

**Note on ngrok auto-start:** ngrok auto-start on daemon startup is intentionally skipped because the authtoken lives in VS Code SecretStorage and the daemon process cannot access it directly. Only cf-quick and cf-named can auto-start (their credentials are file-based). This is an Airtable-specific constraint absent from Perplexity.

### Pattern 5: enable-tunnel / disable-tunnel HTTP Endpoints

[VERIFIED: modeled from existing `/daemon/rotate-token` and `/daemon/shutdown` patterns in server.js]

```javascript
// POST /daemon/enable-tunnel
// body: { provider: 'cf-quick'|'ngrok'|'cf-named', authtoken?: string, domain?: string }
app.post('/daemon/enable-tunnel', requireBearer, async (req, res, next) => {
  try {
    const { provider, authtoken, domain } = req.body ?? {};
    // Stop existing tunnel if any
    if (activeTunnel) {
      await activeTunnel.stop().catch(() => undefined);
      activeTunnel = null;
    }
    // Persist settings
    writeTunnelSettings(configDir, { enabled: true, provider, ngrokDomain: domain ?? null });
    // Start new tunnel
    const p = getTunnelProvider(provider);
    activeTunnel = await p.start({
      port: getBoundPort(httpServer),
      configDir,
      authtoken,  // passed through for ngrok
      onStateChange: (state) => { /* update lockfile tunnelUrl */ },
    });
    const url = await activeTunnel.waitUntilReady;
    publishEvent('daemon:tunnel-started', { url });
    tunnelAutoDisabled = false; // reset burst counter
    res.json({ ok: true, url });
  } catch (err) { next(err); }
});

// POST /daemon/disable-tunnel
app.post('/daemon/disable-tunnel', requireBearer, async (_req, res, next) => {
  try {
    if (activeTunnel) {
      await activeTunnel.stop().catch(() => undefined);
      activeTunnel = null;
    }
    writeTunnelSettings(configDir, { enabled: false });
    options.onTunnelUrlChange?.(null); // update lockfile
    publishEvent('daemon:tunnel-stopped', {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

**Note:** `activeTunnel` must be module-level state in server.js, initialized null, replaced on each enable.

### Pattern 6: ngrok Provider Authtoken Threading

[VERIFIED: D-02 + ngrok.ts source]

The Airtable ngrok provider's `start()` needs to accept `authtoken` from the caller (not read from disk). The `TunnelProviderStartOptions` type in `types.js` must be extended with `authtoken?: string` for the Airtable variant:

```javascript
// In ngrok.js start():
async start(options) {
  // options.authtoken comes from the enable-tunnel request body
  const authtoken = options.authtoken;
  if (!authtoken) {
    throw new Error('ngrok authtoken required. Provide it in the enable-tunnel request.');
  }
  const ngrok = await loadNgrokNative();
  const listener = await ngrok.forward({
    addr: options.port,
    authtoken,
    ...(options.domain ? { domain: options.domain } : {}),
    forwards_to: `airtable-mcp (port ${options.port})`,
  });
  // ...
}

// isSetupComplete() for ngrok: only check native binding availability
// (not authtoken — authtoken is provided per-request from SecretStorage)
async isSetupComplete(configDir) {
  const probe = await isNgrokNativeAvailable();
  if (!probe.available) {
    return { ready: false, reason: probe.error.message };
  }
  // authtoken is injected at enable-time — don't check here
  return { ready: true };
}
```

### Pattern 7: webview ↔ Extension Message Protocol (new messages)

[VERIFIED: read from `messages.ts` — current messages documented; tunnel messages are NEW]

New messages to add to `packages/shared/src/messages.ts`:

**WebviewMessage additions (Webview → Extension):**
```typescript
| { type: 'tunnel:enable';              id: string; provider: TunnelProviderId; authtoken?: string; domain?: string }
| { type: 'tunnel:disable';             id: string }
| { type: 'tunnel:set-ngrok-authtoken'; id: string; authtoken: string }
```

**ExtensionMessage additions (Extension → Webview):**
No new push-direction messages needed — tunnel state is conveyed via `state:update` (DashboardState.tunnel) and SSE events relayed through DashboardProvider.

### Pattern 8: DashboardState Extension

[VERIFIED: read from `types.ts` — `DashboardState` does not yet have tunnel fields]

```typescript
// Add to packages/shared/src/types.ts

export type TunnelProviderId = 'cf-quick' | 'ngrok' | 'cf-named';

export type TunnelStatus = 'disabled' | 'starting' | 'active' | 'auto-disabled' | 'error';

export interface TunnelAutoDisabledReason {
  failures: number;
  windowMs: number;
  ip: string | null;
}

export interface TunnelState {
  status:             TunnelStatus;
  url:                string | null;
  provider:           TunnelProviderId;
  ngrokAuthtokenSet:  boolean;  // true when SecretStorage has a token
  autoDisabledReason: TunnelAutoDisabledReason | null;
}

// In DashboardState:
export interface DashboardState {
  // ... existing fields ...
  tunnel?: TunnelState;  // undefined when daemon is not running
}
```

### Anti-Patterns to Avoid

- **Do NOT** port `ngrok-config.ts` as a disk file. Airtable stores authtoken in SecretStorage only. Porting the file would create a disk-based authtoken path that contradicts D-02.
- **Do NOT** port Perplexity's full `createSecurity()` middleware (per-IP rate limiting, UA blocklist, slow-401 delay). These are deferred to Phase 8. Phase 7 only needs the 401-burst tripwire, implemented inline.
- **Do NOT** put tunnel-allowlist middleware after `requireBearer`. It must run before auth to block tunnel callers from even seeing a 401 response on `/daemon/*` paths.
- **Do NOT** use `renameSync` alone for atomic writes to tunnel-settings.json. Use `safeAtomicWriteFileSync` (to be added as `safe-write.js`).
- **Do NOT** auto-restart the tunnel on crash. D-04 is explicit: no backoff, no auto-restart. User must explicitly re-enable.
- **Do NOT** write `ngrokDomain` to disk without going through `writeTunnelSettings()`. The function is the single write path for `tunnel-settings.json`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| cloudflared binary extraction | Custom tar parser | `gunzipSync` + offset-walking from `install-tunnel.ts` | Already debugged (Windows path regex, `.tgz` vs raw binary variants per platform) |
| cloudflared URL detection | Custom regex | `extractTunnelUrl()` from `tunnel.ts` | Handles both stdout and stderr, regex proven against trycloudflare.com domain format |
| cloudflared neutral config | Skip or write custom | `ensureNeutralConfig()` from `tunnel.ts` | Prevents user's `~/.cloudflared/config.yml` from hijacking quick tunnel with http_status:404 |
| ngrok session cleanup | Skip | `ngrok.kill()` before `ngrok.forward()` | Prevents ERR_NGROK_334 "endpoint already online" from prior uncleaned session |
| cloudflared process kill on Windows | `child.kill('SIGTERM')` | `taskkill /PID <n> /T /F` | Detached Windows processes do not reliably respond to SIGTERM |
| cf-named port-drift handling | Skip rewrite | `writeTunnelConfig()` on every start | Daemon gets fresh OS port on restart; stale YAML routes cloudflared to dead port |
| Named tunnel ready detection | URL scraping | `READY_LINE_REGEX = /Registered tunnel connection/i` on stderr | Named tunnel has static URL (hostname); ready signal is connection registration, not URL publication |
| Atomic config file writes | `writeFileSync` directly | `safeAtomicWriteFileSync` (tmp + renameSync) | Prevents partial writes corrupting `tunnel-settings.json` on crash |
| Binary checksum verification | Skip | `createHash('sha256').update(buffer).digest('hex')` vs `pins.assets[key].sha256` | Supply chain protection; cloudflared pins are frozen at `2026.3.0` |

**Key insight:** All four edge cases that would trip a naive implementation (neutral config, Windows process kill, port-drift rewrite, ERR_NGROK_334 cleanup) are already solved in the Perplexity source. Porting verbatim avoids re-discovering these.

---

## Runtime State Inventory

> Rename/refactor trigger: not applicable to Phase 7 (new features, not a rename). Skipped.

Step 2.5: SKIPPED — Phase 7 is a greenfield feature addition, not a rename or migration.

---

## Common Pitfalls

### Pitfall 1: cloudflared config.yml hijack
**What goes wrong:** If user has `~/.cloudflared/config.yml` from a prior named tunnel setup, cloudflared's quick tunnel reads it and applies ingress rules that return `http_status:404` for every request to the trycloudflare.com subdomain.
**Why it happens:** cloudflared auto-loads `~/.cloudflared/config.yml` unless a `--config` flag overrides it.
**How to avoid:** Port `ensureNeutralConfig()` from `tunnel.ts` exactly — writes a `quick-tunnel.yml` next to the binary with `no-autoupdate: true` and passes `--config <path>`. Falls back silently if binary path is read-only (test fixtures).
**Warning signs:** cloudflared starts, URL is published, but every request to the tunnel URL returns 404.

### Pitfall 2: ngrok ERR_NGROK_334 on re-enable
**What goes wrong:** User disables tunnel (daemon kills ngrok in-process session), then immediately clicks Enable. ngrok's servers still have the reserved domain bound from the previous session.
**Why it happens:** ngrok maintains server-side session state that outlives the client closure by ~60 seconds.
**How to avoid:** Port `ngrok.kill()` call before `ngrok.forward()` (clears in-process session). Surface `translateNgrokError()` message to user: "Wait ~60 seconds or use an ephemeral URL."
**Warning signs:** Enable fails immediately with ERR_NGROK_334 or "already online" error.

### Pitfall 3: cf-named stale port in YAML
**What goes wrong:** Daemon restarts, gets a new OS-assigned port. cloudflared's `cloudflared-named.yml` still has the old port. cloudflared routes to dead port, tunnel is live but MCP requests get connection refused.
**Why it happens:** Daemon uses `port: 0` (OS assigns), which changes on every start.
**How to avoid:** Port `writeTunnelConfig()` call at the start of `cf-named provider.start()` — always rewrite the YAML with the current port before spawning cloudflared.
**Warning signs:** cf-named tunnel starts, URL is reachable, but MCP calls return connection errors.

### Pitfall 4: Allowlist middleware order
**What goes wrong:** Allowlist middleware placed after `requireBearer` — tunnel callers get a 401 response on `/daemon/health`, leaking that the endpoint exists.
**Why it happens:** Middleware is wired in wrong order.
**How to avoid:** Add allowlist middleware as the FIRST middleware on the app, before `app.use(express.json())` and before `requireBearer`. Order in server.js: allowlist → json body parser → requireBearer → route handlers.
**Warning signs:** Test shows tunnel GET /daemon/health returns 401 instead of 404.

### Pitfall 5: @ngrok/ngrok NAPI platform mismatch in VSIX
**What goes wrong:** VSIX packaged on Windows, activated on Linux (or vice versa). `require('@ngrok/ngrok')` throws `MODULE_NOT_FOUND` for the platform-specific subpackage.
**Why it happens:** `@ngrok/ngrok` uses platform-specific NAPI subpackages resolved at module-load time.
**How to avoid:** Port `loadNgrokNative()` lazy-load pattern exactly (dynamic import deferred until `start()` is called). Wrap in `NgrokNativeMissingError` with user-friendly message. Surface in `isSetupComplete()` so dashboard shows a clear error instead of crashing extension activation.
**Warning signs:** Extension activation crashes with MODULE_NOT_FOUND; or ngrok provider silently unavailable.

### Pitfall 6: safe-write.js missing (prerequisite)
**What goes wrong:** `cloudflared-named-setup.js` and `tunnel-providers/index.js` both import `../../safe-write.js`. File does not exist in Airtable's mcp-server yet.
**Why it happens:** Airtable's existing token.js already uses its own inline write+rename (no shared utility). The tunnel files need the utility.
**How to avoid:** Add `safe-write.js` as the first task before any tunnel provider files. Implementation: 28 lines, copied verbatim from Perplexity.
**Warning signs:** Build errors on first import of any tunnel provider file.

### Pitfall 7: ngrok auto-start skipped silently at daemon startup
**What goes wrong:** User configures ngrok provider, expects tunnel to auto-start when daemon restarts. It doesn't, with no indication why.
**Why it happens:** ngrok authtoken lives in VS Code SecretStorage, which is not accessible to the daemon process. Auto-start is only possible for cf-quick and cf-named.
**How to avoid:** In `startTunnelIfConfigured()` in launcher.js, explicitly skip ngrok provider with a comment. In Setup tab, display a note that ngrok tunnels require manual enable after daemon restart.
**Warning signs:** User confusion about inconsistent auto-start behavior between providers.

---

## Code Examples

### tunnel-settings.json read/write (Airtable schema)

[VERIFIED: D-03 schema, adapted from Perplexity index.ts pattern]

```javascript
// packages/mcp-server/src/daemon/tunnel-providers/index.js

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeAtomicWriteFileSync } from '../../safe-write.js';

const VALID_PROVIDERS = ['cf-quick', 'ngrok', 'cf-named'];

export function getTunnelSettingsPath(configDir) {
  return join(configDir, 'tunnel-settings.json');
}

export function readTunnelSettings(configDir) {
  const path = getTunnelSettingsPath(configDir);
  const defaults = { enabled: false, provider: 'cf-quick', ngrokDomain: null };
  if (!existsSync(path)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      enabled: parsed.enabled === true,
      provider: VALID_PROVIDERS.includes(parsed.provider) ? parsed.provider : 'cf-quick',
      ngrokDomain: typeof parsed.ngrokDomain === 'string' ? parsed.ngrokDomain : null,
    };
  } catch { return defaults; }
}

export function writeTunnelSettings(configDir, patch) {
  const path = getTunnelSettingsPath(configDir);
  const prev = readTunnelSettings(configDir);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : prev.enabled,
    provider: VALID_PROVIDERS.includes(patch.provider) ? patch.provider : prev.provider,
    ngrokDomain: 'ngrokDomain' in patch ? (patch.ngrokDomain ?? null) : prev.ngrokDomain,
  };
  mkdirSync(dirname(path), { recursive: true });
  safeAtomicWriteFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
```

### Tunnel allowlist test (port from Perplexity pattern)

[VERIFIED: read from `tunnel-admin-allowlist.test.js` in Perplexity]

The test uses Vitest (`describe/it/expect`) in Perplexity. Airtable's daemon tests use `node:test` (`describe/it/assert`). The test must be translated to use `node:test`:

```javascript
// packages/mcp-server/test/test-tunnel-allowlist.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemonServer } from '../src/daemon/server.js';

// Test matrix: tunnel headers on /daemon/* → 404
// Loopback (no tunnel headers) on /daemon/* → not 404
// Tunnel headers on /mcp → not 404
// cf-connecting-ip alone → tunnel (404 on /daemon/*)
// X-Forwarded-For alone → tunnel (404 on /daemon/*)
```

**Note:** Perplexity's test includes OAuth paths (`/daemon/oauth-consent`, etc.) — strip those. Airtable Phase 7 daemon paths are: `/daemon/health`, `/daemon/events`, `/daemon/heartbeat`, `/daemon/rotate-token`, `/daemon/shutdown`, `/daemon/enable-tunnel`, `/daemon/disable-tunnel`.

### DashboardProvider tunnel message handlers

[VERIFIED: pattern from DashboardProvider.ts handleMessage()]

```typescript
// Extension DashboardProvider.ts — new handlers in handleMessage()

if (msg.type === 'tunnel:enable') {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (!status?.running || !status.port || !status.bearerToken) {
      this.postResult(msg.id, false, 'Daemon not running');
      return;
    }
    // For ngrok: read authtoken from SecretStorage
    let authtoken: string | undefined = msg.authtoken;
    if (msg.provider === 'ngrok' && !authtoken) {
      authtoken = await this.context.secrets.get('airtable-formula.ngrok.authtoken') ?? undefined;
    }
    const body = { provider: msg.provider, authtoken, domain: msg.domain };
    await fetch(`http://127.0.0.1:${status.port}/daemon/enable-tunnel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${status.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) { this.postResult(msg.id, false, String(err)); }
  return;
}

if (msg.type === 'tunnel:set-ngrok-authtoken') {
  await this.context.secrets.store('airtable-formula.ngrok.authtoken', msg.authtoken);
  this.postResult(msg.id, true);
  return;
}

if (msg.type === 'tunnel:disable') {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (status?.running && status.port && status.bearerToken) {
      await fetch(`http://127.0.0.1:${status.port}/daemon/disable-tunnel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${status.bearerToken}` },
      });
    }
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) { this.postResult(msg.id, false, String(err)); }
  return;
}
```

**DaemonManager dependency:** `DashboardProvider` currently does not hold a reference to `DaemonManager`. The planner must wire this (either pass DaemonManager to DashboardProvider constructor, or duplicate the lockfile-read pattern inline).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| cloudflared URL on stdout only | Scan both stdout AND stderr | cloudflared changed output stream | Prevents missed URL if cloudflared moves output to stderr (already handled in Perplexity port) |
| `@ngrok/ngrok` static import | Lazy dynamic import via `loadNgrokNative()` | Perplexity 0.8.6 | Prevents extension activation crash when NAPI subpackage missing for platform |
| cloudflared named tunnel: URL from output | Static `https://<hostname>` (known before spawn) | cf-named design | Named tunnel URL is deterministic; ready signal is `Registered tunnel connection` |

**Deprecated/outdated:**
- `ngrok-config.ts` pattern (disk-based authtoken): Not used in Airtable. Replaced by SecretStorage + request-body injection.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=20 | All daemon code | ✓ | — | — |
| `@ngrok/ngrok` npm package | ngrok provider | ✗ (not yet in package.json) | latest | — (add as optionalDependency) |
| cloudflared binary | cf-quick, cf-named providers | ✗ (downloaded by daemon install-tunnel) | 2026.3.0 (pinned) | User installs via daemon CLI |
| `express` | server.js middleware | ✓ | already in daemon | — |
| `node:crypto`, `node:zlib`, `node:readline` | install-tunnel.js, tunnel.js | ✓ | built-in | — |
| VS Code SecretStorage API | Extension (authtoken storage) | ✓ | extension context | — |

**Missing dependencies with no fallback:**
- None blocking (cloudflared is downloaded on demand; @ngrok/ngrok is optional/lazy-loaded)

**Missing dependencies with fallback:**
- `@ngrok/ngrok` NAPI subpackage may be missing on VSIX platform mismatch → `NgrokNativeMissingError` with user-facing message; ngrok provider simply unavailable

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in, no external test runner) |
| Config file | none — test scripts use `node --test "test/*.test.js"` |
| Quick run command | `pnpm -F airtable-user-mcp test` |
| Full suite command | `pnpm -F airtable-user-mcp test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUNNEL-01 | Enable tunnel via `/daemon/enable-tunnel` endpoint | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="enable-tunnel"` | ❌ Wave 0 |
| TUNNEL-01 | Tunnel admin allowlist blocks `/daemon/*` for tunnel requests | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnel allowlist"` | ❌ Wave 0 |
| TUNNEL-02 | `tunnelUrl` written to lockfile when tunnel starts | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnelUrl"` | ❌ Wave 0 |
| TUNNEL-03 | 401-burst tripwire fires after 10 failures in 60s | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="401-burst"` | ❌ Wave 0 |
| TUNNEL-04 | `writeTunnelSettings` / `readTunnelSettings` round-trip | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnel settings"` | ❌ Wave 0 |
| TUNNEL-04 | Provider registry returns correct provider by ID | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="provider registry"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm -F airtable-user-mcp test` (96 existing tests + new tunnel tests)
- **Per wave merge:** `pnpm test` (all packages)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/test-tunnel-allowlist.test.js` — covers TUNNEL-01 (allowlist), REQ tunnel-07
- [ ] `test/test-tunnel-lifecycle.test.js` — covers TUNNEL-01 (enable endpoint), TUNNEL-02, TUNNEL-03
- [ ] `test/test-tunnel-settings.test.js` — covers TUNNEL-04 (settings round-trip, provider registry)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing bearer token; 401-burst auto-disable |
| V3 Session Management | no | Daemon bearer token is already session-persistent |
| V4 Access Control | yes | Tunnel allowlist (admin surface not reachable from tunnel) |
| V5 Input Validation | yes | Validate `provider` field in enable-tunnel body against known set |
| V6 Cryptography | no | No new crypto; cloudflared checksum uses existing SHA-256 |

### Known Threat Patterns for Tunnel Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tunnel caller accessing `/daemon/shutdown` | Elevation of privilege | Allowlist middleware → 404 on `/daemon/*` before auth |
| Brute-force authtoken via tunnel | Tampering | 401-burst tripwire: auto-disable after 10 failures / 60s |
| `X-Forwarded-For` header spoofing to bypass allowlist | Spoofing | Do NOT trust `x-perplexity-source` or similar self-declared headers; only trust `X-Forwarded-For`, `cf-connecting-ip`, socket IP |
| cloudflared binary supply chain | Tampering | SHA-256 checksum verification from `cloudflared-pins.json` before install |
| ngrok authtoken exposure | Information disclosure | Store in VS Code SecretStorage (encrypted); never write to disk; never log |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@ngrok/ngrok` latest version is compatible with the lazy-load pattern from Perplexity's ngrok.ts | Standard Stack | Breaking API change in @ngrok/ngrok would require updating ngrok provider; LOW risk (API stable) |
| A2 | cloudflared pinned version `2026.3.0` checksums in Perplexity's `cloudflared-pins.json` are valid | Standard Stack | If cloudflared releases invalidated their CDN artifacts, install would fail checksum; LOW risk (pinned) |
| A3 | Airtable's daemon express server does not have `trust proxy` set (loopback IP detection reliable) | Architecture | If trust proxy is set, `req.socket.remoteAddress` would return proxy IP and `isTunnelRequest()` would always return true; needs verification in server.js |
| A4 | `DashboardProvider` will be wired to receive `DaemonManager` reference | Code Examples | If not wired, tunnel message handlers cannot read lockfile port/bearerToken; LOW risk (planner wires this) |
| A5 | ngrok NAPI subpackages are bundled in extension VSIX for Windows x64 at minimum | Environment | If VSIX packaging excludes @ngrok/ngrok subpackages, ngrok provider always shows `NgrokNativeMissingError` on Windows |

**A3 warrants pre-task investigation:** Verify `trust proxy` status in server.js before implementing `isTunnelRequest()`. The current server.js (read in this session) does NOT set `app.set('trust proxy', ...)`, so the loopback IP check is reliable. [VERIFIED: server.js lines 1-288 do not contain `trust proxy`].

---

## Open Questions

1. **DaemonManager wiring to DashboardProvider**
   - What we know: DashboardProvider currently has no `DaemonManager` reference; daemon status is polled fresh by DaemonManager separately.
   - What's unclear: Should DashboardProvider get a DaemonManager injected in constructor, or should the tunnel commands use `authManager`'s internal connection info?
   - Recommendation: Add `setDaemonManager(mgr: DaemonManager)` method to DashboardProvider (mirrors `setAuthManager`, `setToolProfileManager` pattern). Wire in `extension.ts`.

2. **SSE relay to webview for tunnel events**
   - What we know: The extension subscribes to `/daemon/events` SSE to receive `daemon:token-rotated` events (pattern exists in auth-manager or daemon-manager). Tunnel events (`daemon:tunnel-started`, `daemon:tunnel-stopped`, `daemon:tunnel-auto-disabled`) need the same relay.
   - What's unclear: Does an SSE subscription already exist in DaemonManager or extension.ts for routing daemon events to the webview?
   - Recommendation: Planner identifies existing SSE subscriber and extends it to relay tunnel SSE events → `this.view.webview.postMessage({ type: 'state:update', payload: tunnelState })`.

3. **@ngrok/ngrok VSIX packaging**
   - What we know: `patchright` and `otpauth` are currently handled by `scripts/prepare-package-deps.mjs` which copies from hoisted `node_modules/` into `dist/node_modules/`.
   - What's unclear: `@ngrok/ngrok` has platform-specific NAPI subpackages. Will the existing `prepare-package-deps.mjs` copy the correct one for the build platform? Will cross-platform VSIX work?
   - Recommendation: Add `@ngrok/ngrok` to `prepare-package-deps.mjs` copy list; document that cross-platform VSIX users will hit `NgrokNativeMissingError` (expected behavior per `NgrokNativeMissingError` design).

---

## Sources

### Primary (HIGH confidence)
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/install-tunnel.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/cloudflared-pins.json` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/types.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/cloudflared-quick.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/ngrok.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/ngrok-config.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named-setup.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/tunnel-providers/index.ts` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/test/daemon/tunnel-admin-allowlist.test.js` — read in full
- `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/server.ts` — lines 1-80, 240-280, 805-870 read
- `VSCode-Perplexity-MCP/packages/mcp-server/src/safe-write.js` — read in full
- `VSCode-Airtable-Formula/packages/mcp-server/src/daemon/server.js` — read in full
- `VSCode-Airtable-Formula/packages/mcp-server/src/daemon/launcher.js` — read in full
- `VSCode-Airtable-Formula/packages/mcp-server/src/daemon/lockfile.js` — read in full
- `VSCode-Airtable-Formula/packages/mcp-server/src/daemon/index.js` — read in full
- `VSCode-Airtable-Formula/packages/mcp-server/src/paths.js` — read in full
- `VSCode-Airtable-Formula/packages/shared/src/types.ts` — read in full
- `VSCode-Airtable-Formula/packages/shared/src/messages.ts` — read in full
- `VSCode-Airtable-Formula/packages/extension/src/mcp/daemon-manager.ts` — read in full
- `VSCode-Airtable-Formula/packages/extension/src/webview/DashboardProvider.ts` — read in full
- `VSCode-Airtable-Formula/packages/webview/src/tabs/Setup.tsx` — read in full
- `VSCode-Airtable-Formula/.planning/phases/07-tunnel-support/07-CONTEXT.md` — read in full
- `VSCode-Airtable-Formula/.planning/phases/07-tunnel-support/07-UI-SPEC.md` — read in full

### Secondary (MEDIUM confidence)
- None — all claims verified from source files

### Tertiary (LOW confidence)
- A1-A5 in Assumptions Log above

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all files read directly; no web searches needed
- Architecture: HIGH — derived from Perplexity source + Airtable existing code
- Pitfalls: HIGH — sourced from Perplexity code comments and known edge cases in source
- Port adaptations: HIGH — D-02/D-03 read from CONTEXT.md, verified against Perplexity ngrok-config.ts and index.ts

**Research date:** 2026-05-15
**Valid until:** 2026-07-15 (cloudflared pins may need updating; @ngrok/ngrok API stable)
