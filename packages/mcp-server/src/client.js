import { SchemaCache } from './cache.js';
import { randomBytes } from 'node:crypto';

/**
 * Generate an Airtable-style filter ID: "flt" + 14 base62 characters.
 * Airtable's internal API requires every filter object (leaf and nested group)
 * to carry a unique `id` field with this format.
 */
function generateFilterId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(14);
  let id = 'flt';
  for (let i = 0; i < 14; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

/**
 * Recursively inject missing `id` fields into a filterSet array.
 * Handles leaf filters ({ columnId, operator, value }) and
 * nested groups ({ type: "nested", conjunction, filterSet: [...] }).
 */
function ensureFilterIds(filterSet) {
  if (!Array.isArray(filterSet)) return filterSet;
  return filterSet.map(filter => {
    const f = { ...filter };
    if (!f.id) f.id = generateFilterId();
    if (f.type === 'nested' && Array.isArray(f.filterSet)) {
      f.filterSet = ensureFilterIds(f.filterSet);
    }
    return f;
  });
}

/**
 * Map user-friendly operator names to Airtable internal API operators.
 * Verified against captured UI traffic (2026-04-17): for text and singleSelect
 * fields, the UI sends "=" / "!=" — not "is" / "isNot" / "isAnyOf".
 *
 * Leaves nested groups and already-correct operators untouched.
 */
function normalizeFilterOperator(op) {
  if (op === 'is') return '=';
  if (op === 'isNot') return '!=';
  return op;
}

/**
 * Walk the filterSet and throw a descriptive Error if any leaf filter uses
 * `isEmpty` / `isNotEmpty` against a linked-record (foreignKey) field. The
 * internal API rejects those operators on foreignKey with `422 FAILED_STATE_CHECK`
 * and no workaround is available client-side beyond a transitive helper formula.
 */
function assertNoForeignKeyEmptiness(filterSet, fieldsById) {
  if (!Array.isArray(filterSet)) return;
  for (const filter of filterSet) {
    if (filter.type === 'nested' && Array.isArray(filter.filterSet)) {
      assertNoForeignKeyEmptiness(filter.filterSet, fieldsById);
      continue;
    }
    const op = filter.operator;
    if (op !== 'isEmpty' && op !== 'isNotEmpty') continue;
    const field = fieldsById[filter.columnId];
    if (field?.type === 'foreignKey') {
      throw new Error(
        `Airtable's internal API does not support "${op}" on linked-record fields ` +
        `(field "${field.name || filter.columnId}", id ${filter.columnId}). ` +
        `Workaround: create a helper formula field (e.g. \`IF(LEN({Linked} & "")>0,"yes","")\`) ` +
        `and filter on that helper with "=" / "!=".`,
      );
    }
  }
}

/**
 * Build a more useful Error for a failed filter mutation. Airtable returns
 * `{"error": {"type": "FAILED_STATE_CHECK"}}` with no further detail — we
 * inspect the just-sent payload to surface the most likely culprit
 * (operator/field-type mismatch, nesting depth, etc.) and attach the upstream
 * status + body so callers can still see the raw response.
 */
function enrichFilterError(status, body, payload) {
  let parsed;
  try { parsed = body ? JSON.parse(body) : null; } catch { /* keep raw */ }
  const errType = parsed?.error?.type;
  const reasons = [];
  const filterSet = payload?.filterSet;
  if (Array.isArray(filterSet)) {
    const depth = nestingDepth(filterSet);
    if (depth > 2) {
      reasons.push(
        `Nested filter depth is ${depth}; the internal API only accepts up to 2 ` +
        `(top conjunction + one nested layer). Flatten by repeating shared conditions ` +
        `inside each leaf group (user report 2026-04-30 §2.4).`,
      );
    }
    walkLeaves(filterSet, leaf => {
      if (leaf.operator === 'isEmpty' || leaf.operator === 'isNotEmpty') {
        reasons.push(
          `Leaf filter uses "${leaf.operator}" on field ${leaf.columnId}. If this is a ` +
          `linked-record / lookup / rollup field, the internal API may reject it; ` +
          `text and formula(text) fields are auto-rewritten to "=" / "!=" "" by this client.`,
        );
      }
    });
  }
  const summary = reasons.length
    ? `\n  Likely causes:\n    - ${reasons.join('\n    - ')}`
    : '';
  return new Error(
    `updateViewFilters failed (${status}${errType ? ' ' + errType : ''}): ${body || '(empty body)'}` + summary,
  );
}

function nestingDepth(filterSet, current = 1) {
  if (!Array.isArray(filterSet)) return current;
  let max = current;
  for (const f of filterSet) {
    if (f.type === 'nested' && Array.isArray(f.filterSet)) {
      max = Math.max(max, nestingDepth(f.filterSet, current + 1));
    }
  }
  return max;
}

/**
 * Merge a partial fieldId → targetPosition map with the current ordered field
 * list and return a complete `fieldId → finalPosition` map covering every
 * field in `currentOrder`. Moved fields are applied in ascending target-order
 * so multiple moves with overlapping positions resolve deterministically.
 */
function mergePartialFieldOrder(currentOrder, partial) {
  // Strip the moved fields from a working copy of the current order, then
  // splice them in at their target positions in priority order.
  const movedIds = Object.keys(partial).filter(id => currentOrder.includes(id));
  const remaining = currentOrder.filter(id => !movedIds.includes(id));
  const moves = movedIds
    .map(id => ({ id, target: Number(partial[id]) }))
    .filter(m => Number.isFinite(m.target))
    .sort((a, b) => a.target - b.target);

  const result = remaining.slice();
  for (const { id, target } of moves) {
    const insertAt = Math.max(0, Math.min(target, result.length));
    result.splice(insertAt, 0, id);
  }
  const indices = {};
  for (let i = 0; i < result.length; i++) indices[result[i]] = i;
  return indices;
}

function walkLeaves(filterSet, fn) {
  if (!Array.isArray(filterSet)) return;
  for (const f of filterSet) {
    if (f.type === 'nested' && Array.isArray(f.filterSet)) walkLeaves(f.filterSet, fn);
    else if (f.columnId) fn(f);
  }
}

/**
 * Field types where Airtable's internal filter API rejects `isEmpty` / `isNotEmpty`
 * with `422 FAILED_STATE_CHECK` even though docs claim support. For these we
 * rewrite to `=` / `!=` against the empty string, which the UI uses internally
 * for the same semantics. Verified against capture 2026-04-17 + user report
 * 2026-04-30 (MCP_FEATURE_REQUESTS — §2.1 text, §2.2 formula(text)).
 */
const EMPTINESS_REWRITE_TYPES = new Set(['text', 'formula', 'lookup', 'rollup']);

function isTextResultType(field) {
  if (!field) return false;
  if (field.type === 'text') return true;
  // Formula / lookup / rollup expose their cell result type via typeOptions.resultType
  // (verified 2026-04-17). When unknown we still try the rewrite — if the result
  // is numeric, Airtable accepts `=` `""` semantically as "is empty" too.
  const result = field?.typeOptions?.resultType;
  if (EMPTINESS_REWRITE_TYPES.has(field.type)) return result === undefined || result === 'text';
  return false;
}

/**
 * Type-aware second pass: walk the filterSet (post static normalization) and
 * rewrite `isEmpty` / `isNotEmpty` to the equivalent `=`/`!=` `""` form on
 * field types where the internal API rejects the documented operators.
 *
 * `fieldsById` is a `{ [fieldId]: { type, typeOptions } }` map — built once
 * by the caller from the table schema.
 */
function normalizeEmptinessByFieldType(filterSet, fieldsById) {
  if (!Array.isArray(filterSet)) return filterSet;
  return filterSet.map(filter => {
    if (filter.type === 'nested' && Array.isArray(filter.filterSet)) {
      return { ...filter, filterSet: normalizeEmptinessByFieldType(filter.filterSet, fieldsById) };
    }
    if (!filter.operator || !filter.columnId) return filter;
    const field = fieldsById[filter.columnId];
    if (!field || !isTextResultType(field)) return filter;
    if (filter.operator === 'isEmpty') {
      return { ...filter, operator: '=', value: '' };
    }
    if (filter.operator === 'isNotEmpty') {
      return { ...filter, operator: '!=', value: '' };
    }
    return filter;
  });
}

function normalizeFilterSet(filterSet) {
  if (!Array.isArray(filterSet)) return filterSet;
  return filterSet.map(filter => {
    if (filter.type === 'nested' && Array.isArray(filter.filterSet)) {
      return { ...filter, filterSet: normalizeFilterSet(filter.filterSet) };
    }
    if (!filter.operator) return filter;
    const next = { ...filter, operator: normalizeFilterOperator(filter.operator) };
    // isAnyOf with a single scalar or single-element array collapses to "=" with scalar value
    if (filter.operator === 'isAnyOf' && filter.value !== undefined) {
      if (Array.isArray(filter.value) && filter.value.length === 1) {
        next.operator = '=';
        next.value = filter.value[0];
      } else if (!Array.isArray(filter.value)) {
        next.operator = '=';
      }
    }
    return next;
  });
}

/**
 * Normalize user-friendly field types to Airtable's internal API shape.
 * Verified against captured UI traffic (2026-04-17):
 *   URL      → type: "text",  typeOptions: { validatorName: "url" }
 *   Email    → type: "text",  typeOptions: { validatorName: "email" }
 *   Phone    → type: "text",  typeOptions: { validatorName: "phoneNumber" }
 *   DateTime → type: "date",  typeOptions: { isDateTime: true, dateFormat, timeFormat, timeZone, shouldDisplayTimeZone }
 *             Note: dateFormat/timeFormat are FLAT STRINGS ("Local", "24hour"), not { name: "..." } as in the public REST API.
 *
 * Users who pass the canonical internal type ("text" / "date") get their typeOptions passed through.
 */
function normalizeFieldType(type, typeOptions = {}) {
  const opts = typeOptions || {};

  if (type === 'url' || type === 'URL') {
    return { type: 'text', typeOptions: { validatorName: 'url', ...opts } };
  }
  if (type === 'email' || type === 'Email') {
    return { type: 'text', typeOptions: { validatorName: 'email', ...opts } };
  }
  if (type === 'phone' || type === 'phoneNumber' || type === 'Phone') {
    return { type: 'text', typeOptions: { validatorName: 'phoneNumber', ...opts } };
  }
  if (type === 'dateTime' || type === 'datetime' || type === 'DateTime') {
    return {
      type: 'date',
      typeOptions: {
        isDateTime: true,
        dateFormat: flattenFormatOption(opts.dateFormat, 'Local'),
        timeFormat: flattenFormatOption(opts.timeFormat, '24hour'),
        timeZone: opts.timeZone || 'UTC',
        shouldDisplayTimeZone: opts.shouldDisplayTimeZone !== undefined ? opts.shouldDisplayTimeZone : true,
      },
    };
  }
  // date type — if isDateTime is true, normalize format options the same way
  if (type === 'date' && opts.isDateTime) {
    return {
      type: 'date',
      typeOptions: {
        ...opts,
        dateFormat: flattenFormatOption(opts.dateFormat, 'Local'),
        timeFormat: flattenFormatOption(opts.timeFormat, '24hour'),
      },
    };
  }
  return { type, typeOptions: opts };
}

/** Accept either "Local"/"iso"/"friendly" (flat string, what internal API expects)
 *  or the public REST shape { name: "iso" } and flatten. */
function flattenFormatOption(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.name === 'string') return value.name;
  return fallback;
}

