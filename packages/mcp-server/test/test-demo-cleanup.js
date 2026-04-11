#!/usr/bin/env node
/** Quick cleanup — removes fields/views by name pattern */
import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';

const APP_ID = 'appGPLAKpvUTgTRsx';
const TABLE_ID = 'tblYjbJnlwtKOK7ab';
const DEMO_NAMES = ['Priority Score', 'Days Open', 'Status Icon', 'Task Summary'];
const DEMO_VIEW_PREFIXES = ['🏃', '✅', '👤'];

(async () => {
  const auth = new AirtableAuth();
  const client = new AirtableClient(auth);
  try {
    await auth.init();
    const data = await client.getApplicationData(APP_ID);
    const table = (data?.data?.tableSchemas || data?.data?.tables || []).find(t => t.id === TABLE_ID);
    const fields = table.columns || table.fields || [];
    const views = table.views || [];

    // Delete demo views
    for (const v of views) {
      if (DEMO_VIEW_PREFIXES.some(p => v.name.startsWith(p))) {
        console.log(`Deleting view: ${v.name} (${v.id})`);
        await client.deleteView(APP_ID, v.id);
      }
    }
    // Delete demo fields
    for (const f of fields) {
      if (DEMO_NAMES.includes(f.name)) {
        console.log(`Deleting field: ${f.name} (${f.id})`);
        await client.deleteField(APP_ID, f.id, f.name, { force: true });
      }
    }
    console.log('Cleanup done.');
  } finally {
    await auth.close();
  }
})();
