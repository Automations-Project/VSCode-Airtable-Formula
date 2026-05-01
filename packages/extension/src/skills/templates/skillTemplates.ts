/**
 * Skill templates for Airtable Formula extension
 * These are embedded in the extension and installed to the workspace on activation
 */

export const SKILL_CONTENT = `# Airtable Formula Skill

Expert assistance for writing, debugging, and optimizing Airtable formulas.

## When to Use

- Writing new Airtable formulas
- Debugging formula errors (#ERROR, NaN, Infinity)
- Optimizing complex nested formulas
- Converting Excel formulas to Airtable syntax
- Working with \`.formula\` files

## Key Differences from Excel

| Excel | Airtable |
|-------|----------|
| \`VLOOKUP\` | Use linked records |
| \`SUMIF/COUNTIF\` | Use rollup fields |
| \`IFERROR\` | \`IF(ISERROR(...), ...)\` |
| \`NOW()\` / \`TODAY()\` | Same, but callable constants |
| Cell references \`A1\` | Field references \`{Field Name}\` |

## Common Patterns

### Safe Division
\`\`\`
IF({Divisor} = 0, BLANK(), {Value} / {Divisor})
\`\`\`

### Null-Safe Field
\`\`\`
IF({Field}, {Field}, "default")
\`\`\`

### JSON Object
\`\`\`
"{" &
  "\\"id\\": \\"" & RECORD_ID() & "\\"," &
  "\\"name\\": \\"" & SUBSTITUTE({Name}, "\\"", "\\\\\\"") & "\\"" &
"}"
\`\`\`

### SWITCH vs Nested IF
\`\`\`
// Instead of deeply nested IF:
SWITCH({Status}, "A", 1, "B", 2, "C", 3, 0)
\`\`\`

## Error Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| \`#ERROR\` | Syntax/reference issue | Check quotes, brackets, field names |
| \`NaN\` | 0/0 or invalid date | Add null checks |
| \`Infinity\` | X/0 | Check divisor ≠ 0 |
| Smart quotes | Curly quotes \`""\` | Use straight quotes \`""\` |

## Function Categories

1. **Text**: CONCATENATE, LEFT, RIGHT, MID, SUBSTITUTE, TRIM, UPPER, LOWER
2. **Numeric**: SUM, AVERAGE, ROUND, MAX, MIN, COUNT, ABS, MOD
3. **Date/Time**: TODAY, NOW, DATEADD, DATETIME_DIFF, DATETIME_FORMAT
4. **Logical**: IF, SWITCH, AND, OR, NOT, ISERROR
5. **Array**: ARRAYJOIN, ARRAYUNIQUE, ARRAYCOMPACT, ARRAYSLICE
6. **Regex**: REGEX_MATCH, REGEX_EXTRACT, REGEX_REPLACE
7. **Record**: RECORD_ID, CREATED_TIME, LAST_MODIFIED_TIME
`;

export const RULE_CONTENT = `---
description: Always use Airtable Formula skill when working with .formula files
globs: ["**/*.formula"]
alwaysApply: true
---

# Airtable Formula Rules

When working with Airtable formulas:

1. **Use the Airtable Formula skill** for all formula-related tasks
2. **No comments allowed** - Airtable doesn't support // or /* */
3. **Field references use braces** - \`{Field Name}\` not cell references
4. **Smart quotes break formulas** - Always use straight quotes \`"\`
5. **Division needs guards** - Check for zero: \`IF({D}=0, BLANK(), {N}/{D})\`

## Quick Reference

- **Safe division**: \`IF({Divisor}=0, BLANK(), {Value}/{Divisor})\`
- **Error handling**: \`IF(ISERROR(expr), fallback, expr)\`
- **Date formatting**: \`DATETIME_FORMAT({Date}, "YYYY-MM-DD")\`
- **Join arrays**: \`ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")\`

## Not Available in Airtable

- VLOOKUP, HLOOKUP (use linked records)
- SUMIF, COUNTIF (use rollups)
- IFERROR (use IF(ISERROR(...)))
- Cell references (A1, B2)
`;

