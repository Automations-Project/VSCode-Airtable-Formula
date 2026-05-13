# Phase 4: Automation Engine - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 16 new/modified files
**Analogs found:** 16 / 16

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/language-services/src/engines/automation/registry.ts` | model | transform | `packages/language-services/src/engines/script/registry.ts` | exact |
| `packages/language-services/src/engines/automation/completions.ts` | service | request-response | `packages/language-services/src/engines/script/completions.ts` | exact |
| `packages/language-services/src/engines/automation/hover.ts` | service | request-response | `packages/language-services/src/engines/script/hover.ts` | exact |
| `packages/language-services/src/engines/automation/diagnostics.ts` | service | request-response | `packages/language-services/src/engines/script/diagnostics.ts` | exact |
| `packages/language-services/src/engines/automation/index.ts` | config | transform | `packages/language-services/src/engines/script/index.ts` | exact |
| `packages/language-services/src/test/automation/registry.test.ts` | test | request-response | `packages/language-services/src/test/script/registry.test.ts` | exact |
| `packages/language-services/src/test/automation/completions.test.ts` | test | request-response | `packages/language-services/src/test/script/completions.test.ts` | exact |
| `packages/language-services/src/test/automation/hover.test.ts` | test | request-response | `packages/language-services/src/test/script/hover.test.ts` | exact |
| `packages/language-services/src/test/automation/diagnostics.test.ts` | test | request-response | `packages/language-services/src/test/script/diagnostics.test.ts` | exact |
| `packages/extension/src/language/automation/automation-diagnostics.ts` | middleware | request-response | `packages/extension/src/language/script/script-diagnostics.ts` | exact |
| `packages/extension/src/language/automation/automation-completions.ts` | middleware | request-response | `packages/extension/src/language/script/script-completions.ts` | exact |
| `packages/extension/src/language/automation/automation-hover.ts` | middleware | request-response | `packages/extension/src/language/script/script-hover.ts` | exact |
| `packages/extension/icons/automation-light.svg` | config | — | `packages/extension/icons/script-light.svg` | exact |
| `packages/extension/icons/automation-dark.svg` | config | — | `packages/extension/icons/script-dark.svg` | exact |
| `packages/extension/syntaxes/airtable-automation.tmLanguage.json` | config | — | `packages/extension/syntaxes/airtable-script.tmLanguage.json` | exact |
| `packages/extension/language-configuration/airtable-automation-language-configuration.json` | config | — | `packages/extension/language-configuration/airtable-script-language-configuration.json` | exact |
| `packages/extension/src/language/registration.ts` (modify) | middleware | event-driven | self (append block) | exact |
| `packages/extension/package.json` (modify) | config | — | self (append entries) | exact |
| `packages/language-services/src/index.ts` (modify) | config | — | self (append line) | exact |

---

## Pattern Assignments

### `packages/language-services/src/engines/automation/registry.ts` (model, transform)

**Analog:** `packages/language-services/src/engines/script/registry.ts`

**Key difference from analog:** Replace `SCRIPT_GLOBALS` / `SCRIPT_GLOBAL_NAMES` / `getScriptGlobal` with `AUTOMATION_GLOBALS` / `AUTOMATION_GLOBAL_NAMES` / `getAutomationGlobal`. Redefine the same `ScriptGlobalInfo` / `ScriptMethodInfo` interfaces locally — do NOT import them from `engines/script/` (D-01: fully independent modules). Keep only 5 globals (`base`, `table`, `input`, `output`, `fetch`); omit `cursor`, `session`, `remoteFetchAsync`. For `base` keep only 5 methods (`id`, `name`, `tables`, `getTables`, `getTable`); omit `createTableAsync`, `getCollaborators`, `activeCollaborators`. For `table` omit `createFieldAsync`. For `input` keep only `config()`. For `output` keep only `set()`.

**Interface and export shape** (analog lines 7-15 and 223-227 — copy structure verbatim):

```typescript
export interface ScriptMethodInfo {
    signature: string;
    description: string;
}

export interface ScriptGlobalInfo {
    description: string;
    methods: Record<string, ScriptMethodInfo>;
}

export const AUTOMATION_GLOBALS: Record<string, ScriptGlobalInfo> = { /* see RESEARCH.md lines 196-313 */ };

