# Formula File Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `# AT:` / `// AT:` metadata headers to all Airtable file types, `formulaFilePath` on MCP formula tools, a `download_formula_field` MCP tool, right-click upload and command-palette download commands, auto-placeholder header on file creation, and language provider offset fixes so headers are invisible to the parser.

**Architecture:** A shared `stripHeader` / `parseHeader` utility in each package strips AT: comment lines before any formula text reaches the Airtable API or language parser. The extension calls the daemon's MCP HTTP endpoint (`POST http://127.0.0.1:{port}/mcp` with bearer token) for upload and download operations. The `onDidCreateFiles` VS Code event inserts snippet-based placeholder headers whenever an empty Airtable file is created.

**Tech Stack:** Node.js ESM (`node:fs/promises`) for MCP server; TypeScript + VS Code API (`vscode.workspace.onDidCreateFiles`, `vscode.window.showInputBox`, `vscode.window.showOpenDialog`) for extension; `node:test` + `assert` for MCP tests; `vitest` + `vi.mock('vscode', ...)` for extension tests.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/mcp-server/src/formula-header.js` | `stripHeader(raw, lang)` + `parseHeader(raw, lang)` — MCP-side utility |
| Create | `packages/mcp-server/test/test-formula-header.test.js` | Unit tests for the above |
| Modify | `packages/mcp-server/src/index.js` | `formulaFilePath` param + defensive strip + `download_formula_field` tool |
| Modify | `packages/mcp-server/src/tool-config.js` | Add `download_formula_field` to `read` category |
| Modify | `packages/mcp-server/test/test-tool-config.test.js` | Update tool count + read-tools list |
| Create | `packages/extension/src/language/formula/formula-header.ts` | Extension-side strip/parse with line `offset` |
| Create | `packages/extension/src/test/formula-header.test.ts` | Unit tests for the above |
| Modify | `packages/extension/src/language/formula/formula-diagnostics.ts` | Strip header + shift diagnostic positions |
| Modify | `packages/extension/src/language/formula/formula-completions.ts` | Shift completion position by offset |
| Modify | `packages/extension/src/language/formula/formula-hover.ts` | Shift hover position by offset |
| Modify | `packages/extension/src/language/formula/formula-signature.ts` | Shift signature position by offset |
| Modify | `packages/extension/src/language/script/script-diagnostics.ts` | Strip `// AT:` header |
| Modify | `packages/extension/src/language/automation/automation-diagnostics.ts` | Strip `// AT:` header |
| Create | `packages/extension/src/commands/formulaFile.ts` | Upload + download command handlers |
| Create | `packages/extension/src/commands/formulaFileTemplate.ts` | Auto-placeholder on `onDidCreateFiles` |
| Modify | `packages/extension/src/extension.ts` | Register all new commands + `onDidCreateFiles` listener |
| Modify | `packages/extension/package.json` | Command + context menu declarations + tool counts |
| Modify | `packages/extension/src/mcp/tool-profile.ts` | Mirror `download_formula_field` in `read` category |
| Modify | `packages/webview/src/tabs/Settings.tsx` | Tool count label update |
| Modify | `packages/webview/src/store.ts` | Bump `totalCount` default |
| Modify | `packages/webview/src/test/store.test.ts` | Update count assertions |
| Modify | `packages/extension/src/skills/content.ts` | Document `# AT:` format for AI |

---

## Task 1: MCP server `formula-header.js` utility

**Files:**
- Create: `packages/mcp-server/src/formula-header.js`
- Create: `packages/mcp-server/test/test-formula-header.test.js`

- [ ] **Step 1.1: Write the failing tests**

