# Phase 3: Script Engine - Research

**Researched:** 2026-05-13
**Domain:** VS Code language extension -- TextMate grammar, completions, hover, diagnostics for Airtable Scripting Extension globals
**Confidence:** MEDIUM (official Airtable scripting docs are JS-rendered SPAs that resist scraping; global API surface assembled from community announcements, third-party guides, and cross-verified community code examples)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Official Airtable scripting docs are the primary source for the global API surface.
- **D-02:** Global registry uses nested object structure `{ base: { description, methods: { getTables: {...} } }, ... }` in `language-services/engines/script/registry.ts`.
- **D-03:** `cursor` included only if confirmed in official docs; confidence level must be noted explicitly.
- **D-04:** Unknown-global diagnostic uses token-level scan with local symbol table.
- **D-05:** JS built-in allowlist is Claude's discretion.
- **D-06:** SCRIPT-05 severity: Warning.
- **D-07:** `fetch` receives call-signature completions and hover docs only (`fetch(url, init?)`). No Response chain completions.
- **D-08:** `remoteFetchAsync` receives full completions and hover docs.
- **D-09:** No diagnostic for `fetch` vs. `remoteFetchAsync` in Phase 3.
- **D-10:** Engine structure mirrors formula: `index.ts`, `registry.ts`, `diagnostics.ts`, `completions.ts`, `hover.ts`. No `signature.ts`.
- **D-11:** Thin VS Code wrappers in `packages/extension/src/language/script/`: `script-diagnostics.ts`, `script-completions.ts`, `script-hover.ts`.
- **D-12:** `registerLanguageProviders()` in `registration.ts` extended for all three script providers alongside formula providers.
- **D-13:** `airtable-script` language ID for `.script` and `.ats`. TextMate grammar embeds `source.js`. Language config: `//`, `/* */`, bracket pairs, folding.
- **D-14:** Placeholder SVG icons at `packages/extension/icons/script-light.svg` and `script-dark.svg`.

### Claude's Discretion

- Complete JS built-in allowlist for SCRIPT-05.
- Exact token scanner implementation (regex patterns, destructuring/catch edge cases, callback parameter detection).
- Exact diagnostic message wording for SCRIPT-04 and SCRIPT-05.
- Whether `ScriptGlobalInfo` and `ScriptMethodInfo` are separate exported types or inlined.

### Deferred Ideas (OUT OF SCOPE)

- Diagnostic for `fetch` vs. `remoteFetchAsync`.
- Signature help for script methods (SCRIPT-ADV-01, v2).
- `input.config()` field-type completions (SCRIPT-ADV-02, v2).
- Quick-fix: insert `await` (SCRIPT-ADV-03, v2).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCRIPT-01 | `airtable-script` language ID for `.script`/`.ats`; TextMate grammar embedding `source.js`; JS language config | TextMate grammar pattern confirmed; VS Code grammar embedding documented |
| SCRIPT-02 | Dot-triggered completions for all Scripting Extension globals and their methods | Global API surface assembled from cross-verified community sources |
| SCRIPT-03 | Hover documentation for all globals and methods | Follows formula hover pattern; registry drives hover content |
| SCRIPT-04 | Warning diagnostic on `*Async`-suffixed calls missing `await`; accepted non-flagging patterns | Token scanner approach from formula diagnostics; accepted patterns enumerated |
| SCRIPT-05 | Warning diagnostic on unknown bare identifier followed by `.` or `()`, with local symbol table exclusions | JS built-in allowlist compiled; local symbol collection patterns documented |
| SCRIPT-06 | Custom SVG file icons for `.script`/`.ats` | Placeholder SVG pattern established in Phase 2 |
</phase_requirements>

---

## Summary

Phase 3 follows the architecture established in Phases 1 and 2. The new engine is structurally identical to `engines/formula/` -- four files (`registry.ts`, `diagnostics.ts`, `completions.ts`, `hover.ts`) plus a barrel `index.ts` -- and three thin VS Code wrapper classes mirror the formula wrapper pattern exactly. All conversion utilities (`toVscodeDiagnostic`, `toVscodeCompletionItem`, `toVscodeHover`, `toLsPosition`) already exist in `convert.ts` and are reused without modification.

The primary research uncertainty is the Airtable Scripting Extension global API surface. Airtable's official developer documentation (`airtable.com/developers/scripting/api`) is a JavaScript-heavy SPA that does not render for web scraping. The global API surface documented here is assembled from: (a) Airtable community announcements where Airtable staff described new methods, (b) cross-verified community code examples, and (c) a third-party guide confirmed by multiple community sources. Individual method signatures are MEDIUM confidence. The cursor `selectedRecordIds` and `selectedFieldIds` properties are confirmed MEDIUM confidence via community code examples showing their use.

The TextMate grammar is straightforward: a single `{ "include": "source.js" }` entry in the `patterns` array delegates all tokenization to VS Code's built-in JavaScript grammar. VS Code ships with JavaScript support; `source.js` is always available without requiring the JavaScript extension to be installed separately.

