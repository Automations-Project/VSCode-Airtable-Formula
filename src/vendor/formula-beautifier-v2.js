const fs = require('fs');
const path = require('path');

/**
 * Enhanced Airtable Formula Beautifier v2
 * Improvements based on extension development insights:
 * - Better comment handling (strips invalid comments with warning)
 * - Smarter JSON string concatenation formatting
 * - Improved field reference handling
 * - Better parentheses tracking
 * - Optimized for both human readability and minified output
 */
class EnhancedFormulaBeautifier {
  constructor(options = {}) {
    this.maxLineLength = options.max_line_length || 120;
    this.quoteStyle = options.quote_style || 'double';
    this.style = options.style || 'smart'; // ultra-compact, compact, readable, json, cascade, smart
    this.stripComments = options.strip_comments !== false; // Default: true (comments are invalid)
    this.warnOnComments = options.warn_on_comments !== false;
    this.preserveEmptyFieldRefs = options.preserve_empty_field_refs !== false; // For {} in JSON
    this.smartLineBreaks = options.smart_line_breaks !== false;
    
    // Smart style - adapts based on formula complexity
    if (this.style === 'smart') {
      this.indentSize = 2;
      this.aggressiveCompact = false;
      this.packArgs = false;
      this.inlineSimpleIfs = true;
      this.jsonAware = true;
      this.adaptiveFormatting = true;
    } else {
      this.setStylePresets();
    }
  }

  setStylePresets() {
    switch (this.style) {
      case 'ultra-compact':
        this.indentSize = 0;
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        break;
      case 'compact':
        this.indentSize = 1;
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        break;
      case 'readable':
        this.indentSize = 4;
        this.aggressiveCompact = false;
        this.packArgs = false;
        this.inlineSimpleIfs = false;
        break;
      case 'json':
        this.indentSize = 2;
        this.aggressiveCompact = false;
        this.packArgs = false;
        this.inlineSimpleIfs = true;
        this.jsonAware = true;
        break;
      case 'cascade':
        this.indentSize = 1;
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        this.cascadeMode = true;
        break;
    }
  }

  beautify(formula) {
    try {
      // Pre-process: handle comments
      if (this.stripComments) {
        const result = this.removeComments(formula);
        formula = result.cleaned;
        if (result.hadComments && this.warnOnComments) {
          console.warn('Warning: Comments were found and removed. Comments are not allowed in Airtable formulas.');
        }
      }

      const tokens = this.tokenize(formula);
      const ast = this.parse(tokens);
      const optimized = this.optimize(ast);
      
      // Adaptive formatting for smart mode
      if (this.adaptiveFormatting) {
        const complexity = this.calculateComplexity(ast);
        this.adjustFormattingForComplexity(complexity);
      }
      
      return this.print(optimized, 0);
    } catch (error) {
      console.error('Beautification error:', error.message);
      return formula;
    }
  }

  removeComments(formula) {
    let cleaned = formula;
    let hadComments = false;
    
    // Remove single-line comments
    cleaned = cleaned.replace(/\/\/[^\n]*/g, () => {
      hadComments = true;
      return '';
    });
    
    // Remove block comments
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, () => {
      hadComments = true;
      return '';
    });
    
