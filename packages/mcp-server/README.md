# Airtable User MCP

<p align="center">
  <img src="https://raw.githubusercontent.com/Automations-Project/airtable-user-mcp/main/assets/icon.png" alt="Airtable User MCP" width="128" />
</p>

<p align="center">
  <strong>MCP server for managing Airtable bases via the internal API</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/airtable-user-mcp"><img src="https://img.shields.io/npm/v/airtable-user-mcp" alt="npm version" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-2.0-blue" alt="MCP 2.0" /></a>
  <a href="https://github.com/Automations-Project/airtable-user-mcp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

---

## Overview

**airtable-user-mcp** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides **30 tools** for managing Airtable bases. It uses Airtable's internal API to support capabilities **not available through the official REST API**, including:

- Creating and updating **formula, rollup, lookup, and count** fields
- **Validating formulas** before applying them
- Full **view configuration** (filters, sorts, grouping, column visibility, row height)
- **Extension/block** management (create, install, enable/disable, remove)
- Complete **schema inspection** (bases, tables, fields, views)

## Tools (30)

### Schema Read (5 tools)

| Tool | Description |
|------|-------------|
| `get_base_schema` | Get full schema of all tables, fields, and views in a base |
| `list_tables` | List all tables in a base with IDs and names |
| `get_table_schema` | Get full schema for a single table including fields and views |
| `list_fields` | List all fields in a table with types and configuration |
| `list_views` | List all views in a table with IDs, names, and types |

### Field Management (8 tools)

| Tool | Description |
|------|-------------|
| `create_field` | Create a new field including computed types (formula, rollup, lookup, count) |
| `create_formula_field` | Create a formula field (shorthand) |
| `validate_formula` | Validate a formula expression before creating or updating |
| `update_formula_field` | Update the formula text of an existing formula field |
| `update_field_config` | Update configuration of any computed field |
| `rename_field` | Rename a field with pre-validation |
| `delete_field` | Delete a field with safety guards and dependency checks |
| `duplicate_field` | Clone a field, optionally copying cell values |

### View Configuration (11 tools)

| Tool | Description |
|------|-------------|
| `create_view` | Create a new view (grid, form, kanban, calendar, gallery, gantt, list) |
| `duplicate_view` | Clone a view with all configuration |
| `rename_view` | Rename a view |
| `delete_view` | Delete a view (cannot delete last view) |
| `update_view_description` | Set or clear a view's description |
| `update_view_filters` | Set filter conditions with AND/OR conjunctions |
| `reorder_view_fields` | Change column order in a view |
| `show_or_hide_view_columns` | Show or hide specific columns |
| `apply_view_sorts` | Set or clear sort conditions |
| `update_view_group_levels` | Set or clear grouping |
| `update_view_row_height` | Change row height (small, medium, large, xlarge) |

### Field Metadata (1 tool)

| Tool | Description |
|------|-------------|
| `update_field_description` | Set or update a field's description text |

### Extension Management (6 tools)

| Tool | Description |
|------|-------------|
| `create_extension` | Register a new extension/block in a base |
| `create_extension_dashboard` | Create a new dashboard page for extensions |
| `install_extension` | Install an extension onto a dashboard page |
| `update_extension_state` | Enable or disable an installed extension |
| `rename_extension` | Rename an installed extension |
| `duplicate_extension` | Clone an installed extension |
| `remove_extension` | Remove an extension from a dashboard |

## Installation

### VS Code / Windsurf / Cursor

Install the [Airtable Formula](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula) extension — it bundles this MCP server and registers it automatically.

### Manual Configuration

Add to your MCP client configuration (e.g., `mcp.json`, `claude_desktop_config.json`):

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

### Via npx (once published to npm)

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

## Authentication

The server uses browser-based authentication with Airtable. On first use:

1. Run `npm run login` to open a browser and authenticate with Airtable
2. Cookies are cached locally for subsequent sessions
3. Set `AIRTABLE_HEADLESS_ONLY=1` for environments without a browser (uses cached cookies only)

## Usage Examples

### Inspect a base schema

```
Tool: list_tables
Args: { "appId": "appXXXXXXXXXXXXXX" }
```

### Create a formula field

```
Tool: validate_formula
Args: { "appId": "appXXX", "tableId": "tblXXX", "formulaText": "IF({Price}>0,{Price}*{Qty},0)" }

Tool: create_formula_field
Args: { "appId": "appXXX", "tableId": "tblXXX", "name": "Total", "formulaText": "IF({Price}>0,{Price}*{Qty},0)" }
```

### Filter a view

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

## Safety

- **Destructive operations** (`delete_field`, `delete_view`, `remove_extension`) include safety guards
- `delete_field` requires both `fieldId` AND `expectedName` and checks for downstream dependencies before deleting
- Formula validation is available and recommended before creating/updating formulas
- All tools accept `debug: true` for raw response inspection

## ID Format Reference

| Entity | Prefix | Example |
|--------|--------|---------|
| Base/App | `app` | `appXXXXXXXXXXXXXX` |
| Table | `tbl` | `tblXXXXXXXXXXXXXX` |
| Field | `fld` | `fldXXXXXXXXXXXXXX` |
| View | `viw` | `viwXXXXXXXXXXXXXX` |
| Block | `blk` | `blkXXXXXXXXXXXXXX` |
| Block Installation | `bli` | `bliXXXXXXXXXXXXXX` |
| Dashboard Page | `bip` | `bipXXXXXXXXXXXXXX` |

## Protocol

- **Transport**: stdio (JSON-RPC 2.0)
- **MCP Version**: 2025-11-25
- **SDK**: `@modelcontextprotocol/sdk` v1.27.1

## Related

- [Airtable Formula VS Code Extension](https://github.com/Automations-Project/VSCode-Airtable-Formula) — Formula editor, MCP installer, and AI skills
- [Model Context Protocol](https://modelcontextprotocol.io) — The open standard for AI tool integration

## License

MIT
