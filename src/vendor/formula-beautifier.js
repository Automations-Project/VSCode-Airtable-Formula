const fs = require('fs');
const path = require('path');

/**
 * Advanced Compact Airtable Formula Beautifier
 * Optimized for JSON output, minimal indentation, and maximum readability
 */
class CompactFormulaBeautifier {
  constructor(options = {}) {
    this.maxLineLength = options.max_line_length || 120;
    this.quoteStyle = options.quote_style || 'double';
    this.style = options.style || 'compact'; // ultra-compact, compact, readable, json, cascade
    
    // Style-specific settings
    switch (this.style) {
      case 'ultra-compact':
        this.indentSize = 0; // No indentation at all
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        break;
      case 'compact':
        this.indentSize = options.indent_size !== undefined ? options.indent_size : 1;
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        break;
      case 'readable':
        this.indentSize = options.indent_size !== undefined ? options.indent_size : 4;
        this.aggressiveCompact = false;
        this.packArgs = false;
        this.inlineSimpleIfs = false;
        break;
      case 'json':
        this.indentSize = options.indent_size !== undefined ? options.indent_size : 2;
        this.aggressiveCompact = true;
        this.packArgs = false;
        this.inlineSimpleIfs = true;
        this.jsonMode = true;
        break;
      case 'cascade':
        this.indentSize = options.indent_size !== undefined ? options.indent_size : 1;
        this.aggressiveCompact = true;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
        this.cascadeMode = true;
        break;
      default:
        this.indentSize = options.indent_size !== undefined ? options.indent_size : 1;
        this.aggressiveCompact = options.aggressive_compact !== false;
        this.packArgs = true;
        this.inlineSimpleIfs = true;
    }
  }

  beautify(formula) {
    try {
      const tokens = this.tokenize(formula);
      const ast = this.parse(tokens);
      const optimized = this.optimize(ast);
      return this.print(optimized, 0);
    } catch (error) {
      console.error('Parse error:', error.message);
      return formula;
    }
  }

