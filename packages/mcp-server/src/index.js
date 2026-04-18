#!/usr/bin/env node
import { runCli } from './cli.js';

// Handle CLI subcommands before starting the MCP server
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
  const handled = await runCli(cliArgs);
  if (handled) process.exit(process.exitCode || 0);
}

// Original MCP server code continues below...
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AirtableAuth } from './auth.js';
import { ToolConfigManager, TOOL_CATEGORIES, CATEGORY_LABELS, BUILTIN_PROFILES } from './tool-config.js';
import { AirtableClient } from './client.js';
import { ICON_DATA_URI } from './icon.js';
import { trace, traceToolHandler } from './debug-tracer.js';

const auth = new AirtableAuth();
const client = new AirtableClient(auth);
const toolConfig = new ToolConfigManager();

const server = new Server(
  {
    name: 'airtable-user-mcp',
    title: 'Airtable User MCP',
    version: '2.2.0',
    description:
      'Manage Airtable bases with 35+ tools: schema inspection, table CRUD, ' +
      'field CRUD (formula, rollup, lookup, count, url, dateTime, email, phone), ' +
      'view configuration (filters, sorts, grouping, visibility), formula validation, ' +
      'extension/block management, and tool profile control (read-only, safe-write, full, custom).',
    websiteUrl: 'https://github.com/Automations-Project/VSCode-Airtable-Formula/tree/main/packages/mcp-server',
    icons: [{ src: ICON_DATA_URI, mimeType: 'image/png', sizes: ['128x109'] }],
  },
  { capabilities: { tools: { listChanged: true } } }
);

toolConfig.bindServer(server);

// ─── Output Helpers ───────────────────────────────────────────

function ok(summary, debugData = null, debug = false) {
  const parts = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
  if (debug && debugData) {
    parts.push({ type: 'text', text: `\n--- DEBUG ---\n${JSON.stringify(debugData, null, 2)}` });
  }
  return { content: parts };
}