```js
// packages/mcp-server/test/test-formula-header.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripHeader, parseHeader } from '../src/formula-header.js';

describe('stripHeader', () => {
  it('strips leading # AT: lines from formula text', () => {
    const raw = '# AT: appId=appXXX fieldId=fldXXX\nIF({A} = 1, "yes", "no")';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF({A} = 1, "yes", "no")');
    assert.equal(offset, 1);
  });

  it('strips multiple # AT: lines', () => {
    const raw = '# AT: appId=appXXX\n# AT: fieldId=fldXXX\nIF(1,2,3)';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF(1,2,3)');
    assert.equal(offset, 2);
  });

  it('does not strip non-header lines', () => {
    const raw = 'IF({A} = 1, "yes", "no")';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, raw);
    assert.equal(offset, 0);
  });

  it('strips // AT: lines for script language', () => {
    const raw = '// AT: appId=appXXX extensionId=extXXX\noutput.text("hi");';
    const { text, offset } = stripHeader(raw, 'script');
    assert.equal(text, 'output.text("hi");');
    assert.equal(offset, 1);
  });

  it('strips inline formula text that was copy-pasted with header', () => {
    const raw = '# AT: appId=appXXX fieldId=fldXXX\nIF({X},1,0)';
    const { text } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF({X},1,0)');
  });

  it('handles empty input', () => {
    const { text, offset } = stripHeader('', 'formula');
    assert.equal(text, '');
    assert.equal(offset, 0);
  });
});

describe('parseHeader', () => {
  it('parses simple key=value pairs', () => {
    const raw = '# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX\nIF(1,2,3)';
    const result = parseHeader(raw, 'formula');
    assert.deepEqual(result, { appId: 'appXXX', tableId: 'tblXXX', fieldId: 'fldXXX' });
  });

  it('parses quoted values with spaces', () => {
    const raw = '# AT: appId=appXXX fieldName="My Text Formula"\nIF(1,2,3)';
    const result = parseHeader(raw, 'formula');
    assert.equal(result.fieldName, 'My Text Formula');
  });

  it('returns empty object when no header present', () => {
    const result = parseHeader('IF(1,2,3)', 'formula');
    assert.deepEqual(result, {});
  });

  it('parses // AT: for script language', () => {
    const raw = '// AT: appId=appXXX extensionId=extXXX\noutput.text("hi");';
    const result = parseHeader(raw, 'script');
    assert.deepEqual(result, { appId: 'appXXX', extensionId: 'extXXX' });
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
node --test packages/mcp-server/test/test-formula-header.test.js
```
Expected: `ERR_MODULE_NOT_FOUND` — `Cannot find module '../src/formula-header.js'`

- [ ] **Step 1.3: Implement `formula-header.js`**

```js
// packages/mcp-server/src/formula-header.js

/** @param {'formula'|'script'|'automation'} language */
function prefix(language) {
  return language === 'formula' ? '# AT:' : '// AT:';
}

/**
 * Strips leading AT: header lines from raw file content.
 * @returns {{ text: string, offset: number }}
 */
export function stripHeader(raw, language = 'formula') {
  const p = prefix(language);
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith(p)) i++;
  return { text: lines.slice(i).join('\n'), offset: i };
}

/**
 * Extracts key=value pairs from AT: header lines.
 * Values with spaces must be quoted: fieldName="My Field"
 * @returns {Record<string, string>}
 */
export function parseHeader(raw, language = 'formula') {
  const p = prefix(language);
  const result = {};
  for (const line of raw.split('\n')) {
    if (!line.startsWith(p)) break;
    const rest = line.slice(p.length).trim();
    for (const m of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
      result[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
  }
  return result;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
node --test packages/mcp-server/test/test-formula-header.test.js
```
Expected: all 10 tests pass — `▶ stripHeader` and `▶ parseHeader` both show `ok`.

- [ ] **Step 1.5: Commit**

```bash
git add packages/mcp-server/src/formula-header.js packages/mcp-server/test/test-formula-header.test.js
git commit -m "feat(mcp): formula-header utility — stripHeader + parseHeader"
```

---

## Task 2: MCP `formulaFilePath` param + defensive stripping

**Files:**
- Modify: `packages/mcp-server/src/index.js`

- [ ] **Step 2.1: Add `readFile` import at the top of `index.js`**

After the existing `import { readFileSync } from 'fs';` line (~line 95), add:

```js
import { readFile } from 'node:fs/promises';
import { stripHeader } from './formula-header.js';
```

- [ ] **Step 2.2: Add `formulaFilePath` to `update_formula_field` schema**

Find the `update_formula_field` tool definition (~line 570). In `inputSchema.properties`, add after the `formulaText` property:

```js
formulaFilePath: {
  type: 'string',
  description: 'Path to a local .formula or .fx file. When provided, reads formula from file instead of formulaText (unblocks large formulas that exceed LLM output limits). The # AT: metadata header is stripped automatically.',
},
```

Change `required` from `['appId', 'fieldId', 'formulaText']` to:
```js
required: ['appId', 'fieldId'],
```

- [ ] **Step 2.3: Add `formulaFilePath` to `create_formula_field` schema**

Same pattern for `create_formula_field` (~line 520). Add `formulaFilePath` to properties. Change `required` from `['appId', 'tableId', 'name', 'formulaText']` to:
```js
required: ['appId', 'tableId', 'name'],
```

- [ ] **Step 2.4: Update `update_formula_field` handler (~line 1596)**

Replace:
```js
async update_formula_field({ appId, fieldId, formulaText, debug }) {
  return handlers.update_field_config({
    appId, fieldId,
    fieldType: 'formula',
    typeOptions: { formulaText },
    debug,
  });
},
```

