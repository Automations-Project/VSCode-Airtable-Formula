---
phase: 07-tunnel-support
plan: "06"
subsystem: mcp-server/daemon
tags:
  - tunnel
  - lifecycle
  - launcher
  - daemon
dependency_graph:
  requires:
    - 07-05
  provides:
    - launcher.js tunnel auto-start on daemon startup (D-04)
    - launcher.js tunnel stop in finalize() (D-04)
    - buildRecord() live tunnelUrl from activeTunnel state
    - onTunnelAutoDisable callback with autoDisabled sentinel (D-06, T-07-16)
    - onTunnelUrlChange callback wires lockfile on state change
    - daemon/index.js barrel exports tunnel-providers + install-tunnel
  affects:
    - Extension DashboardProvider (reads tunnelUrl from lockfile)
    - 07-07 (Setup tab tunnelUrl display)
tech_stack:
  added: []
  patterns:
    - activeTunnel scoped to attempt loop — shared across buildRecord/finalize/callbacks
    - Non-fatal tunnel startup (D-04: no auto-restart on failure)
    - autoDisabled sentinel distinguishes auto-disable from user-disable in _computeTunnelState()
key_files:
  created: []
  modified:
    - packages/mcp-server/src/daemon/launcher.js
    - packages/mcp-server/src/daemon/index.js
    - packages/mcp-server/test/test-tunnel-lifecycle.test.js
decisions:
  - "activeTunnel declared with let at attempt-loop scope (after lspChild), not inside the try block — buildRecord(), finalize(), and onTunnelAutoDisable callback all reference it; declaring inside try would cause TDZ errors"
  - "startTunnelIfConfigured() placed after LSP spawn block so server.port is bound and syncLockfile() has already run — tunnel can safely call replace() immediately on state change"
  - "401-burst test sends bad-token requests to /mcp (not /daemon/health) — the tunnel allowlist blocks all /daemon/* requests from tunnel-origin before requireBearer is called, so track401Burst() is never triggered from /daemon/health with tunnel headers"
  - "ngrok explicitly skipped in startTunnelIfConfigured() with comment — authtoken lives in VS Code SecretStorage, inaccessible to the daemon process (Pitfall 7)"
metrics:
  duration: "15 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 07 Plan 06: Tunnel Lifecycle in launcher.js Summary

Wired tunnel auto-start lifecycle into the daemon: launcher.js reads tunnel-settings.json after startup, auto-starts cf-quick/cf-named providers (ngrok skipped — authtoken in SecretStorage), stops tunnel in finalize() before LSP SIGTERM, propagates live tunnelUrl to lockfile via buildRecord() and callbacks. Also updated daemon/index.js barrel to expose tunnel-providers + install-tunnel, and filled in real 401-burst and enable-tunnel test assertions.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Modify launcher.js — tunnel auto-start + lifecycle wiring | e69c039 | packages/mcp-server/src/daemon/launcher.js |
| 2 | Update daemon/index.js barrel and fill in 401-burst test assertions | e69c039 | packages/mcp-server/src/daemon/index.js, packages/mcp-server/test/test-tunnel-lifecycle.test.js |

(Both tasks committed together — tightly coupled modifications to launcher.js and test stubs.)

## What Was Built

### activeTunnel scope in startDaemon() attempt loop

`let activeTunnel = null` declared at attempt-loop scope alongside `lspChild`, making it available to `buildRecord()`, `finalize()`, and the `startDaemonServer` callbacks. This avoids TDZ errors that would occur if declared inside the `try` block.

### buildRecord() live tunnelUrl (TUNNEL-02)

Changed from hardcoded `tunnelUrl: null` to `tunnelUrl: activeTunnel?.getState?.()?.url ?? null`. Every lockfile replace() call now reflects real tunnel state.

### finalize() tunnel stop (D-04, T-07-17)

Added `activeTunnel?.stop().catch(() => undefined)` before `lspChild?.kill('SIGTERM')`. Tunnel process is cleaned up before the LSP subprocess and before lockfile release.

### onTunnelAutoDisable callback (D-06, T-07-16)

