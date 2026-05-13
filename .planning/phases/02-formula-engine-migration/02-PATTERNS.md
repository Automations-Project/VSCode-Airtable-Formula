# Phase 2: Formula Engine Migration - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 18 (6 new engine files, 4 new wrapper files, 5 test files, 2 modified existing files, 1 modified package.json)
**Analogs found:** 15 / 18

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/language-services/src/engines/formula/registry.ts` | utility | transform | `packages/extension/src/functions.ts` | exact |
| `packages/language-services/src/engines/formula/diagnostics.ts` | service | request-response | `packages/extension/src/diagnostics.ts` | exact |
| `packages/language-services/src/engines/formula/completions.ts` | service | request-response | `packages/extension/src/completions.ts` | exact |
| `packages/language-services/src/engines/formula/hover.ts` | service | request-response | `packages/extension/src/hover.ts` | exact |
| `packages/language-services/src/engines/formula/signature.ts` | service | request-response | `packages/extension/src/signature.ts` | exact |
| `packages/language-services/src/engines/formula/index.ts` | config | transform | `packages/language-services/src/index.ts` | role-match |
| `packages/extension/src/language/formula/formula-diagnostics.ts` | middleware | request-response | `packages/extension/src/diagnostics.ts` | role-match |
| `packages/extension/src/language/formula/formula-completions.ts` | middleware | request-response | `packages/extension/src/completions.ts` | role-match |
| `packages/extension/src/language/formula/formula-hover.ts` | middleware | request-response | `packages/extension/src/hover.ts` | role-match |
| `packages/extension/src/language/formula/formula-signature.ts` | middleware | request-response | `packages/extension/src/signature.ts` | role-match |
| `packages/language-services/src/test/formula/registry.test.ts` | test | transform | `packages/language-services/src/test/types.test.ts` | exact |
| `packages/language-services/src/test/formula/diagnostics.test.ts` | test | request-response | `packages/language-services/src/test/types.test.ts` | role-match |
| `packages/language-services/src/test/formula/completions.test.ts` | test | request-response | `packages/language-services/src/test/types.test.ts` | role-match |
| `packages/language-services/src/test/formula/hover.test.ts` | test | request-response | `packages/language-services/src/test/types.test.ts` | role-match |
| `packages/language-services/src/test/formula/signature.test.ts` | test | request-response | `packages/language-services/src/test/types.test.ts` | role-match |
| `packages/language-services/src/types.ts` (modify) | model | transform | self (extend) | exact |
| `packages/extension/src/language/convert.ts` (modify) | utility | transform | self (extend) | exact |
| `packages/extension/package.json` (modify) | config | — | no code analog | no-analog |

---

## Pattern Assignments

### `packages/language-services/src/engines/formula/registry.ts` (utility, transform)

**Analog:** `packages/extension/src/functions.ts` (full source — migrate verbatim with gap fixes)

**Imports pattern** (functions.ts lines 1-20 — no imports, pure data module):
```typescript
// No imports needed — pure data + helper functions

export interface FunctionInfo {
    signature: string;
    description: string;
    category: FunctionCategory;
}

export type FunctionCategory =
    | 'Text'
    | 'Numeric'
    | 'Date/Time'
    | 'Logical'
    | 'Array'
    | 'Regex'
    | 'Record'
    | 'Misc';
```

**Core registry opening shape** (functions.ts lines 25-27):
```typescript
export const FUNCTION_REGISTRY: Record<string, FunctionInfo> = {
    'CONCATENATE': { signature: 'CONCATENATE(text1, text2, ...)', description: 'Joins together two or more text strings into one', category: 'Text' },
    // ... all entries verbatim from functions.ts ...
};
```

**Gap changes to apply during migration (per RESEARCH.md D-05/D-06 gap analysis):**
- ADD `'TRUE': { signature: 'TRUE()', description: 'Returns boolean true (1). Can be used with or without parentheses.', category: 'Logical' }`
- ADD `'FALSE': { signature: 'FALSE()', description: 'Returns boolean false (0). Can be used with or without parentheses.', category: 'Logical' }`
- REMOVE `LOG10`, `TEXT`, `AUTONUMBER`, `CREATED_BY`, `LAST_MODIFIED_BY` from registry
- KEEP `DATEDIF` as legacy

**CALLABLE_CONSTANTS — use diagnostics.ts line 43 version (more correct than functions.ts):**
```typescript
export const CALLABLE_CONSTANTS = ['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE'] as const;
```

**Helper exports** (functions.ts already has `ALL_FUNCTION_NAMES`, `ALL_CALLABLE` etc — add explicit exports):
```typescript
export const ALL_FUNCTION_NAMES = Object.keys(FUNCTION_REGISTRY);
export const ALL_CALLABLE = [...new Set([...ALL_FUNCTION_NAMES, ...CALLABLE_CONSTANTS])];