With:
```js
async update_formula_field({ appId, fieldId, formulaText, formulaFilePath, debug }) {
  if (!formulaText && !formulaFilePath) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide formulaText or formulaFilePath' }) }], isError: true };
  }
  let formula;
  if (formulaFilePath) {
    const raw = await readFile(formulaFilePath, 'utf8');
    formula = stripHeader(raw, 'formula').text;
  } else {
    formula = stripHeader(formulaText, 'formula').text;
  }
  return handlers.update_field_config({
    appId, fieldId,
    fieldType: 'formula',
    typeOptions: { formulaText: formula },
    debug,
  });
},
```

- [ ] **Step 2.5: Update `create_formula_field` handler (~line 1570)**

Replace:
```js
async create_formula_field({ appId, tableId, name, formulaText, debug }) {
  return handlers.create_field({
    appId, tableId, name,
    fieldType: 'formula',
    typeOptions: { formulaText },
    debug,
  });
},
```

With:
```js
async create_formula_field({ appId, tableId, name, formulaText, formulaFilePath, debug }) {
  if (!formulaText && !formulaFilePath) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide formulaText or formulaFilePath' }) }], isError: true };
  }
  let formula;
  if (formulaFilePath) {
    const raw = await readFile(formulaFilePath, 'utf8');
    formula = stripHeader(raw, 'formula').text;
  } else {
    formula = stripHeader(formulaText, 'formula').text;
  }
  return handlers.create_field({
    appId, tableId, name,
    fieldType: 'formula',
    typeOptions: { formulaText: formula },
    debug,
  });
},
```

- [ ] **Step 2.6: Add defensive stripping to `validate_formula` handler (~line 1579)**

Replace:
```js
async validate_formula({ appId, tableId, formulaText, debug }) {
  const result = await client.validateFormula(appId, tableId, formulaText);
  return ok(result, result, debug);
},
```

With:
```js
async validate_formula({ appId, tableId, formulaText, debug }) {
  const clean = stripHeader(formulaText, 'formula').text;
  const result = await client.validateFormula(appId, tableId, clean);
  return ok(result, result, debug);
},
```

- [ ] **Step 2.7: Add defensive stripping to `update_field_config` (~line 1584)**

Replace:
```js
async update_field_config({ appId, fieldId, fieldType, typeOptions, debug }) {
  const result = await client.updateFieldConfig(appId, fieldId, {
    type: fieldType,
    typeOptions,
  });
  return ok(
    { updated: true, fieldId, type: fieldType },
    result,
    debug,
  );
},
```

With:
```js
async update_field_config({ appId, fieldId, fieldType, typeOptions, debug }) {
  const opts = { ...typeOptions };
  if (fieldType === 'formula' && typeof opts.formulaText === 'string') {
    opts.formulaText = stripHeader(opts.formulaText, 'formula').text;
  }
  const result = await client.updateFieldConfig(appId, fieldId, {
    type: fieldType,
    typeOptions: opts,
  });
  return ok(
    { updated: true, fieldId, type: fieldType },
    result,
    debug,
  );
},
```

- [ ] **Step 2.8: Run the full MCP test suite**

```bash
pnpm -F airtable-user-mcp test
```
Expected: all tests pass. No regressions.

- [ ] **Step 2.9: Commit**

```bash
git add packages/mcp-server/src/index.js
git commit -m "feat(mcp): formulaFilePath param on update/create_formula_field + defensive header strip"
```

---

## Task 3: MCP `download_formula_field` tool + tool-sync

**Files:**
- Modify: `packages/mcp-server/src/index.js`
- Modify: `packages/mcp-server/src/tool-config.js`
- Modify: `packages/mcp-server/test/test-tool-config.test.js`
- Modify: `packages/extension/src/mcp/tool-profile.ts`
- Modify: `packages/extension/package.json`
- Modify: `packages/webview/src/tabs/Settings.tsx`
- Modify: `packages/webview/src/store.ts`
- Modify: `packages/webview/src/test/store.test.ts`

- [ ] **Step 3.1: Add `writeFile` + `mkdir` + `dirname` imports in `index.js`**

Update the fs import line added in Task 2:
```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stripHeader } from './formula-header.js';
```

- [ ] **Step 3.2: Add the tool definition in `index.js`**

In the tools array, after the `validate_formula` definition (~line 549), add:

```js
{
  name: 'download_formula_field',
  description: 'Download the formula text of a formula field to a local file. Writes a .formula file with a # AT: metadata header (appId, tableId, fieldId, fieldName) so the file can later be uploaded back with update_formula_field or the VS Code right-click command. When outputPath is omitted, returns the formula text without writing a file.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: 'The Airtable base/application ID' },
      fieldId: { type: 'string', description: 'The formula field ID (e.g. "fldXXX")' },
      outputPath: { type: 'string', description: 'Local file path to write the .formula file. When omitted, returns formula text in the response without writing a file.' },
      debug: debugProp,
    },
    required: ['appId', 'fieldId'],
  },
},
```

