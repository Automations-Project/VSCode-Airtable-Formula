# Phase 1: Language Services Scaffold - Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 9 (7 new, 2 modified)
**Analogs found:** 8 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/language-services/package.json` | config | transform | `packages/shared/package.json` | exact (copy + extend) |
| `packages/language-services/tsconfig.json` | config | transform | `packages/shared/tsconfig.json` | exact (verbatim copy) |
| `packages/language-services/src/index.ts` | utility | transform | `packages/shared/src/index.ts` | exact (barrel re-export) |
| `packages/language-services/src/types.ts` | model | transform | `packages/shared/src/types.ts` | role-match (same TS interface/enum pattern) |
| `packages/extension/src/language/registration.ts` | provider | request-response | `packages/extension/src/mcp/registration.ts` | role-match (subsystem registration pattern) |
| `packages/extension/src/language/convert.ts` | utility | transform | `packages/extension/src/mcp/registration.ts` | partial (vscode boundary layer) |
| `packages/extension/src/extension.ts` (MODIFIED) | provider | request-response | self | self |
| `package.json` (root, MODIFIED) | config | transform | self | self |
| `packages/extension/package.json` (MODIFIED) | config | transform | self (existing `dependencies` block) | self |

---

## Pattern Assignments

### `packages/language-services/package.json` (config, transform)

**Analog:** `packages/shared/package.json` (lines 1–18)

**Full analog** (`packages/shared/package.json` lines 1–18):
```json
{
  "name": "@airtable-formula/shared",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --out-dir dist",
    "test":  "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Required deltas from analog:**

1. Change `name` to `@airtable-formula/language-services`
2. Reset `version` to `1.0.0`
3. Change `"main"` to `"./dist/index.cjs"` (CJS fallback — not the ESM output)
4. Expand `exports` to add a `"require"` condition:
   ```json
   "exports": {
     ".": {
       "import": "./dist/index.js",
       "require": "./dist/index.cjs",
       "types": "./dist/index.d.ts"
     }
   }
   ```
5. Change build script to `"tsup src/index.ts --format cjs,esm --dts --out-dir dist"`

**Critical constraint:** `"main"` must point to `./dist/index.cjs`, not `./dist/index.js`. Extension tests use Node's `require()` which reads `main` as fallback when `exports` is not honoured by older tooling.

---

### `packages/language-services/tsconfig.json` (config, transform)

**Analog:** `packages/shared/tsconfig.json` (lines 1–12) — verbatim copy

**Full analog** (`packages/shared/tsconfig.json` lines 1–12):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**No deltas required.** Copy verbatim. Do NOT use the extension's tsconfig settings (`"module": "ESNext"`, `"moduleResolution": "Bundler"`) — those are for a bundled artifact, not a standalone importable package.

---

### `packages/language-services/src/index.ts` (utility, transform)

**Analog:** `packages/shared/src/index.ts` (line 1–2)

**Full analog** (`packages/shared/src/index.ts` lines 1–2):
```typescript
export * from './types.js';
export * from './messages.js';
```

**Required delta:** Export only types (no messages module in Phase 1):
```typescript
export * from './types.js';
```

Note the `.js` extension on the relative import — required by `"moduleResolution": "NodeNext"`.

---

### `packages/language-services/src/types.ts` (model, transform)

**Analog:** `packages/shared/src/types.ts` (lines 1–60, interface/enum declaration style)

**Interface style pattern** (`packages/shared/src/types.ts` lines 21–53 — representative excerpt):
```typescript
export interface BrowserInfo {
  found:          boolean;
  channel?:       'chrome' | 'msedge' | 'chromium';
  label?:         string;
  downloaded?:    boolean;
  executablePath?: string;
}

export type BrowserDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

export interface BrowserDownloadState {
  status:    BrowserDownloadStatus;
  progress?: number; // 0–100
  error?:    string;
}
```

**Core content to implement** (verbatim from CONTEXT.md decisions D-06 through D-09):
```typescript
export interface LsMarkdownString {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export interface LsPosition { line: number; character: number; }
export interface LsRange { start: LsPosition; end: LsPosition; }

export interface LsDiagnostic {
  range: LsRange;
  message: string;
  severity: LsSeverity;
  code?: string | number;
  source?: string;
  relatedInformation?: Array<{ location: { uri: string; range: LsRange }; message: string; }>;
}

export interface LsCompletionItem {
  label: string;
  kind?: LsCompletionItemKind;
  detail?: string;
  documentation?: string | LsMarkdownString;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  commitCharacters?: string[];
}

export interface LsHover {
  contents: LsMarkdownString;
  range?: LsRange;
}

export const enum LsSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }

// Mirror vscode.CompletionItemKind numeric values exactly (D-09)
// Verified against @types/vscode 1.100.0 in extension devDependencies
export const enum LsCompletionItemKind {
  Text = 0, Method = 1, Function = 2, Constructor = 3, Field = 4,
  Variable = 5, Class = 6, Interface = 7, Module = 8, Property = 9,
  Unit = 10, Value = 11, Enum = 12, Keyword = 13, Snippet = 14,
  Color = 15, File = 16, Reference = 17, Folder = 18, EnumMember = 19,
  Constant = 20, Struct = 21, Event = 22, Operator = 23, TypeParameter = 24,
}
```

**No imports.** This file is a zero-dependency type-only module — no `import` statements. No `vscode` reference anywhere.

---

### `packages/extension/src/language/registration.ts` (provider, request-response)

**Analog:** `packages/extension/src/mcp/registration.ts` (lines 1–99)

**Import pattern** (`packages/extension/src/mcp/registration.ts` lines 1–8):
```typescript
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID, MCP_SERVER_LABEL } from '../constants.js';
import { getBundledServerPath } from './server-path.js';
import type { AuthManager } from './auth-manager.js';
import { getSettings } from '../settings.js';
```

**Subsystem registration function signature pattern** (`packages/extension/src/mcp/registration.ts` lines 24–28):
```typescript
export function registerMcpProvider(
  context: vscode.ExtensionContext,
  onChanged: vscode.EventEmitter<void>,
  authManager?: AuthManager,
): void {
```

Key conventions to mirror:
- `import * as vscode from 'vscode'` (star import, not named)
- Relative imports from sibling subsystem files use `.js` suffix (e.g., `'../constants.js'`, `'./server-path.js'`)
- Export a single named function `register*`
- Function returns `void`; all disposables pushed to `context.subscriptions` internally

**context.subscriptions.push pattern** (`packages/extension/src/mcp/registration.ts` lines 47–98):
```typescript
context.subscriptions.push(
  lmApi.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
    ...
  })
);
```

**Core content to implement** — direct extraction from `extension.ts` lines 183–241 (source of truth, RESEARCH.md Pattern 3):
```typescript
import * as vscode from 'vscode';
import { AirtableFormulaDiagnosticsProvider } from '../diagnostics';
import { AirtableFormulaCompletionProvider } from '../completions';
import { AirtableFormulaHoverProvider } from '../hover';
import { AirtableFormulaSignatureHelpProvider } from '../signature';
import { AirtableFormulaCodeActionProvider } from '../codeActions';

export function registerLanguageProviders(context: vscode.ExtensionContext): void {
    const diagnosticsProvider = new AirtableFormulaDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(event.document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(document);
            }
        }),
        vscode.languages.registerHoverProvider(
            'airtable-formula',
            new AirtableFormulaHoverProvider()
        ),
        vscode.languages.registerSignatureHelpProvider(
            'airtable-formula',
            new AirtableFormulaSignatureHelpProvider(),
            '(', ','
        ),
        vscode.languages.registerCodeActionsProvider(
            'airtable-formula',
            new AirtableFormulaCodeActionProvider(),
            { providedCodeActionKinds: AirtableFormulaCodeActionProvider.providedCodeActionKinds }
        ),
        vscode.languages.registerCompletionItemProvider(
            'airtable-formula',
            new AirtableFormulaCompletionProvider(),
            '(', '{', "'", '"'
        ),
    );

    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-formula') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });
}
```

**Import path note:** Existing `extension.ts` lines 5–9 use bare paths (no `.js`) for same-directory provider imports (`from './diagnostics'`). Since `registration.ts` is in `src/language/` (one level deeper), the relative imports become `'../diagnostics'` etc. The extension uses `"moduleResolution": "Bundler"` which resolves both bare and `.js`-suffixed paths; follow the existing convention of bare paths for same-package sibling imports.

**Do NOT move** `vscode.languages.registerDocumentFormattingEditProvider` (line 243+) or beautify/minify commands. Those stay in `extension.ts`.

---

### `packages/extension/src/language/convert.ts` (utility, transform)

**No direct analog.** Closest is `packages/extension/src/mcp/registration.ts` for the `import * as vscode` and `.js`-suffix-on-subsystem-imports pattern only.

**Import pattern to copy** (from `packages/extension/src/mcp/registration.ts` lines 1–3):
```typescript
import * as vscode from 'vscode';
```

**Core content to implement** (from RESEARCH.md Pattern 4 — verified against `extension.ts` import style):
```typescript
import * as vscode from 'vscode';
import type { LsPosition, LsRange, LsDiagnostic, LsHover } from '@airtable-formula/language-services';
import { LsSeverity } from '@airtable-formula/language-services';

export function toLsPosition(pos: vscode.Position): LsPosition {
    return { line: pos.line, character: pos.character };
}

export function toVscodePosition(pos: LsPosition): vscode.Position {
    return new vscode.Position(pos.line, pos.character);
}

export function toLsRange(range: vscode.Range): LsRange {
    return { start: toLsPosition(range.start), end: toLsPosition(range.end) };
}

export function toVscodeRange(range: LsRange): vscode.Range {
    return new vscode.Range(toVscodePosition(range.start), toVscodePosition(range.end));
}

export function toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic {
    // LsSeverity values mirror vscode.DiagnosticSeverity numerics — direct cast (D-09)
    const diag = new vscode.Diagnostic(
        toVscodeRange(d.range),
        d.message,
        d.severity as unknown as vscode.DiagnosticSeverity
    );
    if (d.code !== undefined) diag.code = d.code;
    if (d.source !== undefined) diag.source = d.source;
    return diag;
}

export function toVscodeHover(h: LsHover): vscode.Hover {
    const contents = new vscode.MarkdownString(h.contents.value);
    return new vscode.Hover(contents, h.range ? toVscodeRange(h.range) : undefined);
}
```

Note: `toVscodeDiagnostic` and `toVscodeHover` are defined but not called in Phase 1 (no engine calls yet). They are safe to include and will be used in Phase 2.

---

### `packages/extension/src/extension.ts` (MODIFIED)

**Source:** self (lines 1–30 and 183–241)

**Import block pattern** (`extension.ts` lines 1–30 — current top-of-file):
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AirtableFormulaDiagnosticsProvider } from './diagnostics';
import { AirtableFormulaCompletionProvider } from './completions';
import { AirtableFormulaHoverProvider } from './hover';
import { AirtableFormulaSignatureHelpProvider } from './signature';
import { AirtableFormulaCodeActionProvider } from './codeActions';
// ...
import { registerMcpProvider } from './mcp/registration.js';
// ...
```

**Changes required:**
1. Add one import (use `.js` suffix — matches pattern for subdirectory module imports): `import { registerLanguageProviders } from './language/registration.js';`
2. Remove imports for the 5 provider classes (lines 5–9) — they move to `registration.ts`
3. Replace lines 183–241 with: `registerLanguageProviders(context);`
4. Lines 243+ (formatter, beautify, minify) remain unchanged

**Import suffix convention confirmed:** `.js` suffix is used for subdirectory imports (`'./mcp/registration.js'`, `'./webview/DashboardProvider.js'`) and bare paths for same-directory imports (`'./diagnostics'`). The new import `'./language/registration.js'` is a subdirectory import — use `.js`.

---

### `package.json` (root, MODIFIED)

**Source:** self (lines 5–9)

**Current scripts** (`package.json` lines 5–9):
```json
"build": "node scripts/check-tool-sync.mjs && pnpm -F shared build && pnpm -F webview build && node scripts/bundle-mcp.mjs && pnpm -F airtable-formula build",
"test": "node scripts/check-tool-sync.mjs && pnpm -F shared test && pnpm -F airtable-user-mcp test && pnpm -F webview test && pnpm -F airtable-formula test",
```

**Changes required:**
- `build`: Insert `pnpm -F language-services build &&` after `pnpm -F shared build &&`
- `test`: Insert `pnpm -F language-services test &&` after `pnpm -F shared test &&`

**Result:**
```json
"build": "node scripts/check-tool-sync.mjs && pnpm -F shared build && pnpm -F language-services build && pnpm -F webview build && node scripts/bundle-mcp.mjs && pnpm -F airtable-formula build",
"test": "node scripts/check-tool-sync.mjs && pnpm -F shared test && pnpm -F language-services test && pnpm -F airtable-user-mcp test && pnpm -F webview test && pnpm -F airtable-formula test",
```

---

### `packages/extension/package.json` (MODIFIED)

**Source:** self (lines 471–473)

**Current dependencies block** (`packages/extension/package.json` lines 471–473):
```json
"dependencies": {
  "@airtable-formula/shared": "workspace:*"
},
```

**Change required:** Add `language-services` to `dependencies` (not devDependencies — it's a runtime import):
```json
"dependencies": {
  "@airtable-formula/shared": "workspace:*",
  "@airtable-formula/language-services": "workspace:*"
},
```

---

## Shared Patterns

### Subsystem Registration Function
**Source:** `packages/extension/src/mcp/registration.ts` lines 24–28
**Apply to:** `packages/extension/src/language/registration.ts`
```typescript
export function register<Subsystem>(
  context: vscode.ExtensionContext,
  ...args
): void {
  context.subscriptions.push(/* all disposables */);
}
```
Convention: single exported `register*` function, `void` return, all disposables pushed to `context.subscriptions` internally.

### Workspace Package Scaffold
**Source:** `packages/shared/package.json` lines 1–18 + `packages/shared/tsconfig.json` lines 1–12
**Apply to:** `packages/language-services/package.json` and `packages/language-services/tsconfig.json`

The `devDependencies` set (`tsup ^8.0.0`, `typescript ^5.4.0`, `vitest ^1.6.0`) is the standard for all non-extension workspace packages. No runtime dependencies for Phase 1.

### TypeScript Interface Style
**Source:** `packages/shared/src/types.ts` lines 21–53
**Apply to:** `packages/language-services/src/types.ts`

Use `export interface` for object shapes, `export type` for union types, `export const enum` for enumerations. Align property columns with spaces for readability.

### Star-Import for vscode
**Source:** `packages/extension/src/mcp/registration.ts` line 3 and `packages/extension/src/extension.ts` line 1
**Apply to:** `packages/extension/src/language/registration.ts` and `packages/extension/src/language/convert.ts`
```typescript
import * as vscode from 'vscode';
```
All extension files use the star import. Never destructure from `'vscode'` at the top level.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/extension/src/language/convert.ts` | utility | transform | No existing vscode↔plain-type boundary layer in the codebase. The `mcp/registration.ts` analog provides only the import/function-structure pattern; the conversion logic itself is novel to this phase. |

---

## Metadata

**Analog search scope:** `packages/shared/`, `packages/extension/src/mcp/`, `packages/extension/src/extension.ts`, `packages/extension/package.json`, root `package.json`
**Files scanned:** 8
**Pattern extraction date:** 2026-05-12
