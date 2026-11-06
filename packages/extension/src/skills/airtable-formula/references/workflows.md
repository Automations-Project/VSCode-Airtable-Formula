# Airtable Formula Workflows

## Debug Airtable Formula

### Trigger
When user asks to debug or fix an Airtable formula error.

### Steps

1. **Identify the error type**
   - `#ERROR` → Syntax or reference issue
   - `NaN` → Division 0/0 or invalid date math
   - `Infinity` → Division X/0
   - `Circular reference` → Field references itself

2. **Check common issues**
   - [ ] Balanced parentheses `()`
   - [ ] Balanced braces `{}`
   - [ ] Balanced quotes `""` or `''`
   - [ ] No smart/curly quotes
   - [ ] No comments (`//` or `/* */`)
   - [ ] Field names spelled correctly
   - [ ] All function names valid

3. **Add guards for runtime errors**
   - Division: `IF({D}=0, BLANK(), {N}/{D})`
   - Dates: `IF({Date}=BLANK(), BLANK(), ...)`
   - Errors: `IF(ISERROR(expr), fallback, expr)`

4. **Test the fix**
   - Save the formula
   - Check output in Airtable

## Create Airtable Formula

### Trigger
When user asks to create a new Airtable formula.

### Steps

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
   ```
   // Safe division
   IF({Divisor}=0, BLANK(), {Value}/{Divisor})
   
   // Conditional text
   IF({Status}="Done", "✅", IF({Status}="In Progress", "🔄", "⬜"))
   
   // Date difference in days
   DATETIME_DIFF({End}, {Start}, 'days')
   
   // Join unique values
   ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")
   ```

5. **Validate**
   - Check syntax in VS Code extension
   - Test with sample data

## Convert Excel Formula to Airtable

### Trigger
When user wants to convert an Excel formula to Airtable.

### Common Conversions

| Excel | Airtable |
|-------|----------|
| `A1`, `B2` | `{Field Name}` |
| `VLOOKUP` | Use linked records + rollup |
| `HLOOKUP` | Use linked records + rollup |
| `SUMIF` | Use rollup field with SUM |
| `COUNTIF` | Use rollup field with COUNT |
| `IFERROR(x,y)` | `IF(ISERROR(x), y, x)` |
| `ISBLANK(x)` | `x = BLANK()` or `NOT(x)` |
| `TEXT(x,"fmt")` | `DATETIME_FORMAT(x, "fmt")` |
| `DATEVALUE` | `DATETIME_PARSE` |
| `CONCATENATE` | Same, or use `&` operator |
| `NOW()` | Same (callable constant) |
| `TODAY()` | Same (callable constant) |

### Steps

1. **Identify Excel functions used**
2. **Map to Airtable equivalents**
3. **Replace cell refs with field refs**
4. **Add error handling if needed**
5. **Test in Airtable**

### Not Available - Use Workarounds

- **VLOOKUP/HLOOKUP**: Create linked record field, then use rollup
- **SUMIF/COUNTIF**: Create linked records with filter, use rollup
- **INDIRECT**: Not available, restructure logic
- **OFFSET**: Not available, use ARRAYSLICE for arrays

## Agent persona

### Role
You are an Airtable formula specialist. When asked to create or modify Airtable formulas:

1. Always validate syntax before returning — use the MCP `validate_formula` tool if available
2. Reference `{FieldName}` syntax for fields (curly braces required)
3. Apply null-guarding: wrap field references in `IF({Field} = "", "", ...)`
4. Use the beautifier style the user prefers (default: readable)
5. Never use JavaScript/Excel syntax — Airtable has its own function set

### Available MCP Tools (via airtable-user-mcp)
- `validate_formula` — validate before saving
- `get_table_schema` — inspect field names and types
- `update_formula_field` — update a formula field directly; supports `formulaFilePath` parameter for large formulas
- `download_formula_field` — download a formula field to a local .formula file

### Local File Metadata Header

Large Airtable formulas can exceed LLM output token limits, making it impractical to pass them inline. To solve this, every local Airtable file carries an `AT:` metadata header on its first line. This header links the local file to its destination in Airtable so the right-click "Upload to Airtable" command (and MCP tools) know exactly where to send it — no manual argument entry required.

#### Header format by file type

**Formula files** (`.formula`, `.fx`, `.min.formula`, `.ultra-min.formula`):
```
# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX fieldName="Field Name"
```

**Script files** (`.script`, `.ats`):
```
// AT: appId=appXXX extensionId=extXXX scriptName="Script Name"
```

**Automation files** (`.automation`, `.ata`):
```
// AT: appId=appXXX automationId=autXXX actionId=actXXX automationName="Automation Name"
```

#### Minimum required fields for upload
- Formula: `appId` + `fieldId` (tableId and fieldName are recommended but optional)
- Script: `appId` + `extensionId`
- Automation: `appId` + `automationId` + `actionId`

#### Rules for AI agents

1. **ALWAYS include the AT: header** when creating or saving any Airtable file locally — on the very first line, before any formula or script content.
2. **NEVER pass AT: header lines inside a `formulaText` argument** to MCP tools. Strip the header line(s) first, or use `formulaFilePath` instead (the extension strips the header automatically when reading the file).
3. **Use `formulaFilePath` instead of inline `formulaText`** when a formula exceeds ~30 K characters to avoid hitting output token limits. Pass the absolute path to the local `.formula` file; the MCP tool will read and upload it directly.
4. When downloading a formula with `download_formula_field`, the saved file already contains the correct AT: header — do not modify it unless the user explicitly requests a rename or move.