When the 401-burst tripwire fires in server.js, the callback:
1. Stops the active tunnel (if any) and nulls the reference
2. Writes `{ enabled: false, autoDisabled: true, autoDisabledReason: { failures, ip } }` to tunnel-settings.json — the `autoDisabled: true` sentinel lets `_computeTunnelState()` distinguish auto-disable (status: 'auto-disabled') from user-disable (status: 'disabled')
3. Calls `replace({ ...buildRecord(), tunnelUrl: null }, ...)` to clear the lockfile tunnelUrl

### onTunnelUrlChange callback

Wires `replace({ ...buildRecord(), tunnelUrl: url }, ...)` for all state changes triggered by enable-tunnel/disable-tunnel endpoints in server.js.

### startTunnelIfConfigured() (D-04, Pitfall 7)

Async function called after LSP spawn block. Reads tunnel-settings.json and:
- Returns immediately if `enabled: false`
- Returns immediately if `provider === 'ngrok'` (authtoken in SecretStorage, not accessible to daemon process)
- Calls `provider.isSetupComplete(configDir)` — returns silently if binary not installed
- Starts tunnel via `provider.start()` with `onStateChange` callback wired to lockfile replace()
- On any error: logs + writes `enabled: false` to settings, never crashes the daemon

The `return { ... }` at the end of `startDaemon()` also uses `activeTunnel?.getState?.()?.url ?? null` for `tunnelUrl`.

### daemon/index.js barrel exports

Added two lines:
```javascript
export * from './tunnel-providers/index.js';  // tunnel provider registry + settings I/O
export * from './install-tunnel.js';           // installCloudflared for daemon install-tunnel CLI
```

### 401-burst test (real assertions)

Replaced stub with real assertions: opens SSE stream, sends 10 POST requests to `/mcp` with bad bearer + tunnel headers (`X-Forwarded-For`, `X-Forwarded-Proto`), waits for `daemon:tunnel-auto-disabled` SSE event, asserts `result.failures === 10` and `result.windowMs === 60_000`.

Key insight: requests go to `/mcp` not `/daemon/health` — the tunnel allowlist blocks all `/daemon/*` from tunnel-origin before `requireBearer` (and thus `track401Burst`) is called.

### enable-tunnel tests (strict assertions)

Replaced `assert.ok(res.status === 404 || res.status === 500, ...)` stub with `assert.strictEqual(res.status, 500, ...)` for unknown provider, and `assert.strictEqual(res.status, 401, ...)` for missing auth on disable-tunnel.

## Verification Results

- `pnpm -F airtable-user-mcp test --test-name-pattern="401-burst"` — GREEN (1 test)
- `pnpm -F airtable-user-mcp test --test-name-pattern="enable-tunnel"` — GREEN (2 tests)
- `pnpm -F airtable-user-mcp test` — 212 tests, 0 failures, 0 skipped
- `pnpm test` — all suites pass (mcp-server 212, webview 8, extension 50)

## Deviations from Plan

### [Rule 1 - Bug] Fixed 401-burst test to use /mcp instead of /daemon/health

**Found during:** Task 2 — test was timing out (3s) waiting for SSE event
**Issue:** The plan's test template sent bad-token requests to `/daemon/health` with tunnel headers. The tunnel allowlist middleware (added in Plan 05) blocks all tunnel-originated `/daemon/*` requests and returns 404 before `requireBearer` is called — `track401Burst()` is never invoked from that path.
**Fix:** Changed the 10 bad-token requests to target `/mcp` (POST) — this path passes the allowlist (only `/mcp*` and `/` are allowed for tunnel callers) and reaches `requireBearer`, which calls `track401Burst()`.
**Files modified:** packages/mcp-server/test/test-tunnel-lifecycle.test.js
**Commit:** e69c039

No other deviations. Plan executed as written.

## Threat Surface Scan

No new network endpoints or auth paths introduced. All modifications are internal daemon wiring.

## Self-Check: PASSED

- packages/mcp-server/src/daemon/launcher.js — FOUND
- packages/mcp-server/src/daemon/index.js — FOUND
- packages/mcp-server/test/test-tunnel-lifecycle.test.js — FOUND
- Commit e69c039 — present in git log
- 212 mcp-server tests pass, 0 failures
