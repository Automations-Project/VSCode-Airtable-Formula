# Phase 9: Documentation - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 4 (CHANGELOG.md, packages/mcp-server/README.md, README.md, CLAUDE.md)
**Analogs found:** 4 / 4 — all target files are their own analogs (in-place edits)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `CHANGELOG.md` | changelog | append | Existing `## [2.0.11]` and `[Unreleased]` sections in same file | exact |
| `packages/mcp-server/README.md` | package-readme | append + update | Existing `## All CLI commands` and `## Protocol` sections in same file | exact |
| `README.md` | repo-readme | append | Existing `## Development` monorepo table + `## Features` section in same file | exact |
| `CLAUDE.md` | developer-guide | append | Existing `### packages/mcp-server` section + `## Architecture` block in same file | exact |

---

## Pattern Assignments

### `CHANGELOG.md` — Add v2.0 section

**Analog:** Same file, lines 7–53 (`## [Unreleased]` block) and lines 217–230 (`## [2.0.11]` block)

**Section header pattern** (lines 7, 217):
```markdown
## [Unreleased]

### MCP Server 2.5.0 — Record Templates (9 new tools) + round-4 user-report fixes (2026-05-01)
```
```markdown
## [2.0.11] - 2026-04-11

### Added
```

**Observation:** The `[Unreleased]` block uses free-form subheadings (`### MCP Server 2.5.0 — ...`) rather than strict `### Added / Changed / Fixed` structure. The `## [2.0.11]` block uses the strict Keep-a-Changelog headers (`### Added`, `### Changed`). Both patterns coexist. The v2.0 entry should mirror the rich narrative style of the `[Unreleased]` subentries (free-form heading with date in parentheses), placed as a new top-level `## [2.0.0]` section between `[Unreleased]` and `[2.0.11]`.

**Bold-item bullet pattern** (lines 19–31, 49–52):
```markdown
**New tools (9):**

| Tool | Category | Purpose |
|:-----|:---------|:--------|
| `list_record_templates` | read | List record templates for a table |
...

**Counts:** 52 → **61 tools**. `read-only` profile: 8 → 9. `safe-write` profile: 39 → 47. `full` profile: 52 → 61.
```

**Feature-group pattern** (lines 136–163 — the 2.4.0 entry):
```markdown
#### New features (user report §1.3, §1.4, §3.1)

**View sections (sidebar grouping) — new `view-section` category, defaults on in `safe-write`:**
- `list_view_sections` — read all sections in a table with their view membership and the table-level mixed `viewOrder`
- `create_view_section` — generate a `vsc...` ID and create a section
```

**Insert position:** New `## [2.0.0]` section goes between the last `[Unreleased]` subentry and `## [2.0.11]` (currently line 217). The existing `[Unreleased]` block is preserved above it.

**What to write for v2.0.0:**
```markdown
## [2.0.0] — Daemon & LSP

### Daemon transport

`airtable-user-mcp` now runs as a shared background daemon instead of per-client stdio processes.
One Chromium session is shared across all MCP clients and editor LSP connections.

- **HTTP MCP server** — `StreamableHTTPServerTransport` on a dynamic port; bearer token auth; SSE events
- **stdio-proxy mode** — default `npx airtable-user-mcp` transparently bridges stdin/stdout to the daemon when a lock exists
- **opt-out** — `AIRTABLE_NO_DAEMON=1` (or `--no-daemon`) forces in-process stdio (backwards-compatible)
- **New CLI subcommands** — `daemon start`, `daemon stop`, `daemon status`
- **Lockfile** — `~/.airtable-user-mcp/daemon.lock` carries `pid`, `port`, `port_lsp`, `bearerToken`, `tunnelUrl`

### LSP server

New `airtable-user-lsp` npm package — Airtable language server for formula, script, and automation files.

- Works with any LSP-capable editor (Neovim, Zed, OpenCode, Helix, and more)
- `npx airtable-user-lsp --stdio` for standalone use; `--tcp` for shared daemon instance
- Daemon auto-spawns `airtable-user-lsp --tcp` and writes `port_lsp` to the lockfile

### Tunnel support

Cloudflare and ngrok tunnel integration lets remote AI clients reach the local MCP daemon.

- Two providers: `cloudflared` (Quick Tunnel or Named Tunnel) and `ngrok`
- Tunnel URL exposed in daemon lockfile and Setup tab
- 401-burst auto-disable guard

### Setup tab

New Setup tab in the VS Code dashboard with one-click copy snippets for:
- MCP configuration (5 IDEs × HTTP and stdio transport modes)
- LSP configuration (4 IDEs × TCP and stdio modes)
- Daemon status block with health indicators

mcp-server: 2.4.5. Extension: 2.0.48.
```