**Primary recommendation:** Build the SCRIPT_GLOBALS registry first (the data source for all three providers), then implement completions and hover (trivially derived from the registry), then diagnostics (SCRIPT-04 and SCRIPT-05 are the novel logic). All VS Code wiring is copy-adapt from Phase 2 with language ID substitutions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TextMate grammar + language config | Extension host (package.json contributes) | -- | Grammar and language config are contributed via package.json; no runtime code |
| Global registry data | language-services engine | -- | Registry is a pure data module; no VS Code dependency |
| Dot-triggered completions | language-services engine | Extension host (wrapper) | Engine provides items; wrapper converts and registers with VS Code |
| Hover documentation | language-services engine | Extension host (wrapper) | Engine resolves hover; wrapper adapts to vscode.Hover |
| Missing-await diagnostic | language-services engine | Extension host (wrapper) | Text scan is pure; wrapper converts to vscode.Diagnostic |
| Unknown-global diagnostic | language-services engine | Extension host (wrapper) | Token scan with local symbol table; pure text operation |
| SVG file icons | Extension host (package.json + icons/) | -- | Static assets; wired via contributes.languages[].icon |
| Provider registration | Extension host (registration.ts) | -- | VS Code API call; must run in extension host context |

---

## Standard Stack

### Core (all already installed -- no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vscode` | built-in | Extension host API | Required for all VS Code providers |
| `@airtable-formula/language-services` | workspace:* | Pure engine functions | Same pattern as formula engine |
| `vitest` | ^1.6.0 | Test runner for language-services | Already configured in `packages/language-services/vitest.config.ts` |
| `typescript` | ^5.4.0 | Compilation | Workspace standard |

Phase 3 introduces zero new npm packages. All tools and libraries are already in the workspace. [VERIFIED: packages/language-services/package.json, packages/extension/package.json]

**Installation:** None required.

---

## Architecture Patterns

### System Architecture Diagram

```
.script / .ats file (VS Code document)
         |
         v
  [Extension Host: registration.ts]
  registerLanguageProviders() extended
         |
    +---------+----------+----------+
    |                    |          |
    v                    v          v
AirtableScriptDiagnosticsProvider  AirtableScriptCompletionProvider  AirtableScriptHoverProvider
    |                    |          |
    | getText             | getText  | getText + toLsPosition
    v                    v          v
scriptDiagnostics()  scriptCompletions()  scriptHover()
    |                    |          |
    v                    v          v
  [engines/script/diagnostics.ts]   [engines/script/registry.ts]
  checkMissingAwait()               SCRIPT_GLOBALS registry
  checkUnknownGlobals()                  |
    |                                    |
    | build local symbol table           v
    v                              completions.ts / hover.ts
  const/let/var/function/          derive items from SCRIPT_GLOBALS
  class/for-of/catch declarations

  All results -> convert.ts -> vscode types -> VS Code
```

### Recommended Project Structure (new files only)

```
packages/
  language-services/src/engines/
    script/
      index.ts          -- barrel re-export
      registry.ts       -- SCRIPT_GLOBALS, ScriptGlobalInfo, ScriptMethodInfo types + helpers
      diagnostics.ts    -- scriptDiagnostics(text, uri?)
      completions.ts    -- scriptCompletions(text, pos)
      hover.ts          -- scriptHover(text, pos)
  language-services/src/test/
    script/
      registry.test.ts
      diagnostics.test.ts
      completions.test.ts
      hover.test.ts

packages/extension/src/language/
  script/
    script-diagnostics.ts   -- AirtableScriptDiagnosticsProvider
    script-completions.ts   -- AirtableScriptCompletionProvider
    script-hover.ts         -- AirtableScriptHoverProvider

packages/extension/
  syntaxes/
    airtable-script.tmLanguage.json
  language-configuration/
    airtable-script-language-configuration.json
  icons/
    script-light.svg
    script-dark.svg
```

### Pattern 1: Global Registry Shape

