const fs = require('fs');
const path = require('path');

/**
 * Enhanced Airtable Formula Minifier v2
 * Improvements based on extension development:
 * - Smart line breaking to avoid tokenization limits
 * - Comment removal (comments are invalid in Airtable)
 * - Better string literal optimization
 * - Preserves field references correctly
 * - JSON-aware minification
 * - Configurable safety features
 */
class EnhancedFormulaMinifier {
  constructor(options = {}) {
    this.level = options.level || 'standard'; // micro, standard, aggressive, extreme, safe
    this.preserveReadability = options.preserve_readability || false;
    this.removeComments = options.remove_comments !== false; // Default: true
    this.maxLineLength = options.max_line_length || 0; // 0 = no limit
    this.safeLineBreaks = options.safe_line_breaks || false;
    this.safeBreakThreshold = options.safe_break_threshold || 10000; // Characters before breaking
    
    // Configure based on level
    switch (this.level) {
      case 'micro':
        this.removeSpaces = false;
        this.shortenBooleans = false;
        this.removeEmptyElse = true;
        this.mergeStrings = false;
        break;
      case 'safe':
        // Safe mode - prevents tokenization issues
        this.removeSpaces = true;
        this.shortenBooleans = false;
        this.removeEmptyElse = true;
        this.mergeStrings = false;
        this.safeLineBreaks = true;
        this.safeBreakThreshold = 8000;
        break;
      case 'standard':
        this.removeSpaces = true;
        this.shortenBooleans = false;
        this.removeEmptyElse = true;
        this.mergeStrings = false;
        break;
      case 'aggressive':
        this.removeSpaces = true;
        this.shortenBooleans = true;
        this.removeEmptyElse = true;
        this.mergeStrings = true;
        this.removeRedundantParens = false;
        break;
      case 'extreme':
        this.removeSpaces = true;
        this.shortenBooleans = true;
        this.removeEmptyElse = true;
        this.mergeStrings = true;
        this.removeRedundantParens = true;
        this.aggressiveOptimizations = true;
        break;
    }
  }

  minify(formula) {
    try {
      // Step 1: Remove comments (they're invalid anyway)
      if (this.removeComments) {
        formula = this.stripComments(formula);
      }
      
      // Step 2: Tokenize
      const tokens = this.tokenize(formula);
      
      // Step 3: Parse to AST
      const ast = this.parse(tokens);
      
      // Step 4: Optimize AST
      const optimized = this.optimize(ast);
      
      // Step 5: Generate minified output
      let result = this.generate(optimized);
      
      // Step 6: Apply safe line breaks if needed
      if (this.safeLineBreaks && result.length > this.safeBreakThreshold) {
        result = this.insertSafeBreaks(result);
      }
      
      return result;
    } catch (error) {
      console.error('Minification error:', error.message);
      // Return original if minification fails
      return formula;
    }
  }

