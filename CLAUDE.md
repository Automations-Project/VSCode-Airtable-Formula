# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension for Airtable formula editing with MCP server integration and AI skills installer. Published as `airtable-formula` by `Nskha` on the VS Code Marketplace.

## Commands

```bash
pnpm install              # install all workspace packages
pnpm build                # full build: tool-sync check → shared → webview → bundle MCP → extension
pnpm dev                  # webview dev server (Vite, browser preview)
pnpm test                 # tool-sync check + shared + mcp-server + webview + extension tests
pnpm check:tool-sync      # verify mcp-server ↔ extension tool-category mirror is in sync
pnpm package              # create .vsix (build must be run first)
pnpm packx                # full build + version bump + package .vsix
pnpm packx:no-bump        # full build + package .vsix without version bump
```

### Per-package

```bash
pnpm -F shared build             # build shared types (tsup → ESM)
pnpm -F webview build            # build webview (Vite → extension/dist/webview/)
pnpm -F webview dev              # webview dev server
pnpm -F webview test             # vitest (webview)
pnpm -F airtable-user-mcp test   # node --test (mcp-server — 96 unit tests)
pnpm -F airtable-formula build   # build extension (tsup → CJS)
pnpm -F airtable-formula test    # vitest (extension)
```

### Running a single test

- **mcp-server** — `node --test packages/mcp-server/test/test-client.js` (specific file). Append `--test-name-pattern="getView"` to filter by name.
- **webview / extension** — vitest accepts `-t <pattern>`: `pnpm -F webview vitest run -t "merges static metadata"`.

## Architecture

**pnpm monorepo** with five packages:

### packages/shared
Typed message protocol between extension host and webview. Exports `ExtensionMessage` and `WebviewMessage` discriminated unions, plus shared types (`DashboardState`, `IdeStatus`, `IdeId`, `SettingsSnapshot`, `AuthState`, `BrowserInfo`, `BrowserDownloadState`). Both extension and webview import from here.

### packages/webview
React 19 + Vite 6 + Tailwind CSS v4 + Zustand 5 dashboard. Three tabs: Overview, Setup, Settings. Builds directly into `packages/extension/dist/webview/`. Communicates with the extension host via `acquireVsCodeApi().postMessage()` — messages are typed through the shared package.

### packages/mcp-server
The Airtable MCP server itself — ES modules Node app, **published to npm as `airtable-user-mcp`**. Provides **62 tools** across 12 categories (read, table-write, table-destructive, field-write, field-destructive, view-write, view-destructive, view-section, view-section-destructive, form-write, extension, tool-management) via `@modelcontextprotocol/sdk`. Uses `patchright` (Chromium stealth fork) with a persistent profile for browser-based authentication against Airtable's internal API.

Standalone users install via `npx airtable-user-mcp` or `npm i -g airtable-user-mcp`. The CLI exposes subcommands: `login`, `logout`, `status`, `doctor`, `install-browser`, `daemon start/stop/status`. Config and session data live in `~/.airtable-user-mcp/`.

`patchright` and `otpauth` are declared as `optionalDependencies` and lazy-loaded via dynamic `import()` so the server starts without them until browser-based auth is actually needed.

Key files:
- `src/index.js` — MCP server entry point, tool registration
- `src/auth.js` — `AirtableAuth` class, browser launch, CSRF/secretSocketId capture
- `src/client.js` — `AirtableClient`, wraps internal API with caching. `normalizeFieldType()` translates public-API type names to internal names before every request: `multipleSelects` → `multiSelect`, `singleSelect` → `select`. Always use the public names (`singleSelect`, `multipleSelects`) in tool calls — never the internal names. Choices arrays are also normalised here from `[{ name, color }]` to the keyed-object format the internal API requires.
- `src/cache.js` — request cache
- `src/login.js` — interactive CLI login
- `src/login-runner.js` — programmatic login spawned by extension host
- `src/health-check.js` — session health check spawned by extension host
- `src/tool-config.js` — **authoritative** tool → category map + profile gating (`~/.airtable-user-mcp/tools-config.json`). Any change here must also land in `packages/extension/src/mcp/tool-profile.ts` + `packages/extension/package.json` + `packages/webview/src/tabs/Settings.tsx` + `packages/shared/src/types.ts`. `scripts/check-tool-sync.mjs` fails the build if drift is detected.
- `dev-tools/` — reverse-engineering helpers (capture.js, analyze.js, debug-*.js), **gitignored** — kept locally for future reference when Airtable changes their internal API
- `src/daemon/` — daemon subsystem (see daemon subsection below)
- `src/safe-write.js` — atomic JSON write helper (used by lockfile, token, and settings)

#### packages/mcp-server — Daemon subsystem

