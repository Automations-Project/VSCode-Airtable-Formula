# Phase 3: Script Engine - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 19 (16 new + 3 modified)
**Analogs found:** 19 / 19

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/language-services/src/engines/script/registry.ts` | model | transform | `packages/language-services/src/engines/formula/registry.ts` | role-match (flat to nested) |
| `packages/language-services/src/engines/script/diagnostics.ts` | service | transform | `packages/language-services/src/engines/formula/diagnostics.ts` | exact |
| `packages/language-services/src/engines/script/completions.ts` | service | request-response | `packages/language-services/src/engines/formula/completions.ts` | exact |
| `packages/language-services/src/engines/script/hover.ts` | service | request-response | `packages/language-services/src/engines/formula/hover.ts` | exact |
| `packages/language-services/src/engines/script/index.ts` | config | transform | `packages/language-services/src/engines/formula/index.ts` | exact |
| `packages/extension/src/language/script/script-diagnostics.ts` | middleware | request-response | `packages/extension/src/language/formula/formula-diagnostics.ts` | exact |
| `packages/extension/src/language/script/script-completions.ts` | middleware | request-response | `packages/extension/src/language/formula/formula-completions.ts` | exact |
| `packages/extension/src/language/script/script-hover.ts` | middleware | request-response | `packages/extension/src/language/formula/formula-hover.ts` | exact |
| `packages/language-services/src/test/script/registry.test.ts` | test | transform | `packages/language-services/src/test/formula/registry.test.ts` | exact |
| `packages/language-services/src/test/script/completions.test.ts` | test | request-response | `packages/language-services/src/test/formula/completions.test.ts` | exact |
| `packages/language-services/src/test/script/hover.test.ts` | test | request-response | `packages/language-services/src/test/formula/hover.test.ts` | exact |
| `packages/language-services/src/test/script/diagnostics.test.ts` | test | transform | `packages/language-services/src/test/formula/diagnostics.test.ts` | exact |
| `packages/extension/syntaxes/airtable-script.tmLanguage.json` | config | — | `packages/extension/syntaxes/airtable-formula.tmLanguage.json` | role-match (script delegates; formula has full repo) |
| `packages/extension/language-configuration/airtable-script-language-configuration.json` | config | — | `packages/extension/language-configuration/airtable-formula-language-configuration.json` | exact (plus backtick pair) |
| `packages/extension/icons/script-light.svg` | config | — | `packages/extension/icons/formula-light.svg` | exact |
| `packages/extension/icons/script-dark.svg` | config | — | `packages/extension/icons/formula-dark.svg` | exact |
| `packages/language-services/src/index.ts` (modify) | config | — | existing file (add one export line) | exact |
| `packages/extension/src/language/registration.ts` (modify) | middleware | request-response | existing file (extend function body) | exact |
| `packages/extension/package.json` (modify) | config | — | existing `contributes.languages[]` entry | exact |

---

## Pattern Assignments

### `packages/language-services/src/engines/script/registry.ts` (model, transform)

**Analog:** `packages/language-services/src/engines/formula/registry.ts`

**File-level comment** (analog lines 1-6 — pure data module, no vscode imports):
```typescript
/**
 * Airtable Scripting Extension Global Registry
 * Single source of truth for all scripting globals.
 * No imports from 'vscode' — pure data module.
 */
```

**Type definitions** (adapt from analog lines 7-21 to two-level nested shape):
```typescript
export interface ScriptMethodInfo {
  signature: string;
  description: string;
}

export interface ScriptGlobalInfo {
  description: string;
  methods: Record<string, ScriptMethodInfo>;
}
```

**Registry constant** (analog lines 28-129 — flat `FUNCTION_REGISTRY` becomes nested `SCRIPT_GLOBALS`):
```typescript
export const SCRIPT_GLOBALS: Record<string, ScriptGlobalInfo> = {
  base: {
    description: 'Represents the current Airtable base. Injected as a global in every script.',
    methods: {
      getTables: {
        signature: 'base.getTables(): Table[]',
        description: 'Returns an array of all tables in the base.',
      },
      // ... full method list
    },
  },
  // ... other globals: table, cursor, input, output, session, fetch, remoteFetchAsync
};
```

**Derived constants and helpers** (analog lines 140-165 — adapt names):
```typescript
export const SCRIPT_GLOBAL_NAMES = Object.keys(SCRIPT_GLOBALS);

