---
phase: 06-lsp-server
plan: 04
subsystem: daemon
tags: [daemon, lsp, subprocess, lifecycle, sigterm, launcher, server]

# Dependency graph
requires:
  - phase: 06-03
    provides: LSP binary (dist/index.mjs) that daemon will spawn; lockfile-writer.ts writes port_lsp
  - phase: 05
    provides: launcher.js and server.js daemon infrastructure
provides:
  - launcher.js: lspChild spawn after syncLockfile(); SIGTERM in finalize() and server.setLspChild()
  - server.js: 'lsp-child' shutdown step in stop(); setLspChild() method on returned object
affects: [06-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "lspChild declared before finalize() closure so closure captures mutable reference"
    - "Setter pattern: setLspChild(child) on server object — LSP child registered post-spawn"
    - "Dual SIGTERM paths: finalize() for SIGINT/SIGTERM signal; stop() for HTTP /daemon/shutdown"
    - "Non-fatal spawn: try/catch around lsp binary resolution; daemon continues with port_lsp=null"
    - "Binary candidate list: extension dist path first, workspace install path second"

key-files:
  created: []
  modified:
    - packages/mcp-server/src/daemon/launcher.js
    - packages/mcp-server/src/daemon/server.js

key-decisions:
  - "lspChild declared at top of try block (before finalize closure) — necessary for closure capture"
  - "Setter pattern (setLspChild) chosen over passing lspChild at startDaemonServer() call time — spawn happens after server starts, cannot be passed at construction"
  - "Dual SIGTERM paths are correct and non-conflicting — lspChild?.kill() is idempotent after process exit"
  - "server.setLspChild() called conditionally (if available) in launcher.js — forward-compatible pattern"

requirements-completed: [LSP-04, LSP-05]

# Metrics
duration: 10min
completed: 2026-05-14
---

# Phase 06 Plan 04: LSP Daemon Integration Summary

**LSP subprocess lifecycle wired into daemon: launcher.js spawns airtable-user-lsp --tcp after syncLockfile() with AIRTABLE_USER_MCP_HOME, holds tracked child reference, and SIGTERMs it via both finalize() and server.stop() shutdown paths**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-14T23:30:00Z
- **Completed:** 2026-05-14T23:40:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `let lspChild = null` declaration before the `finalize()` closure in `startDaemon()` so the closure correctly captures the mutable reference
- Added LSP subprocess spawn block after `syncLockfile(server.bearerToken)` with two binary candidate paths (extension dist `lsp/index.mjs`, workspace `lsp-server/dist/index.mjs`)
- Spawn is NOT detached (no `detached: true`, no `.unref()`) — daemon holds the reference for SIGTERM (D-02)
- `lspChild?.kill('SIGTERM')` added to `finalize()` before `release()` — handles SIGINT/SIGTERM signal path
- Error and exit event handlers make spawn non-fatal: daemon continues with `port_lsp=null` if binary absent
- Added `'lsp-child'` shutdown step to `stop()` in server.js (after `'on-shutdown'`, before `'http-close'`) — handles HTTP `/daemon/shutdown` path
- Exposed `setLspChild(child)` on the object returned by `startDaemonServer()` — setter pattern used because spawn happens after `startDaemonServer()` returns
- All 193 mcp-server tests pass; extension build green; both files pass Node.js import syntax check

## Task Commits

Each task was committed atomically:

1. **Task 1: Add LSP subprocess spawn to startDaemon() in launcher.js** - `3ce5e90` (feat)
2. **Task 2: Wire lspChild SIGTERM into server.js stop() shutdown sequence** - `f9b629d` (feat)

## Files Created/Modified

- `packages/mcp-server/src/daemon/launcher.js` — `lspChild` declaration, spawn block with binary candidates and event handlers, `lspChild?.kill('SIGTERM')` in finalize(), `server.setLspChild(lspChild)` call
- `packages/mcp-server/src/daemon/server.js` — `'lsp-child'` shutdown step in `stop()`, `setLspChild(child)` method on returned server object

## Decisions Made

- Setter pattern chosen over passing `lspChild` at `startDaemonServer()` call time — the spawn happens after the server starts and `syncLockfile()` runs, so the child reference isn't available at construction time
- Both SIGTERM paths (finalize + stop) are correct and non-conflicting. `lspChild?.kill()` after the process has already exited is a no-op. This covers both graceful signal shutdown and HTTP-triggered shutdown.
- Binary candidate list uses extension bundle path first (primary deployment), workspace path second (development). No npx fallback added — if binary not in expected locations, daemon logs and continues; this matches the non-fatal requirement.

## Deviations from Plan

None - plan executed exactly as written.

The plan specified "CHANGE 3 — Call server.setLspChild(lspChild) in launcher.js" as part of Task 2's action section, but it was naturally included in Task 1's spawn block as `if (server.setLspChild) server.setLspChild(lspChild);` — this is the correct commit grouping since the spawn and setter call belong together logically.

## Threat Model Coverage

All three threats mitigated as specified:

- **T-06-04-01 (DoS — LSP spawn failure):** Wrapped in try/catch; daemon continues with port_lsp=null
- **T-06-04-02 (Tampering — AIRTABLE_USER_MCP_HOME):** Accepted — local trusted processes, cooperative lockfile write
- **T-06-04-03 (EoP — lspChild.kill SIGTERM):** Accepted — standard child process lifecycle management

## Self-Check

- [x] `packages/mcp-server/src/daemon/launcher.js` contains "airtable-user-lsp" (2 occurrences)
- [x] `packages/mcp-server/src/daemon/launcher.js` contains `lspChild?.kill('SIGTERM')`
- [x] `packages/mcp-server/src/daemon/launcher.js` contains `AIRTABLE_USER_MCP_HOME: configDir` in spawn env
- [x] `packages/mcp-server/src/daemon/launcher.js` does NOT use `detached: true` for lspChild
- [x] `packages/mcp-server/src/daemon/launcher.js` does NOT call `.unref()` on lspChild
- [x] `packages/mcp-server/src/daemon/server.js` contains "lsp-child" shutdown step
- [x] `packages/mcp-server/src/daemon/server.js` contains `setLspChild` method
- [x] Commit `3ce5e90` exists (Task 1: launcher.js LSP spawn)
- [x] Commit `f9b629d` exists (Task 2: server.js lsp-child shutdown step)
- [x] Both files pass `node -e "import(...)"` syntax check
- [x] `pnpm -F airtable-user-mcp test` — 193 tests pass, 0 fail
- [x] `pnpm -F airtable-formula build` — extension build green (run from main repo)

## Self-Check: PASSED

---
*Phase: 06-lsp-server*
*Completed: 2026-05-14*
