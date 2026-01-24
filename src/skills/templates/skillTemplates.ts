/**
 * Skill templates for Airtable Formula extension
 * These are embedded in the extension and installed to the workspace on activation
 */

export const SKILL_CONTENT = `# Airtable Formula Skill

Expert assistance for writing, debugging, and optimizing Airtable formulas.

## When to Use

- Writing new Airtable formulas
- Debugging formula errors (#ERROR, NaN, Infinity)
- Optimizing complex nested formulas
- Converting Excel formulas to Airtable syntax
- Working with \`.formula\` files

## Key Differences from Excel

| Excel | Airtable |
|-------|----------|
| \`VLOOKUP\` | Use linked records |
| \`SUMIF/COUNTIF\` | Use rollup fields |
| \`IFERROR\` | \`IF(ISERROR(...), ...)\` |
| \`NOW()\` / \`TODAY()\` | Same, but callable constants |
| Cell references \`A1\` | Field references \`{Field Name}\` |

## Common Patterns

### Safe Division
\`\`\`
IF({Divisor} = 0, BLANK(), {Value} / {Divisor})
\`\`\`

### Null-Safe Field
\`\`\`
IF({Field}, {Field}, "default")
\`\`\`

### JSON Object
\`\`\`
"{" &
  "\\"id\\": \\"" & RECORD_ID() & "\\"," &
  "\\"name\\": \\"" & SUBSTITUTE({Name}, "\\"", "\\\\\\"") & "\\"" &
"}"
\`\`\`

### SWITCH vs Nested IF
\`\`\`
// Instead of deeply nested IF:
SWITCH({Status}, "A", 1, "B", 2, "C", 3, 0)
\`\`\`

## Error Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| \`#ERROR\` | Syntax/reference issue | Check quotes, brackets, field names |
| \`NaN\` | 0/0 or invalid date | Add null checks |
| \`Infinity\` | X/0 | Check divisor ≠ 0 |
| Smart quotes | Curly quotes \`""\` | Use straight quotes \`""\` |

## Function Categories

1. **Text**: CONCATENATE, LEFT, RIGHT, MID, SUBSTITUTE, TRIM, UPPER, LOWER
2. **Numeric**: SUM, AVERAGE, ROUND, MAX, MIN, COUNT, ABS, MOD
3. **Date/Time**: TODAY, NOW, DATEADD, DATETIME_DIFF, DATETIME_FORMAT
4. **Logical**: IF, SWITCH, AND, OR, NOT, ISERROR
5. **Array**: ARRAYJOIN, ARRAYUNIQUE, ARRAYCOMPACT, ARRAYSLICE
6. **Regex**: REGEX_MATCH, REGEX_EXTRACT, REGEX_REPLACE
7. **Record**: RECORD_ID, CREATED_TIME, LAST_MODIFIED_TIME
`;

export const RULE_CONTENT = `---
description: Always use Airtable Formula skill when working with .formula files
globs: ["**/*.formula"]
alwaysApply: true
---

# Airtable Formula Rules

When working with Airtable formulas:

1. **Use the Airtable Formula skill** for all formula-related tasks
2. **No comments allowed** - Airtable doesn't support // or /* */
3. **Field references use braces** - \`{Field Name}\` not cell references
4. **Smart quotes break formulas** - Always use straight quotes \`"\`
5. **Division needs guards** - Check for zero: \`IF({D}=0, BLANK(), {N}/{D})\`

## Quick Reference

- **Safe division**: \`IF({Divisor}=0, BLANK(), {Value}/{Divisor})\`
- **Error handling**: \`IF(ISERROR(expr), fallback, expr)\`
- **Date formatting**: \`DATETIME_FORMAT({Date}, "YYYY-MM-DD")\`
- **Join arrays**: \`ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")\`

## Not Available in Airtable

- VLOOKUP, HLOOKUP (use linked records)
- SUMIF, COUNTIF (use rollups)
- IFERROR (use IF(ISERROR(...)))
- Cell references (A1, B2)
`;