  tokenize(formula) {
    const tokens = [];
    let i = 0;
    
    while (i < formula.length) {
      // Skip whitespace
      if (/\s/.test(formula[i])) {
        i++;
        continue;
      }
      
      // String literals - preserve exactly
      if (formula[i] === '"' || formula[i] === "'") {
        const quote = formula[i];
        let value = quote;
        let escaped = false;
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
        tokens.push({ type: 'STRING', value });
        continue;
      }
      
      // Field references - preserve content exactly
      if (formula[i] === '{') {
        let value = '';
        let depth = 1;
        i++;
        while (i < formula.length && depth > 0) {
          if (formula[i] === '{') depth++;
          if (formula[i] === '}') depth--;
          value += formula[i];
          i++;
        }
        tokens.push({ type: 'FIELD', value: value.slice(0, -1) });
        continue;
      }
      
      // Numbers
      if (/\d/.test(formula[i]) || 
          (formula[i] === '-' && i + 1 < formula.length && /\d/.test(formula[i + 1]))) {
        let value = '';
        if (formula[i] === '-') {
          value = '-';
          i++;
        }
        while (i < formula.length && /[\d.]/.test(formula[i])) {
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
      if ('()=<>&+-*/,'.includes(formula[i])) {
        tokens.push({ 
          type: formula[i] === '(' ? 'LPAREN' :
                formula[i] === ')' ? 'RPAREN' :
                formula[i] === ',' ? 'COMMA' : 'OPERATOR',
          value: formula[i]
        });
        i++;
        continue;
      }
      
      // Function names and identifiers
      let name = '';
      while (i < formula.length && /[A-Z_0-9]/i.test(formula[i])) {
        name += formula[i];
        i++;
      }
      
      // Look ahead for function call
      let j = i;
      while (j < formula.length && /\s/.test(formula[j])) j++;
      
      tokens.push({
        type: j < formula.length && formula[j] === '(' ? 'FUNCTION' : 'IDENTIFIER',
        value: name
      });
    }
    
    return tokens;
  }

  parse(tokens) {
    let index = 0;
    
    const consume = (expected) => {
      if (index >= tokens.length) throw new Error(`Expected ${expected}, got EOF`);
      return tokens[index++];
    };
    
    const peek = () => tokens[index] || null;
    
    const parseExpr = () => parseBinary(0);
    
    const precedence = {
      '=': 1, '!=': 1, '<>': 1, '>': 1, '<': 1, '>=': 1, '<=': 1,
      '+': 2, '-': 2, '&': 2,
      '*': 3, '/': 3
    };
    
    const parseBinary = (minPrec) => {
      let left = parsePrimary();
      
      while (peek() && peek().type === 'OPERATOR' && precedence[peek().value] >= minPrec) {
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
        if (peek()?.type !== 'LPAREN') throw new Error(`Expected ( after ${name}`);
        consume();
        
        const args = [];
        while (peek() && peek().type !== 'RPAREN') {
          if (peek().type === 'COMMA') {
            consume();
            continue;
          }
          args.push(parseExpr());
        }
        
        if (peek()?.type !== 'RPAREN') throw new Error('Expected )');
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
      
      throw new Error(`Unexpected token: ${token.type}`);
    };
    
    const ast = parseExpr();
    if (index < tokens.length) {
      throw new Error(`Unexpected token after expression: ${tokens[index].type}`);
    }
    return ast;
  }

  optimize(node) {
    if (!node) return node;
    
    switch (node.type) {
      case 'CALL':
        // Optimize function arguments recursively
        node.args = (node.args || []).map(arg => this.optimize(arg));
        
        // Remove empty string else clauses in IF
        if (node.name.toUpperCase() === 'IF' && node.args.length === 3) {
          const lastArg = node.args[2];
          if (lastArg && lastArg.type === 'STRING' && 
              (lastArg.value === '""' || lastArg.value === "''")) {
            node.args = node.args.slice(0, 2);
          }
        }
        return node;
        
      case 'BINARY':
        node.left = this.optimize(node.left);
        node.right = this.optimize(node.right);
        return node;
        
      case 'GROUP':
        node.expr = this.optimize(node.expr);
        return node;
        
      default:
        return node;
    }
  }

  print(node, indent = 0) {
    switch (node.type) {
      case 'CALL':
        return this.printCall(node, indent);
      
      case 'BINARY':
        return this.printBinary(node, indent);
      
      case 'STRING':
        return this.normalizeQuotes(node.value);
      
      case 'FIELD':
        return `{${node.value}}`;
      
      case 'NUMBER':
      case 'IDENTIFIER':
        return node.value;
      
      case 'GROUP':
        return `(${this.print(node.expr, 0)})`;
      
      default:
        return '';
    }
  }

  printCall(node, indent) {
    const name = node.name.toUpperCase();
    const args = node.args || [];
    
    // Special handlers for specific functions
    switch (name) {
      case 'IF':
        return this.printIf(node, indent);
      case 'CONCATENATE':
        return this.printConcatenate(node, indent);
      case 'AND':
      case 'OR':
        return this.printLogical(node, indent);
      case 'NOT':
        return this.printNot(node, indent);
      case 'ENCODE_URL_COMPONENT':
      case 'TRIM':
        return this.printWrapper(node, indent);
      default:
        return this.printGenericCall(node, indent);
    }
  }

  printIf(node, indent) {
    const args = node.args;
    if (args.length === 0) return 'IF()';
    
    // Detect nested IF cascade
    const isNestedIf = args[2] && args[2].type === 'CALL' && 
                       args[2].name.toUpperCase() === 'IF';
    
    // Analyze condition pattern
    const condition = args[0];
    const isFieldCheck = this.isFieldCheck(condition);
    const isSimpleCheck = this.isSimple(condition);
    
    // Single line for very simple cases
    if (isSimpleCheck && args.length <= 2) {
      const flat = `IF(${this.flatPrint(args[0])}, ${this.flatPrint(args[1])})`;
      if (flat.length + indent <= this.maxLineLength) return flat;
    }
    
    // Compact cascade for nested IFs with field checks
    if (isNestedIf && isFieldCheck) {
      return this.printIfCascadeCompact(node, indent);
    }
    
    // Standard multi-line
    return this.printIfMultiline(node, indent);
  }

  printIfCascadeCompact(node, indent) {
    const args = node.args;
    const condition = this.flatPrint(args[0]);
    const trueBranch = this.flatPrint(args[1]);
    
    // Check if true branch is simple enough for same line
    if (condition.length + trueBranch.length + 7 < this.maxLineLength - indent) {
      // Ultra-compact: everything on minimal lines
      return `IF(${condition}, ${trueBranch}, ${this.print(args[2], indent)})`;
    }
    
    // Multi-line but compact - closing paren and next IF on same line
    let result = `IF(\n`;
    result += ' '.repeat(indent + this.indentSize) + `${condition},\n`;
    result += ' '.repeat(indent + this.indentSize) + `${this.print(args[1], indent + this.indentSize)},\n`;
    result += ' '.repeat(indent + this.indentSize) + `${this.print(args[2], indent + this.indentSize)})`;
    
    return result;
  }

  printIfMultiline(node, indent) {
    const args = node.args;
    const lines = [];
    
    lines.push('IF(');
    
    for (let i = 0; i < args.length; i++) {
      const argIndent = indent + this.indentSize;
      const printed = this.print(args[i], argIndent);
      lines.push(' '.repeat(argIndent) + printed + (i < args.length - 1 ? ',' : ''));
    }
    
    lines.push(' '.repeat(indent) + ')');
    return lines.join('\n');
  }

  printConcatenate(node, indent) {
    const args = node.args;
    if (args.length === 0) return 'CONCATENATE()';
    
    // Analyze content for JSON patterns
    const hasJsonPattern = this.detectJsonPattern(args);
    
    if (hasJsonPattern) {
      return this.printJsonConcatenate(node, indent);
    }
    
    // Pack as many items per line as possible
    return this.printPackedConcatenate(node, indent);
  }

  printJsonConcatenate(node, indent) {
    const args = node.args;
    const groups = this.groupJsonElements(args);
    
    const lines = ['CONCATENATE('];
    const baseIndent = indent + this.indentSize;
    
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupStr = this.formatJsonGroup(group, baseIndent);
      lines.push(' '.repeat(baseIndent) + groupStr + (i < groups.length - 1 ? ',' : ''));
    }
    
    lines.push(' '.repeat(indent) + ')');
    return lines.join('\n');
  }

  printPackedConcatenate(node, indent) {
    const args = node.args;
    
    // Try single line first
    const flat = `CONCATENATE(${args.map(a => this.flatPrint(a)).join(', ')})`;
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Pack multiple args per line
    const lines = ['CONCATENATE('];
    const baseIndent = indent + this.indentSize;
    let currentLine = [];
    let currentLength = baseIndent;
    
    for (let i = 0; i < args.length; i++) {
      const argStr = this.flatPrint(args[i]);
      const needComma = i < args.length - 1;
      const addStr = argStr + (needComma ? ',' : '');
      
      if (currentLine.length > 0 && currentLength + addStr.length + 2 > this.maxLineLength) {
        lines.push(' '.repeat(baseIndent) + currentLine.join(' '));
        currentLine = [addStr];
        currentLength = baseIndent + addStr.length;
      } else {
        if (currentLine.length > 0) {
          currentLine[currentLine.length - 1] += ',';
          currentLine.push(argStr + (needComma ? ',' : ''));
        } else {
          currentLine.push(addStr);
        }
        currentLength += addStr.length + 2;
      }
    }
    
    if (currentLine.length > 0) {
      lines.push(' '.repeat(baseIndent) + currentLine.join(' '));
    }
    
    lines.push(' '.repeat(indent) + ')');
    return lines.join('\n');
  }

  printLogical(node, indent) {
    const name = node.name.toUpperCase();
    const args = node.args;
    
    // Single line for simple cases
    const flat = `${name}(${args.map(a => this.flatPrint(a)).join(', ')})`;
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Group similar conditions
    const groups = this.groupSimilarConditions(args);
    const lines = [`${name}(`];
    const baseIndent = indent + this.indentSize;
    
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.length === 1) {
        lines.push(' '.repeat(baseIndent) + 
                   this.print(group[0], baseIndent) + 
                   (i < groups.length - 1 ? ',' : ''));
      } else {
        // Multiple similar conditions on same line if they fit
        const groupStr = group.map(g => this.flatPrint(g)).join(', ');
        if (groupStr.length + baseIndent <= this.maxLineLength) {
          lines.push(' '.repeat(baseIndent) + groupStr + (i < groups.length - 1 ? ',' : ''));
        } else {
          for (let j = 0; j < group.length; j++) {
            const isLast = i === groups.length - 1 && j === group.length - 1;
            lines.push(' '.repeat(baseIndent) + 
                       this.print(group[j], baseIndent) + 
                       (!isLast ? ',' : ''));
          }
        }
      }
    }
    
    lines.push(' '.repeat(indent) + ')');
    return lines.join('\n');
  }

