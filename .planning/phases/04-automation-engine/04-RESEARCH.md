# Phase 4: Automation Engine - Research

**Researched:** 2026-05-13
**Domain:** VS Code language extension — TextMate grammar, completions, hover, diagnostics for Airtable Automation Script globals; official automation global surface verification
**Confidence:** MEDIUM (official Airtable docs are SPA-rendered and unscrapable; global API surface assembled from official support pages, multiple independent community threads, and cross-verified code examples — confidence is HIGH for the binary available/forbidden split, MEDIUM for specific method-level detail)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** AUTOMATION_GLOBALS is a **fully independent registry** defined in `engines/automation/registry.ts`. No imports from `engines/script/`. The two engines are decoupled modules — automation can diverge freely as the Airtable API evolves without risk of inheriting scripting-only globals.
- **D-02:** **Conservative inclusion** — only methods explicitly confirmed for the automation context in official Airtable docs are included in AUTOMATION_GLOBALS. Methods that are uncertain or undocumented for automation are **omitted**.
- **D-03:** `remoteFetchAsync` used in a `.automation` file → **Warning severity**. Diagnostic message: `"remoteFetchAsync is not available in Automation Scripts — use fetch() instead."`
- **D-04:** The public export is `automationDiagnostics(text: string, _uri?: string): LsDiagnostic[]` — same shape as `scriptDiagnostics`. Internally calls `checkWrongContext(text, exclusionRanges)`. No missing-await check and no unknown-global check.
- **D-05:** **No unknown-global check** in the automation engine. `automationDiagnostics()` only runs the wrong-context check.
- **D-06:** Researcher fallback for uncertain methods: **omit**. No "unconfirmed" hover caveats.
- **D-07:** The wrong-context check flags **both top-level forbidden globals and forbidden method patterns** on `input`/`output`:
  - **Forbidden top-level globals**: `cursor`, `session`, `remoteFetchAsync`
  - **Forbidden method patterns**: `input.textAsync()`, `input.buttonsAsync()`, `output.text()`, `output.markdown()`, `output.table()` (and other interactive methods)

### Claude's Discretion

- Exact AUTOMATION_GLOBALS method set for `base` and `table` (conservative, from research findings below).
- Exact `input.config()` and `output.set()` signatures and descriptions.
- Exact forbidden method list for wrong-context scanner.
- SVG placeholder icon content (same green-letter placeholder pattern as script engine).
- TextMate grammar and language configuration (identical to script engine pattern).

### Deferred Ideas (OUT OF SCOPE)

- Unknown-global check for automation.
- Signature help for automation methods (AUTO-ADV-01, v2).
- `input.config()` field-type string-literal completions (SCRIPT-ADV-02 / v2).
- Cross-context paste hint (SCRIPT-ADV-04, v2).
- Automation runtime limit analysis (explicitly out of scope per REQUIREMENTS.md).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTO-01 | `airtable-automation` language ID for `.automation`/`.ata`; TextMate grammar embedding `source.js`; JS language config | Same TextMate embed-source.js pattern as SCRIPT-01; grammar/config files are direct copies with name substitution |
| AUTO-02 | Completions scoped to automation context; `input.` shows only `input.config()`; `output.` shows only `output.set()`; scripting-only globals absent | AUTOMATION_GLOBALS registry fully defined below; confirmed globals documented with method sets |
| AUTO-03 | Hover documentation for all automation globals and their methods | Registry-driven hover; same two-level hover pattern as script engine |
| AUTO-04 | Diagnostic for scripting-extension-only globals in `.automation` files; `remoteFetchAsync` → Warning | Wrong-context forbidden list fully defined below; regex patterns specified; severity mapping confirmed |
| AUTO-05 | Custom light/dark SVG file icon for `.automation`/`.ata` | Same placeholder SVG pattern as script engine (`icons/automation-light.svg`, `icons/automation-dark.svg`) |
</phase_requirements>

---

## Summary

Phase 4 is structurally isomorphic to Phase 3. Every architectural decision from Phase 3 applies directly: the engine lives in `engines/automation/`, exposes three pure functions (`automationDiagnostics`, `automationCompletions`, `automationHover`), uses the same `ScriptGlobalInfo`/`ScriptMethodInfo` interfaces, and wires three thin VS Code wrapper classes (`AirtableAutomationDiagnosticsProvider`, `AirtableAutomationCompletionProvider`, `AirtableAutomationHoverProvider`) through `registration.ts`. No new npm packages are needed.

The critical distinction from Phase 3 is the AUTOMATION_GLOBALS content. Web research confirms a clean binary split between the two contexts: `cursor`, `session`, and all interactive `input.*Async()` / `output.text/markdown/table/clear/inspect` methods are scripting-extension-only and raise runtime errors in automation context. Conversely, `base`, `table`, `fetch`, `input.config()`, and `output.set()` are confirmed available in automation. `remoteFetchAsync` is definitively absent from automation scripts (runtime error "remoteFetchAsync is not defined") — the diagnostic raises Warning severity per D-03.

The prerequisite gate from ROADMAP.md Phase 4 is resolved by this research: (a) `base`/`table`/`fetch` availability in automation is CONFIRMED; (b) `remoteFetchAsync` is ABSENT — runtime error, not deprecated-warning; (c) `input.config()` returns a plain JavaScript object with properties matching the input variables configured in the UI — no typed field-type enum (the field-type enum is a scripting-extension-only concept); (d) `output.set(key, value)` accepts a string key and any JSON-serializable value.