export const FUNCTIONS_REFERENCE = `# Airtable Functions Quick Reference

## Text
| Function | Syntax |
|----------|--------|
| CONCATENATE | \`CONCATENATE(text1, text2, ...)\` |
| LEFT | \`LEFT(string, count)\` |
| RIGHT | \`RIGHT(string, count)\` |
| MID | \`MID(string, start, count)\` |
| LEN | \`LEN(string)\` |
| FIND | \`FIND(needle, haystack, [start])\` |
| SEARCH | \`SEARCH(needle, haystack, [start])\` |
| SUBSTITUTE | \`SUBSTITUTE(string, old, new, [index])\` |
| REPLACE | \`REPLACE(string, start, count, new)\` |
| TRIM | \`TRIM(string)\` |
| UPPER | \`UPPER(string)\` |
| LOWER | \`LOWER(string)\` |
| REPT | \`REPT(string, n)\` |

## Numeric
| Function | Syntax |
|----------|--------|
| SUM | \`SUM(n1, n2, ...)\` |
| AVERAGE | \`AVERAGE(n1, n2, ...)\` |
| MIN | \`MIN(n1, n2, ...)\` |
| MAX | \`MAX(n1, n2, ...)\` |
| ROUND | \`ROUND(number, precision)\` |
| CEILING | \`CEILING(number, [significance])\` |
| FLOOR | \`FLOOR(number, [significance])\` |
| ABS | \`ABS(number)\` |
| MOD | \`MOD(number, divisor)\` |
| POWER | \`POWER(base, exponent)\` |
| SQRT | \`SQRT(number)\` |
| COUNT | \`COUNT(values...)\` |
| COUNTA | \`COUNTA(values...)\` |

## Date/Time
| Function | Syntax |
|----------|--------|
| TODAY | \`TODAY()\` |
| NOW | \`NOW()\` |
| DATEADD | \`DATEADD(date, count, units)\` |
| DATETIME_DIFF | \`DATETIME_DIFF(d1, d2, units)\` |
| DATETIME_FORMAT | \`DATETIME_FORMAT(date, format)\` |
| DATETIME_PARSE | \`DATETIME_PARSE(text, format)\` |
| YEAR | \`YEAR(date)\` |
| MONTH | \`MONTH(date)\` |
| DAY | \`DAY(date)\` |
| WEEKDAY | \`WEEKDAY(date, [start])\` |
| HOUR | \`HOUR(datetime)\` |
| MINUTE | \`MINUTE(datetime)\` |

## Logical
| Function | Syntax |
|----------|--------|
| IF | \`IF(condition, if_true, if_false)\` |
| SWITCH | \`SWITCH(expr, p1, r1, ..., default)\` |
| AND | \`AND(a, b, ...)\` |
| OR | \`OR(a, b, ...)\` |
| NOT | \`NOT(expr)\` |
| XOR | \`XOR(a, b, ...)\` |
| ISERROR | \`ISERROR(expr)\` |
| BLANK | \`BLANK()\` |

## Array
| Function | Syntax |
|----------|--------|
| ARRAYJOIN | \`ARRAYJOIN(array, separator)\` |
| ARRAYUNIQUE | \`ARRAYUNIQUE(array)\` |
| ARRAYCOMPACT | \`ARRAYCOMPACT(array)\` |
| ARRAYFLATTEN | \`ARRAYFLATTEN(array)\` |
| ARRAYSLICE | \`ARRAYSLICE(array, start, [end])\` |

## Regex
| Function | Syntax |
|----------|--------|
| REGEX_MATCH | \`REGEX_MATCH(string, pattern)\` |
| REGEX_EXTRACT | \`REGEX_EXTRACT(string, pattern)\` |
| REGEX_REPLACE | \`REGEX_REPLACE(string, pattern, replacement)\` |
`;