  printNot(node, indent) {
    const args = node.args;
    if (args.length === 0) return 'NOT()';
    
    // Always try single line for NOT
    const flat = `NOT(${this.flatPrint(args[0])})`;
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Multi-line only if necessary
    return `NOT(\n${' '.repeat(indent + this.indentSize)}${this.print(args[0], indent + this.indentSize)}\n${' '.repeat(indent)})`;
  }

  printWrapper(node, indent) {
    const name = node.name.toUpperCase();
    const args = node.args;
    
    // Wrapper functions should stay compact
    if (args.length === 0) return `${name}()`;
    if (args.length === 1) {
      // Nest the inner content properly
      const inner = this.print(args[0], indent + name.length + 1);
      return `${name}(${inner})`;
    }
    
    return this.printGenericCall(node, indent);
  }

  printGenericCall(node, indent) {
    const name = node.name.toUpperCase();
    const args = node.args || [];
    
    // Try single line
    const flat = `${name}(${args.map(a => this.flatPrint(a)).join(', ')})`;
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Multi-line
    const lines = [`${name}(`];
    const baseIndent = indent + this.indentSize;
    
    for (let i = 0; i < args.length; i++) {
      lines.push(' '.repeat(baseIndent) + 
                 this.print(args[i], baseIndent) + 
                 (i < args.length - 1 ? ',' : ''));
    }
    
    lines.push(' '.repeat(indent) + ')');
    return lines.join('\n');
  }

