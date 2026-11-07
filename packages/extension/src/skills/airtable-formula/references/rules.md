# Airtable Formula Rules

When working with Airtable formulas:

1. **Use the Airtable Formula skill** for all formula-related tasks
2. **No comments allowed** - Airtable doesn't support // or /* */
3. **Field references use braces** - `{Field Name}` not cell references
4. **Smart quotes break formulas** - Always use straight quotes `"`
5. **Division needs guards** - Check for zero: `IF({D}=0, BLANK(), {N}/{D})`

## Quick Reference

- **Safe division**: `IF({Divisor}=0, BLANK(), {Value}/{Divisor})`
- **Error handling**: `IF(ISERROR(expr), fallback, expr)`
- **Date formatting**: `DATETIME_FORMAT({Date}, "YYYY-MM-DD")`
- **Join arrays**: `ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")`

## Not Available in Airtable

- VLOOKUP, HLOOKUP (use linked records)
- SUMIF, COUNTIF (use rollups)
- IFERROR (use IF(ISERROR(...)))
- Cell references (A1, B2)

## Airtable MCP — Tool Usage Rules

### Two MCPs, Complementary Roles

| Need | Use |
|------|-----|
| **Read records / search by text** (incl. lookup fields) | **airtable-user-mcp** `query_records` |
| **Duplicate records** | **airtable-user-mcp** `duplicate_records` |
| Create / update / delete **records** (full CRUD) | **Official MCP** (`mcp.airtable.com`) |
| List bases you have access to | **Official MCP** |
| **Schema work** — tables, fields, formulas, views | **airtable-user-mcp** |
| **Formula validation** before applying | **airtable-user-mcp** (`lint_airtable_code`, then `validate_formula`) |
| **View config** — filters, sorts, groups, column order | **airtable-user-mcp** |
| **View sections**, form metadata, extensions | **airtable-user-mcp** |
| **Record templates** | **airtable-user-mcp** |

Use them together: set up schema with airtable-user-mcp, populate records with the Official MCP,
and use airtable-user-mcp `query_records` to read/search data (especially when lookup fields are involved).

### airtable-user-mcp — Server Identity

- **Name**: airtable-user-mcp  |  **Version**: 2.4.x
- **Protocol**: Model Context Protocol (JSON-RPC 2.0)
- **Tools**: 73 tools across 17 categories + `manage_tools`
- **Auth**: browser session (or PAT via Official MCP panel in the VS Code extension)

### Mandatory Workflows

#### Before Creating a Formula Field
1. `list_fields` — verify all referenced field names exist and check types
2. `lint_airtable_code` — offline syntax check, no base needed
3. `validate_formula` — confirm syntax and result type
4. `create_formula_field` — only if validation passes

#### Before Updating a Formula Field
1. `list_fields` — get the `fieldId`
2. `lint_airtable_code` — offline syntax check, no base needed
3. `validate_formula` — validate new formula text
4. `update_formula_field` — apply only if valid

#### Before Deleting Any Field / View / Table
1. Read tool first — confirm it exists and get exact name/ID
2. Show the user what will be deleted and ask for confirmation
3. Call the delete tool with required safety params (`expectedName` for fields)
4. For `delete_field`: review any returned dependencies before setting `force: true`

#### Before Installing an Extension
1. `create_extension` → get `blockId`
2. `create_extension_dashboard` → get `pageId`
3. `install_extension` → install onto page

#### Searching / Reading Records
1. Prefer `query_records` over Official MCP `list_records_for_table` when fields include lookups or rollups
2. Pass `search` for text matching — works on ALL field types including lookup-resolved strings
3. Increase `limit` (up to 1000) if you need to search across a larger record set
4. For very large tables, note that `search` only scans within the `limit` window — use a filtered view to pre-narrow the scope

### Safety Rules

