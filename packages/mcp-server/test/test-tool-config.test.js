import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test ToolConfigManager by importing the module and overriding the config path
// via a lightweight approach: test the class logic directly.

import {
  ToolConfigManager,
  TOOL_CATEGORIES,
  CATEGORY_LABELS,
  BUILTIN_PROFILES,
} from '../src/tool-config.js';

describe('TOOL_CATEGORIES', () => {
  it('maps all tools to valid categories', () => {
    const tools = Object.keys(TOOL_CATEGORIES);
    assert.equal(tools.length, 72, `Expected 72 tools, got ${tools.length}`);
    for (const [tool, cat] of Object.entries(TOOL_CATEGORIES)) {
      assert.ok(CATEGORY_LABELS[cat], `Tool "${tool}" has unknown category "${cat}"`);
    }
  });

  it('has correct read tools', () => {
    const readTools = Object.entries(TOOL_CATEGORIES)
      .filter(([, cat]) => cat === 'read')
      .map(([name]) => name);
    assert.deepEqual(readTools.sort(), [
      'download_base_formulas', 'download_formula_field', 'get_base_schema', 'get_table_schema', 'get_view', 'list_fields', 'list_record_templates', 'list_tables', 'list_view_sections', 'list_views', 'validate_formula',
    ]);
  });

  it('has destructive tools flagged correctly', () => {
    assert.equal(TOOL_CATEGORIES.delete_field, 'field-destructive');
    assert.equal(TOOL_CATEGORIES.delete_view, 'view-destructive');
    assert.equal(TOOL_CATEGORIES.delete_table, 'table-destructive');
  });

  it('has table tools flagged correctly', () => {
    assert.equal(TOOL_CATEGORIES.create_table, 'table-write');
    assert.equal(TOOL_CATEGORIES.rename_table, 'table-write');
  });
});

describe('BUILTIN_PROFILES', () => {
  it('has read-only, safe-write, and full profiles', () => {
    assert.ok(BUILTIN_PROFILES['read-only']);
    assert.ok(BUILTIN_PROFILES['safe-write']);
    assert.ok(BUILTIN_PROFILES['full']);
  });

  it('read-only only includes read category', () => {
    assert.deepEqual(BUILTIN_PROFILES['read-only'].categories, ['read', 'record-read']);
  });

  it('safe-write excludes destructive categories', () => {
    const cats = BUILTIN_PROFILES['safe-write'].categories;
    assert.ok(!cats.includes('field-destructive'));
    assert.ok(!cats.includes('record-destructive'));
    assert.ok(!cats.includes('view-destructive'));
    assert.ok(!cats.includes('table-destructive'));
    assert.ok(!cats.includes('extension'));
  });

  it('safe-write excludes sync (sync_base can delete tables/fields/views/records via mode=apply)', () => {
    const cats = BUILTIN_PROFILES['safe-write'].categories;
    assert.ok(!cats.includes('sync'), 'safe-write must not silently expose sync_base');
  });

  it('daemon is full-profile only (manage_daemon can stop the server the caller is talking through)', () => {
    assert.ok(!BUILTIN_PROFILES['read-only'].categories.includes('daemon'));
    assert.ok(!BUILTIN_PROFILES['safe-write'].categories.includes('daemon'),
      'safe-write must not expose manage_daemon — stop/restart/token_rotate are not "safe writes"');
    assert.ok(BUILTIN_PROFILES['full'].categories.includes('daemon'));
  });

  it('full includes all categories', () => {
    const cats = new Set(BUILTIN_PROFILES['full'].categories);
    for (const cat of Object.keys(CATEGORY_LABELS)) {
      assert.ok(cats.has(cat), `Full profile missing category "${cat}"`);
    }
  });
});