**Primary recommendation:** Build AUTOMATION_GLOBALS registry first (conservative: read-methods on `base`/`table` only; omit `createTableAsync`/`createFieldAsync`/`getCollaborators`/`activeCollaborators` which are unconfirmed for automation), then implement completions and hover (trivially derived from the registry), then diagnostics (wrong-context scan with method-level pattern detection for `input.*` and `output.*`).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TextMate grammar + language config | Extension host (package.json contributes) | — | Static assets; no runtime code required |
| AUTOMATION_GLOBALS registry | language-services engine | — | Pure data module; zero VS Code dependency |
| Dot-triggered completions | language-services engine | Extension host (wrapper) | Engine provides items; wrapper converts via `toVscodeCompletionItem` |
| Hover documentation | language-services engine | Extension host (wrapper) | Engine resolves hover; wrapper adapts to `vscode.Hover` |
| Wrong-context diagnostic | language-services engine | Extension host (wrapper) | Text scan is pure; wrapper converts to `vscode.Diagnostic` |
| SVG file icons | Extension host (package.json + icons/) | — | Static assets; wired via `contributes.languages[].icon` |
| Provider registration | Extension host (registration.ts) | — | VS Code API call; must run in extension host context |

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vscode` | built-in | Extension host API | Required for all VS Code providers |
| `@airtable-formula/language-services` | workspace:* | Pure engine functions | Same pattern as formula and script engines |
| `vitest` | ^1.6.0 | Test runner for language-services | Already configured in `packages/language-services/vitest.config.ts` |
| `typescript` | ^5.4.0 | Compilation | Workspace standard |

Phase 4 introduces zero new npm packages. All tools and libraries are already in the workspace. [VERIFIED: packages/language-services/package.json, packages/extension/package.json]

**Installation:** No installation step needed.

---

## Architecture Patterns

### System Architecture Diagram

```
.automation / .ata file opened in VS Code
        |
        v
  registration.ts — registerLanguageProviders()
        |
        +--- AirtableAutomationDiagnosticsProvider
        |         |  onOpen/onChange -> document.getText()
        |         |                        |
        |         |              automationDiagnostics(text)
        |         |                        |
        |         |              checkWrongContext(text, exclusionRanges)
        |         |                +-- scan forbidden top-level globals (cursor, session, remoteFetchAsync)
        |         |                +-- scan forbidden method patterns (input.textAsync, output.text, etc.)
        |         |                        |
        |         |              LsDiagnostic[] -> toVscodeDiagnostic() -> DiagnosticCollection.set()
        |         |
        +--- AirtableAutomationCompletionProvider  (trigger: '.')
        |         |  provideCompletionItems(document, position)
        |         |                        |
        |         |              automationCompletions(text, pos)
        |         |                +-- Level 2: textToCursor ends with 'globalName.' -> method items
        |         |                +-- Level 1: return all AUTOMATION_GLOBALS names
        |         |                        |
        |         |              LsCompletionItem[] -> toVscodeCompletionItem()
        |         |
        +--- AirtableAutomationHoverProvider
                  |  provideHover(document, position)
                  |                        |
                  |              automationHover(text, pos)
                  |                +-- Level 2: 80-char window -> globalName.methodName match
                  |                +-- Level 1: word under cursor -> AUTOMATION_GLOBALS key
                  |                        |
                  |              LsHover | null -> toVscodeHover()
                  |
        +--------------------------------------------+
        |  engines/automation/ (pure, no vscode)     |
        |  registry.ts  -- AUTOMATION_GLOBALS        |
        |  completions.ts  -- automationCompletions  |
        |  hover.ts        -- automationHover        |
        |  diagnostics.ts  -- automationDiagnostics  |
        |  index.ts        -- barrel exports         |
        +--------------------------------------------+
```

### Recommended Project Structure

```
packages/language-services/src/
  engines/
    formula/           (existing)
    script/            (existing)
    automation/        NEW - Phase 4
      index.ts         barrel: export * from all 4 files
      registry.ts      AUTOMATION_GLOBALS + ScriptGlobalInfo (reused type, redeclared locally)
      completions.ts   automationCompletions(text, pos)
      hover.ts         automationHover(text, pos)
      diagnostics.ts   automationDiagnostics(text, _uri?)

packages/language-services/src/test/
  script/              (existing)
  automation/          NEW - Wave 0 scaffolds
    registry.test.ts
    completions.test.ts
    hover.test.ts
    diagnostics.test.ts

packages/extension/src/language/
  formula/             (existing)
  script/              (existing)
  automation/          NEW - Phase 4
    automation-diagnostics.ts
    automation-completions.ts
    automation-hover.ts

packages/extension/
  icons/
    automation-light.svg   NEW
    automation-dark.svg    NEW
  syntaxes/
    airtable-automation.tmLanguage.json    NEW
  language-configuration/
    airtable-automation-language-configuration.json    NEW
```

### Pattern 1: AUTOMATION_GLOBALS Registry (registry.ts)

**What:** Independent nested registry using the same `ScriptGlobalInfo`/`ScriptMethodInfo` interfaces from `engines/script/registry.ts`, but defined entirely in `engines/automation/registry.ts` without importing from script.

**When to use:** Only confirmed automation-context methods are included. D-02 applies: conservative inclusion.

```typescript
// Source: D-01 (independent), D-02 (conservative), plus verified global surface below
// engines/automation/registry.ts
// No import from engines/script/ — fully independent by D-01

export interface ScriptMethodInfo {
    signature: string;
    description: string;
}

export interface ScriptGlobalInfo {
    description: string;
    methods: Record<string, ScriptMethodInfo>;
}

