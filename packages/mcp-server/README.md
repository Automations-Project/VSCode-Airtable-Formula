<div align="center">

<img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/mcp-server/assets/icon.png" alt="Airtable User MCP" width="140" />

# airtable-user-mcp

**Community add-on to the official Airtable MCP — 36 extra tools your AI assistant can't get from the public REST API**

<p align="center">
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/v/airtable-user-mcp?style=for-the-badge&logo=npm&logoColor=white&label=npm&color=CB3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/dw/airtable-user-mcp?style=for-the-badge&logo=npm&logoColor=white&label=Downloads%2FWeek&color=F43F5E" alt="npm downloads per week" /></a>
  <a href="https://registry.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Registry-Listed-1D4ED8?style=for-the-badge" alt="MCP Registry listing" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-2025--11--25-4A90D9?style=for-the-badge" alt="MCP version 2025-11-25" /></a>
</p>

[![VSCode-Airtable-Formula MCP server](https://glama.ai/mcp/servers/Automations-Project/VSCode-Airtable-Formula/badges/card.svg)](https://glama.ai/mcp/servers/Automations-Project/VSCode-Airtable-Formula)

<p align="center">
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Automations-Project/VSCode-Airtable-Formula/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI" alt="CI status" /></a>
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/releases/latest"><img src="https://img.shields.io/github/v/release/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=github&logoColor=white&label=Latest%20Release&color=10B981" alt="Latest release" /></a>
  <a href="https://github.com/Automations-Project/VSCode-Airtable-Formula/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Automations-Project/VSCode-Airtable-Formula?style=for-the-badge&logo=opensourceinitiative&logoColor=white&label=License&color=22C55E" alt="License" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula"><img src="https://vsmarketplacebadges.dev/version-short/Nskha.airtable-formula.svg?style=for-the-badge&label=VS%20Code%20Extension&colorB=007ACC" alt="VS Code extension version" /></a>
</p>

<br />

> **Not affiliated with Airtable Inc.** This is a community-maintained project.
>
> **Experimental** — This project is under active development and not intended for production use. APIs, tools, and behavior may change without notice.

</div>



---

## TL;DR

```bash
npx -y airtable-user-mcp login          # one browser login
claude mcp add airtable --scope user -- npx -y airtable-user-mcp
```

Done. Your AI assistant can now do things like:

> *"Create a rollup field on Projects called **Total Spend** that sums `{Amount}` from the linked Invoices table, and add a filter to the `Active` view that hides rows where Total Spend = 0."*

The official Airtable MCP can't — its REST API doesn't expose those surfaces. Run both MCPs side-by-side and your AI client sees every tool from each.

---

## Why this is an add-on, not a replacement

The official Airtable MCP is a thin wrapper over the public Web API. That API — by design — never exposed some of the most-requested automation surfaces in Airtable. `airtable-user-mcp` uses Airtable's **internal API** (the same one the web UI calls) to close the gap. The two servers cover different surfaces, so the intended setup is **both installed at once** — your MCP client sees the union of their tool sets.

### Coverage map

| Capability | Official Airtable MCP | **airtable-user-mcp** |
|---|---|---|
| Total tools | ~17 | **36** |
| Auth | PAT or OAuth, per-scope | **Log in once with your normal account** (SSO/2FA supported) |
| Transport | HTTP (remote) | stdio (local, private) |
| Data routing | Through `mcp.airtable.com` | **Direct from your machine** |
| Schema read | Partial | **Full** incl. view state |
| Create formula fields | ❌ | ✅ |
| Create rollup / lookup / count fields | ❌ `UNSUPPORTED_FIELD_TYPE_FOR_CREATE` | ✅ |
| Update a formula's text | ❌ | ✅ |
| Validate a formula before apply | ❌ | ✅ |
| Rename / duplicate fields | Limited | ✅ |
| Safe delete with dependency preview | ❌ | ✅ `expectedName` + `viewFilters/Sorts/Groupings` summary |
| Create views (7 types) | ❌ API has no endpoint | ✅ grid / form / kanban / calendar / gallery / gantt / list |
| Set/append view filters (nested AND/OR) | ❌ | ✅ |
| Set sorts / grouping / row height | ❌ | ✅ |
| Change column order | ❌ | ✅ |
| Show / hide columns | ❌ | ✅ |
| Duplicate a view with full config | ❌ | ✅ |
| Extension & dashboard page management | ❌ | ✅ install, enable, rename, duplicate, remove |
| `filterByFormula` on record queries | ❌ Explicitly disallowed | ✅ |
| Install effort | Manual PAT + JSON edit per client | Single `claude mcp add` or JSON snippet |
| Price | Free | Free, MIT |

*Backed by [Airtable's MCP docs](https://support.airtable.com/docs/using-the-airtable-mcp-server), the [Web API reference](https://www.airtable.com/developers/web/api/introduction), and the [rollup-field `UNSUPPORTED_FIELD_TYPE_FOR_CREATE` thread](https://community.airtable.com/development-apis-11/how-to-set-up-a-rollup-field-using-the-api-4879).*



---

## Quick Start

```bash
npx airtable-user-mcp
```

That's it. Your MCP client connects via **stdio** and gets access to all 36 tools.

---

## Run alongside the official Airtable MCP

`airtable-user-mcp` is designed to **add** capabilities, not replace anything. The official Airtable MCP handles records over HTTP with PAT/OAuth; this one handles schema, formulas, views, and extensions locally via Airtable's internal API. Register **both** in your MCP client so your AI assistant sees the union of their tool sets.

Add this entry to your `mcpServers` block:

```json
{
  "mcpServers": {
    "airtable-user-mcp": {
      "command": "npx",
      "args": ["-y", "airtable-user-mcp"]
    }
  }
}
```

Then register the official server following [Airtable's setup guide](https://support.airtable.com/docs/using-the-airtable-mcp-server). The two servers are independent and share nothing — they just coexist under different names in your MCP client.

---

## Supported Clients

Works with any MCP-compatible client. Tested with:

<div align="center">

| <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/claude.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/claude-code.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/cursor.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/windsurf.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/cline.svg" width="28" /> | <img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/webview/src/assets/icons/amp.svg" width="28" /> |
|:---:|:---:|:---:|:---:|:---:|:---:|
| Claude Desktop | Claude Code | Cursor | Windsurf | Cline | Amp |

</div>

### Advanced GUI

For a visual management experience, install the **[Airtable Formula](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula)** VS Code extension. It bundles this MCP server and adds:

- **One-click MCP registration** for Cursor, Windsurf, Claude Code, Cline, and Amp
- **Dashboard** with session status, version info, and setup wizard
- **Airtable login** with credentials in OS keychain and auto-refresh
- **Formula editor** with syntax highlighting, IntelliSense, and beautify/minify

---

## Claude Quick Start (no VS Code extension)

Five commands take you from zero → a working Airtable MCP in Claude Desktop or Claude Code. Everything below runs from a normal terminal.

### Prerequisites

- **Node.js 18 or newer** — `node -v` to check. Install from [nodejs.org](https://nodejs.org) if missing.
- An Airtable account (personal, team, or enterprise — anything you can log into at [airtable.com](https://airtable.com)).

### 1. Check what's already on your machine

```bash
npx -y airtable-user-mcp@latest doctor
```

`doctor` prints your Node version, platform, config dir, and whether the browser engine is installed. If `Patchright: not installed` appears, continue to step 2. If it says `installed`, skip to step 3.

### 2. Install the browser engine (one-time, ~170 MB)

```bash
npx -y airtable-user-mcp install-browser
```

This downloads [Patchright](https://github.com/Kaliiiiiiiiii/patchright-nodejs) (a stealth Chromium fork used only for the login flow). You only need to run this once per machine. If you already have Chrome, Edge, or Chromium installed and prefer not to download another browser, see [Browser Choice](#browser-choice) below.

### 3. Log in to Airtable

```bash
npx -y airtable-user-mcp login
```

A browser window opens on [airtable.com/login](https://airtable.com/login). Sign in like you normally would — password, SSO, 2FA, whatever your account uses. The window closes automatically when login is detected. Your session is stored in `~/.airtable-user-mcp/.chrome-profile/` and reused by every tool call.

Verify the session landed:

```bash
npx -y airtable-user-mcp status
```

You should see `Session: found`.

### 4. Configure your Claude client

<details open>
<summary><strong>Claude Desktop</strong></summary>

Open `claude_desktop_config.json`:

| OS | Path |
|:--|:--|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Tip: in Claude Desktop, **Settings → Developer → Edit Config** opens this file.

Add the `airtable` entry to `mcpServers`:

```json
{
  "mcpServers": {
    "airtable": {
      "command": "npx",
      "args": ["-y", "airtable-user-mcp"]
    }
  }
}
```

Save, then **fully quit and reopen Claude Desktop** (closing the window is not enough). A hammer/plug icon in the chat input confirms the server is connected — click it to see the 36 tools.

</details>

<details open>
<summary><strong>Claude Code</strong></summary>

Use the built-in `claude mcp add` command:

```bash
# Add for all projects on this machine:
claude mcp add airtable --scope user -- npx -y airtable-user-mcp

# OR — add to the current project only (creates .mcp.json, safe to commit):
claude mcp add airtable --scope project -- npx -y airtable-user-mcp
```

Verify:

```bash
claude mcp list
```

You should see `airtable: npx -y airtable-user-mcp - ✓ Connected`. Start a Claude Code session in that directory and the 36 tools are available.

</details>

### 5. Try it out

Ask your Claude client:

> *"List all tables in my Airtable base `appXXXXXXXXXXXXXX`."*

It will call `list_tables` and return the names and IDs.

---

### Troubleshooting

| Symptom | Fix |
|:--|:--|
| `Session: not found` | Re-run `npx -y airtable-user-mcp login` |
| Login window never loads | Check network / firewall, then `doctor` |
| Browser download fails on Windows | Run PowerShell as Admin once, then retry `install-browser` |
| Tools don't appear after config change | Fully quit and reopen Claude Desktop (not just the window) |
| `command not found: npx` | Install Node.js from [nodejs.org](https://nodejs.org) |

Run `npx -y airtable-user-mcp doctor` at any time for a full diagnostic.

### Browser Choice

If you already have Chrome, Edge, or a system Chromium and want to skip the 170 MB download:

```bash
# point the server at an existing Chromium-family browser
export AIRTABLE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
# or on Windows (PowerShell):
$env:AIRTABLE_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### Useful environment variables

| Variable | Purpose |
|:--|:--|
| `AIRTABLE_USER_MCP_HOME` | Override config dir (default: `~/.airtable-user-mcp`) |
| `AIRTABLE_NO_BROWSER` | Skip Patchright entirely — uses cached cookies only (CI/headless) |
| `AIRTABLE_HEADLESS_ONLY` | Run the browser without a visible window |
| `AIRTABLE_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

---

## Installation

### Via npx (recommended)

Already covered above — the `claude mcp add` command or the `mcpServers` JSON entry both use `npx -y airtable-user-mcp` under the hood.

### Via VS Code / Windsurf / Cursor

Install the [Airtable Formula](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula) extension — it bundles this server and registers it automatically across all your IDEs. Login and status live in a visual dashboard.

### Global install

```bash
npm install -g airtable-user-mcp
airtable-user-mcp login
```

Then reference the binary directly in any MCP config:

```json
{ "mcpServers": { "airtable": { "command": "airtable-user-mcp" } } }
```

### From source

```json
{
  "mcpServers": {
    "airtable": {
      "command": "node",
      "args": ["/path/to/airtable-user-mcp/src/index.js"]
    }
  }
}
```

---

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

---

## Tools (36)

### Schema Read (7)

| Tool | Description |
|:-----|:------------|
| `get_base_schema` | Full schema of all tables, fields, and views in a base |
| `list_tables` | List all tables in a base with IDs and names |
| `get_table_schema` | Full schema for a single table |
| `list_fields` | All fields in a table with types and configuration |
| `list_views` | All views in a table with IDs, names, and types |
| `get_view` | Read a single view's full state — filters, sorts, grouping, visibility, description |
| `validate_formula` | Validate a formula expression before applying |

### Table Management (3)

| Tool | Description |
|:-----|:------------|
| `create_table` | Create a new table with default fields |
| `rename_table` | Rename a table |
| `delete_table` | Delete a table (requires `expectedName` safety guard) |

### Field Management (8)

| Tool | Description |
|:-----|:------------|
| `create_field` | Create a field — auto-maps `url` / `email` / `phone` / `dateTime` aliases, plus formula, rollup, lookup, count |
| `create_formula_field` | Create a formula field (shorthand) |
| `update_formula_field` | Update the formula text of an existing field |
| `update_field_config` | Update configuration of any computed field |
| `rename_field` | Rename a field with pre-validation |
| `delete_field` | Delete with safety guards and a compact dependency summary |
| `duplicate_field` | Clone a field, optionally copying cell values |
| `update_field_description` | Set or update a field's description text |

### View Configuration (11)

| Tool | Description |
|:-----|:------------|
| `create_view` | Create grid, form, kanban, calendar, gallery, gantt, or list view |
| `duplicate_view` | Clone a view with all configuration |
| `rename_view` | Rename a view |
| `delete_view` | Delete a view (cannot delete last view) |
| `update_view_description` | Set or clear a view's description |
| `update_view_filters` | Set or append filter conditions (AND/OR, nested groups, `is`/`isNot` auto-normalized) |
| `reorder_view_fields` | Change column order |
| `show_or_hide_view_columns` | Toggle column visibility |
| `apply_view_sorts` | Set or clear sort conditions |
| `update_view_group_levels` | Set or clear grouping |
| `update_view_row_height` | Change row height (small / medium / large / xlarge) |

### Extension Management (7)

| Tool | Description |
|:-----|:------------|
| `create_extension` | Register a new extension/block in a base |
| `create_extension_dashboard` | Create a new dashboard page |
| `install_extension` | Install an extension onto a dashboard page |
| `update_extension_state` | Enable or disable an installed extension |
| `rename_extension` | Rename an installed extension |
| `duplicate_extension` | Clone an installed extension |
| `remove_extension` | Remove an extension from a dashboard |

---

## Usage Examples

### Inspect a base schema

```
Tool: list_tables
Args: { "appId": "appXXXXXXXXXXXXXX" }
```

### Create and validate a formula

```
Tool: validate_formula
Args: { "appId": "appXXX", "tableId": "tblXXX", "formulaText": "IF({Price}>0,{Price}*{Qty},0)" }

Tool: create_formula_field
Args: { "appId": "appXXX", "tableId": "tblXXX", "name": "Total", "formulaText": "IF({Price}>0,{Price}*{Qty},0)" }
```

### Configure view filters

```
Tool: update_view_filters
Args: {
  "appId": "appXXX",
  "viewId": "viwXXX",
  "filters": {
    "filterSet": [
      { "columnId": "fldXXX", "operator": "isNotEmpty" }
    ],
    "conjunction": "and"
  }
}
```

---

## Safety

- **Destructive operations** (`delete_table`, `delete_field`, `delete_view`, `remove_extension`) include built-in safety guards
- `delete_table` and `delete_field` both require an `expectedName` parameter that must match the current name exactly — prevents accidentally deleting the wrong object after a rename
- `delete_field` checks for downstream dependencies and returns a compact summary (`viewGroupings`, `viewSorts`, `viewFilters`, `fields`) before committing; set `force: true` to delete anyway
- Formula validation is available and recommended before creating/updating formulas
- All tools accept `debug: true` for raw response inspection

---

## ID Format Reference

| Entity | Prefix | Example |
|:-------|:-------|:--------|
| Base / App | `app` | `appXXXXXXXXXXXXXX` |
| Table | `tbl` | `tblXXXXXXXXXXXXXX` |
| Field | `fld` | `fldXXXXXXXXXXXXXX` |
| View | `viw` | `viwXXXXXXXXXXXXXX` |
| Block | `blk` | `blkXXXXXXXXXXXXXX` |
| Block Installation | `bli` | `bliXXXXXXXXXXXXXX` |
| Dashboard Page | `bip` | `bipXXXXXXXXXXXXXX` |

---

## Protocol

| | |
|:--|:--|
| **Transport** | stdio (JSON-RPC 2.0) |
| **MCP Version** | 2025-11-25 |
| **SDK** | `@modelcontextprotocol/sdk` v1.27.1 |

---

## Find Us

| Registry | Link |
|:---------|:-----|
| **npm** | [`airtable-user-mcp`](https://www.npmjs.com/package/airtable-user-mcp) |
| **VS Code Marketplace** | [`Nskha.airtable-formula`](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula) |
| **GitHub** | [`Automations-Project/VSCode-Airtable-Formula`](https://github.com/Automations-Project/VSCode-Airtable-Formula) |
| **MCP Registry** | [`io.github.automations-project/airtable-user-mcp`](https://registry.modelcontextprotocol.io) |
| **Glama** | [glama.ai/mcp/servers](https://glama.ai/mcp/servers/Automations-Project/VSCode-Airtable-Formula) |
| **PulseMCP** | [pulsemcp.com](https://www.pulsemcp.com/servers/automations-project-airtable-user) |
| **MCP.so** | [mcp.so](https://mcp.so/client/airtable-user-mcp/Automations-Project) |

---

## Related

- [**Official Airtable MCP**](https://support.airtable.com/docs/using-the-airtable-mcp-server) — Airtable's first-party remote server for records over HTTP; this add-on runs alongside it
- [**Airtable Formula** VS Code Extension](https://github.com/Automations-Project/VSCode-Airtable-Formula) — Dashboard, formula editor, MCP installer, and AI skills
- [Model Context Protocol](https://modelcontextprotocol.io) — The open standard for AI tool integration

## Support This Project

This project is built and maintained with the help of AI coding tools. If you find it useful and want to support continued development (new tools, updates, bug fixes), you can contribute by gifting **Claude Code credits** — the primary tool used to build this project.

Interested? [Open an issue](https://github.com/Automations-Project/VSCode-Airtable-Formula/issues/new) or reach out to discuss feature requests and sponsorship.

## License

[MIT](https://github.com/Automations-Project/VSCode-Airtable-Formula/blob/main/LICENSE)
