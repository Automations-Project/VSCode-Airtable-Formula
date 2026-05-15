# Requirements: VSCode-Airtable-Formula — Daemon & LSP

**Defined:** 2026-05-14
**Milestone:** v2.0 Daemon & LSP
**Core Value:** Airtable-aware language intelligence directly in VS Code — accurate completions, diagnostics, and hover docs for formulas, scripts, and automation scripts

## v2.0 Requirements

### Daemon Core

- [ ] **DAEMON-01**: User's existing `npx airtable-user-mcp` stdio config keeps working unchanged after daemon is introduced (stdio-daemon-proxy fallback)
- [ ] **DAEMON-02**: When daemon is running, multiple MCP clients share one session (one Chromium process, one auth context)
- [ ] **DAEMON-03**: Daemon starts automatically when VS Code extension activates (detached, survives extension reload)
- [ ] **DAEMON-04**: Daemon recovers from stale lockfile (dead PID, version drift) without user intervention
- [ ] **DAEMON-05**: Daemon exposes `/daemon/health` and `/daemon/events` (SSE) endpoints guarded by bearer token
- [ ] **DAEMON-06**: User can stop/restart daemon from VS Code extension (Setup tab button)
- [ ] **DAEMON-07**: Bearer token persists across daemon restarts; token rotation command available

### Tunnel

- [x] **TUNNEL-01**: User can enable a Cloudflare or ngrok tunnel from the VS Code extension Setup tab
- [x] **TUNNEL-02**: Tunnel URL is written to lockfile and surfaced in the Setup tab dashboard
- [x] **TUNNEL-03**: Tunnel auto-disables on repeated auth failures (401 burst) and surfaces warning in UI
- [x] **TUNNEL-04**: User can switch tunnel provider (Cloudflare / ngrok) from settings

### LSP Server

- [ ] **LSP-01**: `airtable-user-lsp` npm package is publicly installable (`npx airtable-user-lsp --stdio`)
- [ ] **LSP-02**: LSP server provides diagnostics, completions, hover for `.formula`, `.ats`, `.ata` files
- [ ] **LSP-03**: LSP server runs standalone (no daemon required) in stdio mode
- [ ] **LSP-04**: When daemon is running, LSP clients attach to daemon's LSP TCP port (shared instance)
- [ ] **LSP-05**: Daemon lockfile includes `port_lsp` field so clients can discover the LSP port

### VS Code Extension

- [ ] **EXT-01**: Extension's `McpServerDefinitionProvider` returns HTTP definition when daemon is healthy, stdio otherwise
- [ ] **EXT-02**: `auth-manager.ts` extended to spawn/monitor daemon instead of direct MCP process
- [ ] **EXT-03**: Extension passes auth env vars (bearer token, config dir) to daemon via `buildDaemonEnv` pattern

### Setup Tab UI

- [ ] **UI-01**: Setup tab shows unified daemon status block (MCP port, LSP port, tunnel URL, uptime)
- [ ] **UI-02**: Setup tab shows copy-paste config snippets for MCP per supported IDE (Claude Code, Claude Desktop, Cursor, Windsurf, Cline)
- [ ] **UI-03**: Setup tab shows copy-paste config snippets for LSP per supported IDE (Claude Code, OpenCode, Zed, Neovim)

### Documentation

- [ ] **DOCS-01**: CHANGELOG updated with v2.0 daemon + LSP features
- [ ] **DOCS-02**: `packages/mcp-server/README.md` updated with daemon transport modes and `--no-daemon` flag
- [ ] **DOCS-03**: Root README updated with LSP setup section
- [ ] **DOCS-04**: `CLAUDE.md` updated with daemon architecture section and new file locations

## Future Requirements

### Security (v3+)

- **SEC-01**: OAuth 2.1 authorization server in daemon for public tunnel multi-user access
- **SEC-02**: Per-client rate limiting on tunnel-exposed MCP endpoint

### LSP Advanced (v3+)

- **LSP-ADV-01**: LSP workspace/didChangeConfiguration support for hot-reload of settings
- **LSP-ADV-02**: LSP code actions (quick fix for known formula errors)

### Script & Automation Advanced (carried from v1.0)

- **SCRIPT-ADV-01**: Signature help (parameter hints) for script engine method calls
- **SCRIPT-ADV-02**: `input.config()` field-type string-literal completions
- **SCRIPT-ADV-03**: Quick-fix code action to insert `await` for missing-await diagnostic
- **INT-01**: Go-to-definition for field and table names (requires live MCP API integration)

## Out of Scope

| Feature | Reason |
|---------|--------|
| OAuth 2.1 server in daemon | Airtable auth is browser-session-based; bearer token sufficient for loopback; OAuth only for public multi-user scenario |
| Full TypeScript type checking for script files | Airtable-specific globals only; not a TS language server replacement |
| Script file execution / REPL | Editor support only, not runtime integration |
| Cross-platform system daemon (launchd/systemd/Windows Service) | VS Code extension manages lifecycle; standalone users accept per-session startup |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DAEMON-01 | Phase 5 | Pending |
| DAEMON-02 | Phase 5 | Pending |
| DAEMON-03 | Phase 5 | Pending |
| DAEMON-04 | Phase 5 | Pending |
| DAEMON-05 | Phase 5 | Pending |
| DAEMON-06 | Phase 5 | Pending |
| DAEMON-07 | Phase 5 | Pending |
| EXT-01 | Phase 5 | Pending |
| EXT-02 | Phase 5 | Pending |
| EXT-03 | Phase 5 | Pending |
| LSP-01 | Phase 6 | Pending |
| LSP-02 | Phase 6 | Pending |
| LSP-03 | Phase 6 | Pending |
| LSP-04 | Phase 6 | Pending |
| LSP-05 | Phase 6 | Pending |
| TUNNEL-01 | Phase 7 | Complete |
| TUNNEL-02 | Phase 7 | Complete |
| TUNNEL-03 | Phase 7 | Complete |
| TUNNEL-04 | Phase 7 | Complete |
| UI-01 | Phase 8 | Pending |
| UI-02 | Phase 8 | Pending |
| UI-03 | Phase 8 | Pending |
| DOCS-01 | Phase 9 | Pending |
| DOCS-02 | Phase 9 | Pending |
| DOCS-03 | Phase 9 | Pending |
| DOCS-04 | Phase 9 | Pending |

**Coverage:**
- v2.0 requirements: 26 total
- Mapped to phases: 26 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-05-14*
*Last updated: 2026-05-14 — Traceability mapped to phases 5–9*
