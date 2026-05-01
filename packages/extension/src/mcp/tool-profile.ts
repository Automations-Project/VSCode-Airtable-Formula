import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ToolCategories, ToolProfileName, ToolProfileSnapshot } from '@airtable-formula/shared';

/**
 * MCP Tool Profile Manager (merged in from the legacy `mcp-airtable-tool-manager`
 * VS Code extension that used to live alongside the mcp-server source).
 *
 * Syncs bidirectionally between:
 *   - VS Code settings `airtableFormula.mcp.toolProfile` + `airtableFormula.mcp.categories.*`
 *   - The on-disk config at `~/.airtable-user-mcp/tools-config.json` that the
 *     MCP server reads via `src/tool-config.js::ToolConfigManager`
 *
 * The MCP server watches this file and sends `tools/list_changed` when the
 * active tool set changes, so any profile change from the dashboard is
 * propagated live to running MCP clients.
 */

// These must mirror `packages/mcp-server/src/tool-config.js::TOOL_CATEGORIES`.
// Drift is caught at build time by scripts/check-tool-sync.mjs — don't edit
// this table without also editing the mcp-server source (or vice versa).
type ExtraCategoryKey =
  | 'table-write' | 'table-destructive'
  | 'field-write' | 'field-destructive'
  | 'view-write' | 'view-destructive'
  | 'view-section' | 'view-section-destructive'
  | 'form-write';
export const TOOL_CATEGORIES: Record<string, keyof ToolCategories | ExtraCategoryKey> = {
  // Read-only / inspection
  get_base_schema:           'read',
  list_tables:               'read',
  get_table_schema:          'read',
  list_fields:               'read',
  list_views:                'read',
  get_view:                  'read',
  validate_formula:          'read',
  list_view_sections:        'read',
  list_record_templates:     'read',
  // Table mutations (non-destructive)
  create_table:              'table-write',
  rename_table:              'table-write',
  create_record_template:              'table-write',
  rename_record_template:              'table-write',
  update_record_template_description:  'table-write',
  set_record_template_cell:            'table-write',
  set_record_template_visible_columns: 'table-write',
  duplicate_record_template:           'table-write',
  apply_record_template:               'table-write',
  // Table destructive
  delete_table:              'table-destructive',
  delete_record_template:    'table-destructive',
  // Field mutations (non-destructive)
  create_field:              'field-write',
  create_formula_field:      'field-write',
  update_field_config:       'field-write',
  update_formula_field:      'field-write',
  rename_field:              'field-write',
  update_field_description:  'field-write',
  duplicate_field:           'field-write',
  // Field destructive
  delete_field:              'field-destructive',
  // View mutations
  create_view:               'view-write',
  duplicate_view:            'view-write',
  rename_view:               'view-write',
  update_view_description:   'view-write',
  update_view_filters:       'view-write',
  reorder_view_fields:       'view-write',
  show_or_hide_view_columns: 'view-write',
  apply_view_sorts:          'view-write',
  update_view_group_levels:  'view-write',
  update_view_row_height:    'view-write',
  set_view_columns:          'view-write',
  show_or_hide_all_columns:  'view-write',
  move_visible_columns:      'view-write',
  move_overall_columns:      'view-write',
  update_frozen_column_count:'view-write',
  set_view_cover:            'view-write',
  set_view_color_config:     'view-write',
  set_view_cell_wrap:        'view-write',
  set_calendar_date_columns: 'view-write',
  // View destructive
  delete_view:               'view-destructive',
  // View sections (non-destructive)
  create_view_section:       'view-section',
  rename_view_section:       'view-section',
  move_view_to_section:      'view-section',
  // View sections (destructive)
  delete_view_section:       'view-section-destructive',
  // Form metadata (legacy form views)
  set_form_metadata:                'form-write',
  set_form_submission_notification: 'form-write',
  // Extension management
  create_extension:          'extension',
  create_extension_dashboard:'extension',
  install_extension:         'extension',
  update_extension_state:    'extension',
  rename_extension:          'extension',
  duplicate_extension:       'extension',
  remove_extension:          'extension',
};

export const CATEGORY_LABELS: Record<string, string> = {
  'read':                     'Read / Inspect',
  'table-write':              'Table Write',
  'table-destructive':        'Table Destructive',
  'field-write':              'Field Write',
  'field-destructive':        'Field Destructive',
  'view-write':               'View Write',
  'view-destructive':         'View Destructive',
  'view-section':             'View Sections',
  'view-section-destructive': 'View Sections (destructive)',
  'form-write':               'Form Metadata',
  'extension':                'Extension Management',
};

