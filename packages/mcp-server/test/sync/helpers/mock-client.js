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
    this.tables.push({ id: tableId, name, primaryColumnId: columns[0].id, columns });
    this.calls.push(`createTable:${name}`);
    return { tableId };
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
    this._table(tableId).columns.push({ id: columnId, name: cfg.name, type: cfg.type, typeOptions: cfg.typeOptions ?? null, description: cfg.description ?? null });
    this.calls.push(`createField:${cfg.name}:${cfg.type}`);
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
  async validateFormula(appId, tableId, formulaText) {
    this.calls.push(`validateFormula:${formulaText}`);
    return { valid: this.formulaValid, resultType: 'text' };
  }
}
