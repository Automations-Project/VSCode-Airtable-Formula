---
status: partial
phase: 08-setup-tab-ui
source: [08-VERIFICATION.md]
started: 2026-05-15T18:55:00.000Z
updated: 2026-05-15T18:55:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Daemon Status Block live rendering

expected: When the daemon is running, DaemonStatusBlock appears as the FIRST panel in the Setup tab (above the Tunnel section). Health chip shows chip-ok (green) or chip-warn (yellow) based on daemon health. MCP port row shows the live port number. LSP port row is hidden when port_lsp is null, visible otherwise. Tunnel URL row is hidden when no tunnel is active. Uptime shows elapsed format (e.g. "2h 15m"). Block disappears entirely when daemon stops — no offline placeholder shown.
result: [pending]

### 2. MCP Snippets Panel

expected: An "MCP Configuration" panel appears below the IDE Configuration section. Five IDE tabs are visible: Claude Code, Claude Desktop, Cursor, Windsurf, Cline. Clicking each tab shows two sub-tabs: HTTP and stdio. HTTP snippet contains {{BEARER_TOKEN}} placeholder (never a real token). HTTP snippet shows the live MCP port from the running daemon (or {MCP_PORT} placeholder if daemon is offline). Clicking "Copy snippet" copies the snippet to clipboard and shows "Copied!" feedback for ~1.5 seconds.
result: [pending]

### 3. LSP Snippets Panel

expected: An "LSP Configuration" panel appears below the MCP Configuration section. Four IDE tabs are visible: Claude Code, OpenCode, Zed, Neovim. Clicking each tab shows two sub-tabs: TCP and stdio. Neovim TCP snippet uses vim.lsp.rpc.connect Lua format; Neovim stdio uses vim.lsp.config Lua format. TCP snippets show the live LSP port (or {LSP_PORT} placeholder if not available). "Copy snippet" button works with 1.5s feedback.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
