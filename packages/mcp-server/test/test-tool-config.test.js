import { describe, it, before, after } from 'node:test';
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
    assert.equal(tools.length, 61, `Expected 61 tools, got ${tools.length}`);
    for (const [tool, cat] of Object.entries(TOOL_CATEGORIES)) {
      assert.ok(CATEGORY_LABELS[cat], `Tool "${tool}" has unknown category "${cat}"`);
    }
  });

  it('has correct read tools', () => {
    const readTools = Object.entries(TOOL_CATEGORIES)
      .filter(([, cat]) => cat === 'read')
      .map(([name]) => name);
    assert.deepEqual(readTools.sort(), [
      'get_base_schema', 'get_table_schema', 'get_view', 'list_fields', 'list_record_templates', 'list_tables', 'list_view_sections', 'list_views', 'validate_formula',
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
    assert.deepEqual(BUILTIN_PROFILES['read-only'].categories, ['read']);
  });

  it('safe-write excludes destructive categories', () => {
    const cats = BUILTIN_PROFILES['safe-write'].categories;
    assert.ok(!cats.includes('field-destructive'));
    assert.ok(!cats.includes('view-destructive'));
    assert.ok(!cats.includes('table-destructive'));
    assert.ok(!cats.includes('extension'));
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

    it('enables all 61 tools on full profile', () => {
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 61);
    });

    it('manage_tools is always enabled', () => {
      assert.ok(mgr.isToolEnabled('manage_tools'));
    });
  });

  describe('enabledToolNames() for each profile', () => {
    it('read-only enables only 9 read tools', async () => {
      await mgr.switchProfile('read-only');
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 9);
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
    });

    it('full enables all 61 tools', async () => {
      await mgr.switchProfile('full');
      const enabled = mgr.enabledToolNames();
      assert.equal(enabled.size, 61);
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
    it('returns status for all 61 tools', async () => {
      await mgr.switchProfile('full');
      const status = mgr.getToolStatus();
      assert.equal(status.length, 61);
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