export const WORKFLOWS: Record<string, string> = {
    'debug-formula': `# Debug Airtable Formula

## Trigger
When user asks to debug or fix an Airtable formula error.

## Steps

1. **Identify the error type**
   - \`#ERROR\` → Syntax or reference issue
   - \`NaN\` → Division 0/0 or invalid date math
   - \`Infinity\` → Division X/0
   - \`Circular reference\` → Field references itself

2. **Check common issues**
   - [ ] Balanced parentheses \`()\`
   - [ ] Balanced braces \`{}\`
   - [ ] Balanced quotes \`""\` or \`''\`
   - [ ] No smart/curly quotes
   - [ ] No comments (\`//\` or \`/* */\`)
   - [ ] Field names spelled correctly
   - [ ] All function names valid

3. **Add guards for runtime errors**
   - Division: \`IF({D}=0, BLANK(), {N}/{D})\`
   - Dates: \`IF({Date}=BLANK(), BLANK(), ...)\`
   - Errors: \`IF(ISERROR(expr), fallback, expr)\`

4. **Test the fix**
   - Save the formula
   - Check output in Airtable
`,

    'create-formula': `# Create Airtable Formula

## Trigger
When user asks to create a new Airtable formula.

## Steps

1. **Understand requirements**
   - What fields are involved?
   - What is the expected output type?
   - Any edge cases (nulls, zeros, empty)?

2. **Choose approach**
   - Simple calculation → Direct operators
   - Conditional logic → IF or SWITCH
   - Text manipulation → String functions
   - Date calculations → DATETIME_* functions
   - Array operations → ARRAY* functions

3. **Build incrementally**
   - Start with core logic
   - Add null/error handling
   - Format output if needed

4. **Common patterns**
   \`\`\`
   // Safe division
   IF({Divisor}=0, BLANK(), {Value}/{Divisor})
   
   // Conditional text
   IF({Status}="Done", "✅", IF({Status}="In Progress", "🔄", "⬜"))
   
   // Date difference in days
   DATETIME_DIFF({End}, {Start}, 'days')
   
   // Join unique values
   ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")
   \`\`\`

5. **Validate**
   - Check syntax in VS Code extension
   - Test with sample data
`,

    'convert-excel': `# Convert Excel Formula to Airtable

## Trigger
When user wants to convert an Excel formula to Airtable.

## Common Conversions

| Excel | Airtable |
|-------|----------|
| \`A1\`, \`B2\` | \`{Field Name}\` |
| \`VLOOKUP\` | Use linked records + rollup |
| \`HLOOKUP\` | Use linked records + rollup |
| \`SUMIF\` | Use rollup field with SUM |
| \`COUNTIF\` | Use rollup field with COUNT |
| \`IFERROR(x,y)\` | \`IF(ISERROR(x), y, x)\` |
| \`ISBLANK(x)\` | \`x = BLANK()\` or \`NOT(x)\` |
| \`TEXT(x,"fmt")\` | \`DATETIME_FORMAT(x, "fmt")\` |
| \`DATEVALUE\` | \`DATETIME_PARSE\` |
| \`CONCATENATE\` | Same, or use \`&\` operator |
| \`NOW()\` | Same (callable constant) |
| \`TODAY()\` | Same (callable constant) |

## Steps

1. **Identify Excel functions used**
2. **Map to Airtable equivalents**
3. **Replace cell refs with field refs**
4. **Add error handling if needed**
5. **Test in Airtable**

## Not Available - Use Workarounds

- **VLOOKUP/HLOOKUP**: Create linked record field, then use rollup
- **SUMIF/COUNTIF**: Create linked records with filter, use rollup
- **INDIRECT**: Not available, restructure logic
- **OFFSET**: Not available, use ARRAYSLICE for arrays
`
};

// ─── MCP Tools Guide ─────────────────────────────────────────

