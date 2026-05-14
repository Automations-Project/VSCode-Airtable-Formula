# Phase 5 — Daemon Core: Implementation Context

**Phase:** 05  
**Name:** daemon-core  
**Created:** 2026-05-14  
**Status:** Ready for planning

## Purpose

This document captures all implementation decisions made during the discuss-phase session. Downstream researcher and planner agents must treat these decisions as locked — do not re-open them.

---

## Requirements in Scope

From REQUIREMENTS.md (Phase 5):

| ID | Requirement |
|----|-------------|
| DAEMON-01 | Existing `npx airtable-user-mcp` stdio config keeps working unchanged |
| DAEMON-02 | Multiple MCP clients share one session when daemon is running |
| DAEMON-03 | Daemon starts automatically when VS Code extension activates |
| DAEMON-04 | Daemon recovers from stale lockfile without user intervention |
| DAEMON-05 | Daemon exposes `/daemon/health` and `/daemon/events` (SSE) guarded by bearer token |
| DAEMON-06 | User can stop/restart daemon from VS Code extension Setup tab |
| DAEMON-07 | Bearer token persists across daemon restarts; token rotation command available |
| EXT-01 | Extension's `McpServerDefinitionProvider` returns HTTP definition when daemon healthy, stdio otherwise |
| EXT-02 | `auth-manager.ts` extended to spawn/monitor daemon instead of direct MCP process |
| EXT-03 | Extension passes auth env vars (bearer token, config dir) to daemon via `buildDaemonEnv` pattern |

---

## Locked Decisions

### D-01: Entry Point Migration Strategy

**Decision:** Replace `index.mjs` default behavior — it becomes the attach proxy.

`npx airtable-user-mcp` (i.e., `index.mjs`) will:
1. Check for a running daemon via the lockfile
2. If daemon found and healthy → bridge stdin/stdout to daemon HTTP (`StreamableHTTPClientTransport`)
3. If no daemon or unhealthy → poll up to **15 seconds** for daemon to come up → if still unreachable, fall back to **in-process stdio** (spawn the MCP server directly, old behavior)

**No separate `attach.ts` CLI entry needed** — `index.mjs` IS the attach proxy.

**No `--no-daemon` flag at the CLI entry point** — fallback is automatic and silent.