export function getFunctionsByCategory(category: FunctionCategory): string[] {
    return ALL_FUNCTION_NAMES.filter(name => FUNCTION_REGISTRY[name].category === category);
}
export function isValidCallable(name: string): boolean {
    return ALL_CALLABLE.includes(name);
}
export function getFunctionInfo(name: string): FunctionInfo | undefined {
    return FUNCTION_REGISTRY[name];
}
```

**COMMON_TYPOS and SMART_QUOTES** (migrate from diagnostics.ts lines 49-73):
```typescript
export const SMART_QUOTES: Record<string, string> = {
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
};

export const COMMON_TYPOS: Record<string, string> = {
    'CONCATINATE': 'CONCATENATE',
    'CONCATNATE': 'CONCATENATE',
    'SUBSTITUDE': 'SUBSTITUTE',
    'SUBSTUTE': 'SUBSTITUTE',
    'SUMIF': 'SUM (SUMIF not available)',
    'COUNTIF': 'COUNT (COUNTIF not available)',
    'VLOOKUP': 'linked records (VLOOKUP not available)',
    'HLOOKUP': 'linked records (HLOOKUP not available)',
    'INDEX': 'ARRAYSLICE',
    'IFERROR': 'IF(ISERROR(...), ...)',
    'ISBLANK': 'IF({Field}, FALSE, TRUE)',
    'DATEVALUE': 'DATETIME_PARSE',
    'TIMEVALUE': 'DATETIME_PARSE',
    'DATEDIFF': 'DATETIME_DIFF',
    'CONCAT': 'CONCATENATE or &',
};
```

---

### `packages/language-services/src/engines/formula/diagnostics.ts` (service, request-response)

**Analog:** `packages/extension/src/diagnostics.ts` (713 lines — strip all VS Code API, keep logic)

**Imports pattern** (new file — zero vscode imports):
```typescript
import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
import {
    ALL_FUNCTION_NAMES, ALL_CALLABLE, CALLABLE_CONSTANTS,
    SMART_QUOTES, COMMON_TYPOS, FUNCTION_REGISTRY
} from './registry.js';
```

**Core function signature** (D-09 from CONTEXT.md):
```typescript
export function formulaDiagnostics(text: string, uri?: string): LsDiagnostic[] {
    const diagnostics: LsDiagnostic[] = [];
    diagnostics.push(...checkComments(text));
    diagnostics.push(...checkParentheses(text, uri));
    diagnostics.push(...checkBrackets(text, uri));
    diagnostics.push(...checkQuotes(text));
    diagnostics.push(...checkFunctions(text));
    // checkFieldReferences intentionally disabled — {} valid in JSON output
    diagnostics.push(...checkSmartQuotes(text));
    diagnostics.push(...checkCommonTypos(text));
    diagnostics.push(...checkDivisionByZero(text));
    diagnostics.push(...checkNestedIfs(text));
    diagnostics.push(...checkTrailingOperators(text));
    return diagnostics;
}
```

**Position-from-offset helper** (replaces all `document.positionAt(offset)` calls in diagnostics.ts):
```typescript
// Pure string version of document.positionAt() — no VS Code API
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

**Check function migration pattern** (diagnostics.ts lines 108-147 — private method → module-level function):
```typescript
// Before (diagnostics.ts): private checkComments(document, text): vscode.Diagnostic[]
// After (engine): function checkComments(text: string): LsDiagnostic[]
function checkComments(text: string): LsDiagnostic[] {
    const diagnostics: LsDiagnostic[] = [];
    const singleLineCommentRegex = /\/\/.*/g;
    let match;
    while ((match = singleLineCommentRegex.exec(text)) !== null) {
        diagnostics.push({
            range: makeRange(text, match.index, match.index + match[0].length),
            message: 'Comments are not allowed in Airtable formulas.',
            severity: LsSeverity.Warning,
            code: 'no-comments',
            source: 'airtable-formula',
        });
    }
    return diagnostics;
}
```