- [ ] **Step 3.3: Add the handler in `index.js`**

After the `validate_formula` handler (~line 1582), add:

```js
async download_formula_field({ appId, fieldId, outputPath, debug }) {
  const raw = await client.getApplicationData(appId);
  const tables = raw?.data?.tableSchemas || raw?.data?.tables || [];
  let foundField = null;
  let foundTableId = null;
  for (const table of tables) {
    const fields = table.columns || table.fields || [];
    const field = fields.find(f => f.id === fieldId);
    if (field) {
      foundField = field;
      foundTableId = table.id;
      break;
    }
  }
  if (!foundField) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Field ${fieldId} not found in base ${appId}` }) }], isError: true };
  }
  if (foundField.type !== 'formula') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Field ${fieldId} is type "${foundField.type}", not formula` }) }], isError: true };
  }
  const formulaText = foundField.typeOptions?.formulaText ?? '';
  const fieldName = foundField.name ?? fieldId;
  if (!outputPath) {
    return ok({ written: false, formulaText, fieldName, tableId: foundTableId }, raw, debug);
  }
  const header = `# AT: appId=${appId} tableId=${foundTableId} fieldId=${fieldId} fieldName="${fieldName}"\n`;
  const content = header + formulaText;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  return ok({ written: true, path: outputPath, fieldName, tableId: foundTableId, bytes: Buffer.byteLength(content) }, raw, debug);
},
```

- [ ] **Step 3.4: Add to `tool-config.js` read category**

In `packages/mcp-server/src/tool-config.js`, in the `// Read-only / inspection` block, add after `list_record_templates: 'read',`:

```js
download_formula_field: 'read',
```

- [ ] **Step 3.5: Update the tool-config test**

In `packages/mcp-server/test/test-tool-config.test.js`:

Change `assert.equal(tools.length, 61, ...)` to:
```js
assert.equal(tools.length, 62, `Expected 62 tools, got ${tools.length}`);
```

Update the `readTools` deep-equal assertion:
```js
assert.deepEqual(readTools.sort(), [
  'download_formula_field', 'get_base_schema', 'get_table_schema', 'get_view',
  'list_fields', 'list_record_templates', 'list_tables', 'list_view_sections',
  'list_views', 'validate_formula',
]);
```

- [ ] **Step 3.6: Update `tool-profile.ts` in extension**

In `packages/extension/src/mcp/tool-profile.ts`, in the `TOOL_CATEGORIES` export in the `// Read-only / inspection` block, add after `list_record_templates: 'read',`:

```ts
download_formula_field:    'read',
```

- [ ] **Step 3.7: Run tool-sync check and fix counts**

```bash
pnpm check:tool-sync
```

The script will print which counts in `packages/extension/package.json` need updating (the `enumDescriptions` read-only profile count and the total count in `mcpServerDefinitionProviders[].description`). Apply the reported diffs to `packages/extension/package.json`.

- [ ] **Step 3.8: Update webview store and test**

In `packages/webview/src/store.ts`, find where `totalCount` defaults and increment by 1 to match the new total reported by `pnpm check:tool-sync`.

In `packages/webview/src/test/store.test.ts`, update the matching assertion.

- [ ] **Step 3.9: Update Settings.tsx if it hard-codes tool counts**

In `packages/webview/src/tabs/Settings.tsx`, search for any hard-coded total tool count strings and update to match.

- [ ] **Step 3.10: Run full test suite**

```bash
pnpm test
```
Expected: all packages pass, `check:tool-sync` prints green ✓.

- [ ] **Step 3.11: Commit**

```bash
git add packages/mcp-server/src/index.js packages/mcp-server/src/tool-config.js packages/mcp-server/test/test-tool-config.test.js packages/extension/src/mcp/tool-profile.ts packages/extension/package.json packages/webview/src/store.ts packages/webview/src/test/store.test.ts packages/webview/src/tabs/Settings.tsx
git commit -m "feat(mcp): download_formula_field tool + tool-sync propagation"
```

---

## Task 4: Extension `formula-header.ts` utility

**Files:**
- Create: `packages/extension/src/language/formula/formula-header.ts`
- Create: `packages/extension/src/test/formula-header.test.ts`

- [ ] **Step 4.1: Write the failing tests**