export const MCP_TOOLS_GUIDE = `# Airtable User MCP — Tools Guide

> **Server**: airtable-user-mcp v2.4.x
> **Protocol**: Model Context Protocol (MCP) over stdio
> **Transport**: JSON-RPC 2.0

This MCP server provides **36 tools** for managing Airtable bases, organized into 5 categories.
All tools require an \`appId\` (e.g. \`"appXXX"\`) as their first parameter.
All tools accept an optional \`debug: true\` parameter to include raw Airtable responses.

---

## Category 1: Schema Read Tools (5 tools)

Use these tools to **discover and inspect** base structure before making changes.
These are **read-only** and safe to call at any time.

| Tool | When to Use |
|------|-------------|
| \`get_base_schema\` | Get full schema of all tables, fields, and views in a base. Use as the first step when exploring an unknown base. |
| \`list_tables\` | Lightweight listing of table IDs and names. Prefer over \`get_base_schema\` when you only need table names. |
| \`get_table_schema\` | Get full schema for a single table (fields + views). Use when you know which table to work with. |
| \`list_fields\` | List all fields/columns in a table with types and typeOptions. Use before creating formulas to check field names and types. |
| \`list_views\` | List all views in a table with IDs, names, and types. Use before modifying views. |

### Key Parameters
- \`appId\` (required): The Airtable base ID, always starts with \`"app"\`
- \`tableIdOrName\`: Accepts either table ID (\`"tblXXX"\`) or exact table name (case-sensitive)

### Best Practice
> **Always call a read tool before a mutation tool.** For example, call \`list_fields\` before \`create_field\` to verify field names and avoid duplicates.

---

## Category 2: Field Mutation Tools (8 tools)

Use these tools to **create, update, rename, delete, and duplicate** fields (columns).

### Creating Fields

| Tool | When to Use |
|------|-------------|
| \`create_field\` | Create any field type (text, number, checkbox, formula, rollup, lookup, count, etc.). Supports computed fields not available via the official API. |
| \`create_formula_field\` | Shorthand for creating a formula field. Use when you only need a formula — saves specifying \`fieldType\` and \`typeOptions\` wrapper. |

### Validating & Updating Formulas

| Tool | When to Use |
|------|-------------|
| \`validate_formula\` | **Always call this before** \`create_formula_field\` or \`update_formula_field\`. Returns whether the formula is valid and what result type it produces. Catches syntax errors early. |
| \`update_formula_field\` | Update the formula text of an existing formula field. Shorthand for \`update_field_config\`. |
| \`update_field_config\` | Update configuration of any computed field (formula, rollup, lookup, count). Use for non-formula computed fields. |

### Renaming & Deleting

| Tool | When to Use |
|------|-------------|
| \`rename_field\` | Rename a field. Pre-validates the field exists. |
| \`delete_field\` | **⚠️ DESTRUCTIVE** — Delete a field. Requires both \`fieldId\` AND \`expectedName\` as safety guard. Checks for downstream dependencies first. |
| \`duplicate_field\` | Clone a field structure. Optionally copies cell values with \`duplicateCells: true\`. |

### Required Workflow: Formula Creation
\`\`\`
1. list_fields          → verify field names and types exist
2. validate_formula     → check syntax and result type
3. create_formula_field → create the field if validation passes
\`\`\`

### Required Workflow: Formula Update
\`\`\`
1. list_fields          → get the fieldId of the formula field
2. validate_formula     → validate the new formula text
3. update_formula_field → apply the update if validation passes
\`\`\`

### Safety Rules for Field Mutations
- **Never delete a field without user confirmation.** Always show the field name and ask.
- \`delete_field\` checks for downstream dependencies (other fields referencing it). If dependencies exist, it returns dependency info instead of deleting. Set \`force: true\` only if the user explicitly confirms.
- \`expectedName\` must match exactly (case-sensitive) or deletion is refused.

### typeOptions Reference
| Field Type | typeOptions |
|------------|-------------|
| formula | \`{ formulaText: "IF({A},1,0)" }\` |
| rollup | \`{ fieldIdInLinkedTable, recordLinkFieldId, resultType, referencedFieldIds }\` |
| lookup | \`{ recordLinkFieldId, fieldIdInLinkedTable }\` |
| count | \`{ recordLinkFieldId }\` |
| text, number, checkbox | \`{}\` (no typeOptions needed) |

---

## Category 3: View Tools (10 tools)

Use these tools to **create, configure, and manage** views.

### Creating & Managing Views

| Tool | When to Use |
|------|-------------|
| \`create_view\` | Create a new view. Types: \`"grid"\`, \`"form"\`, \`"kanban"\`, \`"calendar"\`, \`"gallery"\`, \`"gantt"\`, \`"levels"\` (list). Can copy config from an existing view. |
| \`duplicate_view\` | Clone a view with all its configuration (filters, sorts, field visibility). |
| \`rename_view\` | Rename a view. |
| \`delete_view\` | **⚠️ DESTRUCTIVE** — Delete a view. Cannot delete the last remaining view in a table. |

### Configuring Views

| Tool | When to Use |
|------|-------------|
| \`update_view_description\` | Set or clear a view's description text. |
| \`update_view_filters\` | Set filter conditions on a view. Supports AND/OR conjunctions. |
| \`reorder_view_fields\` | Change column order in a view. Provide a map of field IDs → column index. |
| \`show_or_hide_view_columns\` | Show or hide specific columns in a view. |
| \`apply_view_sorts\` | Set sort conditions. Pass empty array \`[]\` to clear sorts. |
| \`update_view_group_levels\` | Set grouping. Pass empty array \`[]\` to clear grouping. |
| \`update_view_row_height\` | Change row height: \`"small"\`, \`"medium"\`, \`"large"\`, \`"xlarge"\`. |

### Column Ordering — Critical Behavior

**\`move_visible_columns\`**: The Airtable API moves columns as a block but **preserves their existing relative order** — it does NOT re-sequence by input array order. To place columns in a specific custom sequence, make separate calls per column with incrementing \`targetVisibleIndex\`:
\`\`\`
// ❌ WRONG — array order is ignored by the API:
move_visible_columns({ columnIds: ["fldC", "fldA", "fldB"], targetVisibleIndex: 1 })
// Result: fldA, fldB, fldC (original relative order preserved)

// ✅ CORRECT — sequential single-column moves:
move_visible_columns({ columnIds: ["fldC"], targetVisibleIndex: 1 })
move_visible_columns({ columnIds: ["fldA"], targetVisibleIndex: 2 })
move_visible_columns({ columnIds: ["fldB"], targetVisibleIndex: 3 })
\`\`\`

**\`set_view_columns\`**: One-shot setup — hides all columns then shows only the specified IDs in the given order. Prefer this over manual show/hide + move sequences when setting up a view from scratch.

**\`reorder_view_fields\`**: Operates on the *overall* (visible + hidden) column index. The primary field (first field) always stays at index 0 — do not include it in \`fieldOrder\`. Provide a partial map of field IDs → target indices; the tool merges with the current order automatically.

### Filter Syntax
\`\`\`json
{
  "filterSet": [
    { "columnId": "fldXXX", "operator": "contains", "value": "test" },
    { "columnId": "fldYYY", "operator": "isEmpty" }
  ],
  "conjunction": "and"
}
\`\`\`

### Available Filter Operators
\`contains\`, \`doesNotContain\`, \`is\`, \`isNot\`, \`isEmpty\`, \`isNotEmpty\`,
\`isGreaterThan\`, \`isLessThan\`, \`isGreaterThanOrEqualTo\`, \`isLessThanOrEqualTo\`,
\`isWithin\`, \`isAfter\`, \`isBefore\`, \`hasAnyOf\`, \`hasAllOf\`, \`hasNoneOf\`

### Relative Date Filters (\`isWithin\`)

For date fields with dynamic/rolling windows, use \`isWithin\` with a value object.
Always include \`timeZone\` (IANA string) and \`shouldUseCorrectTimeZoneForFormulaicColumn: true\`:
\`\`\`json
{ "columnId": "fldXXX", "operator": "isWithin", "value": { "mode": "pastWeek", "timeZone": "UTC", "shouldUseCorrectTimeZoneForFormulaicColumn": true } }
{ "columnId": "fldXXX", "operator": "isWithin", "value": { "mode": "pastNumberOfDays", "numberOfDays": 7, "timeZone": "UTC", "shouldUseCorrectTimeZoneForFormulaicColumn": true } }
\`\`\`

Available \`mode\` values (verified via API capture 2026-05-01):
| Mode | numberOfDays required? | Meaning |
|------|----------------------|---------|
| \`"pastWeek"\` / \`"pastMonth"\` / \`"pastYear"\` | no | Rolling past period |
| \`"nextWeek"\` / \`"nextMonth"\` / \`"nextYear"\` | no | Rolling next period |
| \`"thisCalendarMonth"\` / \`"thisCalendarYear"\` | no | Current calendar period |
| \`"pastNumberOfDays"\` | yes | Past N days |
| \`"nextNumberOfDays"\` | yes | Next N days |

Do NOT use \`exactDate\`, \`thisMonth\`, or \`thisYear\` — these are not valid API values.

---

## Category 4: Field Description Tool (1 tool)

| Tool | When to Use |
|------|-------------|
| \`update_field_description\` | Set or update the description text of any field. Use to document field purpose, formula logic, or data source. |

---

## Category 5: Extension/Block Tools (6 tools)

Use these tools to manage Airtable extensions (blocks) and dashboard pages.

| Tool | When to Use |
|------|-------------|
| \`create_extension\` | Register a new extension in a base. Returns a \`blockId\` needed for installation. |
| \`create_extension_dashboard\` | Create a new dashboard page. Extensions are installed onto pages. |
| \`install_extension\` | Install an extension onto a dashboard page. Requires \`blockId\` + \`pageId\`. |
| \`update_extension_state\` | Enable or disable an installed extension (\`"enabled"\` / \`"disabled"\`). |
| \`rename_extension\` | Rename an installed extension. |
| \`duplicate_extension\` | Clone an installed extension to a dashboard page. |
| \`remove_extension\` | **⚠️ DESTRUCTIVE** — Remove an extension from a dashboard. |

### Required Workflow: Extension Installation
\`\`\`
1. create_extension           → get blockId
2. create_extension_dashboard → get pageId
3. install_extension          → install block onto page
\`\`\`

---

## Global Rules

1. **Read before write**: Always call a read tool to understand current state before mutating.
2. **Validate before create**: Always \`validate_formula\` before creating or updating formula fields.
3. **Confirm destructive ops**: Never call \`delete_field\`, \`delete_view\`, or \`remove_extension\` without explicit user confirmation.
4. **Use exact IDs**: Airtable IDs are case-sensitive. Copy them exactly from read tool results.
5. **Prefer shorthands**: Use \`create_formula_field\` over \`create_field\` with type formula. Use \`update_formula_field\` over \`update_field_config\`.
6. **Check dependencies**: Before deleting a field, the tool automatically checks for downstream dependencies. Review the response before forcing deletion.
7. **Use debug sparingly**: Only pass \`debug: true\` when troubleshooting — it returns large raw payloads.

## ID Format Reference

| Entity | Prefix | Example |
|--------|--------|---------|
| Base/App | \`app\` | \`appXXXXXXXXXXXXXX\` |
| Table | \`tbl\` | \`tblXXXXXXXXXXXXXX\` |
| Field | \`fld\` | \`fldXXXXXXXXXXXXXX\` |
| View | \`viw\` | \`viwXXXXXXXXXXXXXX\` |
| Block | \`blk\` | \`blkXXXXXXXXXXXXXX\` |
| Block Installation | \`bli\` | \`bliXXXXXXXXXXXXXX\` |
| Block Release | \`blr\` | \`blrXXXXXXXXXXXXXX\` |
| Dashboard Page | \`bip\` | \`bipXXXXXXXXXXXXXX\` |
`;