---

### `packages/mcp-server/README.md` — Transport modes + CLI + env vars

**Analog:** Same file

**Existing CLI block pattern** (lines 336–346):
```markdown
## All CLI commands

```
npx airtable-user-mcp                  Start MCP server (stdio)   ← what your Claude client runs
npx airtable-user-mcp login            Log in to Airtable via browser
npx airtable-user-mcp logout           Clear saved session
npx airtable-user-mcp status           Show session & browser info
npx airtable-user-mcp doctor           Run diagnostics
npx airtable-user-mcp install-browser  Download Chromium (~170 MB)
npx airtable-user-mcp --version        Print version
npx airtable-user-mcp --help           Show this help
```
```

**Pattern:** Monospace block, right-aligned comment descriptions, one command per line.

**Existing env vars table pattern** (lines 286–294):
```markdown
| Variable | Purpose |
|:--|:--|
| `AIRTABLE_USER_MCP_HOME` | Override config dir (default: `~/.airtable-user-mcp`) |
| `AIRTABLE_NO_BROWSER` | Skip Patchright entirely — uses cached cookies only (CI/headless) |
| `AIRTABLE_HEADLESS_ONLY` | Run the browser without a visible window |
| `AIRTABLE_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
```

**Pattern:** Two-column table, `|:--|:--|` left-align both columns, backtick variable names, inline default values.

**Existing Protocol section pattern** (lines 519–525):
```markdown
## Protocol

| | |
|:--|:--|
| **Transport** | stdio (JSON-RPC 2.0) |
| **MCP Version** | 2025-11-25 |
| **SDK** | `@modelcontextprotocol/sdk` v1.27.1 |
```

**What to add / change:**

1. **Header line 7:** Change `62 tools your AI assistant can't get from the public REST API` — no change needed (count is already 62).

2. **`## All CLI commands` block** (line 336) — append three daemon subcommands after the existing list:
```
npx airtable-user-mcp daemon start     Start the shared background daemon
npx airtable-user-mcp daemon stop      Stop the running daemon
npx airtable-user-mcp daemon status    Show daemon status and port (JSON)
```

3. **`## Useful environment variables` table** (line 286) — append one row:
```markdown
| `AIRTABLE_NO_DAEMON` | Skip daemon; run in-process stdio directly (backwards-compatible mode) |
```

4. **`## Protocol` section** (line 519) — replace the section with a Transport Modes section:
```markdown
## Transport Modes

`airtable-user-mcp` supports three transport modes. The default behaviour is automatic — MCP clients
do not need to change their configuration when the daemon is present.

| Mode | How to use | When to use |
|:-----|:-----------|:------------|
| **stdio standalone** | `AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp` | Backwards-compatible; one process per client; no daemon |
| **stdio-proxy** | `npx airtable-user-mcp` (default when daemon lock exists) | Transparent; stdin/stdout bridged to the running daemon |
| **HTTP (daemon direct)** | `http://127.0.0.1:{port}/mcp` with `Authorization: Bearer {token}` | VS Code extension and other HTTP-capable clients |

The daemon stores its port and bearer token in `~/.airtable-user-mcp/daemon.lock`.

## Protocol

| | |
|:--|:--|
| **Transport** | stdio + HTTP (StreamableHTTPServerTransport) |
| **MCP Version** | 2025-11-25 |
| **SDK** | `@modelcontextprotocol/sdk` v1.27.1 |
```

5. **`## Tools (61)` heading** (line 350) — change to `## Tools (62)`.

6. **Quick Start section** (lines 103–110) — update the description to acknowledge daemon mode:
```markdown
## Quick Start

```bash
npx airtable-user-mcp
```

That's it. Your MCP client connects via **stdio** and gets access to all 62 tools.

When the daemon is running (started automatically by the VS Code extension, or via `npx airtable-user-mcp daemon start`),
subsequent `npx airtable-user-mcp` invocations transparently proxy their stdio to the shared daemon —
so all clients share one Chromium session. To skip the daemon and run in-process: `AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp`.
```

---

### `README.md` — Add LSP badge + LSP section + monorepo table row