**Reference implementation:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/attach.ts`

---

### D-02: AuthManager vs DaemonManager — Split Classes

**Decision:** Split into two classes — `AuthManager` + new `DaemonManager`.

- **`AuthManager`** (`src/mcp/auth-manager.ts`) stays focused on:
  - VS Code `SecretStorage` credential read/write
  - Login flow orchestration (`login-runner.mjs`, `manual-login-runner.mjs`)
  - Session health check spawning (`health-check.mjs`)
  - Browser detection and download
  - `getCredentialsEnv()` / `_browserEnv()` helpers

- **`DaemonManager`** (`src/mcp/daemon-manager.ts`) owns:
  - Spawning the detached daemon process (`spawnDetachedDaemon`)
  - Polling for daemon readiness (`ensureDaemon` — 200ms poll, 15s deadline)
  - `stopDaemon()` / `restartDaemon()`
  - Reading and watching the lockfile (`~/.airtable-user-mcp/daemon.lock`)
  - `getDaemonStatus()` — returns `{running, pid, port, port_lsp, bearerToken, tunnelUrl, uptime}`
  - `probeHealth()` — HTTP health check against `/daemon/health`

- **Wiring:** `AuthManager` receives a `DaemonManager` instance via constructor injection. Before returning credentials to extension callers, `AuthManager` calls `daemonManager.ensureDaemon()` (if `useDaemon` setting is true).

**Reference implementation:** `VSCode-Perplexity-MCP/packages/mcp-server/src/daemon/launcher.ts`

---

### D-03: HTTP MCP Definition — Duck-typing + Fallback

**Decision:** Use runtime duck-typing for `McpHttpServerDefinition`, falling back to stdio.

In `registration.ts`, the provider logic becomes:

```
if useDaemon enabled
  AND daemon is healthy (probeHealth passes)
  AND (vscode as any).McpHttpServerDefinition exists   ← duck-type check
  → return McpHttpServerDefinition({ url: http://127.0.0.1:{port}/mcp, headers: {Authorization: Bearer {token}} })
else
  → return McpStdioServerDefinition (existing behavior)
```

**No version bump to `engines.vscode`.** The existing duck-type pattern for `McpStdioServerDefinition` is the model:
```ts
(vscode as unknown as { McpStdioServerDefinition?: McpCtor }).McpStdioServerDefinition
```

Apply the same pattern for `McpHttpServerDefinition`.

---

### D-04: Daemon Opt-out — Both VS Code Setting and Env Var

**Decision:** Expose opt-out via both surfaces.

**VS Code setting** (for extension users):
- Key: `airtableFormula.mcp.useDaemon`
- Type: `boolean`
- Default: `true`
- Description: "Start and use a shared daemon process for MCP server. Disable to use a direct per-session process (legacy behavior)."
- Location: `package.json` settings → `airtableFormula.mcp` group

**Environment variable** (for `npx` / CI users):
- Name: `AIRTABLE_NO_DAEMON`
- When set to any non-empty value, `index.mjs` skips daemon attach and runs in-process directly
- Checked in `attach.ts` / `index.mjs` entry before lockfile read

**Precedence:** `AIRTABLE_NO_DAEMON` env var takes priority over VS Code setting (allows CI override even if setting is enabled in workspace).

---

## Architecture Overview

```
npx airtable-user-mcp (index.mjs)
  └─ attach.ts logic:
       AIRTABLE_NO_DAEMON? → run in-process (old behavior)
       lockfile exists + healthy? → bridge stdio ↔ HTTP
       poll 15s → if unreachable → run in-process (fallback)

VS Code Extension (extension.ts)
  ├─ DaemonManager (daemon-manager.ts)
  │    └─ ensureDaemon → spawnDetachedDaemon → poll 15s
  │    └─ getDaemonStatus → lockfile + probeHealth
  │    └─ stopDaemon / restartDaemon
  │
  ├─ AuthManager (auth-manager.ts) [injects DaemonManager]
  │    └─ getCredentialsEnv / _browserEnv (unchanged)
  │    └─ before credential hand-off: daemonManager.ensureDaemon()
  │
  └─ registration.ts (McpServerDefinitionProvider)
       useDaemon + daemonHealthy + McpHttpServerDefinition exists?
         → McpHttpServerDefinition(http://127.0.0.1:{port}/mcp, bearer)
       else
         → McpStdioServerDefinition (current behavior)

Daemon process (packages/mcp-server/src/daemon/)
  ├─ lockfile.ts  — acquire/release/replace/isStale
  ├─ server.ts    — Express + StreamableHTTPServerTransport + bearer auth
  │                  /daemon/health, /daemon/events (SSE), /daemon/shutdown
  └─ launcher.ts  — ensureDaemon, startDaemon, stopDaemon, spawnDetachedDaemon
```

---

## Reference Port Source

All daemon files are direct ports from:
```
C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\
  lockfile.ts   → packages/mcp-server/src/daemon/lockfile.ts
  launcher.ts   → packages/mcp-server/src/daemon/launcher.ts
  server.ts     → packages/mcp-server/src/daemon/server.ts
  attach.ts     → logic folded into packages/mcp-server/src/index.mjs
```

**Airtable-specific changes from Perplexity source:**
- Config dir: `~/.airtable-user-mcp/` (not `~/.perplexity-mcp/`)
- Lockfile: `daemon.lock` (same name)
- Lockfile fields include `port_lsp` (new — for LSP TCP port, Phase 6)
- No OAuth 2.1 server — bearer token is sufficient
- `DaemonLockRecord` omits `cloudflaredPid` (tunnel managed separately in Phase 7)
- Extension lives in `packages/extension/src/mcp/` (not Perplexity's auth-manager path)
- `buildDaemonEnv` passes `AIRTABLE_*` env vars, not `PERPLEXITY_*`

---

## Deferred Ideas (not in Phase 5)

- Daemon status indicator in VS Code status bar (deferred to Phase 8 Setup Tab UI)
- LSP TCP port in lockfile (`port_lsp`) — field is defined in the lockfile schema but populated in Phase 6
- Tunnel URL in lockfile (`tunnelUrl`) — populated in Phase 7
- Token rotation UI command — DAEMON-07 covered, but UI button deferred to Phase 8
- `--no-daemon` CLI flag on `airtable-user-mcp` CLI — covered by `AIRTABLE_NO_DAEMON` env var; explicit flag is optional enhancement

---

## Files to Create/Modify in Phase 5

### New files (mcp-server)
- `packages/mcp-server/src/daemon/lockfile.ts` — ported from Perplexity
- `packages/mcp-server/src/daemon/server.ts` — ported, Airtable-adapted
- `packages/mcp-server/src/daemon/launcher.ts` — ported, Airtable-adapted
- `packages/mcp-server/src/daemon/index.ts` — re-exports for clean imports

### Modified files (mcp-server)
- `packages/mcp-server/src/index.mjs` — becomes attach proxy (D-01)

### New files (extension)
- `packages/extension/src/mcp/daemon-manager.ts` — new class (D-02)

### Modified files (extension)
- `packages/extension/src/mcp/auth-manager.ts` — inject DaemonManager, call ensureDaemon (D-02)
- `packages/extension/src/mcp/registration.ts` — duck-type HTTP definition (D-03)
- `packages/extension/package.json` — add `airtableFormula.mcp.useDaemon` setting (D-04)

### Lockfile schema (finalized for Phase 5)
```ts
interface DaemonLockRecord {
  pid: number;
  uuid: string;          // UUIDv4, stable across restarts
  port: number;          // MCP HTTP port
  port_lsp: number | null;  // LSP TCP port (null until Phase 6 populates it)
  bearerToken: string;
  version: string;       // mcp-server package version
  startedAt: string;     // ISO 8601
  tunnelUrl: string | null;  // null until Phase 7 populates it
}
```
