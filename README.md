<div align="center">

<img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/airtable.svg" alt="Airtable" width="80" />

# Airtable Formula

**Formula editor, MCP server, and AI skills for VS Code**

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula"><img src="https://vsmarketplacebadges.dev/version-short/Nskha.airtable-formula.svg?style=for-the-badge&label=VS%20Code&colorB=007ACC" alt="VS Code version" /></a>
  <a href="https://open-vsx.org/extension/Nskha/airtable-formula"><img src="https://img.shields.io/open-vsx/v/Nskha/airtable-formula?style=for-the-badge&logo=eclipseide&logoColor=white&label=Open%20VSX&color=C160EF" alt="Open VSX version" /></a>
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/v/airtable-user-mcp?style=for-the-badge&logo=npm&logoColor=white&label=npm&color=CB3837" alt="npm version" /></a>
  <a href="https://registry.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Registry-Listed-1D4ED8?style=for-the-badge" alt="MCP Registry listing" /></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula"><img src="https://vsmarketplacebadges.dev/installs-short/Nskha.airtable-formula.svg?style=for-the-badge&label=VS%20Code%20Installs&colorB=1E8CBE" alt="VS Code installs" /></a>
  <a href="https://open-vsx.org/extension/Nskha/airtable-formula"><img src="https://img.shields.io/open-vsx/dt/Nskha/airtable-formula?style=for-the-badge&logo=eclipseide&logoColor=white&label=Open%20VSX%20Downloads&color=A855F7" alt="Open VSX downloads" /></a>
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/dw/airtable-user-mcp?style=for-the-badge&logo=npm&logoColor=white&label=npm%20Downloads%2FWeek&color=F43F5E" alt="npm downloads per week" /></a>
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/stargazers"><img src="https://img.shields.io/github/stars/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=github&logoColor=white&label=GitHub%20Stars&color=FBBF24" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Automations-Project/VSCode-Airtable-Formula/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI" alt="CI status" /></a>
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/releases/latest"><img src="https://img.shields.io/github/v/release/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=github&logoColor=white&label=Latest%20Release&color=10B981" alt="Latest release" /></a>
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/commits/main"><img src="https://img.shields.io/github/last-commit/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=github&logoColor=white&label=Last%20Commit&color=6366F1" alt="Last commit" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=opensourceinitiative&logoColor=white&label=License&color=22C55E" alt="License" /></a>
</p>

<br />

> **Not affiliated with Airtable Inc.** This is a community-maintained project.
>
> **Experimental** — This project is under active development and not intended for production use. APIs, tools, and behavior may change without notice.

</div>

---

## What's In This Repo

This monorepo ships **two products** from one source tree:

<div align="center">

| | Product | Install |
|:-:|:--------|:--------|
| <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/extension/images/icon.png" width="24" /> | **Airtable Formula** — VS Code extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula) |
| <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/mcp-server/assets/icon.png" width="24" /> | **airtable-user-mcp** — Standalone MCP server | `npx airtable-user-mcp` |

</div>

---

## Features

### VS Code Extension

- **Formula Editor** — Syntax highlighting, IntelliSense, beautify / minify for `.formula` files
- **MCP Server** — One-click MCP registration for multiple IDEs
- **AI Skills** — Auto-install Airtable-specific skills, rules, and workflows for AI coding assistants
- **Airtable Login** — Credentials in OS keychain, browser-based auth with auto-refresh
- **Dashboard** — React webview with Overview, Setup, and Settings tabs

<!-- TODO: Replace with actual screenshot -->
<!-- <p align="center"><img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/extension/images/screenshot-dashboard.png" alt="Dashboard Screenshot" width="700" /></p> -->

### MCP Server (30 Tools)

Manage Airtable bases with capabilities **not available through the official REST API**:

| Category | Tools | Highlights |
|:---------|:-----:|:-----------|
| **Schema Read** | 5 | Full schema inspection — bases, tables, fields, views |
| **Field Management** | 8 | Create formula / rollup / lookup / count fields, validate formulas |
| **View Configuration** | 11 | Filters, sorts, grouping, column visibility, row height |
| **Field Metadata** | 1 | Set or update field descriptions |
| **Extension Management** | 5 | Create, install, enable/disable, rename, remove extensions |

See the full tool reference in [`packages/mcp-server/README.md`](packages/mcp-server/README.md).

---

## Supported IDEs

The extension auto-configures MCP for all major AI-enabled editors:

<div align="center">

| <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/claude.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/claude-code.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/cursor.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/windsurf.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/cline.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/amp.svg" width="28" /> |
|:---:|:---:|:---:|:---:|:---:|:---:|
| Claude Desktop | Claude Code | Cursor | Windsurf | Cline | Amp |

</div>

**Don't use VS Code?** Use the standalone MCP server directly:

```bash
npx airtable-user-mcp
```

---

## Find Us

<div align="center">

| Registry | Link |
|:---------|:-----|
| **VS Code Marketplace** | [`Nskha.airtable-formula`](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula) |
| **npm** | [`airtable-user-mcp`](https://www.npmjs.com/package/airtable-user-mcp) |
| **Open VSX** | [`Nskha.airtable-formula`](https://open-vsx.org/extension/Nskha/airtable-formula) |
| **MCP Registry** | [`io.github.automations-project/airtable-user-mcp`](https://registry.modelcontextprotocol.io) |
| **Glama** | [glama.ai/mcp/servers](https://glama.ai/mcp/servers/Automations-Project/VSCode-Airtable-Formula) |
| **PulseMCP** | [pulsemcp.com](https://www.pulsemcp.com/servers/automations-project-airtable-user) |
| **MCP.so** | [mcp.so](https://mcp.so/client/airtable-user-mcp/Automations-Project) |

</div>

---

## Requirements

- **VS Code** ^1.100.0 (or any fork exposing the `McpServerDefinitionProvider` API)
- **Node.js** — bundled via the VS Code runtime; no separate install needed
- **Google Chrome** (or Edge / Chromium) — the Airtable login flow uses [Patchright](https://github.com/Kaliiiiiiiiii/patchright-nodejs) in headless mode. Falls back to `msedge` on Windows and `chromium` on Linux. The extension shows an actionable warning if no supported browser is detected.

---

## Development

This is a **pnpm monorepo**.

| Package | Description |
|:--------|:------------|
| `packages/extension` | VS Code extension host (TypeScript + tsup) |
| `packages/webview` | React dashboard webview (Vite + Tailwind v4) |
| `packages/shared` | Shared types and message protocol |
| `packages/mcp-server` | [`airtable-user-mcp`](https://www.npmjs.com/package/airtable-user-mcp) — ESM Node MCP server |
| `scripts/` | Build tooling (esbuild bundler, dep vendoring) |

```bash
pnpm install          # install all packages
pnpm build            # build shared → webview → mcp bundle → extension
pnpm package          # build + create airtable-formula-X.Y.Z.vsix
pnpm test             # run all unit tests
pnpm dev              # start webview dev server (browser preview)
```

**How the MCP server is bundled:** `scripts/bundle-mcp.mjs` esbuilds `packages/mcp-server/src/` into `packages/extension/dist/mcp/`. Then `scripts/prepare-package-deps.mjs` vendors `patchright`, `patchright-core`, and `otpauth` into `dist/node_modules/` before `vsce package` runs. The VSIX is fully self-contained.

---

## Support This Project

This project is built and maintained with the help of AI coding tools. If you find it useful and want to support continued development (new tools, updates, bug fixes), you can contribute by gifting **Claude Code credits** — the primary tool used to build this project.

Interested? [Open an issue](https://github.com/Automations-Project/VSCode-Airtable-Formula/issues/new) or reach out to discuss feature requests and sponsorship.

---

## License

[MIT](LICENSE)