  stripComments(formula) {
    // Remove single-line comments
    formula = formula.replace(/\/\/[^\n]*/g, '');
    
    // Remove block comments
    formula = formula.replace(/\/\*[\s\S]*?\*\//g, '');
    
    return formula.trim();
  }

  tokenize(formula) {
    const tokens = [];
    let i = 0;
    
    // Known Airtable functions
    const FUNCTIONS = new Set([
      'IF', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'IS_SAME', 'IS_AFTER', 'IS_BEFORE',
      'ISERROR', 'ERROR', 'CONCATENATE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND',
      'SEARCH', 'SUBSTITUTE', 'REPLACE', 'TRIM', 'UPPER', 'LOWER', 'VALUE', 'TEXT',
      'REPT', 'T', 'ABS', 'AVERAGE', 'CEILING', 'COUNT', 'COUNTA', 'COUNTALL',
      'EXP', 'FLOOR', 'INT', 'LOG', 'LOG10', 'MAX', 'MIN', 'MOD', 'POWER',
      'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SQRT', 'SUM', 'DATEADD', 'DATEDIF',
      'DATETIME_DIFF', 'DATETIME_FORMAT', 'DATETIME_PARSE', 'DATESTR', 'DAY',
      'HOUR', 'MINUTE', 'MONTH', 'SECOND', 'SET_LOCALE', 'SET_TIMEZONE',
      'TIMESTR', 'TONOW', 'FROMNOW', 'WEEKDAY', 'WEEKNUM', 'WORKDAY',
      'WORKDAY_DIFF', 'YEAR', 'ARRAYCOMPACT', 'ARRAYJOIN', 'ARRAYUNIQUE',
      'ARRAYFLATTEN', 'ARRAYSLICE', 'REGEX_MATCH', 'REGEX_EXTRACT',
      'REGEX_REPLACE', 'RECORD_ID', 'AUTONUMBER', 'CREATED_BY', 'CREATED_TIME',
      'LAST_MODIFIED_TIME', 'LAST_MODIFIED_BY', 'ENCODE_URL_COMPONENT', 'BLANK'
    ]);
    
    // Constants that don't need parentheses
    const CONSTANTS = new Set(['TRUE', 'FALSE', 'NOW', 'TODAY', 'BLANK']);
    
    while (i < formula.length) {
      // Skip whitespace (will be removed or preserved based on context)
      if (/\s/.test(formula[i])) {
        const start = i;
        while (i < formula.length && /\s/.test(formula[i])) {
          i++;
        }
        if (!this.removeSpaces) {
          tokens.push({ type: 'SPACE', value: formula.substring(start, i) });
        }
        continue;
      }
      
      // String literals
      if (formula[i] === '"' || formula[i] === "'") {
        const quote = formula[i];
        let value = quote;
        let content = '';
        let escaped = false;
        i++;
        
        while (i < formula.length) {
          if (escaped) {
            value += formula[i];
            content += formula[i];
            escaped = false;
          } else if (formula[i] === '\\') {
            value += formula[i];
            content += formula[i];
            escaped = true;
          } else if (formula[i] === quote) {
            value += formula[i];
            i++;
            break;
          } else {
            value += formula[i];
            content += formula[i];
          }
          i++;
        }
        
        tokens.push({ type: 'STRING', value, content });
        continue;
      }
      
      // Field references
      if (formula[i] === '{') {
        let value = '{';
        let depth = 1;
        let fieldName = '';
        i++;
        
        while (i < formula.length && depth > 0) {
          if (formula[i] === '{') depth++;
          if (formula[i] === '}') depth--;
          value += formula[i];
          if (depth > 0) fieldName += formula[i];
          i++;
          if (depth === 0) break;
        }
        
        // Special handling for empty field reference
        if (value === '{}') {
          // Empty field refs are often used for JSON - preserve them
          tokens.push({ type: 'FIELD', value, fieldName: '' });
        } else {
          tokens.push({ type: 'FIELD', value, fieldName: fieldName.trim() });
        }
        continue;
      }
      
      // Numbers
      if (/[0-9]/.test(formula[i]) || (formula[i] === '.' && i + 1 < formula.length && /[0-9]/.test(formula[i + 1]))) {
        let value = '';
        while (i < formula.length && /[0-9.]/.test(formula[i])) {
          value += formula[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value });
        continue;
      }
      
      // Identifiers and functions
      if (/[A-Z_]/.test(formula[i])) {
        let value = '';
        while (i < formula.length && /[A-Z0-9_]/.test(formula[i])) {
          value += formula[i];
          i++;
        }
        
        if (FUNCTIONS.has(value)) {
          tokens.push({ type: 'FUNCTION', value });
        } else if (CONSTANTS.has(value)) {
          tokens.push({ type: 'CONSTANT', value });
        } else {
          tokens.push({ type: 'IDENTIFIER', value });
        }
        continue;
      }
      
      // Operators and punctuation
      const twoChar = formula.substr(i, 2);
      if (twoChar === '>=' || twoChar === '<=' || twoChar === '<>' || twoChar === '!=') {
        tokens.push({ type: 'OPERATOR', value: twoChar });
        i += 2;
        continue;
      }
      
      // Single character operators
      const char = formula[i];
      if ('(){}[],&=<>+-*/%'.includes(char)) {
        tokens.push({ type: 'OPERATOR', value: char });
        i++;
        continue;
      }
      
      // Skip unknown characters
      i++;
    }
    
    return tokens;
  }

  parse(tokens) {
    // For minification, we don't need a full AST
    // We'll work directly with tokens
    return { tokens };
  }

  optimize(ast) {
    const tokens = ast.tokens;
    const optimized = [];
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const prev = optimized[optimized.length - 1];
      const next = tokens[i + 1];
      
      // Skip unnecessary tokens
      if (token.type === 'SPACE') {
        // Preserve space only where necessary
        if (prev && next && this.needsSpace(prev, next)) {
          optimized.push({ type: 'SPACE', value: ' ' });
        }
        continue;
      }
      
      // Optimize booleans
      if (this.shortenBooleans && token.type === 'CONSTANT') {
        if (token.value === 'TRUE') {
          optimized.push({ ...token, value: '1' });
          continue;
        } else if (token.value === 'FALSE') {
          optimized.push({ ...token, value: '0' });
          continue;
        }
      }
      
      // Merge consecutive strings
      if (this.mergeStrings && token.type === 'STRING' && prev?.type === 'STRING' && 
          prev.value[0] === token.value[0]) { // Same quote type
        const quote = prev.value[0];
        const merged = prev.content + token.content;
        optimized[optimized.length - 1] = {
          type: 'STRING',
          value: quote + merged + quote,
          content: merged
        };
        continue;
      }
      
      optimized.push(token);
    }
    
    // Remove redundant parentheses if enabled
    if (this.removeRedundantParens) {
      return { tokens: this.removeUnnecessaryParens(optimized) };
    }
    
    return { tokens: optimized };
  }

