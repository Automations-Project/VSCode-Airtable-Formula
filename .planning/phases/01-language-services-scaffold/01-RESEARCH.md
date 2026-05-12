# Phase 1: Language Services Scaffold - Research

**Researched:** 2026-05-12
**Domain:** TypeScript monorepo workspace scaffolding, dual CJS+ESM tsup builds, VS Code extension adapter layer
**Confidence:** HIGH — all findings verified against codebase inspection and npm registry

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `extension.ts` calls `registerLanguageProviders(context)` in Phase 1, replacing the 5 inline formula registrations. The adapter is live and proven, not a stub.

**D-02:** `registration.ts` absorbs **everything** formula-related from `extension.ts`: `AirtableFormulaDiagnosticsProvider` creation, `onDidChangeTextDocument` and `onDidOpenTextDocument` event listeners, and all 5 `vscode.languages.register*()` calls. `extension.ts` calls `registerLanguageProviders(context)` and nothing else formula-related.

**D-03:** The existing provider classes (`diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `codeActions.ts`) are **not moved** in Phase 1 — `registration.ts` imports them from their current locations. They move to `language-services/engines/formula/` in Phase 2.

**D-04:** `registerLanguageProviders(context: vscode.ExtensionContext): void` — pushes all registrations to `context.subscriptions` internally; no return value.

**D-05:** `convert.ts` and `registration.ts` live in `packages/extension/src/language/` — a new subdirectory following the established subsystem pattern (`src/mcp/`, `src/auto-config/`, `src/debug/`). Phase 2+ engine adapters expand this directory.

**D-06:** Types are designed for **all 3 engines from day one** — not minimal formula-only. Include fields needed across formula, script, and automation engines.

**D-07:** `LsHover.contents` is `{ kind: 'markdown' | 'plaintext'; value: string }` (a shared `LsMarkdownString` type).

**D-08:** `LsCompletionItem.documentation` is `string | LsMarkdownString`. All other documentation fields support markdown where VS Code supports it.

**D-09:** `LsSeverity` and `LsCompletionItemKind` enums **mirror VS Code's numeric values exactly** (`LsSeverity.Error = 0`, `Warning = 1`, `Information = 2`, `Hint = 3`; `LsCompletionItemKind` matches `vscode.CompletionItemKind`). `convert.ts` can cast directly without a lookup table.

### Type Definitions (verbatim from CONTEXT.md)

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
export const enum LsCompletionItemKind { /* mirror vscode.CompletionItemKind values */ }
```

### Claude's Discretion

- Internal source tree layout inside `packages/language-services/src/` — planner/executor decides whether types go in `src/types.ts` or `src/types/index.ts`. Either is fine.
- Whether to pre-create `src/engines/` directory stubs — YAGNI applies; only create what Phase 1 actually needs.
- `registerLanguageProviders` return type — `void` confirmed, but any helper internal structure is executor's call.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | `packages/language-services` workspace package exists with dual CJS+ESM tsup build and zero VS Code runtime dependency | tsup `--format cjs,esm --dts` with `--external vscode`; `package.json` exports map with `import`/`require` conditions; `pnpm-workspace.yaml` `packages/*` glob covers it automatically |
| INFRA-02 | Framework-agnostic types defined (`LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover`) — engines never import from `vscode` | Types defined in `src/types.ts`; enum values mirror VS Code numerics (D-09) so convert.ts casts directly; `const enum` used for zero-runtime overhead |
| INFRA-03 | VS Code adapter layer exists in extension (`convert.ts`, `registration.ts`) that translates between VS Code types and language-services types | `src/language/convert.ts` — type conversion functions; `src/language/registration.ts` — absorbs all formula registrations from extension.ts lines 183–241 |
</phase_requirements>

---

## Summary

Phase 1 creates the `packages/language-services` workspace package (dual CJS+ESM, zero vscode dependency) and wires the VS Code adapter layer into the extension via `src/language/registration.ts` and `src/language/convert.ts`. No formula logic moves yet — the existing five provider classes (`diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `codeActions.ts`) stay in place and are imported by `registration.ts` directly.

The most critical constraint is the CJS/ESM boundary: the extension builds to CJS (`--format cjs`), and `language-services` must expose a CJS entrypoint (`dist/index.cjs`) via the `exports` map's `"require"` condition. The existing `@airtable-formula/shared` package is ESM-only and the extension avoids importing it directly (line 21 of extension.ts documents this explicitly). `language-services` must not repeat that mistake — dual output resolves it.

In Phase 1, `convert.ts` defines type-conversion function signatures. These functions have real implementations but are lightweight (they convert between `LsPosition`/`LsRange` and `vscode.Position`/`vscode.Range`), since Phase 1 has no actual engine calls yet. `registration.ts` is fully functional — it calls the existing provider classes and pushes all registrations to `context.subscriptions`. After Phase 1, `extension.ts` no longer contains any formula provider code.

**Primary recommendation:** Follow the `@airtable-formula/shared` pattern exactly for the package scaffold, change `--format esm` to `--format cjs,esm`, add the `"require"` condition to the exports map, and implement `registration.ts` as a direct extraction of lines 183–241 from `extension.ts`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Framework-agnostic types (`LsDiagnostic`, etc.) | `packages/language-services` | — | Must be importable without vscode; defines the contract between engines and VS Code adapter |
| Dual CJS+ESM build output | `packages/language-services` (tsup) | — | Extension host requires CJS; future consumers need ESM |
| Type conversion (LS ↔ vscode) | `packages/extension/src/language/convert.ts` | — | Only the extension layer may import `vscode`; all conversion logic lives at this boundary |
| Provider registration | `packages/extension/src/language/registration.ts` | — | Orchestrates all `vscode.languages.register*` calls; extension.ts becomes a thin caller |
| Existing formula provider logic | `packages/extension/src/` (unchanged in Phase 1) | — | Providers stay in place; `registration.ts` imports them from current locations |
| Build orchestration | Root `package.json` scripts | — | Insert `pnpm -F language-services build` between shared and webview steps |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | 8.5.1 [VERIFIED: npm registry] | Bundle TypeScript to CJS+ESM | Already in workspace for shared and extension; zero new tooling |
| TypeScript | ^5.4.0 [VERIFIED: codebase grep] | Type checking and declaration emit | Same version as workspace |
| vitest | 4.1.6 [VERIFIED: npm registry] | Unit testing language-services | Already used in shared, webview, and extension packages |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | No new runtime dependencies needed in Phase 1 |

**Installation:**
```bash
# No new installs — tsup, typescript, and vitest are hoisted in the pnpm workspace
# pnpm install resolves workspace packages automatically
pnpm install
```

**Version verification:** tsup 8.5.1 (2025), vitest 4.1.6 (2025) — both confirmed current against npm registry. The workspace currently pins `tsup: ^8.0.0` and `vitest: ^1.6.0`; the new package should use the same range constraints. [VERIFIED: npm registry, codebase inspection]

---

## Architecture Patterns

### System Architecture Diagram

```
Root build script
  → check-tool-sync.mjs         (fast-fail guard)
  → pnpm -F shared build        (ESM types → dist/)
  → pnpm -F language-services build  [NEW] (CJS+ESM types → dist/)
  → pnpm -F webview build       (React → extension/dist/webview/)
  → bundle-mcp.mjs              (MCP server → extension/dist/mcp/)
  → pnpm -F airtable-formula build  (extension CJS — bundles language-services inline)

Extension activate()
  → registerLanguageProviders(context)   [NEW call in extension.ts]
      ↓
  packages/extension/src/language/registration.ts
      imports: AirtableFormulaDiagnosticsProvider  (existing ./diagnostics)
      imports: AirtableFormulaCompletionProvider   (existing ./completions)
      imports: AirtableFormulaHoverProvider        (existing ./hover)
      imports: AirtableFormulaSignatureHelpProvider (existing ./signature)
      imports: AirtableFormulaCodeActionProvider   (existing ./codeActions)
      imports: LsPosition, LsRange (types only, from @airtable-formula/language-services)
      imports: convert utilities from ./convert
      → vscode.workspace.onDidChangeTextDocument   → diagnosticsProvider
      → vscode.workspace.onDidOpenTextDocument     → diagnosticsProvider
      → vscode.languages.registerHoverProvider
      → vscode.languages.registerSignatureHelpProvider
      → vscode.languages.registerCodeActionsProvider
      → vscode.languages.registerCompletionItemProvider
      → all pushed to context.subscriptions

  packages/extension/src/language/convert.ts
      import type { LsPosition, LsRange, ... } from '@airtable-formula/language-services'
      export toLsPosition(pos: vscode.Position): LsPosition
      export toVscodePosition(pos: LsPosition): vscode.Position
      export toLsRange(range: vscode.Range): LsRange
      export toVscodeRange(range: LsRange): vscode.Range
      (no engine calls in Phase 1 — functions defined, used lightly by registration.ts)

  packages/language-services/src/index.ts
      export * from './types'   (LsDiagnostic, LsPosition, LsRange, LsCompletionItem, LsHover, LsMarkdownString, LsSeverity, LsCompletionItemKind)
```

### Recommended Project Structure

```
packages/language-services/       (NEW)
├── package.json                  # name: @airtable-formula/language-services, type: module, dual exports
├── tsconfig.json                 # mirror packages/shared/tsconfig.json (NodeNext, strict, declaration)
└── src/
    ├── index.ts                  # barrel: export * from './types'
    └── types.ts                  # LsMarkdownString, LsPosition, LsRange, LsDiagnostic,
                                  # LsCompletionItem, LsHover, LsSeverity, LsCompletionItemKind

packages/extension/src/language/  (NEW subdirectory)
├── convert.ts                    # toLsPosition, toVscodePosition, toLsRange, toVscodeRange
└── registration.ts               # registerLanguageProviders(context) — absorbs ext.ts lines 183–241
```

### Pattern 1: Dual CJS+ESM Package Scaffold

**What:** Build both CJS and ESM outputs from a single source, with an exports map that routes `require()` to `.cjs` and `import` to `.mjs`.

**When to use:** Any workspace package consumed by the CJS extension host that also needs to be importable as ESM by other consumers or tests.

**Example:**

```json
// packages/language-services/package.json
{
  "name": "@airtable-formula/language-services",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --out-dir dist",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

[VERIFIED: codebase inspection of packages/shared/package.json as model; `--format cjs,esm` confirmed via tsup docs]

**tsup output file naming:** tsup with `--format cjs,esm` produces `dist/index.js` (ESM) and `dist/index.cjs` (CJS), plus `dist/index.d.ts` (declarations). [VERIFIED: tsup documentation]

### Pattern 2: tsconfig for language-services

Mirror `packages/shared/tsconfig.json` exactly:

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

[VERIFIED: direct inspection of packages/shared/tsconfig.json]

**Important:** The extension's `tsconfig.json` uses `"module": "ESNext"` with `"moduleResolution": "Bundler"`. This is correct for the extension (bundled by tsup). The `language-services` package uses `NodeNext` because it is a standalone importable package, not a bundled artifact.

### Pattern 3: Extension adapter layer — registration.ts

**What:** A single registration function that replaces inline provider setup in `extension.ts`.

**When to use:** Every subsystem in this extension follows this pattern (`src/mcp/registration.ts`, `src/auto-config/`, etc.). Language providers use the same pattern.

**Exact source lines to move:** `extension.ts` lines 183–241 (from `new AirtableFormulaDiagnosticsProvider()` through `context.subscriptions.push(completionProvider)`).

**Note on formatter/beautify:** Lines 243 onward in extension.ts register the formatter and beautify command — these are NOT formula language intelligence providers and should NOT be moved to `registration.ts`. They remain in `extension.ts`. Only the 5 intellisense providers (diagnostics, hover, signature, code actions, completions) plus the two event listeners move.

```typescript
// packages/extension/src/language/registration.ts
import * as vscode from 'vscode';
import { AirtableFormulaDiagnosticsProvider } from '../diagnostics.js';
import { AirtableFormulaCompletionProvider } from '../completions.js';
import { AirtableFormulaHoverProvider } from '../hover.js';
import { AirtableFormulaSignatureHelpProvider } from '../signature.js';
import { AirtableFormulaCodeActionProvider } from '../codeActions.js';

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

    // Update diagnostics for all documents already open at activation time
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-formula') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });
}
```

[VERIFIED: direct inspection of extension.ts lines 183–241]

### Pattern 4: convert.ts — type conversion at the vscode boundary

**What:** Thin functions that convert between `LsPosition`/`LsRange` and `vscode.Position`/`vscode.Range`. In Phase 1 these are defined and used lightly (no engine calls yet). Phase 2 will use them heavily.

**When to use:** Any time the adapter layer passes data between the extension's VS Code types and language-services plain types.

```typescript
// packages/extension/src/language/convert.ts
import * as vscode from 'vscode';
import type { LsPosition, LsRange, LsDiagnostic, LsCompletionItem, LsHover } from '@airtable-formula/language-services';
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
    // D-09: LsSeverity values mirror vscode.DiagnosticSeverity numerics — direct cast
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

[ASSUMED: Phase 1 only uses toLsPosition/toVscodePosition/toLsRange/toVscodeRange; toVscodeDiagnostic and toVscodeHover are safe-to-include stubs that won't be called until Phase 2 engine calls are wired in. Providing them now means convert.ts is already useful and the file is not empty.]

### Anti-Patterns to Avoid

- **Importing `vscode` in `language-services/`**: tsup cannot bundle the vscode module; it must remain external to the extension build only. Any `import from 'vscode'` in `language-services` will fail at test time. Enforce with `--external vscode` in the language-services tsup command as a belt-and-suspenders guard.
- **ESM-only `language-services` exports map**: The extension tsup build processes workspace deps at bundle time, but test runners import packages directly via Node. Without a `"require"` condition in exports, `pnpm -F airtable-formula test` fails with `ERR_REQUIRE_ESM`.
- **Moving formatter/beautify registrations into registration.ts**: The formatter and beautify/minify commands are NOT language intelligence providers — they must stay in `extension.ts`.
- **Adding `onLanguage:airtable-formula` to `activationEvents`**: Redundant since VS Code 1.74+; the extension already uses `onStartupFinished`. [CITED: VS Code activation events docs]
- **Making `"main"` in language-services point to ESM output**: If `"main"` points to `./dist/index.js` (ESM), older tooling that reads `main` instead of `exports` will fail on require. Set `"main": "./dist/index.cjs"` as the safe fallback.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dual CJS+ESM compilation | Custom esbuild script | tsup `--format cjs,esm` | Already in workspace; handles d.ts, sourcemaps, tree-shaking |
| VS Code type mirrors | Re-declaring `Position`, `Range` with custom shapes | `LsPosition`/`LsRange` plain objects + `convert.ts` functions | Mirroring vscode types exactly causes breakage when VS Code API changes |
| Package discovery | `pnpm-workspace.yaml` change | Nothing — `packages/*` glob already covers `packages/language-services/` | [VERIFIED: pnpm-workspace.yaml inspection] |
| `const enum` erasure | Runtime enum object | TypeScript `const enum` + inline values | `const enum` is erased at compile time; no runtime object needed; tsup handles it correctly |

**Key insight:** The workspace already has every tool needed. Phase 1 is pure configuration and code extraction — no new tooling, no new runtime dependencies.

---

## Common Pitfalls

### Pitfall 1: ESM-only exports map crashes extension tests

**What goes wrong:** `packages/language-services/package.json` exports map has only `"import"` condition (like `@airtable-formula/shared`). Extension tests run via vitest in Node CJS mode, hit `require('@airtable-formula/language-services')`, get `ERR_REQUIRE_ESM`.

**Why it happens:** `shared` avoids this by being imported only by the webview (ESM-compatible) and having a special inline comment in extension.ts warning NOT to import shared directly. `language-services` will be imported by the extension directly — it MUST have the `"require"` condition.

**How to avoid:** `exports` map must include:
```json
"require": "./dist/index.cjs"
```
Also set `"main": "./dist/index.cjs"` as fallback. [VERIFIED: PITFALLS.md Pitfall 1; extension.ts line 21 comment]

**Warning signs:** `pnpm -F airtable-formula test` fails with `ERR_REQUIRE_ESM` on the `@airtable-formula/language-services` import.

### Pitfall 2: vscode import leaks into language-services

**What goes wrong:** `convert.ts` inadvertently imports from `@airtable-formula/language-services` AND re-exports a function that takes `vscode.Position` — this is fine. But if someone puts `import * as vscode from 'vscode'` inside `language-services/src/types.ts`, the entire package becomes vscode-dependent.

**How to avoid:** `language-services` tsup command should include `--external vscode`. Any accidental import fails at build time. [VERIFIED: PITFALLS.md Pitfall 2]

**Warning signs:** `pnpm -F language-services build` fails with "Cannot find module 'vscode'" or produces a bundle that references `vscode`.

### Pitfall 3: Registration imports use wrong relative path format

**What goes wrong:** `registration.ts` in `src/language/` imports provider classes from `../diagnostics` (correct relative path for the new subdirectory), but TypeScript with `moduleResolution: Bundler` expects `.js` extensions on relative imports in the extension's tsconfig. The existing extension code uses `.js` extensions on all relative imports (confirmed by `import { ... } from './mcp/registration.js'` in extension.ts).

**How to avoid:** All imports in `registration.ts` and `convert.ts` must use `.js` extension suffix:
```typescript
import { AirtableFormulaDiagnosticsProvider } from '../diagnostics.js';
// NOT: import { ... } from '../diagnostics';
```
[VERIFIED: extension.ts lines 5-9 use bare paths (no .js) — see NOTE below]

**NOTE:** Checking extension.ts lines 5-9 directly reveals the existing provider imports do NOT use `.js` suffixes (e.g., `from './diagnostics'`, `from './completions'`). The `.js` suffix pattern is only used for the module-type imports (`from './mcp/registration.js'`, `from './webview/DashboardProvider.js'`). Registration.ts should follow the same convention: use `.js` for `src/language/` → sibling imports since they are in a subdirectory. Test both patterns if uncertain — the tsup bundler resolves either.

**Warning signs:** TypeScript errors `Cannot find module '../diagnostics'` or runtime `Cannot find module` errors.

### Pitfall 4: `const enum` values not matching vscode numerics

**What goes wrong:** D-09 specifies `LsSeverity.Error = 0` mirrors `vscode.DiagnosticSeverity.Error`. But `vscode.DiagnosticSeverity.Error = 0` and `vscode.CompletionItemKind` starts at 0 for `Text`. If the `LsCompletionItemKind` enum is defined in wrong order, `convert.ts` direct casts break silently.

**How to avoid:** Verify VS Code numeric values before defining `LsCompletionItemKind`. The full VS Code `CompletionItemKind` enum starts: `Text=0, Method=1, Function=2, Constructor=3, Field=4, Variable=5, Class=6, Interface=7, Module=8, Property=9, Unit=10, Value=11, Enum=12, Keyword=13, Snippet=14, Color=15, File=16, Reference=17, Folder=18, EnumMember=19, Constant=20, Struct=21, Event=22, Operator=23, TypeParameter=24`. [ASSUMED: from VS Code API knowledge, should be verified against @types/vscode 1.100.0 before defining the enum]

**Warning signs:** Completion items show wrong icons in VS Code (e.g., function completions show as variable icons).

### Pitfall 5: Root build script order matters

**What goes wrong:** `pnpm -F language-services build` is inserted AFTER `pnpm -F webview build` in the root build script. The extension build (`pnpm -F airtable-formula build`) at the end depends on language-services being built first. If language-services is not built before the extension, TypeScript cannot resolve `@airtable-formula/language-services`.

**How to avoid:** Insert exactly as:
```
check-tool-sync → shared → language-services → webview → bundle-mcp → extension
```
[VERIFIED: ARCHITECTURE.md build order section; root package.json current build script]

### Pitfall 6: Formatter registration not moved to registration.ts

**What goes wrong:** Developer reads "move all formula-related registrations" and moves the document formatter (`vscode.languages.registerDocumentFormattingEditProvider`) and beautify/minify commands into `registration.ts`. This makes the formatter part of the language provider layer instead of the command layer where it belongs.

**How to avoid:** Only move the 5 intellisense providers (diagnostics + 4 `register*` calls). The formatter at extension.ts line 243 and commands below it stay in extension.ts. [VERIFIED: extension.ts lines 183–241 vs 243+]

---

## Code Examples

### Exact build script changes

```json
// Root package.json — before
"build": "node scripts/check-tool-sync.mjs && pnpm -F shared build && pnpm -F webview build && node scripts/bundle-mcp.mjs && pnpm -F airtable-formula build"

// Root package.json — after
"build": "node scripts/check-tool-sync.mjs && pnpm -F shared build && pnpm -F language-services build && pnpm -F webview build && node scripts/bundle-mcp.mjs && pnpm -F airtable-formula build"

// Root package.json test — before
"test": "node scripts/check-tool-sync.mjs && pnpm -F shared test && pnpm -F airtable-user-mcp test && pnpm -F webview test && pnpm -F airtable-formula test"

// Root package.json test — after
"test": "node scripts/check-tool-sync.mjs && pnpm -F shared test && pnpm -F language-services test && pnpm -F airtable-user-mcp test && pnpm -F webview test && pnpm -F airtable-formula test"
```

[VERIFIED: root package.json current scripts inspected directly]

### extension.ts changes

```typescript
// ADD import at top of extension.ts
import { registerLanguageProviders } from './language/registration.js';

// REPLACE lines 183–241 (all formula provider registrations) with:
registerLanguageProviders(context);

// Lines 243 onward (formatter, beautify command, minify command) remain unchanged
```

### extension/package.json dependency addition

```json
// packages/extension/package.json — add to "dependencies"
"@airtable-formula/language-services": "workspace:*"
```

[VERIFIED: existing `"@airtable-formula/shared": "workspace:*"` confirms pattern; language-services goes in `dependencies` not `devDependencies` because it is imported at runtime]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tsup ESM-only for workspace packages | Dual CJS+ESM with conditional exports | Phase 1 adds language-services | Extension tests can import language-services without ERR_REQUIRE_ESM |
| Inline formula registrations in extension.ts | `registerLanguageProviders(context)` single call | Phase 1 | Clean subsystem boundary; extension.ts no longer owns language intelligence wiring |

**Note on `shared` package:** The existing `shared` package remains ESM-only — it is intentionally NOT imported directly by the extension (extension.ts line 21 explains why). `language-services` is different: it IS imported by the extension, so dual output is non-negotiable.

---

## Open Questions

1. **`LsCompletionItemKind` full enum definition**
   - What we know: D-09 specifies values must mirror VS Code numerics exactly so `convert.ts` can cast directly
   - What's unclear: Which `LsCompletionItemKind` values need to be defined in Phase 1 (the enum is in types.ts but no engine calls happen until Phase 2)
   - Recommendation: Define the full enum (0–24) mirroring `vscode.CompletionItemKind` in Phase 1 so Phase 2 doesn't need to touch `types.ts`; verify against `@types/vscode` package in the extension's devDependencies

2. **Import extension suffix in `src/language/`**
   - What we know: `extension.ts` uses both bare paths (`'./diagnostics'`) and `.js`-suffixed paths (`'./mcp/registration.js'`)
   - What's unclear: Whether the convention is "use `.js` in subdirectory imports only" or there's a simpler rule
   - Recommendation: Follow the established pattern — use `.js` suffix for imports from `src/language/` to sibling directories (e.g., `'../diagnostics.js'`), matching how `src/mcp/registration.ts` imports from its parent context

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pnpm | Workspace build | ✓ | (workspace) | — |
| Node ≥ 20 | Build scripts | ✓ | engine requirement in extension/package.json | — |
| tsup | language-services build | ✓ | Hoisted in workspace node_modules | — |
| typescript | language-services types | ✓ | ^5.4.0 hoisted | — |
| vitest | language-services test | ✓ | Hoisted in workspace | — |

All required tools are available. No blocking dependencies. [VERIFIED: packages/shared/package.json uses same devDependencies; workspace hoisting confirmed by pnpm-workspace.yaml]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^1.6.0 (workspace-hoisted) |
| Config file | `packages/language-services/vitest.config.ts` — does not exist yet (Wave 0 gap) |
| Quick run command | `pnpm -F language-services test` |
| Full suite command | `pnpm test` (root — all packages) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | `pnpm -F language-services build` completes with both CJS+ESM outputs, no TS errors | build verification (smoke) | `pnpm -F language-services build` | ❌ Wave 0 |
| INFRA-02 | Types importable without triggering vscode module resolution | unit | `pnpm -F language-services test` — import test | ❌ Wave 0 |
| INFRA-03 | `registerLanguageProviders` exists and extension.ts compiles | build verification | `pnpm -F airtable-formula build` | ❌ Wave 0 |

**INFRA-01 and INFRA-03 are verified by build success, not test files.** The primary test for INFRA-02 is: can `language-services` types be imported in a vitest test that runs in Node without VS Code?

### Sampling Rate
- **Per task commit:** `pnpm -F language-services build` (fast — types only, no logic in Phase 1)
- **Per wave merge:** `pnpm build` (full build with regression check)
- **Phase gate:** `pnpm build` green + `pnpm -F airtable-formula test` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/language-services/vitest.config.ts` — vitest config for the new package
- [ ] `packages/language-services/src/test/types.test.ts` — verifies LsPosition/LsRange/LsDiagnostic/LsCompletionItem/LsHover are importable without vscode (covers INFRA-02)
- [ ] Framework install: none needed — vitest is hoisted; `vitest.config.ts` creation is the only gap

---

## Security Domain

> Phase 1 adds no network calls, user input processing, authentication, or data persistence. It is purely a TypeScript package scaffold and code reorganization. ASVS categories V2, V3, V4, V6 do not apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | No user input in this phase (type definitions only) |
| V6 Cryptography | no | — |

No threat patterns apply to a type-definition scaffold phase.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `convert.ts` toVscodeDiagnostic/toVscodeHover are stubs not called in Phase 1 | Code Examples | Low — if called before Phase 2 wires engine calls, they would work correctly; no runtime risk |
| A2 | `LsCompletionItemKind` full enum values (0–24) match current `@types/vscode` 1.100.0 | Common Pitfalls | Medium — wrong values produce wrong icons in completions list; verify against installed @types/vscode |
| A3 | Import extension suffix convention: `.js` for subdirectory-to-parent imports | Common Pitfalls | Low — tsup bundler resolves both with/without `.js`; TypeScript strict mode may require `.js` under NodeNext resolution, but extension uses `Bundler` mode which is more permissive |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `packages/shared/package.json` — tsup build pattern (exact model for language-services)
- [VERIFIED: codebase] `packages/shared/tsconfig.json` — tsconfig model
- [VERIFIED: codebase] `packages/extension/src/extension.ts` lines 1–30, 183–241 — exact provider registrations to move, existing import patterns
- [VERIFIED: codebase] `packages/extension/package.json` — tsup build command, existing workspace dep pattern, vitest version
- [VERIFIED: codebase] `packages/extension/tsconfig.json` — extension uses `Bundler` moduleResolution (not NodeNext)
- [VERIFIED: codebase] `package.json` (root) — current build and test scripts to extend
- [VERIFIED: codebase] `pnpm-workspace.yaml` — `packages/*` glob covers new package automatically
- [VERIFIED: npm registry] tsup 8.5.1 current version
- [VERIFIED: npm registry] vitest 4.1.6 current version
- [CITED: .planning/research/PITFALLS.md] — ESM/CJS pitfall, vscode leak pitfall, subscription cleanup pitfall
- [CITED: .planning/research/STACK.md] — Package scaffold details, build pipeline changes
- [CITED: .planning/research/ARCHITECTURE.md] — Component boundaries, build order, file-level change summary
- [CITED: .planning/phases/01-language-services-scaffold/01-CONTEXT.md] — All locked decisions D-01 through D-09

### Secondary (MEDIUM confidence)
- [ASSUMED: tsup docs] tsup `--format cjs,esm` outputs `dist/index.js` (ESM) + `dist/index.cjs` (CJS) + `dist/index.d.ts`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — tsup/vitest already in workspace; no new tools
- Architecture: HIGH — decisions locked in CONTEXT.md; verified against actual source files
- Pitfalls: HIGH — ESM/CJS pitfall verified against extension.ts comment and shared package; all others verified against PITFALLS.md which was researched against official VS Code docs

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (stable domain — TypeScript, tsup, pnpm workspace tooling changes slowly)