- **NEVER** call any delete tool (`delete_field`, `delete_view`, `delete_table`, `delete_record_template`, `delete_view_section`, `remove_extension`, `delete_records`) without explicit user confirmation
- **NEVER** call `sync_base` with `mode=apply` — especially with `policy=mirror` plus the confirmation flags — without explicit user confirmation; it mutates (and can delete from) the destination base
- **NEVER** set `force: true` on `delete_field` before showing the user the returned dependencies
- **NEVER** call `manage_daemon` with `action=stop`/`restart`/`token_rotate` without explicit user confirmation — you are turning off or re-keying the server carrying this conversation. `action=status` is read-only and always safe
- **ALWAYS** validate formulas before creating or updating formula fields
- **ALWAYS** use read tools to discover IDs — never guess or fabricate Airtable IDs
- **PREFER** lightweight reads: `list_tables` over `get_base_schema` when only table names are needed
- **PREFER** shorthands: `create_formula_field` over `create_field` with formula type

### Tool Selection Guide

| User Intent | Tool(s) to Use |
|-------------|----------------|
| "Show me the tables" | `list_tables` |
| "What fields does X have?" | `list_fields` or `get_table_schema` |
| "What are the current filters on view Y?" | `get_view` |
| "Create a formula that…" | `list_fields` → `lint_airtable_code` → `validate_formula` → `create_formula_field` |
| "Update the formula in…" | `list_fields` → `lint_airtable_code` → `validate_formula` → `update_formula_field` |
| "Delete the field…" | `list_fields` → confirm → `delete_field` |
| "Add a text/number field" | `create_field` with appropriate `fieldType` |
| "Create a view filtered by…" | `list_fields` → `create_view` → `update_view_filters` |
| "Sort/group this view by…" | `apply_view_sorts` or `update_view_group_levels` |
| "Hide these columns" | `show_or_hide_view_columns` |
| "Set column order to X, Y, Z" | `set_view_columns` (full reset) or sequential `move_visible_columns` calls |
| "Organise views into sections" | `create_view_section` → `move_view_to_section` |
| "Install an extension" | `create_extension` → `create_extension_dashboard` → `install_extension` |
| "Read / search records" | `query_records` (especially when lookup fields are involved) |
| "Find a record by name when name is a lookup" | `query_records` with `search` — REST API `filterByFormula` doesn't work here |
| "Duplicate records" | `duplicate_records` |
| "Create brand-new records" | **Official MCP** |
| "What profiles/tools are active?" | `manage_tools` with action `get_tool_status` |

### Common Mistakes to Avoid

1. **Creating a formula without validating** — may silently produce an invalid field in Airtable
2. **Using table name instead of ID for mutation tools** — some tools require `tableId` (`tblXXX` format)
3. **Omitting `expectedName` on `delete_field`** — deletion will be refused
4. **Passing field names instead of field IDs to view tools** — view tools use `fldXXX` IDs, not names
5. **Deleting the last view in a table** — will fail; a table must always have at least one view
6. **Passing multiple IDs to `move_visible_columns` expecting ordered placement** — the API ignores input array order; make one call per column with incrementing `targetVisibleIndex`
7. **Using `emptyGroupState: "visible"` in `update_view_group_levels`** — the API rejects this value; omit the field (defaults to "hidden")
8. **Using REST API `filterByFormula` with `FIND()`/`SEARCH()` on lookup fields** — returns wrong/empty results; use `query_records` with `search` instead
9. **Using Official MCP to read records when lookup field values matter** — Official MCP may return unresolved IDs; `query_records` returns fully resolved strings
10. **Passing `fieldType: "singleSelect"` to `create_field` / `update_field_config` and expecting raw API type matching** — the internal Airtable API uses `"select"` (not `"singleSelect"`); airtable-user-mcp normalises this automatically so always pass `"singleSelect"` — never pass `"select"` directly
11. **Passing a partial choices list to `update_field_config` on a select field** — choices NOT included are deleted; always fetch existing choice IDs first with `get_table_schema` and include them in the list
