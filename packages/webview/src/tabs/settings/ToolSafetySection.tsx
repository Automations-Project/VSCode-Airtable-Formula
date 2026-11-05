import React from 'react';
import type { WebviewSettingChange } from '@shared/messages.js';
import type { ToolCategories, ToolProfileName } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { OutcomeFeedback, SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

const PROFILES: ReadonlyArray<{ value: ToolProfileName; label: string }> = [
  { value: 'read-only', label: 'read-only' },
  { value: 'safe-write', label: 'safe-write' },
  { value: 'full', label: 'full' },
  { value: 'custom', label: 'custom' },
];

interface CategoryRow {
  key: keyof ToolCategories;
  label: string;
  description: string;
}

// Descriptions name what each category can change; the destructive ones say so in words, not colour.
const CATEGORIES: readonly CategoryRow[] = [
  { key: 'read', label: 'Read / Inspect', description: 'Schema, fields, views, formula validation, sidebar sections, record templates (9 tools)' },
  { key: 'recordRead', label: 'Record Read', description: 'query_records — snapshot read of up to 1000 rows per call (1 tool)' },
  { key: 'tableWrite', label: 'Table Write', description: 'Tables + record templates: create / rename / update / set cells / duplicate / apply (9 tools)' },
  { key: 'tableDestructive', label: 'Table Destructive', description: 'Deletes data: delete_table, delete_record_template (2 tools)' },
  { key: 'fieldWrite', label: 'Field Write', description: 'Create / update / rename / duplicate fields (7 tools)' },
  { key: 'fieldDestructive', label: 'Field Destructive', description: 'Deletes data: delete_field, delete_fields (2 tools)' },
  { key: 'viewWrite', label: 'View Write', description: 'Views, filters, sorts, columns, freezing, covers, calendar dates (19 tools)' },
  { key: 'viewDestructive', label: 'View Destructive', description: 'Deletes a view: delete_view (1 tool)' },
  { key: 'viewSection', label: 'View Sections', description: 'Sidebar grouping: create / rename / move (3 tools)' },
  { key: 'viewSectionDestructive', label: 'View Sections (destructive)', description: 'Deletes a sidebar section: delete_view_section (1 tool)' },
  { key: 'formWrite', label: 'Form Metadata', description: 'Edit legacy form views — public-facing (2 tools)' },
  { key: 'extension', label: 'Extension Management', description: 'Create / install / duplicate / remove extensions (7 tools)' },
  { key: 'recordWrite', label: 'Record Write', description: 'create_records, update_records, duplicate_records, upload_attachment — bulk record create / update / duplication / attachment upload (4 tools)' },
  { key: 'recordDestructive', label: 'Record Destructive', description: 'Deletes records: delete_records — batch record deletion (1 tool)' },
  { key: 'sync', label: 'Sync', description: 'sync_base — plan/diff/status are read-only; apply mutates the destination and can delete under policy=mirror (1 tool)' },
  { key: 'localWrite', label: 'Local File Write', description: 'download_formula_field, download_base_formulas — read formulas from Airtable and WRITE .formula files to a path the caller chooses. Not part of read-only (2 tools)' },
  { key: 'daemon', label: 'Daemon Control', description: 'manage_daemon — status is read-only diagnostics; start / restart / stop / tunnel / token_rotate control the MCP server process itself (1 tool)' },
];

function OpenToolConfig() {
  const openToolConfig = useStore(s => s.openToolConfig);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const { pending, outcome, clearOutcome } = useActionOutcome(actionId);

  return (
    <div className="settings-subpanel">
      <p className="setting-row__description" id="tool-config-description">
        Opens the raw tool configuration file in the editor. Editing it by hand overrides these controls.
      </p>
      <div className="settings-actions">
        <ActionButton
          aria-describedby="tool-config-description"
          pending={pending}
          onClick={() => {
            clearOutcome();
            setActionId(openToolConfig());
          }}
        >
          Open tool-config.json
        </ActionButton>
      </div>
      <OutcomeFeedback outcome={outcome} successMessage="Opened." failureMessage="It could not be opened." />
    </div>
  );
}

export function ToolSafetySection() {
  const profile = useStore(s => s.settings.mcp.toolProfile);
  const hidden = profile.totalCount - profile.enabledCount;

  return (
    <Section
      id="tool-safety"
      title="Tool safety"
      description="Choose which MCP tools AI agents can call. Anything that writes or deletes is off in the read-only profile."
    >
      <div className="settings-stack">
        <SettingSelectRow
          label="Active profile"
          description="read-only exposes inspection tools only, safe-write adds non-destructive edits, full exposes every tool, and custom lets you pick categories."
          value={profile.profile}
          options={PROFILES}
          change={value => ({ key: 'mcp.toolProfile', value: value as ToolProfileName })}
        />
        <p className="settings-meta">
          <span>{profile.enabledCount} of {profile.totalCount} tools enabled</span>
          {hidden > 0 && <span>{hidden} hidden from AI agents. Switch to full or enable more categories.</span>}
        </p>
        {profile.profile === 'custom' ? (
          <div className="settings-group" role="group" aria-labelledby="tool-categories-title">
            <h3 id="tool-categories-title" className="settings-group__title">Tool categories</h3>
            {CATEGORIES.map(category => (
              <SettingSwitchRow
                key={category.key}
                label={category.label}
                description={category.description}
                checked={profile.categories[category.key]}
                change={next => ({ key: 'mcp.category', category: category.key, value: next }) as WebviewSettingChange}
              />
            ))}
          </div>
        ) : (
          <p className="setting-row__description">Choose the custom profile to turn individual tool categories on or off.</p>
        )}
        <OpenToolConfig />
      </div>
    </Section>
  );
}
