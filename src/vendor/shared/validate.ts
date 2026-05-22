/**
 * Configuration Validation
 * Detects conflicts and provides helpful warnings
 */

import { FormulaFormatterConfig } from './config';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a formatter configuration
 * Returns errors (invalid config) and warnings (probably unintended)
 */
export function validateConfig(config: FormulaFormatterConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // === INDENT VALIDATION ===
  if (config.indent.size < 0) {
    errors.push('indent.size must be >= 0');
  }
  if (config.indent.size > 8) {
    warnings.push('indent.size > 8 is unusually large');
  }

  // === LINE BREAKS VALIDATION ===
  if (config.lineBreaks.maxLength !== 0 && config.lineBreaks.maxLength < 50) {
    errors.push('lineBreaks.maxLength must be >= 50 or 0 (unlimited)');
  }
  if (config.lineBreaks.maxLength > 0 && config.lineBreaks.maxLength < 80) {
    warnings.push('lineBreaks.maxLength < 80 may cause excessive line breaks');
  }

  // === SAFETY VALIDATION ===
  if (config.safety.maxOutputLength !== 0 && config.safety.maxOutputLength < 1000) {
    errors.push('safety.maxOutputLength must be >= 1000 or 0 (unlimited)');
  }

  // === CONFLICT DETECTION ===
  
  // Target conflicts
  if (config.target === 'airtable' && config.indent.size > 0) {
    warnings.push('indent.size ignored for airtable target (produces single line)');
  }
  if (config.target === 'airtable' && config.lineBreaks.breakAfter.length > 0 && config.lineBreaks.maxLength === 0) {
    warnings.push('lineBreaks.breakAfter ignored for airtable target without maxLength limit');
  }

  // Style conflicts
  if (config.functions.ifStyle === 'cascade' && config.indent.size === 0) {
    warnings.push('cascade ifStyle works better with indent.size >= 1');
  }
  if (config.functions.ifStyle === 'multiline' && config.target === 'airtable') {
    warnings.push('multiline ifStyle conflicts with airtable target; will use inline');
  }

  // JSON-related conflicts
  if (config.concatenation.jsonAware && config.strings.quotes === 'single') {
    warnings.push('JSON typically uses double quotes; jsonAware + single quotes may look odd');
  }

  // Safety conflicts
  if (config.target === 'debug' && config.safety.stripComments) {
    warnings.push('stripComments=true with debug target may hide useful information');
  }

  // Line break conflicts
  if (config.lineBreaks.maxLength > 0 && config.safety.maxOutputLength > 0 &&
      config.lineBreaks.maxLength > config.safety.maxOutputLength) {
    warnings.push('lineBreaks.maxLength > safety.maxOutputLength; breaks may not help');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate and throw if invalid
 */
export function assertValidConfig(config: FormulaFormatterConfig): void {
  const result = validateConfig(config);
  if (!result.valid) {
    throw new Error(`Invalid config: ${result.errors.join('; ')}`);
  }
}

/**
 * Validate and log warnings
 */
export function validateWithWarnings(
  config: FormulaFormatterConfig, 
  logger: (msg: string) => void = console.warn
): boolean {
  const result = validateConfig(config);
  
  result.warnings.forEach(w => logger(`[Config Warning] ${w}`));
  result.errors.forEach(e => logger(`[Config Error] ${e}`));
  
  return result.valid;
}