describe('ToolConfigManager', () => {
  let mgr;

  before(() => {
    mgr = new ToolConfigManager();
  });

  describe('default state', () => {
    it('defaults to full profile', () => {
      assert.equal(mgr.activeProfile, 'full');
    });

    it('enables all 72 tools on full profile', () => {
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 72);
    });

    it('manage_tools is always enabled', () => {
      assert.ok(mgr.isToolEnabled('manage_tools'));
    });
  });

  describe('enabledToolNames() for each profile', () => {
    it('read-only enables only 12 read tools', async () => {
      await mgr.switchProfile('read-only');
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 12);
      assert.ok(enabled.has('get_base_schema'));
      assert.ok(enabled.has('get_view'));
      assert.ok(enabled.has('validate_formula'));
      assert.ok(!enabled.has('create_field'));
      assert.ok(!enabled.has('delete_field'));
      assert.ok(!enabled.has('create_table'));
      assert.ok(!enabled.has('delete_table'));
    });

    it('safe-write enables read + table-write + field-write + view-write', async () => {
      await mgr.switchProfile('safe-write');
      const enabled = mgr.enabledToolNames();
      assert.ok(enabled.has('get_base_schema'));
      assert.ok(enabled.has('create_table'));
      assert.ok(enabled.has('rename_table'));
      assert.ok(enabled.has('create_field'));
      assert.ok(enabled.has('create_view'));
      assert.ok(!enabled.has('delete_table'));
      assert.ok(!enabled.has('delete_field'));
      assert.ok(!enabled.has('delete_view'));
      assert.ok(!enabled.has('create_extension'));
      assert.ok(enabled.has('create_records'));
      assert.ok(enabled.has('update_records'));
      assert.ok(!enabled.has('delete_records'));
      assert.ok(!enabled.has('sync_base'), 'sync must not be in safe-write — its mode=apply can delete records/schema');
    });

    it('full enables all 72 tools', async () => {
      await mgr.switchProfile('full');
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 72);
    });

    it('unknown profile fails closed to read-only', async () => {
      // switchProfile() rejects unknown names, so simulate a hand-edited /
      // tampered tools-config.json by mutating loaded state directly.
      mgr._config.activeProfile = 'totally-bogus';
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 12, 'must match the read-only tool count');
      assert.ok(enabled.has('get_base_schema'));
      assert.ok(!enabled.has('delete_table'));
      assert.ok(!enabled.has('delete_field'));
      assert.ok(!enabled.has('create_table'));
      await mgr.switchProfile('full');
    });
  });

  describe('switchProfile()', () => {
    it('rejects unknown profiles', async () => {
      await assert.rejects(() => mgr.switchProfile('nonexistent'), /Unknown profile/);
    });

    it('returns changed=true on profile change', async () => {
      await mgr.switchProfile('full');
      const result = await mgr.switchProfile('read-only');
      assert.equal(result.changed, true);
      assert.equal(result.activeProfile, 'read-only');
    });

    it('returns changed=false when same profile', async () => {
      await mgr.switchProfile('full');
      const result = await mgr.switchProfile('full');
      assert.equal(result.changed, false);
    });
  });

  describe('toggleTool()', () => {
    it('auto-switches to custom profile', async () => {
      await mgr.switchProfile('full');
      await mgr.toggleTool('delete_field', false);
      assert.equal(mgr.activeProfile, 'custom');
      assert.ok(!mgr.isToolEnabled('delete_field'));
      // Other tools should still be enabled
      assert.ok(mgr.isToolEnabled('get_base_schema'));
      assert.ok(mgr.isToolEnabled('create_field'));
    });

    it('rejects unknown tool names', async () => {
      await assert.rejects(() => mgr.toggleTool('nonexistent_tool', true), /Unknown tool/);
    });
  });

  describe('toggleCategory()', () => {
    it('disables entire category', async () => {
      await mgr.switchProfile('full');
      await mgr.toggleCategory('extension', false);
      assert.equal(mgr.activeProfile, 'custom');
      assert.ok(!mgr.isToolEnabled('create_extension'));
      assert.ok(!mgr.isToolEnabled('remove_extension'));
      // Other categories unaffected
      assert.ok(mgr.isToolEnabled('get_base_schema'));
    });

    it('rejects unknown categories', async () => {
      await assert.rejects(() => mgr.toggleCategory('nonexistent', true), /Unknown category/);
    });
  });

  describe('filterTools()', () => {
    it('filters tool array to only enabled ones', async () => {
      await mgr.switchProfile('read-only');
      const mockTools = [
        { name: 'get_base_schema' },
        { name: 'delete_field' },
        { name: 'create_view' },
      ];
      const filtered = mgr.filterTools(mockTools);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].name, 'get_base_schema');
    });
  });

  describe('getToolStatus()', () => {
    it('returns status for all 72 tools', async () => {
      await mgr.switchProfile('full');
      const status = mgr.getToolStatus();
      assert.equal(status.length, 72);
      assert.ok(status.every(s => s.enabled === true));
    });

    it('reflects disabled tools', async () => {
      await mgr.switchProfile('read-only');
      const status = mgr.getToolStatus();
      const deleteField = status.find(s => s.name === 'delete_field');
      assert.ok(deleteField);
      assert.equal(deleteField.enabled, false);
      assert.equal(deleteField.category, 'field-destructive');
    });
  });

  describe('listProfiles()', () => {
    it('returns 4 profiles (3 builtin + custom)', () => {
      const profiles = mgr.listProfiles();
      assert.equal(profiles.length, 4);
      const names = profiles.map(p => p.name);
      assert.ok(names.includes('read-only'));
      assert.ok(names.includes('safe-write'));
      assert.ok(names.includes('full'));
      assert.ok(names.includes('custom'));
    });
  });
});

