/**
 * Tool Configuration Manager
 *
 * Manages tool profiles (read-only, safe-write, full, custom) and per-tool
 * enable/disable state. Persists config to ~/.airtable-user-mcp/tools-config.json.
 * Sends tools/list_changed notifications when the active tool set changes.
 */
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getHomeDir, getToolConfigPath } from './paths.js';

// ─── Tool Categories ──────────────────────────────────────────

/** Every tool mapped to exactly one category */
export const TOOL_CATEGORIES = {
  // Read-only / inspection
  get_base_schema:        'read',
  list_tables:            'read',
  get_table_schema:       'read',
  list_fields:            'read',
  list_views:             'read',
  get_view:               'read',
  validate_formula:       'read',
  list_view_sections:     'read',

  // Table mutations (non-destructive)
  create_table:           'table-write',
  rename_table:           'table-write',

  // Record Templates
  list_record_templates:               'read',
  create_record_template:              'table-write',
  rename_record_template:              'table-write',
  update_record_template_description:  'table-write',
  set_record_template_cell:            'table-write',
  set_record_template_visible_columns: 'table-write',
  duplicate_record_template:           'table-write',
  apply_record_template:               'table-write',
  delete_record_template:              'table-destructive',

  // Table destructive
  delete_table:           'table-destructive',

  // Field mutations (non-destructive)
  create_field:           'field-write',
  create_formula_field:   'field-write',
  update_field_config:    'field-write',
  update_formula_field:   'field-write',
  rename_field:           'field-write',
  update_field_description: 'field-write',
  duplicate_field:        'field-write',

  // Field destructive
  delete_field:           'field-destructive',

  // View mutations (non-destructive)
  create_view:            'view-write',
  duplicate_view:         'view-write',
  rename_view:            'view-write',
  update_view_description: 'view-write',
  update_view_filters:    'view-write',
  reorder_view_fields:    'view-write',
  show_or_hide_view_columns: 'view-write',
  apply_view_sorts:       'view-write',
  update_view_group_levels: 'view-write',
  update_view_row_height: 'view-write',
  set_view_columns:       'view-write',
  show_or_hide_all_columns: 'view-write',
  move_visible_columns:   'view-write',
  move_overall_columns:   'view-write',
  update_frozen_column_count: 'view-write',
  set_view_cover:         'view-write',
  set_view_color_config:  'view-write',
  set_view_cell_wrap:     'view-write',
  set_calendar_date_columns: 'view-write',

  // View destructive
  delete_view:            'view-destructive',

  // View sections (sidebar grouping — non-destructive create/rename/move)
  create_view_section:    'view-section',
  rename_view_section:    'view-section',
  move_view_to_section:   'view-section',

  // View sections (destructive)
  delete_view_section:    'view-section-destructive',

  // Form metadata (legacy form views — public-facing artifacts gated separately)
  set_form_metadata:                'form-write',
  set_form_submission_notification: 'form-write',

  // Extension / block management
  create_extension:       'extension',
  create_extension_dashboard: 'extension',
  install_extension:      'extension',
  update_extension_state: 'extension',
  rename_extension:       'extension',
  duplicate_extension:    'extension',
  remove_extension:       'extension',
};