```ts
// packages/extension/src/test/formula-header.test.ts
import { describe, it, expect } from 'vitest';
import { stripFormulaHeader, parseFormulaHeader } from '../language/formula/formula-header.js';

describe('stripFormulaHeader', () => {
  it('strips # AT: line and returns offset 1', () => {
    const { formula, offset } = stripFormulaHeader('# AT: appId=appXXX fieldId=fldXXX\nIF({A},1,0)');
    expect(formula).toBe('IF({A},1,0)');
    expect(offset).toBe(1);
  });

  it('strips multiple # AT: lines', () => {
    const { formula, offset } = stripFormulaHeader('# AT: appId=appXXX\n# AT: fieldId=fldXXX\nIF(1,2,3)');
    expect(formula).toBe('IF(1,2,3)');
    expect(offset).toBe(2);
  });

  it('returns offset 0 when no header', () => {
    const { formula, offset } = stripFormulaHeader('IF({A},1,0)');
    expect(formula).toBe('IF({A},1,0)');
    expect(offset).toBe(0);
  });

  it('strips // AT: for script language', () => {
    const { formula, offset } = stripFormulaHeader('// AT: appId=appXXX\noutput.text("hi");', 'script');
    expect(formula).toBe('output.text("hi");');
    expect(offset).toBe(1);
  });

  it('handles empty string', () => {
    const { formula, offset } = stripFormulaHeader('');
    expect(formula).toBe('');
    expect(offset).toBe(0);
  });
});

describe('parseFormulaHeader', () => {
  it('parses key=value pairs', () => {
    const result = parseFormulaHeader('# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX\nIF(1,2,3)');
    expect(result).toEqual({ appId: 'appXXX', tableId: 'tblXXX', fieldId: 'fldXXX' });
  });

  it('parses quoted fieldName with spaces', () => {
    const result = parseFormulaHeader('# AT: appId=appXXX fieldName="Text Formula"\nIF(1,2,3)');
    expect(result.fieldName).toBe('Text Formula');
  });

  it('returns empty object when no header', () => {
    expect(parseFormulaHeader('IF(1,2,3)')).toEqual({});
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
pnpm -F airtable-formula vitest run src/test/formula-header.test.ts
```
Expected: `Cannot find module '../language/formula/formula-header.js'`

- [ ] **Step 4.3: Implement `formula-header.ts`**

```ts
// packages/extension/src/language/formula/formula-header.ts

type Language = 'formula' | 'script' | 'automation';

function getPrefix(lang: Language): string {
  return lang === 'formula' ? '# AT:' : '// AT:';
}

export function stripFormulaHeader(
  text: string,
  lang: Language = 'formula',
): { formula: string; offset: number } {
  const p = getPrefix(lang);
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith(p)) i++;
  return { formula: lines.slice(i).join('\n'), offset: i };
}

export function parseFormulaHeader(
  text: string,
  lang: Language = 'formula',
): Record<string, string> {
  const p = getPrefix(lang);
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith(p)) break;
    const rest = line.slice(p.length).trim();
    for (const m of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
      result[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
  }
  return result;
}
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
pnpm -F airtable-formula vitest run src/test/formula-header.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add packages/extension/src/language/formula/formula-header.ts packages/extension/src/test/formula-header.test.ts
git commit -m "feat(extension): formula-header utility — stripFormulaHeader + parseFormulaHeader"
```

---

## Task 5: Language provider offset fixes

**Files:**
- Modify: `packages/extension/src/language/formula/formula-diagnostics.ts`
- Modify: `packages/extension/src/language/formula/formula-completions.ts`
- Modify: `packages/extension/src/language/formula/formula-hover.ts`
- Modify: `packages/extension/src/language/formula/formula-signature.ts`
- Modify: `packages/extension/src/language/script/script-diagnostics.ts`
- Modify: `packages/extension/src/language/automation/automation-diagnostics.ts`

- [ ] **Step 5.1: Replace `formula-diagnostics.ts`**

