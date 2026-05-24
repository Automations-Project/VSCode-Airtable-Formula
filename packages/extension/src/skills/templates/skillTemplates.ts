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

export const MCP_TOOLS_GUIDE = `# Airtable MCP — Tools Guide

> **Server**: airtable-user-mcp v2.4.x  |  **Protocol**: MCP (JSON-RPC 2.0)
> **Tools**: 66 tools across 13 categories + \`manage_tools\`

---

## Which MCP to Use

Two MCPs are available and designed to work together:

| Task | Which MCP |
|------|-----------|
| **Read records** (snapshot, up to 1000/call, works on lookup fields) | **airtable-user-mcp** \`query_records\` |
| **Search records** by text (including values from lookup fields) | **airtable-user-mcp** \`query_records\` with \`search\` param |
| **Duplicate records** | **airtable-user-mcp** \`duplicate_records\` |
| Create / update / delete **records** (full REST CRUD) | **Official** \`mcp.airtable.com\` |
| List all bases you have access to | **Official** \`mcp.airtable.com\` |
| Create / rename / delete **tables** | **airtable-user-mcp** |
| Create / update / delete **fields** (including formula fields) | **airtable-user-mcp** |
| **Validate a formula** before applying it | **airtable-user-mcp** |
| Configure **views** (filters, sorts, groups, column order) | **airtable-user-mcp** |
| Manage **view sections** (sidebar grouping) | **airtable-user-mcp** |
| Manage **form metadata** and submission notifications | **airtable-user-mcp** |
| Manage **extensions / blocks** | **airtable-user-mcp** |
| Manage **record templates** | **airtable-user-mcp** |

### Common combined workflow
\`\`\`
1. Use airtable-user-mcp to create tables, fields, and views (schema setup)
2. Use Official MCP to populate records (data CRUD)
3. Use airtable-user-mcp to refine view filters/sorts after data is in
4. Use airtable-user-mcp query_records to read/search data (especially lookup fields)
\`\`\`

### Authentication
- **Official MCP**: requires a Personal Access Token (PAT) or OAuth — configure in IDE MCP settings
- **airtable-user-mcp**: uses a browser session (login once via the VS Code extension) OR uses a PAT if configured via the extension's Official Airtable MCP panel

---

## airtable-user-mcp Tool Reference

All tools accept an optional \`debug: true\` parameter to include raw Airtable responses.
Most schema tools require \`appId\` (e.g. \`"appXXX"\`) as their first parameter.

---

### Category 1: Read / Inspect (11 tools)

Read-only. Safe to call at any time. Always call a read tool before mutating.

| Tool | When to Use |
|------|-------------|
| \`get_base_schema\` | Full schema of all tables, fields, and views. Use first when exploring an unknown base. |
| \`list_tables\` | Lightweight table ID + name listing. Prefer over \`get_base_schema\` when you only need table names. |
| \`get_table_schema\` | Full schema for one table (fields + views). Use when you know the table. |
| \`list_fields\` | All fields with types and typeOptions. Call before creating formulas or mutations. |
| \`list_views\` | All views with IDs, names, types. Call before modifying views. |
| \`get_view\` | Live view state: filters, sorts, groups, column order, frozen cols, color config. |
| \`validate_formula\` | **Always call before** \`create_formula_field\` or \`update_formula_field\`. Returns validity + result type. |
| \`list_view_sections\` | List sidebar view sections (groups) in a table. |
| \`list_record_templates\` | List record templates defined in a table. |
| \`download_formula_field\` | Download a formula field to a local \`.formula\` file with \`AT:\` header. Pass \`outputPath\` to save, or omit to read inline. |
| \`download_base_formulas\` | Download ALL formula fields in a base to \`.formula\` files, organised into per-table subfolders. |

---

### Category 2: Record Read (1 tool)

Reads resolved record data via the internal readQueries endpoint. Bypasses REST API limitations — see [REST API Limitations](#rest-api-limitations) below.

| Tool | When to Use |
|------|-------------|
| \`query_records\` | Read up to 1000 records from a view. Pass \`search\` for case-insensitive text matching across all field values including lookup fields, formula fields, and multi-select arrays. Increase \`limit\` (max 1000) to widen the search window. |

#### query_records — search parameter
\`\`\`json
{
  "appId": "appXXX", "tableId": "tblXXX", "viewId": "viwXXX",
  "search": "john",
  "limit": 500
}
\`\`\`
Returns only records where at least one field value contains "john" (case-insensitive).
Works on text, number, formula, **lookup**, rollup, and array (multi-select) fields.

---

### Category 3: Table Write (9 tools)

Non-destructive table and record-template operations.

| Tool | When to Use |
|------|-------------|
| \`create_table\` | Create a new table with initial fields. |
| \`rename_table\` | Rename an existing table. |
| \`create_record_template\` | Create a record template (pre-filled row). |
| \`rename_record_template\` | Rename a record template. |
| \`update_record_template_description\` | Set or clear a template's description. |
| \`set_record_template_cell\` | Set a field value in a record template. |
| \`set_record_template_visible_columns\` | Choose which fields are visible when using a template. |
| \`duplicate_record_template\` | Clone an existing record template. |
| \`apply_record_template\` | Stamp a template onto a new record. |

---

### Category 4: Table Destructive (2 tools)

⚠️ Always confirm with the user before calling.

| Tool | When to Use |
|------|-------------|
| \`delete_table\` | Permanently delete a table and all its records. |
| \`delete_record_template\` | Delete a record template. |

---

### Category 5: Field Write (7 tools)

Non-destructive field operations.

| Tool | When to Use |
|------|-------------|
| \`create_field\` | Create any field type (text, number, checkbox, formula, rollup, lookup, count, …). |
| \`create_formula_field\` | Shorthand for creating a formula field. |
| \`update_formula_field\` | Update the formula text of an existing formula field. |
| \`update_field_config\` | Update config of any field type — computed (rollup, lookup, count, formula) or non-computed (singleSelect, multipleSelects, number, date, …). |
| \`rename_field\` | Rename a field. |
| \`update_field_description\` | Set or clear a field's description/documentation. |
| \`duplicate_field\` | Clone a field. Pass \`duplicateCells: true\` to copy values too. |

#### Required Workflow: Formula Creation
\`\`\`
1. list_fields          → check field names and types
2. validate_formula     → verify syntax and result type
3. create_formula_field → create only if validation passes
\`\`\`

#### Required Workflow: Formula Update
\`\`\`
1. list_fields          → get the fieldId
2. validate_formula     → validate new formula text
3. update_formula_field → apply if valid
\`\`\`

#### typeOptions Reference
| Field Type | typeOptions |
|------------|-------------|
| formula | \`{ formulaText: "IF({A},1,0)" }\` |
| rollup | \`{ fieldIdInLinkedTable, recordLinkFieldId, resultType, referencedFieldIds }\` |
| lookup | \`{ recordLinkFieldId, fieldIdInLinkedTable }\` |
| count | \`{ recordLinkFieldId }\` |
| singleSelect | \`{ choices: [{ name: "Option A", color: "blueLight2" }] }\` |
| multipleSelects | \`{ choices: [{ name: "PC" }, { name: "Xbox", color: "greenLight2" }] }\` |
| text, number, checkbox | \`{}\` (no typeOptions needed) |

#### Working with Select Choices
Pass choices as an array of \`{ name, color? }\` objects — IDs are auto-generated for new choices.

To **add choices without losing existing ones**, call \`get_table_schema\` first to get existing choice IDs, then pass the full merged list:
\`\`\`json
{ "choices": [
    { "id": "selXXXXXXXXXXXXXX", "name": "Existing Choice" },
    { "name": "New Choice", "color": "pinkLight2" }
] }
\`\`\`
Choices **not** in the list are deleted. Omitting \`id\` creates a new choice.

---

### Category 6: Field Destructive (2 tools)

⚠️ Always confirm with the user before calling.

| Tool | When to Use |
|------|-------------|
| \`delete_field\` | Delete a single field. Requires \`fieldId\` + \`expectedName\` (exact match). Auto-checks dependencies first; set \`force: true\` only after user reviews them. |
| \`delete_fields\` | Delete multiple fields in one call. Each entry needs \`fieldId\` + \`expectedName\`. Processed sequentially — partial results always returned. Pass \`checkpointPath\` to save progress so a batch can be resumed if interrupted. |

---

### Category 7: View Write (19 tools)

Non-destructive view creation and configuration.

#### Creating & Cloning
| Tool | When to Use |
|------|-------------|
| \`create_view\` | Create a view. Types: \`grid\`, \`form\`, \`kanban\`, \`calendar\`, \`gallery\`, \`gantt\`, \`levels\`. |
| \`duplicate_view\` | Clone a view with all its config (filters, sorts, field visibility). |
| \`rename_view\` | Rename a view. |
| \`update_view_description\` | Set or clear a view's description. |

#### Configuring Data Display
| Tool | When to Use |
|------|-------------|
| \`update_view_filters\` | Set filter conditions. Supports AND/OR conjunctions. |
| \`apply_view_sorts\` | Set sort conditions. Pass \`[]\` to clear. |
| \`update_view_group_levels\` | Set grouping. Pass \`[]\` to clear. |
| \`update_view_row_height\` | Row height: \`small\`, \`medium\`, \`large\`, \`xlarge\`. |
| \`set_view_cover\` | Set gallery/kanban cover field. |
| \`set_view_color_config\` | Set row coloring rules. |
| \`set_view_cell_wrap\` | Toggle cell text wrap. |
| \`set_calendar_date_columns\` | Set the date columns for calendar views. |

#### Column Layout
| Tool | When to Use |
|------|-------------|
| \`show_or_hide_view_columns\` | Show or hide specific columns by field ID. |
| \`show_or_hide_all_columns\` | Show or hide every column at once. |
| \`set_view_columns\` | **One-shot reset**: hides all, then shows only specified IDs in order. Prefer this for fresh view setup. |
| \`reorder_view_fields\` | Reorder by overall index (visible + hidden). Primary field always stays at 0. |
| \`move_visible_columns\` | Move visible columns to a target index. ⚠️ See critical behavior below. |
| \`move_overall_columns\` | Move any column (visible or hidden) to a target overall index. |
| \`update_frozen_column_count\` | Set how many leftmost columns are frozen. |

#### \`move_visible_columns\` — Critical Behavior
The API moves a block of columns but **preserves their existing relative order** — input array order is ignored. For a specific sequence, make one call per column:
\`\`\`
// ❌ WRONG — array order ignored:
move_visible_columns({ columnIds: ["fldC","fldA","fldB"], targetVisibleIndex: 1 })
// Result: fldA, fldB, fldC  (original relative order kept)

// ✅ CORRECT — one column at a time:
move_visible_columns({ columnIds: ["fldC"], targetVisibleIndex: 1 })
move_visible_columns({ columnIds: ["fldA"], targetVisibleIndex: 2 })
move_visible_columns({ columnIds: ["fldB"], targetVisibleIndex: 3 })
\`\`\`

#### Filter Syntax
\`\`\`json
{
  "filterSet": [
    { "columnId": "fldXXX", "operator": "contains", "value": "test" },
    { "columnId": "fldYYY", "operator": "isEmpty" }
  ],
  "conjunction": "and"
}
\`\`\`

Available operators: \`contains\`, \`doesNotContain\`, \`is\`, \`isNot\`, \`isEmpty\`, \`isNotEmpty\`,
\`isGreaterThan\`, \`isLessThan\`, \`isGreaterThanOrEqualTo\`, \`isLessThanOrEqualTo\`,
\`isWithin\`, \`isAfter\`, \`isBefore\`, \`hasAnyOf\`, \`hasAllOf\`, \`hasNoneOf\`

#### Relative Date Filters (\`isWithin\`)
\`\`\`json
{ "columnId": "fldXXX", "operator": "isWithin",
  "value": { "mode": "pastWeek", "timeZone": "UTC",
              "shouldUseCorrectTimeZoneForFormulaicColumn": true } }
\`\`\`
Valid \`mode\` values: \`pastWeek\`, \`pastMonth\`, \`pastYear\`, \`nextWeek\`, \`nextMonth\`, \`nextYear\`,
\`thisCalendarMonth\`, \`thisCalendarYear\`, \`pastNumberOfDays\` (+ \`numberOfDays\`), \`nextNumberOfDays\` (+ \`numberOfDays\`).
Do **NOT** use \`exactDate\`, \`thisMonth\`, or \`thisYear\` — these are rejected by the API.

---

### Category 8: View Destructive (1 tool)

⚠️ Cannot delete the last view in a table.

| Tool | When to Use |
|------|-------------|
| \`delete_view\` | Permanently delete a view. |

---

### Category 9: View Sections (3 tools)

Manage the sidebar view groupings (sections/folders).

| Tool | When to Use |
|------|-------------|
| \`create_view_section\` | Create a new sidebar section. |
| \`rename_view_section\` | Rename a sidebar section. |
| \`move_view_to_section\` | Move a view into a sidebar section. |

---

### Category 10: View Sections — Destructive (1 tool)

| Tool | When to Use |
|------|-------------|
| \`delete_view_section\` | Delete a sidebar section (views inside are NOT deleted). |

---

### Category 11: Form Metadata (2 tools)

Configure legacy form views (public-facing, so gated separately from other view-write ops).

| Tool | When to Use |
|------|-------------|
| \`set_form_metadata\` | Set form title, description, cover, and field labels. |
| \`set_form_submission_notification\` | Configure who gets notified on form submission. |

---

### Category 12: Extension Management (7 tools)

| Tool | When to Use |
|------|-------------|
| \`create_extension\` | Register a new extension. Returns \`blockId\` needed for installation. |
| \`create_extension_dashboard\` | Create a dashboard page. Returns \`pageId\`. |
| \`install_extension\` | Install extension onto a page. Requires \`blockId\` + \`pageId\`. |
| \`update_extension_state\` | Enable or disable an extension (\`enabled\` / \`disabled\`). |
| \`rename_extension\` | Rename an installed extension. |
| \`duplicate_extension\` | Clone an extension to a dashboard page. |
| \`remove_extension\` | **⚠️ DESTRUCTIVE** — Remove an extension from a dashboard. |

#### Required Workflow: Extension Installation
\`\`\`
1. create_extension           → get blockId
2. create_extension_dashboard → get pageId
3. install_extension          → install onto page
\`\`\`

---

### Category 13: Record Write (1 tool)

| Tool | When to Use |
|------|-------------|
| \`duplicate_records\` | Duplicate one or more existing records within the same table. Pass \`sourceRowIds\` array. Returns new record IDs. |

---

## REST API Limitations — and Our Fixes {#rest-api-limitations}

The official Airtable REST API (\`mcp.airtable.com\`) has several well-known limitations.
\`airtable-user-mcp\` uses Airtable's **internal API** directly and avoids most of them.

| Limitation | Official REST API | airtable-user-mcp Fix |
|------------|------------------|----------------------|
| \`filterByFormula\` with \`FIND()\`/\`SEARCH()\` doesn't match lookup-resolved values | ❌ Fails silently for lookup/rollup fields — returns 0 results or wrong results | ✅ \`query_records\` fetches resolved cell values; \`search\` param does substring matching on actual data |
| No formula validation endpoint | ❌ Invalid formulas only fail at save time | ✅ \`validate_formula\` validates before saving and reports result type |
| No view configuration (filters, sorts, groups, column order) | ❌ Not available | ✅ Full set of 19 view-write tools |
| No formula field creation/update | ❌ REST API can create some field types but not formula fields reliably | ✅ \`create_formula_field\` and \`update_formula_field\` |
| No bulk field deletion | ❌ One delete per request | ✅ \`delete_fields\` deletes multiple fields in one call with checkpoint/resume |

### Searching records with lookup fields — in detail

The REST API approach breaks for lookup fields:
\`\`\`
// ❌ FAILS — FIND() operates on the unresolved cell value, not the linked record's text
filterByFormula: "FIND('John Smith', {Name Lookup})"
// Returns 0 results even when "John Smith" exists in the linked table
\`\`\`

Our \`query_records\` fix:
\`\`\`json
{
  "appId": "appXXX", "tableId": "tblXXX", "viewId": "viwXXX",
  "search": "john smith",
  "limit": 1000
}
\`\`\`
The internal readQueries endpoint returns **resolved** cell values for every field type.
The \`search\` filter runs over the already-resolved strings — lookup/rollup/formula fields all work.

**Known limit**: \`search\` only scans records within the \`limit\` window (1–1000).
If you need to search across a very large table, paginate by fetching multiple views or
increasing \`limit\` to 1000 first.

---

### Meta-Tool: manage_tools

Built-in tool always available regardless of active profile.
Use to inspect or change the active tool profile without leaving your AI session.

| Action | What it does |
|--------|-------------|
| \`get_tool_status\` | Show current profile, enabled/disabled counts, and which tools are hidden. |
| \`switch_profile\` | Switch to \`read-only\`, \`safe-write\`, or \`full\` profile. |
| \`toggle_category\` | Enable or disable a specific category when profile is \`custom\`. |

---

## Global Rules

1. **Read before write** — always inspect current state before mutating.
2. **Validate before formula** — always call \`validate_formula\` before creating or updating formula fields.
3. **Confirm destructive ops** — never call delete tools without explicit user confirmation.
4. **Exact IDs** — Airtable IDs are case-sensitive. Always copy from read tool results, never guess.
5. **Prefer shorthands** — \`create_formula_field\` over \`create_field\` with formula type; \`update_formula_field\` over \`update_field_config\`.
6. **Check dependencies** — \`delete_field\` auto-checks downstream deps; show them to the user before \`force: true\`.
7. **debug sparingly** — \`debug: true\` returns large raw payloads; only use when troubleshooting.
8. **Using REST API filterByFormula on lookup fields** — it doesn't work; use \`query_records\` with \`search\` instead.

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
description: Rules for using the Airtable MCP servers (airtable-user-mcp + official mcp.airtable.com)
globs: ["**/*"]
alwaysApply: true
---

# Airtable MCP — Tool Usage Rules

## Two MCPs, Complementary Roles

| Need | Use |
|------|-----|
| **Read records / search by text** (incl. lookup fields) | **airtable-user-mcp** \`query_records\` |
| **Duplicate records** | **airtable-user-mcp** \`duplicate_records\` |
| Create / update / delete **records** (full CRUD) | **Official MCP** (\`mcp.airtable.com\`) |
| List bases you have access to | **Official MCP** |
| **Schema work** — tables, fields, formulas, views | **airtable-user-mcp** |
| **Formula validation** before applying | **airtable-user-mcp** (\`validate_formula\`) |
| **View config** — filters, sorts, groups, column order | **airtable-user-mcp** |
| **View sections**, form metadata, extensions | **airtable-user-mcp** |
| **Record templates** | **airtable-user-mcp** |

Use them together: set up schema with airtable-user-mcp, populate records with the Official MCP,
and use airtable-user-mcp \`query_records\` to read/search data (especially when lookup fields are involved).

## airtable-user-mcp — Server Identity

- **Name**: airtable-user-mcp  |  **Version**: 2.4.x
- **Protocol**: Model Context Protocol (JSON-RPC 2.0)
- **Tools**: 66 tools across 13 categories + \`manage_tools\`
- **Auth**: browser session (or PAT via Official MCP panel in the VS Code extension)

## Mandatory Workflows

### Before Creating a Formula Field
1. \`list_fields\` — verify all referenced field names exist and check types
2. \`validate_formula\` — confirm syntax and result type
3. \`create_formula_field\` — only if validation passes

### Before Updating a Formula Field
1. \`list_fields\` — get the \`fieldId\`
2. \`validate_formula\` — validate new formula text
3. \`update_formula_field\` — apply only if valid

### Before Deleting Any Field / View / Table
1. Read tool first — confirm it exists and get exact name/ID
2. Show the user what will be deleted and ask for confirmation
3. Call the delete tool with required safety params (\`expectedName\` for fields)
4. For \`delete_field\`: review any returned dependencies before setting \`force: true\`

### Before Installing an Extension
1. \`create_extension\` → get \`blockId\`
2. \`create_extension_dashboard\` → get \`pageId\`
3. \`install_extension\` → install onto page

### Searching / Reading Records
1. Prefer \`query_records\` over Official MCP \`list_records_for_table\` when fields include lookups or rollups
2. Pass \`search\` for text matching — works on ALL field types including lookup-resolved strings
3. Increase \`limit\` (up to 1000) if you need to search across a larger record set
4. For very large tables, note that \`search\` only scans within the \`limit\` window — use a filtered view to pre-narrow the scope

## Safety Rules

- **NEVER** call any delete tool (\`delete_field\`, \`delete_view\`, \`delete_table\`, \`delete_record_template\`, \`delete_view_section\`, \`remove_extension\`) without explicit user confirmation
- **NEVER** set \`force: true\` on \`delete_field\` before showing the user the returned dependencies
- **ALWAYS** validate formulas before creating or updating formula fields
- **ALWAYS** use read tools to discover IDs — never guess or fabricate Airtable IDs
- **PREFER** lightweight reads: \`list_tables\` over \`get_base_schema\` when only table names are needed
- **PREFER** shorthands: \`create_formula_field\` over \`create_field\` with formula type

## Tool Selection Guide

| User Intent | Tool(s) to Use |
|-------------|----------------|
| "Show me the tables" | \`list_tables\` |
| "What fields does X have?" | \`list_fields\` or \`get_table_schema\` |
| "What are the current filters on view Y?" | \`get_view\` |
| "Create a formula that…" | \`list_fields\` → \`validate_formula\` → \`create_formula_field\` |
| "Update the formula in…" | \`list_fields\` → \`validate_formula\` → \`update_formula_field\` |
| "Delete the field…" | \`list_fields\` → confirm → \`delete_field\` |
| "Add a text/number field" | \`create_field\` with appropriate \`fieldType\` |
| "Create a view filtered by…" | \`list_fields\` → \`create_view\` → \`update_view_filters\` |
| "Sort/group this view by…" | \`apply_view_sorts\` or \`update_view_group_levels\` |
| "Hide these columns" | \`show_or_hide_view_columns\` |
| "Set column order to X, Y, Z" | \`set_view_columns\` (full reset) or sequential \`move_visible_columns\` calls |
| "Organise views into sections" | \`create_view_section\` → \`move_view_to_section\` |
| "Install an extension" | \`create_extension\` → \`create_extension_dashboard\` → \`install_extension\` |
| "Read / search records" | \`query_records\` (especially when lookup fields are involved) |
| "Find a record by name when name is a lookup" | \`query_records\` with \`search\` — REST API \`filterByFormula\` doesn't work here |
| "Duplicate records" | \`duplicate_records\` |
| "Create brand-new records" | **Official MCP** |
| "What profiles/tools are active?" | \`manage_tools\` with action \`get_tool_status\` |

## Common Mistakes to Avoid

1. **Creating a formula without validating** — may silently produce an invalid field in Airtable
2. **Using table name instead of ID for mutation tools** — some tools require \`tableId\` (\`tblXXX\` format)
3. **Omitting \`expectedName\` on \`delete_field\`** — deletion will be refused
4. **Passing field names instead of field IDs to view tools** — view tools use \`fldXXX\` IDs, not names
5. **Deleting the last view in a table** — will fail; a table must always have at least one view
6. **Passing multiple IDs to \`move_visible_columns\` expecting ordered placement** — the API ignores input array order; make one call per column with incrementing \`targetVisibleIndex\`
7. **Using \`emptyGroupState: "visible"\` in \`update_view_group_levels\`** — the API rejects this value; omit the field (defaults to "hidden")
8. **Using REST API \`filterByFormula\` with \`FIND()\`/\`SEARCH()\` on lookup fields** — returns wrong/empty results; use \`query_records\` with \`search\` instead
9. **Using Official MCP to read records when lookup field values matter** — Official MCP may return unresolved IDs; \`query_records\` returns fully resolved strings
10. **Passing \`fieldType: "singleSelect"\` to \`create_field\` / \`update_field_config\` and expecting raw API type matching** — the internal Airtable API uses \`"select"\` (not \`"singleSelect"\`); airtable-user-mcp normalises this automatically so always pass \`"singleSelect"\` — never pass \`"select"\` directly
11. **Passing a partial choices list to \`update_field_config\` on a select field** — choices NOT included are deleted; always fetch existing choice IDs first with \`get_table_schema\` and include them in the list
`;
