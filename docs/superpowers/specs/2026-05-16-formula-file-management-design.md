# Formula File Management — Design Spec
**Date:** 2026-05-16
**Status:** Approved

## Problem

Large Airtable formulas (90K+ chars) exceed Claude's output token limit when passed inline to `update_formula_field`, making it impossible for AI to push them. Users also have no structured way to maintain formula/script/automation files locally with a clear link back to their Airtable destination.

---

## Scope

**In this spec:**
- `formulaFilePath` parameter on `update_formula_field` and `create_formula_field`
- New MCP tool `download_formula_field`
- Universal `# AT:` / `// AT:` metadata header format (defined for all file types)
- Right-click "Upload to Airtable" for formula files
- VS Code command "Airtable: Download Formula Field"
- Auto-placeholder header on new file creation (all 3 language types)
- Language provider updates to skip header lines
- AI skills update documenting the header convention

**Deferred (separate spec):**
- Upload/download MCP tools for `airtable-script` and `airtable-automation` file types

---

## File Types Reference

| Language | Extensions | Comment style |
|---|---|---|
| `airtable-formula` | `.formula`, `.fx`, `.min.formula`, `.ultra-min.formula` | `# AT:` (pseudo-comment) |
| `airtable-script` | `.script`, `.ats` | `// AT:` |
| `airtable-automation` | `.automation`, `.ata` | `// AT:` |

---

## Section 1: Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (packages/mcp-server)                           │
│  · formulaFilePath param → update_formula_field             │
│  · formulaFilePath param → create_formula_field             │
│  · new tool: download_formula_field (read category)         │
└─────────────────────┬───────────────────────────────────────┘
                      │ reads/writes
┌─────────────────────▼───────────────────────────────────────┐
│  Local .formula / .fx files                                 │
│  # AT: appId=appXXX tableId=tblXXX fieldId=fldXXX          │
│  IF({Status} = "Active", "Yes", "No")                       │
└─────────────────────┬───────────────────────────────────────┘
                      │ strip header on upload, write header on download
┌─────────────────────▼───────────────────────────────────────┐
│  Extension (packages/extension)                             │
│  · Language providers: ignore AT: lines during analysis     │
│  · Auto-placeholder header on new file creation             │
│  · VS Code command: "Airtable: Download Formula Field"      │
│  · Right-click context menu: "Upload to Airtable"           │
│  · Skills update: document # AT: format for AI              │
└─────────────────────────────────────────────────────────────┘
```

**Upload data flow:**
1. User right-clicks `.formula` / `.fx` file → "Upload to Airtable"
2. Extension reads file, parses `# AT:` header for `appId` + `fieldId`
3. Strips header, sends clean formula text to daemon MCP `update_formula_field`
4. Success/error notification

**Download data flow (VS Code command):**
1. User runs "Airtable: Download Formula Field", enters `appId` + `fieldId`
2. Extension calls daemon MCP `download_formula_field`
3. Folder picker → saves `<fieldName>.formula` with `# AT:` header prepended
4. File opens in editor

**Download data flow (MCP/AI):**
1. AI calls `download_formula_field(appId, fieldId, outputPath)`
2. MCP server fetches field config, writes file with `# AT:` header to `outputPath`
3. Returns `{ written, path, fieldName, bytes }`

---

## Section 2: Metadata Header Format

### Syntax

**Formula files** (no native comment support — pseudo-comment convention):
```
# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX fieldName="Text Formula"
IF({Status} = "Active", "Yes", "No")
```

**Script files** (JavaScript — `//` comment):
```js
// AT: appId=appXXX extensionId=extXXX scriptName="My Script Block"
output.text('Hello');
```

**Automation files** (JavaScript — `//` comment):
```js
// AT: appId=appXXX automationId=autXXX actionId=actXXX automationName="Send Slack"
let inputData = input.config();
```

### Required fields per type

| File type | Minimum to upload | Optional |
|---|---|---|
| formula | `appId` + `fieldId` | `tableId`, `fieldName` |
| script | `appId` + `extensionId` | `scriptName` *(deferred)* |
| automation | `appId` + `automationId` + `actionId` | `automationName` *(deferred)* |

### Parsing rules

- A header line must start with exactly `# AT:` or `// AT:` (case-sensitive, space after colon)
- All header lines must be contiguous at the very top of the file
- First non-header line ends the header block
- Multiple header lines valid (same key-value format on each)
- Values with spaces must be quoted: `fieldName="My Text Formula"`

### `stripHeader(text, language)` helper

Strips all leading `# AT:` lines (formula) or `// AT:` lines (script/automation). Returns `{ formula: string, offset: number }` where `offset` is the number of stripped lines. Used by every upload path. Applied defensively to inline `formulaText` as well as file content — so copy-pasted text with headers never reaches the Airtable API.

### Error behavior on upload

- Missing `appId` or `fieldId` → block upload, show: *"No Airtable target found. Add a `# AT: appId=... fieldId=...` header, or use Download Formula Field to create a properly-linked file."*

---

## Section 3: MCP Server Changes

**Files:** `packages/mcp-server/src/index.js`, `packages/mcp-server/src/tool-config.js`

### 3.1 `formulaFilePath` on `update_formula_field` and `create_formula_field`

Both tools get an optional `formulaFilePath: string` parameter.

- When `formulaFilePath` is provided: read file → `stripHeader` → use as `formulaText`
- When both `formulaFilePath` and `formulaText` are supplied: `formulaFilePath` wins
- File not found: return error before touching Airtable
- Inline `formulaText`: `stripHeader` applied defensively regardless

