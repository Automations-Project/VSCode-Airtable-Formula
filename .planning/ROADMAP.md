# Roadmap: VSCode-Airtable-Formula — Language Platform

## Overview

This milestone transforms the existing single-engine formula editor into a 3-engine language platform. The work proceeds in strict dependency order: scaffold the framework-agnostic `language-services` package first, migrate the existing formula engine into it to prove the architecture, then build the Scripting Extension engine, then build the Automation engine on top of the shared globals pattern the script engine establishes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Language Services Scaffold** - New `packages/language-services` workspace package with dual CJS+ESM build, framework-agnostic types, and VS Code adapter layer
- [x] **Phase 2: Formula Engine Migration** - Extract all formula providers into `language-services/engines/formula/`, unify the function registry, fix feature gaps, add formula file icon
- [x] **Phase 3: Script Engine** - `airtable-script` language ID, globals completions/hover, missing-await and unknown-global diagnostics, file icon for `.script` files
- [x] **Phase 4: Automation Engine** - `airtable-automation` language ID, automation-scoped globals, cross-context diagnostics, file icon for `.automation` files

## Phase Details

### Phase 1: Language Services Scaffold
**Goal**: The `packages/language-services` workspace package exists, builds successfully with dual CJS+ESM output, exports framework-agnostic types, and the VS Code extension adapter layer is in place — all without any `vscode` dependency leaking into the new package
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `pnpm -F language-services build` produces both CJS and ESM outputs with no TypeScript errors
  2. `pnpm build` completes without regressions — existing formula features still work identically in VS Code after the adapter layer is wired in
  3. `LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, and `LsHover` types are importable from `language-services` without triggering a `vscode` module resolution
  4. `packages/extension/src/language/convert.ts` exists and translates between VS Code types and language-services types; `registration.ts` exists and calls `registerLanguageProviders(context)`
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — Create packages/language-services package scaffold with dual CJS+ESM build, framework-agnostic types, and test suite (INFRA-01, INFRA-02) [Wave 1, autonomous]
- [x] 01-02-PLAN.md — Wire VS Code adapter layer: convert.ts, registration.ts, extension.ts integration, and build script updates (INFRA-03) [Wave 2, depends_on: 01-01, autonomous]

### Phase 2: Formula Engine Migration
**Goal**: All formula language intelligence lives in `language-services/engines/formula/` — the five existing provider files in the extension are deleted and replaced by thin VS Code adapter wrappers, a single `FUNCTION_REGISTRY` drives all formula providers, and known feature gaps are fixed
**Depends on**: Phase 1
**Requirements**: FORMULA-01, FORMULA-02, FORMULA-03, FORMULA-04, FORMULA-05
**Success Criteria** (what must be TRUE):
  1. `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, and `functions.ts` no longer exist in `packages/extension/src/` — their logic lives in `language-services/engines/formula/`
  2. `codeActions.ts` import updated from `./functions` to the new `language-services` registry export — no dead imports remain in the extension
  3. Formula diagnostics, completions, hover, and signature help behave identically to before the migration (no user-visible behavioral regression)
  4. A single `FUNCTION_REGISTRY` is the source of truth — the private duplicate function list that previously existed in `completions.ts` is eliminated
  5. Known formula feature gaps are resolved: missing functions are added to the registry and incorrect or missing diagnostics are fixed
  6. `.fx` opens with `airtable-formula` language ID — identical diagnostics, completions, hover, and icon as `.formula`
  7. `.formula` and `.fx` files display a custom light/dark SVG file type icon via `contributes.languages[].icon`