```ts
import * as vscode from 'vscode';
import { formulaDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert.js';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-formula');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-formula') return;
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const lsDiags = formulaDiagnostics(formula, document.uri.toString());
        const shifted = lsDiags.map(d => {
            const diag = toVscodeDiagnostic(d);
            const start = new vscode.Position(diag.range.start.line + offset, diag.range.start.character);
            const end   = new vscode.Position(diag.range.end.line   + offset, diag.range.end.character);
            return new vscode.Diagnostic(new vscode.Range(start, end), diag.message, diag.severity);
        });
        this.diagnosticCollection.set(document.uri, shifted);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

- [ ] **Step 5.2: Replace `formula-completions.ts`**

```ts
import * as vscode from 'vscode';
import { formulaCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert.js';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsItems = formulaCompletions(formula, toLsPosition(adjusted));
        return lsItems.map(toVscodeCompletionItem);
    }
}
```

- [ ] **Step 5.3: Replace `formula-hover.ts`**

```ts
import * as vscode from 'vscode';
import { formulaHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert.js';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsHover = formulaHover(formula, toLsPosition(adjusted));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
```

- [ ] **Step 5.4: Replace `formula-signature.ts`**

```ts
import * as vscode from 'vscode';
import { formulaSignatureHelp } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeSignatureHelp } from '../convert.js';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.SignatureHelp | null {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsHelp = formulaSignatureHelp(formula, toLsPosition(adjusted));
        return lsHelp ? toVscodeSignatureHelp(lsHelp) : null;
    }
}
```

- [ ] **Step 5.5: Replace `script-diagnostics.ts`**

```ts
import * as vscode from 'vscode';
import { scriptDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert.js';
import { stripFormulaHeader } from '../formula/formula-header.js';

export class AirtableScriptDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-script');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-script') return;
        const { formula, offset } = stripFormulaHeader(document.getText(), 'script');
        const lsDiags = scriptDiagnostics(formula, document.uri.toString());
        const shifted = lsDiags.map(d => {
            const diag = toVscodeDiagnostic(d);
            const start = new vscode.Position(diag.range.start.line + offset, diag.range.start.character);
            const end   = new vscode.Position(diag.range.end.line   + offset, diag.range.end.character);
            return new vscode.Diagnostic(new vscode.Range(start, end), diag.message, diag.severity);
        });
        this.diagnosticCollection.set(document.uri, shifted);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

- [ ] **Step 5.6: Replace `automation-diagnostics.ts`**

```ts
import * as vscode from 'vscode';
import { automationDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert.js';
import { stripFormulaHeader } from '../formula/formula-header.js';

export class AirtableAutomationDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-automation');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-automation') return;
        const { formula, offset } = stripFormulaHeader(document.getText(), 'automation');
        const lsDiags = automationDiagnostics(formula, document.uri.toString());
        const shifted = lsDiags.map(d => {
            const diag = toVscodeDiagnostic(d);
            const start = new vscode.Position(diag.range.start.line + offset, diag.range.start.character);
            const end   = new vscode.Position(diag.range.end.line   + offset, diag.range.end.character);
            return new vscode.Diagnostic(new vscode.Range(start, end), diag.message, diag.severity);
        });
        this.diagnosticCollection.set(document.uri, shifted);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

- [ ] **Step 5.7: Build the extension to check for type errors**

```bash
pnpm -F airtable-formula build
```
Expected: builds without errors.

- [ ] **Step 5.8: Commit**

```bash
git add packages/extension/src/language/
git commit -m "feat(extension): strip AT: header in language providers + shift diagnostic/hover/completion offsets"
```

---

## Task 6: `formulaFile.ts` — upload command

**Files:**
- Create: `packages/extension/src/commands/formulaFile.ts`

- [ ] **Step 6.1: Create the file with the upload handler and shared daemon caller**

```ts
// packages/extension/src/commands/formulaFile.ts
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseFormulaHeader, stripFormulaHeader } from '../language/formula/formula-header.js';
import type { DaemonManager } from '../mcp/daemon-manager.js';

async function callDaemonTool(
  daemonManager: DaemonManager,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const status = await daemonManager.getDaemonStatus();
  if (!status.running || !status.port || !status.bearerToken) {
    throw new Error('Daemon not running. Start it from the Airtable dashboard first.');
  }
  const res = await fetch(`http://127.0.0.1:${status.port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${status.bearerToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`Daemon HTTP error: ${res.status}`);
  const data = await res.json() as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const text = data.result?.content?.[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (data.result?.isError || parsed['error']) {
    throw new Error(String(parsed['error'] ?? text));
  }
  return parsed;
}

export async function uploadFormulaFile(
  uri: vscode.Uri,
  daemonManager: DaemonManager,
): Promise<void> {
  const raw = await fs.readFile(uri.fsPath, 'utf8');
  const meta = parseFormulaHeader(raw, 'formula');

  if (!meta['appId'] || !meta['fieldId']) {
    vscode.window.showErrorMessage(
      'No Airtable target found. Add a `# AT: appId=... fieldId=...` header at the top of the file, or use "Airtable: Download Formula Field" to create a properly-linked file.',
    );
    return;
  }

  const formulaText = stripFormulaHeader(raw, 'formula').formula;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Uploading formula to Airtable…', cancellable: false },
    async () => {
      await callDaemonTool(daemonManager, 'update_formula_field', {
        appId: meta['appId'],
        fieldId: meta['fieldId'],
        formulaText,
      });
    },
  );

  vscode.window.showInformationMessage(`Formula uploaded (fieldId: ${meta['fieldId']})`);
}
```

- [ ] **Step 6.2: Build to verify no type errors**

```bash
pnpm -F airtable-formula build
```
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add packages/extension/src/commands/formulaFile.ts
git commit -m "feat(extension): uploadFormulaFile command — reads # AT: header, strips, calls daemon MCP"
```

---

