# Airtable Formula

Airtable formula editor, MCP server installer, and AI skills for VS Code.

## Features

- **Formula Editor** — Syntax highlighting, IntelliSense, beautify/minify for `.formula` files
- **MCP Server** — One-click multi-IDE MCP configuration (Cursor, Windsurf, Claude Code, Cline, Amp)
- **AI Files** — Install Airtable-specific skills, rules, workflows, and agents for AI coding assistants
- **Airtable Login** — Credentials in OS keychain, headless session with auto-refresh
- **Dashboard** — React webview with Overview, Setup, and Settings tabs

## Requirements

- **VS Code** ^1.100.0 (or any fork exposing the `McpServerDefinitionProvider` API)
- **Node.js** is bundled via the VS Code runtime — no separate install required
- **Google Chrome** (or Microsoft Edge / Chromium) installed on the machine — the
  Airtable login flow uses [Patchright](https://github.com/Kaliiiiiiiiii/patchright-nodejs)
  in headless mode and launches a real system browser with `channel: 'chrome'`
  (falls back to `msedge` on Windows and `chromium` on Linux if Chrome is
  absent). The extension runs a preflight check at activation time and shows
  an actionable warning in the dashboard if no supported browser is detected.
  Playwright's bundled Chromium is intentionally **not** shipped in the VSIX
  to keep the install small.

## Development

This is a pnpm monorepo.

**Packages:**
- `packages/extension` — VS Code extension host (TypeScript + tsup)
- `packages/webview` — React dashboard webview (Vite + Tailwind v4)
- `packages/shared` — Shared types and message protocol
- `packages/mcp-server` — Airtable MCP server (`airtable-user-mcp`, ESM Node app with Patchright browser auth)

**Commands:**
```bash
pnpm install          # install all packages
pnpm build            # build shared → webview → mcp copy → extension
pnpm package          # build + create airtable-formula-X.Y.Z.vsix
pnpm test             # run all unit tests
pnpm dev              # start webview dev server (browser preview)
```

**MCP server:** The `airtable-user-mcp` workspace package (at `packages/mcp-server/`) is resolved via `workspace:*` and bundled into `packages/extension/dist/mcp/` by `scripts/bundle-mcp.mjs` during the build step. Native browser-automation deps (`patchright`, `patchright-core`, `otpauth`) are vendored into `dist/node_modules/` by `scripts/prepare-package-deps.mjs` before `vsce package` runs.