**Plans**: 8 plans
Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Add LsSignatureHelp types to types.ts, fix WR-04 package.json exports ordering, create 5 Wave-0 test scaffolds (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 1, autonomous]
- [x] 02-02-PLAN.md — Create engines/formula/registry.ts (unified FUNCTION_REGISTRY + gap fixes + helpers) and engines/formula/index.ts barrel (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 1, autonomous]

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-03-PLAN.md — Create engines/formula/diagnostics.ts pure engine (migrate from extension/src/diagnostics.ts) (FORMULA-01, FORMULA-03) [Wave 2, depends_on: 02-02, autonomous]
- [x] 02-04-PLAN.md — Create engines/formula/completions.ts and engines/formula/hover.ts pure engines (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 2, depends_on: 02-02, autonomous]
- [x] 02-05-PLAN.md — Create engines/formula/signature.ts pure engine with findFunctionContext (FORMULA-01) [Wave 2, depends_on: 02-01, 02-02, autonomous]

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-06-PLAN.md — Fix convert.ts (WR-01, WR-02) and add toVscodeCompletionItem + toVscodeSignatureHelp; extend language-services/src/index.ts (FORMULA-01, FORMULA-02) [Wave 3, depends_on: 02-03, 02-04, 02-05, autonomous]

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 02-07-PLAN.md — Create all 4 VS Code wrapper classes in extension/src/language/formula/ (FORMULA-01) [Wave 4, depends_on: 02-06, autonomous]

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 02-08-PLAN.md — Wire registration.ts + codeActions.ts imports; delete 5 old source files; create SVG icons; update package.json (.fx + icon) (FORMULA-01, FORMULA-02, FORMULA-04, FORMULA-05) [Wave 5, depends_on: 02-07, autonomous]

### Phase 3: Script Engine
**Goal**: `.script` files have full language support in VS Code — JS syntax highlighting, dot-triggered completions for all Scripting Extension globals, hover documentation, missing-`await` and unknown-global diagnostics, and a custom file icon
**Depends on**: Phase 2
**Requirements**: SCRIPT-01, SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05, SCRIPT-06
**Success Criteria** (what must be TRUE):
  1. Files with `.script` and `.ats` extensions open in VS Code with JS syntax highlighting and `airtable-script` language ID; comment toggling, bracket pairs, and code folding work
  2. Typing `base.` in a `.script` file triggers completions listing the correct `base` methods; the same applies to `table`, `cursor`, `input`, `output`, `session`, `fetch`, and `remoteFetchAsync`
  3. Hovering over any Scripting Extension global or method shows documentation text
  4. Writing `someAsyncCall()` without `await` on `*Async`-suffixed calls produces a diagnostic warning
  5. `.script` files display the custom file icon (light and dark variants) in VS Code's file explorer
**Plans**: 7 plans
Plans:
**Wave 1** *(parallel — no dependencies between plans)*
- [x] 03-01-PLAN.md — Create 4 Wave-0 test scaffold files in test/script/ (SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05) [Wave 1, autonomous]
- [x] 03-02-PLAN.md — Create engines/script/registry.ts (SCRIPT_GLOBALS nested registry + helpers) and engines/script/index.ts stub barrel (SCRIPT-02, SCRIPT-03) [Wave 1, autonomous]

**Wave 2** *(03-03 and 03-04 depend on 03-02; 03-05 is independent)*
- [x] 03-03-PLAN.md — Create engines/script/completions.ts and engines/script/hover.ts; update index.ts (SCRIPT-02, SCRIPT-03) [Wave 2, depends_on: 03-02, autonomous]
- [x] 03-04-PLAN.md — Create engines/script/diagnostics.ts (SCRIPT-04, SCRIPT-05); complete index.ts barrel (SCRIPT-04, SCRIPT-05) [Wave 2, depends_on: 03-02, autonomous]
- [x] 03-05-PLAN.md — Create grammar JSON, language config JSON, SVG placeholder icons (SCRIPT-01, SCRIPT-06) [Wave 2, autonomous]

**Wave 3** *(depends on 03-03 and 03-04)*
- [x] 03-06-PLAN.md — Create 3 VS Code wrapper classes in extension/src/language/script/ (SCRIPT-01 through SCRIPT-05) [Wave 3, depends_on: 03-03, 03-04, autonomous]

**Wave 4** *(depends on 03-05 and 03-06)*
- [x] 03-07-PLAN.md — Wire registration.ts + language-services index.ts + package.json airtable-script contributions (SCRIPT-01 through SCRIPT-06) [Wave 4, depends_on: 03-05, 03-06, autonomous]