The registry uses a nested structure (D-02 locked decision). Types may be separate exports or inlined (Claude's discretion):

```typescript
// Source: CONTEXT.md D-02 (locked decision)
export interface ScriptMethodInfo {
  signature: string;
  description: string;
}

export interface ScriptGlobalInfo {
  description: string;
  methods: Record<string, ScriptMethodInfo>;
}

export const SCRIPT_GLOBALS: Record<string, ScriptGlobalInfo> = {
  base: {
    description: 'Represents the current Airtable base.',
    methods: {
      getTables: {
        signature: 'base.getTables(): Table[]',
        description: 'Returns an array of all tables in the base.',
      },
      getTable: {
        signature: 'base.getTable(nameOrId: string): Table',
        description: 'Returns the table with the given name or ID. Throws if not found.',
      },
      // ... full method list from API surface section below
    },
  },
  // ... other globals
};

export const SCRIPT_GLOBAL_NAMES = Object.keys(SCRIPT_GLOBALS);
```

### Pattern 2: Two-Level Completions (top-level + dot-triggered)

The completion engine resolves which level to return based on text preceding the cursor:

```typescript
// Source: CONTEXT.md "Specific Ideas" (locked design intent)
export function scriptCompletions(text: string, pos: LsPosition): LsCompletionItem[] {
  const offset = positionToOffset(text, pos);
  const textToCursor = text.slice(0, offset);

  // Detect "globalName." to provide method-level completions
  const dotMatch = textToCursor.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.\s*$/);
  if (dotMatch) {
    const globalName = dotMatch[1];
    const globalInfo = SCRIPT_GLOBALS[globalName];
    if (globalInfo) {
      return Object.entries(globalInfo.methods).map(([name, method]) => ({
        label: name,
        kind: LsCompletionItemKind.Method,
        detail: globalName,
        documentation: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
        insertText: `${name}($0)`,
      }));
    }
    return []; // unknown object -- no completions from this engine
  }

  // Top-level: return all global names
  return SCRIPT_GLOBAL_NAMES.map(name => ({
    label: name,
    kind: LsCompletionItemKind.Variable,
    documentation: { kind: 'markdown', value: SCRIPT_GLOBALS[name].description },
    insertText: name,
  }));
}
```

### Pattern 3: Hover Resolution (global + method)

Resolution order mirrors the formula hover pattern:
1. Check if cursor is after `globalName.` -- extract the word after the dot
2. If `globalName` is in SCRIPT_GLOBALS and method name is in `methods` -- return method hover
3. Else if cursor word is a top-level global name -- return global description hover
4. Else return null

[VERIFIED: modeled on `packages/language-services/src/engines/formula/hover.ts`]

### Pattern 4: Missing-Await Diagnostic (SCRIPT-04) -- Logic Flow

Scan text for `*Async(` calls. For each match, apply accepted-pattern checks:

```
Accepted patterns (must NOT be flagged):
  await expr.selectRecordsAsync(...)       -- has await before call
  return expr.selectRecordsAsync(...)      -- return expression
  const p = expr.selectRecordsAsync(...)   -- assignment to variable
  expr.selectRecordsAsync(...).then(...)   -- .then() chain after closing paren
  Promise.all([expr.selectRecordsAsync()]) -- inside Promise combinator
```

Implementation approach:
1. Regex scan for `/\b\w+Async\s*\(/g` (skip inside strings/comments via exclusion ranges)
2. For each match, extract statement context from last statement boundary to match position
3. Check statement context against accepted patterns
4. Emit Warning only if no accepted pattern matches

**Critical:** The `await` check must scan from the start of the entire statement, not just the token immediately before `selectRecordsAsync`, to handle chained calls like `await base.getTable('X').selectRecordsAsync({})`.

### Pattern 5: Unknown-Global Diagnostic (SCRIPT-05) -- Two-Phase Approach

**Phase A: Build local symbol set** -- walk the text collecting locally-declared identifiers:
- `const x`, `let x`, `var x` declarations
- `function foo(` named function declarations
- `class Foo` named class declarations
- `for (const item of ...)` loop variables
- `catch (e)` clause bindings
- Arrow function params: best-effort patterns for `param =>` and `(param1, param2) =>`

**Phase B: Scan for unknown usages** -- find bare identifiers followed by `.` or `(` that are NOT preceded by `.` (not method access), NOT in SCRIPT_GLOBALS, NOT in JS_BUILTIN_ALLOWLIST, NOT in local symbol set, NOT a JS keyword -- emit Warning.

### Pattern 6: TextMate Grammar -- Minimal source.js Delegation

```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "scopeName": "source.airtable-script",
  "name": "Airtable Script",
  "fileTypes": ["script", "ats"],
  "patterns": [
    { "include": "source.js" }
  ]
}
```

[CITED: code.visualstudio.com/api/language-extensions/syntax-highlight-guide]

Key facts:
- VS Code ships the JavaScript grammar as a built-in extension. `source.js` is ALWAYS available -- no dependency on user-installed extensions.
- The formula grammar's elaborate `repository` section must NOT be copied here.
- No `repository` section needed in the script grammar.

### Pattern 7: package.json Grammar Contribution

```json
{
  "languages": [
    {
      "id": "airtable-script",
      "aliases": ["Airtable Script", "script"],
      "extensions": [".script", ".ats"],
      "configuration": "./language-configuration/airtable-script-language-configuration.json",
      "icon": {
        "light": "./icons/script-light.svg",
        "dark": "./icons/script-dark.svg"
      }
    }
  ],
  "grammars": [
    {
      "language": "airtable-script",
      "scopeName": "source.airtable-script",
      "path": "./syntaxes/airtable-script.tmLanguage.json",
      "embeddedLanguages": {
        "source.airtable-script": "javascript"
      }
    }
  ]
}
```

The `embeddedLanguages` map tells VS Code to treat the entire file scope as JavaScript for bracket matching and comment toggling. [CITED: code.visualstudio.com/api/language-extensions/syntax-highlight-guide]

### Pattern 8: Script Language Configuration (JS-appropriate)

Modeled on `airtable-formula-language-configuration.json` [VERIFIED] with JS additions (backtick):

```json
{
  "comments": {
    "lineComment": "//",
    "blockComment": ["/*", "*/"]
  },
  "wordPattern": "[a-zA-Z_$][a-zA-Z0-9_$]*",
  "indentationRules": {
    "increaseIndentPattern": "^\\s*[^\\s].*[{(\\[]\\s*$",
    "decreaseIndentPattern": "^\\s*[}\\])]"
  },
  "brackets": [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"]
  ],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "[", "close": "]" },
    { "open": "(", "close": ")" },
    { "open": "\"", "close": "\"", "notIn": ["string", "comment"] },
    { "open": "'", "close": "'", "notIn": ["string", "comment"] },
    { "open": "`", "close": "`", "notIn": ["string", "comment"] }
  ],
  "surroundingPairs": [
    ["{", "}"], ["[", "]"], ["(", ")"],
    ["\"", "\""], ["'", "'"], ["`", "`"]
  ]
}
```

JS adds the backtick auto-closing pair (template literals) that the formula config lacks.

### Pattern 9: Wrapper Class Shape

```typescript
// script-diagnostics.ts -- modeled verbatim on formula-diagnostics.ts [VERIFIED]
import * as vscode from 'vscode';
import { scriptDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableScriptDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-script');
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== 'airtable-script') return;
    const lsDiags = scriptDiagnostics(document.getText(), document.uri.toString());
    this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
  }

  public dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
```

### Pattern 10: Registration Extension

```typescript
// In registration.ts -- extend registerLanguageProviders() after formula registrations
const scriptDiagnosticsProvider = new AirtableScriptDiagnosticsProvider();
context.subscriptions.push(scriptDiagnosticsProvider);

context.subscriptions.push(
  vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.languageId === 'airtable-script') {
      scriptDiagnosticsProvider.updateDiagnostics(event.document);
    }
  }),
  vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId === 'airtable-script') {
      scriptDiagnosticsProvider.updateDiagnostics(document);
    }
  }),
  vscode.languages.registerHoverProvider('airtable-script', new AirtableScriptHoverProvider()),
  vscode.languages.registerCompletionItemProvider(
    'airtable-script',
    new AirtableScriptCompletionProvider(),
    '.'  // dot trigger for method completions
  ),
);

vscode.workspace.textDocuments.forEach((document) => {
  if (document.languageId === 'airtable-script') {
    scriptDiagnosticsProvider.updateDiagnostics(document);
  }
});
```

[VERIFIED: modeled on existing `registration.ts` pattern]

### Anti-Patterns to Avoid

- **Reimplementing JS syntax in a custom grammar:** Use `{ "include": "source.js" }`. Do not copy-paste the formula grammar `repository`.
- **Module-level DiagnosticCollection singleton:** Phase 2 D-03 (locked): DiagnosticCollection is an instance field on the class.
- **Flagging JS keywords as unknown globals:** `if`, `for`, `while`, `class`, `return`, `typeof`, `instanceof`, etc. appear before `(` -- they must be in the keyword exclusion set.
- **Naive await check in SCRIPT-04:** Must scan from the start of the statement, not just the immediately preceding token, to handle chained calls like `await base.getTable('X').selectRecordsAsync({})`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type conversion (LsPosition <-> vscode.Position) | Custom conversion | `convert.ts` (existing) | Already implemented in Phase 2; script engine reuses verbatim |
| Diagnostic rendering | Custom adapter | `toVscodeDiagnostic` (existing) | Handles severity, relatedInformation, code |
| Completion rendering | Custom adapter | `toVscodeCompletionItem` (existing) | Handles kind, insertText as SnippetString |
| Hover rendering | Custom adapter | `toVscodeHover` (existing) | Handles markdown vs plaintext |
| Offset/position math | Custom functions | Copy `positionToOffset`/`offsetToPosition` from formula engine | Already battle-tested |
| JS syntax highlighting | Custom TextMate rules | `{ "include": "source.js" }` grammar delegation | VS Code ships JS grammar; reinventing it causes drift |

**Key insight:** All VS Code adapter plumbing from Phase 2 is reused unchanged. The only net-new code is the `engines/script/` module (5 files) and three thin wrapper classes.

---

## Airtable Scripting Extension Global API Surface

> **Confidence note:** The official `airtable.com/developers/scripting/api` is a JS-rendered SPA that did not render for scraping. API surface assembled from: Airtable staff community announcements, community code examples (cross-verified), and third-party guides. Overall confidence: MEDIUM.

### `base` -- The current base

**Description:** The `base` object represents the current Airtable base. Injected as a global in every script.

| Method / Property | Signature | Description | Confidence |
|-------------------|-----------|-------------|------------|
| `id` | `base.id: string` | The base's unique ID | MEDIUM |
| `name` | `base.name: string` | The base's display name | MEDIUM |
| `tables` | `base.tables: Table[]` | All tables in the base (property) | MEDIUM |
| `getTables` | `base.getTables(): Table[]` | Returns array of all tables | MEDIUM |
| `getTable` | `base.getTable(nameOrId: string): Table` | Returns table by name or ID; throws if not found | MEDIUM |
| `getCollaborators` | `base.getCollaborators(): Collaborator[]` | Returns all collaborators | LOW [ASSUMED] |
| `activeCollaborators` | `base.activeCollaborators: Collaborator[]` | Active collaborators (property) | LOW [ASSUMED] |
| `createTableAsync` | `base.createTableAsync(name: string, fields: FieldConfig[]): Promise<Table>` | Creates a new table | MEDIUM |

### `table` -- A table object

**Description:** Represents a single Airtable table. Obtained via `base.getTable()` or iterating `base.getTables()`.

| Method / Property | Signature | Description | Confidence |
|-------------------|-----------|-------------|------------|
| `id` | `table.id: string` | Unique table ID | MEDIUM |
| `name` | `table.name: string` | Table display name | MEDIUM |
| `fields` | `table.fields: Field[]` | All fields in the table | MEDIUM |
| `views` | `table.views: View[]` | All views in the table | MEDIUM |
| `getField` | `table.getField(nameOrId: string): Field` | Returns field by name or ID | MEDIUM |
| `getView` | `table.getView(nameOrId: string): View` | Returns view by name or ID | MEDIUM |
| `selectRecordsAsync` | `table.selectRecordsAsync(options?: object): Promise<RecordQueryResult>` | Queries all records; options include `fields` and `sorts` | HIGH |
| `selectRecordAsync` | `table.selectRecordAsync(recordId: string, options?: object): Promise<Record or null>` | Fetches a single record by ID | MEDIUM |
| `createRecordAsync` | `table.createRecordAsync(fields: object): Promise<string>` | Creates one record; returns new record ID | MEDIUM |
| `createRecordsAsync` | `table.createRecordsAsync(records: object[]): Promise<string[]>` | Creates up to 50 records; returns new record IDs | HIGH |
| `updateRecordAsync` | `table.updateRecordAsync(record: Record or string, fields: object): Promise<void>` | Updates one record | MEDIUM |
| `updateRecordsAsync` | `table.updateRecordsAsync(records: object[]): Promise<void>` | Updates up to 50 records | MEDIUM |
| `deleteRecordAsync` | `table.deleteRecordAsync(record: Record or string): Promise<void>` | Deletes one record | MEDIUM |
| `deleteRecordsAsync` | `table.deleteRecordsAsync(records: Array): Promise<void>` | Deletes up to 50 records | MEDIUM |
| `createFieldAsync` | `table.createFieldAsync(name: string, type: string, options?: object): Promise<Field>` | Creates a new field | MEDIUM |

### `cursor` -- UI cursor state (Scripting Extension only)

**Description:** Exposes the current user's UI cursor state. NOT available in automation scripts (automations have no UI context).

**Confidence determination per D-03:** `activeTableId` and `activeViewId` confirmed by official Airtable staff announcement. `selectedRecordIds` confirmed by multiple community code examples showing `cursor.selectedRecordIds[0]` in working scripts. `selectedFieldIds` mentioned in February 2020 Airtable staff announcement. All four properties reach MEDIUM confidence -- ALL FOUR INCLUDED per D-03.

| Property | Type | Description | Confidence |
|----------|------|-------------|------------|
| `activeTableId` | `string or null` | ID of the currently active table; null if none | MEDIUM |
| `activeViewId` | `string or null` | ID of the currently active view; null if none | MEDIUM |
| `selectedRecordIds` | `string[]` | IDs of currently selected records; empty array if none | MEDIUM |
| `selectedFieldIds` | `string[]` | IDs of currently selected fields; empty array if none | MEDIUM |

### `input` -- Interactive user input (Scripting Extension only)

**Description:** Methods to prompt the script user for input. All `input.*Async()` methods are scripting-extension-only. NOT available in automation scripts. [CITED: coda.io Kuovonne guide, cross-verified with Airtable community announcements]

| Method | Signature | Description | Confidence |
|--------|-----------|-------------|------------|
| `textAsync` | `input.textAsync(label: string, options?: object): Promise<string>` | Prompts user to enter text | HIGH |
| `buttonsAsync` | `input.buttonsAsync(label: string, options: object[]): Promise<unknown>` | Displays buttons; returns selected button's value | HIGH |
| `tableAsync` | `input.tableAsync(label: string, options?: object): Promise<Table>` | Prompts user to select a table | MEDIUM |
| `viewAsync` | `input.viewAsync(label: string, tableOrId: Table or string, options?: object): Promise<View>` | Prompts user to select a view | MEDIUM |
| `fieldAsync` | `input.fieldAsync(label: string, tableOrId: Table or string, options?: object): Promise<Field>` | Prompts user to select a field | MEDIUM |
| `recordAsync` | `input.recordAsync(label: string, tableOrId: Table or string): Promise<Record or null>` | Prompts user to select a record | MEDIUM |
| `fileAsync` | `input.fileAsync(label: string, options?: object): Promise<File>` | Prompts user to upload a file; auto-parses CSV/JSON/XLSX | MEDIUM |
| `config` | `input.config(): object` | Returns the script settings object (used with Configure button) | MEDIUM |

**Important:** `input.text()` (sync) and `input.buttons()` (sync) were deprecated in February 2020. Do NOT include sync versions in the registry.

**Note on automations:** In automations, `input.config()` is the ONLY available method -- it reads pre-configured settings. All `input.*Async()` methods are scripting-extension-only.

### `output` -- Script output display (Scripting Extension only)

**Description:** Methods for displaying content to the script user. NOT available in automation scripts (use `console.log()` there instead).

| Method | Signature | Description | Confidence |
|--------|-----------|-------------|------------|
| `text` | `output.text(text: string): void` | Displays plain text in the output panel | HIGH |
| `markdown` | `output.markdown(markdown: string): void` | Displays markdown-formatted content | HIGH |
| `table` | `output.table(data: object[] or RecordQueryResult): void` | Displays data as an interactive table | MEDIUM |
| `clear` | `output.clear(): void` | Clears the output panel | MEDIUM |

Note: `output.set` is NOT included. It appears only in automation context documentation; its availability on the scripting `output` object is uncertain. Omitted from Phase 3 registry.

### `session` -- Current user session (Scripting Extension only)

**Description:** Provides information about the currently logged-in user. NOT available in automation scripts. [CITED: multiple community posts confirming `session.currentUser.name/email/id`]

| Property | Type | Description | Confidence |
|----------|------|-------------|------------|
| `currentUser` | `object` | The current user object | MEDIUM |
| `currentUser.id` | `string` | The user's Airtable user ID | MEDIUM |
| `currentUser.email` | `string` | The user's email address | MEDIUM |
| `currentUser.name` | `string` | The user's display name | MEDIUM |

### `fetch` -- Standard browser Fetch API

**Description:** Standard browser `fetch` function. Available in the scripting extension. Subject to CORS restrictions. Per D-07: completions and hover only for the call signature; no Response chain completions.

| Call | Description | Confidence |
|------|-------------|------------|
| `fetch(url: string, init?: RequestInit): Promise<Response>` | Makes an HTTP request. Subject to CORS restrictions in the browser runtime. | HIGH |

### `remoteFetchAsync` -- Cross-origin HTTP request (Scripting Extension only)

**Description:** Airtable-provided function that makes HTTP requests from Airtable's servers, bypassing CORS restrictions. Redirect mode `follow` is NOT supported; only `error` and `manual` are supported. NOT available in automation scripts. [CITED: community.airtable.com -- "New: Remote fetch in Scripting App"]

| Call | Description | Confidence |
|------|-------------|------------|
| `remoteFetchAsync(url: string, init?: RequestInit): Promise<Response>` | Makes a cross-origin HTTP request via Airtable's servers. Bypasses CORS. Redirect follow mode not supported. | HIGH |

---

## JS Built-in Allowlist (Claude's Discretion -- D-05)

Identifiers that must NOT be flagged by the unknown-global diagnostic (SCRIPT-05). [ASSUMED for extended set -- assembled from MDN standard built-ins list. Airtable runtime availability not verified against official docs.]

### Mandatory minimum (from REQUIREMENTS.md)

`console`, `Math`, `JSON`, `Date`, `Promise`, `Array`, `Object`, `Error`, `parseInt`, `parseFloat`, `setTimeout`, `clearTimeout`

### Extended set (Claude's discretion)

**Value properties:** `undefined`, `NaN`, `Infinity`, `globalThis`

**Global functions:** `eval`, `isNaN`, `isFinite`, `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent`

**Constructors and built-in objects:** `Function`, `Boolean`, `Symbol`, `Number`, `BigInt`, `String`, `RegExp`, `Map`, `Set`, `WeakMap`, `WeakSet`, `ArrayBuffer`, `DataView`, `Uint8Array`, `Int8Array`, `Uint16Array`, `Int16Array`, `Uint32Array`, `Int32Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array`, `Reflect`, `Proxy`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `EvalError`, `URIError`, `AggregateError`, `WeakRef`, `FinalizationRegistry`

**Runtime timing functions:** `setInterval`, `clearInterval`, `queueMicrotask`

### JS Keywords (separate exclusion set -- NOT part of the allowlist)

These must be excluded to avoid flagging `if (`, `for (`, `new Array`, etc.:

`if`, `for`, `while`, `do`, `switch`, `try`, `catch`, `finally`, `return`, `throw`, `break`, `continue`, `new`, `delete`, `typeof`, `instanceof`, `void`, `in`, `of`, `class`, `extends`, `super`, `this`, `import`, `export`, `default`, `case`, `yield`, `async`, `await`, `debugger`, `with`, `static`, `let`, `const`, `var`, `function`, `true`, `false`, `null`

---

## Common Pitfalls

### Pitfall 1: False Positives on Callback Parameters

**What goes wrong:** `records.map(r => r.getCellValue('Name'))` -- `r` is a callback parameter. The token-level scanner collects `const/let/var/function/class/for-of` declarations but not all arrow-function params.

**Why it happens:** Full parameter collection for all arrow patterns (including destructured) requires AST-level parsing.

**How to avoid:** Add best-effort arrow param detection with patterns for `param =>` and `(param1, param2) =>`. Accept that destructured arrow params like `({id, name}) =>` remain false positives -- document this limitation.

**Warning signs:** Users see yellow underlines on `r`, `e`, `item`, `record` inside map/filter/forEach callbacks.

### Pitfall 2: Grammar Delegation vs. IntelliSense Registration

**What goes wrong:** The `embeddedLanguages` grammar entry does NOT make VS Code apply built-in JS IntelliSense to `airtable-script` files. The built-in JS language server only fires for `javascript` and `typescript` language IDs.

**Why it happens:** Grammar delegation handles tokenization; IntelliSense providers are registered separately per language ID.

**How to avoid:** Register the completion provider with `triggerCharacters: ['.']` explicitly in `registerLanguageProviders()`. This is correct -- we do NOT want VS Code to apply JS IntelliSense to `.script` files since that would provide completions for browser APIs not available in the Airtable runtime.

**Warning signs:** Typing `base.` shows no completions.

### Pitfall 3: Chained Method Calls in SCRIPT-04

**What goes wrong:** `await base.getTable('X').selectRecordsAsync({fields: []})` -- the `await` is on the outer expression. A check that only looks at the token immediately before `selectRecordsAsync` falsely flags this.

**Why it happens:** Chained calls place the async method at the end of a longer expression.

**How to avoid:** The `await` check must scan from the start of the current statement to the async call position, not just the token immediately before it.

**Warning signs:** Valid awaited chained calls produce spurious missing-await diagnostics.

### Pitfall 4: Copying Formula Grammar as Script Grammar Starting Point

**What goes wrong:** Starting from the formula grammar creates a mixed grammar that partially tokenizes with Airtable-formula rules and partially with JS rules.

**Why it happens:** The formula grammar is the only existing grammar file in the codebase; it is tempting to start from it.

**How to avoid:** Create `airtable-script.tmLanguage.json` from scratch. The only content needed is `"patterns": [{ "include": "source.js" }]` -- no `repository` section.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `input.text()` / `input.buttons()` (sync, pre-2020) | `input.textAsync()` / `input.buttonsAsync()` (async) | SCRIPT-04 diagnostic is correct for current API; sync versions must NOT be in registry |
| `output.text()` for markdown | `output.markdown()` for markdown; `output.text()` for plain text | Registry docs must use correct method for each content type |
| Scripts use proxy services for cross-origin requests | `remoteFetchAsync` bypasses CORS via Airtable servers (added ~2021) | `remoteFetchAsync` completions and hover docs are important |

**Deprecated (do NOT include in registry):**
- `input.text()` (sync): replaced by `input.textAsync()` in February 2020
- `input.buttons()` (sync): replaced by `input.buttonsAsync()` in February 2020

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `base.getCollaborators()` and `base.activeCollaborators` exist as documented | `base` methods table | False completions for non-existent methods; low UX impact |
| A2 | `output.set` is NOT available on scripting `output` (excluded from registry) | `output` methods table | If wrong: missing completion for a valid method -- can be added in Phase 4 |
| A3 | `cursor.selectedRecordIds` and `cursor.selectedFieldIds` are `string[]` | Cursor API section | If they are objects: hover signature is wrong |
| A4 | Extended JS built-in allowlist covers all globals appearing in real Airtable scripts | JS built-in allowlist | If incomplete: false-positive SCRIPT-05 warnings on valid globals |
| A5 | `input.tableAsync`, `input.viewAsync`, `input.fieldAsync`, `input.recordAsync` exist with these exact names | `input` methods table | If names differ: wrong completion labels |
| A6 | `table.createRecordAsync` (singular) exists alongside `createRecordsAsync` (plural) | `table` methods table | If singular does not exist: false completion |
| A7 | `embeddedLanguages: { "source.airtable-script": "javascript" }` provides bracket matching | Grammar contribution | If wrong: bracket matching may not work; testable in VS Code during execution |

**If any A1-A7 assumption is wrong,** the correction is local to the registry data -- a string change in `registry.ts`. No architectural impact.

---

## Open Questions

1. **`output.set` availability in scripting context**
   - What we know: `output.set` appears in automation documentation
   - What's unclear: Whether scripting extension `output` also has `set`
   - Recommendation: Omit from Phase 3 registry. Include only `text`, `markdown`, `table`, `clear`.

2. **Arrow function parameter false positives in SCRIPT-05**
   - What we know: Token-level scanner cannot detect all arrow function parameter patterns without an AST
   - Recommendation: Implement best-effort single-param and multi-param arrow detection. Accept residual false positives on destructured params. Document limitation.

3. **`base.getCollaborators` vs `base.activeCollaborators` exact API**
   - What we know: Both referenced in community examples; exact method name unconfirmed
   - Recommendation: Include both at LOW confidence. User can confirm from Airtable scripting editor autocomplete.

---

## Environment Availability

Step 2.6: SKIPPED -- Phase 3 is entirely code/config changes within the existing pnpm workspace. No external dependencies beyond what Phases 1-2 already established.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^1.6.0 |
| Config file | `packages/language-services/vitest.config.ts` (existing, `include: ['src/test/**/*.test.ts']`) |
| Quick run command | `pnpm -F language-services vitest run` |
| Full suite command | `pnpm -F language-services vitest run` |

[VERIFIED: packages/language-services/vitest.config.ts]

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCRIPT-01 | Grammar file has correct structure | manual (JSON inspection) | n/a | Wave 0 creates file |
| SCRIPT-02 | `scriptCompletions` returns `base` in top-level list | unit | `pnpm -F language-services vitest run -t "scriptCompletions"` | Wave 0 |
| SCRIPT-02 | `scriptCompletions` on `base.` returns `getTables` method | unit | same | Wave 0 |
| SCRIPT-02 | `scriptCompletions` returns all 8 globals | unit | same | Wave 0 |
| SCRIPT-03 | `scriptHover` on `base` returns global description hover | unit | `pnpm -F language-services vitest run -t "scriptHover"` | Wave 0 |
| SCRIPT-03 | `scriptHover` after `base.getTables` returns method hover with signature | unit | same | Wave 0 |
| SCRIPT-03 | `scriptHover` on unknown identifier returns null | unit | same | Wave 0 |
| SCRIPT-04 | `scriptDiagnostics` flags bare `selectRecordsAsync()` without await | unit | `pnpm -F language-services vitest run -t "scriptDiagnostics"` | Wave 0 |
| SCRIPT-04 | Does NOT flag `await selectRecordsAsync()` | unit | same | Wave 0 |
| SCRIPT-04 | Does NOT flag `return selectRecordsAsync()` | unit | same | Wave 0 |
| SCRIPT-04 | Does NOT flag assignment `const p = selectRecordsAsync()` | unit | same | Wave 0 |
| SCRIPT-05 | Flags unknown identifier `myLib.doThing()` | unit | same | Wave 0 |
| SCRIPT-05 | Does NOT flag `console.log()` | unit | same | Wave 0 |
| SCRIPT-05 | Does NOT flag locally-declared `const myTable` used as `myTable.selectRecordsAsync(...)` | unit | same | Wave 0 |
| SCRIPT-06 | SVG icon files exist at correct paths | manual (file check) | n/a | Wave creates files |

### Sampling Rate

- **Per task commit:** `pnpm -F language-services vitest run`
- **Per wave merge:** `pnpm -F language-services vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/language-services/src/test/script/registry.test.ts` -- SCRIPT_GLOBALS has expected global names; methods shape is correct
- [ ] `packages/language-services/src/test/script/completions.test.ts` -- top-level returns all globals; `base.` returns base methods; unknown object returns empty
- [ ] `packages/language-services/src/test/script/hover.test.ts` -- global hover, method hover, unknown returns null
- [ ] `packages/language-services/src/test/script/diagnostics.test.ts` -- missing-await cases; unknown-global cases

---

## Security Domain

`security_enforcement` not set in config.json (absent = enabled). Assessed below.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | n/a -- no auth in language engine |
| V3 Session Management | No | n/a -- no sessions |
| V4 Access Control | No | n/a -- VS Code extension context only |
| V5 Input Validation | Partial | Text scanning uses regex on user file content; no external input beyond document text |
| V6 Cryptography | No | n/a |

### Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Regex catastrophic backtracking on malformed script files | Denial of Service | Keep diagnostic regexes linear; avoid nested quantifiers; test with large inputs |
| False-positive diagnostics causing workflow disruption | Information Disclosure (false data) | Strict allowlist; comprehensive test coverage for all non-flagging cases |

**Assessment:** Phase 3 is a read-only text analysis engine with no network calls, no file writes, and no external input beyond the document text. Security exposure is minimal.

---

## Sources

### Primary (HIGH confidence)
- `packages/language-services/src/engines/formula/diagnostics.ts` [VERIFIED] -- text scanning pattern reusable in script engine
- `packages/language-services/src/engines/formula/registry.ts` [VERIFIED] -- registry structure to mirror
- `packages/extension/src/language/formula/formula-diagnostics.ts` [VERIFIED] -- wrapper class shape
- `packages/extension/src/language/registration.ts` [VERIFIED] -- registration pattern to extend
- `packages/extension/language-configuration/airtable-formula-language-configuration.json` [VERIFIED] -- language config shape to adapt
- `packages/extension/syntaxes/airtable-formula.tmLanguage.json` [VERIFIED] -- grammar shape (script grammar differs: minimal delegation only)
- [CITED: code.visualstudio.com/api/language-extensions/syntax-highlight-guide] -- TextMate grammar embedding, `embeddedLanguages`, `include: source.js`

### Secondary (MEDIUM confidence)
- [CITED: community.airtable.com -- "Scripting block updates: breaking API changes, new input methods, easier debugging"] -- `input.*Async()` renames, `output.markdown`, `session.currentUser` introduction
- [CITED: community.airtable.com -- "Launched: get the active table/view in the scripting block!"] -- `cursor.activeTableId`, `cursor.activeViewId` confirmation
- [CITED: community.airtable.com -- "New! Improved cursor APIs (February 2020)"] -- `cursor.selectedFieldIds` mention
- [CITED: community.airtable.com -- "New: Remote fetch in Scripting App"] -- `remoteFetchAsync` parameters and redirect limitation
- [CITED: community.airtable.com -- "New: create tables, create fields..."] -- `base.createTableAsync`, `table.createFieldAsync`
- [CITED: developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects] -- JS built-in object/function list
- [CITED: coda.io/@kuovonne -- "Converting a script to run as an automation"] -- scripting-only vs automation globals distinction

### Tertiary (LOW confidence)
- [simplescraper.io/blog/complete-guide-airtable-scripting] -- base/table methods cross-verified with community examples; not authoritative
- Multiple community code examples showing `cursor.selectedRecordIds[0]` in working scripts -- confirms property exists and is `string[]`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies; all plumbing from Phase 2 reused unchanged
- TextMate grammar pattern: HIGH -- official VS Code docs confirm `{ "include": "source.js" }` is the correct approach
- Global API surface overall: MEDIUM -- SPAs prevent direct doc scraping; community cross-verification provides reasonable confidence
- `cursor.selectedRecordIds` / `selectedFieldIds`: MEDIUM -- confirmed by community code examples
- JS built-in allowlist: MEDIUM-HIGH -- assembled from MDN standard globals
- Architecture patterns: HIGH -- direct carry-forward from Phase 2 verified code

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (Airtable scripting API is stable; changes are announced via community forums)