/**
 * Summarize the dependency graph returned by a failed delete_field check.
 * Airtable returns `applicationDependencyGraphEdgesBySourceObjectId` which can
 * be hundreds of KB. Compress it to a usable list per consumer type.
 */
function summarizeFieldDependencies(details, fieldId) {
  const edges = details?.applicationDependencyGraphEdgesBySourceObjectId?.[fieldId];
  if (!Array.isArray(edges)) {
    // Unknown shape — return a compact stub so callers can still act
    return { edgeCount: 0, viewGroupings: [], viewSorts: [], viewFilters: [], fields: [], other: [] };
  }
  const viewGroupings = [];
  const viewSorts = [];
  const viewFilters = [];
  const fields = [];
  const other = [];
  for (const edge of edges) {
    const kind = edge?.dependencyType || edge?.edgeType || edge?.type || 'unknown';
    const target = edge?.targetObjectId || edge?.objectId || null;
    const entry = { targetObjectId: target, dependencyType: kind };
    if (target && target.startsWith('viw')) {
      if (/group/i.test(kind)) viewGroupings.push(entry);
      else if (/sort/i.test(kind)) viewSorts.push(entry);
      else if (/filter/i.test(kind)) viewFilters.push(entry);
      else other.push(entry);
    } else if (target && target.startsWith('fld')) {
      fields.push(entry);
    } else {
      other.push(entry);
    }
  }
  return {
    edgeCount: edges.length,
    viewGroupings,
    viewSorts,
    viewFilters,
    fields,
    other,
  };
}

/**
 * Airtable Internal API Client.
 *
 * Endpoint names verified against real captured traffic (2026-03-20):
 *   column/{id}/create       — create field (form-encoded, secretSocketId)
 *   column/{id}/destroy      — delete field (NOT /delete)
 *   column/{id}/updateConfig — update field config (flat payload, NOT wrapped in config)
 *   column/{id}/updateName   — rename field (NOT /rename)
 *   view/{id}/create         — create view
 *   view/{id}/updateFilters  — update view filters
 *   view/{id}/showOrHideAllColumns — toggle all columns visibility
 *   table/{id}/getUnsavedColumnConfigResultType — validate formula before saving
 */

/** Valid Airtable ID format: 3-letter prefix + alphanumeric. Prevents path traversal. */
const AIRTABLE_ID_RE = /^[a-z]{3}[A-Za-z0-9]+$/;