## Task 7: `formulaFile.ts` — download command

**Files:**
- Modify: `packages/extension/src/commands/formulaFile.ts`

- [ ] **Step 7.1: Append the download handler to `formulaFile.ts`**

```ts
export async function downloadFormulaField(
  daemonManager: DaemonManager,
): Promise<void> {
  const appId = await vscode.window.showInputBox({
    prompt: 'Airtable Base ID',
    placeHolder: 'appXXXXXXXXXXXXXX',
    validateInput: v => (v?.startsWith('app') ? null : 'Must start with "app"'),
  });
  if (!appId) return;

  const fieldId = await vscode.window.showInputBox({
    prompt: 'Formula Field ID',
    placeHolder: 'fldXXXXXXXXXXXXXX',
    validateInput: v => (v?.startsWith('fld') ? null : 'Must start with "fld"'),
  });
  if (!fieldId) return;

  let result!: { formulaText: string; fieldName: string; tableId: string };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Downloading formula from Airtable…', cancellable: false },
    async () => {
      result = await callDaemonTool(daemonManager, 'download_formula_field', { appId, fieldId }) as typeof result;
    },
  );

  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Save formula here',
  });
  if (!folders || folders.length === 0) return;

  const safeName = result.fieldName.replace(/[/\\:*?"<>|]/g, '_');
  const filePath = path.join(folders[0].fsPath, `${safeName}.formula`);
  const header = `# AT: appId=${appId} tableId=${result.tableId} fieldId=${fieldId} fieldName="${result.fieldName}"\n`;
  await fs.writeFile(filePath, header + result.formulaText, 'utf8');

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`Formula saved to ${path.basename(filePath)}`);
}
```

- [ ] **Step 7.2: Build to verify no type errors**

```bash
pnpm -F airtable-formula build
```
Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add packages/extension/src/commands/formulaFile.ts
git commit -m "feat(extension): downloadFormulaField command — daemon MCP call + folder picker + file write"
```

---

## Task 8: `formulaFileTemplate.ts` — auto-placeholder on file create

**Files:**
- Create: `packages/extension/src/commands/formulaFileTemplate.ts`

- [ ] **Step 8.1: Create the file**

```ts
// packages/extension/src/commands/formulaFileTemplate.ts
import * as vscode from 'vscode';

const TEMPLATES: Record<string, { prefix: string; fields: string[] }> = {
  'airtable-formula': {
    prefix: '# AT:',
    fields: ['appId', 'tableId', 'fieldId', 'fieldName'],
  },
  'airtable-script': {
    prefix: '// AT:',
    fields: ['appId', 'extensionId', 'scriptName'],
  },
  'airtable-automation': {
    prefix: '// AT:',
    fields: ['appId', 'automationId', 'actionId', 'automationName'],
  },
};

function buildSnippet(languageId: string): vscode.SnippetString | null {
  const tmpl = TEMPLATES[languageId];
  if (!tmpl) return null;
  const placeholders = tmpl.fields
    .map((field, i) => `${field}=\${${i + 1}:}`)
    .join(' ');
  return new vscode.SnippetString(`${tmpl.prefix} ${placeholders}\n\$0`);
}

export function registerFileTemplates(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(async (event) => {
      for (const uri of event.files) {
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 0) continue;
          const doc = await vscode.workspace.openTextDocument(uri);
          const snippet = buildSnippet(doc.languageId);
          if (!snippet) continue;
          const editor = await vscode.window.showTextDocument(doc);
          await editor.insertSnippet(snippet, new vscode.Position(0, 0));
        } catch {
          // ignore — file may have been deleted or stat failed
        }
      }
    }),
  );
}
```

- [ ] **Step 8.2: Build to verify no type errors**

