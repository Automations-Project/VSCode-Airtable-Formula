# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension for Airtable formula editing with MCP server integration and AI skills installer. Published as `airtable-formula` by `Nskha` on the VS Code Marketplace.

## Commands

```bash
pnpm install              # install all workspace packages
pnpm build                # build all: shared → webview → bundle MCP → extension
pnpm dev                  # webview dev server (Vite, browser preview)
pnpm test                 # run all tests across packages
pnpm package              # create .vsix (build must be run first)
pnpm packx                # full build + version bump + package .vsix
pnpm packx:no-bump        # full build + package .vsix without version bump
```

### Per-package

```bash
pnpm -F shared build      # build shared types (tsup → ESM)
pnpm -F webview build     # build webview (Vite → extension/dist/webview/)
pnpm -F webview dev       # webview dev server
pnpm -F airtable-formula build   # build extension (tsup → CJS)
pnpm -F airtable-formula test    # run extension tests
```

## Architecture

**pnpm monorepo** with four packages:

### packages/shared
Typed message protocol between extension host and webview. Exports `ExtensionMessage` and `WebviewMessage` discriminated unions, plus shared types (`DashboardState`, `IdeStatus`, `IdeId`, `SettingsSnapshot`, `AuthState`, `BrowserInfo`, `BrowserDownloadState`). Both extension and webview import from here.

### packages/webview
React 19 + Vite 6 + Tailwind CSS v4 + Zustand 5 dashboard. Three tabs: Overview, Setup, Settings. Builds directly into `packages/extension/dist/webview/`. Communicates with the extension host via `acquireVsCodeApi().postMessage()` — messages are typed through the shared package.

### packages/mcp-server
The Airtable MCP server itself — ES modules Node app, **published to npm as `airtable-user-mcp`**. Provides 30+ tools (schema, field CRUD, view configuration, formula validation, extension management) via `@modelcontextprotocol/sdk`. Uses `patchright` (Chromium stealth fork) with a persistent profile for browser-based authentication against Airtable's internal API.

Standalone users install via `npx airtable-user-mcp` or `npm i -g airtable-user-mcp`. The CLI exposes subcommands: `login`, `logout`, `status`, `doctor`, `install-browser`. Config and session data live in `~/.airtable-user-mcp/`.

`patchright` and `otpauth` are declared as `optionalDependencies` and lazy-loaded via dynamic `import()` so the server starts without them until browser-based auth is actually needed.

Key files:
- `src/index.js` — MCP server entry point, tool registration
- `src/auth.js` — `AirtableAuth` class, browser launch, CSRF/secretSocketId capture
- `src/client.js` — `AirtableClient`, wraps internal API with caching
- `src/cache.js` — request cache
- `src/login.js` — interactive CLI login
- `src/login-runner.js` — programmatic login spawned by extension host
- `src/health-check.js` — session health check spawned by extension host
- `src/tool-config.js` — profile/category tool gating (`~/.airtable-user-mcp/tools-config.json`)
- `dev-tools/` — reverse-engineering helpers (capture.js, analyze.js, debug-*.js), **gitignored** — kept locally for future reference when Airtable changes their internal API

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

Build order matters (shared first, webview second, MCP third, extension last):
1. `tsup` builds shared types to ESM
2. `vite build` compiles React webview into `packages/extension/dist/webview/`
3. `scripts/bundle-mcp.mjs` uses esbuild to bundle the MCP server (from `packages/mcp-server/src/`) into `packages/extension/dist/mcp/{index,login-runner,health-check}.mjs`. Patchright and otpauth are kept external and vendored separately. It also emits `dist/mcp/version.json` containing the bundled server version, package name, build timestamp, and git SHA — the extension dashboard reads this at runtime to display the active MCP server version.
4. `scripts/prepare-package-deps.mjs` copies `patchright`, `patchright-core`, and `otpauth` from the workspace's hoisted `node_modules/` into `packages/extension/dist/node_modules/` using `dereference: true` to follow pnpm symlinks (invoked during `package:vsix`).
5. `tsup` builds extension to CJS, then copies `src/vendor/` to `dist/vendor/`

The MCP server source lives in `packages/mcp-server/` and is resolved via `"airtable-user-mcp": "workspace:*"` in both root and extension devDependencies. The shared `pnpm-workspace.yaml` uses `packages/*` glob so the package is picked up automatically.

## Release Flow

Two independent release channels from the same monorepo:

- **MCP server (npm):** Create a GitHub Release with tag `mcp-server/vX.Y.Z` → `publish-mcp-server.yml` publishes `airtable-user-mcp@X.Y.Z` to npm with provenance.
- **Extension (Marketplace + Open VSX):** Create a GitHub Release with tag `extension/vX.Y.Z` → `publish-extension.yml` publishes the VSIX.

Version numbers are independent (Strategy C). The extension bundles whatever MCP server version was in `packages/mcp-server/` at build time.

## Language

The extension registers language ID `airtable-formula` for file extensions `.formula`, `.min.formula`, `.ultra-min.formula`. TextMate grammar is at `src/syntaxes/airtable-formula.tmLanguage.json`.

## Key Settings

All under `airtableFormula.*`:
- `mcp.autoConfigureOnInstall` — auto-write MCP config to detected IDEs on first launch
- `ai.autoInstallFiles` — auto-install AI skills/rules on first launch
- `formula.formatterVersion` — `v1` or `v2` beautifier/minifier engine