interface ProfileDef {
  description: string;
  // Uses file-format category keys (kebab-case) to match the on-disk schema
  categories: string[];
}

export const BUILTIN_PROFILES: Record<'read-only' | 'safe-write' | 'full', ProfileDef> = {
  'read-only': { description: 'Schema inspection and formula validation only', categories: ['read'] },
  'safe-write':{ description: 'Read + create/update tables, fields, views, sidebar sections, and record templates (no deletes, no form metadata)',
                 categories: ['read', 'table-write', 'field-write', 'view-write', 'view-section'] },
  full:        { description: 'All tools enabled including destructive ops, form metadata, and extensions',
                 categories: [
                   'read', 'table-write', 'table-destructive',
                   'field-write', 'field-destructive',
                   'view-write', 'view-destructive',
                   'view-section', 'view-section-destructive',
                   'form-write', 'extension',
                 ] },
};

// Settings key suffix → file-format category key
const SETTINGS_TO_CATEGORY: Record<keyof ToolCategories, string> = {
  read:                    'read',
  tableWrite:              'table-write',
  tableDestructive:        'table-destructive',
  fieldWrite:              'field-write',
  fieldDestructive:        'field-destructive',
  viewWrite:               'view-write',
  viewDestructive:         'view-destructive',
  viewSection:             'view-section',
  viewSectionDestructive:  'view-section-destructive',
  formWrite:               'form-write',
  extension:               'extension',
};

// Inverse: file-format category key → settings key suffix
const CATEGORY_TO_SETTINGS: Record<string, keyof ToolCategories> = Object.fromEntries(
  Object.entries(SETTINGS_TO_CATEGORY).map(([k, v]) => [v, k as keyof ToolCategories]),
);

