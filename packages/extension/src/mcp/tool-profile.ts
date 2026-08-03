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
  | 'form-write'
  | 'record-read' | 'record-write' | 'record-destructive'
  | 'sync' | 'daemon' | 'local-write';
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
  download_formula_field:    'local-write',
  download_base_formulas:    'local-write',
  // Record read (snapshot read via readQueries)
  query_records:             'record-read',
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
  delete_fields:             'field-destructive',
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
  // Record write (duplicate via pasteCells + direct CRUD)
  duplicate_records:         'record-write',
  create_records:            'record-write',
  update_records:            'record-write',
  upload_attachment:         'record-write',
  // Record destructive (batch record deletion)
  delete_records:            'record-destructive',
  // Sync (base-to-base schema sync)
  sync_base:                 'sync',
  // Daemon control (administers this server's own process, not Airtable)
  manage_daemon:             'daemon',
};

export const CATEGORY_LABELS: Record<string, string> = {
  'read':                     'Read / Inspect',
  'record-read':              'Record Read',
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
  'record-write':             'Record Write',
  'record-destructive':       'Record Destructive',
  'sync':                     'Sync',
  'daemon':                   'Daemon Control',
  'local-write':              'Local File Write',
};

interface ProfileDef {
  description: string;
  // Uses file-format category keys (kebab-case) to match the on-disk schema
  categories: string[];
}

export const BUILTIN_PROFILES: Record<'read-only' | 'safe-write' | 'full', ProfileDef> = {
  'read-only': { description: 'Schema inspection, formula validation, and record reading only', categories: ['read', 'record-read'] },
  'safe-write':{ description: 'Read + record read/write + create/update tables, fields, views, sidebar sections, and record templates (no deletes, no form metadata)',
                 categories: ['read', 'record-read', 'record-write', 'table-write', 'field-write', 'view-write', 'view-section', 'local-write'] },
  full:        { description: 'All tools enabled including destructive ops, form metadata, extensions, and daemon control',
                 categories: [
                   'read', 'record-read', 'record-write', 'record-destructive',
                   'table-write', 'table-destructive',
                   'field-write', 'field-destructive',
                   'view-write', 'view-destructive',
                   'view-section', 'view-section-destructive',
                   'form-write', 'extension', 'sync', 'daemon', 'local-write',
                 ] },
};

// Settings key suffix → file-format category key.
// Exported so extension.ts's "Toggle MCP Tool Categories" command can enumerate
// categories from here instead of keeping a second hand-written list (that list
// had drifted to 8 of 15 categories, silently hiding half of them from the
// command palette).
export const SETTINGS_TO_CATEGORY: Record<keyof ToolCategories, string> = {
  read:                    'read',
  recordRead:              'record-read',
  tableWrite:              'table-write',
  tableDestructive:        'table-destructive',
  fieldWrite:              'field-write',
  fieldDestructive:        'field-destructive',
  recordDestructive:       'record-destructive',
  viewWrite:               'view-write',
  viewDestructive:         'view-destructive',
  viewSection:             'view-section',
  viewSectionDestructive:  'view-section-destructive',
  formWrite:               'form-write',
  extension:               'extension',
  recordWrite:             'record-write',
  sync:                    'sync',
  daemon:                  'daemon',
  localWrite:              'local-write',
};

// Inverse: file-format category key → settings key suffix
const CATEGORY_TO_SETTINGS: Record<string, keyof ToolCategories> = Object.fromEntries(
  Object.entries(SETTINGS_TO_CATEGORY).map(([k, v]) => [v, k as keyof ToolCategories]),
);

// Keep this frozen to the categories that existed when customTools was introduced.
// It mirrors the server's legacy-custom invariant: a category added later defaults
// closed when an older custom profile has no explicit keys for its tools. Iterating
// the complement makes future categories fail closed automatically.
const LEGACY_CATEGORIES_DEFAULT_ON = new Set([
  'read', 'record-read',
  'table-write', 'table-destructive',
  'field-write', 'field-destructive',
  'view-write', 'view-destructive',
  'view-section', 'view-section-destructive',
  'form-write', 'extension',
  'record-write',
]);