**relatedInformation pattern for checkParentheses** (WR-02 fix — diagnostics.ts lines 149-220):
```typescript
// uri param threads through from the wrapper class (document.uri.toString())
function checkParentheses(text: string, uri?: string): LsDiagnostic[] {
    // ... migrate stack-based checker from diagnostics.ts lines 149-220 ...
    // When emitting relatedInformation on unclosed paren diag:
    const diag: LsDiagnostic = {
        range: makeRange(text, endOffset, endOffset),
        message: 'Unclosed parenthesis',
        severity: LsSeverity.Error,
    };
    if (uri) {
        diag.relatedInformation = [{
            location: { uri, range: makeRange(text, openPos, openPos + 1) },
            message: 'Opening parenthesis is here',
        }];
    }
    return diagnostics;
}
```

---

### `packages/language-services/src/engines/formula/completions.ts` (service, request-response)

**Analog:** `packages/extension/src/completions.ts` lines 452-496 (provider method logic)

**Imports pattern**:
```typescript
import type { LsCompletionItem, LsPosition } from '../../types.js';
import { LsCompletionItemKind } from '../../types.js';
import { FUNCTION_REGISTRY, CALLABLE_CONSTANTS } from './registry.js';
```

**Core function pattern** (D-06: no separate FUNCTION_SIGNATURES data structure):
```typescript
export function formulaCompletions(text: string, pos: LsPosition): LsCompletionItem[] {
    const items: LsCompletionItem[] = [];

    // Function completions derived from registry (replaces FUNCTION_SIGNATURES parallel structure)
    // Source pattern: completions.ts lines 464-470
    for (const [name, info] of Object.entries(FUNCTION_REGISTRY)) {
        items.push({
            label: name,
            kind: LsCompletionItemKind.Function,
            detail: info.category,
            documentation: { kind: 'markdown', value: `**${info.signature}**\n\n${info.description}` },
            insertText: `${name}($0)`,  // single tab stop — Pitfall 4: do NOT expand to multi-stop
        });
    }

    // Callable constants (completions.ts lines 473-478)
    for (const c of CALLABLE_CONSTANTS) {
        items.push({
            label: c,
            kind: LsCompletionItemKind.Constant,
            insertText: c,
        });
    }

    // Date unit string completions (completions.ts lines 481-492)
    for (const unit of ['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds']) {
        items.push({
            label: `'${unit}'`,
            kind: LsCompletionItemKind.Value,
            detail: 'Date/Time unit',
            insertText: `'${unit}'`,
        });
    }

    return items;
}
```

---

### `packages/language-services/src/engines/formula/hover.ts` (service, request-response)

**Analog:** `packages/extension/src/hover.ts` (81 lines — full file)

**Imports pattern** (no vscode):
```typescript
import type { LsHover, LsRange, LsPosition } from '../../types.js';
import { FUNCTION_REGISTRY, CALLABLE_CONSTANTS, type FunctionInfo } from './registry.js';
```

**Word-at-position helper** (replaces `document.getWordRangeAtPosition` — hover.ts lines 16-21):
```typescript
// Pure string version of getWordRangeAtPosition
function extractWordAt(text: string, offset: number): { word: string; start: number; end: number } | null {
    const pattern = /[A-Z_][A-Z0-9_]*/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index <= offset && offset <= match.index + match[0].length) {
            return { word: match[0], start: match.index, end: match.index + match[0].length };
        }
    }
    return null;
}
```

**Core function pattern** (hover.ts provideHover lines 9-46 → pure function):
```typescript
export function formulaHover(text: string, pos: LsPosition): LsHover | null {
    const offset = positionToOffset(text, pos);
    const wordMatch = extractWordAt(text, offset);
    if (!wordMatch) return null;

    const word = wordMatch.word.toUpperCase();
    const range: LsRange = {
        start: offsetToPosition(text, wordMatch.start),
        end: offsetToPosition(text, wordMatch.end),
    };

    const funcInfo = FUNCTION_REGISTRY[word];
    if (funcInfo) {
        return createFunctionHover(word, funcInfo, range);
    }

    if ((CALLABLE_CONSTANTS as readonly string[]).includes(word)) {
        return {
            contents: { kind: 'markdown', value: `**${word}**\n\nBoolean constant representing ${word.toLowerCase()}.` },
            range,
        };
    }

    return null;
}
```