### Phase 4: Automation Engine
**Goal**: `.automation` files have full language support scoped to the Automation Script context — completions and hover are limited to automation-available globals, and diagnostics flag use of scripting-extension-only APIs; a custom file icon is registered
**Depends on**: Phase 3
**Prerequisite gate**: RESOLVED — RESEARCH.md confirms (a) base/table/fetch available in automation, (b) remoteFetchAsync absent (runtime error), (c) input.config() returns plain object (no field-type enum in automation), (d) output.set(key, value) confirmed.
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05
**Success Criteria** (what must be TRUE):
  1. Files with `.automation` and `.ata` extensions open in VS Code with JS syntax highlighting and `airtable-automation` language ID; comment toggling, bracket pairs, and code folding work
  2. Typing `input.` in an `.automation` file shows only `input.config()` — interactive input methods are absent; `output.` shows only `output.set()`
  3. Hovering over any automation global or method shows documentation text
  4. Writing `cursor.selectedRecordIds` or using `session`, `remoteFetchAsync`, or interactive `input.*Async()` / `output.text/markdown/table` in an `.automation` file produces a diagnostic warning identifying the API as scripting-extension-only
  5. `.automation` files display the custom file icon (light and dark variants) in VS Code's file explorer
**Plans**: 7 plans
Plans:
**Wave 1** *(parallel — no dependencies between plans)*
- [x] 04-01-PLAN.md — Create 4 Wave-0 test scaffold files in test/automation/ (AUTO-02, AUTO-03, AUTO-04) [Wave 1, autonomous]
- [x] 04-02-PLAN.md — Create engines/automation/registry.ts (AUTOMATION_GLOBALS + helpers) and engines/automation/index.ts stub barrel (AUTO-02, AUTO-03) [Wave 1, autonomous]

**Wave 2** *(04-03 and 04-04 depend on 04-02; 04-05 is independent)*
- [x] 04-03-PLAN.md — Create engines/automation/completions.ts and engines/automation/hover.ts (AUTO-02, AUTO-03) [Wave 2, depends_on: 04-02, autonomous]
- [x] 04-04-PLAN.md — Create engines/automation/diagnostics.ts — wrong-context only, 15 forbidden patterns (AUTO-04) [Wave 2, depends_on: 04-02, autonomous]
- [x] 04-05-PLAN.md — Create grammar JSON, language config JSON, SVG placeholder icons (AUTO-01, AUTO-05) [Wave 2, autonomous]

**Wave 3** *(depends on 04-03 and 04-04)*
- [x] 04-06-PLAN.md — Create 3 VS Code wrapper classes in extension/src/language/automation/ (AUTO-01 through AUTO-04) [Wave 3, depends_on: 04-03, 04-04, autonomous]

**Wave 4** *(depends on 04-05 and 04-06)*
- [x] 04-07-PLAN.md — Wire registration.ts + language-services index.ts + package.json airtable-automation contributions (AUTO-01 through AUTO-05) [Wave 4, depends_on: 04-05, 04-06, autonomous]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Language Services Scaffold | 2/2 | Complete | 2026-05-13 |
| 2. Formula Engine Migration | 8/8 | Complete | 2026-05-13 |
| 3. Script Engine | 7/7 | Complete | 2026-05-13 |
| 4. Automation Engine | 7/7 | Complete | 2026-05-13 |

---

## Milestone v2.0 — Daemon & LSP

### Overview

This milestone upgrades the MCP server to a shared daemon with HTTP transport, exposes language intelligence as a public LSP server, adds tunnel support for remote MCP access, and updates the Setup UI and documentation. Phases execute in strict dependency order: daemon core first, then LSP server and tunnel in parallel, then UI consuming both, then documentation last.

### Phases

- [ ] **Phase 5: Daemon Core** - Daemon lockfile, HTTP MCP server, stdio-daemon-proxy, launcher, and VS Code extension wiring
- [x] **Phase 6: LSP Server** - New `packages/lsp-server/` workspace package published as `airtable-user-lsp` npm package
- [ ] **Phase 7: Tunnel Support** - Cloudflare/ngrok tunnel integration added to daemon server
- [ ] **Phase 8: Setup Tab UI** - Unified daemon status block, MCP config snippets, and LSP config snippets in webview
- [ ] **Phase 9: Documentation** - CHANGELOG, READMEs, and CLAUDE.md updated for v2.0 features

### Phase Details