function err(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Tool Definitions ─────────────────────────────────────────

const debugProp = {
  type: 'boolean',
  description: 'When true, include raw Airtable response in output for diagnostics',
};

const TOOLS = [
  // ── Read Tools ──
  {
    name: 'get_base_schema',
    description: 'Get the full schema of an Airtable base including all tables, fields, and views.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID (e.g. "appXXX")' },
        debug: debugProp,
      },
      required: ['appId'],
    },
  },
  {
    name: 'list_tables',
    description: 'List all tables in an Airtable base with their IDs and names. Uses lightweight scaffolding data.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        debug: debugProp,
      },
      required: ['appId'],
    },
  },
  {
    name: 'get_table_schema',
    description: 'Get the full schema for a single table including all fields and views.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableIdOrName: { type: 'string', description: 'The table ID (e.g. "tblXXX") or exact table name' },
        debug: debugProp,
      },
      required: ['appId', 'tableIdOrName'],
    },
  },
  {
    name: 'list_fields',
    description: 'List all fields (columns) in a specific table of an Airtable base.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableIdOrName: { type: 'string', description: 'The table ID or name to list fields for' },
        debug: debugProp,
      },
      required: ['appId', 'tableIdOrName'],
    },
  },
  {
    name: 'list_views',
    description: 'List all views in a specific table with their IDs, names, and types.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableIdOrName: { type: 'string', description: 'The table ID or name' },
        debug: debugProp,
      },
      required: ['appId', 'tableIdOrName'],
    },
  },
  {
    name: 'get_view',
    description: `Read a view's live configuration from the base. Returns filters, sorts, groupLevels, columnOrder (rich per-column visibility + width), frozenColumnCount, colorConfig, metadata (view-type specific, e.g. gallery cover, calendar date field), rowHeight, description. Use this before update_view_filters / apply_view_sorts / update_view_group_levels to audit current state and choose between replace and append modes.

Data source: internally hits /v0.3/table/{tableId}/readData with includeDataForViewIds=[viewId]. The application/read endpoint alone does NOT return filter/sort/group state — that's why the update tools need either "append" mode or a prior get_view call to merge safely.

Fields:
  - filters: { filterSet: [...], conjunction: "and"|"or" } | null
  - sorts:   [{ id, columnId, ascending }] | null   (stored as lastSortsApplied internally)
  - groupLevels: [{ id, columnId, order, emptyGroupState }] | null
  - columnOrder: [{ columnId, visibility, width? }]
  - visibleColumnOrder: [columnId] — derived from columnOrder for convenience
  - metadata: type-specific config (gallery.coverColumnId, calendar.dateColumnId, etc.)`,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        debug: debugProp,
      },
      required: ['appId', 'viewId'],
    },
  },

  // ── Table Mutation Tools ──
  {
    name: 'create_table',
    description: 'Create a new table in an Airtable base. Returns the generated table ID. The table starts with default fields (Name, Notes, Attachments, Status, etc.) — use list_fields after creation to inspect them.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        name: { type: 'string', description: 'Name for the new table' },
        debug: debugProp,
      },
      required: ['appId', 'name'],
    },
  },
  {
    name: 'rename_table',
    description: 'Rename a table in an Airtable base.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID to rename (e.g. "tblXXX")' },
        newName: { type: 'string', description: 'The new name for the table' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'newName'],
    },
  },
  {
    name: 'delete_table',
    description: 'Delete a table from an Airtable base. Requires both tableId AND the expected table name as a safety guard — refuses to delete if the name does not match. Airtable rejects deleting the last remaining table in a base.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID to delete (e.g. "tblXXX")' },
        expectedName: {
          type: 'string',
          description: 'The expected name of the table. Must match exactly or deletion is refused.',
        },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'expectedName'],
    },
  },

  // ── Field Mutation Tools ──
  {
    name: 'create_field',
    description: `Create a new field in an Airtable table. Supports all field types including computed fields (formula, rollup, lookup, count) that are not available via the official API.

FIELD TYPES (fieldType parameter):
  Canonical (internal-API names):  "text", "multilineText", "number", "checkbox", "date", "singleSelect", "multipleSelects", "rating", "formula", "rollup", "lookup", "count"
  Friendly aliases (auto-normalized to internal shape):
    "url"       → type: "text" with typeOptions.validatorName = "url"
    "email"     → type: "text" with typeOptions.validatorName = "email"
    "phone" / "phoneNumber" → type: "text" with typeOptions.validatorName = "phoneNumber"
    "dateTime"  → type: "date" with typeOptions: { isDateTime: true, dateFormat, timeFormat, timeZone, shouldDisplayTimeZone }

TYPE OPTIONS by fieldType:
  formula:                { formulaText: "..." }
  rollup:                 { fieldIdInLinkedTable, recordLinkFieldId, resultType, referencedFieldIds }
  lookup:                 { recordLinkFieldId, fieldIdInLinkedTable }
  count:                  { recordLinkFieldId }
  number (integer):       { format: "integer", negative: false }
  number (currency):      { format: "currency", symbol: "$", precision: 2, negative: false }
  number (percent):       { format: "percentV2", precision: 2, negative: false }
  date / dateTime:        { dateFormat: "Local"|"us"|"european"|"iso"|"friendly", timeFormat: "12hour"|"24hour", timeZone: "UTC"|"client"|<IANA-tz>, shouldDisplayTimeZone: true|false, isDateTime: true (auto for dateTime) }
  singleSelect:           { choices: [{ name: "Option A", color: "blueLight2" }] }`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID to create the field in (e.g. "tblXXX")' },
        name: { type: 'string', description: 'Name for the new field' },
        fieldType: {
          type: 'string',
          description: 'The field type. Canonical or friendly alias — see tool description for full list.',
        },
        typeOptions: {
          type: 'object',
          description: 'Type-specific config. See tool description for shape per fieldType.',
        },
        description: { type: 'string', description: 'Optional field description' },
        insertAfterFieldId: {
          type: 'string',
          description: 'Optional: field ID to insert after. Omit to append at end.',
        },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'name', 'fieldType'],
    },
  },
  {
    name: 'create_formula_field',
    description: 'Create a new formula field in a table. Shorthand for create_field with type "formula".',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID (e.g. "tblXXX")' },
        name: { type: 'string', description: 'Name for the new formula field' },
        formulaText: { type: 'string', description: 'The formula expression' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'name', 'formulaText'],
    },
  },
  {
    name: 'validate_formula',
    description: 'Validate a formula expression before creating or updating a formula field. Returns whether the formula is valid and what result type it produces (text, number, etc). Use this before create/update to catch errors early.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID where the formula will be used' },
        formulaText: { type: 'string', description: 'The formula expression to validate' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'formulaText'],
    },
  },
  {
    name: 'update_field_config',
    description: 'Update the configuration of any computed field (formula, rollup, lookup, count, etc). Use this to change formula text, rollup settings, etc.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        fieldId: { type: 'string', description: 'The field/column ID (e.g. "fldXXX")' },
        fieldType: { type: 'string', description: 'The field type: "formula", "rollup", "lookup", "count"' },
        typeOptions: {
          type: 'object',
          description: 'Type-specific options. For formula: { formulaText: "..." }',
        },
        debug: debugProp,
      },
      required: ['appId', 'fieldId', 'fieldType', 'typeOptions'],
    },
  },
  {
    name: 'update_formula_field',
    description: 'Update the formula text of an existing formula field. Shorthand for update_field_config with type "formula".',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        fieldId: { type: 'string', description: 'The field/column ID (e.g. "fldXXX")' },
        formulaText: { type: 'string', description: 'The new formula text' },
        debug: debugProp,
      },
      required: ['appId', 'fieldId', 'formulaText'],
    },
  },
  {
    name: 'rename_field',
    description: 'Rename a field (column) in an Airtable table. Pre-validates the field exists before mutating.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        fieldId: { type: 'string', description: 'The field/column ID to rename' },
        newName: { type: 'string', description: 'The new name for the field' },
        debug: debugProp,
      },
      required: ['appId', 'fieldId', 'newName'],
    },
  },
  {
    name: 'delete_field',
    description: 'Delete a field from an Airtable table. Requires both fieldId AND the expected field name as a safety guard. First checks for downstream dependencies — if found, returns dependency info instead of deleting. Set force=true to delete even with dependencies.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        fieldId: { type: 'string', description: 'The field/column ID to delete (e.g. "fldXXX")' },
        expectedName: {
          type: 'string',
          description: 'The expected name of the field. Must match exactly or deletion is refused.',
        },
        force: {
          type: 'boolean',
          description: 'When true, delete even if the field has downstream dependencies (other fields referencing it). Default: false.',
        },
        debug: debugProp,
      },
      required: ['appId', 'fieldId', 'expectedName'],
    },
  },

  // ── View Tools ──
  {
    name: 'create_view',
    description: 'Create a new view in an Airtable table. Optionally copy configuration from an existing view. View types: "grid", "form", "kanban", "calendar", "gallery", "gantt", "levels" (list view).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID to create the view in' },
        name: { type: 'string', description: 'Name for the new view' },
        type: {
          type: 'string',
          description: 'View type: "grid", "form", "kanban", "calendar", "gallery", "gantt", "levels" (list). Default: "grid".',
        },
        copyFromViewId: {
          type: 'string',
          description: 'Optional: view ID to copy configuration from (creates a fresh view with same settings).',
        },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'name'],
    },
  },
  {
    name: 'duplicate_view',
    description: 'Duplicate an existing view with all its configuration (filters, sorts, field visibility, etc).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID the view belongs to' },
        sourceViewId: { type: 'string', description: 'The view ID to duplicate (e.g. "viwXXX")' },
        newName: { type: 'string', description: 'Name for the duplicated view' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'sourceViewId', 'newName'],
    },
  },
  {
    name: 'rename_view',
    description: 'Rename a view.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID to rename (e.g. "viwXXX")' },
        newName: { type: 'string', description: 'The new name for the view' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'newName'],
    },
  },
  {
    name: 'delete_view',
    description: 'Delete a view from a table. Cannot delete the last remaining view in a table.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID to delete (e.g. "viwXXX")' },
        debug: debugProp,
      },
      required: ['appId', 'viewId'],
    },
  },
  {
    name: 'update_view_description',
    description: 'Update the description text of a view.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        description: { type: 'string', description: 'The new description text. Use empty string to clear.' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'description'],
    },
  },
  {
    name: 'update_view_filters',
    description: `Update the filter configuration of a view. Supports AND/OR conjunctions, nested filter groups, and Airtable's internal filter operators.

FILTER FORMAT:
  Leaf filter:   { columnId: "fldXXX", operator: "<op>", value: <val> }
  Nested group:  { type: "nested", conjunction: "and"|"or", filterSet: [...] }
  Clear filters: { filterSet: [], conjunction: "and" }   (or pass filters: null)

Filter IDs (flt-prefixed) are auto-generated — do NOT include them.

OPERATORS by field type — verified against Airtable's internal API (2026-04-17 capture):
  Text / URL / Email / Phone:
    "=" (exact match — value: string)
    "!=" (not equal)
    "contains"            (value: string)
    "doesNotContain"
    "isEmpty" / "isNotEmpty" (no value)
  Number / Percent / Currency:
    "=", "!=", "<", ">", "<=", ">=", "isEmpty", "isNotEmpty"
  Single select:
    "=" (value: "selXXX" — the choice ID, NOT the choice name)
    "!="
    "isAnyOf" / "isNoneOf" (value: ["selXXX", "selYYY"] — array of choice IDs)
    "isEmpty" / "isNotEmpty"
  Multiple select:
    "hasAnyOf", "hasAllOf", "hasNoneOf", "isExactly", "isEmpty", "isNotEmpty"
  Checkbox:
    "=" (value: true|false)
  Date:
    "is", "isBefore", "isAfter", "isOnOrBefore", "isOnOrAfter", "isEmpty", "isNotEmpty"

AUTO-NORMALIZATION:
  - "is"     → "="     (applied automatically — the internal API does not recognize "is")
  - "isNot"  → "!="
  - "isAnyOf" with a single-element array or scalar value → "=" with scalar value
  For single-select, value must be the choice ID (selXXX) — use get_base_schema to find IDs.

EXAMPLES:
  Text equals:          { filterSet: [{ columnId: "fldXXX", operator: "=", value: "Prime" }], conjunction: "and" }
  SingleSelect equals:  { filterSet: [{ columnId: "fldXXX", operator: "=", value: "selABC123" }], conjunction: "and" }
  Text contains:        { filterSet: [{ columnId: "fldXXX", operator: "contains", value: "hello" }], conjunction: "and" }
  Number range:         { filterSet: [{ columnId: "fldX", operator: ">=", value: 10 }, { columnId: "fldX", operator: "<=", value: 100 }], conjunction: "and" }
  Nested (a AND (b OR c)): { filterSet: [{ columnId: "fldA", operator: "contains", value: "x" }, { type: "nested", conjunction: "or", filterSet: [{ columnId: "fldB", operator: "=", value: 1 }] }], conjunction: "and" }`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID to update filters on (e.g. "viwXXX")' },
        filters: {
          type: 'object',
          description: 'Filter configuration object with filterSet array and conjunction. See tool description for format and examples.',
          properties: {
            filterSet: {
              type: 'array',
              description: 'Array of filter conditions (leaf filters and/or nested groups)',
              items: { type: 'object' },
            },
            conjunction: {
              type: 'string',
              enum: ['and', 'or'],
              description: 'Logical conjunction between top-level filters',
            },
          },
          required: ['filterSet', 'conjunction'],
        },
        operation: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'How the given filters interact with existing filters. "replace" (default) overwrites; "append" adds the provided filterSet entries to the existing top-level filterSet (useful when you only want to add conditions without rewriting the whole filter payload).',
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'filters'],
    },
  },
  {
    name: 'reorder_view_fields',
    description: 'Reorder the fields (columns) displayed in a view. Provide a mapping of field IDs to their desired column index positions.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        fieldOrder: {
          type: 'object',
          description: 'Map of field IDs to target column indices: { "fldXXX": 0, "fldYYY": 1, "fldZZZ": 2 }. Index 0 is the leftmost position after the primary field.',
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'fieldOrder'],
    },
  },
  {
    name: 'show_or_hide_view_columns',
    description: 'Show or hide specific fields (columns) in a view. Unlike show_or_hide_all, this targets individual columns.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        columnIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of field IDs to show or hide',
        },
        visibility: { type: 'boolean', description: 'true to show, false to hide' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'columnIds', 'visibility'],
    },
  },
  {
    name: 'apply_view_sorts',
    description: 'Apply sort conditions to a view. Default mode replaces all existing sorts — pass an empty array with operation="replace" to clear. Use operation="append" to add new sorts on top of the view\'s existing sort stack without rewriting them.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        sorts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              columnId: { type: 'string', description: 'Field ID to sort by' },
              ascending: { type: 'boolean', description: 'true for A→Z / 1→9, false for Z→A / 9→1. Default: true' },
            },
            required: ['columnId'],
          },
          description: 'Array of sort conditions. Empty array [] clears all sorts when operation="replace".',
        },
        operation: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'How the given sorts interact with existing sorts. "replace" (default) overwrites; "append" adds the provided sorts after the existing sort stack (secondary priority).',
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'sorts'],
    },
  },
  {
    name: 'update_view_group_levels',
    description: 'Set grouping on a view. Default mode replaces all existing group levels — pass an empty array with operation="replace" to clear grouping. Use operation="append" to add new group levels below the existing ones without rewriting them.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        groupLevels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              columnId: { type: 'string', description: 'Field ID to group by' },
              order: { type: 'string', description: '"ascending" or "descending". Default: "ascending"' },
              emptyGroupState: { type: 'string', description: '"hidden" or "visible". Default: "hidden"' },
            },
            required: ['columnId'],
          },
          description: 'Array of group levels. Empty array [] clears grouping when operation="replace".',
        },
        operation: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'How the given groupLevels interact with existing ones. "replace" (default) overwrites; "append" adds the provided levels after the existing group stack.',
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'groupLevels'],
    },
  },
  {
    name: 'update_view_row_height',
    description: 'Change the row height of a grid view.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (e.g. "viwXXX")' },
        rowHeight: { type: 'string', description: 'Row height: "small", "medium", "large", or "xlarge"' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'rowHeight'],
    },
  },

  // ── Field Extra Tools ──
  {
    name: 'update_field_description',
    description: 'Update the description text of a field.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        fieldId: { type: 'string', description: 'The field/column ID (e.g. "fldXXX")' },
        description: { type: 'string', description: 'The new description text' },
        debug: debugProp,
      },
      required: ['appId', 'fieldId', 'description'],
    },
  },
  {
    name: 'duplicate_field',
    description: 'Duplicate (clone) a field in a table. Optionally also duplicate the cell values.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID' },
        sourceFieldId: { type: 'string', description: 'The field ID to duplicate' },
        duplicateCells: { type: 'boolean', description: 'Also copy cell values. Default: false' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'sourceFieldId'],
    },
  },

  // ── Extension/Block Tools ──
  {
    name: 'create_extension',
    description: 'Create a new extension (block) in an Airtable base. Returns the block ID needed for installation. Use this to register custom extensions before installing them.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        name: { type: 'string', description: 'Name for the extension' },
        releaseId: { type: 'string', description: 'The release ID of the extension (e.g. "blrXXX")' },
        debug: debugProp,
      },
      required: ['appId', 'name', 'releaseId'],
    },
  },
  {
    name: 'create_extension_dashboard',
    description: 'Create a new extension dashboard page in a base. Extensions are installed onto dashboard pages.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        name: { type: 'string', description: 'Name for the dashboard page' },
        debug: debugProp,
      },
      required: ['appId', 'name'],
    },
  },
  {
    name: 'install_extension',
    description: 'Install an extension onto a dashboard page. Requires a block ID (from create_extension) and a page ID (from create_extension_dashboard).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        blockId: { type: 'string', description: 'The block ID (e.g. "blkXXX")' },
        pageId: { type: 'string', description: 'The dashboard page ID (e.g. "bipXXX")' },
        name: { type: 'string', description: 'Display name for this installation' },
        debug: debugProp,
      },
      required: ['appId', 'blockId', 'pageId', 'name'],
    },
  },
  {
    name: 'update_extension_state',
    description: 'Enable or disable an extension installation.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        installationId: { type: 'string', description: 'The block installation ID (e.g. "bliXXX")' },
        state: { type: 'string', description: '"enabled" or "disabled"' },
        debug: debugProp,
      },
      required: ['appId', 'installationId', 'state'],
    },
  },
  {
    name: 'rename_extension',
    description: 'Rename an installed extension.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        installationId: { type: 'string', description: 'The block installation ID (e.g. "bliXXX")' },
        name: { type: 'string', description: 'New name for the extension' },
        debug: debugProp,
      },
      required: ['appId', 'installationId', 'name'],
    },
  },
  {
    name: 'duplicate_extension',
    description: 'Duplicate an installed extension on a dashboard page.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        sourceInstallationId: { type: 'string', description: 'The installation ID to duplicate' },
        pageId: { type: 'string', description: 'The dashboard page to place the duplicate on' },
        debug: debugProp,
      },
      required: ['appId', 'sourceInstallationId', 'pageId'],
    },
  },
  {
    name: 'remove_extension',
    description: 'Remove an installed extension from a dashboard.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        installationId: { type: 'string', description: 'The block installation ID to remove (e.g. "bliXXX")' },
        debug: debugProp,
      },
      required: ['appId', 'installationId'],
    },
  },
];