New in v2.0: `packages/mcp-server/src/daemon/`

**Port source:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP`

Files ported (with Airtable-specific adaptations):
- `lockfile.ts` → `lockfile.js` — acquire/release/replace/isStale lockfile lifecycle
- `launcher.ts` → `launcher.js` — `ensureDaemon`, `startDaemon`, `stopDaemon`, `spawnDetachedDaemon`
- `server.ts` → `server.js` — Express HTTP server (MCP + health + SSE events + tunnel endpoints)
- `attach.ts` → inlined in `src/index.js` attach-proxy block

New files (Airtable-specific, not in Perplexity source):
- `token.js` — bearer token generate/read/rotate
- `tunnel.js` — tunnel lifecycle coordinator
- `install-tunnel.js` — cloudflared binary download/verify
- `safe-write.js` — atomic JSON writes (used by lockfile, token, settings)
- `cloudflared-pins.json` — SHA256 pin map for cloudflared binary verification
- `index.js` — barrel export
- `tunnel-providers/`
  - `types.js` — TunnelProvider interface
  - `cloudflared-quick.js` — Cloudflare Quick Tunnel (ephemeral URL)
  - `cloudflared-named.js` — Cloudflare Named Tunnel (persistent hostname)
  - `cloudflared-named-setup.js` — wizard for named tunnel credential setup
  - `ngrok.js` — ngrok tunnel provider
  - `index.js` — provider registry + settings I/O

**Lockfile schema** (`~/.airtable-user-mcp/daemon.lock`):

```js
{
  pid: number,
  uuid: string,
  port: number,          // HTTP MCP server port
  port_lsp: number|null, // LSP TCP port (null if lsp-server not spawned)
  bearerToken: string,
  version: string,
  startedAt: string,     // ISO 8601
  tunnelUrl: string|null // Active tunnel URL, null if no tunnel
}
```

**Transport modes:**
1. `AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp` — stdio standalone (in-process, no daemon)
2. `npx airtable-user-mcp` when daemon lock exists — stdio-proxy (stdin/stdout bridged to HTTP daemon)
3. VS Code extension via `DaemonManager` — direct HTTP to `http://127.0.0.1:{port}/mcp` with bearer token

### packages/lsp-server
Airtable language server — **published to npm as `airtable-user-lsp`**. Provides diagnostics, completions, hover, and signature help for Airtable formula, script, and automation files in any LSP-capable editor.

Entry point: `src/index.ts` (builds to `dist/index.mjs` via tsup).

Modes:
- `--stdio` — standalone LSP process (one per editor session)
- `--tcp` — spawned by daemon; multiple editors share one instance; port written to `port_lsp` in lockfile

Key files:
- `src/server.ts` — LSP server init, capability registration
- `src/tcp-server.ts` — TCP listener for daemon-spawned mode
- `src/lockfile-writer.ts` — writes `port_lsp` into `~/.airtable-user-mcp/daemon.lock`
- `src/lsp-convert.ts` — converts internal diagnostics/completions to LSP protocol types
- `src/router.ts` — routes requests to formula / script / automation engines

### View config reads — two-call pattern

`AirtableClient.getView()` makes **two** API calls:
1. `application/{appId}/read` (cached) — resolves `tableId` from `viewId` and returns static metadata (name, type, description).
2. `table/{tableId}/readData?includeDataForViewIds=[viewId]` (un-cached) — returns live state: `filters`, `lastSortsApplied` (exposed as `sorts`), `groupLevels`, `columnOrder` (rich `[{columnId, visibility, width?}]`), `frozenColumnCount`, `colorConfig`, `metadata`.

The `application/read` endpoint alone does **not** carry filter/sort/group state — it's why `update_view_filters`, `apply_view_sorts`, and `update_view_group_levels` all accept `operation: 'replace' | 'append'`. Append mode calls `getView()` internally to merge with existing config.

### packages/extension
VS Code extension host. Entry point: `src/extension.ts`.

Key subsystems:
- **Formula language features** — diagnostics (`diagnostics.ts`), completions (`completions.ts`), hover (`hover.ts`), signature help (`signature.ts`), code actions (`codeActions.ts`). Function metadata lives in `functions.ts`.
- **Webview host** — `src/webview/DashboardProvider.ts` implements `WebviewViewProvider`, manages state flow to the React dashboard.
- **MCP server** — `src/mcp/registration.ts` registers the bundled MCP server via VS Code's `McpServerDefinitionProvider` API. The MCP server source lives in the sibling `packages/mcp-server` workspace package and is bundled via `scripts/bundle-mcp.mjs` (esbuild) into `dist/mcp/index.mjs`.
- **Auth manager** — `src/mcp/auth-manager.ts` manages credential storage (VS Code SecretStorage), session health checks, programmatic login, auto-refresh timer, and browser detection/download orchestration.
- **Browser download** — `src/mcp/browser-download.ts` spawns `patchright-core install chromium` on demand for users without system Chrome/Edge/Chromium.
- **Auto-config** — `src/auto-config/` detects installed IDEs (Cursor, Windsurf, Claude Desktop/Code, Cline, Amp) and writes MCP server entries to their config files.
- **Skills installer** — `src/skills/` installs AI-specific rules/skills/workflows into IDE config directories.
- **Formatter** — `src/commands/` provides beautify and minify commands using vendored engines in `src/vendor/`.