**Analog:** Same file

**Badge row pattern** (lines 10–14):
```html
<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula"><img src="https://vsmarketplacebadges.dev/version-short/Nskha.airtable-formula.svg?style=for-the-badge&label=VS%20Code&colorB=007ACC" alt="VS Code version" /></a>
  <a href="https://open-vsx.org/extension/Nskha/airtable-formula"><img src="https://img.shields.io/open-vsx/v/Nskha/airtable-formula?style=for-the-badge&logo=eclipseide&logoColor=white&label=Open%20VSX&color=C160EF" alt="Open VSX version" /></a>
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/v/airtable-user-mcp?style=for-the-badge&logo=npm&logoColor=white&label=npm&color=CB3837" alt="npm version" /></a>
  <a href="https://registry.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Registry-Listed-1D4ED8?style=for-the-badge" alt="MCP Registry listing" /></a>
</p>
```

**Pattern:** `<a href="..."><img src="https://img.shields.io/npm/v/PACKAGE?style=for-the-badge&logo=npm&logoColor=white&label=LABEL&color=HEX" alt="ALT TEXT" /></a>` — all on one line, `style=for-the-badge` required, color as hex without `#`.

**New badge to add** (append to the first `<p align="center">` block, after the MCP Registry badge):
```html
  <a href="https://www.npmjs.com/package/airtable-user-lsp"><img src="https://img.shields.io/npm/v/airtable-user-lsp?style=for-the-badge&logo=npm&logoColor=white&label=LSP&color=CB3837" alt="npm airtable-user-lsp version" /></a>
```

**Features section pattern** (lines 140–165) — each sub-feature as a bold item with em dash description:
```markdown
### VS Code Extension

- **Formula Editor** — Syntax highlighting, IntelliSense, beautify / minify for `.formula` files
- **MCP Server** — One-click MCP registration for multiple IDEs
```

**New LSP section to add** after `### MCP Server (62 Tools)` subsection and before `## Supported IDEs`:
```markdown
### LSP Server

**`airtable-user-lsp`** is a standalone language server for Airtable formula, script, and automation files — works in any LSP-capable editor, not just VS Code.

```bash
# stdio mode — works standalone, no daemon needed
npx airtable-user-lsp --stdio
```

Features: diagnostics, completions, hover documentation, and signature help for `.formula`, `.ats`, and `.ata` files.

When the daemon is running, it auto-spawns `airtable-user-lsp --tcp` so multiple editors share one language server instance. The TCP port is written to `~/.airtable-user-mcp/daemon.lock` as `port_lsp`.

See [`packages/lsp-server/README.md`](packages/lsp-server/README.md) for per-editor configuration (Neovim, Zed, OpenCode, Helix).
```

**Monorepo table pattern** (lines 218–225):
```markdown
| Package | Description |
|:--------|:------------|
| `packages/extension` | VS Code extension host (TypeScript + tsup) |
| `packages/webview` | React dashboard webview (Vite + Tailwind v4) |
| `packages/shared` | Shared types and message protocol |
| `packages/mcp-server` | [`airtable-user-mcp`](https://www.npmjs.com/package/airtable-user-mcp) — ESM Node MCP server |
| `scripts/` | Build tooling (esbuild bundler, dep vendoring) |
```

**Pattern:** Left-align both columns (`|:--------|:------------|`), backtick package paths, inline npm link for published packages.

**New row to add** (after `packages/mcp-server` row):
```markdown
| `packages/lsp-server` | [`airtable-user-lsp`](https://www.npmjs.com/package/airtable-user-lsp) — LSP server for formula / script / automation files |
```

**"What's In This Repo" block** (lines 113–124) — update "two products" to "three products":
```markdown
This monorepo ships **three products** from one source tree:

| | Product | Install |
|:-:|:--------|:--------|
| <img ...> | **Airtable Formula** — VS Code extension | [Marketplace](...) |
| <img ...> | **airtable-user-mcp** — Standalone MCP server | `npx airtable-user-mcp` |
| | **airtable-user-lsp** — Airtable language server | `npx airtable-user-lsp` |
```

---

### `CLAUDE.md` — Daemon architecture section + lsp-server package + four→five

**Analog:** Same file

