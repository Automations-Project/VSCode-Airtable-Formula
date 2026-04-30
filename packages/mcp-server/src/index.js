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
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PKG_VERSION = require('../package.json').version;

const auth = new AirtableAuth();
const client = new AirtableClient(auth);
const toolConfig = new ToolConfigManager();

const server = new Server(
  {
    name: 'airtable-user-mcp',
    title: 'Airtable User MCP',
    version: PKG_VERSION,
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

OPERATORS by field type — verified against Airtable's internal API (2026-04-17 capture; user report 2026-04-30):
  Text / URL / Email / Phone:
    "=" (exact match — value: string)
    "!=" (not equal)
    "contains"            (value: string)
    "doesNotContain"
    "isEmpty" / "isNotEmpty" — input-side; auto-rewritten to "=" / "!=" "" before sending (the internal API rejects them on text fields with FAILED_STATE_CHECK)
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
  Formula / Lookup / Rollup (text result type):
    Same as Text. "isEmpty" / "isNotEmpty" are auto-rewritten to "=" / "!=" "".
  Linked record (foreignKey):
    "contains" (value: linked record name) works.
    "isEmpty" / "isNotEmpty" do NOT work — the call throws a clear error directing
    you to a helper formula like \`IF(LEN({Linked} & "")>0,"yes","")\` and a "=" / "!=" filter on that helper.

AUTO-NORMALIZATION (applied client-side before the request):
  - "is"            → "="     (the internal API does not recognize "is")
  - "isNot"         → "!="
  - "isAnyOf" with a single-element array or scalar value → "=" with scalar value
  - "isEmpty"       → "="  ""   on text / formula(text) / lookup(text) / rollup(text) fields
  - "isNotEmpty"    → "!=" ""   on text / formula(text) / lookup(text) / rollup(text) fields
  For single-select, value must be the choice ID (selXXX) — use get_base_schema to find IDs.

NESTING LIMIT:
  The internal API accepts at most 2 levels of nesting (top conjunction + one
  layer of nested groups). Deeper trees are rejected with FAILED_STATE_CHECK.
  Workaround: flatten by repeating shared conditions inside each leaf group,
  e.g. \`(A AND B) OR (A AND C)\` instead of \`A AND (B OR C)\` if you need
  another nested AND inside the OR. The error message returned by this tool
  flags depth-related failures explicitly.

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
    description: 'Reorder the fields (columns) displayed in a view. Accepts a partial map: pass only the field IDs you want to move, e.g. `{ "fldX": 1 }` to move fldX to position 1. Other fields keep their relative order. Index 0 is the leftmost position after the primary field. Internally the tool reads the view\'s current columnOrder, applies the moves, and sends the complete map (the underlying internal API rejects single-key inputs with FAILED_STATE_CHECK — user report 2026-04-30 §2.6).',
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
    description: 'Show or hide specific fields (columns) in a view. Pass an array of column IDs and a single visibility flag — every ID in the array is set to that visibility. To toggle many fields at once, send the full set in one call (no separate "show all" / "hide all" tool exists today; that lives in 2.4.0+).',
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

  // ── View Sections (sidebar grouping) ──
  {
    name: 'list_view_sections',
    description: 'List all sidebar sections for a table. Sections are user-organized groupings of views in the Airtable left sidebar (e.g. "🚀 Posting workflow", "🗑️ Sold workflow"). Returns each section\'s id, name, and the views inside it. The table-level `tableViewOrder` is a mixed list of view IDs and section IDs at the top level — when a view is inside a section, it appears in that section\'s `viewOrder`, NOT in the table\'s.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableIdOrName: { type: 'string', description: 'Table ID (preferred) or unambiguous table name' },
        debug: debugProp,
      },
      required: ['appId', 'tableIdOrName'],
    },
  },
  {
    name: 'create_view_section',
    description: 'Create a new sidebar section in a table. Returns the new section ID (vsc-prefixed). Use `move_view_to_section` to populate it with views.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID (tbl-prefixed)' },
        name: { type: 'string', description: 'Section name (emojis allowed, e.g. "🚀 Posting workflow")' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'name'],
    },
  },
  {
    name: 'rename_view_section',
    description: 'Rename a sidebar section.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        sectionId: { type: 'string', description: 'The section ID (vsc-prefixed)' },
        name: { type: 'string', description: 'New section name' },
        debug: debugProp,
      },
      required: ['appId', 'sectionId', 'name'],
    },
  },
  {
    name: 'delete_view_section',
    description: 'Delete a sidebar section. Views inside the section are NOT deleted — Airtable auto-promotes them to ungrouped at the table-level position the section used to occupy. Verified 2026-04-30.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        sectionId: { type: 'string', description: 'The section ID (vsc-prefixed)' },
        debug: debugProp,
      },
      required: ['appId', 'sectionId'],
    },
  },
  {
    name: 'move_view_to_section',
    description: `Move a view (or a section itself) within the sidebar. The single endpoint covers four user actions depending on the arguments:
  - viewId + sectionId         → put the view INTO that section at targetIndex
  - viewId + sectionId: null   → move the view OUT to ungrouped at table-level targetIndex
  - sectionId-as-viewIdOrSectionId + targetIndex → reorder the section among other sections
  - viewId + same section      → reorder the view within its current section
For section reorders, targetIndex is into the table's top-level mixed viewOrder; for in-section moves, it's into that section's viewOrder.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        tableId: { type: 'string', description: 'The table ID (tbl-prefixed)' },
        viewIdOrSectionId: { type: 'string', description: 'A view ID (viw...) or section ID (vsc...) to move' },
        targetIndex: { type: 'number', description: 'Destination index (0 = top). Per-section for in-section moves; per-table for section reorders.' },
        targetSectionId: { type: 'string', description: 'Optional vsc-prefixed section ID to move INTO. Omit (or pass null) to move the view to ungrouped.' },
        debug: debugProp,
      },
      required: ['appId', 'tableId', 'viewIdOrSectionId', 'targetIndex'],
    },
  },

  // ── View Columns (bulk visibility, ordering, freezing) ──
  {
    name: 'set_view_columns',
    description: 'One-shot view-column setup. Hides every column in the view, then shows only `visibleColumnIds` in the order given (left-to-right), then optionally sets the frozen-column divider. Use this to turn a brand-new view from "all 168 fields visible" into a curated layout in a single tool call.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID (viw-prefixed)' },
        visibleColumnIds: { type: 'array', items: { type: 'string' }, description: 'Field IDs to show, in left-to-right order. All other fields are hidden.' },
        frozenColumnCount: { type: 'number', description: 'Optional. If set, freezes this many columns from the left.' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'visibleColumnIds'],
    },
  },
  {
    name: 'show_or_hide_all_columns',
    description: 'Show or hide every column in a view in one call. Use `set_view_columns` for "hide all then show these specific ones" — this tool is the bulk all-or-nothing primitive.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        visibility: { type: 'boolean', description: 'true to show all, false to hide all' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'visibility'],
    },
  },
  {
    name: 'move_visible_columns',
    description: 'Move one or more columns to a new position in the *visible-only* index. Index 0 is the leftmost visible column. Distinct from `reorder_view_fields` (which writes the full overall order — visible + hidden) and `move_overall_columns` (which also operates on overall index but accepts a partial array of columns to move).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        columnIds: { type: 'array', items: { type: 'string' }, description: 'Field IDs to move (move them as a contiguous group starting at targetVisibleIndex)' },
        targetVisibleIndex: { type: 'number', description: 'Destination index in the visible-only column ordering (0 = leftmost visible)' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'columnIds', 'targetVisibleIndex'],
    },
  },
  {
    name: 'move_overall_columns',
    description: 'Move one or more columns to a new position in the *overall* index (visible + hidden). Sibling of `move_visible_columns`. Index 0 is the leftmost column in the underlying full order.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        columnIds: { type: 'array', items: { type: 'string' }, description: 'Field IDs to move' },
        targetOverallIndex: { type: 'number', description: 'Destination index in the overall (visible + hidden) ordering' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'columnIds', 'targetOverallIndex'],
    },
  },
  {
    name: 'update_frozen_column_count',
    description: 'Set the frozen-column divider position for a grid view. The first N columns from the left are frozen and stay visible during horizontal scroll.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        frozenColumnCount: { type: 'number', description: 'Number of columns to freeze (counted from the left). 0 unfreezes all.' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'frozenColumnCount'],
    },
  },

  // ── View Presentation (cover image, color rules, cell wrap) ──
  {
    name: 'set_view_cover',
    description: 'Set the cover-image field and crop/fit mode for Kanban or Gallery views. Pass `coverColumnId: null` to remove the cover. Either field can be passed independently — the other is left untouched.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        coverColumnId: { type: ['string', 'null'], description: 'Attachment field ID to use as cover (or null to remove)' },
        coverFitType: { type: 'string', enum: ['fit', 'crop'], description: 'How the cover image is displayed' },
        debug: debugProp,
      },
      required: ['appId', 'viewId'],
    },
  },
  {
    name: 'set_view_color_config',
    description: 'Apply a color config to a view (Kanban / Gallery / Calendar). Currently supports `type: "selectColumn"` — card colors are taken from a single-select field\'s choice colors. Other types (e.g. rule-based coloring) exist in Airtable\'s UI but their payload shapes have not been fully captured yet — passing an unknown type is forwarded as-is so callers can experiment.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        colorConfig: {
          type: 'object',
          description: 'Color config object. Verified shape: { type: "selectColumn", selectColumnId: "fld...", colorDefinitions: null }.',
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'colorConfig'],
    },
  },
  {
    name: 'set_view_cell_wrap',
    description: 'Toggle whether long cell values wrap (multi-line) or truncate (single-line with ellipsis).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The view ID' },
        shouldWrapCellValues: { type: 'boolean', description: 'true to wrap, false to truncate' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'shouldWrapCellValues'],
    },
  },

  // ── Calendar metadata ──
  {
    name: 'set_calendar_date_columns',
    description: 'Set the date-column ranges shown on a Calendar view. Each entry is either { startColumnId } for single-point events or { startColumnId, endColumnId } for range events. The array form lets a single calendar overlay multiple date series at once (e.g. "Created date" + "Start → End range" together).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The Calendar view ID' },
        dateColumnRanges: {
          type: 'array',
          description: 'Array of date-column-range entries.',
          items: {
            type: 'object',
            properties: {
              startColumnId: { type: 'string', description: 'Field ID of the (start) date column' },
              endColumnId: { type: 'string', description: 'Optional. Field ID for range end — turns the entry into a range event.' },
            },
            required: ['startColumnId'],
          },
        },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'dateColumnRanges'],
    },
  },

  // ── Form metadata (legacy form views only — Interfaces / "builder forms" are out of scope) ──
  {
    name: 'set_form_metadata',
    description: `Update one or more legacy-form-view metadata properties in a single call. Unset properties are not touched. Each property fans out to its own atomic Airtable endpoint.

Supported properties:
  description                       — intro text shown above the form
  afterSubmitMessage                — "thank you" text after submission
  redirectUrl                       — URL to redirect to after submit
  refreshAfterSubmit                — post-submit behavior (e.g. "REFRESH_BUTTON")
  shouldAllowRequestCopyOfResponse  — boolean: show "send me a copy" toggle to respondents
  shouldAttributeResponses          — boolean: track which user submitted (for signed-in respondents)
  isAirtableBrandingRemoved         — boolean: hide Airtable branding (paid plans only)

Note: "form title" is the view name itself — use rename_view to change it. "Field labels on the form" use a per-field endpoint that has not been captured yet.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The form view ID' },
        description: { type: 'string', description: 'Intro text shown above the form (omit to leave unchanged)' },
        afterSubmitMessage: { type: 'string', description: 'Confirmation text shown after submission' },
        redirectUrl: { type: 'string', description: 'URL to redirect to after submit' },
        refreshAfterSubmit: { type: 'string', description: 'Post-submit behavior (e.g. "REFRESH_BUTTON")' },
        shouldAllowRequestCopyOfResponse: { type: 'boolean', description: 'Allow respondents to request a copy of their submission' },
        shouldAttributeResponses: { type: 'boolean', description: 'Track which signed-in user submitted each response' },
        isAirtableBrandingRemoved: { type: 'boolean', description: 'Hide the Airtable branding on the form (paid plans)' },
        debug: debugProp,
      },
      required: ['appId', 'viewId'],
    },
  },
  {
    name: 'set_form_submission_notification',
    description: 'Toggle email-on-submit notifications for a specific user on a form view. Per-user, not per-form (separate from set_form_metadata).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'The Airtable base/application ID' },
        viewId: { type: 'string', description: 'The form view ID' },
        userId: { type: 'string', description: 'The Airtable user ID to enable/disable notifications for (usr-prefixed)' },
        shouldEnable: { type: 'boolean', description: 'true to send email-on-submit, false to stop' },
        debug: debugProp,
      },
      required: ['appId', 'viewId', 'userId', 'shouldEnable'],
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

  // ── View Sections ──

  async list_view_sections({ appId, tableIdOrName, debug }) {
    const result = await client.listViewSections(appId, tableIdOrName);
    return ok(result, result, debug);
  },

  async create_view_section({ appId, tableId, name, debug }) {
    const result = await client.createViewSection(appId, tableId, name);
    return ok({ created: true, sectionId: result.id, name: result.name, tableId }, result, debug);
  },

  async rename_view_section({ appId, sectionId, name, debug }) {
    const result = await client.renameViewSection(appId, sectionId, name);
    return ok({ updated: true, sectionId, name }, result, debug);
  },

  async delete_view_section({ appId, sectionId, debug }) {
    const result = await client.deleteViewSection(appId, sectionId);
    return ok({ deleted: true, sectionId, note: 'Contained views auto-promoted to ungrouped at the section\'s former position.' }, result, debug);
  },

  async move_view_to_section({ appId, tableId, viewIdOrSectionId, targetIndex, targetSectionId, debug }) {
    const result = await client.moveViewOrViewSection(
      appId, tableId, viewIdOrSectionId, targetIndex,
      targetSectionId === null || targetSectionId === undefined ? undefined : targetSectionId,
    );
    return ok({ updated: true, viewIdOrSectionId, targetIndex, targetSectionId: targetSectionId ?? null }, result, debug);
  },

  // ── View Columns (bulk) ──

  async set_view_columns({ appId, viewId, visibleColumnIds, frozenColumnCount, debug }) {
    const result = await client.setViewColumns(appId, viewId, { visibleColumnIds, frozenColumnCount });
    return ok(result, result, debug);
  },

  async show_or_hide_all_columns({ appId, viewId, visibility, debug }) {
    const result = await client.showOrHideAllColumns(appId, viewId, visibility);
    return ok({ updated: true, viewId, visibility: !!visibility }, result, debug);
  },

  async move_visible_columns({ appId, viewId, columnIds, targetVisibleIndex, debug }) {
    const result = await client.moveVisibleColumns(appId, viewId, columnIds, targetVisibleIndex);
    return ok({ updated: true, viewId, columnIds, targetVisibleIndex }, result, debug);
  },

  async move_overall_columns({ appId, viewId, columnIds, targetOverallIndex, debug }) {
    const result = await client.moveOverallColumns(appId, viewId, columnIds, targetOverallIndex);
    return ok({ updated: true, viewId, columnIds, targetOverallIndex }, result, debug);
  },

  async update_frozen_column_count({ appId, viewId, frozenColumnCount, debug }) {
    const result = await client.updateFrozenColumnCount(appId, viewId, frozenColumnCount);
    return ok({ updated: true, viewId, frozenColumnCount }, result, debug);
  },

  // ── View Presentation ──

  async set_view_cover({ appId, viewId, coverColumnId, coverFitType, debug }) {
    const result = await client.setViewCover(appId, viewId, { coverColumnId, coverFitType });
    return ok(result, result, debug);
  },

  async set_view_color_config({ appId, viewId, colorConfig, debug }) {
    const result = await client.setViewColorConfig(appId, viewId, colorConfig);
    return ok({ updated: true, viewId, colorConfig }, result, debug);
  },

  async set_view_cell_wrap({ appId, viewId, shouldWrapCellValues, debug }) {
    const result = await client.setViewCellWrap(appId, viewId, shouldWrapCellValues);
    return ok({ updated: true, viewId, shouldWrapCellValues: !!shouldWrapCellValues }, result, debug);
  },

  // ── Calendar ──

  async set_calendar_date_columns({ appId, viewId, dateColumnRanges, debug }) {
    const result = await client.setCalendarDateColumns(appId, viewId, dateColumnRanges);
    return ok({ updated: true, viewId, dateColumnRanges }, result, debug);
  },

  // ── Form metadata ──

  async set_form_metadata({ appId, viewId, debug, ...props }) {
    const result = await client.setFormMetadata(appId, viewId, props);
    return ok(result, result, debug);
  },

  async set_form_submission_notification({ appId, viewId, userId, shouldEnable, debug }) {
    const result = await client.setFormSubmissionNotification(appId, viewId, userId, shouldEnable);
    return ok({ updated: true, viewId, userId, shouldEnable: !!shouldEnable }, result, debug);
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

      case 'get_tool_status': {
        const status = toolConfig.getToolStatus();
        const disabledByCategory = {};
        for (const t of status) {
          if (!t.enabled) (disabledByCategory[t.category] ??= []).push(t.name);
        }
        return ok({
          activeProfile: toolConfig.activeProfile,
          tools: status,
          summary: {
            total: Object.keys(TOOL_CATEGORIES).length,
            enabled: toolConfig.enabledToolNames().size,
            disabledByCategory,
          },
          hint: Object.keys(disabledByCategory).length
            ? `${Object.values(disabledByCategory).flat().length} tool(s) are hidden. ` +
              `Use switch_profile (full = all tools) or toggle_category to enable them.`
            : 'All tools are enabled.',
        });
      }

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
  // Filter tools based on active profile, always include manage_tools.
  // Build a dynamic manage_tools description that names every tool currently
  // hidden by the active profile so an LLM that scans the listing can still
  // discover them (e.g. delete_table / delete_field / delete_view in
  // safe-write). Without this, hidden tools look "missing" — the actual
  // problem behind 2026-04-30 user report §1.2.
  const enabledTools = toolConfig.filterTools(TOOLS);
  const enabledNames = new Set(enabledTools.map(t => t.name));
  const hiddenByCategory = {};
  for (const [tool, cat] of Object.entries(TOOL_CATEGORIES)) {
    if (!enabledNames.has(tool)) {
      (hiddenByCategory[cat] ??= []).push(tool);
    }
  }
  const hiddenSummary = Object.entries(hiddenByCategory)
    .map(([cat, tools]) => `${cat}: ${tools.join(', ')}`)
    .join(' | ');
  const manageDef = {
    ...MANAGE_TOOLS_DEF,
    description: hiddenSummary
      ? `${MANAGE_TOOLS_DEF.description}\n\nActive profile: "${toolConfig.activeProfile}". ` +
        `Hidden by current profile (call get_tool_status to inspect, switch_profile or ` +
        `toggle_category to enable): ${hiddenSummary}.`
      : `${MANAGE_TOOLS_DEF.description}\n\nActive profile: "${toolConfig.activeProfile}" — all tools enabled.`,
  };
  return { tools: [...enabledTools, manageDef] };
});

// Cap on concurrent tool calls. All Airtable-bound calls funnel through the
// auth queue (single browser context), but an aggressive LLM loop can still
// queue thousands of requests and blow up memory. This limit rejects new calls
// cleanly when the backlog is saturated.
const _rawCap = Number(process.env.AIRTABLE_MAX_CONCURRENT_TOOLS);
// Clamp: a broken env var ("abc" → NaN, "0" → rejects all calls) must not
// break the server. Minimum of 1, sensible default of 16.
const MAX_CONCURRENT_TOOL_CALLS = Number.isFinite(_rawCap) && _rawCap >= 1 ? Math.floor(_rawCap) : 16;
let inflightToolCalls = 0;

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

  if (inflightToolCalls >= MAX_CONCURRENT_TOOL_CALLS) {
    return err(
      `Too many concurrent tool calls (${inflightToolCalls}/${MAX_CONCURRENT_TOOL_CALLS}). ` +
      `Retry after in-flight requests drain, or set AIRTABLE_MAX_CONCURRENT_TOOLS to raise the cap.`
    );
  }

  inflightToolCalls++;
  const traced = traceToolHandler(name, handler);
  try {
    return await traced(args || {});
  } catch (error) {
    return err(`Error in ${name}: ${error.message}`);
  } finally {
    inflightToolCalls--;
  }
});

// ─── Start & Shutdown ─────────────────────────────────────────

let activeTransport = null;

async function main() {
  await toolConfig.load();
  await toolConfig.startWatching();
  const enabledCount = toolConfig.enabledToolNames().size;
  const transport = new StdioServerTransport();
  activeTransport = transport;
  await server.connect(transport);
  console.error(`[airtable-user-mcp] Server v${PKG_VERSION} started`);
  console.error(`[airtable-user-mcp] Profile: "${toolConfig.activeProfile}" — ${enabledCount}/${TOOLS.length} tools enabled (+manage_tools)`);
  console.error('[airtable-user-mcp] Watching tools-config.json for external changes');
}

// ─── Graceful Shutdown ────────────────────────────────────────
// Host IDEs kill the MCP server abruptly; without bounded cleanup, headless
// Chromium children can leak on Windows and tools-config.json file watchers
// can keep the event loop alive past the signal.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[airtable-user-mcp] Received ${signal}, shutting down...`);

  // Hard cap so a hung browser can't block exit indefinitely
  const killSwitch = setTimeout(() => {
    console.error('[airtable-user-mcp] Shutdown timeout exceeded — force exit');
    process.exit(1);
  }, 5000);
  killSwitch.unref?.();

  try { toolConfig.stopWatching(); } catch (e) { console.error('[airtable-user-mcp] stopWatching failed:', e); }
  try { if (activeTransport?.close) await activeTransport.close(); } catch (e) { console.error('[airtable-user-mcp] transport.close failed:', e); }
  try { await auth.close(); } catch (e) { console.error('[airtable-user-mcp] auth.close failed:', e); }

  clearTimeout(killSwitch);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[airtable-user-mcp] Fatal:', err);
  process.exit(1);
});