### Extension ↔ Webview data flow
Extension computes `DashboardState` → sends `state:update` message → webview Zustand store updates → React re-renders. User actions in webview send typed `WebviewMessage` back → extension handles in `DashboardProvider`.

## Build Pipeline

Build order matters (drift check first, then shared → webview → MCP → extension):
1. `scripts/check-tool-sync.mjs` — verifies the extension's tool-category mirror matches `mcp-server/src/tool-config.js` and that profile counts in extension/package.json `enumDescriptions` are accurate. Build fails fast on drift.
2. `tsup` builds shared types to ESM
3. `vite build` compiles React webview into `packages/extension/dist/webview/`
4. `scripts/bundle-mcp.mjs` uses esbuild to bundle the MCP server (from `packages/mcp-server/src/`) into `packages/extension/dist/mcp/{index,login-runner,health-check,manual-login-runner}.mjs`. Patchright and otpauth are kept external and vendored separately. It also emits `dist/mcp/version.json` containing the bundled server version, package name, build timestamp, and git SHA — the extension dashboard reads this at runtime to display the active MCP server version.
5. `scripts/prepare-package-deps.mjs` copies `patchright`, `patchright-core`, and `otpauth` from the workspace's hoisted `node_modules/` into `packages/extension/dist/node_modules/` using `dereference: true` to follow pnpm symlinks (invoked during `package:vsix`).
6. `tsup` builds extension to CJS, then copies `src/vendor/` to `dist/vendor/`

**DaemonManager integration:** The extension's `src/mcp/daemon-manager.ts` reads `~/.airtable-user-mcp/daemon.lock` at startup and on file-watch events to check daemon health and expose `port` and `bearerToken` to `src/mcp/registration.ts` for direct HTTP transport.

The MCP server source lives in `packages/mcp-server/` and is resolved via `"airtable-user-mcp": "workspace:*"` in both root and extension devDependencies. The shared `pnpm-workspace.yaml` uses `packages/*` glob so the package is picked up automatically.

## Release Flow

Single unified workflow (`release.yml`) triggered manually via GitHub Actions UI:

1. **Go to:** Actions → Release → Run workflow
2. **Choose:** `target` (extension / mcp-server / both), `bump` (patch / minor / major), `dry_run`
3. **Workflow:** computes next version → builds → tests → publishes → commits bump → tags → creates GitHub Release

- **Extension** publishes to VS Code Marketplace + Open VSX
- **MCP server** publishes to npm with provenance
- Version numbers are independent. The extension bundles whatever MCP server version was in `packages/mcp-server/` at build time.
- Version bump is only committed **after** successful publish — no stale tags.

## Language

The extension registers language ID `airtable-formula` for file extensions `.formula`, `.min.formula`, `.ultra-min.formula`. TextMate grammar is at `src/syntaxes/airtable-formula.tmLanguage.json`.

## Dev-Tools: API Capture & Recording

Local-only (gitignored) tools for reverse-engineering Airtable's internal API. Used when we need to discover new endpoints or debug payload changes.

### Capture scripts

```bash
pnpm capture                # GUI Chrome, capture all v0.3 traffic to files
pnpm capture:mutations      # same, but only POST/PATCH/PUT/DELETE
pnpm capture:cdp            # GUI Chrome + CDP port 9222 (Chrome DevTools MCP can attach)
pnpm capture:cdp:mutations  # CDP + mutations only
```

All capture sessions save two files to `packages/mcp-server/dev-tools/captures/`:
- `<timestamp>.json` — full structured capture (requests, responses, mutations, WebSockets)
- `<timestamp>.summary.txt` — human-readable mutation chronicle

### Reading captures

When the user says they recorded something, check `packages/mcp-server/dev-tools/captures/` for the latest `.json` and `.summary.txt` files. The JSON contains:
- `mutations[]` — POST/PUT/PATCH/DELETE requests with decoded payloads
- `responses[]` — matched response status and body
- `stats.endpoints` — unique v0.3 endpoint patterns discovered

### Chrome DevTools MCP (local dev only)