// ─── Meta-Tool: manage_tools ─────────────────────────────────

const MANAGE_TOOLS_DEF = {
  name: 'manage_tools',
  description:
    'Control which tools are available. Actions: list_profiles, switch_profile, ' +
    'get_tool_status, toggle_tool, toggle_category. Use this to switch between ' +
    'read-only, safe-write, full, or custom profiles, or enable/disable individual tools.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_profiles', 'switch_profile', 'get_tool_status', 'toggle_tool', 'toggle_category'],
        description: 'The action to perform',
      },
      profile: {
        type: 'string',
        description: 'Profile name for switch_profile action (read-only, safe-write, full, custom)',
      },
      tool: {
        type: 'string',
        description: 'Tool name for toggle_tool action',
      },
      category: {
        type: 'string',
        description: 'Category name for toggle_category action (read, table-write, table-destructive, field-write, field-destructive, view-write, view-destructive, extension)',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable (true) or disable (false) for toggle_tool / toggle_category actions',
      },
    },
    required: ['action'],
  },
};

// ─── Tool Router ──────────────────────────────────────────────

const handlers = {
  // ── Reads ──

  async get_base_schema({ appId, debug }) {
    const raw = await client.getApplicationData(appId);
    const tables = raw?.data?.tableSchemas || raw?.data?.tables || [];
    const summary = tables.map(t => ({
      id: t.id,
      name: t.name,
      fieldCount: (t.columns || t.fields || []).length,
      viewCount: (t.views || []).length,
      fields: (t.columns || t.fields || []).map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        typeOptions: f.typeOptions,
      })),
      views: (t.views || []).map(v => ({ id: v.id, name: v.name, type: v.type })),
    }));
    return ok(summary, raw, debug);
  },

  async list_tables({ appId, debug }) {
    const raw = await client.getScaffoldingData(appId);
    const tables = raw?.data?.tableSchemas || raw?.data?.tables || raw?.data?.tableOrder?.map(id => {
      const t = raw?.data?.tableDatas?.[id] || {};
      return { id, name: t.name || id };
    }) || [];
    const summary = tables.map(t => ({
      id: t.id,
      name: t.name,
    }));
    return ok(summary, raw, debug);
  },

  async get_table_schema({ appId, tableIdOrName, debug }) {
    const table = await client.resolveTable(appId, tableIdOrName);
    const summary = {
      id: table.id,
      name: table.name,
      fields: (table.columns || table.fields || []).map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        typeOptions: f.typeOptions,
      })),
      views: (table.views || []).map(v => ({ id: v.id, name: v.name, type: v.type })),
    };
    return ok(summary, table, debug);
  },

  async list_fields({ appId, tableIdOrName, debug }) {
    const table = await client.resolveTable(appId, tableIdOrName);
    const fields = (table.columns || table.fields || []).map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
      typeOptions: f.typeOptions,
    }));
    return ok(fields, table, debug);
  },

  async list_views({ appId, tableIdOrName, debug }) {
    const table = await client.resolveTable(appId, tableIdOrName);
    const views = (table.views || []).map(v => ({
      id: v.id,
      name: v.name,
      type: v.type,
    }));
    return ok(views, table, debug);
  },

  async get_view({ appId, viewId, debug }) {
    const result = await client.getView(appId, viewId);
    return ok(result, result, debug);
  },

  // ── Table Mutations ──

  async create_table({ appId, name, debug }) {
    const result = await client.createTable(appId, name);
    return ok(
      { created: true, tableId: result.tableId, name },
      result,
      debug,
    );
  },

  async rename_table({ appId, tableId, newName, debug }) {
    const result = await client.renameTable(appId, tableId, newName);
    return ok(
      { renamed: true, tableId, newName },
      result,
      debug,
    );
  },

  async delete_table({ appId, tableId, expectedName, debug }) {
    const result = await client.deleteTable(appId, tableId, expectedName);
    return ok(
      { deleted: true, tableId, name: expectedName },
      result,
      debug,
    );
  },

  // ── Field Mutations ──

  async create_field({ appId, tableId, name, fieldType, typeOptions, description, insertAfterFieldId, debug }) {
    const result = await client.createField(appId, tableId, {
      name,
      type: fieldType,
      typeOptions: typeOptions || {},
      description,
      insertAfterFieldId,
    });
    return ok(
      { created: true, fieldId: result.columnId, name, type: fieldType },
      result,
      debug,
    );
  },

  async create_formula_field({ appId, tableId, name, formulaText, debug }) {
    return handlers.create_field({
      appId, tableId, name,
      fieldType: 'formula',
      typeOptions: { formulaText },
      debug,
    });
  },

  async validate_formula({ appId, tableId, formulaText, debug }) {
    const result = await client.validateFormula(appId, tableId, formulaText);
    return ok(result, result, debug);
  },

  async update_field_config({ appId, fieldId, fieldType, typeOptions, debug }) {
    const result = await client.updateFieldConfig(appId, fieldId, {
      type: fieldType,
      typeOptions,
    });
    return ok(
      { updated: true, fieldId, type: fieldType },
      result,
      debug,
    );
  },

  async update_formula_field({ appId, fieldId, formulaText, debug }) {
    return handlers.update_field_config({
      appId, fieldId,
      fieldType: 'formula',
      typeOptions: { formulaText },
      debug,
    });
  },

  async rename_field({ appId, fieldId, newName, debug }) {
    const result = await client.renameField(appId, fieldId, newName);
    return ok(
      { renamed: true, fieldId, newName },
      result,
      debug,
    );
  },

  async delete_field({ appId, fieldId, expectedName, force, debug }) {
    const result = await client.deleteField(appId, fieldId, expectedName, { force: !!force });
    if (result.deleted) {
      return ok(
        { deleted: true, fieldId, name: expectedName, forced: result.forced || false },
        result,
        debug,
      );
    }
    // Has dependencies — return info for caller to decide
    return ok(result, result, debug);
  },

  // ── View Mutations ──

  async create_view({ appId, tableId, name, type, copyFromViewId, debug }) {
    const result = await client.createView(appId, tableId, {
      name,
      type: type || 'grid',
      copyFromViewId,
    });
    return ok(
      { created: true, viewId: result.viewId, name, type: type || 'grid' },
      result,
      debug,
    );
  },

  async duplicate_view({ appId, tableId, sourceViewId, newName, debug }) {
    const result = await client.duplicateView(appId, tableId, sourceViewId, newName);
    return ok(
      { duplicated: true, viewId: result.viewId, name: newName, sourceViewId },
      result,
      debug,
    );
  },

  async rename_view({ appId, viewId, newName, debug }) {
    const result = await client.renameView(appId, viewId, newName);
    return ok(
      { renamed: true, viewId, newName },
      result,
      debug,
    );
  },

  async delete_view({ appId, viewId, debug }) {
    const result = await client.deleteView(appId, viewId);
    return ok(
      { deleted: true, viewId },
      result,
      debug,
    );
  },

  async update_view_description({ appId, viewId, description, debug }) {
    const result = await client.updateViewDescription(appId, viewId, description);
    return ok(
      { updated: true, viewId },
      result,
      debug,
    );
  },

  async update_view_filters({ appId, viewId, filters, operation, debug }) {
    let effectiveFilters = filters;
    if (operation === 'append') {
      const current = await client.getView(appId, viewId);
      const existing = current.filters || { filterSet: [], conjunction: 'and' };
      const baseSet = Array.isArray(existing.filterSet) ? existing.filterSet : [];
      const addSet = Array.isArray(filters?.filterSet) ? filters.filterSet : [];
      effectiveFilters = {
        filterSet: [...baseSet, ...addSet],
        conjunction: filters?.conjunction || existing.conjunction || 'and',
      };
    }
    const result = await client.updateViewFilters(appId, viewId, effectiveFilters);
    return ok(
      { updated: true, viewId, operation: operation || 'replace', filterCount: Array.isArray(effectiveFilters?.filterSet) ? effectiveFilters.filterSet.length : 0 },
      result,
      debug,
    );
  },

  async reorder_view_fields({ appId, viewId, fieldOrder, debug }) {
    const result = await client.reorderViewFields(appId, viewId, fieldOrder);
    return ok(
      { reordered: true, viewId, fieldCount: Object.keys(fieldOrder).length },
      result,
      debug,
    );
  },

  async show_or_hide_view_columns({ appId, viewId, columnIds, visibility, debug }) {
    const result = await client.showOrHideColumns(appId, viewId, columnIds, visibility);
    return ok(
      { updated: true, viewId, columnIds, visibility },
      result,
      debug,
    );
  },

  async apply_view_sorts({ appId, viewId, sorts, operation, debug }) {
    let effectiveSorts = sorts;
    if (operation === 'append') {
      const current = await client.getView(appId, viewId);
      const existing = Array.isArray(current.sorts) ? current.sorts : [];
      effectiveSorts = [...existing, ...(Array.isArray(sorts) ? sorts : [])];
    }
    const result = await client.applySorts(appId, viewId, effectiveSorts);
    return ok(
      { updated: true, viewId, operation: operation || 'replace', sortCount: effectiveSorts.length },
      result,
      debug,
    );
  },

  async update_view_group_levels({ appId, viewId, groupLevels, operation, debug }) {
    let effectiveLevels = groupLevels;
    if (operation === 'append') {
      const current = await client.getView(appId, viewId);
      const existing = Array.isArray(current.groupLevels) ? current.groupLevels : [];
      effectiveLevels = [...existing, ...(Array.isArray(groupLevels) ? groupLevels : [])];
    }
    const result = await client.updateGroupLevels(appId, viewId, effectiveLevels);
    return ok(
      { updated: true, viewId, operation: operation || 'replace', groupCount: effectiveLevels.length },
      result,
      debug,
    );
  },

  async update_view_row_height({ appId, viewId, rowHeight, debug }) {
    const result = await client.updateRowHeight(appId, viewId, rowHeight);
    return ok(
      { updated: true, viewId, rowHeight },
      result,
      debug,
    );
  },

  // ── Field Extra ──

  async update_field_description({ appId, fieldId, description, debug }) {
    const result = await client.updateFieldDescription(appId, fieldId, description);
    return ok(
      { updated: true, fieldId },
      result,
      debug,
    );
  },

  async duplicate_field({ appId, tableId, sourceFieldId, duplicateCells, debug }) {
    const result = await client.duplicateField(appId, tableId, sourceFieldId, {
      duplicateCells: !!duplicateCells,
    });
    return ok(
      { duplicated: true, fieldId: result.columnId, sourceFieldId },
      result,
      debug,
    );
  },

  // ── Extensions ──

  async create_extension({ appId, name, releaseId, debug }) {
    const result = await client.createBlock(appId, name, releaseId);
    return ok(
      { created: true, blockId: result.blockId, name },
      result,
      debug,
    );
  },

  async create_extension_dashboard({ appId, name, debug }) {
    const result = await client.createBlockInstallationPage(appId, name);
    return ok(
      { created: true, pageId: result.pageId, name },
      result,
      debug,
    );
  },

  async install_extension({ appId, blockId, pageId, name, debug }) {
    const result = await client.installBlock(appId, blockId, pageId, name);
    return ok(
      { installed: true, installationId: result.installationId, blockId, pageId, name },
      result,
      debug,
    );
  },

  async update_extension_state({ appId, installationId, state, debug }) {
    const result = await client.updateBlockInstallationState(appId, installationId, state);
    return ok(
      { updated: true, installationId, state },
      result,
      debug,
    );
  },

  async rename_extension({ appId, installationId, name, debug }) {
    const result = await client.renameBlockInstallation(appId, installationId, name);
    return ok(
      { renamed: true, installationId, name },
      result,
      debug,
    );
  },

  async duplicate_extension({ appId, sourceInstallationId, pageId, debug }) {
    const result = await client.duplicateBlockInstallation(appId, sourceInstallationId, pageId);
    return ok(
      { duplicated: true, installationId: result.installationId, sourceInstallationId },
      result,
      debug,
    );
  },

  async remove_extension({ appId, installationId, debug }) {
    const result = await client.removeBlockInstallation(appId, installationId);
    return ok(
      { removed: true, installationId },
      result,
      debug,
    );
  },

  // ── Meta: Tool Management ──

  async manage_tools({ action, profile, tool, category, enabled }) {
    switch (action) {
      case 'list_profiles':
        return ok({
          activeProfile: toolConfig.activeProfile,
          profiles: toolConfig.listProfiles(),
          categories: CATEGORY_LABELS,
        });

      case 'switch_profile': {
        if (!profile) return err('Missing "profile" parameter');
        const result = await toolConfig.switchProfile(profile);
        const enabledCount = toolConfig.enabledToolNames().size;
        return ok({ ...result, enabledTools: enabledCount, totalTools: Object.keys(TOOL_CATEGORIES).length });
      }

      case 'get_tool_status':
        return ok({
          activeProfile: toolConfig.activeProfile,
          tools: toolConfig.getToolStatus(),
          summary: {
            total: Object.keys(TOOL_CATEGORIES).length,
            enabled: toolConfig.enabledToolNames().size,
          },
        });

      case 'toggle_tool': {
        if (!tool) return err('Missing "tool" parameter');
        if (enabled === undefined || enabled === null) return err('Missing "enabled" parameter (true/false)');
        const result = await toolConfig.toggleTool(tool, !!enabled);
        return ok(result);
      }

      case 'toggle_category': {
        if (!category) return err('Missing "category" parameter');
        if (enabled === undefined || enabled === null) return err('Missing "enabled" parameter (true/false)');
        const result = await toolConfig.toggleCategory(category, !!enabled);
        return ok(result);
      }

      default:
        return err(`Unknown action: "${action}". Use: list_profiles, switch_profile, get_tool_status, toggle_tool, toggle_category`);
    }
  },
};

