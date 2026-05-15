---
phase: "08-setup-tab-ui"
plan: "05"
subsystem: webview
tags: [ui, lsp, snippets, setup-tab]
title: "LSP Config Snippets Section"

dependency_graph:
  requires:
    - "08-01"   # DaemonStatusInfo types + daemon field in store
    - "08-03"   # formatUptime + getLspSnippet stub declared
    - "08-04"   # lspActiveIde/lspActiveVariant state + handleCopySnippet + copiedKeys declared
  provides:
    - "getLspSnippet() full implementation"
    - "LSP snippets panel JSX in Setup.tsx"
  affects:
    - "packages/webview/src/tabs/Setup.tsx"

tech_stack:
  added: []
  patterns:
    - "Per-IDE LSP snippet generation with port interpolation"
    - "Neovim Lua format snippets (vim.lsp.config API, D-10)"
    - "Module-level constants for tab arrays (LSP_IDE_TABS, LSP_VARIANT_TABS)"

key_files:
  modified:
    - packages/webview/src/tabs/Setup.tsx

decisions:
  - "D-09: Both TCP (daemon) and stdio variants shown for every LSP IDE"
  - "D-10: Neovim uses vim.lsp.rpc.connect() for TCP and vim.lsp.config() for stdio (Neovim 0.11+ native LSP)"
  - "D-11: Claude Code uses .lsp.json plugin format with extensionToLanguage mapping"
  - "D-12: Four IDE tabs — Claude Code, OpenCode, Zed, Neovim"
  - "D-13: Two variant sub-tabs per IDE — TCP (daemon) and stdio"
  - "lspPort placeholder: daemon?.port_lsp ?? '{LSP_PORT}' — shows literal string when LSP not running"

metrics:
  duration: "~10 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 8 Plan 05: LSP Config Snippets Section Summary

Implemented `getLspSnippet()` (replacing the Plan 03 stub) and added the LSP Config Snippets panel to Setup.tsx — four IDE tabs (Claude Code, OpenCode, Zed, Neovim) with TCP/stdio sub-tabs and Neovim Lua format snippets using the Neovim 0.11+ native `vim.lsp.config` API.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement getLspSnippet() replacing Plan 03 stub | 156a848 | packages/webview/src/tabs/Setup.tsx |
| 2 | Add LSP snippets panel JSX after MCP snippets panel | 7fd844a | packages/webview/src/tabs/Setup.tsx |

## What Was Built

### Task 1 — getLspSnippet() Implementation

Replaced the one-line stub with a full per-IDE implementation:

- **Neovim TCP**: `vim.lsp.rpc.connect('127.0.0.1', {port})` with filetypes and root_markers (D-10)
- **Neovim stdio**: `vim.lsp.config()` with `cmd = { 'npx', '-y', 'airtable-user-lsp', '--stdio' }` (D-10)
- **Zed TCP**: JSON `binary.arguments: ["--tcp-client", "127.0.0.1:{port}"]` format
- **Zed stdio**: JSON `binary.arguments: ["--stdio"]` format
- **OpenCode TCP**: `opencode.json` with `initialization: { host, port }` field
- **OpenCode stdio**: `opencode.json` without initialization block
- **Claude Code TCP**: `.lsp.json` plugin format with `transport: "socket"` (D-11, partially verified)
- **Claude Code stdio**: `.lsp.json` plugin format with `extensionToLanguage` mapping (D-11, fully verified)

Port parameter is interpolated directly — when `'{LSP_PORT}'` string is passed, it renders literally with no `undefined`.

### Task 2 — LSP Snippets Panel JSX

Added to Setup.tsx (module level):
- `LSP_IDE_TABS`: Claude Code | OpenCode | Zed | Neovim (D-12)
- `LSP_VARIANT_TABS`: TCP (daemon) | stdio (D-09, D-13)

Added inside component:
- `lspPort = daemon?.port_lsp ?? '{LSP_PORT}'` constant

Added panel JSX after MCP snippets panel:
- `glass-panel` with section-header (eyebrow: "Config Snippets", title: "LSP Server")
- Outer IDE tab bar (4 tabs) with `role="tab"` + `aria-selected`
- Inner variant sub-tab bar (2 tabs, tighter `4px 8px` padding per UI-SPEC)
- `role="tabpanel"` container with `<pre><code>` snippet block and absolute-positioned copy button
- Uses `handleCopySnippet` + `copiedKeys` + `lspActiveIde` + `lspActiveVariant` declared in Plan 04

## Test Results

All 33 setup.test.tsx tests GREEN after Task 1 implementation:
- 6 `getLspSnippet lsp port snippet` tests: all pass
- 27 previously-passing tests: still pass

Full suite (`pnpm test`): 295 tests across 3 packages, 0 failures.

## Deviations from Plan

None — plan executed exactly as written. The `getLspSnippet` function body and JSX panel match the plan specification exactly.

## Known Stubs

None — all LSP snippets are fully wired. `getLspSnippet()` returns real content for all 4 IDEs × 2 variants. The `lspPort` placeholder (`{LSP_PORT}`) is intentional behavior per D-09 spec, not a stub.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's threat model covered. LSP snippets do not contain bearer tokens or sensitive data — only port numbers and static config strings.

## Self-Check: PASSED

- [x] `packages/webview/src/tabs/Setup.tsx` modified and committed
- [x] Commit 156a848 exists (getLspSnippet implementation)
- [x] Commit 7fd844a exists (LSP panel JSX)
- [x] All 33 webview tests pass
- [x] Full pnpm test suite passes (295 tests, 0 failures)
- [x] getLspSnippet exported and importable (verified by test file import)
- [x] LSP snippets panel appears after MCP snippets panel in JSX
