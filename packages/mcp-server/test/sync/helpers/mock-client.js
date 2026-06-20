// Deterministic in-memory fake of the AirtableClient schema mutators for apply tests.
// createTable mirrors the live internal API: a new table is born with these 6 fields
// (verified 2026-06-16); the first (Name/text) is the primary, the rest are scaffolding.
const DEFAULT_FIELDS = [
  { name: 'Name', type: 'text' },                                   // primary
  { name: 'Notes', type: 'multilineText' },
  { name: 'Assignee', type: 'collaborator', typeOptions: { shouldNotify: true } },
  { name: 'Status', type: 'select', typeOptions: { choices: {} } },
  { name: 'Attachments', type: 'multipleAttachment', typeOptions: { unreversed: true } },
  { name: 'Attachment Summary', type: 'asyncText', typeOptions: { sourceType: 'ai' } },
];

export class MockClient {
  constructor(opts = {}) {
    this.tables = [];   // [{ id, name, primaryColumnId, columns:[{id,name,type,typeOptions,description}] }]
    this.calls = [];    // call log: 'kind:arg'
    this._seq = 0;
    this.formulaValid = opts.formulaValid ?? true;
  }
  _id(prefix) { this._seq += 1; return prefix + String(this._seq).padStart(6, '0'); }
  async getApplicationData() { return { data: { tableSchemas: JSON.parse(JSON.stringify(this.tables)) } }; }
  async createTable(appId, name) {
    const tableId = this._id('tbl');
    const columns = DEFAULT_FIELDS.map((f) => ({ id: this._id('fld'), name: f.name, type: f.type, typeOptions: f.typeOptions ?? null, description: null }));
    this.tables.push({ id: tableId, name, primaryColumnId: columns[0].id, columns,
      views: [{ id: this._id('viw'), name: 'Grid view', type: 'grid', personalForUserId: null, config: {} }],
      // live createTable also seeds ~3 blank scaffolding rows — model them so apply's row-cleanup is testable
      rows: [{ id: this._id('rec'), fields: {} }, { id: this._id('rec'), fields: {} }, { id: this._id('rec'), fields: {} }] });
    this.calls.push(`createTable:${name}`);
    return { tableId };
  }
  async queryRecords(appId, tableId) {
    this.calls.push(`queryRecords:${tableId}`);
    // mirror the real client's return shape: { summary: { rows: [{id, fields}] }, raw }
    const rows = (this._table(tableId).rows || []).map((r) => ({ id: r.id, fields: r.fields }));
    return { summary: { tableId, count: rows.length, rows }, raw: null };
  }
  async deleteRecords(appId, tableId, rowIds) {
    const t = this._table(tableId);
    const before = (t.rows || []).length;
    t.rows = (t.rows || []).filter((r) => !rowIds.includes(r.id));
    this.calls.push(`deleteRecords:${tableId}:${before - t.rows.length}`);
    return { deleted: before - t.rows.length };
  }
  _table(id) { const t = this.tables.find((x) => x.id === id); if (!t) throw new Error('no table ' + id); return t; }
  _field(colId) { for (const t of this.tables) { const f = t.columns.find((c) => c.id === colId); if (f) return f; } throw new Error('no field ' + colId); }
  async deleteField(appId, fieldId, expectedName) {
    for (const t of this.tables) {
      const i = t.columns.findIndex((c) => c.id === fieldId);
      if (i >= 0) {
        if (expectedName != null && t.columns[i].name !== expectedName) throw new Error(`deleteField name mismatch: ${t.columns[i].name} !== ${expectedName}`);
        t.columns.splice(i, 1);
        this.calls.push(`deleteField:${fieldId}`);
        return { deleted: true };
      }
    }
    throw new Error('no field ' + fieldId);
  }
  async createField(appId, tableId, cfg) {
    const columnId = this._id('fld');
    const field = { id: columnId, name: cfg.name, type: cfg.type, typeOptions: cfg.typeOptions ?? null, description: cfg.description ?? null };
    this._table(tableId).columns.push(field);
    this.calls.push(`createField:${cfg.name}:${cfg.type}`);
    if (cfg.type === 'foreignKey' && cfg.typeOptions && cfg.typeOptions.foreignTableId) {
      const foreign = this._table(cfg.typeOptions.foreignTableId);
      const reverseId = this._id('fld');
      foreign.columns.push({ id: reverseId, name: this._table(tableId).name, type: 'foreignKey',
        typeOptions: { foreignTableId: tableId, symmetricColumnId: columnId, relationship: cfg.typeOptions.relationship === 'one' ? 'many' : 'one', unreversed: true }, description: null });
      field.typeOptions = { ...field.typeOptions, symmetricColumnId: reverseId };
    }
    return { columnId };
  }
  async updateFieldConfig(appId, columnId, cfg) {
    const f = this._field(columnId); f.type = cfg.type; if (cfg.typeOptions !== undefined) f.typeOptions = cfg.typeOptions;
    this.calls.push(`updateFieldConfig:${columnId}:${cfg.type}`);
    return { ok: true };
  }
  async renameField(appId, columnId, name) {
    this._field(columnId).name = name; this.calls.push(`renameField:${columnId}:${name}`); return { ok: true };
  }
  async updateFieldDescription(appId, columnId, description) {
    this._field(columnId).description = description; this.calls.push(`updateFieldDescription:${columnId}`); return { ok: true };
  }
  _view(viewId) { for (const t of this.tables) { const v = (t.views || []).find((x) => x.id === viewId); if (v) return v; } throw new Error('no view ' + viewId); }
  async createView(appId, tableId, cfg) {
    const id = this._id('viw');
    this._table(tableId).views.push({ id, name: cfg.name, type: cfg.type || 'grid', personalForUserId: null, config: {} });
    this.calls.push(`createView:${cfg.name}:${cfg.type}`);
    return { viewId: id };
  }
  async getView(appId, viewId) { return { ...(this._view(viewId).config || {}) }; }
  async renameView(appId, viewId, name) { this._view(viewId).name = name; this.calls.push(`renameView:${viewId}:${name}`); return { ok: true }; }
  async updateViewFilters(appId, viewId, filters) { this._view(viewId).config.filters = filters; this.calls.push(`updateViewFilters:${viewId}`); return { ok: true }; }
  async applySorts(appId, viewId, sortObjs) { this._view(viewId).config.sorts = sortObjs; this.calls.push(`applySorts:${viewId}`); return { ok: true }; }
  async updateGroupLevels(appId, viewId, groupLevels) { this._view(viewId).config.groupLevels = groupLevels; this.calls.push(`updateGroupLevels:${viewId}`); return { ok: true }; }
  async setViewColumns(appId, viewId, opts) { this._view(viewId).config.columns = opts; this.calls.push(`setViewColumns:${viewId}`); return { ok: true }; }
  async updateFrozenColumnCount(appId, viewId, n) { this._view(viewId).config.frozenColumnCount = n; this.calls.push(`updateFrozenColumnCount:${viewId}`); return { ok: true }; }
  async setViewColorConfig(appId, viewId, cc) { this._view(viewId).config.colorConfig = cc; this.calls.push(`setViewColorConfig:${viewId}`); return { ok: true }; }
  async setViewCover(appId, viewId, cover) { this._view(viewId).config.cover = cover; this.calls.push(`setViewCover:${viewId}`); return { ok: true }; }
  async setCalendarDateColumns(appId, viewId, ranges) { this._view(viewId).config.calendar = { dateColumnRanges: ranges }; this.calls.push(`setCalendarDateColumns:${viewId}`); return { ok: true }; }
  async setFormMetadata(appId, viewId, form) { this._view(viewId).config.form = form; this.calls.push(`setFormMetadata:${viewId}`); return { ok: true }; }
  async updateRowHeight(appId, viewId, rh) { this._view(viewId).config.rowHeight = rh; this.calls.push(`updateRowHeight:${viewId}`); return { ok: true }; }
  async updateViewDescription(appId, viewId, d) { this._view(viewId).config.description = d; this.calls.push(`updateViewDescription:${viewId}`); return { ok: true }; }
  async validateFormula(appId, tableId, formulaText) {
    this.calls.push(`validateFormula:${formulaText}`);
    return { valid: this.formulaValid, resultType: 'text' };
  }
}