/** Human-readable labels for categories */
export const CATEGORY_LABELS = {
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

// ─── Built-in Profiles ───────────────────────────────────────

export const BUILTIN_PROFILES = {
  'read-only': {
    description: 'Schema inspection and formula validation only',
    categories: ['read'],
  },
  'safe-write': {
    description: 'Read + create/update tables, fields, views, and sidebar sections (no deletes, no form metadata)',
    categories: ['read', 'table-write', 'field-write', 'view-write', 'view-section'],
  },
  full: {
    description: 'All tools enabled including destructive ops, form metadata, and extensions',
    categories: [
      'read', 'table-write', 'table-destructive',
      'field-write', 'field-destructive',
      'view-write', 'view-destructive',
      'view-section', 'view-section-destructive',
      'form-write', 'extension',
    ],
  },
};

// ─── Config Paths ─────────────────────────────────────────────

// Config paths resolve lazily via getHomeDir() / getToolConfigPath() so
// AIRTABLE_USER_MCP_HOME is honored at call time, not at module load.

// ─── Default Config ───────────────────────────────────────────

function defaultConfig() {
  return {
    activeProfile: 'full',
    customTools: {},   // { toolName: true/false } — only used when activeProfile === 'custom'
  };
}

// ─── ToolConfigManager ───────────────────────────────────────

export class ToolConfigManager {
  constructor() {
    /** @type {ReturnType<typeof defaultConfig>} */
    this._config = defaultConfig();
    /** @type {import('@modelcontextprotocol/sdk/server/index.js').Server | null} */
    this._server = null;
    /** @type {import('node:fs').FSWatcher | null} */
    this._watcher = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._debounce = null;
    /** Flag to suppress file-watch reload when we just wrote the file ourselves */
    this._selfWrite = false;
  }

  /** Bind the MCP server so we can send tools/list_changed notifications */
  bindServer(server) {
    this._server = server;
  }

  // ── Persistence ──

  async load() {
    try {
      const raw = await readFile(getToolConfigPath(), 'utf8');
      const parsed = JSON.parse(raw);
      this._config = { ...defaultConfig(), ...parsed };
    } catch {
      // File doesn't exist or is corrupt → use defaults
      this._config = defaultConfig();
    }
  }

  async save() {
    const configFile = getToolConfigPath();
    await mkdir(dirname(configFile), { recursive: true });
    this._selfWrite = true;
    // Atomic write: stage to a unique temp file then rename over the target.
    // A crash mid-write leaves the previous config intact rather than an empty
    // / truncated file that would hydrate as defaults on next boot.
    const tmp = `${configFile}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      try {
        await writeFile(tmp, JSON.stringify(this._config, null, 2), 'utf8');
        await rename(tmp, configFile);
      } catch (err) {
        // Best-effort cleanup — rename may have happened before a later failure
        await unlink(tmp).catch(() => {});
        throw err;
      }
    } finally {
      // Always schedule the reset — otherwise a mid-write failure would leave
      // _selfWrite stuck at true and the watcher would ignore external edits.
      setTimeout(() => { this._selfWrite = false; }, 200);
    }
  }

  // ── Profile queries ──

  get activeProfile() {
    return this._config.activeProfile;
  }

  get customTools() {
    return { ...this._config.customTools };
  }

  /** Return list of all profile names (built-in + custom) */
  listProfiles() {
    const profiles = Object.entries(BUILTIN_PROFILES).map(([name, p]) => ({
      name,
      description: p.description,
      categories: p.categories,
      builtin: true,
    }));
    profiles.push({
      name: 'custom',
      description: 'User-defined per-tool selection',
      categories: null,
      builtin: false,
    });
    return profiles;
  }

  // ── Tool resolution ──

  /** Returns Set of currently enabled tool names */
  enabledToolNames() {
    const profile = this._config.activeProfile;

    if (profile === 'custom') {
      const enabled = new Set();
      for (const [tool, category] of Object.entries(TOOL_CATEGORIES)) {
        // Default: enabled unless explicitly set to false
        const override = this._config.customTools[tool];
        if (override !== false) enabled.add(tool);
      }
      return enabled;
    }

    const def = BUILTIN_PROFILES[profile];
    if (!def) {
      // Unknown profile → fall back to full
      return new Set(Object.keys(TOOL_CATEGORIES));
    }

    const cats = new Set(def.categories);
    const enabled = new Set();
    for (const [tool, category] of Object.entries(TOOL_CATEGORIES)) {
      if (cats.has(category)) enabled.add(tool);
    }
    return enabled;
  }

  /** Check if a specific tool is enabled */
  isToolEnabled(toolName) {
    // manage_tools is always enabled (meta-tool)
    if (toolName === 'manage_tools') return true;
    return this.enabledToolNames().has(toolName);
  }

  /** Filter an array of tool definitions to only enabled ones */
  filterTools(allTools) {
    const enabled = this.enabledToolNames();
    return allTools.filter(t => enabled.has(t.name));
  }

  /** Get status of every tool (for display) */
  getToolStatus() {
    const enabled = this.enabledToolNames();
    return Object.entries(TOOL_CATEGORIES).map(([name, category]) => ({
      name,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      enabled: enabled.has(name),
    }));
  }

  // ── Mutations (with notification) ──

  async switchProfile(profileName) {
    const valid = [...Object.keys(BUILTIN_PROFILES), 'custom'];
    if (!valid.includes(profileName)) {
      throw new Error(`Unknown profile "${profileName}". Valid: ${valid.join(', ')}`);
    }
    const changed = this._config.activeProfile !== profileName;
    this._config.activeProfile = profileName;
    await this.save();
    if (changed) this._notifyChanged();
    return { activeProfile: profileName, changed };
  }

  async toggleTool(toolName, enabled) {
    if (!TOOL_CATEGORIES[toolName]) {
      throw new Error(`Unknown tool "${toolName}"`);
    }
    // Auto-switch to custom profile when toggling individual tools
    if (this._config.activeProfile !== 'custom') {
      // Snapshot current enabled state into customTools before switching
      const currentEnabled = this.enabledToolNames();
      for (const tool of Object.keys(TOOL_CATEGORIES)) {
        this._config.customTools[tool] = currentEnabled.has(tool);
      }
      this._config.activeProfile = 'custom';
    }
    const prev = this._config.customTools[toolName] !== false;
    this._config.customTools[toolName] = enabled;
    await this.save();
    if (prev !== enabled) this._notifyChanged();
    return { tool: toolName, enabled, profile: 'custom' };
  }

  async toggleCategory(category, enabled) {
    if (!CATEGORY_LABELS[category]) {
      throw new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORY_LABELS).join(', ')}`);
    }
    // Auto-switch to custom profile
    if (this._config.activeProfile !== 'custom') {
      const currentEnabled = this.enabledToolNames();
      for (const tool of Object.keys(TOOL_CATEGORIES)) {
        this._config.customTools[tool] = currentEnabled.has(tool);
      }
      this._config.activeProfile = 'custom';
    }
    let changed = false;
    for (const [tool, cat] of Object.entries(TOOL_CATEGORIES)) {
      if (cat === category) {
        const prev = this._config.customTools[tool] !== false;
        this._config.customTools[tool] = enabled;
        if (prev !== enabled) changed = true;
      }
    }
    await this.save();
    if (changed) this._notifyChanged();
    return { category, enabled, profile: 'custom' };
  }

  // ── Notification ──

  _notifyChanged() {
    if (!this._server) return;
    try {
      this._server.sendToolListChanged();
    } catch {
      // Swallow if client doesn't support notifications
    }
  }

  // ── File Watching ──

  /** Start watching tools-config.json for external changes (e.g. from VS Code extension) */
  async startWatching() {
    const configFile = getToolConfigPath();
    // Ensure config dir exists so we can watch it
    await mkdir(getHomeDir(), { recursive: true });
    try {
      this._watcher = watch(configFile, (eventType) => {
        if (eventType !== 'change') return;
        if (this._selfWrite) return;
        // Debounce rapid changes (editors often do write+rename)
        if (this._debounce) clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._onFileChanged(), 300);
      });
      this._watcher.on('error', () => {
        // File might not exist yet — that's fine, we'll try again on next save
      });
    } catch {
      // watch() can throw if file doesn't exist yet — safe to ignore
    }
  }

  /** Handle external config file change */
  async _onFileChanged() {
    const prevEnabled = [...this.enabledToolNames()].sort().join(',');
    await this.load();
    const newEnabled = [...this.enabledToolNames()].sort().join(',');
    if (prevEnabled !== newEnabled) {
      console.error(`[airtable-user-mcp] Config reloaded from disk — profile: "${this.activeProfile}", tools: ${this.enabledToolNames().size}/${Object.keys(TOOL_CATEGORIES).length}`);
      this._notifyChanged();
    }
  }

  /** Stop watching */
  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._debounce) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
  }
}
