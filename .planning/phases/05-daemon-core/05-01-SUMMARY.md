---
phase: 05-daemon-core
plan: "01"
subsystem: test-scaffolds
tags: [tdd, test-scaffolds, daemon, mcp-server, extension]
dependency_graph:
  requires: []
  provides:
    - test-scaffolds/lockfile (DAEMON-04)
    - test-scaffolds/token (DAEMON-07)
    - test-scaffolds/daemon-server (DAEMON-05)
    - test-scaffolds/daemon-attach (DAEMON-01)
    - test-scaffolds/daemon-manager-ext (EXT-01, EXT-03)
  affects:
    - packages/mcp-server/test/
    - packages/extension/src/test/
tech_stack:
  added: []
  patterns:
    - node:test with describe/it/before/after for mcp-server tests
    - vitest with vi.mock('vscode') for extension tests
    - TDD RED state — all scaffold files import non-existent implementation modules
key_files:
  created:
    - packages/mcp-server/test/test-lockfile.test.js
    - packages/mcp-server/test/test-token.test.js
    - packages/mcp-server/test/test-daemon-server.test.js
    - packages/mcp-server/test/test-daemon-attach.test.js
    - packages/extension/src/test/daemon-manager.test.ts
  modified: []
decisions:
  - "test-daemon-attach.test.js uses only node:test built-ins (no impossible imports) so it fails with assertion errors, not ERR_MODULE_NOT_FOUND — preserves ability to verify stubs run"
  - "daemon-manager.test.ts imports both DaemonManager and createHttpDefinition to cover both EXT-01 and EXT-03 in a single file"
  - "Fixed async/await syntax error in createHttpDefinition test (await outside async) — changed it() to async it()"
metrics:
  duration: "4m 15s"
  completed: "2026-05-14T16:56:30Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 0
---

# Phase 05 Plan 01: TDD Scaffold — Daemon Core Test Stubs Summary

Five Wave-0 test scaffold files establishing the TDD RED state for the daemon-core feature. All scaffold files import not-yet-written implementation modules, causing test failures that Wave 2–7 executors must resolve.

## What Was Built

Five test scaffold files covering all daemon-core requirements:

| File | Requirements | RED Mechanism |
|------|-------------|---------------|
| `test-lockfile.test.js` | DAEMON-04 | ERR_MODULE_NOT_FOUND (daemon/lockfile.js) |
| `test-token.test.js` | DAEMON-07 | ERR_MODULE_NOT_FOUND (daemon/token.js) |
| `test-daemon-server.test.js` | DAEMON-05 | ERR_MODULE_NOT_FOUND (daemon/server.js) |
| `test-daemon-attach.test.js` | DAEMON-01 | Assertion failures (NOT YET IMPLEMENTED) |
| `daemon-manager.test.ts` | EXT-01, EXT-03 | Failed URL load (daemon-manager.js missing) |

## Test Coverage by Requirement

**DAEMON-01** (test-daemon-attach.test.js):
- `AIRTABLE_NO_DAEMON` env var checked before lockfile read
- When set, stdio MCP server runs in-process without daemon

**DAEMON-04** (test-lockfile.test.js):
- `acquire`: first acquire returns true + writes lockfile
- `acquire`: returns false when lockfile exists and PID is alive
- `acquire`: reclaims stale lockfile (dead PID)
- `read`: returns parsed DaemonLockRecord from disk
- `isStale`: returns true for dead PID, false for live PID
- `release`: removes lockfile from disk

**DAEMON-05** (test-daemon-server.test.js):
- `startDaemonServer`: binds port, returns object with bearerToken + stop()
- `/daemon/health`: returns 200 with uptime JSON when correct bearer token provided
- `/daemon/health`: returns 401 when Authorization header missing
- `/daemon/events`: returns 401 when bearer token is wrong

**DAEMON-07** (test-token.test.js):
- `ensureToken`: creates daemon.token on first call with valid bearerToken
- `ensureToken`: returns existing token on second call without changing it
- `rotateToken`: writes new token with incremented version
- `rotateToken`: bearerToken differs after rotation

**EXT-01** (daemon-manager.test.ts):
- `createHttpDefinition`: returns null when McpHttpServerDefinition not on vscode namespace
- `createHttpDefinition`: calls constructor with url and headers when McpHttpServerDefinition present

**EXT-03** (daemon-manager.test.ts):
- `buildDaemonEnv`: includes AIRTABLE_USER_MCP_HOME set to configDir
- `buildDaemonEnv`: includes AIRTABLE_HEADLESS_ONLY equal to "1"
- `buildDaemonEnv`: merges credEnv keys on top of base env
- `getDaemonStatus`: returns running:false when daemon.lock does not exist
- `probeHealth`: returns false when getDaemonStatus returns running:false

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 18a2e2e | test(05-01): add RED scaffold tests for lockfile, token, daemon-server |
| Task 2 | c5dc52e | test(05-01): add RED scaffold tests for daemon-attach and daemon-manager |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed async/await syntax error in daemon-manager.test.ts**
- **Found during:** Task 2 verification (vitest run)
- **Issue:** `await import('vscode')` used inside a non-async `it()` callback — esbuild Transform failed with "await can only be used inside an async function"
- **Fix:** Changed the `it()` callback to `async it()` for the `createHttpDefinition` test that uses dynamic import
- **Files modified:** `packages/extension/src/test/daemon-manager.test.ts`
- **Commit:** c5dc52e (included in same task commit)

## Verification Results

- `node --test test-lockfile.test.js` → ERR_MODULE_NOT_FOUND (daemon/lockfile.js)
- `node --test test-token.test.js` → ERR_MODULE_NOT_FOUND (daemon/token.js)
- `node --test test-daemon-server.test.js` → ERR_MODULE_NOT_FOUND (daemon/server.js)
- `node --test test-daemon-attach.test.js` → 2 assertion failures (NOT YET IMPLEMENTED)
- `pnpm -F airtable-formula test` → daemon-manager.test.ts fails (Failed to load url ../mcp/daemon-manager.js)
- All 4 pre-existing extension test files: 43 tests PASS

## Known Stubs

All test bodies in this plan are intentional stubs. The RED state is by design — implementation follows in Waves 2–7. Each stub is explicitly documented with "NOT YET IMPLEMENTED — will pass after Wave N implementation".

## Threat Surface Scan

No production code was added. Test-only scaffolds. No new network endpoints, auth paths, or file access patterns introduced. T-05-01-01 accepted: tests use os.tmpdir() paths with process.pid suffix — no real credentials.

## Self-Check: PASSED

Files created:
- FOUND: packages/mcp-server/test/test-lockfile.test.js
- FOUND: packages/mcp-server/test/test-token.test.js
- FOUND: packages/mcp-server/test/test-daemon-server.test.js
- FOUND: packages/mcp-server/test/test-daemon-attach.test.js
- FOUND: packages/extension/src/test/daemon-manager.test.ts

Commits verified:
- FOUND: 18a2e2e (test(05-01): add RED scaffold tests for lockfile, token, daemon-server)
- FOUND: c5dc52e (test(05-01): add RED scaffold tests for daemon-attach and daemon-manager)
