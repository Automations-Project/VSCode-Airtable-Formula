// Schema snapshot: normalize getApplicationData into a comparable model.
// Supports both .tableSchemas/.columns (real internal API) and .tables/.fields (public API shape).

const COMPUTED_TYPES = new Set([
  'formula', 'rollup', 'lookup', 'multipleLookupValues', 'count',
  'autoNumber', 'autonumber', 'createdTime', 'lastModifiedTime',
  'createdBy', 'lastModifiedBy', 'button', 'aiText', 'asyncText', 'externalSyncSource',
]);

/**
 * Returns true if the field type is computed (not directly writable by records API).
 * @param {string} type
 * @returns {boolean}
 */
export function isComputedType(type) {
  return COMPUTED_TYPES.has(type);
}

/**
 * Normalizes the raw response from client.getApplicationData() into a
 * stable, comparable snapshot model.
 *
 * @param {object} rawData - Full API response from getApplicationData
 * @returns {{ tables: Array<NormalizedTable> }}
 */
export function normalizeSchema(rawData) {
  const tables = rawData?.data?.tableSchemas ?? rawData?.data?.tables ?? [];
  return {
    tables: tables.map((t) => {
      const cols = t.columns ?? t.fields ?? [];
      const views = (t.views || []).map((v) => ({
        id: v.id, name: v.name, type: v.type,
        description: v.description ?? null,
        personalForUserId: v.personalForUserId ?? null,
      }));
      const viewNameById = new Map(views.map(v => [v.id, v.name]));
      const sectionsObj = t.viewSectionsById || t.viewSections || {};
      const sections = Object.entries(sectionsObj).map(([id, s]) => ({
        id: s.id || id,
        name: s.name,
        viewNames: (s.viewOrder || []).map((vid) => viewNameById.get(vid)).filter(Boolean),
      }));
      return {
        id: t.id,
        name: t.name,
        // Real internal API uses primaryColumnId; public API uses primaryFieldId.
        // Fall back to the first column id if neither is present.
        primaryFieldId: t.primaryColumnId ?? t.primaryFieldId ?? cols[0]?.id ?? null,
        fields: cols.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          typeOptions: c.typeOptions ?? null,
          description: c.description ?? null,
          isComputed: isComputedType(c.type),
        })),
        views,
        sections,
      };
    }),
  };
}

// Map a raw getView result into the flat view-config snapshot shape (null facets omitted).
// PROBE-VERIFIED (spec §11): sorts is {sortSet:[...]} → flatten to array; type-specific config
// lives under metadata.<type> (calendar.dateColumnRanges, gallery.coverColumnId), NOT top-level.
export function normalizeViewConfig(v) {
  const cfg = {};
  if (v.filters) cfg.filters = v.filters;
  if (v.sorts && Array.isArray(v.sorts.sortSet)) cfg.sorts = v.sorts.sortSet.map((s) => ({ columnId: s.columnId, ascending: s.ascending }));
  if (v.groupLevels) cfg.groupLevels = v.groupLevels.map((g) => ({ columnId: g.columnId, order: g.order, emptyGroupState: g.emptyGroupState }));
  if (v.columnOrder) cfg.columnOrder = v.columnOrder.map((c) => ({ columnId: c.columnId, visibility: c.visibility }));
  if (typeof v.frozenColumnCount === 'number') cfg.frozenColumnCount = v.frozenColumnCount;
  if (v.colorConfig) cfg.colorConfig = v.colorConfig;
  const md = v.metadata || {};
  if (md.gallery && md.gallery.coverColumnId) cfg.cover = { coverColumnId: md.gallery.coverColumnId, coverFitType: md.gallery.coverFitType };
  if (md.calendar && Array.isArray(md.calendar.dateColumnRanges)) cfg.calendar = { dateColumnRanges: md.calendar.dateColumnRanges.map((r) => ({ startColumnId: r.startColumnId, ...(r.endColumnId ? { endColumnId: r.endColumnId } : {}) })) };
  if (md.form) cfg.form = md.form;
  if (v.rowHeight) cfg.rowHeight = v.rowHeight;
  return cfg;
}

/** Attach live config to each COLLABORATIVE view (personal views skipped). Mutates + returns snap. */
export async function snapshotViews(client, appId, snap) {
  if (typeof client.getView !== 'function') return snap;
  for (const t of snap.tables) {
    for (const v of t.views || []) {
      if (v.personalForUserId) continue;
      const live = await client.getView(appId, v.id);
      v.config = normalizeViewConfig(live);
    }
  }
  return snap;
}

/**
 * Fetches and normalizes the schema for a base.
 *
 * @param {import('../client.js').AirtableClient} client
 * @param {string} appId - Base ID (e.g. 'appXXXXXXXXXXXXXX')
 * @returns {Promise<{ baseId: string, tables: Array<NormalizedTable> }>}
 */
export async function snapshotBase(client, appId) {
  const raw = await client.getApplicationData(appId);
  const snap = { baseId: appId, ...normalizeSchema(raw) };
  await snapshotViews(client, appId, snap);
  return snap;
}

/**
 * Schema-only snapshot — like snapshotBase but WITHOUT the per-view live-config reads.
 * snapshotViews() issues one getView (a table/readData call, ~1s) PER collaborative view —
 * hundreds of slow sequential requests on a view-heavy base. The records phase only needs
 * schema (tables/fields) + records, so it uses this; callers needing view configs (e.g.
 * reapplyViewFilters) run snapshotViews() lazily and only on the base they need.
 * @returns {Promise<{ baseId: string, tables: Array<NormalizedTable> }>}
 */
export async function snapshotSchemaOnly(client, appId) {
  const raw = await client.getApplicationData(appId);
  return { baseId: appId, ...normalizeSchema(raw) };
}

/**
 * Pull a table's records via its first collaborative view (single call, ≤1000 rows;
 * the internal readQueries endpoint has no cursor — Task-11 pre-flight warns on >1000).
 * @returns {Promise<Array<{id:string, cellValuesByColumnId:object}>>}
 */
export async function snapshotTableRecords(client, appId, table) {
  const view = (table.views || []).find((v) => !v.personalForUserId) || (table.views || [])[0];
  if (!view) return [];
  const res = await client.queryRecords(appId, table.id, view.id, { limit: 1000 });
  return (res?.summary?.rows || []).map((r) => ({ id: r.id, cellValuesByColumnId: r.fields || {} }));
}

/**
 * @typedef {{ id: string, name: string, type: string, typeOptions: object|null, description: string|null, isComputed: boolean }} NormalizedField
 * @typedef {{ id: string, name: string, primaryFieldId: string|null, fields: NormalizedField[] }} NormalizedTable
 */
