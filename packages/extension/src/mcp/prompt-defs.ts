/**
 * Built-in prompt definitions — mirrors packages/mcp-server/src/prompts.js.
 * Used by DashboardProvider to compute PromptsState without importing the
 * MCP server bundle at runtime.
 *
 * Keep in sync with prompts.js when adding or changing built-in prompts.
 */
import type { PromptDef } from '@airtable-formula/shared';

export const BUILTIN_PROMPT_DEFS: Omit<PromptDef, 'isBuiltin' | 'isModified'>[] = [
  {
    name: 'airtable-fix-formula',
    description: 'Debug and fix an Airtable formula error or unexpected result',
    arguments: [
      { name: 'formula',  description: 'The formula to fix',                          required: true  },
      { name: 'error',    description: 'Error message or symptom (e.g. #ERROR, NaN)', required: false },
      { name: 'appId',    description: 'Base ID (appXXX) to validate against',         required: false },
      { name: 'tableId',  description: 'Table ID (tblXXX) for field context',          required: false },
    ],
    template: [
      'You are an Airtable formula expert. Debug and fix the following formula.',
      '',
      '**Formula to fix:**',
      '```',
      '{formula}',
      '```',
      '',
      '**Reported error / symptom:** {error}',
      '',
      '**Available context (use when provided):**',
      '- Base ID: {appId}',
      '- Table ID: {tableId}',
      '',
      '**Steps:**',
      '1. Identify the root cause: syntax errors, wrong function names, type mismatches, unclosed parentheses, field names missing braces, smart/curly quotes, or division-by-zero without a guard.',
      '2. If Base ID and Table ID are provided above, call `list_fields` to verify the referenced field names exist and have the expected types.',
      '3. If Base ID is provided above, call `validate_formula` with the corrected formula to confirm it is syntactically valid before returning.',
      '4. Return the corrected formula and a brief explanation of what was wrong.',
      '',
      'Airtable formula rules: field references use curly braces `{Field Name}`, no `//` comments, always straight quotes `"`, safe division: `IF({Divisor}=0, BLANK(), {Value}/{Divisor})`.',
    ].join('\n'),
  },
  {
    name: 'airtable-create-formula',
    description: 'Create an Airtable formula from a plain-language description',
    arguments: [
      { name: 'description', description: 'What the formula should calculate or produce', required: true  },
      { name: 'appId',       description: 'Base ID (appXXX) to look up field names',      required: false },
      { name: 'tableId',     description: 'Table ID (tblXXX) to look up field names',     required: false },
    ],
    template: [
      'You are an Airtable formula expert. Create a formula that does the following:',
      '',
      '**Requirement:** {description}',
      '',
      '**Available context (use when provided):**',
      '- Base ID: {appId}',
      '- Table ID: {tableId}',
      '',
      '**Steps:**',
      '1. If Base ID and Table ID are provided above, call `list_fields` to discover available field names and their types. Use the exact field names from the schema.',
      '2. Draft the formula using correct Airtable syntax.',
      '3. Apply null-guards where values might be empty — e.g. `IF({Field}="", "", ...)`.',
      '4. If Base ID and Table ID are provided, call `validate_formula` to confirm the formula is valid and check its result type.',
      '5. Return the final formula with a brief explanation of how it works.',
      '',
      'Airtable formula rules: field references use curly braces `{Field Name}`, no `//` comments, always straight quotes `"`, safe division: `IF({Divisor}=0, BLANK(), {Value}/{Divisor})`, use `IF(ISERROR(expr), fallback, expr)` for error handling.',
    ].join('\n'),
  },
  {
    name: 'airtable-inspect-base',
    description: 'Explore and summarise the schema of an Airtable base',
    arguments: [
      { name: 'appId', description: 'Base ID to inspect (appXXX)', required: true },
    ],
    template: [
      'Inspect and summarise the Airtable base with ID: **{appId}**',
      '',
      '**Steps:**',
      '1. Call `list_tables` with appId="{appId}" to get an overview of all tables.',
      '2. Present a clear summary: table names, rough purpose (inferred from the name), and total table count.',
      '3. Ask the user if they want to drill into any specific table.',
      '4. For each table the user selects, call `get_table_schema` to show fields (name, type, and typeOptions for computed fields).',
      '5. Highlight any formula fields and offer to explain or improve them.',
    ].join('\n'),
  },
  {
    name: 'airtable-setup-view',
    description: 'Configure an Airtable view — filters, sorts, groups, and column order',
    arguments: [
      { name: 'appId',        description: 'Base ID (appXXX)',                  required: true  },
      { name: 'tableId',      description: 'Table ID (tblXXX)',                 required: true  },
      { name: 'requirements', description: 'What the view should show and how', required: false },
    ],
    template: [
      'Configure an Airtable view in base **{appId}**, table **{tableId}**.',
      '',
      '**Requirements:** {requirements}',
      '',
      '**Steps:**',
      '1. Call `list_views` with appId="{appId}", tableId="{tableId}" to see existing views.',
      '2. Call `list_fields` with appId="{appId}", tableId="{tableId}" to discover available fields and their IDs.',
      '3. Based on the requirements, decide whether to create a new view (`create_view`) or modify an existing one.',
      '4. Apply the necessary configuration:',
      '   - Filters: `update_view_filters`',
      '   - Sorts: `apply_view_sorts`',
      '   - Grouping: `update_view_group_levels`',
      '   - Column visibility + order: `set_view_columns` for a full reset; or `show_or_hide_view_columns` + sequential `move_visible_columns` calls for partial changes.',
      '5. For column ordering with `move_visible_columns`: make one call per column with incrementing `targetVisibleIndex` — the API ignores input array order.',
      '6. Confirm the changes with the user after each major step.',
    ].join('\n'),
  },
  {
    name: 'airtable-validate-formula',
    description: 'Validate an Airtable formula and show its result type',
    arguments: [
      { name: 'formula', description: 'Formula text to validate',    required: true  },
      { name: 'appId',   description: 'Base ID (appXXX)',            required: true  },
      { name: 'tableId', description: 'Table ID (tblXXX, optional)', required: false },
    ],
    template: [
      'Validate the following Airtable formula and report its result type.',
      '',
      '**Formula:**',
      '```',
      '{formula}',
      '```',
      '',
      'Call `validate_formula` with:',
      '- appId: "{appId}"',
      '- tableId: "{tableId}" (omit if blank)',
      '- formula: the formula text above',
      '',
      'Report whether the formula is valid, what result type it produces, and any issues found.',
      'If it is invalid, identify the error and suggest a corrected version.',
    ].join('\n'),
  },
];

export const BUILTIN_NAMES = new Set(BUILTIN_PROMPT_DEFS.map(p => p.name));