  printBinary(node, indent) {
    // Special handling for concatenation chains
    if (node.op === '&') {
      return this.printConcatChain(node, indent);
    }
    
    // Simple binary operations
    const flat = this.flatPrint(node);
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Multi-line with operator leading
    const parts = this.collectBinaryParts(node);
    const lines = [];
    
    lines.push(this.print(parts[0].node, indent));
    
    for (let i = 1; i < parts.length; i++) {
      lines.push(' '.repeat(indent + this.indentSize) + 
                 parts[i].op + ' ' + 
                 this.print(parts[i].node, 0));
    }
    
    return lines.join('\n');
  }

  printConcatChain(node, indent) {
    const parts = this.flattenConcat(node);
    
    // Try single line
    const flat = parts.map(p => this.flatPrint(p)).join(' & ');
    if (flat.length + indent <= this.maxLineLength) return flat;
    
    // Intelligent grouping for JSON-like output
    const groups = this.groupConcatParts(parts);
    const lines = [];
    let currentLine = '';
    
    for (const group of groups) {
      const groupStr = group.map(p => this.flatPrint(p)).join(' & ');
      
      if (currentLine && currentLine.length + groupStr.length + 3 > this.maxLineLength - indent) {
        lines.push(currentLine);
        currentLine = groupStr;
      } else {
        currentLine = currentLine ? currentLine + ' & ' + groupStr : groupStr;
      }
    }
    
    if (currentLine) lines.push(currentLine);
    
    if (lines.length === 1) return lines[0];
    
    // Format with continuation
    let result = lines[0];
    for (let i = 1; i < lines.length; i++) {
      result += '\n' + ' '.repeat(indent + this.indentSize) + '& ' + lines[i];
    }
    
    return result;
  }

  // Helper methods
  
  detectJsonPattern(args) {
    // Check if concatenation contains JSON-like patterns
    for (const arg of args) {
      if (arg.type === 'STRING') {
        const inner = this.getStringInner(arg.value);
        if (inner.includes('":') || inner === '{' || inner === '}' || 
            inner.includes('",') || inner === '[' || inner === ']') {
          return true;
        }
      }
    }
    return false;
  }

