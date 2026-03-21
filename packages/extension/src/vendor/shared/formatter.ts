/**
 * Unified Formula Formatter
 * Single entry point - no beautify vs minify distinction
 * The config determines the output style
 */

import { FormulaFormatterConfig, DEFAULT_CONFIG, mergeConfig } from './config';
import { PresetName, getPreset, fromLegacyStyle } from './presets';
import { validateConfig, assertValidConfig } from './validate';

// Pre-compiled regex patterns for performance
const WHITESPACE_RE = /\s/;
const DIGIT_RE = /\d/;
const DIGIT_DOT_RE = /[\d.]/;
const IDENTIFIER_RE = /[A-Z_0-9]/i;

// Token types
type TokenType = 
  | 'STRING' | 'FIELD' | 'NUMBER' | 'FUNCTION' 
  | 'CONSTANT' | 'IDENTIFIER' | 'OPERATOR'
  | 'LPAREN' | 'RPAREN' | 'COMMA';

interface Token {
  type: TokenType;
  value: string;
  content?: string;  // For strings, the unquoted content
}

// AST node types
type ASTNode = 
  | { type: 'CALL'; name: string; args: ASTNode[] }
  | { type: 'BINARY'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'GROUP'; expr: ASTNode }
  | { type: 'STRING'; value: string }
  | { type: 'FIELD'; value: string }
  | { type: 'NUMBER'; value: string }
  | { type: 'CONSTANT'; value: string }
  | { type: 'IDENTIFIER'; value: string };

export class FormulaFormatter {
  private config: FormulaFormatterConfig;
  private warnings: string[] = [];