#### Phase 5: Daemon Core
**Goal**: The MCP server runs as a shared daemon that multiple clients can connect to simultaneously, VS Code manages its lifecycle automatically, and existing stdio clients continue working without any config changes
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, DAEMON-07, EXT-01, EXT-02, EXT-03
**Success Criteria** (what must be TRUE):
  1. An existing user who connects via `npx airtable-user-mcp` stdio config sees no change in behavior — the attach proxy transparently routes to the running daemon or falls back to in-process stdio
  2. Two MCP clients connecting simultaneously share one Chromium session — there is only one `daemon.lock` file and one daemon process running
  3. Opening VS Code starts the daemon automatically in the background; reloading the extension window does not spawn a second daemon process
  4. When the lockfile references a dead PID or an outdated version, the daemon restarts itself without any user prompt
  5. Calling `/daemon/health` returns a valid JSON response only when the correct bearer token is present in the Authorization header; calling `/daemon/events` streams SSE updates to authenticated clients
  6. The extension's MCP registration switches to an HTTP endpoint when the daemon is healthy and falls back to stdio when it is not
**Plans**: 7 plans
Plans:
**Wave 1** *(parallel — no dependencies between plans)*
- [ ] 05-01-PLAN.md — Create TDD scaffolds: 5 test files for lockfile, token, daemon server, attach proxy, and DaemonManager (EXT-01) [Wave 1, autonomous]

**Wave 2** *(depends on 05-01)*
- [ ] 05-02-PLAN.md — Create daemon/lockfile.js and daemon/token.js (DAEMON-04, DAEMON-07) [Wave 2, depends_on: 05-01, autonomous]

**Wave 3** *(depends on 05-02)*
- [ ] 05-03-PLAN.md — Create daemon/server.js — Express HTTP server with MCP, health, events, shutdown, rotate-token endpoints (DAEMON-02, DAEMON-05, DAEMON-07) [Wave 3, depends_on: 05-02, autonomous]

**Wave 4** *(depends on 05-03)*
- [ ] 05-04-PLAN.md — Create daemon/launcher.js (ensureDaemon/startDaemon/stopDaemon/getDaemonStatus/spawnDetachedDaemon), daemon/index.js barrel, add daemon subcommand to cli.js (DAEMON-03, DAEMON-04, DAEMON-06) [Wave 4, depends_on: 05-03, autonomous]

**Wave 5** *(both parallel — no file overlap)*
- [ ] 05-05-PLAN.md — Add attach-proxy block to packages/mcp-server/src/index.js (DAEMON-01) [Wave 5, depends_on: 05-04, autonomous]
- [ ] 05-06-PLAN.md — Create extension DaemonManager class, add mcp.useDaemon to settings.ts and package.json (DAEMON-03, DAEMON-06, DAEMON-07, EXT-02, EXT-03) [Wave 5, depends_on: 05-01, autonomous]

**Wave 6** *(depends on 05-05 and 05-06)*
- [ ] 05-07-PLAN.md — Wire registration.ts HTTP branch + AIRTABLE_NO_DAEMON stdio fallback; inject DaemonManager into extension.ts; add stop/restart commands (DAEMON-01, DAEMON-02, DAEMON-03, EXT-01, EXT-02, EXT-03) [Wave 6, depends_on: 05-05, 05-06, autonomous]

**UI hint**: no

#### Phase 6: LSP Server
**Goal**: Language intelligence is available to any LSP-capable editor via a publicly installable npm package, with a shared daemon instance for multi-client efficiency
**Depends on**: Phase 5
**Requirements**: LSP-01, LSP-02, LSP-03, LSP-04, LSP-05
**Success Criteria** (what must be TRUE):
  1. A developer running `npx airtable-user-lsp --stdio` in any terminal gets a working LSP server without installing anything beyond Node.js
  2. An editor connected to the LSP server receives diagnostics, completions, and hover for `.formula`, `.ats`, and `.ata` files identical to what VS Code provides
  3. The LSP server starts and serves requests with no daemon running — it works fully standalone
  4. When the daemon is running, external editors discover `port_lsp` from `~/.airtable-user-mcp/daemon.lock` and connect directly to the shared TCP LSP port — `npx airtable-user-lsp --stdio` always starts a fresh in-process instance (no proxy to daemon TCP)
  5. The daemon lockfile contains a `port_lsp` field that LSP clients can read to discover the shared LSP port
**Plans**: 5 plans *(PLANNED 2026-05-14 — ready for execution)*
Plans:
**Wave 1** *(no dependencies)*
- [x] 06-01-PLAN.md — Create packages/lsp-server/ workspace package scaffold: package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, and 3 Wave 0 test scaffolds (LSP-01, LSP-02) [Wave 1, autonomous]