describe('record-write tools', () => {
  it('maps create/update_records to record-write and delete_records to record-destructive', () => {
    assert.equal(TOOL_CATEGORIES.create_records, 'record-write');
    assert.equal(TOOL_CATEGORIES.update_records, 'record-write');
    assert.equal(TOOL_CATEGORIES.delete_records, 'record-destructive');
  });
});

describe('sync tools', () => {
  it('maps sync_base to the sync category', () => {
    assert.equal(TOOL_CATEGORIES.sync_base, 'sync');
  });
});

describe('daemon tools', () => {
  it('maps manage_daemon to the daemon category', () => {
    assert.equal(TOOL_CATEGORIES.manage_daemon, 'daemon');
  });
});

describe('legacy on-disk custom config — new categories must not silently widen', () => {
  // Regression coverage for: a ~/.airtable-user-mcp/tools-config.json with
  // activeProfile:"custom" written before the `sync`, `record-destructive` and
  // `daemon` categories existed has NO key at all for sync_base /
  // delete_records / manage_daemon in its customTools map. enabledToolNames()'s
  // "absent key → enabled" default must not silently grant those tools on
  // upgrade. This passes because none of those categories is in
  // LEGACY_CATEGORIES_DEFAULT_ON — that allowlist is frozen deliberately, so
  // fixing a failure here by adding the new category to it would defeat the
  // whole guard.
  const ENV_KEY = 'AIRTABLE_USER_MCP_HOME';
  let prevHome;
  let tmpHome;

  beforeEach(async () => {
    prevHome = process.env[ENV_KEY];
    tmpHome = join(tmpdir(), `tool-config-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpHome, { recursive: true });
    process.env[ENV_KEY] = tmpHome;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('an old custom config with no sync_base/delete_records/manage_daemon key keeps them disabled', async () => {
    // Simulate a pre-existing config: activeProfile "custom" with explicit
    // per-tool overrides for tools that existed at the time it was written,
    // but no entry whatsoever for sync_base / delete_records.
    const legacyConfig = {
      activeProfile: 'custom',
      customTools: {
        get_base_schema: true,
        create_table: true,
        delete_field: false,
      },
    };
    await writeFile(join(tmpHome, 'tools-config.json'), JSON.stringify(legacyConfig), 'utf8');

    const mgr = new ToolConfigManager();
    await mgr.load();
    const enabled = mgr.enabledToolNames();

    assert.ok(!enabled.has('sync_base'), 'sync_base must default to DISABLED for a pre-existing custom config');
    assert.ok(!enabled.has('delete_records'), 'delete_records must default to DISABLED for a pre-existing custom config');
    assert.ok(!enabled.has('manage_daemon'), 'manage_daemon must default to DISABLED for a pre-existing custom config');

    // Legacy behavior is preserved for already-known categories: a tool the
    // user never explicitly toggled (e.g. create_field, part of field-write)
    // still defaults to enabled, and an explicit false override still wins.
    assert.ok(enabled.has('create_field'), 'unrelated tools in pre-existing categories must keep defaulting to enabled');
    assert.ok(enabled.has('get_base_schema'));
    assert.ok(enabled.has('create_table'));
    assert.ok(!enabled.has('delete_field'), 'explicit false override must still be honored');
  });

  it('toggleTool on an absent-key tool reports changed (fires tools/list_changed)', async () => {
    // Same legacy shape as above: sync_base has no key, so it currently
    // resolves to disabled. Toggling it to true is a REAL change and must be
    // notified. With the old `customTools[tool] !== false` computation for
    // `prev`, an absent key read as `prev = true` (since `undefined !==
    // false`), so this came out as changed=false and no notification fired
    // even though the tool became enabled and the change was persisted —
    // connected MCP clients would keep a stale tool list for the session.
    const legacyConfig = { activeProfile: 'custom', customTools: { get_base_schema: true } };
    await writeFile(join(tmpHome, 'tools-config.json'), JSON.stringify(legacyConfig), 'utf8');

    const mgr = new ToolConfigManager();
    await mgr.load();
    assert.ok(!mgr.enabledToolNames().has('sync_base'), 'sanity: starts disabled');

    let notifyCount = 0;
    mgr.bindServer({ sendToolListChanged: () => { notifyCount++; } });

    await mgr.toggleTool('sync_base', true);

    assert.ok(mgr.enabledToolNames().has('sync_base'), 'sync_base is now enabled');
    assert.equal(notifyCount, 1, 'tools/list_changed must fire — the effective tool set changed');
  });

  it('toggleTool on an absent-key tool does not fire a spurious notification when the value already matches the resolved default', async () => {
    // Mirror case named in the finding: toggling an absent-key tool to the
    // value it already effectively has (false, since sync is not in
    // LEGACY_CATEGORIES_DEFAULT_ON) is NOT a real change and must not notify.
    const legacyConfig = { activeProfile: 'custom', customTools: { get_base_schema: true } };
    await writeFile(join(tmpHome, 'tools-config.json'), JSON.stringify(legacyConfig), 'utf8');

    const mgr = new ToolConfigManager();
    await mgr.load();

    let notifyCount = 0;
    mgr.bindServer({ sendToolListChanged: () => { notifyCount++; } });

    await mgr.toggleTool('sync_base', false);

    assert.ok(!mgr.enabledToolNames().has('sync_base'));
    assert.equal(notifyCount, 0, 'no real change occurred — must not notify');
  });

  it('toggleCategory on an absent-key category reports changed for a legacy config', async () => {
    const legacyConfig = { activeProfile: 'custom', customTools: { get_base_schema: true } };
    await writeFile(join(tmpHome, 'tools-config.json'), JSON.stringify(legacyConfig), 'utf8');

    const mgr = new ToolConfigManager();
    await mgr.load();

    let notifyCount = 0;
    mgr.bindServer({ sendToolListChanged: () => { notifyCount++; } });

    await mgr.toggleCategory('sync', true);

    assert.ok(mgr.enabledToolNames().has('sync_base'));
    assert.equal(notifyCount, 1, 'tools/list_changed must fire — the category actually changed');
  });
});