  constructor(presetOrConfig: PresetName | Partial<FormulaFormatterConfig> | string) {
    // Handle preset name
    if (typeof presetOrConfig === 'string') {
      // Check if it's a known preset
      try {
        this.config = getPreset(presetOrConfig as PresetName);
      } catch {
        // Try legacy style mapping
        const preset = fromLegacyStyle(presetOrConfig, true);
        this.config = getPreset(preset);
      }
    } else {
      // Custom config object
      this.config = mergeConfig(DEFAULT_CONFIG, presetOrConfig);
    }
    
    // Validate
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join('; ')}`);
    }
    this.warnings = validation.warnings;
    
    if (this.config.safety.warnOnIssues) {
      validation.warnings.forEach(w => console.warn(`[FormulaFormatter] ${w}`));
    }
  }

  /**
   * Format a formula string
   * Single entry point - output style determined by config
   */
  format(formula: string): string {
    try {
      // Pre-processing
      formula = this.preprocess(formula);
      
      // Tokenize
      const tokens = this.tokenize(formula);
      
      // Parse to AST
      const ast = this.parse(tokens);
      
      // Generate output based on target
      let result = this.generate(ast, 0);
      
      // Post-processing
      result = this.postprocess(result);
      
      return result;
    } catch (error) {
      if (this.config.safety.warnOnIssues) {
        console.error('[FormulaFormatter] Error:', (error as Error).message);
      }
      // Return original on error
      return formula;
    }
  }

  /**
   * Get any warnings from config validation
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Get the active configuration
   */
  getConfig(): FormulaFormatterConfig {
    return { ...this.config };
  }

  // === PRE-PROCESSING ===
  
  private preprocess(formula: string): string {
    // Strip comments if configured
    if (this.config.safety.stripComments) {
      formula = formula.replace(/\/\/[^\n]*/g, '');
      formula = formula.replace(/\/\*[\s\S]*?\*\//g, '');
    }
    
    // Convert smart quotes if configured
    if (this.config.safety.convertSmartQuotes) {
      formula = formula
        .replace(/[\u201C\u201D]/g, '"')  // Curly double quotes
        .replace(/[\u2018\u2019]/g, "'"); // Curly single quotes
    }
    
    return formula.trim();
  }

  // === TOKENIZER ===
  
  private tokenize(formula: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    
    while (i < formula.length) {
      // Skip whitespace
      if (WHITESPACE_RE.test(formula[i])) {
        i++;
        continue;
      }
      
      // String literals
      if (formula[i] === '"' || formula[i] === "'") {
        const quote = formula[i];
        let value = quote;
        let content = '';
        let escaped = false;
        const startPos = i;
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
        
        // Check for unterminated string
        if (value[value.length - 1] !== quote) {
          throw new Error(`Unterminated string starting at position ${startPos}`);
        }
        
        tokens.push({ type: 'STRING', value, content });
        continue;
      }
      
      // Field references
      if (formula[i] === '{') {
        let value = '{';
        let depth = 1;
        i++;
        
        while (i < formula.length && depth > 0) {
          if (formula[i] === '{') {
            depth++;
          }
          if (formula[i] === '}') {
            depth--;
          }
          value += formula[i];
          i++;
        }
        
        tokens.push({ type: 'FIELD', value });
        continue;
      }
      
      // Numbers - only treat '-' as negative at start, after '(', ',', or operators
      const prevToken = tokens[tokens.length - 1];
      const canBeNegative = !prevToken || 
                            prevToken.type === 'LPAREN' || 
                            prevToken.type === 'COMMA' || 
                            prevToken.type === 'OPERATOR';
      
      if (DIGIT_RE.test(formula[i]) || 
          (formula[i] === '-' && canBeNegative && i + 1 < formula.length && DIGIT_RE.test(formula[i + 1]))) {
        let value = '';
        if (formula[i] === '-') {
          value = '-';
          i++;
        }
        while (i < formula.length && DIGIT_DOT_RE.test(formula[i])) {
          value += formula[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value });
        continue;
      }
      
      // Two-char operators
      const twoChar = formula.substring(i, i + 2);
      if (['>=', '<=', '!=', '<>'].includes(twoChar)) {
        tokens.push({ type: 'OPERATOR', value: twoChar });
        i += 2;
        continue;
      }
      
      // Single-char operators and punctuation
      if ('=<>&+-*/'.includes(formula[i])) {
        tokens.push({ type: 'OPERATOR', value: formula[i] });
        i++;
        continue;
      }
      
      if (formula[i] === '(') {
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
        continue;
      }
      
      if (formula[i] === ')') {
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
        continue;
      }
      
      if (formula[i] === ',') {
        tokens.push({ type: 'COMMA', value: ',' });
        i++;
        continue;
      }
      
      // Identifiers and functions
      if (IDENTIFIER_RE.test(formula[i])) {
        let value = '';
        while (i < formula.length && IDENTIFIER_RE.test(formula[i])) {
          value += formula[i];
          i++;
        }
        
        // Look ahead for function call
        let j = i;
        while (j < formula.length && WHITESPACE_RE.test(formula[j])) {
          j++;
        }
        
        const upper = value.toUpperCase();
        
        // TRUE and FALSE are constants
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({ type: 'CONSTANT', value: upper });
        }
        // Function if followed by (
        else if (j < formula.length && formula[j] === '(') {
          tokens.push({ type: 'FUNCTION', value: upper });
        }
        // Otherwise identifier
        else {
          tokens.push({ type: 'IDENTIFIER', value });
        }
        continue;
      }
      
      // Skip unknown characters
      i++;
    }
    
    return tokens;
  }

  // === PARSER ===
  
  private parse(tokens: Token[]): ASTNode {
    let index = 0;
    
    const peek = () => tokens[index] || null;
    const consume = () => tokens[index++];
    
    const parseExpr = () => parseBinary(0);
    
    const precedence: Record<string, number> = {
      '=': 1, '!=': 1, '<>': 1, '>': 1, '<': 1, '>=': 1, '<=': 1,
      '+': 2, '-': 2, '&': 2,
      '*': 3, '/': 3
    };
    
    const parseBinary = (minPrec: number): ASTNode => {
      let left = parsePrimary();
      
      while (peek() && peek()!.type === 'OPERATOR' && precedence[peek()!.value] >= minPrec) {
        const op = consume().value;
        const prec = precedence[op];
        const right = parseBinary(prec + 1);
        left = { type: 'BINARY', op, left, right };
      }
      
      return left;
    };
    
    const parsePrimary = (): ASTNode => {
      const token = peek();
      if (!token) {
        throw new Error('Unexpected end of input');
      }
      
      if (token.type === 'LPAREN') {
        consume();
        const expr = parseExpr();
        if (peek()?.type !== 'RPAREN') {
          throw new Error('Expected )');
        }
        consume();
        return { type: 'GROUP', expr };
      }
      
      if (token.type === 'FUNCTION') {
        const name = consume().value;
        if (peek()?.type !== 'LPAREN') {
          throw new Error(`Expected ( after ${name}`);
        }
        consume();
        
        const args: ASTNode[] = [];
        while (peek() && peek()!.type !== 'RPAREN') {
          if (peek()!.type === 'COMMA') {
            consume();
            continue;
          }
          args.push(parseExpr());
        }
        
        if (peek()?.type !== 'RPAREN') {
          throw new Error(`Missing ) for ${name}`);
        }
        consume();
        
        return { type: 'CALL', name, args };
      }
      
      if (token.type === 'STRING') {
        consume();
        return { type: 'STRING', value: token.value };
      }
      
      if (token.type === 'FIELD') {
        consume();
        return { type: 'FIELD', value: token.value };
      }
      
      if (token.type === 'NUMBER') {
        consume();
        return { type: 'NUMBER', value: token.value };
      }
      
      if (token.type === 'CONSTANT') {
        consume();
        return { type: 'CONSTANT', value: token.value };
      }
      
      if (token.type === 'IDENTIFIER') {
        consume();
        return { type: 'IDENTIFIER', value: token.value };
      }
      
      throw new Error(`Unexpected token: ${token.type}`);
    };
    
    const ast = parseExpr();
    if (index < tokens.length) {
      throw new Error(`Unexpected token after expression: ${tokens[index].type}`);
    }
    return ast;
  }

  // === CODE GENERATOR ===
  
  private generate(node: ASTNode, depth: number): string {
    const indent = this.getIndent(depth);
    const nextIndent = this.getIndent(depth + 1);
    const isFlat = this.config.target === 'airtable' || this.config.indent.size === 0;
    
    switch (node.type) {
      case 'CALL':
        return this.generateCall(node, depth);
      
      case 'BINARY':
        return this.generateBinary(node, depth);
      
      case 'GROUP':
        return `(${this.generate(node.expr, depth)})`;
      
      case 'STRING':
        return this.formatString(node.value);
      
      case 'FIELD':
        return node.value;
      
      case 'NUMBER':
      case 'CONSTANT':
      case 'IDENTIFIER':
        return node.value;
      
      default:
        return '';
    }
  }

  private generateCall(node: { type: 'CALL'; name: string; args: ASTNode[] }, depth: number): string {
    const name = this.formatFunctionName(node.name);
    const args = node.args;
    const isFlat = this.config.target === 'airtable' || this.config.indent.size === 0;
    const indent = this.getIndent(depth);
    const nextIndent = this.getIndent(depth + 1);
    
    // Handle IF specially based on ifStyle
    if (name === 'IF') {
      return this.generateIf(node, depth);
    }
    
    // For flat output or simple calls
    if (isFlat || args.length <= 2) {
      const flatArgs = args.map(a => this.generate(a, depth)).join(', ');
      const flat = `${name}(${flatArgs})`;
      
      // Check if it fits on one line
      if (isFlat || flat.length <= this.config.lineBreaks.maxLength || this.config.lineBreaks.maxLength === 0) {
        return flat;
      }
    }
    
    // Multi-line format
    const formattedArgs = args.map(a => `${nextIndent}${this.generate(a, depth + 1)}`).join(',\n');
    return `${name}(\n${formattedArgs}\n${indent})`;
  }

  private generateIf(node: { type: 'CALL'; name: string; args: ASTNode[] }, depth: number): string {
    const args = node.args;
    const isFlat = this.config.target === 'airtable' || this.config.indent.size === 0;
    const ifStyle = this.config.functions.ifStyle;
    const indent = this.getIndent(depth);
    const nextIndent = this.getIndent(depth + 1);
    
    // For airtable target, always inline
    if (isFlat || ifStyle === 'inline') {
      const flatArgs = args.map(a => this.generate(a, depth)).join(', ');
      return `IF(${flatArgs})`;
    }
    
    // Auto: decide based on complexity
    if (ifStyle === 'auto') {
      const flat = `IF(${args.map(a => this.generate(a, depth)).join(', ')})`;
      if (flat.length <= this.config.lineBreaks.maxLength || this.config.lineBreaks.maxLength === 0) {
        return flat;
      }
    }
    
    // Cascade: nested IFs on same line as else
    if (ifStyle === 'cascade' && args.length >= 3 && args[2].type === 'CALL' && args[2].name === 'IF') {
      const cond = this.generate(args[0], depth);
      const trueBranch = this.generate(args[1], depth);
      const falseBranch = this.generate(args[2], depth);  // Keep same depth for cascade
      return `IF(${cond}, ${trueBranch},\n${nextIndent}${falseBranch})`;
    }
    
    // Multiline
    const formattedArgs = args.map(a => `${nextIndent}${this.generate(a, depth + 1)}`).join(',\n');
    return `IF(\n${formattedArgs}\n${indent})`;
  }

  private generateBinary(node: { type: 'BINARY'; op: string; left: ASTNode; right: ASTNode }, depth: number): string {
    const left = this.generate(node.left, depth);
    const right = this.generate(node.right, depth);
    const op = node.op;
    const isFlat = this.config.target === 'airtable' || this.config.indent.size === 0;
    
    // For concatenation, check jsonAware formatting
    if (op === '&' && this.config.concatenation.jsonAware && !isFlat) {
      const combined = `${left} & ${right}`;
      if (combined.length > this.config.lineBreaks.maxLength && this.config.lineBreaks.maxLength > 0) {
        const nextIndent = this.getIndent(depth + 1);
        if (this.config.concatenation.breakBeforeOperator) {
          return `${left}\n${nextIndent}& ${right}`;
        } else {
          return `${left} &\n${nextIndent}${right}`;
        }
      }
    }
    
    // Airtable requires spaces around arithmetic operators (except &)
    if (op === '&' && isFlat) {
      return `${left}&${right}`;
    }
    
    return `${left} ${op} ${right}`;
  }

  // === HELPERS ===
  
  private getIndent(depth: number): string {
    if (this.config.indent.size === 0) {
      return '';
    }
    const char = this.config.indent.style === 'tabs' ? '\t' : ' ';
    return char.repeat(this.config.indent.size * depth);
  }

  private formatFunctionName(name: string): string {
    switch (this.config.functions.case) {
      case 'upper': return name.toUpperCase();
      case 'lower': return name.toLowerCase();
      default: return name;
    }
  }

  private formatString(value: string): string {
    const targetQuote = this.config.strings.quotes === 'single' ? "'" : '"';
    const currentQuote = value[0];
    
    if (this.config.strings.quotes === 'preserve' || currentQuote === targetQuote) {
      return value;
    }
    
    // Convert quote style
    const content = value.slice(1, -1);
    const escaped = content
      .replace(new RegExp(`\\\\${currentQuote}`, 'g'), currentQuote)
      .replace(new RegExp(targetQuote, 'g'), `\\${targetQuote}`);
    
    return `${targetQuote}${escaped}${targetQuote}`;
  }

  // === POST-PROCESSING ===
  
  private postprocess(result: string): string {
    // Apply max output length if configured
    if (this.config.safety.maxOutputLength > 0 && result.length > this.config.safety.maxOutputLength) {
      result = this.insertSafeBreaks(result);
    }
    
    return result;
  }

  private insertSafeBreaks(formula: string): string {
    const maxLen = this.config.safety.maxOutputLength;
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
        if (char === '(') {
          parenDepth++;
        }
        if (char === ')' && parenDepth > 0) {
          parenDepth--;
        }
      }
      
      // Check if we should break
      if (current.length >= maxLen && !inString) {
        let breakPoint = -1;
        
        // Find safe break point
        for (let j = current.length - 1; j >= Math.max(0, current.length - 100); j--) {
          if (current[j] === ',' || current[j] === ')') {
            breakPoint = j + 1;
            break;
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

// Export for convenience
export { FormulaFormatterConfig, PresetName };