**createFunctionHover** (hover.ts lines 48-66 — replaces vscode.MarkdownString with plain string building):
```typescript
// hover.ts getCategoryEmoji map (lines 68-80) migrates verbatim
function getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
        'Text': '📝', 'Numeric': '🔢', 'Date/Time': '📅', 'Logical': '🔀',
        'Array': '📋', 'Regex': '🔍', 'Record': '📄', 'Misc': '🔧'
    };
    return emojis[category] || '📦';
}

function createFunctionHover(name: string, info: FunctionInfo, range: LsRange): LsHover {
    const value = [
        '```airtable-formula',
        info.signature,
        '```',
        '',
        info.description,
        '',
        `${getCategoryEmoji(info.category)} **${info.category}**`,
    ].join('\n');
    return { contents: { kind: 'markdown', value }, range };
}
```

---

### `packages/language-services/src/engines/formula/signature.ts` (service, request-response)

**Analog:** `packages/extension/src/signature.ts` (218 lines)

**Imports pattern**:
```typescript
import type { LsSignatureHelp, LsPosition } from '../../types.js';
import { FUNCTION_REGISTRY } from './registry.js';
```

**Core function pattern** (signature.ts provideSignatureHelp lines 9-61 → pure function):
```typescript
export function formulaSignatureHelp(text: string, pos: LsPosition): LsSignatureHelp | null {
    const offset = positionToOffset(text, pos);
    const textToCursor = text.substring(0, offset);

    const funcContext = findFunctionContext(textToCursor);
    if (!funcContext) return null;

    const funcInfo = FUNCTION_REGISTRY[funcContext.functionName.toUpperCase()];
    if (!funcInfo) return null;

    const params = parseParameters(funcInfo.signature);
    const clampedIndex = Math.min(funcContext.parameterIndex, params.length - 1);
    const lastParam = params[params.length - 1];
    const activeParameter = (lastParam?.name.includes('...') && funcContext.parameterIndex >= params.length - 1)
        ? params.length - 1
        : clampedIndex;

    return {
        signatures: [{
            label: funcInfo.signature,
            documentation: funcInfo.description,
            parameters: params.map(p => ({
                label: p.name,
                documentation: getParameterDescription(funcContext.functionName, p.name),
            })),
        }],
        activeSignature: 0,
        activeParameter,
    };
}
```

**findFunctionContext** (signature.ts lines 66-110 — already operates on string, migrate verbatim):
```typescript
// signature.ts lines 66-110 already take text string; no document API used.
// The only change: accept textToCursor directly instead of computing inside via document.getText(range)
function findFunctionContext(textToCursor: string): { functionName: string; parameterIndex: number } | null {
    let depth = 0;
    let parameterIndex = 0;
    let functionStart = -1;

    for (let i = textToCursor.length - 1; i >= 0; i--) {
        const char = textToCursor[i];
        if (char === ')') { depth++; }
        else if (char === '(') {
            if (depth === 0) { functionStart = i; break; }
            depth--;
        } else if (char === ',' && depth === 0) {
            parameterIndex++;
        }
    }

    if (functionStart === -1) return null;

    const beforeParen = textToCursor.substring(0, functionStart);
    const match = beforeParen.match(/([A-Z_][A-Z0-9_]*)\s*$/i);
    if (!match) return null;

    return { functionName: match[1], parameterIndex };
}
```

**parseParameters** (signature.ts lines 115-132 — pure string, migrate verbatim):
```typescript
function parseParameters(signature: string): Array<{ name: string; optional: boolean }> {
    const match = signature.match(/\(([^)]*)\)/);
    if (!match) return [];
    const paramsStr = match[1];
    if (!paramsStr.trim()) return [];
    return paramsStr.split(',').map(param => {
        const trimmed = param.trim();
        const optional = trimmed.startsWith('[') || trimmed.includes('...');
        const name = trimmed.replace(/[\[\]]/g, '').trim();
        return { name, optional };
    });
}
```

**getParameterDescription** (signature.ts lines 137-217 — pure Record lookup, migrate verbatim):
```typescript
// signature.ts lines 138-217: entire per-function descriptions Record migrates as-is
function getParameterDescription(functionName: string, paramName: string): string {
    // copy the full descriptions object from signature.ts lines 138-200
    // ... then the lookup logic at lines 202-216 ...
}
```

---

### `packages/language-services/src/engines/formula/index.ts` (config, transform)

**Analog:** `packages/language-services/src/index.ts` line 1 (re-export pattern)

```typescript
// Same barrel re-export pattern as packages/language-services/src/index.ts line 1
export * from './registry.js';
export * from './diagnostics.js';
export * from './completions.js';
export * from './hover.js';
export * from './signature.js';
```

---

### `packages/extension/src/language/formula/formula-diagnostics.ts` (middleware, request-response)

**Analog:** `packages/extension/src/diagnostics.ts` (class shape) + RESEARCH.md Pattern 3

**Full wrapper class** (D-02, D-03):
```typescript
import * as vscode from 'vscode';
import { formulaDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableFormulaDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        // D-03: collection lives on instance, not module-level singleton
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-formula');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-formula') return;
        const lsDiags = formulaDiagnostics(document.getText(), document.uri.toString());
        this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

