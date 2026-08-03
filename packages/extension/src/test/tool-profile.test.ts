import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const state = vi.hoisted(() => ({
  home: `${process.env.TEMP || process.cwd()}/airtable-tool-profile-${process.pid}`,
  values: {} as Record<string, unknown>,
  explicit: new Set<string>(),
  defaults: {
    'mcp.toolProfile': 'safe-write',
    'mcp.categories.localWrite': true,
    'mcp.tools': {},
  } as Record<string, unknown>,
}));

vi.mock('node:os', () => ({
  homedir: () => state.home,
}));

vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (key: string, fallback?: unknown) =>
        key in state.values ? state.values[key] : (key in state.defaults ? state.defaults[key] : fallback),
      inspect: (key: string) => ({
        key,
        defaultValue: state.defaults[key],
        globalValue: state.explicit.has(key) ? state.values[key] : undefined,
      }),
      update: async (key: string, value: unknown) => {
        state.values[key] = value;
        state.explicit.add(key);
      },
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(),
  },
  window: { showTextDocument: vi.fn() },
}));

import { ToolProfileManager } from '../mcp/tool-profile.js';

const configDir = path.join(state.home, '.airtable-user-mcp');
const configFile = path.join(configDir, 'tools-config.json');

async function initializeWithCustomTools(customTools: Record<string, boolean>) {
  fs.writeFileSync(configFile, JSON.stringify({ activeProfile: 'custom', customTools }));
  const manager = new ToolProfileManager();
  await manager.init();
  const snapshot = manager.getSnapshot();
  const report = manager.renderStatusReport();
  manager.dispose();
  return { saved: JSON.parse(fs.readFileSync(configFile, 'utf8')), snapshot, report };
}

describe('ToolProfileManager legacy custom-profile migration', () => {
  beforeEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    state.values = { 'mcp.toolProfile': 'custom' };
    state.explicit = new Set(['mcp.toolProfile']);
  });

  afterEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('keeps a new category disabled when an older on-disk custom profile has no tool keys for it', async () => {
    const { saved, snapshot } = await initializeWithCustomTools({ list_tables: true });
    expect(saved.customTools.download_formula_field).toBe(false);
    expect(saved.customTools.download_base_formulas).toBe(false);
    expect(snapshot.enabledCount).toBe(67);
  });

  it('preserves explicit disabled values from the older on-disk custom profile', async () => {
    const { saved, snapshot } = await initializeWithCustomTools({
      download_formula_field: false,
      download_base_formulas: false,
    });
    expect(saved.customTools.download_formula_field).toBe(false);
    expect(saved.customTools.download_base_formulas).toBe(false);
    expect(snapshot.enabledCount).toBe(67);
  });

  it('preserves mixed per-tool values instead of widening the whole new category', async () => {
    const { saved, snapshot, report } = await initializeWithCustomTools({
      download_formula_field: true,
      download_base_formulas: false,
    });
    expect(saved.customTools.download_formula_field).toBe(true);
    expect(saved.customTools.download_base_formulas).toBe(false);
    expect(snapshot.enabledCount).toBe(68);
    expect(report).toContain('on  download_formula_field');
    expect(report).toContain('off download_base_formulas');
  });

  it('lets an explicit VS Code category setting override missing legacy file keys', async () => {
    state.values['mcp.categories.localWrite'] = true;
    state.explicit.add('mcp.categories.localWrite');
    const { saved } = await initializeWithCustomTools({});
    expect(saved.customTools.download_formula_field).toBe(true);
    expect(saved.customTools.download_base_formulas).toBe(true);
  });

  it('lets an explicit disabled VS Code category override enabled legacy file keys', async () => {
    state.values['mcp.categories.localWrite'] = false;
    state.explicit.add('mcp.categories.localWrite');
    const { saved } = await initializeWithCustomTools({
      download_formula_field: true,
      download_base_formulas: true,
    });
    expect(saved.customTools.download_formula_field).toBe(false);
    expect(saved.customTools.download_base_formulas).toBe(false);
  });

  it('treats absent keys in a new category as disabled during file-to-settings sync', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { list_tables: true },
    }));
    const manager = new ToolProfileManager();

    await manager.syncFileToSettings();
    manager.dispose();

    expect(state.values['mcp.categories.localWrite']).toBe(false);
    expect(state.values['mcp.categories.read']).toBe(true);
    expect(state.values['mcp.categories.daemon']).toBe(false);
    expect((state.values['mcp.tools'] as Record<string, boolean>).list_tables).toBe(true);
    expect((state.values['mcp.tools'] as Record<string, boolean>).manage_daemon).toBe(false);
  });

  it('lets a category toggle replace migration-created per-tool overrides', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { list_tables: true },
    }));
    const manager = new ToolProfileManager();
    await manager.init();

    await manager.toggleCategory('localWrite', true);
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.customTools.download_formula_field).toBe(true);
    expect(saved.customTools.download_base_formulas).toBe(true);
  });

  it('persists one atomic custom profile when toggling from a built-in profile', async () => {
    state.values = { 'mcp.toolProfile': 'safe-write' };
    state.explicit = new Set(['mcp.toolProfile']);
    fs.writeFileSync(configFile, JSON.stringify({ activeProfile: 'safe-write', customTools: {} }));
    const manager = new ToolProfileManager();
    await manager.init();

    await manager.toggleCategory('daemon', true);
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.activeProfile).toBe('custom');
    expect(saved.customTools.manage_daemon).toBe(true);
  });
});