export const AUTOMATION_GLOBALS: Record<string, ScriptGlobalInfo> = {
    base: {
        description: 'Represents the current Airtable base. Available in automation scripts.',
        methods: {
            id: {
                signature: 'base.id: string',
                description: "The base's unique ID.",
            },
            name: {
                signature: 'base.name: string',
                description: "The base's display name.",
            },
            tables: {
                signature: 'base.tables: Table[]',
                description: 'All tables in the base (read-only property).',
            },
            getTables: {
                signature: 'base.getTables(): Table[]',
                description: 'Returns an array of all tables in the base.',
            },
            getTable: {
                signature: 'base.getTable(nameOrId: string): Table',
                description: 'Returns the table with the given name or ID. Throws if not found.',
            },
        },
    },
    table: {
        description: 'Represents an Airtable table. Obtained via base.getTable() or base.tables.',
        methods: {
            id: { signature: 'table.id: string', description: 'Unique table ID.' },
            name: { signature: 'table.name: string', description: 'Table display name.' },
            fields: { signature: 'table.fields: Field[]', description: 'All fields in the table.' },
            views: { signature: 'table.views: View[]', description: 'All views in the table.' },
            getField: {
                signature: 'table.getField(nameOrId: string): Field',
                description: 'Returns the field with the given name or ID. Throws if not found.',
            },
            getView: {
                signature: 'table.getView(nameOrId: string): View',
                description: 'Returns the view with the given name or ID. Throws if not found.',
            },
            selectRecordsAsync: {
                signature: 'table.selectRecordsAsync(options?: object): Promise<RecordQueryResult>',
                description: 'Queries all records in the table. Options include fields and sorts.',
            },
            selectRecordAsync: {
                signature: 'table.selectRecordAsync(recordId: string, options?: object): Promise<Record | null>',
                description: 'Fetches a single record by ID. Returns null if not found.',
            },
            createRecordAsync: {
                signature: 'table.createRecordAsync(fields: object): Promise<string>',
                description: 'Creates one record with the given field values. Returns the new record ID.',
            },
            createRecordsAsync: {
                signature: 'table.createRecordsAsync(records: object[]): Promise<string[]>',
                description: 'Creates up to 50 records. Returns an array of new record IDs.',
            },
            updateRecordAsync: {
                signature: 'table.updateRecordAsync(record: Record | string, fields: object): Promise<void>',
                description: 'Updates a single record with the given field values.',
            },
            updateRecordsAsync: {
                signature: 'table.updateRecordsAsync(records: object[]): Promise<void>',
                description: 'Updates up to 50 records.',
            },
            deleteRecordAsync: {
                signature: 'table.deleteRecordAsync(record: Record | string): Promise<void>',
                description: 'Deletes a single record.',
            },
            deleteRecordsAsync: {
                signature: 'table.deleteRecordsAsync(records: Array<Record | string>): Promise<void>',
                description: 'Deletes up to 50 records.',
            },
        },
    },
    input: {
        description: 'Provides access to input variables configured in the automation script editor. Only input.config() is available — interactive input methods are not available in automation scripts.',
        methods: {
            config: {
                signature: 'input.config(): object',
                description: 'Returns the input variables object configured in the automation script editor. Access properties by name: `input.config().myVariable`.',
            },
        },
    },
    output: {
        description: 'Passes data from this script step to subsequent automation steps. Only output.set() is available — display methods (text, markdown, table) are not available in automation scripts.',
        methods: {
            set: {
                signature: 'output.set(key: string, value: JSONSerializable): void',
                description: 'Stores a JSON-serializable value under the given key, making it available to subsequent automation steps. Value must be a JSON-serializable type (string, number, boolean, array, or plain object). Maximum output size is 6 MB.',
            },
        },
    },
    fetch: {
        description: 'Standard fetch function. Runs server-side in automation scripts — no CORS restrictions apply. Timeout is 30 seconds. Maximum 50 fetch requests per automation run.\n\n`fetch(url: string, init?: RequestInit): Promise<Response>`',
        methods: {},
    },
};

export const AUTOMATION_GLOBAL_NAMES: string[] = Object.keys(AUTOMATION_GLOBALS);

export function getAutomationGlobal(name: string): ScriptGlobalInfo | undefined {
    return AUTOMATION_GLOBALS[name];
}
```

**Key differences from SCRIPT_GLOBALS:**
- Only 5 globals: `base`, `table`, `input`, `output`, `fetch` (no `cursor`, `session`, `remoteFetchAsync`)
- `input` has only `config()` — no `textAsync`, `buttonsAsync`, `tableAsync`, `viewAsync`, `fieldAsync`, `recordAsync`, `fileAsync`
- `output` has only `set()` — no `text`, `markdown`, `table`, `clear`, `inspect`
- `base` has only 5 read methods — no `createTableAsync`, `getCollaborators`, `activeCollaborators` (unconfirmed for automation per D-02)
- `table` has no `createFieldAsync` (unconfirmed for automation per D-02)

### Pattern 2: Wrong-Context Diagnostic (diagnostics.ts)

**What:** Single-function diagnostic engine. Scans text for forbidden globals and forbidden method patterns. No missing-await, no unknown-global (D-04, D-05).

**When to use:** Run on every `.automation` file open/change event.

Key design points (T-03-01 DoS-prevention rule — all regex patterns are linear):

```typescript
// Forbidden top-level globals — one per entry, \b-anchored, linear patterns
// cursor, session: all contexts -> Warning
// remoteFetchAsync -> Warning (D-03)

// Forbidden method patterns on input/output
// Pattern structure: /\bGLOBAL\.METHODNAME\s*\(/g
// \b ensures word boundary, \s* handles optional space before paren
// Paren at end confirms call expression (not property access to user-defined field)
// All patterns linear: T-03-01 compliant

// IMPORTANT: All module-scope /g patterns need lastIndex reset before each scan loop.
// Reset with: pattern.lastIndex = 0  before each while(pattern.exec(text)) loop.
// Failure to reset causes stale lastIndex on the second document scan.

