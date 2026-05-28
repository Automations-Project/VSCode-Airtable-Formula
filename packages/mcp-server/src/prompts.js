/**
 * MCP prompts for Airtable — appear as slash commands in Claude Code,
 * Codex CLI, and any other MCP client that supports the prompts capability.
 *
 * Template substitution: {lowerCamelArg} is replaced by the argument value.
 * Pattern matches only lowercase-starting camelCase identifiers to avoid
 * clashing with Airtable field names ({Field Name}) or functions (UPPER_CASE).
 */
import { readPromptsConfig } from './prompts-config.js';

// ── Substitution ────────────────────────────────────────────────────────────

const ARG_RE = /\{([a-z][a-zA-Z0-9]*)\}/g;

function substituteTemplate(template, args) {
  return template.replace(ARG_RE, (_, key) => args[key] ?? '');
}

// ── Built-in Definitions ────────────────────────────────────────────────────

export const BUILTIN_PROMPT_DEFS = [
  {
    name: 'airtable-fix-formula',
    description: 'Debug and fix an Airtable formula error or unexpected result',
    arguments: [
      { name: 'formula',  description: 'The formula to fix',                          required: true  },
      { name: 'error',    description: 'Error message or symptom (e.g. #ERROR, NaN)', required: false },
      { name: 'appId',    description: 'Base ID (appXXX) to validate against',         required: false },
      { name: 'tableId',  description: 'Table ID (tblXXX) for field context',          required: false },
    ],
    template: `\
You are an Airtable formula expert. Debug and fix the following formula.

**Formula to fix:**
\`\`\`
{formula}
\`\`\`

**Reported error / symptom:** {error}

**Available context (use when provided):**
- Base ID: {appId}
- Table ID: {tableId}

**Steps:**
1. Identify the root cause: syntax errors, wrong function names, type mismatches, unclosed parentheses, field names missing braces, smart/curly quotes, or division-by-zero without a guard.
2. If Base ID and Table ID are provided above, call \`list_fields\` to verify the referenced field names exist and have the expected types.
3. If Base ID is provided above, call \`validate_formula\` with the corrected formula to confirm it is syntactically valid before returning.
4. Return the corrected formula and a brief explanation of what was wrong.

Airtable formula rules: field references use curly braces \`{Field Name}\`, no \`//\` comments, always straight quotes \`"\`, safe division: \`IF({Divisor}=0, BLANK(), {Value}/{Divisor})\`.`,
  },

  {
    name: 'airtable-create-formula',
    description: 'Create an Airtable formula from a plain-language description',
    arguments: [
      { name: 'description', description: 'What the formula should calculate or produce', required: true  },
      { name: 'appId',       description: 'Base ID (appXXX) to look up field names',      required: false },
      { name: 'tableId',     description: 'Table ID (tblXXX) to look up field names',     required: false },
    ],
    template: `\
You are an Airtable formula expert. Create a formula that does the following:

**Requirement:** {description}

**Available context (use when provided):**
- Base ID: {appId}
- Table ID: {tableId}

**Steps:**
1. If Base ID and Table ID are provided above, call \`list_fields\` to discover available field names and their types. Use the exact field names from the schema.
2. Draft the formula using correct Airtable syntax.
3. Apply null-guards where values might be empty — e.g. \`IF({Field}="", "", ...)\`.
4. If Base ID and Table ID are provided, call \`validate_formula\` to confirm the formula is valid and check its result type.
5. Return the final formula with a brief explanation of how it works.

Airtable formula rules: field references use curly braces \`{Field Name}\`, no \`//\` comments, always straight quotes \`"\`, safe division: \`IF({Divisor}=0, BLANK(), {Value}/{Divisor})\`, use \`IF(ISERROR(expr), fallback, expr)\` for error handling.`,
  },

  {
    name: 'airtable-inspect-base',
    description: 'Explore and summarise the schema of an Airtable base',
    arguments: [
      { name: 'appId', description: 'Base ID to inspect (appXXX)', required: true },
    ],
    template: `\
Inspect and summarise the Airtable base with ID: **{appId}**

**Steps:**
1. Call \`list_tables\` with appId="{appId}" to get an overview of all tables.
2. Present a clear summary: table names, rough purpose (inferred from the name), and total table count.
3. Ask the user if they want to drill into any specific table.
4. For each table the user selects, call \`get_table_schema\` to show fields (name, type, and typeOptions for computed fields).
5. Highlight any formula fields and offer to explain or improve them.`,
  },

  {
    name: 'airtable-setup-view',
    description: 'Configure an Airtable view — filters, sorts, groups, and column order',
    arguments: [
      { name: 'appId',        description: 'Base ID (appXXX)',                       required: true  },
      { name: 'tableId',      description: 'Table ID (tblXXX)',                      required: true  },
      { name: 'requirements', description: 'What the view should show and how',      required: false },
    ],
    template: `\
Configure an Airtable view in base **{appId}**, table **{tableId}**.

**Requirements:** {requirements}

**Steps:**
1. Call \`list_views\` with appId="{appId}", tableId="{tableId}" to see existing views.
2. Call \`list_fields\` with appId="{appId}", tableId="{tableId}" to discover available fields and their IDs.
3. Based on the requirements, decide whether to create a new view (\`create_view\`) or modify an existing one.
4. Apply the necessary configuration:
   - Filters: \`update_view_filters\`
   - Sorts: \`apply_view_sorts\`
   - Grouping: \`update_view_group_levels\`
   - Column visibility + order: \`set_view_columns\` for a full reset; or \`show_or_hide_view_columns\` + sequential \`move_visible_columns\` calls for partial changes.
5. For column ordering with \`move_visible_columns\`: make one call per column with incrementing \`targetVisibleIndex\` — the API ignores input array order.
6. Confirm the changes with the user after each major step.`,
  },

  {
    name: 'airtable-manage-select-choices',
    description: 'Add, remove, or replace choices on a singleSelect or multipleSelects field',
    arguments: [
      { name: 'appId',   description: 'Base ID (appXXX)',                              required: true  },
      { name: 'fieldId', description: 'Field ID (fldXXX)',                             required: true  },
      { name: 'action',  description: '"add", "remove", "replace", or "list"',         required: true  },
      { name: 'choices', description: 'Comma-separated choice names (e.g. "PC, Xbox")', required: false },
    ],
    template: `\
Manage choices for an Airtable select field.

**Base:** {appId}
**Field:** {fieldId}
**Action:** {action}
**Choices to add/remove/replace:** {choices}

**Steps:**

1. Call \`get_base_schema\` with appId="{appId}" to find the field's current type ("singleSelect" or "multipleSelects") and its existing choices. Each existing choice has an \`id\`, \`name\`, and \`color\`.

2. Based on the action:

   **list** — just report the current choices, no update needed.

   **add** — build the full choice list: all existing choices (include their \`id\`) + the new choices (no \`id\`):
   \`\`\`json
   [
     { "id": "selXXXXXXXXXXXXXX", "name": "Existing Choice" },
     { "name": "New Choice", "color": "blue" }
   ]
   \`\`\`

   **remove** — build the list of choices you want to KEEP (omit the ones to remove, each with their \`id\`).

   **replace** — pass only the new choices without any \`id\` fields (all existing choices will be deleted).

3. Call \`update_field_config\` with:
   - appId: "{appId}"
   - fieldId: "{fieldId}"
   - fieldType: the field's current type ("singleSelect" or "multipleSelects")
   - typeOptions: { choices: <the list from step 2> }

4. Confirm the result to the user.

**Color names:** "blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray".
**Important:** Choices omitted from the list are permanently deleted. Always fetch the current schema first when adding or removing specific choices.`,
  },

  {
    name: 'airtable-search-records',
    description: 'Search for records in an Airtable table by text, including lookup field values',
    arguments: [
      { name: 'appId',   description: 'Base ID (appXXX)',                                      required: true  },
      { name: 'tableId', description: 'Table ID (tblXXX)',                                     required: true  },
      { name: 'viewId',  description: 'View ID (viwXXX) — determines which records are visible', required: true  },
      { name: 'search',  description: 'Text to search for (case-insensitive substring match)',   required: false },
      { name: 'limit',   description: 'Max records to scan (1–1000, default 100)',              required: false },
    ],
    template: `\
Search for records in Airtable base **{appId}**, table **{tableId}**, view **{viewId}**.

**Search term:** {search}
**Limit:** {limit}

**Steps:**
1. Call \`list_fields\` with appId="{appId}", tableId="{tableId}" to understand what fields are available and identify any lookup or rollup fields.
2. Call \`query_records\` with:
   - appId: "{appId}"
   - tableId: "{tableId}"
   - viewId: "{viewId}"
   - search: "{search}" (omit if blank — returns all records up to limit)
   - limit: {limit} (default 100; increase up to 1000 to search more records)
3. Present matching records clearly. Include the record ID and the most relevant field values.
4. If zero results: suggest increasing the limit, checking the view ID, or trying a shorter search term.

**Why \`query_records\` instead of the Official MCP \`search_records\`:**
The Official Airtable REST API's \`filterByFormula\` approach uses \`FIND()\`/\`SEARCH()\` formulas
which silently fail on lookup fields — they match against the raw linked record ID rather than
the resolved display value. \`query_records\` uses the internal readQueries endpoint which returns
fully resolved cell values, so searches work correctly on lookup, rollup, and formula fields.`,
  },

  {
    name: 'airtable-setup-rollup-lookup',
    description: 'Create or update a rollup or lookup field with guided field-ID resolution',
    arguments: [
      { name: 'appId',      description: 'Base ID (appXXX)',                                            required: true  },
      { name: 'tableId',    description: 'Table ID (tblXXX) where the rollup/lookup field will live',   required: true  },
      { name: 'fieldType',  description: '"rollup" or "lookup"',                                        required: true  },
      { name: 'fieldName',  description: 'Name for the new field (or existing fieldId to update)',      required: true  },
      { name: 'goal',       description: 'What to roll up or look up (plain English)',                  required: false },
    ],
    template: `\
Set up an Airtable {fieldType} field in base **{appId}**, table **{tableId}**.

**Field name / ID:** {fieldName}
**Goal:** {goal}

**Steps:**

1. Call \`get_table_schema\` with appId="{appId}", tableIdOrName="{tableId}" to list all fields.

2. Identify the **link field** — the field of type "foreignKey" (linked record field) that connects to the table you want to roll up from. Note its field ID — this is \`relationColumnId\`.

3. Call \`get_base_schema\` with appId="{appId}" to find the **linked table**. Look for the table whose ID matches the link field's \`typeOptions.foreignTableId\`.

4. From the linked table's fields, identify the **target field** to roll up or look up. Note its ID — this is \`foreignTableRollupColumnId\`.

5. Build the typeOptions:
   - For **rollup**: \`{ relationColumnId: "fldLINK", foreignTableRollupColumnId: "fldTARGET", formulaText: "SUM(values)" }\`
     Common aggregations: \`SUM(values)\`, \`COUNTA(values)\`, \`MAX(values)\`, \`MIN(values)\`, \`CONCATENATE(ARRAYJOIN(values, ", "))\`
   - For **lookup**: \`{ relationColumnId: "fldLINK", foreignTableRollupColumnId: "fldTARGET" }\`

6. If {fieldName} looks like a field ID (starts with "fld"), call \`update_field_config\`. Otherwise call \`create_field\` with the name "{fieldName}".

7. Confirm the created/updated field with the user.

**Note:** \`relationColumnId\` = the link field in THIS table. \`foreignTableRollupColumnId\` = the field in the LINKED table.`,
  },

  {
    name: 'airtable-build-table',
    description: 'Design and create a complete table structure from plain-language requirements',
    arguments: [
      { name: 'appId',        description: 'Base ID (appXXX)',                           required: true  },
      { name: 'tableName',    description: 'Name for the new table',                     required: true  },
      { name: 'requirements', description: 'What the table should track (plain English)', required: true  },
    ],
    template: `\
Design and build an Airtable table in base **{appId}**.

**Table name:** {tableName}
**Requirements:** {requirements}

**Steps:**

1. Call \`get_base_schema\` with appId="{appId}" to understand the existing base structure — note any related tables and linked-record relationships.

2. Design the field schema from the requirements. For each field decide:
   - Name (clear, noun-first)
   - Type: text, multilineText, number, checkbox, date, singleSelect, multipleSelects, formula, rollup, lookup, foreignKey (linked record), url, email, phone
   - typeOptions where needed (choices for select, formulaText for formula, etc.)

3. Present the proposed schema to the user as a clear table: | Field | Type | Notes |. Wait for approval or adjustments.

4. Call \`create_table\` with appId="{appId}", name="{tableName}", and the primary field name.

5. For each additional field, call \`create_field\` with the confirmed schema. Create fields in dependency order — link fields before rollups/lookups that reference them.

6. Suggest a default view configuration (which fields to show, sensible sort).

**Field type quick reference:**
- Text / long text → \`text\` / \`multilineText\`
- Number / currency / % → \`number\` with format: "integer" / "currency" / "percentV2"
- Date → \`date\`; datetime → \`date\` with isDateTime: true
- Single choice → \`singleSelect\`; multi-choice → \`multipleSelects\`
- Computed → \`formula\`, \`rollup\`, \`lookup\`, \`count\``,
  },

  {
    name: 'airtable-bulk-formula-edit',
    description: 'Download all formula fields from a base, edit them offline, then upload changes',
    arguments: [
      { name: 'appId',     description: 'Base ID (appXXX)',                                      required: true  },
      { name: 'outputDir', description: 'Local directory to write .formula files into',           required: false },
      { name: 'mode',      description: '"download", "upload", or "review" (default: download)',  required: false },
    ],
    template: `\
Bulk formula workflow for Airtable base **{appId}**.

**Output directory:** {outputDir}
**Mode:** {mode}

---

### Mode: download (default)

1. Call \`download_base_formulas\` with appId="{appId}", outputDir="{outputDir}".
   - Each formula field is written as \`<TableName>/<FieldName>.formula\`.
   - Each file starts with a \`# AT:\` metadata header (appId, tableId, fieldId, fieldName).

2. Report a summary: how many files were written, grouped by table.

3. Tell the user: "Edit any .formula file, then run this prompt again with mode=upload to push changes back."

---

### Mode: upload

1. Ask the user for the list of .formula files they edited (or scan {outputDir} for recently modified files).

2. For each file, call \`update_formula_field\` with:
   - appId: "{appId}"
   - fieldId: read from the \`# AT: fieldId=\` header in the file
   - formulaFilePath: the path to the file

   The \`# AT:\` header is stripped automatically — only the formula body is sent.

3. Report success/failure per field.

---

### Mode: review

1. Call \`download_base_formulas\` with appId="{appId}" (no outputDir — returns formula text without writing files when omitted from individual calls, or writes to a temp dir).

2. Display all formulas grouped by table. Flag any that:
   - Are empty or very short (possibly broken)
   - Reference \`{column_value_fldXXX}\` placeholder IDs instead of readable field names (means the formula was stored internally and never had its field refs resolved)
   - Have mismatched parentheses

3. Ask the user which formulas they want to fix.`,
  },

  {
    name: 'airtable-validate-formula',
    description: 'Validate an Airtable formula and show its result type',
    arguments: [
      { name: 'formula', description: 'Formula text to validate',    required: true  },
      { name: 'appId',   description: 'Base ID (appXXX)',            required: true  },
      { name: 'tableId', description: 'Table ID (tblXXX, optional)', required: false },
    ],
    template: `\
Validate the following Airtable formula and report its result type.

**Formula:**
\`\`\`
{formula}
\`\`\`

Call \`validate_formula\` with:
- appId: "{appId}"
- tableId: "{tableId}" (omit if blank)
- formula: the formula text above

Report whether the formula is valid, what result type it produces, and any issues found.
If it is invalid, identify the error and suggest a corrected version.`,
  },
];

