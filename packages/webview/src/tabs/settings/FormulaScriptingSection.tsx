import React from 'react';
import { SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { useStore } from '../../store.js';

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

  return (
    <Section
      id="formula-scripting"
      title="Formula and scripting"
      description="AI instruction files and the formatters behind the beautify and minify commands."
    >
      <div className="settings-stack">
        <div className="settings-group" role="group" aria-labelledby="ai-files-title">
          <h3 id="ai-files-title" className="settings-group__title">AI files</h3>
          <SettingSwitchRow
            label="Auto-install AI files"
            description="Install skills, rules, workflows on first launch"
            checked={ai.autoInstallFiles}
            change={value => ({ key: 'ai.autoInstallFiles', value })}
          />
          <SettingSwitchRow
            label="Include agent files"
            description="Install agent configs where supported"
            checked={ai.includeAgents}
            change={value => ({ key: 'ai.includeAgents', value })}
          />
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
