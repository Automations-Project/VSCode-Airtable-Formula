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
     { "name": "New Choice", "color": "blueLight2" }
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
