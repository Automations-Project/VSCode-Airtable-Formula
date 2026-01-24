const fs = require('fs');
const path = require('path');

// Pre-compiled regex patterns for performance (avoid creating in hot loops)
const WHITESPACE_RE = /\s/;
const DIGIT_RE = /\d/;
const DIGIT_DOT_RE = /[\d.]/;
const IDENTIFIER_RE = /[A-Z_0-9]/i;

/**
 * Advanced AST-Based Formula Minifier (v1)
 * Leverages parsing for intelligent compression
 * Note: v2 is available with safe mode and better optimization - select version in extension settings
 */
class AdvancedFormulaMinifier {
  constructor(options = {}) {
    this.level = options.level || 'standard'; // micro, standard, aggressive, extreme
    this.preserveReadability = options.preserve_readability || false;
    this.removeEmptyElse = options.remove_empty_else !== false;
    this.optimizeConstants = options.optimize_constants !== false;
    
    // Configure based on level
    switch (this.level) {
      case 'micro':
        this.removeSpaces = false;
        this.shortenBooleans = false;
        this.removeEmptyElse = true;
        break;
      case 'standard':
        this.removeSpaces = true;
        this.shortenBooleans = false;
        this.removeEmptyElse = true;
        break;
      case 'aggressive':
        this.removeSpaces = true;
        this.shortenBooleans = true;
        this.removeEmptyElse = true;
        this.mergeStrings = true;
        break;
      case 'extreme':
        this.removeSpaces = true;
        this.shortenBooleans = true;
        this.removeEmptyElse = true;
        this.mergeStrings = true;
        this.removeRedundantParens = true;
        break;
    }
  }

  minify(formula) {
    try {
      const tokens = this.tokenize(formula);
      const ast = this.parse(tokens);
      const optimized = this.optimize(ast);
      return this.compress(optimized);
    } catch (error) {
      console.error('Minification error:', error.message);
      // Fallback to simple minification
      return this.simpleMinify(formula);
    }
  }

  tokenize(formula) {
    const tokens = [];
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
      
      // Field references
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
      
      // Numbers - only treat '-' as negative sign at start, after '(', ',', or operators
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
      
      // Single-char operators
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
      
      // Function names
      let name = '';
      while (i < formula.length && IDENTIFIER_RE.test(formula[i])) {
        name += formula[i];
        i++;
      }
      
      let j = i;
      while (j < formula.length && WHITESPACE_RE.test(formula[j])) j++;
      
      tokens.push({
        type: j < formula.length && formula[j] === '(' ? 'FUNCTION' : 'IDENTIFIER',
        value: name
      });
    }
    