// ─── MCP Rules (always-on) ──────────────────────────────────

export const MCP_RULES = `---
description: Rules for using the Airtable User MCP server tools
globs: ["**/*"]
alwaysApply: true
---

# Airtable MCP Server — Tool Usage Rules

These rules apply whenever you interact with Airtable bases via the MCP tools.

## Server Identity

- **Name**: airtable-user-mcp
- **Version**: 2.4.x
- **Protocol**: Model Context Protocol (stdio, JSON-RPC 2.0)
- **Capabilities**: Schema read, field CRUD, view CRUD, formula validation, extension management
- **Tool Count**: 36 tools across 5 categories

## Mandatory Workflows

### Before Creating a Formula Field
1. Call \`list_fields\` to verify all referenced field names exist and check their types
2. Call \`validate_formula\` to check syntax and result type
3. Only then call \`create_formula_field\` or \`create_field\`

### Before Updating a Formula Field
1. Call \`list_fields\` to get the \`fieldId\`
2. Call \`validate_formula\` with the new formula text
3. Only then call \`update_formula_field\`

### Before Deleting a Field
1. Call \`list_fields\` to confirm the field exists and get its exact name
2. Call \`delete_field\` with both \`fieldId\` and \`expectedName\`
3. If dependencies are returned, show them to the user and ask before using \`force: true\`

### Before Installing an Extension
1. \`create_extension\` to get blockId
2. \`create_extension_dashboard\` to get pageId
3. \`install_extension\` with both IDs

## Safety Rules

- **NEVER** call \`delete_field\`, \`delete_view\`, or \`remove_extension\` without explicit user confirmation
- **NEVER** set \`force: true\` on \`delete_field\` without showing dependencies to the user first
- **ALWAYS** validate formulas before creating/updating them
- **ALWAYS** use read tools to discover IDs — never guess or fabricate Airtable IDs
- **PREFER** lightweight reads: use \`list_tables\` over \`get_base_schema\` when you only need table names
- **PREFER** shorthands: use \`create_formula_field\` instead of \`create_field\` with type formula

## Tool Selection Guide

| User Intent | Tool(s) to Use |
|-------------|----------------|
| "Show me the tables" | \`list_tables\` |
| "What fields does X have?" | \`list_fields\` or \`get_table_schema\` |
| "Create a formula that..." | \`list_fields\` then \`validate_formula\` then \`create_formula_field\` |
| "Update the formula in..." | \`list_fields\` then \`validate_formula\` then \`update_formula_field\` |
| "Delete the field..." | \`list_fields\` then confirm with user then \`delete_field\` |
| "Add a new text/number field" | \`create_field\` with appropriate fieldType |
| "Create a view filtered by..." | \`list_fields\` then \`create_view\` then \`update_view_filters\` |
| "Sort/group this view by..." | \`apply_view_sorts\` or \`update_view_group_levels\` |
| "Hide these columns" | \`show_or_hide_view_columns\` with \`visibility: false\` |
| "Install an extension" | \`create_extension\` then \`create_extension_dashboard\` then \`install_extension\` |
| "Set column order to X, Y, Z" | \`set_view_columns\` (full reset) or sequential \`move_visible_columns\` calls |

## Filter Operators Quick Reference

\`contains\`, \`doesNotContain\`, \`is\`, \`isNot\`, \`isEmpty\`, \`isNotEmpty\`,
\`isGreaterThan\`, \`isLessThan\`, \`isGreaterThanOrEqualTo\`, \`isLessThanOrEqualTo\`,
\`isWithin\`, \`isAfter\`, \`isBefore\`, \`hasAnyOf\`, \`hasAllOf\`, \`hasNoneOf\`

## Common Mistakes to Avoid

1. **Creating a formula without validating** — may produce invalid formula errors in Airtable
2. **Using table name instead of table ID for mutations** — some tools require \`tableId\` (tblXXX format)
3. **Forgetting expectedName on delete_field** — deletion will be refused
4. **Passing field names instead of field IDs to view tools** — view tools use \`fldXXX\` IDs, not names
5. **Deleting the last view in a table** — will fail; tables must have at least one view
6. **Passing multiple IDs to \`move_visible_columns\` expecting ordered placement** — the API ignores input array order; make sequential single-column calls instead
7. **Using \`emptyGroupState: "visible"\` in \`update_view_group_levels\`** — the API rejects "visible"; omit this field (defaults to "hidden")
`;
