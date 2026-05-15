---
phase: 07-tunnel-support
plan: 08
subsystem: ui
tags: [vscode-extension, dashboard, webview, tunnel, daemon, secret-storage]

# Dependency graph
requires:
  - phase: 07-tunnel-support/07-07
    provides: TunnelState + TunnelAutoDisabledReason types in shared package; tunnel WebviewMessage variants in messages.ts
  - phase: 07-tunnel-support/07-05
    provides: daemon HTTP endpoints /daemon/enable-tunnel and /daemon/disable-tunnel; DaemonManager with getDaemonStatus()
provides:
  - DashboardProvider with setDaemonManager() wiring following existing setXxxManager pattern
  - tunnel:set-ngrok-authtoken message handler storing token in VS Code SecretStorage
  - tunnel:enable message handler reading ngrok authtoken from SecretStorage (T-07-21 mitigation)
  - tunnel:disable message handler posting to /daemon/disable-tunnel
  - _computeTunnelState() reading tunnel-settings.json + daemon.lock + SecretStorage
  - auto-disabled detection: status 'auto-disabled' when enabled===false && autoDisabled===true
  - DashboardState.tunnel populated in pushState()
  - public disableTunnel() method for VS Code command handler
  - airtableFormula.tunnel.disable command registered in extension.ts
affects: [07-09, webview-tunnel-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Extension acts as secure intermediary for all tunnel operations (ngrok authtoken never touches disk via this path)
    - setDaemonManager() follows same dependency injection pattern as setAuthManager() and setToolProfileManager()
    - _computeTunnelState() uses synchronous fs for lockfile reads inside an async wrapper (consistent with _computeStorageInfo pattern)

key-files:
  created: []
  modified:
    - packages/extension/src/webview/DashboardProvider.ts
    - packages/extension/src/extension.ts

key-decisions:
  - "Extension reads ngrok authtoken from SecretStorage internally in tunnel:enable handler — webview never needs to send it (T-07-21 mitigated)"
  - "autoDisabledReason.windowMs defaults to 0 when not present in tunnel-settings.json — matches TunnelAutoDisabledReason interface without requiring daemon to always write this field"
  - "disableTunnel() is a public method on DashboardProvider so the VS Code command handler can call it directly without going through the webview IPC path"

patterns-established:
  - "setDaemonManager pattern: private _daemonManager field + public setter with no callback (no state subscription needed — pushState reads fresh on demand)"
  - "Tunnel state computed fresh on each pushState() call from disk files — no caching, ensures auto-disabled state is always current"

requirements-completed: [TUNNEL-01, TUNNEL-02, TUNNEL-03]

# Metrics
duration: 15min
completed: 2026-05-15
---

# Phase 7 Plan 08: Tunnel Handlers and DashboardProvider Wiring Summary

**DashboardProvider wired to DaemonManager with three tunnel IPC handlers, _computeTunnelState() with auto-disabled detection, and airtableFormula.tunnel.disable VS Code command**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-15T12:40:00Z
- **Completed:** 2026-05-15T12:55:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- DashboardProvider gains `setDaemonManager()` dependency injection following the existing `setAuthManager`/`setToolProfileManager` pattern
- Three tunnel message handlers wired in `handleMessage()`: `tunnel:set-ngrok-authtoken` (stores in SecretStorage), `tunnel:enable` (reads authtoken from SecretStorage for ngrok, POSTs to daemon), `tunnel:disable` (POSTs to daemon)
- `_computeTunnelState()` reads `tunnel-settings.json` for provider/enabled/autoDisabled/autoDisabledReason, `daemon.lock` for tunnelUrl, and SecretStorage for ngrokAuthtokenSet — returns correct `TunnelStatus` including `'auto-disabled'` for 401-burst warning banner
- `DashboardState.tunnel` populated in `pushState()` with fresh state on every refresh
- `airtableFormula.tunnel.disable` VS Code command registered in extension.ts, calling `dashboardProvider.disableTunnel()` (D-05 pattern)

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Tunnel handlers, _computeTunnelState, setDaemonManager, extension wiring** - `dae4a88` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `packages/extension/src/webview/DashboardProvider.ts` - Added DaemonManager import, `_daemonManager` field, `setDaemonManager()`, three tunnel message handlers, `_computeTunnelState()`, `disableTunnel()`, and `tunnel` field in `pushState()`
- `packages/extension/src/extension.ts` - Added `provider.setDaemonManager(daemonManager)` wiring call; registered `airtableFormula.tunnel.disable` command

## Decisions Made
- Used synchronous `fs.existsSync` / `fs.readFileSync` inside `_computeTunnelState()` (wrapped in async for interface consistency) — same pattern as `_computeStorageInfo()` for lockfile reads that are expected to be fast local disk access
- `autoDisabledReason.windowMs` defaults to `0` when absent from `tunnel-settings.json` — the `TunnelAutoDisabledReason` interface requires it but the daemon may not always write it; a zero default is safe and avoids a TypeScript error
- Tasks 1 and 2 committed together since they form a single atomic unit (DashboardProvider changes only become useful after extension.ts wires them)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added windowMs field to TunnelAutoDisabledReason construction**
- **Found during:** Task 1 (_computeTunnelState implementation)
- **Issue:** Plan's code sample omitted `windowMs` from the `autoDisabledReason` object, but `TunnelAutoDisabledReason` interface requires it — TypeScript would fail to compile
- **Fix:** Added `windowMs: typeof settings.autoDisabledReason.windowMs === 'number' ? settings.autoDisabledReason.windowMs : 0` when constructing the object
- **Files modified:** packages/extension/src/webview/DashboardProvider.ts
- **Verification:** `pnpm -F airtable-formula build` exits 0; no TypeScript errors
- **Committed in:** dae4a88 (task commit)

---

**Total deviations:** 1 auto-fixed (1 type correctness bug)
**Impact on plan:** Fix was necessary for TypeScript compilation. No scope change.

## Issues Encountered
None beyond the missing `windowMs` field handled above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DashboardProvider is fully wired for tunnel operations — webview can now send `tunnel:enable`, `tunnel:disable`, and `tunnel:set-ngrok-authtoken` messages and receive state updates
- `_computeTunnelState()` correctly surfaces `'auto-disabled'` status for the warning banner UI (Plan 07-09)
- `airtableFormula.tunnel.disable` command is registered and functional
- Ready for Plan 07-09: Webview tunnel UI tab implementation

---
*Phase: 07-tunnel-support*
*Completed: 2026-05-15*
