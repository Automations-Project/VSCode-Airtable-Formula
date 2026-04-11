#!/usr/bin/env node
/**
 * Live integration test — runs real operations against your Airtable base.
 * Uses the persistent Chrome profile (must be logged in via `npm run login`).
 *
 * Usage: node test/test-live.js
 */

import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';

const APP_ID = 'appGPLAKpvUTgTRsx';
const TABLE_ID = 'tblYjbJnlwtKOK7ab';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

let passed = 0, failed = 0;
const cleanup = []; // track IDs to clean up

async function test(name, fn) {
  process.stdout.write(`  ${C.dim}⏳${C.reset} ${name}...`);
  try {
    const result = await fn();
    passed++;
    console.log(`\r  ${C.green}✓${C.reset} ${name}${result ? ` ${C.dim}(${result})${C.reset}` : ''}`);
    return true;
  } catch (err) {
    failed++;
    console.log(`\r  ${C.red}✗${C.reset} ${name}`);
    console.log(`    ${C.red}${err.message}${C.reset}`);
    return false;
  }
}

(async () => {
  console.log(`\n${C.bold}${C.cyan}═══ Live Integration Tests ═══${C.reset}\n`);
  console.log(`  Base: ${APP_ID}`);
  console.log(`  Table: ${TABLE_ID}\n`);

  const auth = new AirtableAuth();
  const client = new AirtableClient(auth);

  try {
    // ─── Auth & Read Tests ──────────────────────────────────────
    console.log(`${C.bold}Auth & Reads${C.reset}`);

    await test('Session init & verify', async () => {
      await auth.init();
      return `userId: ${auth.userId || 'not in payload'}`;
    });

    let tables;
    await test('getApplicationData (full schema)', async () => {
      const data = await client.getApplicationData(APP_ID);
      tables = data?.data?.tableSchemas || data?.data?.tables || [];
      return `${tables.length} tables`;
    });

    await test('getApplicationData (cached hit)', async () => {
      const t0 = Date.now();
      await client.getApplicationData(APP_ID);
      const ms = Date.now() - t0;
      if (ms > 50) throw new Error(`Cache miss? Took ${ms}ms`);
      return `${ms}ms (cached)`;
    });

    await test('getScaffoldingData', async () => {
      const data = await client.getScaffoldingData(APP_ID);
      return `got scaffolding`;
    });

    await test('resolveTable by ID', async () => {
      const t = await client.resolveTable(APP_ID, TABLE_ID);
      return `"${t.name}"`;
    });

    await test('resolveTable by name', async () => {
      const name = tables[0]?.name;
      if (!name) throw new Error('No tables');
      const t = await client.resolveTable(APP_ID, name);
      return `${t.id}`;
    });

    // ─── Field Mutation Tests ───────────────────────────────────
    console.log(`\n${C.bold}Field Mutations${C.reset}`);

    let createdFieldId;
    await test('createField (text)', async () => {
      const result = await client.createField(APP_ID, TABLE_ID, {
        name: '🧪 Live Test Field',
        type: 'text',
        typeOptions: {},
        description: 'Created by live integration test',
      });
      createdFieldId = result.columnId;
      cleanup.push({ type: 'field', id: createdFieldId, name: '🧪 Live Test Renamed' });
      return `fld: ${createdFieldId}`;
    });

    if (createdFieldId) {
      await test('renameField', async () => {
        await client.renameField(APP_ID, createdFieldId, '🧪 Live Test Renamed');
        return 'renamed';
      });

      await test('updateFieldDescription', async () => {
        await client.updateFieldDescription(APP_ID, createdFieldId, 'Updated description from test');
        return 'description set';
      });

      await test('resolveField (verify rename)', async () => {
        client.cache.invalidate(APP_ID); // force fresh read
        const { field } = await client.resolveField(APP_ID, createdFieldId);
        if (field.name !== '🧪 Live Test Renamed') throw new Error(`Name is "${field.name}"`);
        return `name confirmed`;
      });
    }

    let formulaFieldId;
    await test('createField (formula)', async () => {
      const result = await client.createField(APP_ID, TABLE_ID, {
        name: '🧪 Test Formula',
        type: 'formula',
        typeOptions: { formulaText: '1+1' },
      });
      formulaFieldId = result.columnId;
      cleanup.push({ type: 'field', id: formulaFieldId, name: '🧪 Test Formula' });
      return `fld: ${formulaFieldId}`;
    });

    await test('validateFormula (valid)', async () => {
      const result = await client.validateFormula(APP_ID, TABLE_ID, "'hello'");
      if (!result.valid) throw new Error('Should be valid');
      return `resultType: ${result.resultType}`;
    });

    await test('validateFormula (invalid)', async () => {
      const result = await client.validateFormula(APP_ID, TABLE_ID, '');
      if (result.valid) throw new Error('Should be invalid');
      return `error: ${result.error}`;
    });

    if (formulaFieldId) {
      await test('updateFieldConfig (change formula)', async () => {
        await client.updateFieldConfig(APP_ID, formulaFieldId, {
          type: 'formula',
          typeOptions: { formulaText: '2+2' },
        });
        return 'formula updated to 2+2';
      });
    }

    let clonedFieldId;
    if (createdFieldId) {
      await test('duplicateField', async () => {
        const result = await client.duplicateField(APP_ID, TABLE_ID, createdFieldId);
        clonedFieldId = result.columnId;
        cleanup.push({ type: 'field', id: clonedFieldId, name: '🧪 Live Test Renamed copy' });
        return `cloned to ${clonedFieldId}`;
      });
    }

    // ─── View Mutation Tests ────────────────────────────────────
    console.log(`\n${C.bold}View Mutations${C.reset}`);

    let createdViewId;
    await test('createView (grid)', async () => {
      const result = await client.createView(APP_ID, TABLE_ID, {
        name: '🧪 Test Grid View',
        type: 'grid',
      });
      createdViewId = result.viewId;
      cleanup.push({ type: 'view', id: createdViewId });
      return `viw: ${createdViewId}`;
    });

    if (createdViewId) {
      await test('renameView', async () => {
        await client.renameView(APP_ID, createdViewId, '🧪 Renamed Test View');
        return 'renamed';
      });

      await test('updateViewDescription', async () => {
        await client.updateViewDescription(APP_ID, createdViewId, 'Test view created by integration test');
        return 'description set';
      });

      await test('updateRowHeight', async () => {
        await client.updateRowHeight(APP_ID, createdViewId, 'large');
        return 'set to large';
      });

      if (createdFieldId) {
        await test('showOrHideColumns (hide)', async () => {
          await client.showOrHideColumns(APP_ID, createdViewId, [createdFieldId], false);
          return `hid ${createdFieldId}`;
        });

        await test('showOrHideColumns (show)', async () => {
          await client.showOrHideColumns(APP_ID, createdViewId, [createdFieldId], true);
          return `showed ${createdFieldId}`;
        });

        await test('applySorts', async () => {
          await client.applySorts(APP_ID, createdViewId, [
            { columnId: createdFieldId, ascending: false },
          ]);
          return '1 sort applied (desc)';
        });

        await test('applySorts (clear)', async () => {
          await client.applySorts(APP_ID, createdViewId, []);
          return 'sorts cleared';
        });
      }

      let duplicatedViewId;
      await test('duplicateView', async () => {
        const result = await client.duplicateView(APP_ID, TABLE_ID, createdViewId, '🧪 Duplicated View');
        duplicatedViewId = result.viewId;
        cleanup.push({ type: 'view', id: duplicatedViewId });
        return `viw: ${duplicatedViewId}`;
      });
    }

    // ─── Cleanup ────────────────────────────────────────────────
    console.log(`\n${C.bold}Cleanup${C.reset}`);

    // Delete views first (they might reference fields)
    for (const item of [...cleanup].reverse()) {
      if (item.type === 'view') {
        await test(`deleteView ${item.id}`, async () => {
          await client.deleteView(APP_ID, item.id);
          return 'deleted';
        });
      }
    }

    // Then delete fields
    for (const item of [...cleanup].reverse()) {
      if (item.type === 'field') {
        await test(`deleteField ${item.id} ("${item.name}")`, async () => {
          await client.deleteField(APP_ID, item.id, item.name, { force: true });
          return 'deleted';
        });
      }
    }

  } catch (err) {
    console.error(`\n${C.red}Fatal error: ${err.message}${C.reset}`);
    console.error(err.stack);
  } finally {
    await auth.close();
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log(`\n${C.bold}═══════════════════════════════${C.reset}`);
  console.log(`  ${C.green}✓ ${passed} passed${C.reset}  ${failed > 0 ? `${C.red}✗ ${failed} failed${C.reset}` : ''}`);
  console.log(`${C.bold}═══════════════════════════════${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
})();
