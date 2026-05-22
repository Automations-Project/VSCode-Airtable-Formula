/**
 * Formatting Presets
 * Semantic, purpose-driven configurations that replace confusing style names
 */

import { FormulaFormatterConfig, DEFAULT_CONFIG, mergeConfig } from './config';

export type PresetName = 
  | 'paste-ready'     // Ready to paste into Airtable
  | 'development'     // Human-readable for development
  | 'json-builder'    // Optimized for JSON string building
  | 'decision-tree'   // Nested IF chains
  | 'safe-minify'     // Tokenizer-safe minification
  | 'debug';          // Maximum visibility for debugging

/**
 * Preset definitions with semantic naming
 */
export const PRESETS: Record<PresetName, Partial<FormulaFormatterConfig>> = {
  
  /**
   * Ready to paste into Airtable - single line, no formatting
   * Use case: Copy formula directly into Airtable field
   */
  'paste-ready': {
    target: 'airtable',
    indent: { style: 'spaces', size: 0 },
    lineBreaks: { maxLength: 0, breakAfter: [], preserveExisting: false },
    functions: { case: 'upper', ifStyle: 'inline' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: false, breakBeforeOperator: false },
    safety: { stripComments: true, convertSmartQuotes: true, maxOutputLength: 0, warnOnIssues: false }
  },

  /**
   * Human-readable development format
   * Use case: Writing and maintaining formulas in .formula files
   */
  'development': {
    target: 'human',
    indent: { style: 'spaces', size: 2 },
    lineBreaks: { maxLength: 100, breakAfter: [','], preserveExisting: false },
    functions: { case: 'upper', ifStyle: 'auto' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: true, breakBeforeOperator: true },
    safety: { stripComments: true, convertSmartQuotes: true, maxOutputLength: 0, warnOnIssues: true }
  },

  /**
   * Optimized for JSON string building formulas
   * Use case: Formulas that construct JSON payloads
   */
  'json-builder': {
    target: 'human',
    indent: { style: 'spaces', size: 2 },
    lineBreaks: { maxLength: 120, breakAfter: ['&', ','], preserveExisting: false },
    functions: { case: 'upper', ifStyle: 'inline' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: true, breakBeforeOperator: true },
    safety: { stripComments: true, convertSmartQuotes: true, maxOutputLength: 0, warnOnIssues: true }
  },

  /**
   * Nested IF chains formatted as decision trees
   * Use case: Complex conditional logic with many branches
   */
  'decision-tree': {
    target: 'human',
    indent: { style: 'spaces', size: 2 },
    lineBreaks: { maxLength: 80, breakAfter: ['ELSE', ','], preserveExisting: false },
    functions: { case: 'upper', ifStyle: 'cascade' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: false, breakBeforeOperator: false },
    safety: { stripComments: true, convertSmartQuotes: true, maxOutputLength: 0, warnOnIssues: true }
  },

  /**
   * Tokenizer-safe minification for very long formulas
   * Use case: Formulas approaching Airtable's character limits
   */
  'safe-minify': {
    target: 'airtable',
    indent: { style: 'spaces', size: 0 },
    lineBreaks: { maxLength: 8000, breakAfter: [','], preserveExisting: false },
    functions: { case: 'upper', ifStyle: 'inline' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: false, breakBeforeOperator: false },
    safety: { stripComments: true, convertSmartQuotes: true, maxOutputLength: 10000, warnOnIssues: true }
  },

  /**
   * Debug mode - maximum visibility
   * Use case: Troubleshooting formula issues
   */
  'debug': {
    target: 'debug',
    indent: { style: 'spaces', size: 4 },
    lineBreaks: { maxLength: 60, breakAfter: [',', '&'], preserveExisting: true },
    functions: { case: 'upper', ifStyle: 'multiline' },
    strings: { quotes: 'double', escapeStyle: 'backslash' },
    concatenation: { style: 'ampersand', jsonAware: true, breakBeforeOperator: true },
    safety: { stripComments: false, convertSmartQuotes: false, maxOutputLength: 0, warnOnIssues: true }
  }
};

/**
 * Get a preset configuration by name
 */
export function getPreset(name: PresetName): FormulaFormatterConfig {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown preset: ${name}. Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  return mergeConfig(DEFAULT_CONFIG, preset);
}

/**
 * Get all available preset names
 */
export function getPresetNames(): PresetName[] {
  return Object.keys(PRESETS) as PresetName[];
}

/**
 * Migration map from old style names to new presets
 */
export const LEGACY_STYLE_MAP: Record<string, PresetName> = {
  // Old beautifier styles
  'ultra-compact': 'paste-ready',
  'compact': 'development',
  'readable': 'development',
  'json': 'json-builder',
  'cascade': 'decision-tree',
  'smart': 'development',
  
  // Old minifier levels
  'micro': 'development',
  'standard': 'paste-ready',
  'safe': 'safe-minify',
  'aggressive': 'paste-ready',
  'extreme': 'paste-ready'
};

/**
 * Convert legacy style/level to new preset (with deprecation warning)
 */
export function fromLegacyStyle(style: string, warn = true): PresetName {
  const preset = LEGACY_STYLE_MAP[style];
  if (!preset) {
    throw new Error(`Unknown legacy style: ${style}`);
  }
  if (warn) {
    console.warn(`[DEPRECATED] Style '${style}' is deprecated. Use preset '${preset}' instead.`);
  }
  return preset;
}
