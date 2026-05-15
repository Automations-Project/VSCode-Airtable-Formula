---
phase: "08"
plan: "03"
subsystem: webview
tags: [ui, setup-tab, daemon-status, wave-2]
dependency_graph:
  requires: ["08-01"]
  provides: ["formatUptime export", "DaemonStatusBlock panel", "getMcpSnippet stub", "getLspSnippet stub"]
  affects: ["packages/webview/src/tabs/Setup.tsx"]
tech_stack:
  added: []
  patterns: ["glass-panel + section-header", "chip-ok/chip-warn health chip", "list-row key-value", "conditional rendering via daemon?.running"]
key_files:
  modified:
    - packages/webview/src/tabs/Setup.tsx
decisions:
  - "formatUptime signature accepts number|null|undefined — handles both null and undefined gracefully"
  - "getMcpSnippet and getLspSnippet are stub-exported at module scope so Wave 0 tests can import them without module errors"
  - "DaemonStatusBlock uses daemon?.running (not daemon &&) as the visibility gate per D-01"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
---

# Phase 8 Plan 03: Daemon Status Block UI + formatUptime helper Summary

Exported `formatUptime` pure function plus `getMcpSnippet`/`getLspSnippet` stubs from Setup.tsx, and added `DaemonStatusBlock` as the first glass-panel in the Setup tab — hidden when daemon not running, health chip and four key-value rows when visible.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Export formatUptime + stubs | `9574049` | packages/webview/src/tabs/Setup.tsx |
| 2 | DaemonStatusBlock as first panel | `fabeec6` | packages/webview/src/tabs/Setup.tsx |

## What Was Built

### formatUptime (exported named function)

Pure function at module scope, before the `Setup` component declaration. Handles:
- `null` / `undefined` → `"—"`
- `< 60_000` ms → `"< 1m"`
- `60_000–3_599_999` ms → `"Nm Ss"` (e.g., `"2m 30s"`)
- `>= 3_600_000` ms → `"Hh Mm"` (e.g., `"2h 15m"`)

All 6 Wave 0 `formatUptime` tests pass.

### getMcpSnippet / getLspSnippet stubs

Both exported as named module-scope functions returning `''`. This allows `setup.test.tsx` to import without errors. Tests for these functions are intentionally RED until Plans 04 and 05 implement the bodies.

### DaemonStatusBlock panel

Inserted as the first child of `<div className="stack stack-lg">` in the Setup component JSX, before the Tunnel section. Structure:

- `glass-panel` wrapper (identical to all other panels)
- `section-header` with eyebrow `"Daemon"`, title `"MCP Server Status"`, detail `"Local daemon running on this machine"`
- Health chip: `chip-ok` for `daemon.healthy === true`, `chip-warn` otherwise
- `stack stack-sm` with 4 rows:
  - MCP Port (always shown)
  - LSP Port (hidden when `daemon.port_lsp === null`)
  - Tunnel URL (hidden when `daemon.tunnelUrl` is falsy, with ellipsis overflow)
  - Uptime (always shown, uses `formatUptime(daemon.uptime)`)
- Whole block guarded by `daemon?.running &&` (D-01: no offline placeholder)

`daemon` was added to the existing `useStore()` destructure — no second call added.

## Test Results

```
pnpm -F webview vitest run -t "formatUptime"  → 6/6 PASS
pnpm -F webview vitest run (full suite)       → 16 pass, 17 fail (all failures are expected getMcpSnippet/getLspSnippet stubs — Plans 04/05)
store.test.ts                                  → 10/10 PASS (no regressions)
```

## Deviations from Plan

None — plan executed exactly as written.

The `formatUptime` signature was widened from `number | null` to `number | null | undefined` (Rule 2: handles both null and undefined from the `DaemonStatusInfo.uptime` field), which is strictly safer and does not change any test expectations.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `getMcpSnippet` returns `''` | packages/webview/src/tabs/Setup.tsx:23 | Plan 04 implements full body |
| `getLspSnippet` returns `''` | packages/webview/src/tabs/Setup.tsx:28 | Plan 05 implements full body |

These stubs prevent Plans 04/05 tests from failing with module-not-found errors. The Wave 0 tests for these functions are RED until their respective plans execute.

## Threat Flags

None — DaemonStatusBlock renders only port numbers, uptime, and tunnelUrl (all non-sensitive). Bearer token and pid are not in `DaemonStatusInfo`. No user input flows into the block.

## Self-Check: PASSED

- [x] `packages/webview/src/tabs/Setup.tsx` modified — confirmed
- [x] `formatUptime` exported at module scope — confirmed (line 9)
- [x] `getMcpSnippet` exported stub — confirmed (line 23)
- [x] `getLspSnippet` exported stub — confirmed (line 28)
- [x] `daemon` in useStore destructure — confirmed (line 33)
- [x] `daemon?.running &&` gate — confirmed (line 91)
- [x] DaemonStatusBlock is first panel (before Tunnel section at line 140) — confirmed
- [x] Commit `9574049` exists — Task 1
- [x] Commit `fabeec6` exists — Task 2