export function getScriptGlobal(name: string): ScriptGlobalInfo | undefined {
  return SCRIPT_GLOBALS[name];
}
```

**Structural difference from formula analog:** Formula registry is flat `Record<string, FunctionInfo>`. Script registry is nested: each entry has `methods: Record<string, ScriptMethodInfo>`. No `levenshteinDistance`, `COMMON_TYPOS`, `SMART_QUOTES`, or `CALLABLE_CONSTANTS` equivalents are needed.

---

### `packages/language-services/src/engines/script/diagnostics.ts` (service, transform)

**Analog:** `packages/language-services/src/engines/formula/diagnostics.ts`

**Imports pattern** (analog lines 1-18):
```typescript
import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
import { SCRIPT_GLOBALS, SCRIPT_GLOBAL_NAMES } from './registry.js';
```

**Position helpers** — copy verbatim from formula analog lines 24-38:
```typescript
function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; lastNewline = i; }
  }
  return { line, character: offset - lastNewline - 1 };
}

function makeRange(text: string, start: number, end: number): LsRange {
  return {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
  };
}
```

**Exclusion ranges helper** — copy verbatim from formula analog lines 44-91, then add template-literal case:
```typescript
// Add after the existing single-quote regex block:
const templateLiteralRegex = /`(?:[^`\\]|\\.)*`/g;
while ((match = templateLiteralRegex.exec(text)) !== null) {
  ranges.push({ start: match.index, end: match.index + match[0].length });
}
```

**SCRIPT-04 check function** (new — no formula analog; based on RESEARCH.md Pattern 4):
```typescript
function checkMissingAwait(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const asyncPattern = /\b(\w+Async)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = asyncPattern.exec(text)) !== null) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;
    // Scan back to statement start; check for await/return/assignment/then chain
    const stmtStart = findStatementStart(text, match.index);
    const stmtContext = text.slice(stmtStart, match.index);
    const isAccepted =
      /\bawait\b/.test(stmtContext) ||
      /\breturn\b/.test(stmtContext) ||
      /\b(?:const|let|var)\s+\w/.test(stmtContext) ||
      /\)\s*\.then\s*\(/.test(text.slice(match.index));
    if (!isAccepted) {
      diagnostics.push({
        range: makeRange(text, match.index, match.index + match[1].length),
        message: `'${match[1]}' is an async function. Add 'await' before calling it.`,
        severity: LsSeverity.Warning,
        code: 'missing-await',
        source: 'airtable-script',
      });
    }
  }
  return diagnostics;
}
```

**SCRIPT-05 check function** (new — no formula analog; RESEARCH.md Pattern 5 two-phase approach):
```typescript
// Phase A: buildLocalSymbols(text) collects const/let/var/function/class/for-of/catch/arrow params
// Phase B: scanUnknownGlobals checks bare identifiers before . or ( against
//   SCRIPT_GLOBAL_NAMES, JS_BUILTIN_ALLOWLIST, JS_KEYWORDS, and localSymbols
```

**Main export** (analog lines 550-564):
```typescript
export function scriptDiagnostics(text: string, uri?: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const exclusionRanges = getExclusionRanges(text);
  diagnostics.push(...checkMissingAwait(text, exclusionRanges));
  diagnostics.push(...checkUnknownGlobals(text, exclusionRanges));
  return diagnostics;
}
```

---

### `packages/language-services/src/engines/script/completions.ts` (service, request-response)

**Analog:** `packages/language-services/src/engines/formula/completions.ts`

**Imports pattern** (analog lines 1-8):
```typescript
import type { LsCompletionItem, LsPosition } from '../../types.js';
import { LsCompletionItemKind } from '../../types.js';
import { SCRIPT_GLOBALS, SCRIPT_GLOBAL_NAMES } from './registry.js';
```

**Position-to-offset helper** — copy `positionToOffset` from hover analog lines 17-24:
```typescript
function positionToOffset(text: string, pos: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset + pos.character;
}
```

**Main export signature** (adapt from formula analog line 21):
```typescript
export function scriptCompletions(text: string, pos: LsPosition): LsCompletionItem[] {
```

