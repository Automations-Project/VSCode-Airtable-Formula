# Airtable Formula

Airtable formula editor, MCP server installer, and AI skills for VS Code.

## Features

- **Formula Editor** — Syntax highlighting, IntelliSense, beautify/minify for `.formula` files
- **MCP Server** — One-click multi-IDE MCP configuration (Cursor, Windsurf, Claude Code, Cline, Amp)
- **AI Files** — Install Airtable-specific skills, rules, workflows, and agents for AI coding assistants
- **Dashboard** — React webview with Overview, Setup, and Settings tabs

## Development

This is a pnpm monorepo.

**Packages:**
- `packages/extension` — VS Code extension host (TypeScript + tsup)
- `packages/webview` — React dashboard webview (Vite + Tailwind v4)
- `packages/shared` — Shared types and message protocol

**Commands:**
```bash
pnpm install          # install all packages
pnpm build            # build shared → webview → mcp copy → extension
pnpm package          # build + create airtable-formula-X.Y.Z.vsix
pnpm test             # run all unit tests
pnpm dev              # start webview dev server (browser preview)
```

**MCP server:** The `mcp-internal-airtable` npm package is resolved from the workspace
root `devDependencies` and copied into `packages/extension/dist/mcp/` by
`scripts/bundle-mcp.mjs` during the build step.