    return tokens;
  }

  parse(tokens) {
    let index = 0;
    
    const consume = () => tokens[index++];
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
      if (!token) throw new Error('Unexpected end of input');
      
      if (token.type === 'LPAREN') {
        consume();
        const expr = parseExpr();
        if (peek()?.type === 'RPAREN') consume();
        return { type: 'GROUP', expr };
      }
      
      if (token.type === 'FUNCTION') {
        const name = consume().value;
        if (peek()?.type === 'LPAREN') consume();
        
        const args = [];
        while (peek() && peek().type !== 'RPAREN') {
          if (peek().type === 'COMMA') {
            consume();
            continue;
          }
          args.push(parseExpr());
        }
        
        if (peek()?.type === 'RPAREN') consume();
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
      
      throw new Error(`Unexpected token: ${token.type} (${token.value})`);
    };
    
    return parseExpr();
  }

  optimize(node) {
    if (!node) return node;
    
    switch (node.type) {
      case 'CALL':
        return this.optimizeCall(node);
      
      case 'BINARY':
        return this.optimizeBinary(node);
      
      case 'GROUP':
        // Remove unnecessary grouping
        if (this.removeRedundantParens && this.isRedundantGroup(node)) {
          return this.optimize(node.expr);
        }
        node.expr = this.optimize(node.expr);
        return node;
      
      default:
        return node;
    }
  }

  optimizeCall(node) {
    const name = node.name.toUpperCase();
    node.args = (node.args || []).map(arg => this.optimize(arg));
    
    // Optimize IF statements
    if (name === 'IF') {
      // Remove empty else
      if (this.removeEmptyElse && node.args.length === 3) {
        const elseBranch = node.args[2];
        if (elseBranch && elseBranch.type === 'STRING' && 
            (elseBranch.value === '""' || elseBranch.value === "''")) {
          node.args = node.args.slice(0, 2);
        }
      }
      
      // Simplify IF(condition, TRUE(), FALSE()) to just condition
      if (node.args.length >= 2) {
        const trueBranch = node.args[1];
        const falseBranch = node.args[2];
        
        if (trueBranch?.type === 'CALL' && trueBranch.name === 'TRUE' &&
            falseBranch?.type === 'CALL' && falseBranch.name === 'FALSE') {
          return node.args[0];
        }
      }
    }
    
    // Optimize NOT(NOT(x)) to x
    if (name === 'NOT' && node.args.length === 1) {
      const arg = node.args[0];
      if (arg.type === 'CALL' && arg.name.toUpperCase() === 'NOT') {
        return this.optimize(arg.args[0]);
      }
    }
    
    // Optimize CONCATENATE with single arg
    if (name === 'CONCATENATE' && node.args.length === 1) {
      return node.args[0];
    }
    
    // Merge consecutive strings in CONCATENATE
    if (name === 'CONCATENATE' && this.mergeStrings) {
      const merged = [];
      let stringBuffer = [];
      
      for (const arg of node.args) {
        if (arg.type === 'STRING') {
          stringBuffer.push(this.getStringContent(arg.value));
        } else {
          if (stringBuffer.length > 0) {
            merged.push({ type: 'STRING', value: '"' + stringBuffer.join('') + '"' });
            stringBuffer = [];
          }
          merged.push(arg);
        }
      }
      
      if (stringBuffer.length > 0) {
        merged.push({ type: 'STRING', value: '"' + stringBuffer.join('') + '"' });
      }
      
      node.args = merged;
    }
    
    // Shorten boolean functions
    if (this.shortenBooleans) {
      if (name === 'TRUE') node.name = 'T';
      if (name === 'FALSE') node.name = 'F';
    }
    
    return node;
  }

  optimizeBinary(node) {
    node.left = this.optimize(node.left);
    node.right = this.optimize(node.right);
    
    // Optimize string concatenation
    if (node.op === '&' && this.mergeStrings) {
      if (node.left.type === 'STRING' && node.right.type === 'STRING') {
        const leftContent = this.getStringContent(node.left.value);
        const rightContent = this.getStringContent(node.right.value);
        return { type: 'STRING', value: '"' + leftContent + rightContent + '"' };
      }
    }
    
    // Optimize comparisons with empty strings
    if (node.op === '=' || node.op === '!=') {
      if (node.right.type === 'STRING' && 
          (node.right.value === '""' || node.right.value === "''")) {
        // field = "" -> ISBLANK(field)
        if (node.op === '=' && this.level === 'extreme') {
          return { type: 'CALL', name: 'ISBLANK', args: [node.left] };
        }
      }
    }
    
    return node;
  }

  isRedundantGroup(node) {
    // Group is redundant if it contains a single value or function call
    const expr = node.expr;
    if (!expr) return false;
    
    return expr.type === 'STRING' || 
           expr.type === 'FIELD' || 
           expr.type === 'NUMBER' ||
           expr.type === 'CALL';
  }

  compress(node) {
    if (!node) return '';
    
    switch (node.type) {
      case 'CALL':
        return this.compressCall(node);
      
      case 'BINARY':
        return this.compressBinary(node);
      
      case 'STRING':
        return node.value;
      
      case 'FIELD':
        return `{${node.value}}`;
      
      case 'NUMBER':
        return node.value;
      
      case 'IDENTIFIER':
        return node.value;
      
      case 'GROUP':
        return `(${this.compress(node.expr)})`;
      
      default:
        return '';
    }
  }

  compressCall(node) {
    const name = node.name;
    const args = (node.args || []).map(arg => this.compress(arg));
    
    if (this.removeSpaces) {
      return `${name}(${args.join(',')})`;
    } else {
      return `${name}(${args.join(', ')})`;
    }
  }

  compressBinary(node) {
    const left = this.compress(node.left);
    const right = this.compress(node.right);
    
    if (this.removeSpaces && this.canRemoveSpaces(node.op)) {
      return `${left}${node.op}${right}`;
    } else {
      return `${left} ${node.op} ${right}`;
    }
  }

  canRemoveSpaces(op) {
    // IMPORTANT: Airtable requires spaces around arithmetic operators!
    // Only & (concatenation) can safely have no spaces.
    // {A}*{B} is INVALID, must be {A} * {B}
    if (this.preserveReadability) {
      return false;
    }
    // Only concatenation operator can have spaces removed
    return op === '&';
  }

  getStringContent(value) {
    if (value[0] === '"' || value[0] === "'") {
      return value.slice(1, -1);
    }
    return value;
  }

  // Fallback simple minification
  simpleMinify(formula) {
    let result = '';
    let inString = false;
    let stringChar = null;
    let inField = false;
    
    for (let i = 0; i < formula.length; i++) {
      const char = formula[i];
      const prevChar = formula[i - 1];
      
      // Handle fields
      if (char === '{' && !inString) {
        inField = true;
        result += char;
        continue;
      }
      
      if (char === '}' && !inString && inField) {
        inField = false;
        result += char;
        continue;
      }
      
      if (inField) {
        result += char;
        continue;
      }
      
      // Handle strings
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
        result += char;
        continue;
      }
      
      if (inString) {
        // Skip newlines in strings
        if (char === '\n' || char === '\r') continue;
        result += char;
        continue;
      }
      
      // Skip whitespace
      if (/\s/.test(char)) {
        // Add space only if needed
        if (this.needsSpace(formula, i, result)) {
          result += ' ';
        }
        while (i + 1 < formula.length && /\s/.test(formula[i + 1])) {
          i++;
        }
        continue;
      }
      
      result += char;
    }
    
    return result.trim();
  }

  needsSpace(formula, index, result) {
    if (this.removeSpaces) return false;
    
    const next = formula[index + 1];
    const prev = result[result.length - 1];
    
    if (!prev || !next) return false;
    
    // Space after comma
    if (prev === ',') return true;
    
    // Space around operators
    if ('&=<>!'.includes(prev) || '&=<>!'.includes(next)) return true;
    
    // Space between alphanumeric
    if (/\w/.test(prev) && /\w/.test(next)) return true;
    
    return false;
  }

  // File operations
  async minifyFile(filePath, outputPath = null) {
    console.log(`Minifying ${path.basename(filePath)} (${this.level} mode)...`);
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const minified = this.minify(content);
      
      const output = outputPath || this.getMinifiedPath(filePath);
      fs.writeFileSync(output, minified, 'utf8');
      
      const ratio = ((1 - minified.length / content.length) * 100).toFixed(1);
      console.log(`✅ Compressed ${ratio}% (${content.length} → ${minified.length} chars)`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed: ${error.message}`);
      return false;
    }
  }

  getMinifiedPath(filePath) {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath, '.formula');
    const suffix = this.level === 'extreme' ? '.ultra-min' : '.min';
    return path.join(dir, `${name}${suffix}.formula`);
  }

  async minifyDirectory(dirPath, recursive = false) {
    const files = this.findFormulaFiles(dirPath, recursive);
    console.log(`Found ${files.length} formula files`);
    
    let totalOriginal = 0;
    let totalMinified = 0;
    let successCount = 0;
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      totalOriginal += content.length;
      
      if (await this.minifyFile(file)) {
        successCount++;
        const minPath = this.getMinifiedPath(file);
        const minContent = fs.readFileSync(minPath, 'utf8');
        totalMinified += minContent.length;
      }
    }
    
    const totalRatio = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
    console.log(`\n✅ Minified ${successCount}/${files.length} files`);
    console.log(`📊 Total compression: ${totalRatio}% (${totalOriginal} → ${totalMinified} chars)`);
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
        } else if (stat.isFile() && item.endsWith('.formula') && 
                   !item.includes('.min.') && !item.includes('.ultra-min.')) {
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
    console.log('Advanced Formula Minifier');
    console.log('Usage: minify <file> [options]');
    console.log('\nOptions:');
    console.log('  --level <n>       Minification level:');
    console.log('                      micro: Minimal changes');
    console.log('                      standard: Remove spaces (default)');
    console.log('                      aggressive: Merge strings, optimize');
    console.log('                      extreme: Maximum compression');
    console.log('  --recursive       Process directories recursively');
    console.log('  --output <file>   Output file');
    console.log('  --preserve        Preserve some readability');
    console.log('\nExamples:');
    console.log('  minify formula.formula --level extreme');
    console.log('  minify formulas/ --recursive --level aggressive');
    process.exit(0);
  }
  
  const target = args.find(a => !a.startsWith('-'));
  const options = {
    level: 'standard',
    preserve_readability: args.includes('--preserve')
  };
  
  const levelIdx = args.indexOf('--level');
  if (levelIdx !== -1) options.level = args[levelIdx + 1];
  
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;
  
  const minifier = new AdvancedFormulaMinifier(options);
  
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      minifier.minifyDirectory(target, args.includes('--recursive'));
    } else {
      minifier.minifyFile(target, outputPath);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = AdvancedFormulaMinifier;