export const AUTOMATION_GLOBAL_NAMES: string[] = Object.keys(AUTOMATION_GLOBALS);

export function getAutomationGlobal(name: string): ScriptGlobalInfo | undefined {
    return AUTOMATION_GLOBALS[name];
}
```

**AUTOMATION_GLOBALS content** — fully specified in RESEARCH.md Pattern 1 (lines 196-313):
- 5 globals: `base` (5 methods: id, name, tables, getTables, getTable), `table` (14 methods: id/name/fields/views/getField/getView/selectRecordsAsync/selectRecordAsync/createRecordAsync/createRecordsAsync/updateRecordAsync/updateRecordsAsync/deleteRecordAsync/deleteRecordsAsync), `input` (1 method: config), `output` (1 method: set), `fetch` (0 methods — empty methods object, description notes server-side execution, 30s timeout, 50-request-per-run limit)

---

### `packages/language-services/src/engines/automation/completions.ts` (service, request-response)

**Analog:** `packages/language-services/src/engines/script/completions.ts`

**Key difference from analog:** Change import to `AUTOMATION_GLOBALS, AUTOMATION_GLOBAL_NAMES`. Rename export from `scriptCompletions` to `automationCompletions`. The two-level logic is verbatim identical.

**Imports pattern** (analog lines 1-9):
```typescript
import type { LsCompletionItem, LsPosition } from '../../types.js';
import { LsCompletionItemKind } from '../../types.js';
import { AUTOMATION_GLOBALS, AUTOMATION_GLOBAL_NAMES } from './registry.js';
```

**`positionToOffset` helper** (analog lines 15-22 — copy verbatim):
```typescript
function positionToOffset(text: string, pos: { line: number; character: number }): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for the \n
    }
    return offset + pos.character;
}
```

**Core two-level completion pattern** (analog lines 37-67 — copy verbatim, rename function and registry references):
- Level 2: `textToCursor.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.\s*$/)` triggers method items for the matched global
- Level 1: maps `AUTOMATION_GLOBAL_NAMES` to Variable-kind items
- Method items use `insertText: name + '($0)'`; top-level items use `insertText: name`

Note from RESEARCH.md Pitfall 3: `output.set()` takes two arguments. The generic `name($0)` snippet is acceptable as written in the analog. Do not reduce to `set(` with no snippet — that diverges from the established `insertText` pattern.

---

### `packages/language-services/src/engines/automation/hover.ts` (service, request-response)

**Analog:** `packages/language-services/src/engines/script/hover.ts`

**Key difference from analog:** Change import to `AUTOMATION_GLOBALS`. Rename export from `scriptHover` to `automationHover`. All helpers and resolution levels copy verbatim.

**Helpers to copy verbatim** (analog lines 18-58):
- `positionToOffset` (lines 18-25)
- `offsetToPosition` (lines 30-40)
- `extractWordAt` (lines 46-58) — JS identifier regex `/[a-zA-Z_$][a-zA-Z0-9_$]*/g`

**Core hover pattern** (analog lines 76-126 — copy verbatim, rename function and registry):
- Level 2: 80-char window `(offset - 40, offset + 40)` around cursor, scans for `globalName.methodName` pattern using `dotPattern`
- Level 1: `extractWordAt` on cursor offset, lookup in `AUTOMATION_GLOBALS`
- Returns `null` on no match or empty text

---

### `packages/language-services/src/engines/automation/diagnostics.ts` (service, request-response)

**Analog:** `packages/language-services/src/engines/script/diagnostics.ts`

**Key difference from analog:** This file implements only `checkWrongContext` — no `checkMissingAwait`, no `checkUnknownGlobals`, no `KNOWN_SAFE` set, no `JS_KEYWORDS` set, no `buildLocalSymbols`. Imports only `LsDiagnostic`, `LsRange`, `LsSeverity` from `../../types.js`. No import of `AUTOMATION_GLOBAL_NAMES`.

**Imports pattern**:
```typescript
import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
```

**Position helpers to copy verbatim** (analog lines 17-31):
```typescript
function offsetToPosition(text: string, offset: number): { line: number; character: number } { ... }
function makeRange(text: string, start: number, end: number): LsRange { ... }
```

**`getExclusionRanges` and `isInsideExclusionRange` helpers to copy verbatim** (analog lines 38-87):
Handles: field refs `{...}`, double-quoted strings, single-quoted strings, template literals with backticks, `//` single-line comments, `/* */` block comments.

**`checkWrongContext` implementation** — new function, no analog:
The function iterates through a table of 15 forbidden patterns. Each pattern entry has: the `/g` regex, the diagnostic code `'wrong-context'`, the diagnostic message, and the highlight span behavior.
- For top-level globals (cursor, session, remoteFetchAsync): highlight the identifier span (`match.index` to `match.index + match[0].length`)
- For method patterns (input.textAsync, output.text, etc.): same span — the regex already captures from `input` through the opening `(`

Critical: every `/g` pattern used in a scan loop needs `pattern.lastIndex = 0` reset before the `while` loop. Patterns defined at module scope retain `lastIndex` state between calls (RESEARCH.md Pitfall 1).

**Forbidden pattern table** (15 entries from RESEARCH.md Pattern 2):
| Regex | Code | Message |
|-------|------|---------|
| `/\bcursor\b/g` | wrong-context | "cursor is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\bsession\b/g` | wrong-context | "session is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\bremoteFetchAsync\b/g` | wrong-context | "remoteFetchAsync is not available in Automation Scripts — use fetch() instead." |
| `/\binput\.textAsync\s*\(/g` | wrong-context | "input.textAsync() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\binput\.buttonsAsync\s*\(/g` | wrong-context | same input pattern |
| `/\binput\.tableAsync\s*\(/g` | wrong-context | same input pattern |
| `/\binput\.viewAsync\s*\(/g` | wrong-context | same input pattern |
| `/\binput\.fieldAsync\s*\(/g` | wrong-context | same input pattern |
| `/\binput\.recordAsync\s*\(/g` | wrong-context | same input pattern |
| `/\binput\.fileAsync\s*\(/g` | wrong-context | same input pattern |
| `/\boutput\.text\s*\(/g` | wrong-context | "output.text() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps." |
| `/\boutput\.markdown\s*\(/g` | wrong-context | same output pattern |
| `/\boutput\.table\s*\(/g` | wrong-context | same output pattern |
| `/\boutput\.clear\s*\(/g` | wrong-context | "output.clear() is only available in Airtable Scripting Extension, not Automation Scripts." |
| `/\boutput\.inspect\s*\(/g` | wrong-context | "output.inspect() is only available in Airtable Scripting Extension, not Automation Scripts." |

**Public export shape** (D-04):
```typescript
export function automationDiagnostics(text: string, _uri?: string): LsDiagnostic[] {
  const exclusionRanges = getExclusionRanges(text);
  return checkWrongContext(text, exclusionRanges);
}
```

---

### `packages/language-services/src/engines/automation/index.ts` (config, transform)

**Analog:** `packages/language-services/src/engines/script/index.ts` (4 lines — copy verbatim, substitute paths)

```typescript
export * from './registry.js';
export * from './completions.js';
export * from './hover.js';
export * from './diagnostics.js';
```

---

### `packages/language-services/src/test/automation/registry.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/script/registry.test.ts`

**Key differences:**
- Import path: `../../engines/automation/index.js`
- Import names: `AUTOMATION_GLOBALS`, `AUTOMATION_GLOBAL_NAMES`, `getAutomationGlobal`
- `AUTOMATION_GLOBAL_NAMES` has length 5 (not 8)
- Must assert `cursor`, `session`, `remoteFetchAsync` are `undefined` in `AUTOMATION_GLOBALS`
- `input` has only `config` method; `output` has only `set` method
- `base` does NOT have `createTableAsync`; `table` does NOT have `createFieldAsync`

Full test scaffold: RESEARCH.md lines 658-692.

**Import pattern** (analog lines 1-6):
```typescript
import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_GLOBALS,
  AUTOMATION_GLOBAL_NAMES,
  getAutomationGlobal,
} from '../../engines/automation/index.js';
```

---

### `packages/language-services/src/test/automation/completions.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/script/completions.test.ts`

**Key differences:**
- Import `automationCompletions` from `../../engines/automation/index.js`
- Top-level items: assert 5 globals (not 8)
- Assert `cursor`, `session`, `remoteFetchAsync` are NOT in top-level labels
- `input.` completions: only `config` (length 1)
- `output.` completions: only `set` (length 1)
- `fetch.` completions: empty array (no methods)

**Import pattern** (analog lines 1-3):
```typescript
import { describe, it, expect } from 'vitest';
import { automationCompletions } from '../../engines/automation/index.js';
import { LsCompletionItemKind } from '../../index.js';
```

---

### `packages/language-services/src/test/automation/hover.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/script/hover.test.ts`

**Key differences:**
- Import `automationHover` from `../../engines/automation/index.js`
- Test automation globals: `base`, `input`, `output`, `fetch`
- `input.config` method hover at appropriate char position
- `cursor`, `session`, `remoteFetchAsync` return `null` (not in registry)

**Import pattern** (analog lines 1-2):
```typescript
import { describe, it, expect } from 'vitest';
import { automationHover } from '../../engines/automation/index.js';
```

---

### `packages/language-services/src/test/automation/diagnostics.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/script/diagnostics.test.ts`

**Key differences:**
- Import `automationDiagnostics` from `../../engines/automation/index.js`
- No `missing-await` test group (not in automation engine)
- No `unknown-global` test group (not in automation engine)
- New test groups: `wrong-context top-level globals`, `wrong-context method patterns`, `allowed automation APIs`
- Exclusion-range tests: identifiers inside string literals and `//` comments must NOT produce diagnostics

Full test scaffold: RESEARCH.md lines 696-763.

**Import pattern**:
```typescript
import { describe, it, expect } from 'vitest';
import { automationDiagnostics } from '../../engines/automation/index.js';
import { LsSeverity } from '../../index.js';
```

---

### `packages/extension/src/language/automation/automation-diagnostics.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/script/script-diagnostics.ts` (21 lines)

**Substitutions:** `scriptDiagnostics` → `automationDiagnostics`, `'airtable-script'` → `'airtable-automation'` (2 occurrences), `AirtableScriptDiagnosticsProvider` → `AirtableAutomationDiagnosticsProvider`.

Complete file (copy analog verbatim, apply substitutions):
```typescript
import * as vscode from 'vscode';
import { automationDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableAutomationDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-automation');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-automation') return;
        const lsDiags = automationDiagnostics(document.getText(), document.uri.toString());
        this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

---

### `packages/extension/src/language/automation/automation-completions.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/script/script-completions.ts` (15 lines)

**Substitutions:** `scriptCompletions` → `automationCompletions`, `AirtableScriptCompletionProvider` → `AirtableAutomationCompletionProvider`.

Complete file:
```typescript
import * as vscode from 'vscode';
import { automationCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';

export class AirtableAutomationCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const lsItems = automationCompletions(document.getText(), toLsPosition(position));
        return lsItems.map(toVscodeCompletionItem);
    }
}
```

---

### `packages/extension/src/language/automation/automation-hover.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/script/script-hover.ts` (14 lines)

**Substitutions:** `scriptHover` → `automationHover`, `AirtableScriptHoverProvider` → `AirtableAutomationHoverProvider`.

Complete file:
```typescript
import * as vscode from 'vscode';
import { automationHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';

export class AirtableAutomationHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const lsHover = automationHover(document.getText(), toLsPosition(position));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
```

---

### `packages/extension/icons/automation-light.svg` and `automation-dark.svg` (config)

**Analog:** `packages/extension/icons/script-light.svg` (fill `#388E3C`) and `script-dark.svg` (fill `#2E7D32`)

Change letter from `S` to `A`. Keep same green fill colors to visually group Airtable-specific file types.

**automation-light.svg** (16x16, green `#388E3C`, letter `A`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#388E3C"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="white" text-anchor="middle">A</text>
</svg>
```

**automation-dark.svg** (16x16, darker green `#2E7D32`, letter `A`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#2E7D32"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="white" text-anchor="middle">A</text>
</svg>
```

---

### `packages/extension/syntaxes/airtable-automation.tmLanguage.json` (config)

**Analog:** `packages/extension/syntaxes/airtable-script.tmLanguage.json` (9 lines)

Substitutions: `source.airtable-script` → `source.airtable-automation`, `"Airtable Script"` → `"Airtable Automation"`, `["script", "ats"]` → `["automation", "ata"]`.

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

---

### `packages/extension/language-configuration/airtable-automation-language-configuration.json` (config)

**Analog:** `packages/extension/language-configuration/airtable-script-language-configuration.json` (92 lines)

Copy verbatim — no content changes needed. The script language configuration already has the correct JS settings (line/block comments, JS identifier word pattern, JS bracket pairs, backtick auto-close).

---

## Modifications to Existing Files

### `packages/extension/src/language/registration.ts` — append automation providers block

**Analog:** Script providers block at lines 62-91 — copy verbatim, substitute `Script` → `Automation` and `'airtable-script'` → `'airtable-automation'`.

**New imports to add** (append after line 9, the existing script imports):
```typescript
import { AirtableAutomationDiagnosticsProvider } from './automation/automation-diagnostics';
import { AirtableAutomationCompletionProvider } from './automation/automation-completions';
import { AirtableAutomationHoverProvider } from './automation/automation-hover';
```

**Block to append after line 91** (after the script `textDocuments.forEach` loop):
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

---

### `packages/extension/package.json` — add language + grammar + icon entries

**Analog:** `airtable-script` entries at lines 76-100.

**Add to `contributes.languages[]`** (after the `airtable-script` block closing `}` at line 85):
```json
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
```

**Add to `contributes.grammars[]`** (after the `airtable-script` grammar block at line 100):
```json
{
  "language": "airtable-automation",
  "scopeName": "source.airtable-automation",
  "path": "./syntaxes/airtable-automation.tmLanguage.json",
  "embeddedLanguages": {
    "source.airtable-automation": "javascript"
  }
}
```

---

### `packages/language-services/src/index.ts` — add automation barrel export

**Analog:** Line 3: `export * from './engines/script/index.js';`

**Add one line** after line 3:
```typescript
export * from './engines/automation/index.js';
```

---

## Shared Patterns

### Convert utilities — zero new code needed
**Source:** `packages/extension/src/language/convert.ts`
**Apply to:** All three automation wrapper classes
All converters are already implemented:
- `toLsPosition` (line 4)
- `toVscodeDiagnostic` (line 20)
- `toVscodeCompletionItem` (line 50)
- `toVscodeHover` (line 43)

### DiagnosticCollection lifecycle
**Source:** `packages/extension/src/language/script/script-diagnostics.ts` lines 6-21
**Apply to:** `automation-diagnostics.ts`
Pattern: create collection in constructor, dispose in `dispose()`, guard on `languageId` in `updateDiagnostics`.

### LsSeverity / LsCompletionItemKind numeric parity
**Source:** `packages/language-services/src/types.ts` lines 62-99
**Apply to:** All engine files, all test files
`LsSeverity.Warning = 1` maps directly to `vscode.DiagnosticSeverity.Warning`. Cast directly in `toVscodeDiagnostic` — no mapping table needed. Same parity for `LsCompletionItemKind`.

### T-03-01 regex safety rule (carry-forward from Phase 3)
**Source:** `packages/language-services/src/engines/script/diagnostics.ts` (comment at line 6)
**Apply to:** `automationDiagnostics` — all wrong-context regex patterns must use character-class repetitions only. No nested quantifiers. All 15 forbidden patterns are linear: `\b`, `\w`, `\s`, literal characters only.

### Pure function / no-vscode-imports rule
**Source:** `packages/language-services/src/engines/script/completions.ts` (comment at line 3)
**Apply to:** All four engine files (`registry.ts`, `completions.ts`, `hover.ts`, `diagnostics.ts`)
Engine files must have zero `import from 'vscode'`. Only `'../../types.js'` and `'./registry.js'` are permitted.

### D-01: Independent module decoupling
**Source:** CONTEXT.md D-01
**Apply to:** `automation/registry.ts`
No imports from `engines/script/`. The `ScriptGlobalInfo` and `ScriptMethodInfo` interfaces are redeclared in `automation/registry.ts` even though they are structurally identical to the script engine interfaces. This preserves the decoupling freedom so the two engines can diverge without coordination.

---

## No Analog Found

None. Every new file in Phase 4 has a direct exact analog in the script engine layer. The automation engine is structurally isomorphic to the script engine.

---

## Metadata

**Analog search scope:** `packages/language-services/src/engines/script/`, `packages/language-services/src/test/script/`, `packages/extension/src/language/script/`, `packages/extension/icons/`, `packages/extension/syntaxes/`, `packages/extension/language-configuration/`, `packages/extension/package.json`, `packages/language-services/src/index.ts`
**Files scanned:** 16 analog files read in full
**Pattern extraction date:** 2026-05-13
