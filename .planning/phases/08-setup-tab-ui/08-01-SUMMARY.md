---
phase: "08-setup-tab-ui"
plan: "01"
subsystem: "shared-types + webview-tests"
tags: ["types", "daemon-status", "wave-0-tests", "security"]
dependency_graph:
  requires: []
  provides:
    - "DaemonStatusInfo interface in packages/shared/src/types.ts"
    - "daemon?: DaemonStatusInfo in DashboardState"
    - "Wave 0 test suite for Setup.tsx helpers (formatUptime, getMcpSnippet, getLspSnippet)"
  affects:
    - "packages/webview/src/store.ts (daemon field auto-picked up via Store extends DashboardState)"
    - "packages/extension/src/webview/DashboardProvider.ts (will need daemon: field in pushState in Plan 02)"
tech_stack:
  added: []
  patterns:
    - "Extension-private type stripping: DaemonStatus → DaemonStatusInfo drops bearerToken and pid"
    - "Wave 0 TDD: tests created RED before implementation exists in Plans 03-05"
key_files:
  created:
    - "packages/webview/src/test/setup.test.tsx"
  modified:
    - "packages/shared/src/types.ts"
    - "packages/webview/src/test/store.test.ts"
decisions:
  - "DaemonStatusInfo defined as standalone interface (not re-export of DaemonStatus) to avoid importing vscode-dependent code in shared package"
  - "6 fields only: running, healthy, port, port_lsp, tunnelUrl, uptime — bearerToken and pid intentionally excluded (T-08-01, T-08-02)"
  - "setup.test.tsx tests left RED (Wave 0) — formatUptime/getMcpSnippet/getLspSnippet implemented in Plans 03-05"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 08 Plan 01: Type Definitions, Store Integration, and Pure Helpers Summary

DaemonStatusInfo interface added to shared types with bearerToken/pid excluded; Wave 0 test suite created covering all pure helper contracts before implementation.

## What Was Built

### Task 1: DaemonStatusInfo interface + daemon field (commit 9c33974)

Added `DaemonStatusInfo` as a new standalone exported interface to `packages/shared/src/types.ts`:

```typescript
export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;         // result of /daemon/health HTTP check
  port:      number | null;   // MCP HTTP port
  port_lsp:  number | null;   // LSP TCP port — null when LSP not started
  tunnelUrl: string | null;   // active tunnel URL or null
  uptime:    number | null;   // milliseconds since daemon startedAt, or null
  // bearerToken intentionally excluded — must never reach webview (D-07, T-08-01)
  // pid intentionally excluded — not needed in webview (T-08-02)
}
```

Added `daemon?: DaemonStatusInfo` to `DashboardState` immediately after `tunnel?: TunnelState` (D-05 ordering). `pnpm -F shared build` exits 0.

### Task 2: Wave 0 test suite (commit e034578)

**store.test.ts extensions:**
- Added `daemon: undefined` to `beforeEach` reset (prevents state bleed)
- Added `describe('store daemon field')` block with 2 tests: `applyState` with daemon payload populates `store.daemon`, `applyState` without daemon leaves `daemon` undefined
- Both tests GREEN (10 total store tests passing)

**setup.test.tsx created (RED — Wave 0):**
- 23 tests covering `formatUptime` (6 cases: null, 0ms, 30s, 2m30s, 2h15m, 1h0m), `getMcpSnippet` bearer token security gate (5 IDEs × HTTP must contain `{{BEARER_TOKEN}}`), `getMcpSnippet` port handling (6 cases including Windsurf/Cursor/Claude Code key differences), `getLspSnippet` port handling (6 cases including Neovim TCP/stdio API distinction, Zed `--tcp-client`)
- All 23 tests RED until Plans 03-05 implement `formatUptime`, `getMcpSnippet`, `getLspSnippet` as named exports from `Setup.tsx`

## Verification Results

```
pnpm -F shared build          → 0 (DTS: 6.48 KB, ESM: 0 B)
pnpm -F webview test          → store.test.ts: 10/10 PASS
                                setup.test.tsx: 0/23 PASS (expected RED, Wave 0)
```

## Deviations from Plan

None — plan executed exactly as written. The Wave 0 RED state for setup.test.tsx is the intended outcome per plan spec.

## Security Verification

- T-08-01 (Information Disclosure): `DaemonStatusInfo` has no `bearerToken` field. Verified: `grep bearerToken packages/shared/src/types.ts` returns only the comment in the interface (intentional exclusion note).
- T-08-02 (Information Disclosure): `DaemonStatusInfo` has no `pid` field. Verified: interface definition contains exactly 6 fields.
- setup.test.tsx security gate: `getMcpSnippet bearer token` describe block asserts all 5 HTTP IDEs produce snippets containing `{{BEARER_TOKEN}}` — this test will enforce the invariant when Plans 04/05 implement the function.

## Known Stubs

None — this plan delivers types and tests only. No runtime stubs.

## Self-Check: PASSED

Files exist:
- `packages/shared/src/types.ts` — FOUND (modified)
- `packages/webview/src/test/store.test.ts` — FOUND (modified)
- `packages/webview/src/test/setup.test.tsx` — FOUND (created)

Commits exist:
- `9c33974` feat(08-01): add DaemonStatusInfo interface and daemon field to DashboardState
- `e034578` test(08-01): extend store.test.ts with daemon field + create Wave 0 setup.test.tsx
