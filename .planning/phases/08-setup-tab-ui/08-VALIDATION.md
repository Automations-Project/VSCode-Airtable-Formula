---
phase: 8
slug: setup-tab-ui
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.6.0 |
| **Config file** | `vite.config.ts` (webview package) |
| **Quick run command** | `pnpm -F webview vitest run` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F webview vitest run`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | UI-01 | — | N/A | unit | `pnpm -F webview vitest run -t "daemon"` | ❌ Wave 0 | ⬜ pending |
| 08-01-02 | 01 | 1 | UI-01 | — | formatUptime null/min/hours | unit | `pnpm -F webview vitest run -t "formatUptime"` | ❌ Wave 0 | ⬜ pending |
| 08-01-03 | 03 | 2 | UI-01 | — | daemon block hidden when not running | unit | `pnpm -F webview vitest run -t "DaemonStatusBlock"` | ❌ Wave 0 | ⬜ pending |
| 08-01-04 | 03 | 2 | UI-01 | — | LSP port row hidden when null | unit | `pnpm -F webview vitest run -t "lsp port row"` | ❌ Wave 0 | ⬜ pending |
| 08-02-01 | 04 | 3 | UI-02 | T-08-01 | HTTP snippet contains {{BEARER_TOKEN}} | unit | `pnpm -F webview vitest run -t "bearer token"` | ❌ Wave 0 | ⬜ pending |
| 08-02-02 | 04 | 3 | UI-02 | — | MCP HTTP snippet uses live port | unit | `pnpm -F webview vitest run -t "mcp port"` | ❌ Wave 0 | ⬜ pending |
| 08-03-01 | 05 | 3 | UI-03 | — | LSP TCP uses live port_lsp | unit | `pnpm -F webview vitest run -t "lsp port snippet"` | ❌ Wave 0 | ⬜ pending |
| 08-03-02 | 05 | 3 | UI-02+UI-03 | — | N/A | unit | `pnpm -F webview vitest run -t "copy"` | ❌ Wave 0 | ⬜ pending |
| 08-04-01 | 02 | 2 | UI-01 | T-08-02 | bearerToken/pid stripped from DaemonStatusInfo | manual | inspect DashboardState.daemon in devtools | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/webview/src/test/store.test.ts` — extend with `daemon: undefined` reset + `applyState` with daemon field test + `formatUptime` pure function tests
- [ ] `packages/webview/src/test/setup.test.tsx` — new file: daemon block visibility, bearer token placeholder assertion, copy state behavior

*Note: `@testing-library/react` is NOT in webview devDependencies. Keep all new tests at pure-function/store level to match existing test style.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `bearerToken` and `pid` not in DashboardState.daemon | UI-01 | Extension host — DashboardProvider._computeDaemonStatusInfo() cannot be unit-tested without VS Code runtime | Open VS Code, trigger pushState, inspect state in webview devtools → `state.daemon` must lack bearerToken and pid fields |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
