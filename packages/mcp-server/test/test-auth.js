#!/usr/bin/env node
/**
 * Test auth using Playwright persistent context.
 */
import { AirtableAuth } from '../src/auth.js';
import { AirtableClient } from '../src/client.js';

async function main() {
  console.log('=== Airtable Auth Test ===\n');

  const auth = new AirtableAuth();
  const client = new AirtableClient(auth);

  try {
    // Step 1: Init & verify session
    console.log('--- Step 1: Init & Verify Session ---');
    await auth.init();
    console.log('✅ Session active. User:', auth.userId);

    // Step 2: getUserProperties
    console.log('\n--- Step 2: Get User Properties ---');
    const props = await client.getUserProperties();
    console.log('✅ getUserProperties:', JSON.stringify(props).substring(0, 200));

    // Step 3: getApplicationData
    const testAppId = 'appGPLAKpvUTgTRsx';
    console.log(`\n--- Step 3: Get Base Schema (${testAppId}) ---`);
    const appData = await client.getApplicationData(testAppId);
    const tables = appData?.data?.tableSchemas || appData?.data?.tables || [];
    console.log('✅ Found', tables.length, 'tables');
    for (const t of tables) {
      const fields = t.columns || t.fields || [];
      console.log(`   Table: ${t.name} (${t.id}) - ${fields.length} fields`);
      for (const f of fields) {
        console.log(`     - ${f.name} [${f.type}] (${f.id})`);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await auth.close();
  }

  console.log('\n=== Test Complete ===');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