**Two-level completion logic** (RESEARCH.md Pattern 2 — no formula analog for dot-trigger):
```typescript
  const offset = positionToOffset(text, pos);
  const textToCursor = text.slice(0, offset);

  // Level 2: dot-triggered method completions
  const dotMatch = textToCursor.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.\s*$/);
  if (dotMatch) {
    const globalName = dotMatch[1];
    const globalInfo = SCRIPT_GLOBALS[globalName];
    if (globalInfo) {
      return Object.entries(globalInfo.methods).map(([name, method]) => ({
        label: name,
        kind: LsCompletionItemKind.Method,   // kind = 1
        detail: globalName,
        documentation: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
        insertText: `${name}($0)`,
      }));
    }
    return []; // unknown object — no completions from this engine
  }

  // Level 1: top-level global names
  return SCRIPT_GLOBAL_NAMES.map(name => ({
    label: name,
    kind: LsCompletionItemKind.Variable,   // kind = 5
    documentation: { kind: 'markdown', value: SCRIPT_GLOBALS[name].description },
    insertText: name,
  }));
```

---

### `packages/language-services/src/engines/script/hover.ts` (service, request-response)

**Analog:** `packages/language-services/src/engines/formula/hover.ts`

**Imports pattern** (analog lines 1-7):
```typescript
import type { LsHover, LsRange, LsPosition } from '../../types.js';
import { SCRIPT_GLOBALS } from './registry.js';
```

**Helpers** — copy `positionToOffset` (lines 17-24), `offsetToPosition` (lines 29-39), and `extractWordAt` (lines 45-57) verbatim from formula hover analog. Adapt `extractWordAt` word regex from `/[A-Z_][A-Z0-9_]*/gi` to `/[a-zA-Z_$][a-zA-Z0-9_$]*/g` (JS identifiers are case-sensitive; no `.toUpperCase()` on lookup).

**Main export signature** (analog line 105):
```typescript
export function scriptHover(text: string, pos: LsPosition): LsHover | null {
```

**Two-level hover resolution** (adapt from formula analog lines 106-131; formula has single-level registry):
```typescript
  const offset = positionToOffset(text, pos);

  // Level 2: method hover — check if cursor is on "globalName.methodName"
  const dotMethodMatch = text.slice(0, offset + 30).match(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)$/
  );
  if (dotMethodMatch) {
    const globalName = dotMethodMatch[1];
    const methodName = dotMethodMatch[2];
    const globalInfo = SCRIPT_GLOBALS[globalName];
    if (globalInfo?.methods[methodName]) {
      const method = globalInfo.methods[methodName];
      return {
        contents: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
      };
    }
  }

  // Level 1: global-level hover
  const wordMatch = extractWordAt(text, offset);
  if (!wordMatch) return null;
  const { word, start, end } = wordMatch;
  const range: LsRange = {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
  };
  const globalInfo = SCRIPT_GLOBALS[word];
  if (globalInfo) {
    return {
      contents: { kind: 'markdown', value: `**${word}**\n\n${globalInfo.description}` },
      range,
    };
  }

  return null;
```

---

### `packages/language-services/src/engines/script/index.ts` (config)

**Analog:** `packages/language-services/src/engines/formula/index.ts` (all 5 lines)

**Pattern** — copy exactly, remove `signature.js` (no signature help in Phase 3):
```typescript
export * from './registry.js';
export * from './diagnostics.js';
export * from './completions.js';
export * from './hover.js';
```

---

### `packages/extension/src/language/script/script-diagnostics.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/formula/formula-diagnostics.ts` (all 21 lines)