const CONFIG_DIR  = path.join(os.homedir(), '.airtable-user-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'tools-config.json');

interface OnDiskConfig {
  activeProfile: ToolProfileName;
  customTools:   Record<string, boolean>;
}

function defaultConfig(): OnDiskConfig {
  return { activeProfile: 'full', customTools: {} };
}

export class ToolProfileManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<ToolProfileSnapshot>();
  public readonly onDidChange = this._onDidChange.event;

  private _watcher: fs.FSWatcher | undefined;
  private _debounce: ReturnType<typeof setTimeout> | undefined;
  private _suppressSettingsSync = false;
  private _suppressFileSync = false;
  private _configChangeSub: vscode.Disposable | undefined;

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Initialize the profile manager. VS Code settings are treated as the
   * authoritative source on startup — we write the file to match. This
   * guarantees the dashboard UI and the MCP server can never disagree at
   * session start (a stale tools-config.json file from a prior install,
   * the legacy mcp-airtable-tool-manager extension, or manual edits is
   * overwritten).
   *
   * During a session, sync is bidirectional:
   *   - User edits setting in UI   → onDidChangeConfiguration → write file
   *   - MCP server edits file      → file watcher              → write settings
   */
  async init(): Promise<void> {
    await fsp.mkdir(CONFIG_DIR, { recursive: true }).catch(() => { /* ignore */ });

    // Log what we're about to do so the extension host output channel shows
    // the resolved state — invaluable when debugging sync issues later.
    const beforeSnapshot = this.getSnapshot();
    let fileBefore: OnDiskConfig | undefined;
    try { fileBefore = await this._readFile(); } catch { /* file missing is fine */ }
    console.log(
      `[tool-profile] init — settings: ${beforeSnapshot.profile} (${beforeSnapshot.enabledCount}/${beforeSnapshot.totalCount}); ` +
      `file: ${fileBefore ? fileBefore.activeProfile : '<none>'}`
    );

    // Force file to match settings on startup. We skip the suppress flag here
    // intentionally because we WANT the subsequent watcher to not trip — the
    // _writeFile helper already sets _suppressFileSync for 300ms.
    await this.syncSettingsToFile();

    this._attachWatcher();
    this._configChangeSub = vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('airtableFormula.mcp.toolProfile') ||
          e.affectsConfiguration('airtableFormula.mcp.categories') ||
          e.affectsConfiguration('airtableFormula.mcp.tools')) {
        await this.syncSettingsToFile();
      }
    });

    // Fire one final onDidChange so any listener (e.g. the dashboard) gets the
    // authoritative snapshot after init completes.
    this._onDidChange.fire(this.getSnapshot());
  }

  dispose(): void {
    this._configChangeSub?.dispose();
    this._onDidChange.dispose();
    if (this._watcher) { this._watcher.close(); this._watcher = undefined; }
    if (this._debounce) { clearTimeout(this._debounce); this._debounce = undefined; }
  }

  // ─── Public API ─────────────────────────────────────────────

  /** Read the current snapshot from VS Code settings (not the file). */
  getSnapshot(): ToolProfileSnapshot {
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    const profile = (cfg.get<string>('mcp.toolProfile', 'full') as ToolProfileName) ?? 'full';
    const categories: ToolCategories = {
      read:                   cfg.get('mcp.categories.read',                   true),
      tableWrite:             cfg.get('mcp.categories.tableWrite',             true),
      tableDestructive:       cfg.get('mcp.categories.tableDestructive',       true),
      fieldWrite:             cfg.get('mcp.categories.fieldWrite',             true),
      fieldDestructive:       cfg.get('mcp.categories.fieldDestructive',       true),
      viewWrite:              cfg.get('mcp.categories.viewWrite',              true),
      viewDestructive:        cfg.get('mcp.categories.viewDestructive',        true),
      viewSection:            cfg.get('mcp.categories.viewSection',            true),
      viewSectionDestructive: cfg.get('mcp.categories.viewSectionDestructive', true),
      formWrite:              cfg.get('mcp.categories.formWrite',              true),
      extension:              cfg.get('mcp.categories.extension',              true),
    };
    return {
      profile,
      categories,
      totalCount:   Object.keys(TOOL_CATEGORIES).length,
      enabledCount: this._countEnabled(profile, categories),
    };
  }

  /** Switch to a built-in profile (or 'custom'). Writes settings, which triggers file sync. */
  async setProfile(profile: ToolProfileName): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    await cfg.update('mcp.toolProfile', profile, vscode.ConfigurationTarget.Global);
  }

  /** Toggle a single category. Auto-switches profile to 'custom' if not already there. */
  async toggleCategory(category: keyof ToolCategories, enabled: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    const currentProfile = cfg.get<string>('mcp.toolProfile', 'full');
    if (currentProfile !== 'custom') {
      this._suppressSettingsSync = true;
      try {
        await cfg.update('mcp.toolProfile', 'custom', vscode.ConfigurationTarget.Global);
      } finally {
        setTimeout(() => { this._suppressSettingsSync = false; }, 200);
      }
    }
    await cfg.update(`mcp.categories.${category}`, enabled, vscode.ConfigurationTarget.Global);
  }

  async openConfigFile(): Promise<void> {
    try { await fsp.access(CONFIG_FILE); }
    catch { await this._writeFile(defaultConfig()); }
    const doc = await vscode.workspace.openTextDocument(CONFIG_FILE);
    await vscode.window.showTextDocument(doc);
  }

  /** Return Markdown describing the current profile + enabled tools (for the status command). */
  renderStatusReport(): string {
    const snapshot = this.getSnapshot();
    const enabled = this._computeEnabledSet(snapshot.profile, snapshot.categories);
    const lines: string[] = [
      `**Profile:** ${snapshot.profile}  |  **Tools:** ${snapshot.enabledCount}/${snapshot.totalCount}`,
      '',
    ];
    // Group by category file-key, preserving order
    const categoryOrder = [
      'read',
      'table-write', 'table-destructive',
      'field-write', 'field-destructive',
      'view-write', 'view-destructive',
      'view-section', 'view-section-destructive',
      'form-write',
      'extension',
    ];
    for (const cat of categoryOrder) {
      const label = CATEGORY_LABELS[cat] ?? cat;
      const tools = Object.entries(TOOL_CATEGORIES).filter(([, c]) => c === cat);
      if (tools.length === 0) continue;
      lines.push(`### ${label}`);
      for (const [tool] of tools) {
        lines.push(`${enabled.has(tool) ? 'on ' : 'off'} ${tool}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ─── Bidirectional Sync ─────────────────────────────────────

  /** Write current VS Code settings → on-disk config file. */
  async syncSettingsToFile(): Promise<void> {
    if (this._suppressSettingsSync) return;

    const snapshot = this.getSnapshot();
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    const config: OnDiskConfig = { activeProfile: snapshot.profile, customTools: {} };

    if (snapshot.profile === 'custom') {
      // Build customTools from category toggles
      for (const [tool, fileCatRaw] of Object.entries(TOOL_CATEGORIES)) {
        const settingsKey = CATEGORY_TO_SETTINGS[fileCatRaw];
        config.customTools[tool] = settingsKey ? snapshot.categories[settingsKey] : true;
      }
      // Per-tool overrides on top
      const overrides = cfg.get<Record<string, boolean>>('mcp.tools', {});
      for (const [tool, enabled] of Object.entries(overrides)) {
        if (tool in TOOL_CATEGORIES) config.customTools[tool] = !!enabled;
      }
    }

    await this._writeFile(config);
    this._onDidChange.fire(snapshot);
  }

  /** Read on-disk config file → update VS Code settings. */
  async syncFileToSettings(): Promise<void> {
    if (this._suppressFileSync) return;

    const config = await this._readFile();
    const cfg = vscode.workspace.getConfiguration('airtableFormula');

    this._suppressSettingsSync = true;
    try {
      const currentProfile = cfg.get<string>('mcp.toolProfile');
      if (currentProfile !== config.activeProfile) {
        await cfg.update('mcp.toolProfile', config.activeProfile, vscode.ConfigurationTarget.Global);
      }

      if (config.activeProfile === 'custom') {
        // Derive category booleans from customTools (all-enabled vs all-disabled per category)
        for (const [settingsKey, fileCat] of Object.entries(SETTINGS_TO_CATEGORY) as [keyof ToolCategories, string][]) {
          const toolsInCat = Object.entries(TOOL_CATEGORIES).filter(([, c]) => c === fileCat);
          if (toolsInCat.length === 0) continue;
          const allEnabled  = toolsInCat.every(([t]) => config.customTools[t] !== false);
          const allDisabled = toolsInCat.every(([t]) => config.customTools[t] === false);
          if (allDisabled) {
            await cfg.update(`mcp.categories.${settingsKey}`, false, vscode.ConfigurationTarget.Global);
          } else if (allEnabled) {
            await cfg.update(`mcp.categories.${settingsKey}`, true, vscode.ConfigurationTarget.Global);
          }
        }
        await cfg.update('mcp.tools', config.customTools, vscode.ConfigurationTarget.Global);
      } else {
        // Built-in profile — reset category toggles to match
        const def = BUILTIN_PROFILES[config.activeProfile as keyof typeof BUILTIN_PROFILES] ?? BUILTIN_PROFILES.full;
        const enabledCats = new Set(def.categories);
        for (const [settingsKey, fileCat] of Object.entries(SETTINGS_TO_CATEGORY) as [keyof ToolCategories, string][]) {
          await cfg.update(`mcp.categories.${settingsKey}`, enabledCats.has(fileCat), vscode.ConfigurationTarget.Global);
        }
      }
    } finally {
      setTimeout(() => { this._suppressSettingsSync = false; }, 200);
    }
    this._onDidChange.fire(this.getSnapshot());
  }

  // ─── Private ────────────────────────────────────────────────

  private _countEnabled(profile: ToolProfileName, categories: ToolCategories): number {
    return this._computeEnabledSet(profile, categories).size;
  }

  private _computeEnabledSet(profile: ToolProfileName, categories: ToolCategories): Set<string> {
    const enabled = new Set<string>();
    if (profile === 'custom') {
      for (const [tool, fileCat] of Object.entries(TOOL_CATEGORIES)) {
        const settingsKey = CATEGORY_TO_SETTINGS[fileCat];
        if (settingsKey && categories[settingsKey]) enabled.add(tool);
      }
    } else {
      const def = BUILTIN_PROFILES[profile as keyof typeof BUILTIN_PROFILES] ?? BUILTIN_PROFILES.full;
      const cats = new Set(def.categories);
      for (const [tool, fileCat] of Object.entries(TOOL_CATEGORIES)) {
        if (cats.has(fileCat)) enabled.add(tool);
      }
    }
    return enabled;
  }

  private async _readFile(): Promise<OnDiskConfig> {
    try {
      const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaultConfig(), ...parsed };
    } catch {
      return defaultConfig();
    }
  }

  private async _writeFile(config: OnDiskConfig): Promise<void> {
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    this._suppressFileSync = true;
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    setTimeout(() => { this._suppressFileSync = false; }, 300);
  }

  private _attachWatcher(): void {
    try {
      this._watcher = fs.watch(CONFIG_FILE, (eventType) => {
        if (eventType !== 'change') return;
        if (this._suppressFileSync) return;
        if (this._debounce) clearTimeout(this._debounce);
        this._debounce = setTimeout(() => { void this.syncFileToSettings(); }, 300);
      });
      this._watcher.on('error', () => {
        // File might not exist yet — silently ignore, we'll create it on first write
      });
    } catch {
      // File doesn't exist yet — that's fine, the watcher will be re-attached lazily
    }
  }
}
