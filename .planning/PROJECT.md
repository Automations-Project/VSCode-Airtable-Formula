# VSCode-Airtable-Formula

## Current Milestone: v2.0 Daemon & LSP

**Goal:** Upgrade the MCP server to a shared daemon with HTTP transport, expose language intelligence as a public LSP server, add tunnel support, and update the Setup UI + docs.

**Target features:**
- Daemon core (lockfile lifecycle, HTTP MCP server, stdio-daemon-proxy, bearer auth, SSE events, health check)
- Tunnel support (Cloudflare/ngrok) for remote MCP access
- `airtable-user-lsp` public npm package (LSP server wrapping `language-services`, stdio + TCP modes)
- VS Code extension daemon lifecycle management + HTTP MCP definition
- Setup tab LSP config snippets per IDE (Claude Code, OpenCode, Cursor, Zed)
- Documentation updates (CHANGELOG, READMEs, CLAUDE.md)

## What This Is

A VS Code extension (published as `airtable-formula` by `Nskha`) that provides rich language support for Airtable — covering formula editing, Airtable Scripts, and Automation Scripts. It bundles a full-featured Airtable MCP server (`airtable-user-mcp`), an LSP server (`airtable-user-lsp`), and an AI skills installer, making it the single tool Airtable power users install in their IDE.

## Core Value

Airtable-aware language intelligence directly in VS Code — so users get accurate completions, diagnostics, and hover docs for formulas, scripts, and automation scripts without leaving their editor.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Formula language ID (`airtable-formula`) for `.formula`, `.min.formula`, `.ultra-min.formula` — v2.0
- ✓ Formula diagnostics, completions, hover, and signature help — v2.0
- ✓ Formula formatter (beautify / minify, v1 + v2 engines) — v2.0
- ✓ MCP server with 62 tools across 12 categories — v2.0.34 / mcp-server 2.5.0
- ✓ Tool profiles (read-only 9, safe-write 47, full 62, custom per-category) — v2.0
- ✓ Webview dashboard (Overview, Setup, Settings tabs, React 19 + Tailwind v4) — v2.0
- ✓ Auth manager (SecretStorage, session health checks, auto-refresh, browser detection/download) — v2.0
- ✓ Auto-config for IDEs (Cursor, Windsurf, Claude Desktop/Code, Cline, Amp) — v2.0
- ✓ AI skills installer for IDE config directories — v2.0
- ✓ Record Templates tools (9 tools) — mcp-server 2.5.0
- ✓ `language-services` shared package (3 engines: formula, script, automation) — v1.0 / Phase 1–4
- ✓ Script engine (`.ats` files) — diagnostics, completions, hover, signature help — v1.0 / Phase 3
- ✓ Automation engine (`.ata` files) — diagnostics, completions, hover — v1.0 / Phase 4
- ✓ File type icons for all 3 file types (`.formula`, `.ats`, `.ata`) — v1.0 / Phase 4

### Active

<!-- Current milestone v2.0 — Daemon & LSP -->

- [ ] Daemon lockfile lifecycle (`acquire`, `release`, `replace`, `isStale`) in `packages/mcp-server/src/daemon/`
- [ ] HTTP MCP server (`StreamableHTTPServerTransport`) with bearer auth, SSE events, health check
- [ ] Stdio-daemon-proxy (`attach.ts`) — zero breaking changes for existing stdio MCP clients
- [ ] Daemon launcher (`ensureDaemon`, `startDaemon`, `stopDaemon`, `restartDaemon`)
- [ ] Tunnel support (Cloudflare/ngrok) — port from VSCode-Perplexity-MCP
- [ ] `airtable-user-lsp` public npm package — LSP server wrapping `language-services` (stdio + TCP modes)
- [ ] LSP port written to daemon lockfile (`port_lsp`)
- [ ] VS Code extension: daemon lifecycle in `auth-manager.ts`, HTTP `McpServerDefinitionProvider` when daemon running
- [x] Setup tab updated with MCP + LSP status and per-IDE config snippets — Validated in Phase 8: Setup Tab UI
- [x] Documentation updates (CHANGELOG, README, CLAUDE.md, LSP setup guide) — Validated in Phase 9: Documentation

### Out of Scope

- Full TypeScript type checking for script files — Airtable-specific global typings only, not a TS language server replacement
- Script file execution / REPL — editor support only, not runtime integration
- OAuth 2.1 server in daemon — bearer token auth is sufficient for local daemon; OAuth is Perplexity-specific (public tunnel use case)

## Context

- **Monorepo:** pnpm workspace with 5 packages — `shared`, `webview`, `mcp-server`, `extension`, `language-services`
- **Extension build:** tsup → CJS; webview: Vite → `dist/webview/`; MCP: esbuild bundle → `dist/mcp/`
- **Daemon reference:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP` — lockfile.ts, launcher.ts, server.ts, attach.ts are the direct port source
- **Daemon config dir:** `~/.airtable-user-mcp/` (existing, shared with MCP server auth)
- **Lockfile:** `~/.airtable-user-mcp/daemon.lock` — fields: `pid`, `uuid`, `port`, `port_lsp`, `bearerToken`, `version`, `startedAt`, `tunnelUrl`
- **Breaking change strategy:** `attach.ts` stdio-daemon-proxy ensures existing stdio configs keep working unchanged
- **LSP package:** `airtable-user-lsp` (new npm package) wraps `packages/language-services` via `vscode-languageserver`
- **Tunnel providers:** Cloudflare (`cloudflared`) and ngrok — ported from Perplexity; extension-managed

## Constraints

- **Zero breaking changes:** Existing `npx airtable-user-mcp` stdio users and VS Code extension users must not need to change anything
- **Legacy migration:** `--no-daemon` flag for users who explicitly want isolated MCP process; stdio fallback in `attach.ts` when daemon unreachable
- **Tech stack:** TypeScript throughout; `vscode-languageserver` for LSP transport; `express` + MCP SDK `StreamableHTTPServerTransport` for daemon HTTP
- **Compatibility:** Must continue to pass `pnpm check:tool-sync` and all existing tests after changes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| In-process shared service layer over separate LSP process | VS Code-only target; existing architecture is in-process; avoids JSON-RPC overhead and process lifecycle complexity; portable to true LSP later | Validated — Phase 1 (now extracting to LSP in v2.0) |
| Single `language-services` package for all 3 engines | Shared parser primitives, shared function/API metadata, consistent testing surface | Validated — Phase 1 |
| Daemon over separate-process-per-client | Shared Chromium session, faster auth, reduced resource usage; existing stdio clients attach transparently via proxy | Decided — v2.0 |
| `language-services` stays private; only LSP transport binary is public | Engine is internal; public surface is the stdio/TCP server binary (`airtable-user-lsp`) | Decided — v2.0 |
| No OAuth 2.1 in Airtable daemon | Airtable auth is browser-session-based (Chromium); bearer token is sufficient for local loopback daemon; OAuth is only needed for public tunnel exposure (Perplexity use case) | Decided — v2.0 |

## Evolution

Last updated: 2026-05-15 (Phase 8 complete)

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-14 — Milestone v2.0 started*