---

### `packages/extension/src/language/formula/formula-completions.ts` (middleware, request-response)

**Analog:** `packages/extension/src/completions.ts` class shape (lines 452-496)

```typescript
import * as vscode from 'vscode';
import { formulaCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';

export class AirtableFormulaCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const lsItems = formulaCompletions(document.getText(), toLsPosition(position));
        return lsItems.map(toVscodeCompletionItem);
    }
}
```

---

### `packages/extension/src/language/formula/formula-hover.ts` (middleware, request-response)

**Analog:** `packages/extension/src/hover.ts` class shape (lines 7-46)

```typescript
import * as vscode from 'vscode';
import { formulaHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';

export class AirtableFormulaHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const lsHover = formulaHover(document.getText(), toLsPosition(position));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
```

---

### `packages/extension/src/language/formula/formula-signature.ts` (middleware, request-response)

**Analog:** `packages/extension/src/signature.ts` class shape (lines 7-61)

```typescript
import * as vscode from 'vscode';
import { formulaSignatureHelp } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeSignatureHelp } from '../convert';

export class AirtableFormulaSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.SignatureHelp | null {
        const lsHelp = formulaSignatureHelp(document.getText(), toLsPosition(position));
        return lsHelp ? toVscodeSignatureHelp(lsHelp) : null;
    }
}
```

---

### Test Files (all 5)

**Analog:** `packages/language-services/src/test/types.test.ts` (full file — exact structure to copy)

**Import pattern** (types.test.ts lines 1-12):
```typescript
import { describe, it, expect } from 'vitest';
// types.test.ts imports from '../index.js' — engine tests import from '../../engines/formula/index.js'
import { formulaDiagnostics } from '../../engines/formula/index.js';
import { LsSeverity, LsCompletionItemKind } from '../../index.js';
```

**Test structure pattern** (types.test.ts lines 14-79 — describe/it/expect blocks):
```typescript
describe('formulaDiagnostics', () => {
    it('behavior description', () => {
        // arrange
        const result = formulaDiagnostics('input');
        // assert
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('unknown-function');
    });
});
```

**registry.test.ts key behaviors:**
- `FUNCTION_REGISTRY['IF']` is defined
- `FUNCTION_REGISTRY['TRUE']` and `['FALSE']` are defined (gap fix)
- `CALLABLE_CONSTANTS` contains `'TRUE'` and `'FALSE'`
- `isValidCallable('IF')` returns true
- `getFunctionsByCategory('Text')` contains `'CONCATENATE'`

**diagnostics.test.ts key behaviors (D-14):**
- Unknown function `NOTAFUNC(1)` produces diagnostic with `code === 'unknown-function'`
- `IF({x}, TRUE, FALSE)` produces zero `missing-function-parenthesis` diagnostics (Pitfall 3)
- `VLOOKUP(x)` produces diagnostic with `code === 'common-typo'`
- `IF(1, 2, 3) // comment` produces `code === 'no-comments'`
- Result shape: `d.range.start` has `line` and `character` properties

**completions.test.ts key behaviors:**
- Results contain `IF`, `AND`, `OR` (Function kind = 2)
- `TRUE` item has kind `LsCompletionItemKind.Constant` (= 20)
- `'days'` item has kind `LsCompletionItemKind.Value` (= 11)
- IF item `insertText` equals `'IF($0)'`