**Copy verbatim, substitute language ID and class/function names:**
```typescript
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

**D-03 constraint:** `diagnosticCollection` is an instance field on the class — NOT a module-level singleton. The analog already enforces this; copy the constructor pattern faithfully.

---

### `packages/extension/src/language/script/script-completions.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/formula/formula-completions.ts` (all 15 lines)

**Copy verbatim, substitute names:**
```typescript
import * as vscode from 'vscode';
import { scriptCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';

export class AirtableScriptCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const lsItems = scriptCompletions(document.getText(), toLsPosition(position));
        return lsItems.map(toVscodeCompletionItem);
    }
}
```

---

### `packages/extension/src/language/script/script-hover.ts` (middleware, request-response)

**Analog:** `packages/extension/src/language/formula/formula-hover.ts` (all 14 lines)

**Copy verbatim, substitute names:**
```typescript
import * as vscode from 'vscode';
import { scriptHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';

export class AirtableScriptHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const lsHover = scriptHover(document.getText(), toLsPosition(position));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
```

---

### `packages/language-services/src/test/script/registry.test.ts` (test, transform)

**Analog:** `packages/language-services/src/test/formula/registry.test.ts` (all 85 lines)

**Imports pattern** (analog lines 1-11):
```typescript
import { describe, it, expect } from 'vitest';
import {
  SCRIPT_GLOBALS,
  SCRIPT_GLOBAL_NAMES,
  getScriptGlobal,
} from '../../engines/script/index.js';
```

**Test structure** (adapt analog `describe` blocks to nested shape assertions):
```typescript
describe('SCRIPT_GLOBALS', () => {
  it('contains all 8 top-level globals', () => {
    for (const name of ['base', 'table', 'cursor', 'input', 'output', 'session', 'fetch', 'remoteFetchAsync']) {
      expect(SCRIPT_GLOBALS[name]).toBeDefined();
    }
  });
  it('each global has description and methods', () => {
    for (const name of SCRIPT_GLOBAL_NAMES) {
      expect(typeof SCRIPT_GLOBALS[name].description).toBe('string');
      expect(SCRIPT_GLOBALS[name].methods).toBeDefined();
    }
  });
  it('base.getTables has signature and description', () => {
    expect(SCRIPT_GLOBALS['base'].methods['getTables'].signature).toContain('getTables');
    expect(SCRIPT_GLOBALS['base'].methods['getTables'].description).toBeTruthy();
  });
  it('table.selectRecordsAsync is present', () => {
    expect(SCRIPT_GLOBALS['table'].methods['selectRecordsAsync']).toBeDefined();
  });
});
```

---

### `packages/language-services/src/test/script/completions.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/formula/completions.test.ts` (all 65 lines)

**Imports pattern** (analog lines 1-5):
```typescript
import { describe, it, expect } from 'vitest';
import { scriptCompletions } from '../../engines/script/index.js';
import { LsCompletionItemKind } from '../../index.js';

const pos = { line: 0, character: 0 };
```

**Test structure** (analog `describe` pattern — two-level scenarios):
```typescript
describe('scriptCompletions — top-level globals', () => {
  it('includes all 8 globals', () => { ... });
  it('base item has kind Variable (5)', () => {
    const item = scriptCompletions('', pos).find(i => i.label === 'base');
    expect(item?.kind).toBe(LsCompletionItemKind.Variable);
  });
});
describe('scriptCompletions — dot-triggered method completions', () => {
  it('base. returns getTables with kind Method (1)', () => {
    const items = scriptCompletions('base.', { line: 0, character: 5 });
    const item = items.find(i => i.label === 'getTables');
    expect(item).toBeDefined();
    expect(item?.kind).toBe(LsCompletionItemKind.Method);
  });
  it('unknown object. returns empty array', () => {
    expect(scriptCompletions('myLib.', { line: 0, character: 6 })).toHaveLength(0);
  });
});
```

---

### `packages/language-services/src/test/script/hover.test.ts` (test, request-response)

**Analog:** `packages/language-services/src/test/formula/hover.test.ts` (all 40 lines)

**Imports pattern** (analog lines 1-3):
```typescript
import { describe, it, expect } from 'vitest';
import { scriptHover } from '../../engines/script/index.js';
```

**Test structure** (analog pattern):
```typescript
describe('scriptHover — global hover', () => {
  it('returns non-null hover for "base" at char 0', () => {
    const hover = scriptHover('base.getTables()', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
    expect(hover?.contents.kind).toBe('markdown');
  });
});
describe('scriptHover — method hover', () => {
  it('returns method hover on getTables (char 6)', () => {
    const text = 'base.getTables()';
    const hover = scriptHover(text, { line: 0, character: 6 });
    expect(hover?.contents.value).toContain('getTables');
  });
});
describe('scriptHover — unknown identifier', () => {
  it('returns null for unknown identifier', () => {
    expect(scriptHover('myLib.doThing()', { line: 0, character: 0 })).toBeNull();
  });
});
```

---

### `packages/language-services/src/test/script/diagnostics.test.ts` (test, transform)

**Analog:** `packages/language-services/src/test/formula/diagnostics.test.ts` (all 54 lines)

**Imports pattern** (analog lines 1-4):
```typescript
import { describe, it, expect } from 'vitest';
import { scriptDiagnostics } from '../../engines/script/index.js';
import { LsSeverity } from '../../index.js';
```

**Test structure** (analog pattern — SCRIPT-04/05 cases):
```typescript
describe('scriptDiagnostics — SCRIPT-04 missing await', () => {
  it('flags bare selectRecordsAsync() without await', () => {
    const diags = scriptDiagnostics('table.selectRecordsAsync({})');
    const diag = diags.find(d => d.code === 'missing-await');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe(LsSeverity.Warning);
  });
  it('does NOT flag awaited call', () => {
    const diags = scriptDiagnostics('await table.selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });
  it('does NOT flag assignment to variable', () => {
    const diags = scriptDiagnostics('const p = table.selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });
});
describe('scriptDiagnostics — SCRIPT-05 unknown global', () => {
  it('flags unknown global myLib.doThing()', () => {
    const diag = scriptDiagnostics('myLib.doThing()').find(d => d.code === 'unknown-global');
    expect(diag).toBeDefined();
  });
  it('does NOT flag console.log()', () => {
    expect(scriptDiagnostics('console.log("hello")').filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });
  it('does NOT flag locally-declared variable', () => {
    const code = 'const myTable = base.getTable("X");\nmyTable.selectRecordsAsync({})';
    expect(scriptDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });
});
```

---

### `packages/extension/syntaxes/airtable-script.tmLanguage.json` (config)

**Analog:** `packages/extension/syntaxes/airtable-formula.tmLanguage.json` (header shape from lines 1-10 only)

**CRITICAL:** Do NOT copy the formula grammar's `repository` section. Create from scratch with `source.js` delegation only (RESEARCH.md Pattern 6):

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

No `repository` key. No custom rules. The formula analog's `"include": "#comments"` patterns are formula-specific and must NOT appear here.

---

### `packages/extension/language-configuration/airtable-script-language-configuration.json` (config)

**Analog:** `packages/extension/language-configuration/airtable-formula-language-configuration.json` (all 86 lines)

**Copy analog structure, apply three changes:**

1. Replace `indentationRules` (analog lines 13-18) with JS brace-based rules:
```json
"indentationRules": {
  "increaseIndentPattern": "^\\s*[^\\s].*[{(\\[]\\s*$",
  "decreaseIndentPattern": "^\\s*[}\\])]"
},
```

2. Add backtick auto-closing pair to `autoClosingPairs` array:
```json
{ "open": "`", "close": "`", "notIn": ["string", "comment"] }
```

3. Add backtick surrounding pair to `surroundingPairs` array:
```json
["`", "`"]
```

Remove the `folding.markers` section (analog lines 14-20) — paren-based folding is formula-specific; JS folding is handled by the embedded grammar.

---

### `packages/extension/icons/script-light.svg` and `script-dark.svg` (config)

**Analog:** `packages/extension/icons/formula-light.svg` (all 4 lines)

Analog content:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#1976D2"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="white" text-anchor="middle">f</text>
</svg>
```

Script placeholder: same SVG structure, change fill color and letter. Suggested: `#388E3C` (green) for light, `#2E7D32` for dark, text content `S`. User swaps final artwork when ready.

---

### `packages/language-services/src/index.ts` (modify, config)

**Analog:** current file (lines 1-2)

**Current content:**
```typescript
export * from './types.js';
export * from './engines/formula/index.js';
```

**After modification (add line 3):**
```typescript
export * from './types.js';
export * from './engines/formula/index.js';
export * from './engines/script/index.js';
```

---

### `packages/extension/src/language/registration.ts` (modify, middleware)

**Analog:** current file (all 57 lines)

**New imports** (add to existing import block at lines 1-6):
```typescript
import { AirtableScriptDiagnosticsProvider } from './script/script-diagnostics';
import { AirtableScriptCompletionProvider } from './script/script-completions';
import { AirtableScriptHoverProvider } from './script/script-hover';
```

**Append after line 56** (after the existing `vscode.workspace.textDocuments.forEach` for formula), following the exact lifecycle pattern of the formula block (lines 10-56):
```typescript
// Script providers — same lifecycle pattern as formula providers above
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
    vscode.languages.registerHoverProvider(
        'airtable-script',
        new AirtableScriptHoverProvider()
    ),
    vscode.languages.registerCompletionItemProvider(
        'airtable-script',
        new AirtableScriptCompletionProvider(),
        '.'   // dot trigger for method completions
    ),
);

vscode.workspace.textDocuments.forEach((document) => {
    if (document.languageId === 'airtable-script') {
        scriptDiagnosticsProvider.updateDiagnostics(document);
    }
});
```

**Trigger character difference:** Formula registration uses `'(', '{', "'", '"'` as triggers (line 47). Script registration uses `'.'` only — dot-trigger for method completions. Top-level global completions fire on any keystroke without a special trigger.

---

### `packages/extension/package.json` (modify, config)

**Analog:** existing `contributes.languages[0]` entry (lines 58-75) and `contributes.grammars[0]` entry (lines 78-82)

**Add to `contributes.languages[]` array** after the existing airtable-formula entry:
```json
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
```

**Add to `contributes.grammars[]` array** after the existing airtable-formula entry:
```json
{
  "language": "airtable-script",
  "scopeName": "source.airtable-script",
  "path": "./syntaxes/airtable-script.tmLanguage.json",
  "embeddedLanguages": {
    "source.airtable-script": "javascript"
  }
}
```

`embeddedLanguages` is absent from the formula grammar entry but required here — tells VS Code to use JavaScript bracket matching for the embedded scope (RESEARCH.md Pattern 7).

---

## Shared Patterns

### DiagnosticCollection Lifecycle (D-03 from Phase 2)

**Source:** `packages/extension/src/language/formula/formula-diagnostics.ts` lines 5-9
**Apply to:** `script-diagnostics.ts`

```typescript
// CORRECT: instance field, not module-level singleton
constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-script');
}
```

### Type Conversion (no vscode in engine layer)

**Source:** `packages/extension/src/language/convert.ts`
**Apply to:** All three script wrapper classes

Converters already implemented — import path from script wrappers is `'../convert'`:
- `toLsPosition(pos: vscode.Position): LsPosition` — line 4
- `toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic` — line 20 (direct severity cast, D-09)
- `toVscodeCompletionItem(item: LsCompletionItem): vscode.CompletionItem` — line 50 (SnippetString for insertText)
- `toVscodeHover(h: LsHover): vscode.Hover` — line 43

### LsSeverity Numeric Parity (D-09 from Phase 1)

**Source:** `packages/language-services/src/types.ts` lines 62-68
**Apply to:** `engines/script/diagnostics.ts`

```typescript
// LsSeverity.Warning = 1  maps directly to  vscode.DiagnosticSeverity.Warning = 1
// Both SCRIPT-04 and SCRIPT-05 use: severity: LsSeverity.Warning
```

### Pure Function API Shape (D-09 from Phase 2)

**Source:** formula analog main exports — `diagnostics.ts` line 550, `completions.ts` line 21, `hover.ts` line 105
**Apply to:** All three script engine files

```typescript
// All engine functions are stateless — no class, no state, no vscode imports
export function scriptDiagnostics(text: string, uri?: string): LsDiagnostic[]
export function scriptCompletions(text: string, pos: LsPosition): LsCompletionItem[]
export function scriptHover(text: string, pos: LsPosition): LsHover | null
```

### Position Helper Functions

**Source:** `packages/language-services/src/engines/formula/hover.ts` lines 17-57; `diagnostics.ts` lines 24-38
**Apply to:** `engines/script/diagnostics.ts`, `engines/script/completions.ts`, `engines/script/hover.ts`

Copy `positionToOffset`, `offsetToPosition`, `makeRange`, `extractWordAt` verbatim. These have no formula-specific logic.

### Exclusion Ranges Pattern

**Source:** `packages/language-services/src/engines/formula/diagnostics.ts` lines 44-91
**Apply to:** `engines/script/diagnostics.ts`

Copy `getExclusionRanges` and `isInsideExclusionRange` verbatim, then add template-literal exclusion for backtick strings that the formula engine does not need.

### Test File Structure

**Source:** `packages/language-services/src/test/formula/` (all 4 test files)
**Apply to:** `packages/language-services/src/test/script/` (all 4 test files)

Identical skeleton:
- `import { describe, it, expect } from 'vitest';`
- Import engine exports from `'../../engines/script/index.js'`
- Import `LsSeverity` / `LsCompletionItemKind` from `'../../index.js'`
- `describe` blocks per feature, `it` blocks per acceptance criterion from REQUIREMENTS.md

---

## No Analog Found

All 19 files have close analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `packages/language-services/src/engines/formula/`, `packages/extension/src/language/formula/`, `packages/language-services/src/test/formula/`, `packages/extension/syntaxes/`, `packages/extension/language-configuration/`, `packages/extension/icons/`
**Files scanned:** 14 source files read directly
**Pattern extraction date:** 2026-05-13