Same stripping applied to:
- `update_field_config` when `fieldType = "formula"`
- `validate_formula`

### 3.2 New tool: `download_formula_field`

```
download_formula_field(appId, fieldId, outputPath)
```

- Fetches field config from Airtable (resolves `tableId` and `fieldName`)
- `outputPath` is **optional**:
  - Provided → writes `.formula` file with `# AT:` header, returns `{ written: true, path, fieldName, tableId, bytes }`
  - Omitted → returns `{ written: false, formulaText, fieldName, tableId }` (caller writes the file)
- Category: `read` (non-destructive)
- AI passes `outputPath` directly. The VS Code command omits it, gets the text back, then writes the file after the folder picker resolves.

### 3.3 Tool-sync propagation

`download_formula_field` in `read` category requires updates to all mirrored locations per CLAUDE.md:
1. `packages/mcp-server/src/tool-config.js`
2. `packages/mcp-server/src/index.js`
3. `packages/extension/src/mcp/tool-profile.ts`
4. `packages/extension/package.json` (category counts + mcpServerDefinitionProviders description)
5. `packages/webview/src/tabs/Settings.tsx`
6. `packages/webview/src/store.ts` + `store.test.ts`

---

## Section 4: Extension Commands

**New file:** `packages/extension/src/commands/formulaFile.ts`
**New file:** `packages/extension/src/commands/formulaFileTemplate.ts`

### 4.1 Right-click "Upload to Airtable" — `airtable-formula.uploadFormulaFile`

Registered in `package.json` under `menus.explorer/context`:

```json
{
  "command": "airtable-formula.uploadFormulaFile",
  "when": "resourceExtname == .formula || resourceExtname == .fx || resourceExtname == .min.formula || resourceExtname == .ultra-min.formula",
  "group": "airtable"
}
```

Handler flow:
```
read file
→ parseFormulaHeader() → extract appId + fieldId
→ missing header or IDs? → error notification with fix hint
→ stripHeader() → clean formula text
→ daemon HTTP MCP: update_formula_field(appId, fieldId, formulaText)
→ success: "✓ Formula uploaded (fieldId: fldXXX)"
→ error: show Airtable error message
```

Daemon not running → show: *"Start the Airtable daemon from the dashboard first."*

### 4.2 VS Code command "Airtable: Download Formula Field" — `airtable-formula.downloadFormulaField`

Available from command palette.

Handler flow:
```
input box: "Base ID (appXXX)"
→ input box: "Field ID (fldXXX)"
→ daemon HTTP MCP: download_formula_field(appId, fieldId)   ← no outputPath
→ response contains { formulaText, fieldName, tableId }
→ folder picker → final path = chosen folder / fieldName + ".formula"
→ extension writes file: # AT: header + formulaText
→ open file in editor
```

### 4.3 Auto-placeholder on file create — `onDidCreateFiles`

Registered in `extension.ts`. Triggers on empty newly created files of any Airtable language.

**Formula files** (`.formula`, `.fx`, `.min.formula`, `.ultra-min.formula`):
```
# AT: appId= tableId= fieldId= fieldName=""

```

**Script files** (`.script`, `.ats`):
```js
// AT: appId= extensionId= scriptName=""

```

**Automation files** (`.automation`, `.ata`):
```js
// AT: appId= automationId= actionId= automationName=""

```

Cursor placed using VS Code snippet syntax so Tab jumps between blank values. Guard: only insert if file is empty at creation time.

Both command handlers registered in `extension.ts` alongside existing command registrations.

---

## Section 5: Language Provider Updates

**New shared utility:** `packages/extension/src/language/formula/formula-header.ts`

```ts
export function stripFormulaHeader(text: string): { formula: string; offset: number } {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('# AT:')) i++;
  return { formula: lines.slice(i).join('\n'), offset: i };
}

export function parseFormulaHeader(text: string): Record<string, string> {
  // extracts key=value pairs from all leading # AT: lines
}
```

Applied in:
- `formula-diagnostics.ts` — strip before parsing; shift diagnostic line numbers by `offset`
- `formula-completions.ts` — adjust completion position by `offset`
- `formula-hover.ts` — adjust hover position by `offset`
- `formula-signature.ts` — adjust signature help position by `offset`

Script and automation language providers (`script-diagnostics.ts`, `automation-diagnostics.ts`) get the same treatment using `// AT:` prefix — same helper pattern, different prefix constant.

---

## Section 6: AI Skills Update

`packages/extension/src/skills/content.ts` gets a documented section on the metadata header convention:

- What `# AT:` / `// AT:` headers are and why they exist
- Required fields per file type (formula, script, automation)
- Rule: always include the header when creating or saving any Airtable file locally
- Rule: strip the header before showing formula text inline in conversation

This ensures AI assistants auto-populate headers without being asked, and never accidentally include header lines in MCP tool `formulaText` arguments.

---

## Implementation Order

1. `stripHeader` utility + `parseFormulaHeader` (shared foundation)
2. MCP: `formulaFilePath` on `update_formula_field` + `create_formula_field` (immediate bug fix — can ship as hotfix independently)
3. MCP: `download_formula_field` tool + tool-sync propagation
4. Extension: language provider offset fixes
5. Extension: `formulaFile.ts` command handlers (upload right-click + download command)
6. Extension: `formulaFileTemplate.ts` auto-placeholder on file create
7. Extension: `package.json` command + menu registrations
8. Skills: `content.ts` update
