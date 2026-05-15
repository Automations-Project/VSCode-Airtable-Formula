---
phase: 07-tunnel-support
plan: "07"
subsystem: shared
tags: [types, tunnel, webview-protocol, typescript]
dependency_graph:
  requires: [07-06]
  provides: [TunnelState, TunnelProviderId, WebviewMessage tunnel variants]
  affects: [packages/extension/src/webview/DashboardProvider.ts, packages/webview/src/tabs/Setup.tsx]
tech_stack:
  added: []
  patterns: [discriminated union extension, optional DashboardState field]
key_files:
  created: []
  modified:
    - packages/shared/src/types.ts
    - packages/shared/src/messages.ts
decisions:
  - Inserted TunnelState types immediately before DashboardState to mirror BrowserDownloadState/BrowserDownloadStatus placement pattern
  - tunnel? field is optional (undefined when daemon not running) following the same pattern as debug? and storage?
  - authtoken in tunnel:enable is optional (only required for ngrok provider) per T-07-20 acceptance
metrics:
  duration: "~5 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 07 Plan 07: Shared TunnelState Types Summary

Established the shared TypeScript type contract for tunnel state — four new exported types in `types.ts` and three new `WebviewMessage` variants in `messages.ts` — enabling Plan 08 (DashboardProvider) and Plan 09 (Setup.tsx) to consume tunnel state with full type safety.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add TunnelState types to types.ts | 91a8a28 | packages/shared/src/types.ts |
| 2 | Add tunnel WebviewMessage variants to messages.ts | 91a8a28 | packages/shared/src/messages.ts |

## What Was Built

### types.ts additions

Four new exported types inserted before `DashboardState`:

- `TunnelProviderId` — `'cf-quick' | 'ngrok' | 'cf-named'`
- `TunnelStatus` — `'disabled' | 'starting' | 'active' | 'auto-disabled' | 'error'`
- `TunnelAutoDisabledReason` — `{ failures, windowMs, ip }` (circuit-breaker context)
- `TunnelState` — `{ status, url, provider, ngrokAuthtokenSet, autoDisabledReason }`

`DashboardState.tunnel?: TunnelState` added as the last optional field.

### messages.ts additions

Import updated: `TunnelProviderId` added to the named import from `'./types.js'`.

Three new `WebviewMessage` union members:
- `tunnel:enable` — `{ id, provider: TunnelProviderId, authtoken?, domain? }`
- `tunnel:disable` — `{ id }`
- `tunnel:set-ngrok-authtoken` — `{ id, authtoken }`

## Verification

- `pnpm -F shared build` exits 0 (both before and after each task)
- `pnpm test` exits 0 — all packages pass (check-tool-sync, shared, language-services, mcp-server, webview, extension)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan adds types only; no runtime logic or UI rendering.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. Type-only changes. Threat register entries T-07-19 and T-07-20 noted; mitigations delegated to Plan 08 (DashboardProvider validation) and Plan 10 (daemon) as specified.

## Self-Check: PASSED

- packages/shared/src/types.ts — FOUND (modified)
- packages/shared/src/messages.ts — FOUND (modified)
- Commit 91a8a28 — FOUND