```bash
pnpm -F airtable-formula build
```
Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add packages/extension/src/commands/formulaFileTemplate.ts
git commit -m "feat(extension): auto-insert AT: placeholder header on new Airtable file creation"
```

---

## Task 9: `extension.ts` + `package.json` registrations

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Modify: `packages/extension/package.json`

- [ ] **Step 9.1: Add imports to `extension.ts`**

Near the top of `extension.ts`, after the existing command imports, add:

```ts
import { uploadFormulaFile, downloadFormulaField } from './commands/formulaFile.js';
import { registerFileTemplates } from './commands/formulaFileTemplate.js';
```

- [ ] **Step 9.2: Register commands in `extension.ts`**

Inside the `activate` function, after the existing command registrations, add:

```ts
context.subscriptions.push(
  vscode.commands.registerCommand('airtable-formula.uploadFormulaFile', (uri: vscode.Uri) => {
    uploadFormulaFile(uri, daemonManager).catch((err: unknown) =>
      vscode.window.showErrorMessage(`Upload failed: ${String(err)}`),
    );
  }),
  vscode.commands.registerCommand('airtable-formula.downloadFormulaField', () => {
    downloadFormulaField(daemonManager).catch((err: unknown) =>
      vscode.window.showErrorMessage(`Download failed: ${String(err)}`),
    );
  }),
);
registerFileTemplates(context);
```

- [ ] **Step 9.3: Add commands to `package.json` contributes.commands array**

```json
{
  "command": "airtable-formula.uploadFormulaFile",
  "title": "Upload to Airtable",
  "category": "Airtable Formula"
},
{
  "command": "airtable-formula.downloadFormulaField",
  "title": "Airtable Formula: Download Formula Field",
  "category": "Airtable Formula"
}
```

- [ ] **Step 9.4: Add context menu entry to `package.json` contributes.menus**

In `contributes.menus`, add an `explorer/context` key (or append to it if it already exists):

```json
"explorer/context": [
  {
    "command": "airtable-formula.uploadFormulaFile",
    "when": "resourceExtname == .formula || resourceExtname == .fx || resourceExtname == .min.formula || resourceExtname == .ultra-min.formula",
    "group": "airtable@1"
  }
]
```

- [ ] **Step 9.5: Build and verify**

```bash
pnpm -F airtable-formula build
```
Expected: no errors.

- [ ] **Step 9.6: Commit**

```bash
git add packages/extension/src/extension.ts packages/extension/package.json
git commit -m "feat(extension): register upload/download commands + right-click context menu for .formula files"
```

---

## Task 10: Skills content update

**Files:**
- Modify: `packages/extension/src/skills/content.ts`

- [ ] **Step 10.1: Replace `AGENTS_CONTENT` in `content.ts`**

```ts
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
- \`update_formula_field\` — update a formula field (supports \`formulaFilePath\` for large formulas)
- \`create_formula_field\` — create a new formula field (supports \`formulaFilePath\` for large formulas)
- \`download_formula_field\` — download a formula field to a local .formula file

## Local File Metadata Header

All Airtable files must include an AT: header as the very first line so upload commands know where to push the content.

### Formula files (.formula, .fx, .min.formula, .ultra-min.formula)
\`\`\`
# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX fieldName="Field Name"
IF({Status} = "Active", "Yes", "No")
\`\`\`

### Script files (.script, .ats)
\`\`\`js
// AT: appId=appXXX extensionId=extXXX scriptName="Script Name"
output.text('Hello');
\`\`\`

### Automation files (.automation, .ata)
\`\`\`js
// AT: appId=appXXX automationId=autXXX actionId=actXXX automationName="Automation Name"
let inputData = input.config();
\`\`\`

## Rules
- ALWAYS include the AT: header when creating or saving any Airtable file locally
- Required to upload — formula: \`appId\` + \`fieldId\`; script: \`appId\` + \`extensionId\`; automation: \`appId\` + \`automationId\` + \`actionId\`
- NEVER pass AT: header lines inside a \`formulaText\` argument to MCP tools — use \`formulaFilePath\` instead for large formulas, or pass clean formula text only
- Use \`formulaFilePath\` instead of inline \`formulaText\` when a formula exceeds ~30K characters to avoid output token limits
`;
```

- [ ] **Step 10.2: Build to verify no type errors**

```bash
pnpm -F airtable-formula build
```
Expected: no errors.

- [ ] **Step 10.3: Run the full test suite**

```bash
pnpm test
```
Expected: all tests pass, `check:tool-sync` prints green ✓.

- [ ] **Step 10.4: Commit**

```bash
git add packages/extension/src/skills/content.ts
git commit -m "docs(skills): document AT: header format for all Airtable file types + formulaFilePath usage"
```

---

## Final Verification

- [ ] **Full build + sync check**

```bash
pnpm build
```
Expected: green ✓ on tool-sync, all packages build clean.

- [ ] **Manual smoke test — upload**
  1. Open a `.formula` file with `# AT: appId=... fieldId=...` header
  2. Right-click in VS Code explorer → "Upload to Airtable"
  3. Confirm success notification and formula updated in Airtable

- [ ] **Manual smoke test — download**
  1. Command palette: "Airtable Formula: Download Formula Field"
  2. Enter a real `appId` and `fieldId`
  3. Pick a folder
  4. Confirm file opens with `# AT:` header and formula text

- [ ] **Manual smoke test — auto-placeholder**
  1. Create a new empty `.formula` file
  2. Confirm `# AT: appId= tableId= fieldId= fieldName=""` is inserted with cursor on first value, Tab moves to next

- [ ] **Manual smoke test — large formula via MCP**
  1. Ask AI to call `update_formula_field` with `formulaFilePath` pointing to a large local file
  2. Confirm formula is uploaded without hitting output token limits
