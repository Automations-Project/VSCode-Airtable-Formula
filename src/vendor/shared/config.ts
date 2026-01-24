/**
 * Unified Formula Formatter Configuration
 * Single source of truth for all formatting options
 */

export type OutputTarget = 'human' | 'airtable' | 'debug';
export type IndentStyle = 'tabs' | 'spaces';
export type QuoteStyle = 'single' | 'double' | 'preserve';
export type FunctionCase = 'preserve' | 'upper' | 'lower';
export type IfStyle = 'inline' | 'multiline' | 'cascade' | 'auto';
export type ConcatStyle = 'ampersand' | 'function';

export interface IndentConfig {
  style: IndentStyle;
  size: number;  // 0 = no indentation (flat)
}

export interface LineBreakConfig {
  maxLength: number;        // 0 = no limit
  breakAfter: (',' | '&' | 'THEN' | 'ELSE')[];
  preserveExisting: boolean;
}

export interface FunctionConfig {
  case: FunctionCase;
  ifStyle: IfStyle;
  // inline:    IF(cond, a, b)
  // multiline: IF(\n  cond,\n  a,\n  b\n)
  // cascade:   IF(cond, a,\nIF(cond2, b, c))
  // auto:      choose based on complexity
}

export interface StringConfig {
  quotes: QuoteStyle;
  escapeStyle: 'backslash' | 'double';  // \" vs ""
}

export interface ConcatenationConfig {
  style: ConcatStyle;  // & vs CONCATENATE()
  jsonAware: boolean;  // Special formatting for JSON building
  breakBeforeOperator: boolean;  // "a" &\n"b" vs "a"\n& "b"
}

export interface SafetyConfig {
  stripComments: boolean;
  convertSmartQuotes: boolean;
  maxOutputLength: number;  // Insert breaks if exceeded (0 = no limit)
  warnOnIssues: boolean;
}

export interface FormulaFormatterConfig {
  // Output target determines overall behavior
  target: OutputTarget;
  
  // Whitespace control
  indent: IndentConfig;
  lineBreaks: LineBreakConfig;
  
  // Function formatting
  functions: FunctionConfig;
  
  // String handling
  strings: StringConfig;
  
  // Concatenation formatting
  concatenation: ConcatenationConfig;
  
  // Safety features
  safety: SafetyConfig;
}

/**
 * Default configuration - sensible defaults for development
 */
export const DEFAULT_CONFIG: FormulaFormatterConfig = {
  target: 'human',
  
  indent: {
    style: 'spaces',
    size: 2
  },
  
  lineBreaks: {
    maxLength: 100,
    breakAfter: [','],
    preserveExisting: false
  },
  
  functions: {
    case: 'upper',
    ifStyle: 'auto'
  },
  
  strings: {
    quotes: 'double',
    escapeStyle: 'backslash'
  },
  
  concatenation: {
    style: 'ampersand',
    jsonAware: false,
    breakBeforeOperator: false
  },
  
  safety: {
    stripComments: true,
    convertSmartQuotes: true,
    maxOutputLength: 0,
    warnOnIssues: true
  }
};

/**
 * Deep merge helper for config objects
 */
export function mergeConfig(
  base: FormulaFormatterConfig,
  overrides: Partial<FormulaFormatterConfig>
): FormulaFormatterConfig {
  return {
    target: overrides.target ?? base.target,
    indent: { ...base.indent, ...overrides.indent },
    lineBreaks: { ...base.lineBreaks, ...overrides.lineBreaks },
    functions: { ...base.functions, ...overrides.functions },
    strings: { ...base.strings, ...overrides.strings },
    concatenation: { ...base.concatenation, ...overrides.concatenation },
    safety: { ...base.safety, ...overrides.safety }
  };
}