    return { cleaned: cleaned.trim(), hadComments };
  }

  calculateComplexity(ast) {
    let complexity = {
      depth: 0,
      functionCount: 0,
      stringConcatCount: 0,
      ifNesting: 0,
      hasJsonPattern: false
    };
    
    const MAX_DEPTH = 100; // Prevent stack overflow on deeply nested formulas
    
    const analyze = (node, depth = 0) => {
      // Safety check: stop analyzing if too deep
      if (depth > MAX_DEPTH) {
        return;
      }
      
      complexity.depth = Math.max(complexity.depth, depth);
      
      if (!node || typeof node !== 'object') {
        return;
      }
      
      if (node.type === 'CALL') {
        complexity.functionCount++;
        if (node.name === 'IF') {
          complexity.ifNesting++;
        }
        if (Array.isArray(node.args)) {
          node.args.forEach(arg => analyze(arg, depth + 1));
        }
      } else if (node.type === 'BINARY' && node.op === '&') {
        complexity.stringConcatCount++;
        // Check for JSON pattern (string with quotes and colon)
        if (node.left?.type === 'STRING' && node.left.value && node.left.value.includes('":"')) {
          complexity.hasJsonPattern = true;
        }
      }
      
      if (node.left) analyze(node.left, depth + 1);
      if (node.right) analyze(node.right, depth + 1);
      if (node.expr) analyze(node.expr, depth + 1);
    };
    
    try {
      analyze(ast);
    } catch (e) {
      console.warn('Complexity analysis failed, using defaults:', e.message);
    }
    
    return complexity;
  }

  adjustFormattingForComplexity(complexity) {
    // Adjust formatting based on formula complexity
    if (complexity.hasJsonPattern) {
      this.jsonAware = true;
      this.indentSize = 2;
      this.packArgs = false;
    } else if (complexity.depth > 5 || complexity.functionCount > 10) {
      this.indentSize = 2;
      this.inlineSimpleIfs = false;
      this.packArgs = false;
    } else if (complexity.stringConcatCount > 5) {
      this.packArgs = false;
      this.smartLineBreaks = true;
    }
  }

  tokenize(formula) {
    const tokens = [];
    let i = 0;
    
    // Known Airtable functions - Complete list from official docs
    const FUNCTIONS = new Set([
      // Text functions
      'CONCATENATE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND', 'SEARCH',
      'SUBSTITUTE', 'REPLACE', 'TRIM', 'UPPER', 'LOWER', 'REPT', 'T',
      'VALUE', 'TEXT', 'ENCODE_URL_COMPONENT',
      // Logical functions (NOTE: TRUE/FALSE are constants, not functions!)
      'IF', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'ISERROR', 'ERROR', 'BLANK',
      // Numeric functions
      'ABS', 'AVERAGE', 'CEILING', 'COUNT', 'COUNTA', 'COUNTALL', 'EVEN',
      'EXP', 'FLOOR', 'INT', 'LOG', 'LOG10', 'MAX', 'MIN', 'MOD', 'ODD',
      'POWER', 'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SQRT', 'SUM',
      // Date/Time functions
      'DATEADD', 'DATEDIF', 'DATETIME_DIFF', 'DATETIME_FORMAT', 'DATETIME_PARSE',
      'DATESTR', 'DAY', 'HOUR', 'MINUTE', 'MONTH', 'SECOND', 'SET_LOCALE',
      'SET_TIMEZONE', 'TIMESTR', 'TONOW', 'FROMNOW', 'WEEKDAY', 'WEEKNUM',
      'WORKDAY', 'WORKDAY_DIFF', 'YEAR', 'NOW', 'TODAY',
      'IS_BEFORE', 'IS_AFTER', 'IS_SAME',
      // Array functions
      'ARRAYCOMPACT', 'ARRAYJOIN', 'ARRAYUNIQUE', 'ARRAYFLATTEN', 'ARRAYSLICE',
      // Regex functions
      'REGEX_MATCH', 'REGEX_EXTRACT', 'REGEX_REPLACE',
      // Record functions
      'RECORD_ID', 'CREATED_TIME', 'LAST_MODIFIED_TIME'
    ]);
    
    while (i < formula.length) {
      // Skip whitespace
      if (/\s/.test(formula[i])) {
        i++;
        continue;
      }
      
      // Handle Airtable line break character '\n' (single quotes around \n)
      if (formula.substr(i, 4) === "'\\n'") {
        tokens.push({ type: 'STRING', value: "'\\n'" });
        i += 4;
        continue;
      }
      
      // Detect and handle smart quotes (curly quotes) - convert to straight quotes
      // Smart quotes: " (\u201C), " (\u201D), ' (\u2018), ' (\u2019)
      const smartQuotes = {
        '\u201C': '"', '\u201D': '"',  // Left/right double curly quotes
        '\u2018': "'", '\u2019': "'"   // Left/right single curly quotes
      };
      if (smartQuotes[formula[i]]) {
        // Smart quotes are invalid - convert to straight quotes
        const smartQuote = formula[i];
        const straightQuote = smartQuotes[smartQuote];
        let value = straightQuote;
        let escaped = false;
        i++;
        
        while (i < formula.length) {
          const char = formula[i];
          // Handle smart closing quotes or straight quote
          const isClosingQuote = smartQuotes[char] === straightQuote || char === straightQuote;
          
          if (escaped) {
            value += char;
            escaped = false;
          } else if (char === '\\') {
            value += char;
            escaped = true;
          } else if (isClosingQuote) {
            value += straightQuote;
            i++;
            break;
          } else {
            value += char;
          }
          i++;
        }
        
        tokens.push({ type: 'STRING', value });
        continue;
      }
      
      // String literals - preserve exactly
      if (formula[i] === '"' || formula[i] === "'") {
        const quote = formula[i];
        let value = quote;
        let escaped = false;
        const startPos = i;
        i++;
        
        while (i < formula.length) {
          if (escaped) {
            value += formula[i];
            escaped = false;
          } else if (formula[i] === '\\') {
            value += formula[i];
            escaped = true;
          } else if (formula[i] === quote) {
            value += formula[i];
            i++;
            break;
          } else {
            value += formula[i];
          }
          i++;
        }
        
        // Check for unterminated string
        if (value[value.length - 1] !== quote) {
          throw new Error(`Unterminated string starting at position ${startPos}`);
        }
        
        tokens.push({ type: 'STRING', value });
        continue;
      }
      
      // Field references with improved handling
      if (formula[i] === '{') {
        let value = '{';
        let depth = 1;
        i++;
        
        while (i < formula.length && depth > 0) {
          if (formula[i] === '{') depth++;
          if (formula[i] === '}') depth--;
          value += formula[i];
          i++;
          if (depth === 0) break;
        }
        
        // Check for empty field reference
        if (value === '{}' && this.preserveEmptyFieldRefs) {
          tokens.push({ type: 'STRING', value: '"{}"' }); // Treat as string
        } else {
          tokens.push({ type: 'FIELD', value });
        }
        continue;
      }
      
      // Numbers
      if (/[0-9]/.test(formula[i])) {
        let value = '';
        while (i < formula.length && /[0-9.]/.test(formula[i])) {
          value += formula[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value });
        continue;
      }
      
      // Function names
      if (/[A-Z_]/.test(formula[i])) {
        let value = '';
        while (i < formula.length && /[A-Z0-9_]/.test(formula[i])) {
          value += formula[i];
          i++;
        }
        
        // Check if it's a known function or boolean constant
        if (FUNCTIONS.has(value)) {
          tokens.push({ type: 'FUNCTION', value });
        } else if (value === 'TRUE' || value === 'FALSE') {
          // TRUE and FALSE are boolean constants
          tokens.push({ type: 'CONSTANT', value });
        } else {
          // Other identifiers
          tokens.push({ type: 'IDENTIFIER', value });
        }
        continue;
      }
      
      // Operators and punctuation
      if (formula[i] === '(') {
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
      } else if (formula[i] === ')') {
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
      } else if (formula[i] === ',') {
        tokens.push({ type: 'COMMA', value: ',' });
        i++;
      } else if (formula[i] === '&') {
        tokens.push({ type: 'CONCAT', value: '&' });
        i++;
      } else if (formula.substr(i, 2) === '>=') {
        tokens.push({ type: 'GTE', value: '>=' });
        i += 2;
      } else if (formula.substr(i, 2) === '<=') {
        tokens.push({ type: 'LTE', value: '<=' });
        i += 2;
      } else if (formula.substr(i, 2) === '<>') {
        tokens.push({ type: 'NEQ', value: '<>' });
        i += 2;
      } else if (formula.substr(i, 2) === '!=') {
        tokens.push({ type: 'NEQ', value: '!=' });
        i += 2;
      } else if (formula[i] === '=') {
        tokens.push({ type: 'EQ', value: '=' });
        i++;
      } else if (formula[i] === '>') {
        tokens.push({ type: 'GT', value: '>' });
        i++;
      } else if (formula[i] === '<') {
        tokens.push({ type: 'LT', value: '<' });
        i++;
      } else if (formula[i] === '+') {
        tokens.push({ type: 'PLUS', value: '+' });
        i++;
      } else if (formula[i] === '-') {
        tokens.push({ type: 'MINUS', value: '-' });
        i++;
      } else if (formula[i] === '*') {
        tokens.push({ type: 'MULTIPLY', value: '*' });
        i++;
      } else if (formula[i] === '/') {
        tokens.push({ type: 'DIVIDE', value: '/' });
        i++;
      } else {
        i++; // Skip unknown characters
      }
    }
    
    return tokens;
  }

  parse(tokens) {
    let pos = 0;
    
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];
    
    const parseExpr = () => {
      return parseBinary(0);
    };
    
    const parseBinary = (minPrec) => {
      let left = parsePrimary();
      
      const precedence = {
        '&': 1,
        '=': 2, '<>': 2, '!=': 2,
        '<': 3, '>': 3, '<=': 3, '>=': 3,
        '+': 4, '-': 4,
        '*': 5, '/': 5
      };
      
      while (peek() && precedence[peek().value] && precedence[peek().value] >= minPrec) {
        const op = consume().value;
        const prec = precedence[op];
        const right = parseBinary(prec + 1);
        left = { type: 'BINARY', op, left, right };
      }
      
      return left;
    };
    
    const parsePrimary = () => {
      const token = peek();
      if (!token) throw new Error('Unexpected EOF');
      
      if (token.type === 'LPAREN') {
        consume();
        const expr = parseExpr();
        if (peek()?.type !== 'RPAREN') throw new Error('Expected )');
        consume();
        return { type: 'GROUP', expr };
      }
      
      if (token.type === 'FUNCTION') {
        const name = consume().value;
        if (peek()?.type !== 'LPAREN') {
          throw new Error(`Function '${name}' is missing its opening parenthesis. Should be '${name}('`);
        }
        consume();
        
        const args = [];
        while (peek() && peek().type !== 'RPAREN') {
          if (peek().type === 'COMMA') {
            consume();
            continue;
          }
          args.push(parseExpr());
        }
        
        if (peek()?.type !== 'RPAREN') throw new Error(`Missing closing parenthesis for function ${name}`);
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
      
      if (token.type === 'IDENTIFIER') {
        consume();
        return { type: 'IDENTIFIER', value: token.value };
      }
      
      if (token.type === 'CONSTANT') {
        consume();
        return { type: 'CONSTANT', value: token.value };
      }
      
      throw new Error(`Unexpected token: ${token.type}`);
    };
    
    const result = parseExpr();
    if (pos < tokens.length) {
      throw new Error(`Unexpected token after expression: ${tokens[pos].type}`);
    }
    return result;
  }

  optimize(ast) {
    // Optimization passes
    return this.optimizeNode(ast);
  }

  optimizeNode(node) {
    if (!node) return node;
    
    switch (node.type) {
      case 'CALL':
        // Special handling for IF statements
        if (node.name === 'IF' && node.args.length === 3) {
          const condition = this.optimizeNode(node.args[0]);
          const trueBranch = this.optimizeNode(node.args[1]);
          const falseBranch = this.optimizeNode(node.args[2]);
          
          // Check if this is a simple IF that can be inlined
          const condSimple = this.isSimpleExpr(condition);
          const trueSimple = this.isSimpleExpr(trueBranch);
          const falseSimple = this.isSimpleExpr(falseBranch);
          
          return {
            type: 'CALL',
            name: 'IF',
            args: [condition, trueBranch, falseBranch],
            canInline: this.inlineSimpleIfs && condSimple && trueSimple && falseSimple
          };
        }
        
        // Optimize all arguments
        return {
          ...node,
          args: node.args ? node.args.map(arg => this.optimizeNode(arg)) : []
        };
        
      case 'BINARY':
        // Special handling for string concatenation (avoid deep recursion)
        if (node.op === '&') {
          return this.optimizeConcat(node);
        }

        return {
          type: 'BINARY',
          op: node.op,
          left: this.optimizeNode(node.left),
          right: this.optimizeNode(node.right)
        };
        
      case 'GROUP':
        return {
          type: 'GROUP',
          expr: this.optimizeNode(node.expr)
        };
        
      default:
        return node;
    }
  }

  isSimpleExpr(node) {
    if (!node) return true;
    
    switch (node.type) {
      case 'STRING':
      case 'FIELD':
      case 'NUMBER':
      case 'IDENTIFIER':
        return true;
      case 'BINARY':
        return node.op !== '&'; // Concatenation is not simple
      case 'CALL':
        return false; // Function calls are not simple
      case 'GROUP':
        return this.isSimpleExpr(node.expr);
      default:
        return false;
    }
  }

  looksLikeJson(node) {
    if (node.type === 'STRING') {
      const val = node.value.slice(1, -1); // Remove quotes
      return val.includes('":"') || val.includes('":') || 
             val.startsWith('"') || val === '{' || val === '}' ||
             val === '[' || val === ']';
    }
    return false;
  }

  flattenBinaryChain(node, op) {
    const parts = [];
    let hasJsonConcat = false;
    let current = node;
    while (current && current.type === 'BINARY' && current.op === op) {
      if (current.isJsonConcat) {
        hasJsonConcat = true;
      }
      parts.push(current.right);
      current = current.left;
    }
    parts.push(current);
    parts.reverse();
    return { parts, hasJsonConcat };
  }

  optimizeConcat(node) {
    const { parts } = this.flattenBinaryChain(node, '&');
    const optimizedParts = parts.map(part => this.optimizeNode(part));

    let result = optimizedParts[0];
    for (let i = 1; i < optimizedParts.length; i++) {
      const left = result;
      const right = optimizedParts[i];
      const nextNode = {
        type: 'BINARY',
        op: '&',
        left,
        right
      };

      if (this.jsonAware && (this.looksLikeJson(left) || this.looksLikeJson(right))) {
        nextNode.isJsonConcat = true;
      }

      result = nextNode;
    }

    return result;
  }

  print(node, depth = 0) {
    if (!node) return '';
    
    switch (node.type) {
      case 'CALL':
        return this.printFunctionCall(node, depth);
        
      case 'BINARY':
        return this.printBinaryOp(node, depth);
        
      case 'GROUP':
        return `(${this.print(node.expr, depth)})`;
        
      case 'STRING':
        return node.value;
        
      case 'FIELD':
        return node.value;
        
      case 'NUMBER':
        return node.value;
        
      case 'IDENTIFIER':
        return node.value;
        
      case 'CONSTANT':
        return node.value;
        
      default:
        return '';
    }
  }

  printFunctionCall(node, depth) {
    const indentSize = this.indentSize || 2;
    const indent = ' '.repeat(indentSize * depth);
    const nextIndent = ' '.repeat(indentSize * (depth + 1));
    
    // Special formatting for IF
    if (node.name === 'IF') {
      if (node.canInline) {
        // Inline simple IF
        const args = node.args.map(arg => this.print(arg, depth)).join(', ');
        return `IF(${args})`;
      } else if (this.aggressiveCompact) {
        // Compact multi-line IF
        const cond = this.print(node.args[0], depth);
        const trueBranch = this.print(node.args[1], depth + 1);
        const falseBranch = this.print(node.args[2], depth + 1);
        
        if (indentSize === 0) {
          return `IF(${cond},${trueBranch},${falseBranch})`;
        } else {
          return `IF(\n${nextIndent}${cond},\n${nextIndent}${trueBranch},\n${nextIndent}${falseBranch}\n${indent})`;
        }
      } else {
        // Readable IF
        const cond = this.print(node.args[0], depth + 1);
        const trueBranch = this.print(node.args[1], depth + 1);
        const falseBranch = this.print(node.args[2], depth + 1);
        
        return `IF(\n${nextIndent}${cond},\n${nextIndent}${trueBranch},\n${nextIndent}${falseBranch}\n${indent})`;
      }
    }
    
    // Special formatting for CONCATENATE
    if (node.name === 'CONCATENATE' && !this.packArgs) {
      const args = node.args.map(arg => `${nextIndent}${this.print(arg, depth + 1)}`).join(',\n');
      return `CONCATENATE(\n${args}\n${indent})`;
    }
    
    // Default function formatting
    const args = node.args.map(arg => this.print(arg, depth + 1));
    
    if (this.packArgs || args.join(', ').length < this.maxLineLength) {
      return `${node.name}(${args.join(', ')})`;
    } else {
      return `${node.name}(\n${args.map(a => nextIndent + a).join(',\n')}\n${indent})`;
    }
  }

  printBinaryOp(node, depth) {
    if (node.op === '&') {
      const { parts, hasJsonConcat } = this.flattenBinaryChain(node, '&');
      const partStrings = parts.map(part => this.print(part, depth));

      if (this.jsonAware && hasJsonConcat) {
        const indentSize = this.indentSize || 2;
        const nextIndent = ' '.repeat(indentSize * (depth + 1));
        const inlineSeparatorLength = indentSize === 0 ? 1 : 3;
        const inlineLength = partStrings.reduce((sum, part) => sum + part.length, 0)
          + (partStrings.length - 1) * inlineSeparatorLength;
        const shouldBreak = this.smartLineBreaks || inlineLength > this.maxLineLength;

        if (shouldBreak) {
          if (indentSize === 0) {
            return partStrings.join('&');
          }
          return partStrings.join(`\n${nextIndent}& `);
        }

        return indentSize === 0 ? partStrings.join('&') : partStrings.join(' & ');
      }

      return partStrings.join(' & ');
    }

    const left = this.print(node.left, depth);
    const right = this.print(node.right, depth);
    const op = node.op;
    
    // Check if parentheses are needed based on precedence
    const needsParens = this.needsParentheses(node, depth);
    
    if (needsParens) {
      return `(${left} ${op} ${right})`;
    } else {
      return `${left} ${op} ${right}`;
    }
  }

  needsParentheses(node, depth) {
    // Simple heuristic - could be improved
    return false; // Let the GROUP nodes handle parentheses
  }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedFormulaBeautifier;
}
