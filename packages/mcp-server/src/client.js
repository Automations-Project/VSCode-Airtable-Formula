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
export class AirtableClient {
  constructor(auth) {
    this.auth = auth;
    this.cache = new SchemaCache();
  }

  // ─── Read Operations ──────────────────────────────────────────

  async getApplicationData(appId) {
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
    const table = tables.find(t =>
      t.id === tableIdOrName || t.name === tableIdOrName
    );
    if (!table) {
      const available = tables.map(t => `${t.name} (${t.id})`).join(', ');
      throw new Error(`Table "${tableIdOrName}" not found. Available: ${available}`);
    }
    return table;
  }

  async resolveField(appId, fieldId) {
    const data = await this.getApplicationData(appId);
    const tables = data?.data?.tableSchemas || data?.data?.tables || [];
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
    // Passing null / empty clears filters.
    let processedFilters = filters;
    if (filters && Array.isArray(filters.filterSet)) {
      // Airtable requires every filter to carry a unique flt-prefixed id.
      // Auto-inject missing IDs so callers don't need to generate them.
      // Also normalize operator names (is → =, isNot → !=) to match what
      // Airtable's internal API accepts for text / singleSelect fields.
      processedFilters = {
        ...filters,
        filterSet: ensureFilterIds(normalizeFilterSet(filters.filterSet)),
      };
    }

    const url = `https://airtable.com/v0.3/view/${viewId}/updateFilters`;
    const payload = { filters: processedFilters };

    const res = await this.auth.postForm(url, this._mutationParams(payload, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateViewFilters failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  /**
   * Reorder fields (columns) within a view.
   * Payload: { targetOverallColumnIndicesById: { fldXXX: 0, fldYYY: 1, ... } }
   * Maps field IDs to their desired column index positions.
   */
  async reorderViewFields(appId, viewId, fieldOrder) {
    const url = `https://airtable.com/v0.3/view/${viewId}/updateMultipleViewConfigs`;
    const payload = { targetOverallColumnIndicesById: fieldOrder };

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
    const url = `https://airtable.com/v0.3/view/${viewId}/updateRowHeight`;

    const res = await this.auth.postForm(url, this._mutationParams({ rowHeight }, appId), appId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`updateRowHeight failed (${res.status}): ${errBody}`);
    }

    return res.json();
  }

  // ─── Field Extra Operations ───────────────────────────────────

  /**
   * Update a field's description.
   * Real endpoint: /v0.3/column/{id}/updateDescription
   */
  async updateFieldDescription(appId, fieldId, description) {
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
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 14; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