// ─── Request Handlers ─────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Filter tools based on active profile, always include manage_tools
  const enabledTools = toolConfig.filterTools(TOOLS);
  return { tools: [...enabledTools, MANAGE_TOOLS_DEF] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // manage_tools is always accessible
  const handler = handlers[name];
  if (!handler) {
    return err(`Unknown tool: ${name}`);
  }

  // Block disabled tools at runtime (defense in depth)
  if (!toolConfig.isToolEnabled(name)) {
    return err(
      `Tool "${name}" is currently disabled. Active profile: "${toolConfig.activeProfile}". ` +
      `Use manage_tools to change profile or re-enable this tool.`
    );
  }

  const traced = traceToolHandler(name, handler);
  try {
    return await traced(args || {});
  } catch (error) {
    return err(`Error in ${name}: ${error.message}`);
  }
});

// ─── Start & Shutdown ─────────────────────────────────────────

async function main() {
  await toolConfig.load();
  await toolConfig.startWatching();
  const enabledCount = toolConfig.enabledToolNames().size;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[airtable-user-mcp] Server v2.2.0 started');
  console.error(`[airtable-user-mcp] Profile: "${toolConfig.activeProfile}" — ${enabledCount}/${TOOLS.length} tools enabled (+manage_tools)`);
  console.error('[airtable-user-mcp] Watching tools-config.json for external changes');
}

process.on('SIGINT', async () => {
  toolConfig.stopWatching();
  await auth.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  toolConfig.stopWatching();
  await auth.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[airtable-user-mcp] Fatal:', err);
  process.exit(1);
});