  needsSpace(prev, next) {
    // Don't need space around operators
    if (prev.type === 'OPERATOR' || next.type === 'OPERATOR') {
      return false;
    }
    
    // Need space between identifiers/functions
    if ((prev.type === 'IDENTIFIER' || prev.type === 'FUNCTION' || prev.type === 'CONSTANT') &&
        (next.type === 'IDENTIFIER' || next.type === 'FUNCTION' || next.type === 'CONSTANT')) {
      return true;
    }
    
    return false;
  }

  removeUnnecessaryParens(tokens) {
    // This is complex and risky - implement carefully
    // For now, return as-is
    return tokens;
  }

  generate(ast) {
    const tokens = ast.tokens;
    let result = '';
    let currentLength = 0;
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let value = token.value;
      
      // Apply additional optimizations
      if (token.type === 'SPACE' && this.removeSpaces) {
        continue; // Skip spaces in aggressive modes
      }
      
      // Check if we need to insert a line break for safety
      if (this.safeLineBreaks && currentLength > 0 && 
          currentLength + value.length > this.safeBreakThreshold) {
        // Find a safe place to break (after comma, closing paren, etc.)
        if (token.type === 'OPERATOR' && token.value === ',') {
          result += value + '\n';
          currentLength = 0;
          continue;
        }
      }
      
      result += value;
      currentLength += value.length;
    }
    
    return result;
  }

  insertSafeBreaks(formula) {
    // Insert line breaks at safe points to avoid tokenization limits
    const maxLen = this.safeBreakThreshold;
    if (formula.length <= maxLen) {
      return formula;
    }
    
    let result = '';
    let current = '';
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    
    for (let i = 0; i < formula.length; i++) {
      const char = formula[i];
      current += char;
      
      // Track string context
      if ((char === '"' || char === "'") && (i === 0 || formula[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
      
      // Track parentheses depth
      if (!inString) {
        if (char === '(') parenDepth++;
        if (char === ')') parenDepth--;
      }
      
      // Check if we should break
      if (current.length >= maxLen && !inString) {
        // Find the last safe break point
        let breakPoint = -1;
        
        // Prefer breaking after commas at the same paren level
        for (let j = current.length - 1; j >= current.length - 100 && j >= 0; j--) {
          if (current[j] === ',' && parenDepth === 0) {
            breakPoint = j + 1;
            break;
          }
        }
        
        // Or break after closing parenthesis
        if (breakPoint === -1) {
          for (let j = current.length - 1; j >= current.length - 100 && j >= 0; j--) {
            if (current[j] === ')') {
              breakPoint = j + 1;
              break;
            }
          }
        }
        
        if (breakPoint > 0) {
          result += current.substring(0, breakPoint) + '\n';
          current = current.substring(breakPoint);
        }
      }
    }
    
    result += current;
    return result;
  }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedFormulaMinifier;
}