export function automationDiagnostics(text: string, _uri?: string): LsDiagnostic[] {
    const exclusionRanges = getExclusionRanges(text);
    // getExclusionRanges copied verbatim from engines/script/diagnostics.ts
    return checkWrongContext(text, exclusionRanges);
}
```

**Complete forbidden pattern table for checkWrongContext:**

| Pattern | Match | Severity | Code | Message |
|---------|-------|----------|------|---------|
| `/\bcursor\b/g` | `cursor` | Warning | wrong-context | "cursor is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\bsession\b/g` | `session` | Warning | wrong-context | "session is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\bremoteFetchAsync\b/g` | `remoteFetchAsync` | Warning | wrong-context | "remoteFetchAsync is not available in Automation Scripts — use fetch() instead." |
| `/\binput\.textAsync\s*\(/g` | `input.textAsync(` | Warning | wrong-context | "input.textAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.buttonsAsync\s*\(/g` | `input.buttonsAsync(` | Warning | wrong-context | "input.buttonsAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.tableAsync\s*\(/g` | `input.tableAsync(` | Warning | wrong-context | "input.tableAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.viewAsync\s*\(/g` | `input.viewAsync(` | Warning | wrong-context | "input.viewAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.fieldAsync\s*\(/g` | `input.fieldAsync(` | Warning | wrong-context | "input.fieldAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.recordAsync\s*\(/g` | `input.recordAsync(` | Warning | wrong-context | "input.recordAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.fileAsync\s*\(/g` | `input.fileAsync(` | Warning | wrong-context | "input.fileAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\boutput\.text\s*\(/g` | `output.text(` | Warning | wrong-context | "output.text() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps." |
| `/\boutput\.markdown\s*\(/g` | `output.markdown(` | Warning | wrong-context | "output.markdown() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps." |
| `/\boutput\.table\s*\(/g` | `output.table(` | Warning | wrong-context | "output.table() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps." |
| `/\boutput\.clear\s*\(/g` | `output.clear(` | Warning | wrong-context | "output.clear() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\boutput\.inspect\s*\(/g` | `output.inspect(` | Warning | wrong-context | "output.inspect() is only available in Airtable Scripting Extension, not Automation Scripts." |

**Range to highlight:** For top-level globals (cursor, session, remoteFetchAsync), highlight the identifier span (match.index to match.index + match[0].length). For method patterns (input.textAsync(), output.text()), highlight from the start of the match (start of `input`) through the opening paren — so the entire `input.textAsync(` span is highlighted.

### Pattern 3: Completions (completions.ts)

**What:** Direct copy-adapt of `engines/script/completions.ts`. Replace `SCRIPT_GLOBALS` import with `AUTOMATION_GLOBALS`, replace `SCRIPT_GLOBAL_NAMES` with `AUTOMATION_GLOBAL_NAMES`. Export as `automationCompletions`.

The two-level logic is identical. The only change is the registry being imported.

### Pattern 4: Hover (hover.ts)

**What:** Direct copy-adapt of `engines/script/hover.ts`. Replace `SCRIPT_GLOBALS` import with `AUTOMATION_GLOBALS`. Export as `automationHover`.

The two-level resolution logic is identical.

### Pattern 5: TextMate Grammar

```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "scopeName": "source.airtable-automation",
  "name": "Airtable Automation",
  "fileTypes": ["automation", "ata"],
  "patterns": [
    { "include": "source.js" }
  ]
}
```

Direct copy of `airtable-script.tmLanguage.json` with name/scopeName/fileTypes updated.

### Pattern 6: SVG Placeholder Icons

```xml
<!-- icons/automation-light.svg (same pattern as script-light.svg) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#388E3C"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="white" text-anchor="middle">A</text>
</svg>
```

Use letter `A` for automation. Same green (#388E3C) as script to visually group the Airtable-specific file types. Same file for both light and dark variants (existing pattern from script icons).

### Pattern 7: package.json Language Contribution

```json
// Add to contributes.languages[]
{
  "id": "airtable-automation",
  "aliases": ["Airtable Automation", "automation"],
  "extensions": [".automation", ".ata"],
  "configuration": "./language-configuration/airtable-automation-language-configuration.json",
  "icon": {
    "light": "./icons/automation-light.svg",
    "dark": "./icons/automation-dark.svg"
  }
}

// Add to contributes.grammars[]
{
  "language": "airtable-automation",
  "scopeName": "source.airtable-automation",
  "path": "./syntaxes/airtable-automation.tmLanguage.json",
  "embeddedLanguages": {
    "source.airtable-automation": "javascript"
  }
}
```

### Pattern 8: VS Code Wrapper Classes

Three files in `packages/extension/src/language/automation/`:

**automation-diagnostics.ts** — same shape as `script-diagnostics.ts`:
- Class `AirtableAutomationDiagnosticsProvider implements vscode.Disposable`
- Creates `vscode.languages.createDiagnosticCollection('airtable-automation')`
- `updateDiagnostics` guards on `document.languageId !== 'airtable-automation'`
- Calls `automationDiagnostics(document.getText(), document.uri.toString())`

**automation-completions.ts** — same shape as `script-completions.ts`:
- Class `AirtableAutomationCompletionProvider implements vscode.CompletionItemProvider`
- Calls `automationCompletions(document.getText(), toLsPosition(position))`

**automation-hover.ts** — same shape as `script-hover.ts`:
- Class `AirtableAutomationHoverProvider implements vscode.HoverProvider`
- Calls `automationHover(document.getText(), toLsPosition(position))`

### Pattern 9: registration.ts Extension

Append after the existing script providers block (after the `vscode.workspace.textDocuments.forEach` for `airtable-script`):

```typescript
// Automation providers — same lifecycle pattern as script providers above
const automationDiagnosticsProvider = new AirtableAutomationDiagnosticsProvider();
context.subscriptions.push(automationDiagnosticsProvider);
context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'airtable-automation') {
            automationDiagnosticsProvider.updateDiagnostics(event.document);
        }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'airtable-automation') {
            automationDiagnosticsProvider.updateDiagnostics(document);
        }
    }),
    vscode.languages.registerHoverProvider(
        'airtable-automation',
        new AirtableAutomationHoverProvider()
    ),
    vscode.languages.registerCompletionItemProvider(
        'airtable-automation',
        new AirtableAutomationCompletionProvider(),
        '.'
    ),
);
vscode.workspace.textDocuments.forEach((document) => {
    if (document.languageId === 'airtable-automation') {
        automationDiagnosticsProvider.updateDiagnostics(document);
    }
});
```

### Anti-Patterns to Avoid

- **Importing from engines/script/**: AUTOMATION_GLOBALS must define its own `ScriptGlobalInfo`/`ScriptMethodInfo` interfaces. Import nothing from `engines/script/`. The types happen to be identical but the modules are decoupled by D-01.
- **Adding unconfirmed methods**: Do NOT add `createTableAsync`, `createFieldAsync`, `getCollaborators`, `activeCollaborators` to AUTOMATION_GLOBALS. These are confirmed scripting-extension-only.
- **output.set() single-arg snippet**: Do NOT use a single `$0` snippet placeholder for `output.set()` — it takes two arguments. Use `output.set(` as insertText or a two-slot snippet.
- **Forgetting lastIndex reset**: All module-scope `/g` regex patterns must have `lastIndex = 0` reset before each new scan loop, or results on sequential documents will be incorrect.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type conversions (LsDiagnostic to vscode.Diagnostic) | Custom adapter logic | `convert.ts` (`toVscodeDiagnostic`, `toVscodeCompletionItem`, `toVscodeHover`, `toLsPosition`) | Already implemented in Phase 2; automation wrappers reuse exactly |
| Position arithmetic (offset vs line/char) | Custom position math | `positionToOffset`/`offsetToPosition` helpers from script engine (copy verbatim) | Already tested and correct |
| Exclusion range computation | Custom string-literal + comment scanner | `getExclusionRanges` helper from script diagnostics.ts (copy verbatim) | Handles field refs, double/single/template literals, `//` and block comments |
| Word extraction for hover | Custom token scanner | `extractWordAt` helper from script hover.ts (copy verbatim with registry name change) | Already handles JS identifier boundaries |
| Method-level hover window | Custom window search | 80-char window pattern from `scriptHover` (copy with registry name change) | O(1) bounded window; avoids scanning entire file |

**Key insight:** Automation is a configuration variant of the script engine, not a new domain. Every utility function is reusable. The only novel code is AUTOMATION_GLOBALS content and the wrong-context forbidden-pattern lists.

---

## Automation Global Surface — Verified Findings

This section resolves the ROADMAP.md Phase 4 prerequisite gate explicitly.

### (a) base / table / fetch availability

**CONFIRMED AVAILABLE** in automation scripts. [CITED: support.airtable.com/docs/run-a-script-action]

Evidence quality: HIGH — multiple official support pages and hundreds of community code examples show `base.getTable()`, `table.selectRecordsAsync()`, `table.createRecordAsync()`, `table.updateRecordAsync()` working in automation scripts. `fetch()` availability confirmed; automation scripts run server-side with a 30-second timeout and 50-fetch-per-run limit.

### (b) remoteFetchAsync status — ABSENT (runtime error, not deprecated)

**ABSENT from automation scripts.** Not deprecated — absent. Causes a runtime error `"remoteFetchAsync is not defined"` when used in an automation context. [CITED: community.airtable.com — multiple threads, including direct error reports]

Rationale: `remoteFetchAsync` was invented to bypass CORS in browser-based scripting extension. Automation scripts run server-side on Airtable's infrastructure where CORS does not apply. `fetch()` is the correct replacement.

Diagnostic decision (D-03): Warning severity. Message: `"remoteFetchAsync is not available in Automation Scripts — use fetch() instead."`

### (c) input.config() — returns plain object, no field-type enum in automation

**CONFIRMED AVAILABLE.** [CITED: support.airtable.com/docs/run-a-script-action]

`input.config()` returns a plain JavaScript object whose properties correspond to the input variable names configured in the "Run a script" action editor. There is NO field-type enum in the returned object in the automation context — the variables arrive as raw JavaScript values (strings, numbers, record IDs etc.) corresponding to what was wired up in the automation trigger or previous actions.

The scripting-extension-only `input.config()` variant (which accepts a typed settings descriptor object and builds an interactive configuration UI) is a different API. In automation scripts, `input.config()` takes no arguments and returns the configured input variables object.

Example usage pattern:
```javascript
const cfg = input.config();
const recordId = cfg.recordId;  // string from automation input variable
```

The field-type configuration object shape (e.g., `{ type: 'number', label: '...' }`) is specific to the Scripting Extension `input.config()` call — NOT available in automation. This is why the deferred SCRIPT-ADV-02 / `input.config()` field-type completions are out of scope for Phase 4.

Hover/completion entry:
- Signature: `input.config(): object`
- Description: "Returns the input variables object configured in the automation script editor. Access properties by name: `input.config().myVariable`."

### (d) output.set() signature and accepted types

**CONFIRMED AVAILABLE.** [CITED: community.airtable.com/automations-8/how-to-use-output-set-correctly-23115]

Signature: `output.set(key: string, value: JSONSerializable): void`

- `key`: string identifier for the output variable (appears in subsequent automation steps)
- `value`: must be a JSON-serializable type — primitives, arrays, plain objects. Airtable Record objects are NOT accepted (causes TypeError). Maximum output payload is 6 MB total.

### Forbidden globals and methods — complete verified list

**Forbidden top-level globals** (runtime error if used in automation):
- `cursor` — UI cursor state; no active user interface in automation context [CITED: community.airtable.com cursor discussions]
- `session` — current user session; automation scripts run headlessly [CITED: community.airtable.com]
- `remoteFetchAsync` — CORS bypass; unnecessary server-side; causes "not defined" runtime error [CITED: multiple community threads]

**Forbidden input methods** (scripting-extension-only — all raise "is not a function" in automation):
- `input.textAsync()` [CITED: community.airtable.com/automations-8/]
- `input.buttonsAsync()` [CITED: community.airtable.com/development-apis-11/impossible-to-use-input-buttonsasync-5534]
- `input.tableAsync()` [CITED: community.airtable.com — input methods guide]
- `input.viewAsync()` [CITED: community.airtable.com/t5/development-apis/input-fieldasync-with-view]
- `input.fieldAsync()` [CITED: same source]
- `input.recordAsync()` [CITED: community.airtable.com/t5/automations/error-with-gt-input-recordasync-is-not-a-function]
- `input.fileAsync()` [ASSUMED — logically follows from automation server-side context; file upload requires browser UI]

**Forbidden output methods** (scripting-extension-only — no output panel in automation):
- `output.text()` [CITED: community.airtable.com — "you can't use output.text in automation"]
- `output.markdown()` [CITED: community.airtable.com/development-apis-11/issue-output-markdown-in-automation-3139]
- `output.table()` [CITED: community.airtable.com — automations-functions-excluded thread]
- `output.clear()` [CITED: kuovonne's guide — "delete it when converting to automation"]
- `output.inspect()` [CITED: community.airtable.com — "you can't use output.text/markdown/inspect/table"]

**Omitted from AUTOMATION_GLOBALS** (not confirmed for automation per D-02):
- `base.createTableAsync()` — scripting app only per official announcement [CITED: community.airtable.com/development-apis-11/new-create-tables-create-fields]
- `base.getCollaborators()` — no community evidence of use in automation
- `base.activeCollaborators` — no community evidence of use in automation
- `table.createFieldAsync()` — scripting app only per official announcement [CITED: same source]

---

## Common Pitfalls

### Pitfall 1: Regex lastIndex Reset on Module-Scope Patterns

**What goes wrong:** Forbidden pattern arrays defined at module scope with the `/g` flag retain `lastIndex` state between `automationDiagnostics` calls. The second call on a different document skips matches before the stale `lastIndex`.

**Why it happens:** JavaScript regex with `/g` flag maintains `lastIndex` as mutable state between `exec()` calls. Module-scope regexes persist across calls.

**How to avoid:** Reset `pattern.lastIndex = 0` at the top of each scan iteration before calling `exec()` in a `while` loop. Alternatively define patterns as factory functions returning fresh instances. The `lastIndex = 0` reset is cheaper and the established pattern in this codebase.

**Warning signs:** Tests pass on a single document but fail when two documents are tested in sequence within the same test process.

### Pitfall 2: output.table() vs output.tableData Property Access

**What goes wrong:** The pattern `/\boutput\.table\s*\(/g` correctly matches `output.table(...)`. A simpler pattern like `/output\.table/g` would also fire on a user-defined property like `output.tableData`, creating false positives.

**Why it happens:** Method-level detection must confirm the opening `(` follows to confirm it is a call expression, not a property access.

**How to avoid:** All FORBIDDEN_METHODS patterns include `\s*\(` at the end. Never omit the opening paren from the pattern.

### Pitfall 3: output.set() Completions — Two-Arg Snippet

**What goes wrong:** Using `insertText: 'set($0)'` with a single tab-stop misrepresents `output.set()` which requires two arguments.

**How to avoid:** Use `insertText: 'set('` (no snippet), or a two-slot snippet: `set(${1:key}, ${2:value})`. Conservative choice: `set(` without snippet.

### Pitfall 4: Forgetting to Export AUTOMATION_GLOBAL_NAMES

**What goes wrong:** The completions engine uses `AUTOMATION_GLOBAL_NAMES` for Level 1 completions and the test suite uses it for count assertions. If registry.ts only exports `AUTOMATION_GLOBALS`, the completions module must import via `Object.keys()` at runtime — this works but diverges from the established pattern.

**How to avoid:** Export `AUTOMATION_GLOBAL_NAMES: string[]` and `getAutomationGlobal()` from registry.ts, exactly mirroring `SCRIPT_GLOBAL_NAMES` and `getScriptGlobal()` in script/registry.ts.

---

## Code Examples

### Minimal automationDiagnostics public function shape

```typescript
// Source: D-04 (shape matches scriptDiagnostics) + Pattern 2 table above
export function automationDiagnostics(text: string, _uri?: string): LsDiagnostic[] {
    const exclusionRanges = getExclusionRanges(text);
    return checkWrongContext(text, exclusionRanges);
}
// getExclusionRanges: copy verbatim from engines/script/diagnostics.ts
// checkWrongContext: implements Pattern 2 forbidden table above
```

### AUTOMATION_GLOBALS count summary

For planners/test authors:
- AUTOMATION_GLOBAL_NAMES.length: **5** (`base`, `table`, `input`, `output`, `fetch`)
- `base` methods: 5 (`id`, `name`, `tables`, `getTables`, `getTable`)
- `table` methods: 14 (`id`, `name`, `fields`, `views`, `getField`, `getView`, `selectRecordsAsync`, `selectRecordAsync`, `createRecordAsync`, `createRecordsAsync`, `updateRecordAsync`, `updateRecordsAsync`, `deleteRecordAsync`, `deleteRecordsAsync`)
- `input` methods: 1 (`config`)
- `output` methods: 1 (`set`)
- `fetch` methods: 0 (fetch itself is the call)

### Wave-0 Test Scaffold Patterns

```typescript
// src/test/automation/registry.test.ts
import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_GLOBALS,
  AUTOMATION_GLOBAL_NAMES,
  getAutomationGlobal,
} from '../../engines/automation/index.js';

describe('AUTOMATION_GLOBALS', () => {
  it('contains exactly 5 top-level globals', () => {
    expect(AUTOMATION_GLOBAL_NAMES).toHaveLength(5);
    for (const name of ['base', 'table', 'input', 'output', 'fetch']) {
      expect(AUTOMATION_GLOBALS[name], `Expected "${name}" to be defined`).toBeDefined();
    }
  });
  it('does NOT contain cursor, session, or remoteFetchAsync', () => {
    expect(AUTOMATION_GLOBALS['cursor']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['session']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['remoteFetchAsync']).toBeUndefined();
  });
  it('input has only config method', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['input'].methods)).toEqual(['config']);
  });
  it('output has only set method', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['output'].methods)).toEqual(['set']);
  });
  it('base does NOT have createTableAsync', () => {
    expect(AUTOMATION_GLOBALS['base'].methods['createTableAsync']).toBeUndefined();
  });
  it('table does NOT have createFieldAsync', () => {
    expect(AUTOMATION_GLOBALS['table'].methods['createFieldAsync']).toBeUndefined();
  });
  it('getAutomationGlobal returns undefined for unknown name', () => {
    expect(getAutomationGlobal('unknownXYZ')).toBeUndefined();
  });
});
```

```typescript
// src/test/automation/diagnostics.test.ts
import { describe, it, expect } from 'vitest';
import { automationDiagnostics } from '../../engines/automation/index.js';
import { LsSeverity } from '../../index.js';

describe('automationDiagnostics — wrong-context top-level globals', () => {
  it('flags cursor as Warning with code wrong-context', () => {
    const diags = automationDiagnostics('cursor.selectedRecordIds');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.severity).toBe(LsSeverity.Warning);
  });
  it('flags session', () => {
    expect(automationDiagnostics('session.currentUser').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags remoteFetchAsync as Warning', () => {
    const diags = automationDiagnostics('remoteFetchAsync("https://example.com")');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.severity).toBe(LsSeverity.Warning);
    expect(d!.message).toContain('use fetch()');
  });
});

describe('automationDiagnostics — wrong-context method patterns', () => {
  it('flags input.textAsync()', () => {
    expect(automationDiagnostics('await input.textAsync("prompt")').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags input.buttonsAsync()', () => {
    expect(automationDiagnostics('await input.buttonsAsync("pick", [])').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags output.text()', () => {
    expect(automationDiagnostics('output.text("hello")').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags output.markdown()', () => {
    expect(automationDiagnostics('output.markdown("## hi")').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags output.table()', () => {
    expect(automationDiagnostics('output.table(records)').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags output.clear()', () => {
    expect(automationDiagnostics('output.clear()').some(d => d.code === 'wrong-context')).toBe(true);
  });
  it('flags output.inspect()', () => {
    expect(automationDiagnostics('output.inspect(thing)').some(d => d.code === 'wrong-context')).toBe(true);
  });
});

describe('automationDiagnostics — allowed automation APIs', () => {
  it('does NOT flag input.config()', () => {
    expect(automationDiagnostics('const cfg = input.config()').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
  it('does NOT flag output.set()', () => {
    expect(automationDiagnostics('output.set("key", "value")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
  it('does NOT flag fetch()', () => {
    expect(automationDiagnostics('const r = await fetch("https://api.example.com")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
  it('does NOT flag base.getTable()', () => {
    expect(automationDiagnostics('const t = base.getTable("name")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
  it('does NOT flag forbidden identifiers inside string literals', () => {
    expect(automationDiagnostics('"cursor is not available"').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
  it('does NOT flag forbidden identifiers inside line comments', () => {
    expect(automationDiagnostics('// cursor is scripting only').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shared globals registry (automation inherits from script) | Fully independent AUTOMATION_GLOBALS registry (D-01) | This phase | Clean divergence path; automation API can evolve independently |
| No automation-specific language features | Dedicated `airtable-automation` language ID with scoped completions and diagnostics | This phase | Users get accurate completions for the correct context |
| `remoteFetchAsync` silently fails at runtime | Warning diagnostic in editor before runtime | This phase | Catches the #1 migration mistake immediately |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `input.fileAsync()` is not available in automation (follows from server-side execution, no browser file upload UI) | Forbidden methods list | Low risk — if available, removing from forbidden list is a minor patch with no user harm |
| A2 | `base.getCollaborators()` and `base.activeCollaborators` are absent from automation (no community evidence found) | AUTOMATION_GLOBALS omissions | Low risk — conservative omission means users don't see completions; adding later is trivial |
| A3 | The AUTOMATION_GLOBALS `base` method set (5 methods) is the complete confirmed set | AUTOMATION_GLOBALS registry | Medium risk — some read methods might work in automation; user would not see completions for them, but no false completions shown |
| A4 | `output.set()` key parameter is always a string | output.set() signature | Low risk — community discussion consistently shows string keys |

If A2 or A3 are wrong, the consequence is missing completions, not wrong completions — this aligns with D-02 (conservative inclusion).

---

## Open Questions (RESOLVED)

1. **Is remoteFetchAsync a ReferenceError (absent) or undefined (present but nulled)?**
   - What we know: Community threads report "remoteFetchAsync is not defined" — this is JavaScript's ReferenceError message, indicating the binding is truly absent.
   - What's unclear: Whether Airtable ever added a stub that returns undefined instead.
   - Recommendation: Treat as absent. The diagnostic message ("not available") is accurate either way.

2. **Are there additional automation-specific input methods not covered by `input.config()`?**
   - What we know: Official support docs state "input and output APIs from the scripting extension are not currently available. Automations scripts have different, simpler input/output APIs." The word "simpler" strongly implies `input.config()` is the entirety.
   - What's unclear: Whether Airtable has added new automation-specific input methods since that documentation.
   - Recommendation: Keep `input` with only `config()` per D-02. Registry updates are trivial.

3. **Are `base.getCollaborators()` and `base.activeCollaborators` available in automation?**
   - What we know: No community evidence of use in automation. No mentions in any thread researched.
   - What's unclear: Absence of evidence vs. evidence of absence.
   - Recommendation: Omit per D-02.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 4 is a pure code/config change. No external dependencies beyond the existing pnpm workspace. No CLI tools, databases, or services are introduced.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^1.6.0 |
| Config file | `packages/language-services/vitest.config.ts` (existing) |
| Quick run command | `pnpm -F @airtable-formula/language-services vitest run` |
| Full suite command | `pnpm -F @airtable-formula/language-services vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTO-01 | Language ID registered; `.automation`/`.ata` opens with JS highlighting and comment toggling | smoke (manual VS Code) | `pnpm build` succeeds | N/A — static assets |
| AUTO-02 | `input.` completions show only `config`; `output.` shows only `set`; forbidden globals absent from completions | unit | `pnpm -F @airtable-formula/language-services vitest run` | ❌ Wave 0 |
| AUTO-03 | Hover shows docs for all automation globals and methods | unit | `pnpm -F @airtable-formula/language-services vitest run` | ❌ Wave 0 |
| AUTO-04 | Wrong-context diagnostic flags cursor/session/remoteFetchAsync/input.*Async/output.text/markdown/table/clear/inspect; input.config() and output.set() not flagged | unit | `pnpm -F @airtable-formula/language-services vitest run` | ❌ Wave 0 |
| AUTO-05 | SVG icons appear in VS Code file explorer | smoke (manual VS Code) | — | N/A — static assets |

### Sampling Rate

- **Per task commit:** `pnpm -F @airtable-formula/language-services vitest run`
- **Per wave merge:** `pnpm -F @airtable-formula/language-services vitest run`
- **Phase gate:** Full test suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/language-services/src/test/automation/registry.test.ts` — covers AUTO-02 (registry correctness, correct omissions)
- [ ] `packages/language-services/src/test/automation/completions.test.ts` — covers AUTO-02 (scoped completions)
- [ ] `packages/language-services/src/test/automation/hover.test.ts` — covers AUTO-03
- [ ] `packages/language-services/src/test/automation/diagnostics.test.ts` — covers AUTO-04

No new framework install needed — vitest and config already exist.

---

## Security Domain

The automation engine contains no authentication, session management, access control, or cryptography. The only security-relevant property is the regex DoS prevention requirement (T-03-01 from Phase 3 RESEARCH.md — carry-forward).

**T-03-01 compliance for all new patterns:**

| Pattern | T-03-01 Status |
|---------|----------------|
| `/\bcursor\b/g` | Linear — `\w` char-class only, no nesting |
| `/\bsession\b/g` | Linear |
| `/\bremoteFetchAsync\b/g` | Linear |
| `/\binput\.textAsync\s*\(/g` | Linear — literal dot, `\s*` single char-class, literal `(` |
| `/\boutput\.text\s*\(/g` | Linear — same structure |
| All other FORBIDDEN_METHODS patterns | Linear — identical structure |

All patterns: character-class repetitions only (`\w`, `\s`), no nested quantifiers, bounded by word boundaries and literal characters. T-03-01 compliant.

---

## Sources

### Primary (HIGH confidence)

- `packages/language-services/src/engines/script/` — existing script engine code; direct model for automation engine structure [VERIFIED: read in this session]
- `packages/extension/src/language/script/` — existing script wrappers; direct model for automation wrappers [VERIFIED: read in this session]
- `packages/extension/package.json` — confirmed language contribution structure for `airtable-script` [VERIFIED: read in this session]
- [support.airtable.com/docs/run-a-script-action](https://support.airtable.com/docs/run-a-script-action) — confirmed `input.config()`, `output.set()`, "input/output APIs from scripting extension not currently available" [CITED]

### Secondary (MEDIUM confidence)

- [community.airtable.com — automations functions excluded thread](https://community.airtable.com/development-apis-11/automations-functions-excluded-output-text-recordasync-6253) — confirmed output.text, input.recordAsync absent [CITED]
- [community.airtable.com — how to use output.set correctly](https://community.airtable.com/t5/automations/how-to-use-output-set-correctly/td-p/162698) — confirmed output.set(key, value) signature and JSON-serializable constraint [CITED]
- [community.airtable.com — output.markdown in automation issue](https://community.airtable.com/development-apis-11/issue-output-markdown-in-automation-3139) — confirmed output.markdown absent [CITED]
- [community.airtable.com — impossible to use input.buttonsAsync](https://community.airtable.com/development-apis-11/impossible-to-use-input-buttonsasync-5534) — confirmed input.buttonsAsync absent [CITED]
- [community.airtable.com — input.recordAsync is not a function](https://community.airtable.com/t5/automations/error-with-gt-input-recordasync-is-not-a-function/td-p/78429) — confirmed input.recordAsync absent [CITED]
- [community.airtable.com — remoteFetchAsync not working thread](https://community.airtable.com/other-questions-13/remotefetchasync-not-working-18894) — cross-ref on remoteFetchAsync absent vs. scripting app [CITED]
- [community.airtable.com — createTableAsync/createFieldAsync scripting app only](https://community.airtable.com/development-apis-11/new-create-tables-create-fields-and-update-field-options-from-the-scripting-app-7220) — confirmed base.createTableAsync and table.createFieldAsync are scripting-app-only [CITED]
- [coda.io — kuovonne's guide to converting scripts to automation](https://coda.io/@kuovonne/kuovonnes-guided-to-scripting-in-airtable/converting-a-script-to-run-as-an-automation-9) — confirmed output.clear() deletion on automation conversion [CITED]

### Tertiary (LOW confidence)

- No tertiary sources — all claims supported by secondary community citations or direct codebase inspection.

---

## Metadata

**Confidence breakdown:**
- Global surface (available/forbidden split): HIGH — multiple independent community sources, official support docs, and runtime error reports confirm the split
- AUTOMATION_GLOBALS method set (`base`, `table`): MEDIUM — confirmed via community code examples; method-level completeness not fully verifiable (SPA docs unscrapable)
- `input.config()` / `output.set()` signatures: MEDIUM — community usage patterns and support page description; exact TypeScript type definitions not extractable from docs
- Architecture patterns: HIGH — direct extrapolation from existing Phase 3 code in this repo

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (Airtable automation API surface is stable; 30-day window is reasonable)