**Package section pattern** (lines 43–65, `### packages/shared` and `### packages/mcp-server`):
```markdown
### packages/mcp-server
The Airtable MCP server itself — ES modules Node app, **published to npm as `airtable-user-mcp`**. Provides **62 tools** ...

Key files:
- `src/index.js` — MCP server entry point, tool registration
- `src/auth.js` — `AirtableAuth` class, browser launch, CSRF/secretSocketId capture
```

**Pattern:**
- Opening sentence: one-liner naming the package, npm publish name in bold backtick, what it provides.
- Body: key architectural facts, bold-inline subterms.
- `Key files:` bullet list with `path` — description, with **bold** for the authoritative/critical ones.

**Subsection pattern** (lines 67–73, `### View config reads — two-call pattern`):
```markdown
### View config reads — two-call pattern

`AirtableClient.getView()` makes **two** API calls:
1. `application/{appId}/read` (cached) — resolves `tableId` from `viewId` ...
2. `table/{tableId}/readData?...` (un-cached) — returns live state: ...
```

**Pattern:** H3 subheading with em dash qualifier, prose opening, numbered list for sequential steps.

**What to change in CLAUDE.md:**

1. **Line 41** — `**pnpm monorepo** with four packages:` → `**pnpm monorepo** with five packages:`

2. **After `### packages/mcp-server` section, before `### View config reads`** — insert new daemon subsection:

```markdown
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
```

3. **`Key files:` list in `### packages/mcp-server`** — add two entries:
```markdown
- `src/daemon/` — daemon subsystem (see daemon subsection above)
- `src/safe-write.js` — atomic JSON write helper (used by lockfile, token, and settings)
```

4. **`### packages/mcp-server` — update CLI subcommands line** (line 52):
Change: `The CLI exposes subcommands: \`login\`, \`logout\`, \`status\`, \`doctor\`, \`install-browser\`.`
To: `The CLI exposes subcommands: \`login\`, \`logout\`, \`status\`, \`doctor\`, \`install-browser\`, \`daemon start/stop/status\`.`

5. **After `### packages/mcp-server` block (and its daemon subsection), before `### View config reads`** — add new package:

```markdown
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
```

6. **`## Build Pipeline` section** — append note after step 6:
```markdown
**DaemonManager integration:** The extension's `src/mcp/daemon-manager.ts` reads `~/.airtable-user-mcp/daemon.lock` at startup and on file-watch events to check daemon health and expose `port` and `bearerToken` to `src/mcp/registration.ts` for direct HTTP transport.
```

---

## Shared Patterns

### Heading hierarchy
**Source:** All four files
**Apply to:** All four target files

- `##` = top-level section (e.g., `## [2.0.0]`, `## Quick Start`, `## Architecture`)
- `###` = named subsection (e.g., `### packages/lsp-server`, `### New Features`)
- `####` = inline sub-subsection (e.g., `#### New features (user report §1.3)`)
- Never use `#####` or deeper in this codebase's docs

### Bold-em-dash item format
**Source:** CHANGELOG.md lines 19–47, README.md lines 142–147
**Apply to:** CHANGELOG v2.0 feature bullets, CLAUDE.md daemon subsection bullets

Pattern: `- **Term** — prose description starting lowercase` (single space around em dash `—`)

### Code block language tagging
**Source:** mcp-server/README.md throughout, CLAUDE.md
**Apply to:** All code snippets

- Shell commands: ` ```bash `
- JSON: ` ```json `
- JavaScript: ` ```js `
- Plain monospace (mixed/pseudo-code): ` ``` ` (no language tag)

### Table alignment convention
**Source:** README.md lines 52–88, mcp-server/README.md lines 58–86
**Apply to:** Any new tables

- Feature comparison tables: `|---|---|---|` (no alignment specifier)
- Command/variable reference tables: `|:--|:--|` (left-align both)
- Tool listing tables: `|:-----|:------------|` (left-align both)

### Perplexity MCP block in CLAUDE.md
**Source:** CLAUDE.md lines 190–223
**Apply to:** CLAUDE.md edits only

Lines 190–223 are wrapped in `<!-- PERPLEXITY-MCP-START -->` / `<!-- PERPLEXITY-MCP-END -->`. Do not remove, move, or modify this block. All new CLAUDE.md content goes above line 190.

---

## No Analog Found

None — all four target files exist and provide direct structural analogs for the content being added.

---

## Metadata

**Analog search scope:** Root docs + packages/mcp-server/README.md + packages/lsp-server/README.md + CLAUDE.md
**Files scanned:** 4 source files read in full
**Pattern extraction date:** 2026-05-15
