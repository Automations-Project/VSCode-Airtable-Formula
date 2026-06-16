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
      };
    }),
  };
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
  return { baseId: appId, ...normalizeSchema(raw) };
}

/**
 * @typedef {{ id: string, name: string, type: string, typeOptions: object|null, description: string|null, isComputed: boolean }} NormalizedField
 * @typedef {{ id: string, name: string, primaryFieldId: string|null, fields: NormalizedField[] }} NormalizedTable
 */
