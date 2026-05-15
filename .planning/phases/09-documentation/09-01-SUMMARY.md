---
phase: 09-documentation
plan: "01"
subsystem: documentation
tags: [changelog, v2.0, daemon, lsp, tunnel, setup-tab]
dependency_graph:
  requires: []
  provides: [DOCS-01]
  affects: [CHANGELOG.md]
tech_stack:
  added: []
  patterns: [keep-a-changelog, bold-em-dash-bullets]
key_files:
  created: []
  modified:
    - CHANGELOG.md
decisions:
  - "Used ## [2.0.0] — Daemon & LSP as top-level section header (em dash U+2014) matching plan must_haves"
  - "Four subsections mirror the four v2.0 feature groups: Daemon transport, LSP server, Tunnel support, Setup tab"
  - "Bullet style follows bold-em-dash pattern from existing CHANGELOG entries"
metrics:
  duration: "~1 minute"
  completed: "2026-05-15T17:40:08Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 09 Plan 01: CHANGELOG v2.0.0 Entry — Summary

**One-liner:** CHANGELOG.md gains a `## [2.0.0] — Daemon & LSP` section with four subsections covering HTTP daemon transport, airtable-user-lsp server, Cloudflare/ngrok tunnel support, and Setup tab snippets — inserted between `[Unreleased]` and `[2.0.11]`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Insert ## [2.0.0] — Daemon & LSP section into CHANGELOG.md | b879519 | CHANGELOG.md (+38 lines) |

## What Was Built

Inserted a new `## [2.0.0] — Daemon & LSP` top-level changelog section at line 217 of `CHANGELOG.md`, between the `## [Unreleased]` block (which ends at line 215) and `## [2.0.11]` (which moved to line 255).

The section contains four subsections:

1. **Daemon transport** — HTTP MCP server via `StreamableHTTPServerTransport`, stdio-proxy mode, `AIRTABLE_NO_DAEMON` opt-out, new daemon CLI subcommands, lockfile fields
2. **LSP server** — `airtable-user-lsp` npm package, `--stdio` / `--tcp` modes, `port_lsp` in lockfile
3. **Tunnel support** — Cloudflare/ngrok providers, tunnel URL in lockfile and Setup tab, 401-burst auto-disable guard
4. **Setup tab** — MCP snippets (5 IDEs × HTTP/stdio), LSP snippets (4 IDEs × TCP/stdio), daemon status block

Version line at end: `mcp-server: 2.4.5. Extension: 2.0.48.`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan only adds documentation content, no stubs or placeholders introduced.

## Threat Flags

None — documentation-only change; no code execution, no network surface, no secrets.

## Self-Check: PASSED

- CHANGELOG.md modified: confirmed (b879519, +38 lines)
- `## [2.0.0] — Daemon & LSP` present: confirmed (line 217)
- Position between [Unreleased] (line 7) and [2.0.11] (line 255): confirmed
- All four subsections present: confirmed (### Daemon transport, ### LSP server, ### Tunnel support, ### Setup tab)
- All acceptance criteria met:
  - `grep -c "## \[2\.0\.0\] — Daemon & LSP"` = 1
  - `grep -c "### Daemon transport"` = 1
  - `grep -c "### LSP server"` = 1
  - `grep -c "### Tunnel support"` = 1
  - `grep -c "### Setup tab"` = 1
  - `grep -c "StreamableHTTPServerTransport"` = 1
  - `grep -c "AIRTABLE_NO_DAEMON"` = 1
  - `grep -c "port_lsp"` >= 1
  - `grep -c "airtable-user-lsp"` >= 1
  - `grep -c "401-burst"` = 1
  - `grep -c "daemon start"` = 1
  - `grep -c "## \[Unreleased\]"` = 1
  - Commit b879519 exists: confirmed
