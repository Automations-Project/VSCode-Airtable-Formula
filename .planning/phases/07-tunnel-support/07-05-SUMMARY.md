---
phase: 07-tunnel-support
plan: "05"
subsystem: mcp-server/daemon
tags:
  - tunnel
  - security
  - middleware
  - sse
dependency_graph:
  requires:
    - 07-03
    - 07-04
  provides:
    - server.js tunnel allowlist middleware (D-07)
    - 401-burst tripwire (D-06)
    - POST /daemon/enable-tunnel endpoint (D-01, D-04)
    - POST /daemon/disable-tunnel endpoint (D-05)
    - GET /daemon/health tunnelUrl field (TUNNEL-02)
  affects:
    - 07-06
tech_stack:
  added: []
  patterns:
    - Express middleware ordering (allowlist before express.json())
    - Sliding-window 401-burst counter with SSE event publish
    - Tunnel state module-level variable inside async closure
key_files:
  created: []
  modified:
    - packages/mcp-server/src/daemon/server.js
decisions:
  - "isTunnelRequest() defined at module scope (before startDaemonServer) so it can be referenced in allowlist middleware before publishEvent is defined inside the closure — avoids temporal dead zone issues"
  - "track401Burst() checks isTunnelRequest(req) internally (only track tunnel-originated failures), consistent with PATTERNS.md approach vs. plan task description which described an early-return guard"
  - "activeTunnel = null assigned explicitly after tunnel-stop runShutdownStep to ensure state is clean even if stop() is a no-op"
metrics:
  duration: "12 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
---

# Phase 07 Plan 05: Tunnel Subsystem in server.js Summary

Wired the daemon HTTP server to be tunnel-aware: allowlist middleware blocks /daemon/* from remote callers before auth is checked, 401-burst tripwire auto-disables the tunnel after brute-force attempts, enable/disable endpoints manage tunnel lifecycle, and getHealth() reports the active tunnelUrl.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add allowlist middleware + 401-burst tripwire + module-level state | 5e81e4b | packages/mcp-server/src/daemon/server.js |
| 2 | Add enable-tunnel/disable-tunnel endpoints + health tunnelUrl + stop() tunnel cleanup | 5e81e4b | packages/mcp-server/src/daemon/server.js |

(Both tasks committed together in a single atomic commit as they are tightly coupled in the same file.)

## What Was Built

### isTunnelRequest() (D-07, T-07-14)
Detects tunnel-originated requests via `X-Forwarded-For`, `cf-connecting-ip` headers, or non-loopback socket address. Spoofing X-Forwarded-For makes the system MORE restrictive, never less — safe by design.

### Allowlist Middleware (D-07, T-07-12)
Registered BEFORE `express.json()` and BEFORE `requireBearer`. Tunnel callers hitting `/daemon/*` receive `404 Not found` before authentication is attempted — they never know `/daemon/shutdown`, `/daemon/rotate-token`, or any admin endpoint exists.

### 401-Burst Tripwire (D-06, T-07-13)
`BURST_FAILURE_COUNT=10`, `BURST_WINDOW_MS=60_000`. Sliding window resets when 60s elapses. On threshold: publishes `daemon:tunnel-auto-disabled` SSE event with `{ failures, windowMs, ip }`, calls `options.onTunnelAutoDisable` callback, sets `tunnelAutoDisabled=true` to prevent repeated fires. Counter only tracks tunnel-originated requests (loopback 401s are excluded).

### POST /daemon/enable-tunnel (D-01, D-04)
Requires loopback bearer auth (tunnel callers see 404 from allowlist). Body: `{ provider, authtoken?, domain? }`. Stops existing tunnel if running, persists settings via `writeTunnelSettings`, starts new tunnel via `getTunnelProvider`, awaits `waitUntilReady`, publishes `daemon:tunnel-started` SSE, resets `tunnelAutoDisabled` flag. Unknown provider throws via registry — Express error handler returns 500.

### POST /daemon/disable-tunnel (D-05)
Stops active tunnel, writes `enabled: false` to tunnel-settings.json, calls `onTunnelUrlChange(null)`, publishes `daemon:tunnel-stopped` SSE.

### GET /daemon/health tunnelUrl (TUNNEL-02)
Added `tunnelUrl: activeTunnel?.getState?.()?.url ?? null` field to health response. Returns `null` when no tunnel is active.

### stop() tunnel cleanup
`runShutdownStep('tunnel-stop', ...)` added as the first shutdown step before SSE clients are closed — allows the tunnel to publish a final event before SSE connections drop.

## Verification Results

- `pnpm -F airtable-user-mcp test --test-name-pattern="tunnel allowlist"` — all 8 tests GREEN
- `pnpm -F airtable-user-mcp test` — 212 tests, 0 failures, 0 skipped

### Allowlist behavior confirmed:
- `tunnel GET /daemon/health` → 404
- `tunnel GET /daemon/events` → 404
- `tunnel POST /daemon/heartbeat` → 404
- `tunnel POST /daemon/rotate-token` → 404
- `tunnel POST /daemon/enable-tunnel` → 404
- `tunnel POST /daemon/disable-tunnel` → 404
- `loopback GET /daemon/health` (no tunnel headers) → 200
- `tunnel POST /mcp` → not blocked (passes through allowlist)

### Endpoint behavior confirmed:
- `POST /daemon/enable-tunnel` with unknown provider → 500 (not 404 — endpoint exists)
- `POST /daemon/disable-tunnel` without auth → 401 (not 404 — endpoint exists)

## Deviations from Plan

### Minor implementation variance — track401Burst internal guard

The PATTERNS.md approach places `if (!isTunnelRequest(req)) return;` as the first line of `track401Burst()` (guard inside the function). The plan task description described calling `track401Burst(req)` unconditionally in `requireBearer` with the guard inside. Both PATTERNS.md and the plan task description agree on this pattern. Implementation follows PATTERNS.md exactly.

No other deviations. Plan executed as written.

## Threat Surface Scan

No new network endpoints or auth paths beyond those specified in the plan's threat model.

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All new endpoints (enable-tunnel, disable-tunnel) are covered by T-07-12 in the plan threat model |

## Self-Check: PASSED

- packages/mcp-server/src/daemon/server.js — FOUND
- Commit 5e81e4b — present in git log
- 212 tests pass, 0 failures