function assertAirtableId(id, label = 'id') {
  if (typeof id !== 'string' || !AIRTABLE_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}: "${id}". Expected an Airtable-style ID (e.g., appXXX, tblXXX, fldXXX).`);
  }
}

export class AirtableClient {
  constructor(auth) {
    this.auth = auth;
    this.cache = new SchemaCache();
  }

  // ─── Read Operations ──────────────────────────────────────────

  async getApplicationData(appId) {
    assertAirtableId(appId, 'appId');
    const cached = this.cache.getFull(appId);
    if (cached) return cached;

    const params = new URLSearchParams({
      stringifiedObjectParams: JSON.stringify({
        includeDataForTableIds: null,
        includeDataForViewIds: null,
        shouldIncludeSchemaChecksum: false,
      }),
      requestId: this._genRequestId(),
    });
    const url = `https://airtable.com/v0.3/application/${appId}/read?${params}`;
    const res = await this.auth.get(url, appId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getApplicationData failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    this.cache.setFull(appId, data);
    return data;
  }

  async getScaffoldingData(appId) {
    assertAirtableId(appId, 'appId');
    const cached = this.cache.getScaffolding(appId);
    if (cached) return cached;

    const url = `https://airtable.com/v0.3/${appId}/getApplicationScaffoldingData`;
    const res = await this.auth.get(url, appId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getScaffoldingData failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    this.cache.setScaffolding(appId, data);
    return data;
  }

  async getUserProperties() {
    const res = await this.auth.get('https://airtable.com/v0.3/getUserProperties');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getUserProperties failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  // ─── Schema Resolution Helpers ────────────────────────────────

  async resolveTable(appId, tableIdOrName) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];

    // Exact ID match is always unambiguous.
    const byId = tables.find(t => t.id === tableIdOrName);
    if (byId) return byId;

    // Name lookup: collect all matches and reject ambiguous results instead
    // of silently returning the first one.
    const byName = tables.filter(t => t.name === tableIdOrName);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      const matches = byName.map(t => `${t.name} (${t.id})`).join(', ');
      throw new Error(
        `Ambiguous table name "${tableIdOrName}" \u2014 ${byName.length} tables share this name: ${matches}. ` +
        `Use the table ID to disambiguate.`
      );
    }

    const available = tables.map(t => `${t.name} (${t.id})`).join(', ');
    throw new Error(`Table "${tableIdOrName}" not found. Available: ${available}`);
  }

  async resolveField(appId, fieldId) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];
    // Field IDs are globally unique within a base, so an ID-based lookup can't
    // be ambiguous. Return the first (and only) match.
    for (const table of tables) {
      const fields = table.columns || table.fields || [];
      const field = fields.find(f => f.id === fieldId);
      if (field) return { field, table };
    }
    throw new Error(`Field "${fieldId}" not found in any table of app ${appId}`);
  }

  // ─── Mutation Helpers ─────────────────────────────────────────

  /**
   * Build standard mutation params with stringifiedObjectParams,
   * requestId, and secretSocketId (when available).
   */
  _mutationParams(payload, appId) {
    const params = {
      stringifiedObjectParams: JSON.stringify(payload),
      requestId: this._genRequestId(),
    };
    const socketId = this.auth.getSecretSocketId(appId);
    if (socketId) {
      params.secretSocketId = socketId;
    }
    return params;
  }

  // ─── Field Mutations ──────────────────────────────────────────

  /**
   * Create a new field in a table.
   * Verified payload shape: { tableId, name, config: { type, typeOptions }, description?, activeViewId?, afterOverallColumnIndex?, origin? }
   */
  async createField(appId, tableId, fieldConfig) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    const columnId = 'fld' + this._genRandomId();
    const url = `https://airtable.com/v0.3/column/${columnId}/create`;

    const normalized = normalizeFieldType(fieldConfig.type, fieldConfig.typeOptions);

    const payload = {
      tableId,
      name: fieldConfig.name,
      config: {
        type: normalized.type,
        typeOptions: normalized.typeOptions,
      },
    };

    if (fieldConfig.description) {
      payload.description = fieldConfig.description;
    }
    if (fieldConfig.insertAfterFieldId) {
      payload.afterOverallColumnIndex = fieldConfig.insertAfterFieldId;
    }

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createField failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { columnId, ...data };
  }

  /**
   * Update the configuration of an existing field.
   * Verified payload shape: FLAT { type, typeOptions, schemaDependenciesCheckParams? }
   * NOT wrapped in { config: ... } — that's only for create.
   */
  async updateFieldConfig(appId, columnId, config) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(columnId, 'columnId');
    await this.resolveField(appId, columnId);

    const url = `https://airtable.com/v0.3/column/${columnId}/updateConfig`;

    const normalized = normalizeFieldType(config.type, config.typeOptions);

    // Flat payload — matches real Airtable requests
    const payload = {
      type: normalized.type,
      typeOptions: normalized.typeOptions,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateFieldConfig failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Rename a field.
   * Real endpoint: /v0.3/column/{id}/updateName (NOT /rename)
   * Payload: { name: "new name" }
   */
  async renameField(appId, columnId, newName) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(columnId, 'columnId');
    const { field } = await this.resolveField(appId, columnId);
    if (field.name === newName) {
      return { message: 'Field already has this name', fieldId: columnId, name: newName };
    }

    const url = `https://airtable.com/v0.3/column/${columnId}/updateName`;
    const res = await this.auth.postForm(url, this._mutationParams({ name: newName }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`renameField failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Delete a field. Two-step process matching real Airtable behavior:
   *   1. POST /column/{id}/destroy with { checkSchemaDependencies: true }
   *      → If 422 SCHEMA_DEPENDENCIES_VALIDATION_FAILED, there are downstream deps.
   *        We return the dependency info so the caller can decide.
   *      → If 200, field was deleted (no deps).
   *   2. If deps existed and force=true, POST /column/{id}/destroy with {} to force delete.
   *
   * Requires expectedName as safety guard.
   */
  async deleteField(appId, fieldId, expectedName, { force = false } = {}) {
    const { field } = await this.resolveField(appId, fieldId);

    if (field.name !== expectedName) {
      throw new Error(
        `Safety check failed: field ${fieldId} is named "${field.name}" but expectedName was "${expectedName}". ` +
        `Refusing to delete to prevent accidental data loss.`
      );
    }

    const url = `https://airtable.com/v0.3/column/${fieldId}/destroy`;

    // Step 1: Check dependencies
    const checkRes = await this.auth.postForm(
      url,
      this._mutationParams({ checkSchemaDependencies: true }, appId),
      appId,
    );

    if (checkRes.ok) {
      // No dependencies, deleted successfully
      this.cache.invalidate(appId);
      const data = await checkRes.json().catch(() => ({}));
      return { deleted: true, fieldId, name: expectedName, ...data };
    }

    // Check if it's a dependency error
    const checkBody = await checkRes.json().catch(() => null);
    const isDependencyError = checkBody?.error?.type === 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED';

    if (!isDependencyError) {
      throw new Error(`deleteField failed (${checkRes.status}): ${JSON.stringify(checkBody)}`);
    }

    if (!force) {
      // Return a summarized dep list so callers can read the response without
      // wading through hundreds of KB of graph JSON. Full graph still available
      // via the MCP tool's debug mode.
      const summary = summarizeFieldDependencies(checkBody.error.details, fieldId);
      return {
        deleted: false,
        fieldId,
        name: expectedName,
        hasDependencies: true,
        dependencies: summary,
        rawDependencyGraph: checkBody.error.details,
        message: 'Field has downstream dependencies. Set force=true to delete anyway.',
      };
    }

    // Step 2: Force delete (no dependency check)
    const forceRes = await this.auth.postForm(
      url,
      this._mutationParams({}, appId),
      appId,
    );

    if (!forceRes.ok) {
      const errBody = await forceRes.text().catch(() => '');
      throw new Error(`deleteField force failed (${forceRes.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await forceRes.json().catch(() => ({}));
    return { deleted: true, fieldId, name: expectedName, forced: true, ...data };
  }

  // ─── Formula Validation ───────────────────────────────────────

  /**
   * Validate a formula before saving it.
   * Uses: POST /v0.3/table/{tableId}/getUnsavedColumnConfigResultType
   * Returns { pass: boolean, resultType: string } or error details.
   */
  async validateFormula(appId, tableId, formulaText) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    const url = `https://airtable.com/v0.3/table/${tableId}/getUnsavedColumnConfigResultType`;
    const payload = {
      config: {
        default: null,
        type: 'formula',
        typeOptions: { formulaText },
      },
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        valid: false,
        error: data?.error?.type || `HTTP ${res.status}`,
        message: data?.error?.message || 'Formula validation failed',
      };
    }

    return {
      valid: data?.data?.pass === true,
      resultType: data?.data?.resultType || null,
    };
  }

  // ─── Table Mutations ──────────────────────────────────────────

  /**
   * Create a new table in a base.
   * Verified (2026-04-17): POST /v0.3/table/{newTblId}/create
   * Payload: { applicationId, name }
   */
  async createTable(appId, name) {
    assertAirtableId(appId, 'appId');
    const tableId = 'tbl' + this._genRandomId();
    const url = `https://airtable.com/v0.3/table/${tableId}/create`;

    const payload = { applicationId: appId, name };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createTable failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { tableId, ...data };
  }

  /**
   * Rename a table.
   * Verified (2026-04-17): POST /v0.3/table/{tblId}/updateName
   * Payload: { name }
   */
  async renameTable(appId, tableId, newName) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    const { name } = await this._resolveTableById(appId, tableId);
    if (name === newName) {
      return { message: 'Table already has this name', tableId, name: newName };
    }

    const url = `https://airtable.com/v0.3/table/${tableId}/updateName`;
    const res = await this.auth.postForm(url, this._mutationParams({ name: newName }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`renameTable failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Delete a table.
   * Verified (2026-04-17): POST /v0.3/table/{tblId}/destroy
   * Payload: {}
   *
   * Airtable rejects deleting the only remaining table in a base.
   * Requires expectedName as a safety guard, matching delete_field's pattern.
   */
  async deleteTable(appId, tableId, expectedName) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    const { name } = await this._resolveTableById(appId, tableId);

    if (name !== expectedName) {
      throw new Error(
        `Safety check failed: table ${tableId} is named "${name}" but expectedName was "${expectedName}". ` +
        `Refusing to delete to prevent accidental data loss.`
      );
    }

    const url = `https://airtable.com/v0.3/table/${tableId}/destroy`;
    const res = await this.auth.postForm(url, this._mutationParams({}, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`deleteTable failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { deleted: true, tableId, name: expectedName, ...data };
  }

  /** Internal: resolve a table by ID only (no name matching). */
  async _resolveTableById(appId, tableId) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];
    const table = tables.find(t => t.id === tableId);
    if (!table) {
      throw new Error(`Table "${tableId}" not found in base ${appId}.`);
    }
    return table;
  }

  // ─── View Reads ───────────────────────────────────────────────

  /**
   * Fetch the live state of one view from `/v0.3/table/{tableId}/readData`.
   * The application/read endpoint only carries static view metadata (id, name,
   * type) — it does NOT include filters, sorts, groupLevels, or columnOrder.
   * Those fields live in table/readData under `data.viewDatas[]`.
   *
   * Verified against captured traffic 2026-04-18 (appnnJC0PWnw1kVMF).
   */
  async readTableData(appId, tableId, viewId) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    assertAirtableId(viewId, 'viewId');
    const params = new URLSearchParams({
      stringifiedObjectParams: JSON.stringify({
        includeDataForViewIds: [viewId],
        shouldIncludeSchemaChecksum: false,
        mayOnlyIncludeRowAndCellDataForIncludedViews: true,
        mayExcludeCellDataForLargeViews: true,
      }),
      requestId: this._genRequestId(),
    });
    const url = `https://airtable.com/v0.3/table/${tableId}/readData?${params}`;
    const res = await this.auth.get(url, appId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`readTableData failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  /**
   * Read a view's current configuration (filters, sorts, grouping, column
   * visibility, row height). Uses two calls:
   *   1. Cached application/read to resolve tableId + static metadata
   *   2. Un-cached table/{tableId}/readData for the live view state
   */
  async getView(appId, viewId) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];
    let tableId = null;
    let staticMeta = null;
    for (const table of tables) {
      const match = (table.views || []).find(v => v.id === viewId);
      if (match) {
        tableId = table.id;
        staticMeta = match;
        break;
      }
    }
    if (!tableId) {
      throw new Error(`View "${viewId}" not found in base ${appId}.`);
    }

    const tableData = await this.readTableData(appId, tableId, viewId);
    const viewDatas = tableData?.data?.viewDatas || [];
    const viewData = viewDatas.find(v => v.id === viewId) || {};

    const columnOrder = Array.isArray(viewData.columnOrder) ? viewData.columnOrder : null;
    const visibleColumnOrder = columnOrder
      ? columnOrder.filter(c => c && c.visibility !== false).map(c => c.columnId)
      : null;

    return {
      id: viewId,
      name: staticMeta?.name ?? null,
      type: viewData.type ?? staticMeta?.type ?? null,
      tableId,
      filters: viewData.filters ?? null,
      sorts: viewData.lastSortsApplied ?? null,
      groupLevels: viewData.groupLevels ?? null,
      columnOrder,
      visibleColumnOrder,
      frozenColumnCount: viewData.frozenColumnCount ?? null,
      colorConfig: viewData.colorConfig ?? null,
      metadata: viewData.metadata ?? null,
      rowHeight: viewData.rowHeight
        ?? viewData.metadata?.grid?.rowHeight
        ?? viewData.metadata?.rowHeight
        ?? null,
      description: viewData.description ?? staticMeta?.description ?? null,
      createdByUserId: staticMeta?.createdByUserId ?? viewData.createdByUserId ?? null,
      personalForUserId: staticMeta?.personalForUserId ?? null,
    };
  }

  // ─── View Mutations ───────────────────────────────────────────

  /**
   * Create a new view in a table.
   * Verified payload: { tableId, name, type, copyFromViewId?, copyMode?, personalForUserId?, lock? }
   * View types: "grid", "form", "kanban", "calendar", "gallery", "gantt", "levels" (list)
   */
  async createView(appId, tableId, viewConfig) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    // Airtable requires copyFromViewId — resolve first view if not provided
    let copyFromViewId = viewConfig.copyFromViewId || null;
    if (!copyFromViewId) {
      const table = await this.resolveTable(appId, tableId);
      const views = table.views || [];
      if (views.length > 0) copyFromViewId = views[0].id;
    }

    const viewId = 'viw' + this._genRandomId();
    const url = `https://airtable.com/v0.3/view/${viewId}/create`;

    const payload = {
      tableId,
      name: viewConfig.name,
      type: viewConfig.type || 'grid',
      copyFromViewId,
      copyMode: copyFromViewId ? 'new' : null,
      personalForUserId: viewConfig.personalForUserId || null,
      lock: viewConfig.lock || null,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createView failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { viewId, ...data };
  }

  /**
   * Duplicate an existing view.
   * Uses view/create with copyMode: "duplicate".
   */
  async duplicateView(appId, tableId, sourceViewId, newName) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    assertAirtableId(sourceViewId, 'sourceViewId');
    const viewId = 'viw' + this._genRandomId();
    const url = `https://airtable.com/v0.3/view/${viewId}/create`;

    const payload = {
      tableId,
      name: newName,
      type: 'grid', // type is inherited from source when duplicating
      copyFromViewId: sourceViewId,
      copyMode: 'duplicate',
      personalForUserId: null,
      lock: null,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`duplicateView failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { viewId, ...data };
  }

  /**
   * Rename a view.
   * Real endpoint: /v0.3/view/{id}/updateName
   * Payload: { name: "...", origin: "viewName" }
   */
  async renameView(appId, viewId, newName) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateName`;
    const payload = { name: newName, origin: 'viewName' };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`renameView failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Delete a view.
   * Real endpoint: /v0.3/view/{id}/destroy (empty payload)
   */
  async deleteView(appId, viewId) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/destroy`;

    const res = await this.auth.postForm(url, this._mutationParams({}, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`deleteView failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Update view description.
   * Payload: { description: "..." }
   */
  async updateViewDescription(appId, viewId, description) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateDescription`;
    const payload = { description };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateViewDescription failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Update filters on a view.
   * Verified payload: { filters: { filterSet: [...], conjunction: "and"|"or" } }
   * Each filter in filterSet MUST have a unique "id" (flt-prefixed). Missing IDs
   * are auto-generated before sending.
   */
  async updateViewFilters(appId, viewId, filters) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    // Passing null / empty clears filters.
    let processedFilters = filters;
    if (filters && Array.isArray(filters.filterSet)) {
      // Build a fieldId → { type, typeOptions } map for the view's table so we
      // can rewrite `isEmpty`/`isNotEmpty` on text / formula(text) / lookup /
      // rollup fields, where the internal API rejects those operators with
      // 422 FAILED_STATE_CHECK (user report 2026-04-30 §2.1 + §2.2).
      // Skipping this map only forfeits the rewrite — IDs and static
      // operator normalization still happen below.
      const fieldsById = await this._fieldsByIdForView(appId, viewId).catch(() => ({}));

      // Refuse foreignKey isEmpty/isNotEmpty with a clear error rather than
      // letting Airtable's opaque 422 through (user report §2.3 — no
      // workaround available client-side; the internal API genuinely doesn't
      // support these operators on linked-record fields).
      assertNoForeignKeyEmptiness(filters.filterSet, fieldsById);

      const staticNormalized = normalizeFilterSet(filters.filterSet);
      const typeNormalized = normalizeEmptinessByFieldType(staticNormalized, fieldsById);
      processedFilters = {
        ...filters,
        filterSet: ensureFilterIds(typeNormalized),
      };
    }

    const url = `https://airtable.com/v0.3/view/${viewId}/updateFilters`;
    const payload = { filters: processedFilters };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw enrichFilterError(res.status, errBody, processedFilters);
    }

    return res.json();
  }

  /** Build { fieldId: { type, typeOptions } } for the table containing `viewId`. */
  async _fieldsByIdForView(appId, viewId) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];
    const table = tables.find(t => (t.views || []).some(v => v.id === viewId));
    if (!table) return {};
    const map = {};
    for (const f of table.columns || table.fields || []) {
      map[f.id] = { type: f.type, typeOptions: f.typeOptions || {}, name: f.name };
    }
    return map;
  }

  /**
   * Reorder fields (columns) within a view.
   * Payload: { targetOverallColumnIndicesById: { fldXXX: 0, fldYYY: 1, ... } }
   *
   * Accepts a *partial* map: the caller may pass only the fields they want to
   * move, e.g. `{ fldX: 1 }`. We resolve the view's current columnOrder and
   * merge — moved fields are placed at their target positions, every other
   * field keeps its relative order. Verified safer than passing a single-key
   * map directly (user report 2026-04-30 §2.6 — Airtable's internal API
   * 422s on incomplete maps).
   */
  async reorderViewFields(appId, viewId, fieldOrder) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!fieldOrder || typeof fieldOrder !== 'object') {
      throw new Error('reorderViewFields requires a fieldOrder object mapping field IDs to target positions.');
    }

    const view = await this.getView(appId, viewId);
    const currentOrder = Array.isArray(view.columnOrder) ? view.columnOrder.map(c => c.columnId) : null;

    // If we couldn't resolve the current order (rare — usually an unknown viewId),
    // fall back to passing the user's map straight through. The upstream 422
    // they get will at least include their original payload.
    const fullMap = currentOrder
      ? mergePartialFieldOrder(currentOrder, fieldOrder)
      : fieldOrder;

    const url = `https://airtable.com/v0.3/view/${viewId}/updateMultipleViewConfigs`;
    const payload = { targetOverallColumnIndicesById: fullMap };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`reorderViewFields failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Show or hide all columns in a view.
   */
  async showOrHideAllColumns(appId, viewId, visibility) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/showOrHideAllColumns`;
    const payload = { visibility };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`showOrHideAllColumns failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Show or hide specific columns in a view.
   * Payload: { columnIds: ["fldXXX", ...], visibility: boolean }
   */
  async showOrHideColumns(appId, viewId, columnIds, visibility) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/showOrHideColumns`;
    const payload = { columnIds, visibility };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`showOrHideColumns failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Apply sorts to a view.
   * Payload: { sortObjs: [{ id, columnId, ascending }], shouldAutoSort: true }
   */
  async applySorts(appId, viewId, sortObjs) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/applySorts`;
    // Generate sort IDs if not provided
    const sorts = sortObjs.map(s => ({
      id: s.id || ('srt' + this._genRandomId()),
      columnId: s.columnId,
      ascending: s.ascending !== false,
    }));
    const payload = { sortObjs: sorts, shouldAutoSort: true };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`applySorts failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Update group levels on a view.
   * Payload: { groupLevels: [{ id, columnId, order: "ascending"|"descending", emptyGroupState: "hidden"|"visible" }] }
   */
  async updateGroupLevels(appId, viewId, groupLevels) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateGroupLevels`;
    const levels = groupLevels.map(g => ({
      id: g.id || ('glv' + this._genRandomId()),
      columnId: g.columnId,
      order: g.order || 'ascending',
      emptyGroupState: g.emptyGroupState || 'hidden',
    }));
    const payload = { groupLevels: levels };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateGroupLevels failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Update row height in a view.
   * Payload: { rowHeight: "small"|"medium"|"large"|"xlarge" }
   */
  async updateRowHeight(appId, viewId, rowHeight) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateRowHeight`;

    const res = await this.auth.postForm(url, this._mutationParams({ rowHeight }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateRowHeight failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  // ─── View Sections (sidebar grouping) ─────────────────────────
  // All endpoints captured 2026-04-30 (user report Recording 1).

  /**
   * List all sidebar sections for a table.
   *
   * Two data sources, in order of preference:
   *   1. `table.viewSections` from the cached `application/{appId}/read`
   *      response — when present this gives full {id, name, viewOrder,
   *      pinnedForUserId, createdByUserId} per section.
   *   2. `vsc...`-prefixed IDs in `table.viewOrder` — fallback when the
   *      schema response doesn't surface viewSections (user follow-up
   *      Bug 2, 2026-05-01: the read response on some bases doesn't
   *      expose section names/contents even though the IDs are clearly
   *      present in tableViewOrder).
   *
   * If only fallback data is available, each section in the response will
   * have `name: null`, `viewOrder: null`, `viewCount: null`, and a
   * `partial: true` marker. Use `move_view_to_section` for side effects
   * even when introspection is partial.
   */
  async listViewSections(appId, tableIdOrName) {
    assertAirtableId(appId, 'appId');
    const table = await this.resolveTable(appId, tableIdOrName);
    const tableViewOrder = Array.isArray(table.viewOrder) ? table.viewOrder : [];
    const sectionsObj = table.viewSections || {};
    const richSections = Object.values(sectionsObj).map(s => ({
      id: s.id,
      name: s.name ?? null,
      viewOrder: Array.isArray(s.viewOrder) ? s.viewOrder : [],
      viewCount: Array.isArray(s.viewOrder) ? s.viewOrder.length : 0,
      pinnedForUserId: s.pinnedForUserId ?? null,
      createdByUserId: s.createdByUserId ?? null,
      partial: false,
    }));

    let sections = richSections;
    let partial = false;
    if (richSections.length === 0) {
      // Fallback: surface section IDs from tableViewOrder so the agent
      // at least knows which IDs exist. Names + viewOrder are unknown
      // until the full-fix capture lands.
      const idsFromOrder = tableViewOrder.filter(id => typeof id === 'string' && id.startsWith('vsc'));
      if (idsFromOrder.length > 0) {
        partial = true;
        sections = idsFromOrder.map(id => ({
          id,
          name: null,
          viewOrder: null,
          viewCount: null,
          pinnedForUserId: null,
          createdByUserId: null,
          partial: true,
        }));
      }
    }

    return {
      tableId: table.id,
      tableName: table.name,
      sections,
      tableViewOrder,
      ...(partial ? {
        introspectionPartial: true,
        introspectionNote:
          'Section names and viewOrder are not currently readable from the cached schema response on this base. ' +
          'IDs come from tableViewOrder. move_view_to_section / rename_view_section / delete_view_section still work — only this read is partial.',
      } : {}),
    };
  }

  /**
   * Create a sidebar section. The section ID is client-generated (Airtable lets
   * us choose the `vsc...` prefix and 14-char body, same pattern as `fld` / `viw`).
   */
  async createViewSection(appId, tableId, name) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    const sectionId = 'vsc' + this._genRandomId();
    const url = `https://airtable.com/v0.3/viewSection/${sectionId}/create`;
    const payload = { tableId, name: name || 'View section' };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createViewSection failed (${res.status}): ${errBody}`);
    }
    this.cache.invalidate(appId);
    const body = await res.json();
    return { id: sectionId, name: payload.name, tableId, raw: body };
  }

  async renameViewSection(appId, sectionId, name) {
    assertAirtableId(appId, 'appId');
    if (!sectionId || !sectionId.startsWith('vsc')) {
      throw new Error(`renameViewSection: expected sectionId to start with "vsc", got "${sectionId}"`);
    }
    const url = `https://airtable.com/v0.3/viewSection/${sectionId}/updateName`;
    const res = await this.auth.postForm(url, this._mutationParams({ name }, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`renameViewSection failed (${res.status}): ${errBody}`);
    }
    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Destroy a sidebar section. Airtable handles non-empty sections natively:
   * any views inside the section are auto-promoted into the table's top-level
   * `viewOrder` at the position the section used to occupy. Verified 2026-04-30.
   */
  async deleteViewSection(appId, sectionId) {
    assertAirtableId(appId, 'appId');
    if (!sectionId || !sectionId.startsWith('vsc')) {
      throw new Error(`deleteViewSection: expected sectionId to start with "vsc", got "${sectionId}"`);
    }
    const url = `https://airtable.com/v0.3/viewSection/${sectionId}/destroy`;
    const res = await this.auth.postForm(url, this._mutationParams({}, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`deleteViewSection failed (${res.status}): ${errBody}`);
    }
    this.cache.invalidate(appId);
    return res.json();
  }

  /**
   * Move a view or a section within the sidebar. The single endpoint covers
   * four user actions:
   *   - viewId + targetViewSectionId          → put view INTO that section at index
   *   - viewId + (no targetViewSectionId)     → move view OUT to ungrouped at index
   *   - sectionId + targetIndex               → reorder section among other sections
   *   - viewId + same section + new index     → reorder within a section
   * `targetIndex` is the destination index (0 = top of the list). For section
   * reorders, the index is into the table's top-level `viewOrder`; for moves
   * within a section, it's into that section's `viewOrder`.
   */
  async moveViewOrViewSection(appId, tableId, viewIdOrViewSectionId, targetIndex, targetViewSectionId = undefined) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(tableId, 'tableId');
    if (!viewIdOrViewSectionId) {
      throw new Error('moveViewOrViewSection requires viewIdOrViewSectionId');
    }
    const url = `https://airtable.com/v0.3/table/${tableId}/moveViewOrViewSection`;
    const payload = { viewIdOrViewSectionId, targetIndex: Number.isFinite(targetIndex) ? targetIndex : 0 };
    if (targetViewSectionId) payload.targetViewSectionId = targetViewSectionId;

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`moveViewOrViewSection failed (${res.status}): ${errBody}`);
    }
    this.cache.invalidate(appId);
    return res.json();
  }

  // ─── View Columns (visibility, ordering, freezing) ────────────
  // Endpoints captured 2026-04-30 (user report Recording 2 + 3).

  /** Hide or show every column in a view in one call. */
  async showOrHideAllColumns(appId, viewId, visibility) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/showOrHideAllColumns`;
    const res = await this.auth.postForm(url, this._mutationParams({ visibility: !!visibility }, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`showOrHideAllColumns failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  /**
   * Move one or more columns within the *visible-only* index. Index 0 is the
   * leftmost visible column. Different from `reorderViewFields`, which writes
   * the full overall column order (visible + hidden).
   */
  async moveVisibleColumns(appId, viewId, columnIds, targetVisibleIndex) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!Array.isArray(columnIds) || columnIds.length === 0) {
      throw new Error('moveVisibleColumns requires a non-empty columnIds array');
    }
    const url = `https://airtable.com/v0.3/view/${viewId}/moveVisibleColumns`;
    const payload = { columnIds, targetVisibleIndex: Number(targetVisibleIndex) };
    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`moveVisibleColumns failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  /**
   * Move one or more columns within the *overall* index (visible + hidden).
   * Sibling of `moveVisibleColumns`; complements existing `reorderViewFields`.
   */
  async moveOverallColumns(appId, viewId, columnIds, targetOverallIndex) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!Array.isArray(columnIds) || columnIds.length === 0) {
      throw new Error('moveOverallColumns requires a non-empty columnIds array');
    }
    const url = `https://airtable.com/v0.3/view/${viewId}/moveOverallColumns`;
    const payload = { columnIds, targetOverallIndex: Number(targetOverallIndex) };
    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`moveOverallColumns failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  /** Update the frozen-column divider position for a grid view. */
  async updateFrozenColumnCount(appId, viewId, frozenColumnCount) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateFrozenColumnCount`;
    const payload = { frozenColumnCount: Number(frozenColumnCount) };
    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateFrozenColumnCount failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  /**
   * One-shot view-column setup. Composes hide-all → show-the-requested-set →
   * batch-move into target positions → optional frozen-column count. Solves
   * the user report's §1.4 "new views show all 168 fields, unusable until
   * manually trimmed" problem.
   *
   * `visibleColumnIds` (required): array of field IDs that should be visible.
   *   All other fields are hidden. Order in this array becomes the visible
   *   left-to-right order.
   * `frozenColumnCount` (optional): if set, frozen-column divider is placed
   *   N columns from the left.
   *
   * Implementation note (2026-05-01 hotfix — user follow-up Bug 1):
   *   v2.4.0 looped per-id `moveVisibleColumns([id], i)` starting at index 0,
   *   which 422'd because grid views pin the primary column at visible index
   *   0 (you can't move anything else there) and per-id moves of an already-
   *   correctly-positioned column also fail. The fix is one batched call
   *   inserting the entire ordered list starting at index 1, after the
   *   primary. Verified by the reporter against 11 grid views in their
   *   workaround snippet — succeeds 100% of the time.
   */
  async setViewColumns(appId, viewId, { visibleColumnIds, frozenColumnCount } = {}) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!Array.isArray(visibleColumnIds) || visibleColumnIds.length === 0) {
      throw new Error('setViewColumns requires a non-empty visibleColumnIds array');
    }

    // 1. Hide everything.
    await this.showOrHideAllColumns(appId, viewId, false);
    // 2. Show the requested set in one batched call.
    await this.showOrHideColumns(appId, viewId, visibleColumnIds, true);
    // 3. Single batched move — places the entire ordered list starting at
    //    visible index 1 (after the pinned primary column at index 0).
    await this.moveVisibleColumns(appId, viewId, visibleColumnIds, 1);
    // 4. Optional frozen-column divider.
    if (Number.isFinite(frozenColumnCount) && frozenColumnCount >= 0) {
      await this.updateFrozenColumnCount(appId, viewId, frozenColumnCount);
    }
    return { updated: true, viewId, visibleColumnIds, frozenColumnCount: frozenColumnCount ?? null };
  }

  // ─── View Presentation (cover image, color rules, cell wrap) ──
  // Endpoints captured 2026-04-30 (Recording 3 — Kanban + Gallery).

  /**
   * Set the cover-image field and crop/fit mode for Kanban or Gallery views.
   * Pass `coverColumnId: null` to remove the cover.
   */
  async setViewCover(appId, viewId, { coverColumnId, coverFitType } = {}) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const out = {};
    // Either or both fields can be passed; we issue the corresponding endpoint(s).
    if (coverColumnId !== undefined) {
      const url = `https://airtable.com/v0.3/view/${viewId}/updateCoverColumnId`;
      const res = await this.auth.postForm(url, this._mutationParams({ coverColumnId: coverColumnId || null }, appId), appId);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`updateCoverColumnId failed (${res.status}): ${errBody}`);
      }
      out.coverColumnId = coverColumnId || null;
    }
    if (coverFitType !== undefined) {
      if (coverFitType !== 'fit' && coverFitType !== 'crop') {
        throw new Error(`setViewCover: coverFitType must be "fit" or "crop", got "${coverFitType}"`);
      }
      const url = `https://airtable.com/v0.3/view/${viewId}/updateCoverFitType`;
      const res = await this.auth.postForm(url, this._mutationParams({ coverFitType }, appId), appId);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`updateCoverFitType failed (${res.status}): ${errBody}`);
      }
      out.coverFitType = coverFitType;
    }
    return { updated: true, viewId, ...out };
  }

  /**
   * Apply a color config to a view. Currently supports `type: "selectColumn"` —
   * card colors come from a single-select field's choice colors. Other types
   * (e.g. rule-based coloring) exist in Airtable's UI but aren't captured yet;
   * passing an unknown type is forwarded as-is so callers willing to experiment
   * aren't blocked.
   */
  async setViewColorConfig(appId, viewId, colorConfig) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!colorConfig || typeof colorConfig !== 'object') {
      throw new Error('setViewColorConfig requires a colorConfig object');
    }
    const url = `https://airtable.com/v0.3/view/${viewId}/updateColorConfig`;
    const res = await this.auth.postForm(url, this._mutationParams({ colorConfig }, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateColorConfig failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  /** Toggle whether long cell values wrap or truncate. */
  async setViewCellWrap(appId, viewId, shouldWrapCellValues) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const url = `https://airtable.com/v0.3/view/${viewId}/updateShouldWrapCellValues`;
    const payload = { shouldWrapCellValues: !!shouldWrapCellValues };
    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateShouldWrapCellValues failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  // ─── Calendar metadata ────────────────────────────────────────
  // Endpoint captured 2026-04-30 (Recording 4).

  /**
   * Set the date-column ranges shown on a Calendar view. Each entry is either:
   *   { startColumnId }                       → single-point events
   *   { startColumnId, endColumnId }          → range events
   * The array form lets a single calendar overlay multiple date series at once.
   */
  async setCalendarDateColumns(appId, viewId, dateColumnRanges) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!Array.isArray(dateColumnRanges) || dateColumnRanges.length === 0) {
      throw new Error('setCalendarDateColumns requires a non-empty dateColumnRanges array');
    }
    const url = `https://airtable.com/v0.3/view/${viewId}/updateCalendarDateColumnRanges`;
    const res = await this.auth.postForm(url, this._mutationParams({ dateColumnRanges }, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateCalendarDateColumnRanges failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  // ─── Form metadata (legacy form views) ────────────────────────
  // Endpoints captured 2026-04-30 (Recording 6). Builder-form ("Interfaces"
  // page/* endpoints) are intentionally out of scope — they're a separate
  // product surface.

  /**
   * Update one or more legacy-form-view metadata properties. Unset properties
   * are not touched. Each property maps to its own atomic endpoint; we fan
   * out so callers can patch multiple things in one logical operation.
   */
  async setFormMetadata(appId, viewId, props = {}) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    const ops = [];
    if (props.description !== undefined)
      ops.push(['updateFormDescription', { description: props.description }]);
    if (props.afterSubmitMessage !== undefined)
      ops.push(['updateFormAfterSubmitMessage', { afterSubmitMessage: props.afterSubmitMessage }]);
    if (props.redirectUrl !== undefined)
      ops.push(['updateFormRedirectUrl', { redirectUrl: props.redirectUrl }]);
    if (props.refreshAfterSubmit !== undefined)
      ops.push(['updateFormRefreshAfterSubmit', { refreshAfterSubmit: props.refreshAfterSubmit }]);
    if (props.shouldAllowRequestCopyOfResponse !== undefined)
      ops.push(['updateFormShouldAllowRequestCopyOfResponse', { shouldAllowRequestCopyOfResponse: !!props.shouldAllowRequestCopyOfResponse }]);
    if (props.shouldAttributeResponses !== undefined)
      ops.push(['updateFormShouldAttributeResponses', { shouldAttributeResponses: !!props.shouldAttributeResponses }]);
    if (props.isAirtableBrandingRemoved !== undefined)
      ops.push(['updateFormIsAirtableBrandingRemoved', { isAirtableBrandingRemoved: !!props.isAirtableBrandingRemoved }]);

    if (ops.length === 0) {
      throw new Error('setFormMetadata requires at least one property to update');
    }

    const applied = {};
    for (const [endpoint, payload] of ops) {
      const url = `https://airtable.com/v0.3/view/${viewId}/${endpoint}`;
      const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`${endpoint} failed (${res.status}): ${errBody}`);
      }
      Object.assign(applied, payload);
    }
    return { updated: true, viewId, applied };
  }

  /**
   * Toggle email-on-submit notifications for a specific user on a form view.
   * Per-user, not per-form — that's why this is separate from setFormMetadata.
   */
  async setFormSubmissionNotification(appId, viewId, userId, shouldEnable) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(viewId, 'viewId');
    if (!userId || !userId.startsWith('usr')) {
      throw new Error(`setFormSubmissionNotification: expected userId to start with "usr", got "${userId}"`);
    }
    const url = `https://airtable.com/v0.3/view/${viewId}/updateFormSubmissionNotificationPreferencesForUser`;
    const payload = { userId, shouldEnable: !!shouldEnable };
    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateFormSubmissionNotificationPreferencesForUser failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  // ─── Field Extra Operations ───────────────────────────────────

  /**
   * Update a field's description.
   * Real endpoint: /v0.3/column/{id}/updateDescription
   */
  async updateFieldDescription(appId, fieldId, description) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(fieldId, 'fieldId');
    const url = `https://airtable.com/v0.3/column/${fieldId}/updateDescription`;

    const res = await this.auth.postForm(url, this._mutationParams({ description }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateFieldDescription failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Duplicate (clone) a field.
   * Real endpoint: /v0.3/column/{newFieldId}/createAsClone
   * Note: activeViewId is required — if not provided, resolves the first view in the table.
   */
  async duplicateField(appId, tableId, sourceFieldId, { duplicateCells = false, activeViewId = null } = {}) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(sourceFieldId, 'sourceFieldId');
    // activeViewId is required by Airtable — resolve if not provided
    if (!activeViewId) {
      const table = await this.resolveTable(appId, tableId);
      const views = table.views || [];
      if (views.length > 0) activeViewId = views[0].id;
    }

    const columnId = 'fld' + this._genRandomId();
    const url = `https://airtable.com/v0.3/column/${columnId}/createAsClone`;

    const payload = {
      tableId,
      activeViewId,
      columnIdToClone: sourceFieldId,
      shouldDuplicateCells: duplicateCells,
      afterOverallColumnIndex: null,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`duplicateField failed (${res.status}): ${errBody}`);
    }

    this.cache.invalidate(appId);
    const data = await res.json().catch(() => ({}));
    return { columnId, ...data };
  }

  // ─── Extension/Block Operations ───────────────────────────────

  /**
   * Create a new block (extension) in a base.
   * Endpoint: /v0.3/block/{blkId}/create
   * Payload: { name, applicationId, latestReleaseId }
   */
  async createBlock(appId, name, latestReleaseId) {
    assertAirtableId(appId, 'appId');
    const blockId = 'blk' + this._genRandomId();
    const url = `https://airtable.com/v0.3/block/${blockId}/create`;

    const payload = {
      name,
      applicationId: appId,
      latestReleaseId,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createBlock failed (${res.status}): ${errBody}`);
    }

    const data = await res.json().catch(() => ({}));
    return { blockId, ...data };
  }

  /**
   * Create a block installation page (dashboard).
   * Endpoint: /v0.3/blockInstallationPage/{bipId}/create
   */
  async createBlockInstallationPage(appId, name) {
    assertAirtableId(appId, 'appId');
    const pageId = 'bip' + this._genRandomId();
    const url = `https://airtable.com/v0.3/blockInstallationPage/${pageId}/create`;

    const payload = {
      applicationId: appId,
      name,
      developmentBlockId: null,
      developerUserId: null,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`createBlockInstallationPage failed (${res.status}): ${errBody}`);
    }

    const data = await res.json().catch(() => ({}));
    return { pageId, ...data };
  }

  /**
   * Install a block on a dashboard page.
   * Endpoint: /v0.3/blockInstallation/{bliId}/create
   */
  async installBlock(appId, blockId, pageId, name, { type = 'release' } = {}) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(blockId, 'blockId');
    assertAirtableId(pageId, 'pageId');
    const installationId = 'bli' + this._genRandomId();
    const url = `https://airtable.com/v0.3/blockInstallation/${installationId}/create`;

    const payload = {
      blockInstallationPageId: pageId,
      blockId,
      name,
      type,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`installBlock failed (${res.status}): ${errBody}`);
    }

    const data = await res.json().catch(() => ({}));
    return { installationId, ...data };
  }

  /**
   * Update block installation state (enable/disable).
   * Endpoint: /v0.3/blockInstallation/{bliId}/updateState
   */
  async updateBlockInstallationState(appId, installationId, state) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(installationId, 'installationId');
    const url = `https://airtable.com/v0.3/blockInstallation/${installationId}/updateState`;

    const res = await this.auth.postForm(url, this._mutationParams({ state }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateBlockInstallationState failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Rename a block installation.
   * Endpoint: /v0.3/blockInstallation/{bliId}/updateName
   */
  async renameBlockInstallation(appId, installationId, name) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(installationId, 'installationId');
    const url = `https://airtable.com/v0.3/blockInstallation/${installationId}/updateName`;

    const res = await this.auth.postForm(url, this._mutationParams({ name }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`renameBlockInstallation failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Duplicate a block installation.
   * Endpoint: /v0.3/blockInstallation/{newBliId}/createAsClone
   */
  async duplicateBlockInstallation(appId, sourceInstallationId, pageId) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(sourceInstallationId, 'sourceInstallationId');
    assertAirtableId(pageId, 'pageId');
    const installationId = 'bli' + this._genRandomId();
    const url = `https://airtable.com/v0.3/blockInstallation/${installationId}/createAsClone`;

    const payload = {
      blockInstallationIdToClone: sourceInstallationId,
      blockInstallationPageId: pageId,
    };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`duplicateBlockInstallation failed (${res.status}): ${errBody}`);
    }

    const data = await res.json().catch(() => ({}));
    return { installationId, ...data };
  }

  /**
   * Remove a block installation.
   * Endpoint: /v0.3/blockInstallation/{bliId}/destroy
   */
  async removeBlockInstallation(appId, installationId) {
    assertAirtableId(appId, 'appId');
    assertAirtableId(installationId, 'installationId');
    const url = `https://airtable.com/v0.3/blockInstallation/${installationId}/destroy`;

    const res = await this.auth.postForm(url, this._mutationParams({}, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`removeBlockInstallation failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  // ─── Helpers ──────────────────────────────────────────────────

  _genRequestId() {
    return 'req' + this._genRandomId();
  }

  _genRandomId() {
    // Use crypto.randomBytes for uniform distribution and lower collision rate
    // than Math.random(). `randomBytes` is already imported at the top of the file
    // for generateFilterId().
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(14);
    let result = '';
    for (let i = 0; i < 14; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }
}