export const FUNCTIONS_REFERENCE = `# Airtable Functions Quick Reference

## Text
| Function | Syntax |
|----------|--------|
| CONCATENATE | \`CONCATENATE(text1, text2, ...)\` |
| LEFT | \`LEFT(string, count)\` |
| RIGHT | \`RIGHT(string, count)\` |
| MID | \`MID(string, start, count)\` |
| LEN | \`LEN(string)\` |
| FIND | \`FIND(needle, haystack, [start])\` |
| SEARCH | \`SEARCH(needle, haystack, [start])\` |
| SUBSTITUTE | \`SUBSTITUTE(string, old, new, [index])\` |
| REPLACE | \`REPLACE(string, start, count, new)\` |
| TRIM | \`TRIM(string)\` |
| UPPER | \`UPPER(string)\` |
| LOWER | \`LOWER(string)\` |
| REPT | \`REPT(string, n)\` |

## Numeric
| Function | Syntax |
|----------|--------|
| SUM | \`SUM(n1, n2, ...)\` |
| AVERAGE | \`AVERAGE(n1, n2, ...)\` |
| MIN | \`MIN(n1, n2, ...)\` |
| MAX | \`MAX(n1, n2, ...)\` |
| ROUND | \`ROUND(number, precision)\` |
| CEILING | \`CEILING(number, [significance])\` |
| FLOOR | \`FLOOR(number, [significance])\` |
| ABS | \`ABS(number)\` |
| MOD | \`MOD(number, divisor)\` |
| POWER | \`POWER(base, exponent)\` |
| SQRT | \`SQRT(number)\` |
| COUNT | \`COUNT(values...)\` |
| COUNTA | \`COUNTA(values...)\` |

## Date/Time
| Function | Syntax |
|----------|--------|
| TODAY | \`TODAY()\` |
| NOW | \`NOW()\` |
| DATEADD | \`DATEADD(date, count, units)\` |
| DATETIME_DIFF | \`DATETIME_DIFF(d1, d2, units)\` |
| DATETIME_FORMAT | \`DATETIME_FORMAT(date, format)\` |
| DATETIME_PARSE | \`DATETIME_PARSE(text, format)\` |
| YEAR | \`YEAR(date)\` |
| MONTH | \`MONTH(date)\` |
| DAY | \`DAY(date)\` |
| WEEKDAY | \`WEEKDAY(date, [start])\` |
| HOUR | \`HOUR(datetime)\` |
| MINUTE | \`MINUTE(datetime)\` |

## Logical
| Function | Syntax |
|----------|--------|
| IF | \`IF(condition, if_true, if_false)\` |
| SWITCH | \`SWITCH(expr, p1, r1, ..., default)\` |
| AND | \`AND(a, b, ...)\` |
| OR | \`OR(a, b, ...)\` |
| NOT | \`NOT(expr)\` |
| XOR | \`XOR(a, b, ...)\` |
| ISERROR | \`ISERROR(expr)\` |
| BLANK | \`BLANK()\` |

## Array
| Function | Syntax |
|----------|--------|
| ARRAYJOIN | \`ARRAYJOIN(array, separator)\` |
| ARRAYUNIQUE | \`ARRAYUNIQUE(array)\` |
| ARRAYCOMPACT | \`ARRAYCOMPACT(array)\` |
| ARRAYFLATTEN | \`ARRAYFLATTEN(array)\` |
| ARRAYSLICE | \`ARRAYSLICE(array, start, [end])\` |

## Regex
| Function | Syntax |
|----------|--------|
| REGEX_MATCH | \`REGEX_MATCH(string, pattern)\` |
| REGEX_EXTRACT | \`REGEX_EXTRACT(string, pattern)\` |
| REGEX_REPLACE | \`REGEX_REPLACE(string, pattern, replacement)\` |
`;

export const WORKFLOWS: Record<string, string> = {
    'debug-formula': `# Debug Airtable Formula

## Trigger
When user asks to debug or fix an Airtable formula error.

## Steps

1. **Identify the error type**
   - \`#ERROR\` → Syntax or reference issue
   - \`NaN\` → Division 0/0 or invalid date math
   - \`Infinity\` → Division X/0
   - \`Circular reference\` → Field references itself

2. **Check common issues**
   - [ ] Balanced parentheses \`()\`
   - [ ] Balanced braces \`{}\`
   - [ ] Balanced quotes \`""\` or \`''\`
   - [ ] No smart/curly quotes
   - [ ] No comments (\`//\` or \`/* */\`)
   - [ ] Field names spelled correctly
   - [ ] All function names valid

3. **Add guards for runtime errors**
   - Division: \`IF({D}=0, BLANK(), {N}/{D})\`
   - Dates: \`IF({Date}=BLANK(), BLANK(), ...)\`
   - Errors: \`IF(ISERROR(expr), fallback, expr)\`

4. **Test the fix**
   - Save the formula
   - Check output in Airtable
`,

    'create-formula': `# Create Airtable Formula

## Trigger
When user asks to create a new Airtable formula.

## Steps

1. **Understand requirements**
   - What fields are involved?
   - What is the expected output type?
   - Any edge cases (nulls, zeros, empty)?

2. **Choose approach**
   - Simple calculation → Direct operators
   - Conditional logic → IF or SWITCH
   - Text manipulation → String functions
   - Date calculations → DATETIME_* functions
   - Array operations → ARRAY* functions

3. **Build incrementally**
   - Start with core logic
   - Add null/error handling
   - Format output if needed

4. **Common patterns**
   \`\`\`
   // Safe division
   IF({Divisor}=0, BLANK(), {Value}/{Divisor})
   
   // Conditional text
   IF({Status}="Done", "✅", IF({Status}="In Progress", "🔄", "⬜"))
   
   // Date difference in days
   DATETIME_DIFF({End}, {Start}, 'days')
   
   // Join unique values
   ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")
   \`\`\`

5. **Validate**
   - Check syntax in VS Code extension
   - Test with sample data
`,

    'convert-excel': `# Convert Excel Formula to Airtable

## Trigger
When user wants to convert an Excel formula to Airtable.

## Common Conversions

| Excel | Airtable |
|-------|----------|
| \`A1\`, \`B2\` | \`{Field Name}\` |
| \`VLOOKUP\` | Use linked records + rollup |
| \`HLOOKUP\` | Use linked records + rollup |
| \`SUMIF\` | Use rollup field with SUM |
| \`COUNTIF\` | Use rollup field with COUNT |
| \`IFERROR(x,y)\` | \`IF(ISERROR(x), y, x)\` |
| \`ISBLANK(x)\` | \`x = BLANK()\` or \`NOT(x)\` |
| \`TEXT(x,"fmt")\` | \`DATETIME_FORMAT(x, "fmt")\` |
| \`DATEVALUE\` | \`DATETIME_PARSE\` |
| \`CONCATENATE\` | Same, or use \`&\` operator |
| \`NOW()\` | Same (callable constant) |
| \`TODAY()\` | Same (callable constant) |

## Steps

1. **Identify Excel functions used**
2. **Map to Airtable equivalents**
3. **Replace cell refs with field refs**
4. **Add error handling if needed**
5. **Test in Airtable**

## Not Available - Use Workarounds

- **VLOOKUP/HLOOKUP**: Create linked record field, then use rollup
- **SUMIF/COUNTIF**: Create linked records with filter, use rollup
- **INDIRECT**: Not available, restructure logic
- **OFFSET**: Not available, use ARRAYSLICE for arrays
`
};