**hover.test.ts key behaviors:**
- Cursor on `'I'` in `'IF(1, 2, 3)'` returns non-null with `contents.kind === 'markdown'`
- Cursor on unknown identifier returns null
- Cursor on `TRUE` in `'IF({x}, TRUE, FALSE)'` returns non-null hover

**signature.test.ts key behaviors (findFunctionContext is most complex):**
- `'IF('` at char 3: `activeParameter === 0`
- `'IF(1, '` at char 6: `activeParameter === 1`
- `'IF(1, 2, 3)'` after closing `)`: returns null (outside call)
- `'IF('` result: `signatures[0].label` contains `'IF('`

---

## Shared Patterns

### Pattern A: positionToOffset Helper
**Apply to:** `engines/formula/diagnostics.ts`, `engines/formula/hover.ts`, `engines/formula/signature.ts`
**Source:** Pattern 2 from RESEARCH.md (standard LSP pattern; no existing codebase analog)

```typescript
function positionToOffset(text: string, pos: { line: number; character: number }): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for \n
    }
    return offset + pos.character;
}
```

Extract to `engines/formula/utils.ts` if needed by 3+ engine files, or inline per file — Claude's discretion.

### Pattern B: No vscode Import in Engine Files
**Apply to:** All files under `packages/language-services/src/engines/formula/`
**Source:** Anti-pattern list from RESEARCH.md

Any `import * as vscode` or `from 'vscode'` inside `language-services/engines/` causes a build error (language-services tsconfig has no vscode in lib). All VS Code types stay in wrapper files only.

### Pattern C: Thin Wrapper Delegation
**Apply to:** All 4 files in `packages/extension/src/language/formula/`
**Source:** RESEARCH.md Pattern 3; `src/mcp/`, `src/auto-config/`, `src/skills/` subsystem pattern

The formula wrapper files follow the same subsystem-in-subdirectory pattern. Each wrapper:
1. Imports the pure engine function from `@airtable-formula/language-services`
2. Imports converters from `../convert`
3. `provide*()` is a one-liner: call engine → convert → return

### Pattern D: convert.ts Additions and Fixes

**Source:** `packages/extension/src/language/convert.ts` (current 35-line file)

**WR-01: toVscodeHover fix** (convert.ts lines 32-35 — current code always creates MarkdownString):
```typescript
// BEFORE (line 33 — ignores kind):
const contents = new vscode.MarkdownString(h.contents.value);

// AFTER:
export function toVscodeHover(h: LsHover): vscode.Hover {
    const content = h.contents.kind === 'plaintext'
        ? h.contents.value
        : new vscode.MarkdownString(h.contents.value);
    return new vscode.Hover(content, h.range ? toVscodeRange(h.range) : undefined);
}
```

**WR-02: toVscodeDiagnostic relatedInformation** (add after convert.ts line 29):
```typescript
if (d.relatedInformation) {
    diag.relatedInformation = d.relatedInformation.map(ri =>
        new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
                vscode.Uri.parse(ri.location.uri),
                toVscodeRange(ri.location.range)
            ),
            ri.message
        )
    );
}
```

**New: toVscodeCompletionItem** (add to convert.ts, following D-09 direct-cast pattern):
```typescript
import type { LsCompletionItem } from '@airtable-formula/language-services';

export function toVscodeCompletionItem(item: LsCompletionItem): vscode.CompletionItem {
    const vsItem = new vscode.CompletionItem(
        item.label,
        item.kind as unknown as vscode.CompletionItemKind  // D-09: direct cast, numeric parity
    );
    if (item.insertText !== undefined) {
        vsItem.insertText = new vscode.SnippetString(item.insertText);
    }
    if (item.detail !== undefined) { vsItem.detail = item.detail; }
    if (item.documentation !== undefined) {
        vsItem.documentation = typeof item.documentation === 'string'
            ? item.documentation
            : new vscode.MarkdownString(item.documentation.value);
    }
    if (item.filterText !== undefined) { vsItem.filterText = item.filterText; }
    if (item.sortText !== undefined) { vsItem.sortText = item.sortText; }
    return vsItem;
}
```

