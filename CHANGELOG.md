# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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
