#!/usr/bin/env node
/**
 * Live demo — builds a "Sprint Board" on top of the existing table.
 * Creates formula fields, configured views with sorts/groups/column visibility.
 *
 * Note: updateViewFilters requires the browser to navigate to the view URL first
 * (Airtable needs the view loaded via WebSocket). We navigate before filtering.
 */

import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';
import fs from 'fs';

const APP_ID = 'appGPLAKpvUTgTRsx';
const TABLE_ID = 'tblYjbJnlwtKOK7ab';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function log(icon, msg, detail) {
  console.log(`  ${icon} ${msg}${detail ? ` ${C.dim}→ ${detail}${C.reset}` : ''}`);
}

(async () => {
  console.log(`\n${C.bold}${C.cyan}═══ Building Sprint Board ═══${C.reset}\n`);

  const auth = new AirtableAuth();
  const client = new AirtableClient(auth);
  const created = { fields: [], views: [] };
  let step = 0;

  try {
    await auth.init();
    log('🔐', 'Authenticated');

    // ─── Read current schema ────────────────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Reading current schema${C.reset}`);
    const data = await client.getApplicationData(APP_ID);
    const table = (data?.data?.tableSchemas || data?.data?.tables || []).find(t => t.id === TABLE_ID);
    const fields = table.columns || table.fields || [];
    const views = table.views || [];

    log('📋', `"${table.name}"`, `${fields.length} fields, ${views.length} views`);

    const statusField = fields.find(f => f.name === 'Status');
    const nameField = fields.find(f => f.name === 'Name');
    if (!statusField || !nameField) throw new Error('Need "Status" and "Name" fields');

    const choices = statusField.typeOptions?.choices || {};
    const selTodo = Object.values(choices).find(c => c.name === 'Todo');
    const selInProg = Object.values(choices).find(c => c.name === 'In progress');
    const selDone = Object.values(choices).find(c => c.name === 'Done');

    // ─── Create formula fields ──────────────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Creating smart formula fields${C.reset}`);

    const priority = await client.createField(APP_ID, TABLE_ID, {
      name: 'Priority Score',
      type: 'formula',
      typeOptions: {
        formulaText: `IF({Status}="Done", 0, IF({Status}="In progress", 2, IF({Status}="Todo", 1, 0)))`,
      },
      description: 'Auto priority: Todo=1, In Progress=2, Done=0',
    });
    created.fields.push({ id: priority.columnId, name: 'Priority Score' });
    log('🔢', 'Priority Score', `Todo=1, In Progress=2, Done=0`);

    const daysOpen = await client.createField(APP_ID, TABLE_ID, {
      name: 'Days Open',
      type: 'formula',
      typeOptions: {
        formulaText: `IF({Status}!="Done", DATETIME_DIFF(NOW(), CREATED_TIME(), 'days'), 0)`,
      },
      description: 'Days since creation (0 when Done)',
    });
    created.fields.push({ id: daysOpen.columnId, name: 'Days Open' });
    log('📅', 'Days Open', 'auto-calculated from CREATED_TIME()');

    const statusIcon = await client.createField(APP_ID, TABLE_ID, {
      name: 'Status Icon',
      type: 'formula',
      typeOptions: {
        formulaText: `IF({Status}="Done", "✅", IF({Status}="In progress", "🔄", IF({Status}="Todo", "📋", "❓")))`,
      },
      description: 'Visual status emoji',
    });
    created.fields.push({ id: statusIcon.columnId, name: 'Status Icon' });
    log('🎨', 'Status Icon', '✅ 🔄 📋 emojis');

    const summary = await client.createField(APP_ID, TABLE_ID, {
      name: 'Task Summary',
      type: 'formula',
      typeOptions: {
        formulaText: `{Status Icon} & " " & {Name} & IF({Days Open}>0, " (" & {Days Open} & "d)", "")`,
      },
      description: 'Icon + Name + Days Open',
    });
    created.fields.push({ id: summary.columnId, name: 'Task Summary' });
    log('📝', 'Task Summary', '✅ Fix bug (3d)');

    // ─── Create "Active Sprint" view ────────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Creating "🏃 Active Sprint" view${C.reset}`);

    const activeView = await client.createView(APP_ID, TABLE_ID, {
      name: '🏃 Active Sprint',
      type: 'grid',
    });
    created.views.push({ id: activeView.viewId, name: '🏃 Active Sprint' });
    log('👁️', 'View created', activeView.viewId);

    // Sort by priority descending (In Progress first)
    await client.applySorts(APP_ID, activeView.viewId, [
      { columnId: priority.columnId, ascending: false },
    ]);
    log('📊', 'Sorted by Priority Score (desc)');

    // Group by status
    await client.updateGroupLevels(APP_ID, activeView.viewId, [
      { columnId: statusField.id, order: 'ascending' },
    ]);
    log('📁', 'Grouped by Status');

    // Set comfortable row height
    await client.updateRowHeight(APP_ID, activeView.viewId, 'medium');
    log('📏', 'Row height: medium');

    // Set description
    await client.updateViewDescription(APP_ID, activeView.viewId,
      'Active sprint — grouped by status, sorted by priority. Add a filter for Todo + In Progress.'
    );
    log('📝', 'Description set');

    // ─── Create "Done Archive" view ─────────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Creating "✅ Done Archive" view${C.reset}`);

    const doneView = await client.createView(APP_ID, TABLE_ID, {
      name: '✅ Done Archive',
      type: 'grid',
    });
    created.views.push({ id: doneView.viewId, name: '✅ Done Archive' });
    log('👁️', 'View created', doneView.viewId);

    // Hide fields not relevant for done items
    await client.showOrHideColumns(APP_ID, doneView.viewId,
      [priority.columnId, daysOpen.columnId], false
    );
    log('👁️‍🗨️', 'Hidden Priority Score & Days Open');

    await client.updateViewDescription(APP_ID, doneView.viewId,
      'Completed tasks archive. Priority & Days Open hidden. Add a filter for Status = Done.'
    );
    log('📝', 'Description set');

    // ─── Create "My Tasks" view ─────────────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Creating "👤 My Tasks" view${C.reset}`);

    const myView = await client.createView(APP_ID, TABLE_ID, {
      name: '👤 My Tasks',
      type: 'grid',
    });
    created.views.push({ id: myView.viewId, name: '👤 My Tasks' });
    log('👁️', 'View created', myView.viewId);

    await client.applySorts(APP_ID, myView.viewId, [
      { columnId: priority.columnId, ascending: false },
      { columnId: statusField.id, ascending: true },
    ]);
    log('📊', 'Sorted by Priority (desc), then Status');

    await client.updateRowHeight(APP_ID, myView.viewId, 'large');
    log('📏', 'Row height: large');

    await client.updateViewDescription(APP_ID, myView.viewId,
      'Personal task view — filter by Assignee to see only your items.'
    );
    log('📝', 'Description set');

    // ─── Demo filter on existing view ─────────────────────────
    step++;
    console.log(`\n${C.bold}Step ${step}: Filter demo on existing view${C.reset}`);

    // Re-extract CSRF (may have rotated after many mutations)
    await auth._extractCsrf();

    const existingView = 'viwbtrPDDsHbsGJ7v';
    if (selTodo && selInProg) {
      try {
        await client.updateViewFilters(APP_ID, existingView, {
          conjunction: 'and',
          filterSet: [{
            id: 'flt' + Math.random().toString(36).substring(2, 16),
            columnId: statusField.id,
            operator: 'isAnyOf',
            value: [selTodo.id, selInProg.id],
          }],
        });
        log('🔍', `Filtered existing view`, 'Todo + In Progress');

        await client.updateViewFilters(APP_ID, existingView, null);
        log('🧹', 'Cleared filter (restored original)');
      } catch (e) {
        log('⚠️', 'Filter demo skipped', e.message.substring(0, 60));
      }
    }

    // ─── Done! ──────────────────────────────────────────────────
    console.log(`\n${C.bold}${C.green}═══════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}${C.green}  ✅ Sprint Board built successfully!${C.reset}`);
    console.log(`${C.bold}${C.green}═══════════════════════════════════════════════${C.reset}`);
    console.log(`\n  ${C.bold}Formula Fields (4):${C.reset}`);
    for (const f of created.fields) {
      console.log(`    🔢 ${f.name} ${C.dim}(${f.id})${C.reset}`);
    }
    console.log(`\n  ${C.bold}Views (3):${C.reset}`);
    for (const v of created.views) {
      console.log(`    👁️  ${v.name} ${C.dim}(${v.id})${C.reset}`);
    }
    console.log(`\n  ${C.cyan}${C.bold}Open your base:${C.reset}`);
    console.log(`  https://airtable.com/${APP_ID}/${TABLE_ID}/${created.views[0]?.id}`);
    console.log(`\n  ${C.yellow}To clean up: node test/test-demo-cleanup.js${C.reset}\n`);

    // Save for cleanup
    fs.writeFileSync('test/.demo-ids.json', JSON.stringify(created, null, 2));

  } catch (err) {
    console.error(`\n${C.red}Error at step ${step}: ${err.message}${C.reset}`);
    console.error(err.stack);
  } finally {
    await auth.close();
  }
})();