**Wave 2** *(depends on 06-01)*
- [x] 06-02-PLAN.md — Implement lsp-convert.ts (6 LsXxx→LSP conversion functions, +1 offset) and router.ts (routeDocument with D-07 language ID + extension map) (LSP-02, LSP-03) [Wave 2, depends_on: 06-01, autonomous]

**Wave 3** *(depends on 06-02)*
- [x] 06-03-PLAN.md — Implement lockfile-writer.ts (atomic port_lsp write), tcp-server.ts (net.createServer port 0, 127.0.0.1), server.ts (registerHandlers per-connection), index.ts (--tcp/--stdio entry point) (LSP-03, LSP-04, LSP-05) [Wave 3, depends_on: 06-02, autonomous]

**Wave 4** *(depends on 06-03)*
- [x] 06-04-PLAN.md — Daemon integration: spawn airtable-user-lsp --tcp in launcher.js startDaemon(); SIGTERM lspChild in finalize(); setLspChild()+lsp-child shutdown step in server.js stop() (LSP-04, LSP-05) [Wave 4, depends_on: 06-03, autonomous]

**Wave 5** *(depends on 06-03 and 06-04)*
- [x] 06-05-PLAN.md — Build lsp-server + add lsp-server target to release.yml (version bump + build + npm publish + tag + GitHub Release); create packages/lsp-server/README.md (LSP-01) [Wave 5, depends_on: 06-03, 06-04, autonomous]

**UI hint**: no

#### Phase 7: Tunnel Support
**Goal**: Users can expose their local MCP server to remote AI clients via a public URL managed entirely from within VS Code
**Depends on**: Phase 5
**Requirements**: TUNNEL-01, TUNNEL-02, TUNNEL-03, TUNNEL-04
**Success Criteria** (what must be TRUE):
  1. A user can click a button in the VS Code Setup tab to start a Cloudflare or ngrok tunnel and get a public HTTPS URL for their MCP server
  2. The tunnel URL appears in the Setup tab dashboard immediately after activation and persists across extension reloads (read from lockfile)
  3. When the tunnel receives a burst of 401 responses, it disables automatically and a warning banner appears in the Setup tab without requiring user action
  4. A user can switch between Cloudflare and ngrok tunnel providers from VS Code settings without manual CLI steps
**Plans**: TBD
**UI hint**: yes

#### Phase 8: Setup Tab UI
**Goal**: The Setup tab gives users a complete, actionable view of their daemon state — MCP connectivity, LSP connectivity, tunnel status, and copy-paste config snippets for every supported IDE
**Depends on**: Phase 5, Phase 6, Phase 7
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Opening the Setup tab shows a live status block with MCP port, LSP port, tunnel URL (if active), and daemon uptime — all sourced from the running daemon lockfile
  2. A user setting up a new MCP client in Claude Code, Claude Desktop, Cursor, Windsurf, or Cline can copy a ready-to-paste config snippet directly from the Setup tab
  3. A user setting up LSP in Claude Code, OpenCode, Zed, or Neovim can copy a ready-to-paste config snippet directly from the Setup tab
**Plans**: TBD
**UI hint**: yes

#### Phase 9: Documentation
**Goal**: All user-facing documentation accurately describes the v2.0 daemon and LSP architecture so users can self-serve setup and troubleshooting without filing issues
**Depends on**: Phase 8
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. The CHANGELOG entry for v2.0 lists daemon transport, LSP server, and tunnel support as new features with enough detail for a user to understand what changed
  2. A user reading `packages/mcp-server/README.md` understands the three transport modes (stdio standalone, stdio-proxy to daemon, HTTP) and can use `--no-daemon` to opt out
  3. A user reading the root README can find the LSP setup section and follow it to configure their editor without any additional research
  4. A developer reading `CLAUDE.md` can find the daemon architecture section, understand the new file layout in `packages/mcp-server/src/daemon/`, and know which files were ported from the Perplexity project
**Plans**: TBD
**UI hint**: no

### Progress

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8 → 9
Note: Phase 6 and Phase 7 can execute in parallel after Phase 5 completes.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Daemon Core | 0/7 | Not started | - |
| 6. LSP Server | 5/5 | Complete | 2026-05-15 |
| 7. Tunnel Support | 0/? | Not started | - |
| 8. Setup Tab UI | 0/? | Not started | - |
| 9. Documentation | 0/? | Not started | - |
