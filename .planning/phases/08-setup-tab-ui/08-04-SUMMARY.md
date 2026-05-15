---
phase: 08-setup-tab-ui
plan: "04"
subsystem: webview
tags: [ui, mcp-snippets, tab-state, copy-clipboard, security]
dependency_graph:
  requires: [08-01, 08-03]
  provides: [getMcpSnippet, MCP-snippets-panel]
  affects: [packages/webview/src/tabs/Setup.tsx]
tech_stack:
  added: []
  patterns: [dual-level-tabs, shared-copy-state, module-level-constants, port-placeholder-fallback]
key_files:
  modified:
    - packages/webview/src/tabs/Setup.tsx
decisions:
  - "getMcpSnippet branches on IDE id for HTTP key naming: windsurf=serverUrl, cursor/cline=url, claude-code/desktop=type:http+url"
  - "{{BEARER_TOKEN}} is a hardcoded literal string — no variable interpolation (T-08-01/D-07)"
  - "lspActiveIde and lspActiveVariant declared in Plan 04 to co-locate all tab state; Plan 05 uses them"
  - "MCP_IDE_TABS and MCP_VARIANT_TABS defined as module-level const to avoid recreation per render"
  - "mcpPort = daemon?.port ?? '{MCP_PORT}' — prevents undefined in HTTP snippet when daemon not running (Pitfall 3)"
metrics:
  duration: "9 minutes"
  completed: "2026-05-15T15:40:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 8 Plan 04: MCP Config Snippets Section Summary

getMcpSnippet() fully implemented with per-IDE HTTP key variation + stdio entry block, and MCP snippets panel rendered with dual-level tabs and copy button in Setup.tsx.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement getMcpSnippet() replacing Plan 03 stub | 2a2cd6d | packages/webview/src/tabs/Setup.tsx |
| 2 | Add MCP snippets panel JSX + tab/copy state | 760b703 | packages/webview/src/tabs/Setup.tsx |

## What Was Built

### Task 1: getMcpSnippet() implementation

Replaced the empty stub with a full implementation:

- **stdio variant** (all IDEs): returns `"airtable": { "command": "npx", "args": ["-y", "airtable-user-mcp"] }`
- **Windsurf HTTP**: uses `"serverUrl"` key (not `"url"`)
- **Cursor + Cline HTTP**: uses `"url"` key only (no `"type": "http"`)
- **Claude Code + Claude Desktop HTTP**: uses `"type": "http"` + `"url"` keys
- Bearer token: hardcoded literal `{{BEARER_TOKEN}}` in all HTTP variants — never state interpolation (T-08-01)
- Port: template literal `${port}` accepts `number | string` — the `'{MCP_PORT}'` fallback string passes through cleanly

All `getMcpSnippet` and `bearer token` describe blocks in `setup.test.tsx` are GREEN (11 tests).

### Task 2: MCP snippets panel JSX

Added to `Setup.tsx`:

**Module-level constants:**
- `MCP_IDE_TABS`: 5 IDEs (Claude Code, Claude Desktop, Cursor, Windsurf, Cline)
- `MCP_VARIANT_TABS`: 2 variants (HTTP (daemon), stdio (npx))

**State inside Setup component:**
- `mcpActiveIde` / `setMcpActiveIde` — outer IDE tab selection
- `mcpActiveVariant` / `setMcpActiveVariant` — inner variant selection
- `lspActiveIde` / `lspActiveVariant` — pre-declared for Plan 05 co-location
- `copiedKeys: Record<string, boolean>` — shared copy state map

**Handlers:**
- `handleCopySnippet(text, key)` — writes to clipboard, sets key true for 1500ms then resets

**Port placeholder:**
- `mcpPort = daemon?.port ?? '{MCP_PORT}'` — live port when daemon running, string placeholder otherwise

**JSX panel** (after last existing IDE panel):
- `glass-panel` with `section-header` (eyebrow: "Config Snippets", title: "MCP Server")
- Outer IDE tab bar with active underline (`var(--at-blue)`) and muted/active color
- Inner variant sub-tab bar with tighter `4px 8px` padding
- `<pre>` + `<code>` snippet block with absolute-positioned copy button
- Copy button: "Copy snippet" / "Copied!" feedback at 1500ms

## Test Results

| Describe Block | Tests | Status |
|---------------|-------|--------|
| formatUptime | 6 | PASS |
| getMcpSnippet bearer token | 5 | PASS |
| getMcpSnippet mcp port | 6 | PASS |
| getLspSnippet lsp port snippet | 6 | FAIL (Plan 05 stub — expected) |
| store.test.ts | 10 | PASS |

27/33 tests pass. The 6 failing tests are `getLspSnippet` which uses the intentional Plan 05 stub.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `getLspSnippet` returns `''` | packages/webview/src/tabs/Setup.tsx | 62-64 | Plan 05 will implement LSP snippet logic |

The LSP snippet stub does not prevent Plan 04's goal from being achieved — this plan only delivers MCP snippets. The `getLspSnippet` stub is tracked and the LSP panel will be added by Plan 05.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundary changes introduced. The `getMcpSnippet()` function uses only static strings and a numeric port value from trusted extension state. The `{{BEARER_TOKEN}}` literal is hardcoded — T-08-01 is fully mitigated.

## Self-Check: PASSED

- packages/webview/src/tabs/Setup.tsx: FOUND and modified
- Commit 2a2cd6d: getMcpSnippet implementation — FOUND
- Commit 760b703: MCP snippets panel JSX — FOUND
- All getMcpSnippet tests GREEN — VERIFIED (27 tests pass)
- No file deletions in either commit — VERIFIED
- Webview build: PASS (vite build exits 0, 271.94 kB bundle)
