import { SchemaCache } from './cache.js';

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

    const payload = {
      tableId,
      name: fieldConfig.name,
      config: {
        type: fieldConfig.type,
        typeOptions: fieldConfig.typeOptions || {},
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

    // Flat payload — matches real Airtable requests
    const payload = {
      type: config.type,
      typeOptions: config.typeOptions || {},
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
      // Return dependency info so caller can decide
      return {
        deleted: false,
        fieldId,
        name: expectedName,
        hasDependencies: true,
        dependencies: checkBody.error.details,
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
   */
  async updateViewFilters(appId, viewId, filters) {
    const url = `https://airtable.com/v0.3/view/${viewId}/updateFilters`;
    const payload = { filters };

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