const CONFIG_DIR  = path.join(os.homedir(), '.airtable-user-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'tools-config.json');

interface OnDiskConfig {
  activeProfile: ToolProfileName;
  customTools:   Record<string, boolean>;
}

function defaultConfig(): OnDiskConfig {
  return { activeProfile: 'full', customTools: {} };
}

function isCustomToolEnabled(config: OnDiskConfig, tool: string): boolean {
  const explicit = config.customTools[tool];
  if (typeof explicit === 'boolean') return explicit;
  return LEGACY_CATEGORIES_DEFAULT_ON.has(TOOL_CATEGORIES[tool]);
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

    let fileBefore: OnDiskConfig | undefined;
    try { fileBefore = await this._readFile(); } catch { /* file missing is fine */ }

    // VS Code returns package.json's default even when a setting did not exist in
    // the user's older installation. Before settings overwrite the file, seed every
    // post-legacy category from the old customTools map: explicit tool values survive,
    // absent tools stay disabled, and an explicitly configured setting still wins.
    await this._migrateLegacyCustomCategories(fileBefore);

    // Log what we're about to do so the extension host output channel shows
    // the resolved state — invaluable when debugging sync issues later.
    const beforeSnapshot = this.getSnapshot();
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
      recordRead:             cfg.get('mcp.categories.recordRead',             true),
      tableWrite:             cfg.get('mcp.categories.tableWrite',             true),
      tableDestructive:       cfg.get('mcp.categories.tableDestructive',       true),
      fieldWrite:             cfg.get('mcp.categories.fieldWrite',             true),
      fieldDestructive:       cfg.get('mcp.categories.fieldDestructive',       true),
      recordDestructive:      cfg.get('mcp.categories.recordDestructive',      false),
      viewWrite:              cfg.get('mcp.categories.viewWrite',              true),
      viewDestructive:        cfg.get('mcp.categories.viewDestructive',        true),
      viewSection:            cfg.get('mcp.categories.viewSection',            true),
      viewSectionDestructive: cfg.get('mcp.categories.viewSectionDestructive', true),
      formWrite:              cfg.get('mcp.categories.formWrite',              true),
      extension:              cfg.get('mcp.categories.extension',              true),
      recordWrite:            cfg.get('mcp.categories.recordWrite',            true),
      sync:                   cfg.get('mcp.categories.sync',                   false),
      daemon:                 cfg.get('mcp.categories.daemon',                 false),
      localWrite:             cfg.get('mcp.categories.localWrite',             true),
    };
    const overrides = cfg.get<Record<string, boolean>>('mcp.tools', {});
    return {
      profile,
      categories,
      totalCount:   Object.keys(TOOL_CATEGORIES).length,
      enabledCount: this._countEnabled(profile, categories, overrides),
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
    const wasSuppressed = this._suppressSettingsSync;
    this._suppressSettingsSync = true;
    try {
      const currentProfile = cfg.get<string>('mcp.toolProfile', 'full');
      if (currentProfile !== 'custom') {
        await cfg.update('mcp.toolProfile', 'custom', vscode.ConfigurationTarget.Global);
      }

      // A category action is an explicit choice for every tool in that category.
      // Drop older per-tool overrides first; otherwise values imported during a
      // legacy migration remain the final authority and make the toggle a no-op.
      const overrides = { ...cfg.get<Record<string, boolean>>('mcp.tools', {}) };
      const fileCategory = SETTINGS_TO_CATEGORY[category];
      let overridesChanged = false;
      for (const [tool, candidateCategory] of Object.entries(TOOL_CATEGORIES)) {
        if (candidateCategory !== fileCategory || !(tool in overrides)) continue;
        delete overrides[tool];
        overridesChanged = true;
      }
      if (overridesChanged) {
        await cfg.update('mcp.tools', overrides, vscode.ConfigurationTarget.Global);
      }
      await cfg.update(`mcp.categories.${category}`, enabled, vscode.ConfigurationTarget.Global);
    } finally {
      this._suppressSettingsSync = wasSuppressed;
    }

    // Configuration-change events are intentionally suppressed while the
    // profile, overrides, and category move as one unit. Persist the final state
    // once rather than exposing transient combinations to the MCP server.
    if (!wasSuppressed) await this.syncSettingsToFile();
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
    const overrides = vscode.workspace.getConfiguration('airtableFormula')
      .get<Record<string, boolean>>('mcp.tools', {});
    const enabled = this._computeEnabledSet(snapshot.profile, snapshot.categories, overrides);
    const lines: string[] = [
      `**Profile:** ${snapshot.profile}  |  **Tools:** ${snapshot.enabledCount}/${snapshot.totalCount}`,
      '',
    ];
    // Group by category file-key, preserving order
    const categoryOrder = [
      'read', 'record-read',
      'table-write', 'table-destructive',
      'field-write', 'field-destructive',
      'view-write', 'view-destructive',
      'view-section', 'view-section-destructive',
      'form-write',
      'extension',
      'record-write', 'record-destructive',
      'sync',
      'daemon',
      'local-write',
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
        // Materialize the server's legacy-custom semantics before importing the
        // file. Older categories default on when absent; categories introduced
        // later default off. Keeping an exact per-tool map also preserves mixed
        // categories regardless of a stale/default category switch in VS Code.
        const effectiveCustomTools = { ...config.customTools };
        for (const tool of Object.keys(TOOL_CATEGORIES)) {
          effectiveCustomTools[tool] = isCustomToolEnabled(config, tool);
        }

        // Derive category booleans from customTools (all-enabled vs all-disabled per category)
        for (const [settingsKey, fileCat] of Object.entries(SETTINGS_TO_CATEGORY) as [keyof ToolCategories, string][]) {
          const toolsInCat = Object.entries(TOOL_CATEGORIES).filter(([, c]) => c === fileCat);
          if (toolsInCat.length === 0) continue;
          const allEnabled  = toolsInCat.every(([t]) => effectiveCustomTools[t]);
          const allDisabled = toolsInCat.every(([t]) => !effectiveCustomTools[t]);
          if (allDisabled) {
            await cfg.update(`mcp.categories.${settingsKey}`, false, vscode.ConfigurationTarget.Global);
          } else if (allEnabled) {
            await cfg.update(`mcp.categories.${settingsKey}`, true, vscode.ConfigurationTarget.Global);
          }
        }
        await cfg.update('mcp.tools', effectiveCustomTools, vscode.ConfigurationTarget.Global);
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

  private _countEnabled(
    profile: ToolProfileName,
    categories: ToolCategories,
    overrides: Record<string, boolean> = {},
  ): number {
    return this._computeEnabledSet(profile, categories, overrides).size;
  }

  private _computeEnabledSet(
    profile: ToolProfileName,
    categories: ToolCategories,
    overrides: Record<string, boolean> = {},
  ): Set<string> {
    const enabled = new Set<string>();
    if (profile === 'custom') {
      for (const [tool, fileCat] of Object.entries(TOOL_CATEGORIES)) {
        const settingsKey = CATEGORY_TO_SETTINGS[fileCat];
        if (settingsKey && categories[settingsKey]) enabled.add(tool);
      }
      // Match syncSettingsToFile(): per-tool values are the final authority for a
      // custom profile, including the mixed-category state imported during upgrade.
      for (const [tool, isEnabled] of Object.entries(overrides)) {
        if (!(tool in TOOL_CATEGORIES)) continue;
        if (isEnabled) enabled.add(tool);
        else enabled.delete(tool);
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

  private _hasExplicitSetting(cfg: vscode.WorkspaceConfiguration, key: string): boolean {
    const inspected = cfg.inspect<unknown>(key);
    if (!inspected) return false;
    return [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
      inspected.globalLanguageValue,
      inspected.workspaceLanguageValue,
      inspected.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined);
  }

  /** Preserve the effective state of categories unknown to an older custom profile. */
  private async _migrateLegacyCustomCategories(fileBefore: OnDiskConfig | undefined): Promise<void> {
    if (fileBefore?.activeProfile !== 'custom') return;

    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    if (cfg.get<string>('mcp.toolProfile', 'full') !== 'custom') return;

    const oldTools = fileBefore.customTools ?? {};
    const overrides = { ...cfg.get<Record<string, boolean>>('mcp.tools', {}) };
    let overridesChanged = false;

    for (const [settingsKey, fileCat] of Object.entries(SETTINGS_TO_CATEGORY) as [keyof ToolCategories, string][]) {
      if (LEGACY_CATEGORIES_DEFAULT_ON.has(fileCat)) continue;
      const settingPath = `mcp.categories.${settingsKey}`;
      if (this._hasExplicitSetting(cfg, settingPath)) continue;

      const tools = Object.entries(TOOL_CATEGORIES)
        .filter(([, category]) => category === fileCat)
        .map(([tool]) => tool);
      if (tools.length === 0) continue;

      const effective = tools.map((tool) => {
        const fromSettings = overrides[tool];
        if (typeof fromSettings === 'boolean') return fromSettings;
        const fromFile = oldTools[tool];
        return typeof fromFile === 'boolean' ? fromFile : false;
      });

      // The category switch represents the common state; explicit per-tool values
      // retain an exact mixed state on top of it.
      await cfg.update(settingPath, effective.every(Boolean), vscode.ConfigurationTarget.Global);
      for (let i = 0; i < tools.length; i++) {
        overrides[tools[i]] = effective[i];
        overridesChanged = true;
      }
    }

    if (overridesChanged) {
      await cfg.update('mcp.tools', overrides, vscode.ConfigurationTarget.Global);
    }
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