**New: toVscodeSignatureHelp** (add to convert.ts — RESEARCH.md Pattern 4, verified from @types/vscode):
```typescript
import type { LsSignatureHelp } from '@airtable-formula/language-services';

export function toVscodeSignatureHelp(sh: LsSignatureHelp): vscode.SignatureHelp {
    const help = new vscode.SignatureHelp();
    help.signatures = sh.signatures.map(sig => {
        const vsSig = new vscode.SignatureInformation(
            sig.label,
            sig.documentation ? new vscode.MarkdownString(sig.documentation) : undefined
        );
        vsSig.parameters = sig.parameters.map(p =>
            new vscode.ParameterInformation(p.label, p.documentation)
        );
        return vsSig;
    });
    help.activeSignature = sh.activeSignature;
    help.activeParameter = sh.activeParameter;
    return help;
}
```

### Pattern E: types.ts Extension (LsSignatureHelp — D-11)
**Source:** `packages/language-services/src/types.ts` (current file to extend at line 43)

```typescript
// Add after LsHover definition (line 42) in types.ts:
export interface LsParameterInformation {
    label: string;
    documentation?: string;
}

export interface LsSignatureInformation {
    label: string;
    documentation?: string;
    parameters: LsParameterInformation[];
}

export interface LsSignatureHelp {
    signatures: LsSignatureInformation[];
    activeSignature: number;
    activeParameter: number;
}
```

### Pattern F: registration.ts Import Update
**Source:** `packages/extension/src/language/registration.ts` lines 2-5 (exact current text)

```typescript
// BEFORE (registration.ts lines 2-5):
import { AirtableFormulaDiagnosticsProvider } from '../diagnostics';
import { AirtableFormulaCompletionProvider } from '../completions';
import { AirtableFormulaHoverProvider } from '../hover';
import { AirtableFormulaSignatureHelpProvider } from '../signature';

// AFTER:
import { AirtableFormulaDiagnosticsProvider } from './formula/formula-diagnostics';
import { AirtableFormulaCompletionProvider } from './formula/formula-completions';
import { AirtableFormulaHoverProvider } from './formula/formula-hover';
import { AirtableFormulaSignatureHelpProvider } from './formula/formula-signature';
```

### Pattern G: codeActions.ts Import Update (D-04)
**Source:** `packages/extension/src/codeActions.ts` line 2

```typescript
// BEFORE (codeActions.ts line 2):
import { ALL_CALLABLE, FUNCTION_REGISTRY } from './functions';

// AFTER:
import { ALL_CALLABLE, FUNCTION_REGISTRY } from '@airtable-formula/language-services';
```

### Pattern H: language-services index.ts Extension
**Source:** `packages/language-services/src/index.ts` line 1

```typescript
// BEFORE:
export * from './types.js';

// AFTER (add line 2):
export * from './types.js';
export * from './engines/formula/index.js';
```

### Pattern I: WR-04 package.json exports condition ordering
**Source:** `packages/language-services/package.json` lines 9-13

```json
// BEFORE (types last):
".": {
  "import": "./dist/index.js",
  "require": "./dist/index.cjs",
  "types": "./dist/index.d.ts"
}

// AFTER (types first — TypeScript resolver finds types before runtime modules):
".": {
  "types": "./dist/index.d.ts",
  "import": "./dist/index.js",
  "require": "./dist/index.cjs"
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/extension/package.json` (icon + .fx) | config | — | Declarative JSON; no code analog. Use syntax from RESEARCH.md VS Code Icon section |
| `packages/extension/icons/formula-light.svg` | config | — | No SVG files exist in project. Use placeholder from RESEARCH.md Code Examples |
| `packages/extension/icons/formula-dark.svg` | config | — | Same |

**package.json languages entry exact change** (current lines 58-70 → replace with):
```json
{
  "id": "airtable-formula",
  "aliases": ["Airtable Formula", "formula"],
  "extensions": [".formula", ".min.formula", ".ultra-min.formula", ".fx"],
  "configuration": "./language-configuration/airtable-formula-language-configuration.json",
  "icon": {
    "light": "./icons/formula-light.svg",
    "dark": "./icons/formula-dark.svg"
  }
}
```

---

## Metadata

**Analog search scope:** `packages/extension/src/`, `packages/language-services/src/`
**Files scanned:** 12 source files read directly
**Pattern extraction date:** 2026-05-13
