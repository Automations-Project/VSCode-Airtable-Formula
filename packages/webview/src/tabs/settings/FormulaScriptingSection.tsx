import React from 'react';
import type { SkillScope } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { OutcomeFeedback, SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

const INSTALL_SCOPES = [
  { value: 'global', label: 'This machine' },
  { value: 'project', label: 'Open workspace' },
] as const satisfies ReadonlyArray<{ value: SkillScope; label: string }>;

const FORMATTER_VERSIONS = [
  { value: 'v2', label: 'v2 (default)' },
  { value: 'v1', label: 'v1 (legacy)' },
] as const;

const BEAUTIFY_STYLES = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact (printWidth: 120)' },
  { value: 'singleQuote', label: 'Single Quote' },
  { value: 'tabIndent', label: 'Tab Indent' },
  { value: 'semicolonFree', label: 'Semicolon-free' },
] as const;

const MINIFY_LEVELS = [
  { value: 'safe', label: 'Safe (whitespace only)' },
  { value: 'standard', label: 'Standard (compress)' },
  { value: 'aggressive', label: 'Aggressive (compress + mangle)' },
  { value: 'extreme', label: 'Extreme (passes: 2)' },
] as const;

type FormatterVersion = (typeof FORMATTER_VERSIONS)[number]['value'];
type BeautifyStyle = (typeof BEAUTIFY_STYLES)[number]['value'];
type MinifyLevel = (typeof MINIFY_LEVELS)[number]['value'];

export function FormulaScriptingSection() {
  const ai = useStore(s => s.settings.ai);
  const formula = useStore(s => s.settings.formula);
  const script = useStore(s => s.settings.script);
  const removeSkill = useStore(s => s.removeSkill);
  const skillPending = useStore(s => s.pendingSkill);
  const [removeId, setRemoveId] = React.useState<string | null>(null);
  const removal = useActionOutcome(removeId);

  return (
    <Section
      id="formula-scripting"
      title="Formula and scripting"
      description="The AI skill and the formatters behind the beautify and minify commands."
    >
      <div className="settings-stack">
        <div className="settings-group" role="group" aria-labelledby="ai-skill-title" aria-describedby="ai-skill-description">
          <h3 id="ai-skill-title" className="settings-group__title">AI skill</h3>
          <p id="ai-skill-description" className="setting-row__description">
            One skill folder, installed where your AI clients read skills.
          </p>
          <SettingSwitchRow
            label="Auto-install AI skill"
            description="Installs or updates on launch when a client is missing it. Turn off before Remove skill."
            checked={ai.autoInstallFiles}
            change={value => ({ key: 'ai.autoInstallFiles', value })}
          />
          <SettingSelectRow
            label="Install scope"
            description="Once for this machine, or into the open workspace. Switching does not clean up the other scope."
            value={ai.installScope}
            options={INSTALL_SCOPES}
            change={value => ({ key: 'ai.installScope', value: value as SkillScope })}
          />
          <div className="settings-subpanel">
            <div className="settings-actions">
              <ActionButton
                variant="danger"
                pending={skillPending}
                onClick={() => {
                  removal.clearOutcome();
                  setRemoveId(removeSkill());
                }}
              >
                Remove skill
              </ActionButton>
            </div>
            <OutcomeFeedback
              outcome={removal.outcome}
              successMessage="Skill removed."
              failureMessage="The skill could not be removed."
            />
          </div>
        </div>
        <div className="settings-group" role="group" aria-labelledby="formula-engine-title">
          <h3 id="formula-engine-title" className="settings-group__title">Formula engine</h3>
          <SettingSelectRow
            label="Formatter version"
            description="Beautifier and minifier engine for .formula files."
            value={formula.formatterVersion}
            options={FORMATTER_VERSIONS}
            change={value => ({ key: 'formula.formatterVersion', value: value as FormatterVersion })}
          />
        </div>
        <div className="settings-group" role="group" aria-labelledby="script-formatter-title">
          <h3 id="script-formatter-title" className="settings-group__title">Script and automation</h3>
          <SettingSelectRow
            label="Beautify style"
            description="Prettier preset for Shift+Alt+F and beautify commands"
            value={script.beautifyStyle}
            options={BEAUTIFY_STYLES}
            change={value => ({ key: 'script.beautifyStyle', value: value as BeautifyStyle })}
          />
          <SettingSelectRow
            label="Minify level"
            description="Terser aggressiveness for minify commands"
            value={script.minifyLevel}
            options={MINIFY_LEVELS}
            change={value => ({ key: 'script.minifyLevel', value: value as MinifyLevel })}
          />
        </div>
      </div>
    </Section>
  );
}