Two MCP configs are registered for this project:
- **`chrome-devtools`** — launches its own GUI Chrome (profile: `~/.cache/chrome-devtools-mcp/airtable-profile`)
- **`chrome-devtools-patchright`** — attaches to patchright on `127.0.0.1:9222` (use with `pnpm capture:cdp`)

### Workflow: new endpoint → new tool

1. Run `pnpm capture:cdp` → perform the action manually in the browser
2. Read the capture JSON to identify the endpoint pattern and payload shape
3. Add the request method in `packages/mcp-server/src/client.js`
4. Add the tool definition in `packages/mcp-server/src/index.js`
5. Add the tool to a category in `packages/mcp-server/src/tool-config.js`

### Dev-tools file index

Located at `packages/mcp-server/dev-tools/` (gitignored):
- `capture.js` — main traffic capture tool (patchright + network interception)
- `analyze.js` — post-capture analysis
- `debug-login.js` / `debug-csrf.js` — auth/CSRF debugging
- `debug-create.js` / `debug-update.js` — payload format testing
- `debug-persistent.js` — persistent profile API testing

## Key Settings

All under `airtableFormula.*`:
- `mcp.autoConfigureOnInstall` — auto-write MCP config to detected IDEs on first launch
- `mcp.toolProfile` — `read-only` (9 tools) / `safe-write` (47 tools) / `full` (62 tools) / `custom`
- `mcp.categories.{read,tableWrite,tableDestructive,fieldWrite,fieldDestructive,viewWrite,viewDestructive,viewSection,viewSectionDestructive,formWrite,extension}` — per-category toggles when profile is `custom`
- `ai.autoInstallFiles` — auto-install AI skills/rules on first launch
- `formula.formatterVersion` — `v1` or `v2` beautifier/minifier engine

## Keeping tool categories in sync

The **authoritative** tool → category mapping lives in `packages/mcp-server/src/tool-config.js`. When adding, removing, renaming, or re-categorizing a tool, update all of:

1. `packages/mcp-server/src/tool-config.js` — source of truth
2. `packages/mcp-server/src/index.js` — tool definition + handler
3. `packages/shared/src/types.ts` — `ToolCategories` interface (if new category)
4. `packages/extension/src/mcp/tool-profile.ts` — mirror table + `CATEGORY_LABELS` + `BUILTIN_PROFILES` + `SETTINGS_TO_CATEGORY` + `getSnapshot()` + `categoryOrder` in `renderStatusReport`
5. `packages/extension/package.json` — `airtableFormula.mcp.categories.<key>` setting block + `enumDescriptions` profile counts + `mcpServerDefinitionProviders[].description` total count
6. `packages/webview/src/tabs/Settings.tsx` — `SettingToggle` row
7. `packages/webview/src/store.ts` + `src/test/store.test.ts` — default categories + `enabledCount` / `totalCount`

Run `pnpm check:tool-sync` — must print green ✓ before committing. It also runs as part of `pnpm build` and `pnpm test`.

<!-- PERPLEXITY-MCP-START -->
# Perplexity MCP Server

## Available Tools

- **perplexity_search** — Fast web search with source citations. Use for quick factual lookups. Works with or without authentication.
- **perplexity_reason** — Step-by-step reasoning with web context. Requires Pro account.
- **perplexity_research** — Deep multi-section research reports (30-120s). Requires Pro account.
- **perplexity_ask** — Flexible queries with explicit model/mode/follow-up control.
- **perplexity_compute** — ASI/Computer mode for complex multi-step tasks. Requires Max account.
- **perplexity_models** — List available models, account tier, and rate limits.
- **perplexity_retrieve** — Poll results from pending research/compute tasks.
- **perplexity_list_researches** — List saved research history with status.
- **perplexity_get_research** — Fetch full content of a saved research.
- **perplexity_login** — Open browser for Perplexity authentication.

## Usage Guidelines

1. **Start with perplexity_search** for quick questions. Only escalate to research or reason when depth is needed.
2. **Check rate limits** with perplexity_models before batch operations.
3. **Always cite sources** from search results in your responses.
4. **For multi-turn conversations**, pass the follow_up_context JSON from perplexity_ask responses back in subsequent calls.
5. **Long-running research**: perplexity_compute may time out. Use perplexity_retrieve with the returned research_id to poll for results.
6. **Language parameter**: Defaults to en-US. Set explicitly for non-English queries.

## Model Selection

| Tool | Default Model | Best For |
|------|--------------|----------|
| perplexity_search | pplx_pro | General web search |
| perplexity_reason | claude46sonnetthinking | Step-by-step analysis |
| perplexity_research | pplx_alpha | Deep research reports |
| perplexity_compute | pplx_asi | Complex multi-step tasks |
<!-- PERPLEXITY-MCP-END -->
