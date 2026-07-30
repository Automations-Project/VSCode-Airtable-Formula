/**
 * Upload attachments by URL into Airtable attachment cells.
 *
 * Factored out of index.js so the core loop is unit-testable without network
 * and without a real client.
 *
 * Delegates entirely to client.addAttachmentByUrl — Airtable's servers fetch
 * each URL (the UI's "Add attachment → Add URL" flow). No bytes are proxied
 * through this server.
 */

/**
 * Bulk "upload attachment by URL". Airtable's servers fetch each URL
 * (via client.addAttachmentByUrl). Per-update isolation: one failure does
 * not abort the rest.
 *
 * @param {object} client - AirtableClient (must have addAttachmentByUrl)
 * @param {string} appId
 * @param {{rowId:string, columnId:string, url:string, filename?:string}[]} updates
 * @returns {Promise<{uploaded:Array, failed:Array}>}
 */
export async function uploadAttachmentsByUrl(client, appId, updates) {
  const uploaded = [];
  const failed = [];
  for (const u of updates || []) {
    const { rowId, columnId, url, filename } = u || {};
    if (!rowId || !columnId || !url) {
      failed.push({ rowId: rowId ?? null, columnId: columnId ?? null, error: 'rowId, columnId, and url are required' });
      continue;
    }
    try {
      const res = await client.addAttachmentByUrl(appId, rowId, columnId, { url, filename });
      if (res && res.ok) uploaded.push({ rowId, columnId, attachmentId: res.attachmentId, url: res.url });
      else failed.push({ rowId, columnId, error: (res && res.error) || 'unknown error' });
    } catch (err) {
      failed.push({ rowId, columnId, error: String(err?.message || err) });
    }
  }
  return { uploaded, failed };
}
