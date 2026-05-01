# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### MCP Server 2.5.0 — Record Templates (9 new tools) + round-4 user-report fixes (2026-05-01)

Promotes record templates to a first-class MCP capability. Templates are
the saved row scaffolds that Airtable surfaces under the "+ Add record"
flyout and inside the row-create extension — previously not addressable
through any public or internal API client we had. Discovered by capturing
the rowTemplate endpoints with `pnpm capture:cdp:mutations` while the
reporter exercised every template UI path.

**New tools (9):**

| Tool | Category | Purpose |
|:-----|:---------|:--------|
| `list_record_templates` | read | List record templates for a table |
| `create_record_template` | table-write | Create a template (client-side `rtp...` ID like view sections use `vsc...`) |
| `rename_record_template` | table-write | Rename a template |
| `update_record_template_description` | table-write | Set or clear a template's description |
| `set_record_template_cell` | table-write | Set a cell value in a template (static, linked rows, or linked templates) |
| `set_record_template_visible_columns` | table-write | Choose which columns the template surfaces in its UI |
| `duplicate_record_template` | table-write | Clone an existing template |
| `apply_record_template` | table-write | Apply a template — creates a new record using the template's cell defaults |
| `delete_record_template` | table-destructive | Delete a template |

**Round-4 fixes (carried into 2.5.0 from interim 2.4.4 work):**

- `set_view_columns` now filters the primary column out of the move step
  before calling `moveVisibleColumns` — Airtable rejects any move that
  displaces the pinned primary at index 0.
- `reorder_view_fields` `mergePartialFieldOrder` protects the primary
  column at index 0; user-requested moves to index 0 are clamped to 1.
- `update_view_group_levels` always sends `emptyGroupState: 'hidden'`;
  Airtable's API rejects `'visible'` with INVALID_REQUEST.
- `list_tables` now reads `data.tableById` as a fallback when
  `tableSchemas` / `tables` / `tableDatas` are absent (matches the shape
  the reporter saw).
- `update_view_filters` `isWithin` corrected: requires `timeZone` (IANA)
  and `shouldUseCorrectTimeZoneForFormulaicColumn: true`, no `exactDate`,
  modes are `thisCalendarMonth` / `thisCalendarYear` (not `thisMonth` /
  `thisYear`). Tool description and AI skill template updated.

**Counts:** 52 → **61 tools**. `read-only` profile: 8 → 9. `safe-write`
profile: 39 → 47. `full` profile: 52 → 61.

mcp-server: 2.4.4 → 2.5.0.

### MCP Server 2.4.3 — `list_view_sections` full fix (carry-over from 2.4.2)

Probed the schema read response with a fresh patchright session against
a base that has sections (`packages/mcp-server/dev-tools/debug-sections.js`,
new `pnpm probe:sections` script). Found that sidebar sections live at
`data.tableSchemas[N].viewSectionsById` — NOT `viewSections` like the
WebSocket realtime delta model uses. 2.4.0 + 2.4.1 read the wrong key,
which is why the sections array came back empty.

`listViewSections` now reads from `viewSectionsById` first, falls back
to `viewSections` for fixture/test compatibility, falls back to the
2.4.2 ID-only-from-tableViewOrder path if both are absent. The rich
shape (`name`, `viewOrder`, `pinnedForUserId`, `createdByUserId`) is
fully restored on real bases.

mcp-server: 2.4.2 → 2.4.3.

### MCP Server 2.4.2 — User follow-up bugs (report 2026-05-01)

After upgrading to 2.4.0 and running real end-to-end view-rollout work,
the reporter surfaced two bugs in the new tooling. Both fixed here.

