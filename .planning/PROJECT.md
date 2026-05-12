# VSCode-Airtable-Formula

## What This Is

A VS Code extension (published as `airtable-formula` by `Nskha`) that provides rich language support for Airtable — starting with formula editing and expanding to a multi-engine language platform covering Airtable Scripts and Automation Scripts. It also bundles a full-featured Airtable MCP server (`airtable-user-mcp`) and an AI skills installer, making it the single tool Airtable power users install in their IDE.

## Core Value

Airtable-aware language intelligence directly in VS Code — so users get accurate completions, diagnostics, and hover docs for formulas, scripts, and automation scripts without leaving their editor.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Formula language ID (`airtable-formula`) for `.formula`, `.min.formula`, `.ultra-min.formula` — v2.0
- ✓ Formula diagnostics, completions, hover, and signature help — v2.0
- ✓ Formula formatter (beautify / minify, v1 + v2 engines) — v2.0
- ✓ MCP server with 62 tools across 12 categories (read, table-write/destructive, field-write/destructive, view-write/destructive, view-section/destructive, form-write, extension, tool-management) — v2.0.34 / mcp-server 2.5.0
- ✓ Tool profiles (read-only 9, safe-write 47, full 62, custom per-category) — v2.0
- ✓ Webview dashboard (Overview, Setup, Settings tabs, React 19 + Tailwind v4) — v2.0
- ✓ Auth manager (SecretStorage, session health checks, auto-refresh, browser detection/download) — v2.0
- ✓ Auto-config for IDEs (Cursor, Windsurf, Claude Desktop/Code, Cline, Amp) — v2.0
- ✓ AI skills installer for IDE config directories — v2.0
- ✓ Record Templates tools (9 tools, list/create/rename/update/duplicate/apply/delete) — mcp-server 2.5.0

### Active

<!-- Current milestone v1.0 — Language Platform -->

- [ ] Shared `language-services` package — pure TS, framework-agnostic, powers all 3 engines
- [ ] Formula engine migrated to language-services architecture (refactor existing providers)
- [ ] Formula feature gaps resolved (missing functions, wrong/missing diagnostics)
- [ ] Scripting Extension engine (`.script` files) — JS globals, diagnostics, completions, hover, signature help
- [ ] Automation Script engine (`.automation` files) — separate global typings (`input.config`, `output.set`, `remoteFetchAsync` differences)
- [ ] File type icons for all 3 engines (user-provided SVGs registered in extension)

### Out of Scope

- Separate LSP node process (JSON-RPC) — in-process shared service layer chosen for simplicity; can be extracted later if portability is needed
- Full TypeScript type checking for script files — Airtable-specific global typings only, not a TS language server replacement
- Script file execution / REPL — editor support only, not runtime integration

## Context

- **Monorepo:** pnpm workspace with 4 packages — `shared`, `webview`, `mcp-server`, `extension`
- **Extension build:** tsup → CJS; webview: Vite → `dist/webview/`; MCP: esbuild bundle → `dist/mcp/`
- **Existing formula providers:** `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `functions.ts` — all inline VS Code providers in `packages/extension/src/`
- **Target:** Refactor formula providers into `packages/language-services` (new workspace package), leaving VS Code-specific wrappers in the extension
- **Script types:** Both Scripting Extension and Automation Script use the same JS runtime (async/await, `base`, `table`) but expose different global APIs — handled by distinct typing definitions per context
- **Icons:** User will provide SVG assets; need to register via `contributes.iconThemes` or `contributes.languages[].icon` in `package.json`

## Constraints

- **Tech stack:** TypeScript throughout; no new runtime dependencies for language services (pure TS parser/validator)
- **Compatibility:** Must continue to pass `pnpm check:tool-sync` and all existing tests after refactor
- **Build:** New `language-services` package must integrate cleanly into existing pnpm build pipeline

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| In-process shared service layer over separate LSP process | VS Code-only target; existing architecture is in-process; avoids JSON-RPC overhead and process lifecycle complexity; portable to true LSP later | — Pending |
| Single `language-services` package for all 3 engines | Shared parser primitives, shared function/API metadata, consistent testing surface | — Pending |

## Evolution

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
*Last updated: 2026-05-12 — Milestone v1.0 started*
