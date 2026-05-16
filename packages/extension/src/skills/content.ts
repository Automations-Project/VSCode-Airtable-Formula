// Re-exports existing template strings from the moved templates directory
export { SKILL_CONTENT, RULE_CONTENT, WORKFLOWS, FUNCTIONS_REFERENCE } from '../skills/templates/skillTemplates.js';

// Additional content for new file types
export const AGENTS_CONTENT = `# Airtable Formula Agent

## Role
You are an Airtable formula specialist. When asked to create or modify Airtable formulas:

1. Always validate syntax before returning — use the MCP \`validate_formula\` tool if available
2. Reference \`{FieldName}\` syntax for fields (curly braces required)
3. Apply null-guarding: wrap field references in \`IF({Field} = "", "", ...)\`
4. Use the beautifier style the user prefers (default: readable)
5. Never use JavaScript/Excel syntax — Airtable has its own function set

## Available MCP Tools (via airtable-user-mcp)
- \`validate_formula\` — validate before saving
- \`get_table_schema\` — inspect field names and types
- \`update_formula_field\` — update a formula field directly; supports \`formulaFilePath\` parameter for large formulas
- \`download_formula_field\` — download a formula field to a local .formula file

## Local File Metadata Header

Large Airtable formulas can exceed LLM output token limits, making it impractical to pass them inline. To solve this, every local Airtable file carries an \`AT:\` metadata header on its first line. This header links the local file to its destination in Airtable so the right-click "Upload to Airtable" command (and MCP tools) know exactly where to send it — no manual argument entry required.

### Header format by file type

**Formula files** (\`.formula\`, \`.fx\`, \`.min.formula\`, \`.ultra-min.formula\`):
\`\`\`
# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX fieldName="Field Name"
\`\`\`

**Script files** (\`.script\`, \`.ats\`):
\`\`\`
// AT: appId=appXXX extensionId=extXXX scriptName="Script Name"
\`\`\`

**Automation files** (\`.automation\`, \`.ata\`):
\`\`\`
// AT: appId=appXXX automationId=autXXX actionId=actXXX automationName="Automation Name"
\`\`\`

### Minimum required fields for upload
- Formula: \`appId\` + \`fieldId\` (tableId and fieldName are recommended but optional)
- Script: \`appId\` + \`extensionId\`
- Automation: \`appId\` + \`automationId\` + \`actionId\`

### Rules for AI agents

1. **ALWAYS include the AT: header** when creating or saving any Airtable file locally — on the very first line, before any formula or script content.
2. **NEVER pass AT: header lines inside a \`formulaText\` argument** to MCP tools. Strip the header line(s) first, or use \`formulaFilePath\` instead (the extension strips the header automatically when reading the file).
3. **Use \`formulaFilePath\` instead of inline \`formulaText\`** when a formula exceeds ~30 K characters to avoid hitting output token limits. Pass the absolute path to the local \`.formula\` file; the MCP tool will read and upload it directly.
4. When downloading a formula with \`download_formula_field\`, the saved file already contains the correct AT: header — do not modify it unless the user explicitly requests a rename or move.
`;