**Bug 1 — `set_view_columns` orchestration 422'd at the move step** (P1).
The internal step 3 looped per-id `moveVisibleColumns([id], i)` starting
at index 0. That fails reliably because grid views pin the primary
column at visible index 0 (you can't move anything else there) and
per-id moves of an already-correctly-positioned column also fail.
Steps 1 and 2 (hide-all + show-the-set) succeeded, so visibility was
correct but column order was untouched.

Fix: replace the loop with one batched `moveVisibleColumns(visibleColumnIds, 1)`
call — the entire ordered list is inserted starting at visible index 1,
after the pinned primary. Verified by the reporter's workaround snippet
on 11 grid views (100% success rate). Test updated to match.

**Bug 2 — `list_view_sections` returned empty `sections`** (P2, partial fix).
On the reporter's base, `table.viewSections` is absent from the cached
`application/{appId}/read` response even when `tableViewOrder` clearly
contains `vsc...` IDs. The full fix needs a network capture from a base
with sections to discover where the section objects actually live in
the schema response (none of our existing captures cover this — they
were either mutations-only or pre-section).

Partial fix shipped here: when `viewSections` is empty but
`tableViewOrder` contains `vsc...` IDs, surface them as bare-id entries
with `name: null`, `viewOrder: null`, `partial: true`, and a top-level
`introspectionPartial: true` flag with a `introspectionNote` explaining
the limitation. The agent at least knows which section IDs exist and
can pass them to `move_view_to_section` / `rename_view_section` /
`delete_view_section` (all of which still work for side effects).

mcp-server: 2.4.1 → 2.4.2.

### MCP Server 2.4.1 — Hotfix: bundled server crashed on startup

Released hours after 2.4.0. The bundled extension copy of the MCP
server crashed immediately on every spawn with `MODULE_NOT_FOUND` for
`../package.json`, surfacing in MCP clients as `transport error:
transport closed`. No tool ever ran from the bundled launcher.

Root cause: `index.js` resolved its own version with
`require('../package.json')`. That works when running from source
(`packages/mcp-server/src/index.js` → `packages/mcp-server/package.json`)
but fails when bundled to `packages/extension/dist/mcp/index.mjs` —
`../package.json` resolves to a non-existent
`packages/extension/dist/package.json`.

Fix: read `version.json` (which `bundle-mcp.mjs` writes alongside the
bundle) first, fall back to `../package.json` for source/npx runs, fall
back to `'unknown'` if both fail. Verified end-to-end against the bundled
launcher with a real `initialize` handshake.

Anyone whose MCP entries pointed at the bundled launcher
(`~/.airtable-user-mcp/start.mjs` → `dist/mcp/index.mjs`) was affected.
Standalone npx runs (`npx -y airtable-user-mcp`) were not — that path
keeps `package.json` adjacent. mcp-server: 2.4.0 → 2.4.1.

### MCP Server 2.4.0 — Sidebar sections, view setup, non-grid metadata, user-report bug fixes (user report 2026-04-30)

**16 net-new tools (52 total, was 36).** All endpoints captured against Airtable's internal API on 2026-04-30 with `pnpm capture:cdp:mutations`.

#### New features (user report §1.3, §1.4, §3.1)

**View sections (sidebar grouping) — new `view-section` category, defaults on in `safe-write`:**
- `list_view_sections` — read all sections in a table with their view membership and the table-level mixed `viewOrder` (mixes view IDs and section IDs)
- `create_view_section` — generate a `vsc...` ID and create a section
- `rename_view_section` — change a section's name
- `move_view_to_section` — single tool covering four user actions: move view INTO section, move view OUT to ungrouped, reorder sections among each other, reorder views within a section. Maps to one Airtable endpoint (`moveViewOrViewSection`)
- `delete_view_section` — destroy a section. Verified behavior: views inside the section are NOT deleted — Airtable auto-promotes them into the table-level `viewOrder` at the position the section used to occupy. Lives in the new `view-section-destructive` category, gated to `full` profile

**View column setup — extend `view-write`:**
- `set_view_columns` — one-shot tool that hides every column, shows only `visibleColumnIds`, places them in left-to-right order, and optionally sets `frozenColumnCount`. Solves the user report's §1.4 "new views show all 168 fields, unusable until manually trimmed" problem in a single call
- `show_or_hide_all_columns` — bulk on/off. Closes the §3.2 doc-promised-but-missing tool
- `move_visible_columns` — move columns to a target index in the *visible-only* ordering
- `move_overall_columns` — same, but in the *overall* (visible + hidden) ordering. Distinct from existing `reorder_view_fields` (which writes the full map) and from `move_visible_columns` (different index space)
- `update_frozen_column_count` — set the frozen-column divider position

**View presentation (Kanban / Gallery / Calendar) — extend `view-write`:**
- `set_view_cover` — set or clear the cover-image field and choose `fit` vs `crop`. Same endpoints work for both Kanban and Gallery (verified)
- `set_view_color_config` — apply a color config. Currently supports `type: "selectColumn"` (cards colored by a single-select field's choice colors); other types pass through for forward compatibility
- `set_view_cell_wrap` — toggle whether long values wrap (multi-line) or truncate (single-line)
- `set_calendar_date_columns` — set `dateColumnRanges`. Each entry is `{ startColumnId }` for single-point events or `{ startColumnId, endColumnId }` for ranges; the array form lets a Calendar overlay multiple date series at once

**Form metadata (legacy form views only) — new `form-write` category, opt-in (gated to `full` profile since changes are visible to anyone with the form URL):**
- `set_form_metadata` — bundled tool that fans out to atomic Airtable endpoints for `description`, `afterSubmitMessage`, `redirectUrl`, `refreshAfterSubmit`, `shouldAllowRequestCopyOfResponse`, `shouldAttributeResponses`, `isAirtableBrandingRemoved`. Unset properties are not touched
- `set_form_submission_notification` — per-user email-on-submit toggle (separate because it's per-user, not per-form)

Note on builder forms: Airtable's "Interfaces" / page-based forms (`page/{pageId}/*` endpoints, layout-engine element trees) are intentionally out of scope — they're a separate product surface that warrants a dedicated tool family. Filed as a follow-up.

**Categories now in `safe-write`:** `read`, `table-write`, `field-write`, `view-write`, `view-section`. Categories opt-in only via `full` or `custom`: `*-destructive`, `view-section-destructive`, `form-write`, `extension`.

#### Bug fixes (user report §1.2, §2.x, §4.3)

- **`isEmpty` / `isNotEmpty` on text + formula(text) + lookup/rollup(text) fields** — auto-rewritten to `=` / `!=` `""` before sending. The internal API rejects the documented operators with `FAILED_STATE_CHECK` on these field types; the rewrite happens client-side using the cached table schema (§2.1, §2.2)
- **`isEmpty` / `isNotEmpty` on linked-record (foreignKey) fields** — now throws a clear error pointing at the helper-formula workaround instead of letting Airtable's opaque `422` through (§2.3)
- **3-level nested filter rejection** — `updateViewFilters` errors now annotate the depth, the leaf operators that failed, and the recommended flatten pattern (`(A AND B) OR (A AND C)` instead of `A AND (B OR C)`) (§2.4, §2.5)
- **`reorder_view_fields` accepts partial maps** — pass only the field IDs you want to move; the tool reads the current `columnOrder`, applies moves in ascending target-position order, and sends the complete map. Avoids the `FAILED_STATE_CHECK` Airtable's internal API returns for single-key payloads (§2.6)
- **`manage_tools` discoverability** — `ListTools` response now includes a dynamic description on `manage_tools` listing every tool hidden by the active profile (e.g. `delete_table` / `delete_field` / `delete_view` in `safe-write`). `get_tool_status` also returns a `disabledByCategory` summary so an LLM can show the user what to enable (root-cause behind §1.2 — the delete tools always existed, they were just filtered)
- **Tool docstring audit** — corrected `update_view_filters`, `show_or_hide_view_columns`, and `reorder_view_fields` descriptions to match actual behavior (§4.3)

### Fixed (Audit Round 3)
- **Formatter version setting was inert** — Dashboard's "Formatter version" dropdown now actually switches engines. Extension consolidated on `airtableFormula.formula.formatterVersion` and reads this key from all four load sites; legacy `beautifierVersion` / `minifierVersion` remain as fallback for user settings migrated from prior versions
- **Browser-choice changes didn't propagate to IDE MCP configs** — Selecting a different browser (or picking a custom path) now re-writes the MCP entry for every already-configured IDE, so the new `AIRTABLE_BROWSER_CHANNEL` / `AIRTABLE_BROWSER_PATH` env vars take effect immediately instead of staying stale until the next Setup
- **Toggle MCP Tool Category command couldn't toggle table categories** — Added `tableWrite` and `tableDestructive` to the command palette quick-pick; also fixed mis-mapped `fieldWrite` / `viewWrite` file keys that were breaking the label and tool-count display for those rows
- **Formatter commands missing from command palette** — `beautify`, `minify`, `beautifyWithStyle`, `minifyWithLevel`, and `formatWithPreset` are now contributed in `package.json`, with `.formula` language enablement. `beautifyFile` / `minifyFile` added to the explorer context menu for `.formula` files
- **Webview action cards weren't keyboard-accessible** — All clickable `.action-card` divs are now `<button>` elements (or proper `<a>` for links); added `:focus-visible` outline and button resets so styling is preserved
- **Browser select had no way back to Auto** — Added an "Auto (pick best available)" option to the Settings browser dropdown
- **Dead "Docs" button on undetected IDE cards** — Now links to each IDE's install/docs URL (Cursor, Windsurf, Claude Code/Desktop, Cline, Amp)
- **`AIRTABLE_USER_MCP_HOME` advertised but not honored** — Introduced `packages/mcp-server/src/paths.js` as the single source of truth; `auth.js`, `tool-config.js`, `health-check.js`, `login.js`, `login-runner.js`, `manual-login-runner.js`, and `cli.js` all read config and profile paths through it so the env var works everywhere, not just in the CLI `status` / `doctor` commands
- **CI npm-pack smoke masked failures** — Removed `|| true` so `npm pack --dry-run` failures (missing files, malformed package.json) actually fail the job; switched to `set -euo pipefail` and a workspace-relative log file instead of `/tmp/`
- **README screenshot TODOs** — Removed placeholder comments in the root and mcp-server READMEs

### Fixed (Audit Round 2)
- **Incomplete URL injection guard** — `renameTable`, `deleteTable`, `createView`, `updateFieldConfig`, and `renameField` now validate Airtable IDs before URL construction (previously only early resolvers caught the issue)
- **Auth logout timer leak** — `AuthManager.logout()` now stops the auto-refresh timer before wiping credentials, eliminating ghost browser launches against a cleared profile
- **Dashboard logout false-success** — Cancelling the logout confirmation modal now correctly reports cancellation to the webview instead of claiming success
- **`manualTestLogPath` secret leakage** — Debug mirror now scrubs `secretSocketId`, CSRF tokens, Bearer headers, passwords, OTP secrets, and cookies before writing to disk
- **Hung child-process cleanup** — Auth manager's `_spawnScript` now escalates to `SIGKILL` 5 s after `SIGTERM` if a child process ignores the termination signal
- **Non-atomic config writes** — `tools-config.json` is now written via a temp file + rename, preventing truncation on mid-write crashes
- **Debug tracer crash on circular refs** — `trace()` now uses a circular-safe stringify with a breadcrumb fallback so unusual tool arguments can't crash the server
- **Debug tracer error-message redaction** — Thrown error messages routed through `traceToolHandler` now have bearer tokens, CSRF tokens, and `secretSocketId` values scrubbed
- **Weak request-ID randomness** — Replaced `Math.random()` with `crypto.randomBytes` for Airtable request IDs, entity IDs, and `page-load-id` headers
- **`_rawApiCall` ignored `method` in JSON branch** — JSON content-type calls were hardcoded to POST; now honor GET/PUT/PATCH/DELETE from the caller
- **Silent skill-install failure** — `installSkills()` during activation is now wrapped so failures log a warning instead of going unnoticed
- **Fallback `ToolProfileSnapshot` was missing new categories** — Added `tableWrite` / `tableDestructive` keys to the DashboardProvider fallback, fixing a latent TS type error
- **Non-graceful MCP server shutdown** — `SIGINT` / `SIGTERM` now run a bounded, idempotent shutdown (5 s timeout) that closes the transport and stops file watchers before exit, reducing Chromium orphans on Windows
- **Unbounded schema cache** — `SchemaCache` now enforces a 50-entry LRU cap per map, preventing memory growth for long-running servers managing many bases
- **`check-tool-sync.mjs` coverage gaps** — Now also detects drift in `BUILTIN_PROFILES` category arrays and `CATEGORY_LABELS` keys between the server and the extension mirror
- **`_apiCall` could stall forever** — Added a hard 30 s wall-clock budget so a hung `_recoverSession` can't block queued requests indefinitely
- **Webview payload validation** — `App.tsx` now runtime-checks incoming `state:update` / `auth:state` messages, silently dropping malformed payloads instead of crashing the React tree
- **Orphan browser on login failure** — `login.js` now wraps its main automation in `try/finally` so selector misses and TOTP crashes always close the Chrome context
- **No rate limit on inbound tool calls** — MCP server now caps concurrent tool calls (default 16, `AIRTABLE_MAX_CONCURRENT_TOOLS` to override), preventing runaway LLM loops from flooding the auth queue
- **Accessibility** — Dashboard tabs now use proper `role="tab"` / `role="tabpanel"` / `aria-selected`; footer links, toggle switches, and buttons have explicit `aria-label`s for screen readers
- **`autoConfigureOnInstall` default drift** — Fixed `packages/extension/package.json` default from `false` to `true` to match `settings.ts` and the webview store

### Fixed (Audit Round 1)
- **Hardcoded MCP version** — Server now reads its version from `package.json` at runtime instead of a stale constant
- **Settings default mismatch** — Webview `autoConfigureOnInstall` default now matches extension default (`true`)
- **Debug secret leakage** — Debug tracer now redacts `_csrf`, `secretSocketId`, `password`, `otpSecret`, and other credentials before writing to stderr
- **URL injection guard** — All Airtable ID parameters are validated before interpolation into API URLs, preventing path-traversal attacks from malformed tool arguments
- **CI matrix** — GitHub Actions now runs on `ubuntu-latest`, `windows-latest`, and `macos-latest`
- **Build script robustness** — `check-tool-sync.mjs` now uses brace-counting instead of a fragile regex to parse the TypeScript mirror

## [2.0.11] - 2026-04-11

### Added
- **Dual-channel publishing** — MCP server now available as standalone `airtable-user-mcp` npm package
- **CLI subcommands** — `npx airtable-user-mcp login`, `logout`, `status`, `doctor`, `install-browser`
- **Dashboard version card** — Shows extension + bundled MCP server versions with update-available hints
- **Build-time version manifest** — Fixes hardcoded `v2.0.0` MCP version bug in dashboard
- **GitHub Actions CI/CD** — Publish workflows for npm, VS Code Marketplace, and Open VSX

### Changed
- **Package rename** — MCP server renamed from `mcp-internal-airtable` to `airtable-user-mcp`
- **Lazy-load patchright** — Dynamic imports for browser deps (smaller install, no crash without browser)
- **Command renames** — `checkSession` → `status`, `downloadBrowser` → `install-browser`

## [0.2.0] - 2026-01-24

### Added
- **Context menu submenus** for beautify styles and minify levels
- **Batch style/level commands** for explorer selections

### Changed
- **Explorer file operations** now use file-based formatting for better stability
- **Minify in-place** when running on `.min.formula` or `.ultra-min.formula`

### Fixed
- **Beautifier v2 JSON performance** improvements to prevent extension host freezes
- **Vendor script resolution** consistency across style/level commands

## [0.1.0] - 2025-09-28

### Added
- **Airtable-Matching Color Scheme**: Exact syntax highlighting colors matching Airtable's interface
- **Intelligent Diagnostics**: Real-time error detection for unclosed parentheses, brackets, quotes
- **IntelliSense Support**: Auto-completion for all Airtable functions with parameter hints
- **Version Selection**: Choose between v1 (stable) and v2 (enhanced) for beautifier and minifier
- **New Formatting Styles**: `smart` style (v2) and `safe` minification level (v2)
- **Extended File Support**: `.min.formula` and `.ultra-min.formula` extensions
- **Enhanced Error Reporting**: Better parenthesis mismatch detection with linked errors

### Changed
- Default to v2 versions for both beautifier and minifier (with v1 fallback)
- Improved diagnostics to not flag `{}` as errors (used in JSON string building)

### Fixed
- Syntax highlighting for minified files
- False positive errors for empty field references `{}`
- Better handling of long single-line formulas in minified files

## [0.0.2] - 2025-09-24

### Added
- Initial release of Airtable Formula VS Code extension
- **Beautify functionality**: Format Airtable formulas with proper indentation and line breaks
- **Minify functionality**: Compress formulas to reduce size while maintaining functionality
- **Syntax highlighting**: Full support for `.formula` files with custom language definition
- **Multiple formatting styles**: Ultra-compact, compact, readable, JSON, and cascade styles
- **Customizable settings**: Configure indentation, line length, quote style, and minification levels
- **Context menu integration**: Right-click options for beautify/minify in formula files
- **File operations**: Batch beautify/minify operations on multiple files
