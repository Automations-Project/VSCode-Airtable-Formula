import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const state = vi.hoisted(() => ({
  home: `${process.env.TEMP || process.cwd()}/airtable-tool-profile-${process.pid}`,
  values: {} as Record<string, unknown>,
  explicit: new Set<string>(),
  configListeners: [] as Array<(e: { affectsConfiguration(section: string): boolean }) => unknown>,
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
    onDidChangeConfiguration: vi.fn((listener: (e: { affectsConfiguration(section: string): boolean }) => unknown) => {
      state.configListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    openTextDocument: vi.fn(),
  },
  window: { showTextDocument: vi.fn() },
}));

import { ToolProfileManager } from '../mcp/tool-profile.js';

const configDir = path.join(state.home, '.airtable-user-mcp');
const configFile = path.join(configDir, 'tools-config.json');

/** Mirrors VS Code's segment-based ConfigurationChangeEvent for a set of changed keys. */
async function fireConfigChange(...changedKeys: string[]) {
  const event = {
    affectsConfiguration: (section: string) =>
      changedKeys.some((key) => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`)),
  };
  for (const listener of [...state.configListeners]) await listener(event);
}

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

describe('ToolProfileManager settings-sync suppression', () => {
  beforeEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    state.values = { 'mcp.toolProfile': 'custom' };
    state.explicit = new Set(['mcp.toolProfile']);
    state.configListeners = [];
  });

  afterEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('persists a toggle that lands inside the syncFileToSettings suppress window', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { list_tables: true },
    }));
    const manager = new ToolProfileManager();

    // syncFileToSettings leaves _suppressSettingsSync latched for its 200ms
    // echo window. A toggle started inside that window is a deliberate user
    // action — persisting it to the file is the point of the toggle, so it
    // must not be skipped just because suppression was already active.
    await manager.syncFileToSettings();
    await manager.toggleCategory('daemon', true);
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.activeProfile).toBe('custom');
    expect(saved.customTools.manage_daemon).toBe(true);
  });

  it('overlapping toggles do not latch settings-sync suppression', async () => {
    const manager = new ToolProfileManager();

    // Webview messages aren't serialized — two toggles can interleave (rapid
    // double-click). The second captures the first's in-flight suppression;
    // restoring "what was there before" then leaves the flag latched true
    // forever once both complete, with no pending timer to clear it.
    await Promise.all([
      manager.toggleCategory('daemon', true),
      manager.toggleCategory('sync', true),
    ]);

    // With a latched flag every later syncSettingsToFile() is a silent no-op.
    state.values['mcp.categories.daemon'] = false;
    await manager.syncSettingsToFile();
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.customTools.manage_daemon).toBe(false);
    expect(saved.customTools.sync_base).toBe(true);
  });
});

describe('ToolProfileManager native settings category edits', () => {
  beforeEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    state.values = { 'mcp.toolProfile': 'custom' };
    state.explicit = new Set(['mcp.toolProfile']);
    state.configListeners = [];
  });

  afterEach(() => {
    fs.rmSync(state.home, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('a category disabled in native settings wins over stale migration overrides', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { list_tables: true, manage_daemon: true },
    }));
    const manager = new ToolProfileManager();
    await manager.init();
    // Migration seeded categories.daemon=true plus a manage_daemon override —
    // confirm the seed so the assertion below isn't vacuous.
    expect((state.values['mcp.tools'] as Record<string, boolean>).manage_daemon).toBe(true);

    // settings.json / native Settings UI edit: flips only the category —
    // never routes through toggleCategory.
    state.values['mcp.categories.daemon'] = false;
    state.explicit.add('mcp.categories.daemon');
    await fireConfigChange('airtableFormula.mcp.categories.daemon');
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.customTools.manage_daemon).toBe(false);
    expect((state.values['mcp.tools'] as Record<string, boolean>).manage_daemon).toBeUndefined();
  });

  it('a category enabled in native settings wins over migrated all-off overrides', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { list_tables: true },
    }));
    const manager = new ToolProfileManager();
    await manager.init();
    expect((state.values['mcp.tools'] as Record<string, boolean>).sync_base).toBe(false);

    state.values['mcp.categories.sync'] = true;
    state.explicit.add('mcp.categories.sync');
    await fireConfigChange('airtableFormula.mcp.categories.sync');
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(saved.customTools.sync_base).toBe(true);
  });

  it('per-tool override edits keep winning over an unchanged category', async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      activeProfile: 'custom',
      customTools: { download_formula_field: true, download_base_formulas: false },
    }));
    const manager = new ToolProfileManager();
    await manager.init();

    // Edit only mcp.tools: flip one download tool by hand.
    state.values['mcp.tools'] = {
      ...(state.values['mcp.tools'] as Record<string, boolean>),
      download_base_formulas: true,
    };
    state.explicit.add('mcp.tools');
    await fireConfigChange('airtableFormula.mcp.tools');
    manager.dispose();

    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    // localWrite (mixed at migration → category false) did not change, so the
    // per-tool overrides stay the final authority for both tools.
    expect(saved.customTools.download_formula_field).toBe(true);
    expect(saved.customTools.download_base_formulas).toBe(true);
  });
});