  groupJsonElements(args) {
    const groups = [];
    let currentGroup = [];
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.type === 'STRING') {
        const inner = this.getStringInner(arg.value);
        
        // Start new group on structural elements
        if (inner === '{' || inner === '[') {
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          groups.push([arg]);
        }
        // End group on closing elements
        else if (inner === '}' || inner === ']' || inner === '},' || inner === '],') {
          currentGroup.push(arg);
          groups.push(currentGroup);
          currentGroup = [];
        }
        // Key-value pairs stay together
        else if (inner.includes('":')) {
          if (currentGroup.length > 0 && !this.isJsonKey(currentGroup[currentGroup.length - 1])) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          currentGroup.push(arg);
        }
        else {
          currentGroup.push(arg);
        }
      } else {
        currentGroup.push(arg);
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  formatJsonGroup(group, indent) {
    if (group.length === 1) {
      return this.print(group[0], indent);
    }
    
    // Keep key-value pairs together
    const items = group.map(g => this.flatPrint(g));
    return items.join(', ');
  }

  groupConcatParts(parts) {
    const groups = [];
    let currentGroup = [];
    
    for (const part of parts) {
      if (part.type === 'STRING') {
        const inner = this.getStringInner(part.value);
        
        if (inner === '{' || inner === '}' || inner === '[' || inner === ']') {
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          groups.push([part]);
        } else {
          currentGroup.push(part);
          if (currentGroup.length >= 3) {
            groups.push(currentGroup);
            currentGroup = [];
          }
        }
      } else {
        currentGroup.push(part);
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  groupSimilarConditions(args) {
    const groups = [];
    let currentGroup = [];
    let currentPattern = null;
    
    for (const arg of args) {
      const pattern = this.getConditionPattern(arg);
      
      if (pattern === currentPattern) {
        currentGroup.push(arg);
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [arg];
        currentPattern = pattern;
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  getConditionPattern(node) {
    if (node.type === 'CALL' && node.name.toUpperCase() === 'NOT') {
      return 'NOT_' + this.getConditionPattern(node.args[0]);
    }
    
    if (node.type === 'BINARY' && node.op === '=') {
      if (node.left.type === 'FIELD') {
        return 'FIELD_EQ';
      }
    }
    
    if (node.type === 'CALL' && node.name.toUpperCase() === 'OR') {
      return 'OR_GROUP';
    }
    
    return 'OTHER';
  }

  isFieldCheck(node) {
    if (node.type === 'CALL') {
      const name = node.name.toUpperCase();
      if (name === 'NOT' || name === 'OR' || name === 'AND') {
        return node.args.some(arg => this.isFieldCheck(arg));
      }
    }
    
    if (node.type === 'BINARY') {
      return node.left.type === 'FIELD' || node.right.type === 'FIELD';
    }
    
    return false;
  }

  isJsonKey(node) {
    if (node.type === 'STRING') {
      const inner = this.getStringInner(node.value);
      return inner.includes('":');
    }
    return false;
  }

  flattenConcat(node) {
    if (node.type === 'BINARY' && node.op === '&') {
      return [...this.flattenConcat(node.left), ...this.flattenConcat(node.right)];
    }
    return [node];
  }

  collectBinaryParts(node, op = null) {
    if (node.type !== 'BINARY') {
      return [{ op, node }];
    }
    
    if (op && node.op !== op) {
      return [{ op, node }];
    }
    
    const left = this.collectBinaryParts(node.left, node.op);
    const right = this.collectBinaryParts(node.right, node.op);
    
    if (left.length === 1 && left[0].op === null) {
      left[0].op = op;
    }
    right[0].op = node.op;
    
    return [...left, ...right];
  }

  normalizeQuotes(value) {
    if (this.quoteStyle === 'double' && value[0] === "'") {
      const inner = value.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'");
      return `"${inner}"`;
    } else if (this.quoteStyle === 'single' && value[0] === '"') {
      const inner = value.slice(1, -1).replace(/'/g, "\\'").replace(/\\"/g, '"');
      return `'${inner}'`;
    }
    return value;
  }

  getStringInner(value) {
    if (value[0] === '"' || value[0] === "'") {
      return value.slice(1, -1);
    }
    return value;
  }

  flatPrint(node) {
    if (!node) return '';
    
    switch (node.type) {
      case 'CALL':
        const args = (node.args || []).map(a => this.flatPrint(a)).join(', ');
        return `${node.name}(${args})`;
      
      case 'BINARY':
        return `${this.flatPrint(node.left)} ${node.op} ${this.flatPrint(node.right)}`;
      
      case 'STRING':
        return this.normalizeQuotes(node.value);
      
      case 'FIELD':
        return `{${node.value}}`;
      
      case 'NUMBER':
      case 'IDENTIFIER':
        return node.value;
      
      case 'GROUP':
        return `(${this.flatPrint(node.expr)})`;
      
      default:
        return '';
    }
  }

  isSimple(node) {
    if (!node) return true;
    
    switch (node.type) {
      case 'STRING':
      case 'FIELD':
      case 'NUMBER':
      case 'IDENTIFIER':
        return true;
      
      case 'CALL':
        if (node.args.length > 2) return false;
        return node.args.every(a => this.isSimple(a));
      
      case 'BINARY':
        return this.isSimple(node.left) && this.isSimple(node.right);
      
      case 'GROUP':
        return this.isSimple(node.expr);
      
      default:
        return false;
    }
  }

  // File operations
  async beautifyFile(filePath, outputPath = null) {
    console.log(`Beautifying ${path.basename(filePath)}...`);
    
    try {
      const formula = fs.readFileSync(filePath, 'utf8');
      const beautified = this.beautify(formula);
      const output = outputPath || filePath;
      
      fs.writeFileSync(output, beautified, 'utf8');
      console.log(`✅ Beautified: ${path.basename(filePath)}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed: ${error.message}`);
      return false;
    }
  }

  async beautifyDirectory(dirPath, recursive = false) {
    console.log('Scanning for formula files...');
    
    const files = this.findFormulaFiles(dirPath, recursive);
    console.log(`Found ${files.length} formula files`);
    
    let successCount = 0;
    for (const file of files) {
      if (await this.beautifyFile(file)) successCount++;
    }
    
    console.log(`\n✅ Beautified ${successCount}/${files.length} files`);
  }

  findFormulaFiles(dirPath, recursive = false) {
    const files = [];
    
    const scanDir = (dir) => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && recursive) {
          scanDir(fullPath);
        } else if (stat.isFile() && item.endsWith('.formula')) {
          files.push(fullPath);
        }
      }
    };
    
    scanDir(dirPath);
    return files;
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log('Compact Formula Beautifier');
    console.log('Usage: beautify <file> [options]');
    console.log('\nOptions:');
    console.log('  --max-line-length <n>  Max line length (default: 120)');
    console.log('  --quote-style <style>  Quote style: double|single (default: double)');
    console.log('  --indent-size <n>      Indentation spaces (default: 1)');
    console.log('  --write                Write in place');
    console.log('  --output <file>        Output file');
    console.log('  --recursive            Process directories recursively');
    console.log('  --aggressive-compact   Maximum compactness (default: true)');
    process.exit(0);
  }
  
  const target = args.find(a => !a.startsWith('-'));
  const options = {
    max_line_length: 120,
    quote_style: 'double',
    indent_size: 1,
    aggressive_compact: true
  };
  
  const maxLineIdx = args.indexOf('--max-line-length');
  if (maxLineIdx !== -1) options.max_line_length = parseInt(args[maxLineIdx + 1]);
  
  const quoteIdx = args.indexOf('--quote-style');
  if (quoteIdx !== -1) options.quote_style = args[quoteIdx + 1];
  
  const indentIdx = args.indexOf('--indent-size');
  if (indentIdx !== -1) options.indent_size = parseInt(args[indentIdx + 1]);
  
  if (args.includes('--no-aggressive-compact')) {
    options.aggressive_compact = false;
  }
  
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;
  
  const beautifier = new CompactFormulaBeautifier(options);
  
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      beautifier.beautifyDirectory(target, args.includes('--recursive'));
    } else {
      beautifier.beautifyFile(target, args.includes('--write') ? null : outputPath);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = CompactFormulaBeautifier;