export const BUILTIN_NAMES = new Set(BUILTIN_PROMPT_DEFS.map(p => p.name));

// ── Merge helpers ───────────────────────────────────────────────────────────

/**
 * Returns the merged prompt list: built-ins (possibly overridden) + user custom.
 * Includes template strings — used by the editor UI and GetPrompt handler.
 */
export function getPromptsWithTemplates() {
  const config = readPromptsConfig();
  const result = BUILTIN_PROMPT_DEFS.map(p => {
    const override = config.overrides?.[p.name];
    return override
      ? { ...p, ...override, isBuiltin: true, isModified: true }
      : { ...p,              isBuiltin: true, isModified: false };
  });
  for (const c of config.custom ?? []) {
    result.push({ ...c, isBuiltin: false, isModified: false });
  }
  return result;
}

/**
 * Returns the MCP-facing prompt list (no template text — only name/desc/args).
 */
export function getPrompts() {
  return getPromptsWithTemplates().map(({ template: _t, isBuiltin: _b, isModified: _m, ...rest }) => rest);
}

/** @deprecated — kept for call-site compatibility; use getPrompts() */
export const PROMPTS = BUILTIN_PROMPT_DEFS.map(({ template: _t, ...rest }) => rest);

// ── Render ──────────────────────────────────────────────────────────────────

export function renderPrompt(name, args = {}) {
  const def = getPromptsWithTemplates().find(p => p.name === name);
  if (!def) {
    return {
      description: name,
      messages: [{ role: 'user', content: { type: 'text', text: `Unknown prompt: ${name}` } }],
    };
  }
  return {
    description: def.description,
    messages: [{ role: 'user', content: { type: 'text', text: substituteTemplate(def.template, args) } }],
  };
}
