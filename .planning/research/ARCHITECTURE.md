# Architecture Patterns

**Domain:** Multi-engine language platform for VS Code extension (formula + scripting engines)
**Researched:** 2026-05-12
**Confidence:** HIGH — based on direct codebase inspection of all relevant source files

---

## Existing Architecture (Ground Truth)

The extension currently has **five formula provider files** in `packages/extension/src/`:

| File | Role | VS Code coupling |
|------|------|-----------------|
| `functions.ts` | `FUNCTION_REGISTRY` data + helper fns (`getFunctionInfo`, `isValidCallable`, etc.) | None — pure data |
| `diagnostics.ts` | `AirtableFormulaDiagnosticsProvider` — 10 check methods operating on raw `string` | `vscode.*` throughout: `DiagnosticCollection`, `Range`, `Position`, `Diagnostic`, `DiagnosticSeverity` |
| `completions.ts` | `AirtableFormulaCompletionProvider` — duplicates function table (independent of `functions.ts`) | `vscode.*` throughout: `CompletionItem`, `CompletionItemKind`, `SnippetString` |
| `hover.ts` | `AirtableFormulaHoverProvider` — imports `FUNCTION_REGISTRY` from `functions.ts` | `vscode.*` throughout: `Hover`, `MarkdownString`, `Range` |
| `signature.ts` | `AirtableFormulaSignatureHelpProvider` — imports `FUNCTION_REGISTRY` from `functions.ts` | `vscode.*` throughout: `SignatureHelp`, `SignatureInformation`, `ParameterInformation` |

Key observation: `diagnostics.ts` and `completions.ts` each carry their own private copy of the function list, inconsistent with `functions.ts`. The logic inside every `check*` and `provide*` method is pure computation (string → result) wrapped in VS Code types. This is the extraction boundary.

---

## Recommended Architecture

### Package Structure

```
packages/
  shared/                    (existing — ESM, message protocol + shared UI types)
  language-services/         (NEW — pure TS, no vscode dep, ESM, tsup build)
    src/
      index.ts               (barrel — re-exports all 3 engines + shared primitives)
      types.ts               (shared language-agnostic types: Diagnostic, CompletionItem, Hover, SignatureHelp)
      engines/
        formula/
          index.ts           (FormulaEngine — composes validator + completions + hover + signature)
          registry.ts        (FUNCTION_REGISTRY — move from extension/src/functions.ts)
          validator.ts       (formula-specific validation logic — extracted from diagnostics.ts)
          completions.ts     (formula completions — extracted from extension completions.ts)
          hover.ts           (formula hover — extracted from extension hover.ts)
          signature.ts       (formula signature help — extracted from extension signature.ts)
        script/
          index.ts           (ScriptEngine — JS scripting extension globals)
          globals.ts         (Airtable Scripting Extension global API definitions: base, table, cursor, etc.)
          validator.ts       (JS-specific diagnostics: async/await checks, undefined globals)
          completions.ts     (global API completions)
          hover.ts           (global API hover docs)
        automation/
          index.ts           (AutomationEngine — automation script globals)
          globals.ts         (Automation global API: input.config, output.set, remoteFetchAsync differences)
          validator.ts       (automation-specific diagnostics — differs from script in allowed APIs)
          completions.ts     (automation-scoped completions)
          hover.ts           (automation hover docs)
      util/
        parser-context.ts    (shared: exclusion range detection, string/comment boundary tracking)
        levenshtein.ts       (extracted from diagnostics.ts — reusable edit-distance)
        position.ts          (offset↔line/col conversion utilities, no VS Code types)
  webview/                   (existing)
  mcp-server/                (existing)
  extension/
    src/
      language/              (NEW — thin VS Code adapter layer)
        formula-providers.ts (FormulaProviders — wraps FormulaEngine with VS Code types)
        script-providers.ts  (ScriptProviders — wraps ScriptEngine with VS Code types)
        automation-providers.ts (AutomationProviders — wraps AutomationEngine with VS Code types)
        registration.ts      (registerLanguageProviders — replaces inline registration in extension.ts)
      diagnostics.ts         (REPLACED by language/formula-providers.ts + registration.ts)
      completions.ts         (REPLACED by language/formula-providers.ts + registration.ts)
      hover.ts               (REPLACED by language/formula-providers.ts + registration.ts)
      signature.ts           (REPLACED by language/formula-providers.ts + registration.ts)
      functions.ts           (MOVED to language-services/engines/formula/registry.ts)
```

---

## Component Boundaries

| Component | Responsibility | Input | Output | VS Code dep |
|-----------|---------------|-------|--------|-------------|
| `language-services/types.ts` | Framework-agnostic language types | — | `LsDiagnostic`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp`, `LsRange`, `LsPosition` | None |
| `language-services/util/parser-context.ts` | Identify string/field-ref/comment boundaries in raw text | `string` (source text) | `ExclusionRange[]` | None |
| `language-services/util/levenshtein.ts` | Edit distance computation | `string, string` | `number` | None |
| `language-services/util/position.ts` | Convert character offsets to `{line, character}` | `string, number` | `LsPosition` | None |
| `language-services/engines/formula/registry.ts` | Authoritative function metadata | — | `FUNCTION_REGISTRY`, `FunctionInfo`, helper fns | None |
| `language-services/engines/formula/validator.ts` | Validate formula text → diagnostics | `string` | `LsDiagnostic[]` | None |
| `language-services/engines/formula/completions.ts` | Generate formula completions | `string, LsPosition` | `LsCompletionItem[]` | None |
| `language-services/engines/formula/hover.ts` | Provide hover content | `string, LsPosition` | `LsHover \| null` | None |
| `language-services/engines/formula/signature.ts` | Provide signature help | `string, LsPosition` | `LsSignatureHelp \| null` | None |
| `language-services/engines/formula/index.ts` | `FormulaEngine` — composes above modules | `string, LsPosition` | All language feature results | None |
| `language-services/engines/script/globals.ts` | Scripting Extension globals registry (base, table, cursor, input, output) | — | `ScriptGlobal[]` | None |
| `language-services/engines/script/index.ts` | `ScriptEngine` — JS diagnostics + completions using script globals | `string, LsPosition` | Language feature results | None |
| `language-services/engines/automation/globals.ts` | Automation globals (input.config, output.set, remoteFetchAsync) | — | `AutomationGlobal[]` | None |
| `language-services/engines/automation/index.ts` | `AutomationEngine` — automation diagnostics + completions | `string, LsPosition` | Language feature results | None |
| `extension/src/language/formula-providers.ts` | Adapt `FormulaEngine` to VS Code provider interfaces | VS Code doc/position | VS Code types | Yes |
| `extension/src/language/script-providers.ts` | Adapt `ScriptEngine` to VS Code provider interfaces | VS Code doc/position | VS Code types | Yes |
| `extension/src/language/automation-providers.ts` | Adapt `AutomationEngine` to VS Code provider interfaces | VS Code doc/position | VS Code types | Yes |
| `extension/src/language/registration.ts` | Call `vscode.languages.register*` for all 3 engines | `vscode.ExtensionContext` | `vscode.Disposable[]` | Yes |

---

## Data Flow

### Formula Engine (existing, refactored)

```
VS Code event (onDidChangeTextDocument, etc.)
  → extension/src/language/formula-providers.ts
    converts: vscode.TextDocument → { text: string, position: LsPosition }
  → language-services/engines/formula/FormulaEngine
    calls: validator.validate(text)  → LsDiagnostic[]
    calls: completions.provide(text, pos) → LsCompletionItem[]
    calls: hover.provide(text, pos) → LsHover | null
    calls: signature.provide(text, pos) → LsSignatureHelp | null
  → formula-providers.ts converts LsDiagnostic[] → vscode.Diagnostic[]
  → vscode.languages.createDiagnosticCollection / provideCompletionItems / etc.
```

### Script / Automation Engines (new)

```
VS Code event (languageId === 'airtable-script' | 'airtable-automation')
  → extension/src/language/script-providers.ts (or automation-providers.ts)
    converts: vscode.TextDocument → { text: string, position: LsPosition }
  → language-services/engines/script/ScriptEngine (or AutomationEngine)
    calls: validator.validate(text)  → LsDiagnostic[]  (JS structural checks + unknown global detection)
    calls: completions.provide(text, pos) → LsCompletionItem[]  (global API completions)
    calls: hover.provide(text, pos) → LsHover | null  (global API docs)
  → providers convert LS types → VS Code types
  → registered VS Code providers respond
```

### Script vs Automation — shared base, different globals

Both script and automation engines share the same utility modules (`parser-context`, `levenshtein`, `position`). The difference is entirely in `globals.ts`:

- `script/globals.ts`: `base`, `table`, `cursor`, `input`, `output`, `fetch` — Airtable Scripting Extension globals
- `automation/globals.ts`: `input.config(fields)`, `output.set(name, value)`, `remoteFetchAsync` — Automation Script globals; `fetch` and direct `table` access differ

The validator modules in each engine import their respective `globals.ts` to check for valid global names. Neither engine needs a full JS parser — identifier-at-position lookup plus "is this identifier a known global?" is sufficient for the diagnostic/completion/hover use cases stated in PROJECT.md.

---

## Patterns to Follow

### Pattern 1: Framework-Agnostic Language Types

**What:** Define `LsDiagnostic`, `LsRange`, `LsPosition`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp` as plain objects in `language-services/types.ts`. These mirror VS Code's interface shapes but carry no VS Code import.

**When:** Any time a language engine method needs to return structured data.

**Example:**
```typescript
// language-services/src/types.ts
export interface LsPosition { line: number; character: number; }
export interface LsRange { start: LsPosition; end: LsPosition; }
export type LsDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';
export interface LsDiagnostic {
  range: LsRange;
  message: string;
  severity: LsDiagnosticSeverity;
  code?: string;
}
export interface LsCompletionItem {
  label: string;
  kind: 'function' | 'constant' | 'value' | 'variable';
  insertText: string;
  documentation?: string;
  detail?: string;
}
export interface LsHover { contents: string; range?: LsRange; }
export interface LsSignatureHelp {
  label: string;
  documentation: string;
  parameters: Array<{ label: string; documentation?: string }>;
  activeParameter: number;
}
```

### Pattern 2: Thin VS Code Adapter

**What:** Each `*-providers.ts` file in `extension/src/language/` does only two things: convert VS Code inputs to LS inputs, and convert LS outputs to VS Code outputs. Zero business logic lives there.

**When:** Always. The extension layer must not know how validation works.

**Example:**
```typescript
// extension/src/language/formula-providers.ts
import { FormulaEngine } from '@airtable-formula/language-services';
import * as vscode from 'vscode';
import { toVscodeDiagnostic, toLsPosition } from './convert.ts';

const engine = new FormulaEngine();

export class FormulaAdapterDiagnosticsProvider {
  update(document: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
    const lsDiagnostics = engine.validate(document.getText());
    collection.set(document.uri, lsDiagnostics.map(toVscodeDiagnostic));
  }
}
```

### Pattern 3: Shared Registration Function

**What:** Replace the inline `vscode.languages.register*` calls scattered across `extension.ts` with a single `registerLanguageProviders(context)` call that registers all three engines internally.

**When:** `extension.ts` `activate()` function.

**Example:**
```typescript
// extension/src/language/registration.ts
export function registerLanguageProviders(context: vscode.ExtensionContext): void {
  const formulaDisposables = registerFormulaProviders();
  const scriptDisposables = registerScriptProviders();
  const automationDisposables = registerAutomationProviders();
  context.subscriptions.push(...formulaDisposables, ...scriptDisposables, ...automationDisposables);
}
```

This means `extension.ts` changes from ~50 lines of inline provider registration to a single `registerLanguageProviders(context)` import.

### Pattern 4: One `registerX` Call Per Engine Per Provider Type

**What:** Each engine gets its own `vscode.languages.registerCompletionItemProvider`, `registerHoverProvider`, `registerSignatureHelpProvider`, and one shared `DiagnosticCollection`. Do not attempt to unify them under a single registration — VS Code's `DocumentSelector` can be a union, but separate registrations keeps per-engine gating simple (easy to disable an engine without touching others).

**When:** In `registration.ts`.

**Example structure:**
```
registerFormulaProviders()
  → vscode.languages.registerHoverProvider('airtable-formula', formulaHoverAdapter)
  → vscode.languages.registerCompletionItemProvider('airtable-formula', formulaCompletionAdapter, '(', '{', "'", '"')
  → vscode.languages.registerSignatureHelpProvider('airtable-formula', formulaSignatureAdapter, '(', ',')
  → vscode.languages.registerCodeActionsProvider('airtable-formula', codeActionsProvider, ...)
  → diagnosticsProvider attached to onDidChangeTextDocument (languageId === 'airtable-formula')

registerScriptProviders()
  → vscode.languages.registerHoverProvider('airtable-script', scriptHoverAdapter)
  → vscode.languages.registerCompletionItemProvider('airtable-script', scriptCompletionAdapter, '.')
  → diagnosticsProvider attached to onDidChangeTextDocument (languageId === 'airtable-script')

registerAutomationProviders()
  → same pattern for 'airtable-automation'
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Leaking VS Code Types into language-services

**What:** Importing `vscode` anywhere inside `packages/language-services/`.
**Why bad:** Prevents unit testing language logic without a VS Code host; blocks future LSP extraction; makes the package impossible to use in web/browser contexts.
**Instead:** Only `LsDiagnostic`, `LsRange`, etc. — plain objects. Conversion stays in `extension/src/language/convert.ts`.

### Anti-Pattern 2: Duplicating Function Data Again

**What:** `completions.ts` in the current extension has its own `FUNCTION_SIGNATURES` table, parallel to `functions.ts`. This will happen again if each engine file defines its own globals list.
**Why bad:** Drift — already proven to cause inconsistency (diagnostics.ts and completions.ts currently have divergent function sets).
**Instead:** Single authoritative data file per engine (`registry.ts` for formula, `globals.ts` for script/automation). All other modules in that engine import from it.

### Anti-Pattern 3: Putting Offset Math in Provider Adapters

**What:** Computing `document.offsetAt(position)` or scanning text for delimiter boundaries inside the VS Code adapter layer.
**Why bad:** Business logic that should be testable without VS Code ends up in the untestable layer.
**Instead:** `language-services/util/position.ts` handles all offset↔line/character arithmetic. Engine methods accept `LsPosition`; adapters call `document.offsetAt(lsToVscodePosition(pos))` once at the boundary.

### Anti-Pattern 4: Separate Language Package Per Engine

**What:** Creating `packages/formula-engine`, `packages/script-engine`, `packages/automation-engine` as separate workspace packages.
**Why bad:** Project.md explicitly chose single `language-services` package for shared primitives, consistent testing surface, and simpler build graph. Three packages means three tsup configs, three build steps, three dependency edges.
**Instead:** Single `packages/language-services` with internal `engines/formula/`, `engines/script/`, `engines/automation/` subdirectories.

---

## Build Order

The new package inserts between `shared` and `extension`:

```
1. scripts/check-tool-sync.mjs        (no deps — fast fail)
2. pnpm -F shared build               (ESM types — no deps)
3. pnpm -F language-services build    (NEW — depends on nothing in workspace; pure TS)
4. pnpm -F webview build              (depends on shared)
5. node scripts/bundle-mcp.mjs        (depends on mcp-server source)
6. pnpm -F airtable-formula build     (depends on shared + language-services)
```

Root `package.json` `build` script update:
```
"build": "node scripts/check-tool-sync.mjs && pnpm -F shared build && pnpm -F language-services build && pnpm -F webview build && node scripts/bundle-mcp.mjs && pnpm -F airtable-formula build"
```

Root `test` script update:
```
"test": "node scripts/check-tool-sync.mjs && pnpm -F shared test && pnpm -F language-services test && pnpm -F airtable-user-mcp test && pnpm -F webview test && pnpm -F airtable-formula test"
```

---

## New Package Configuration

`packages/language-services/package.json` follows the `shared` package pattern exactly — ESM, tsup, no VS Code dep:

```json
{
  "name": "@airtable-formula/language-services",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --out-dir dist",
    "test": "vitest run"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

The extension's `package.json` adds the workspace dependency:
```json
"dependencies": {
  "@airtable-formula/language-services": "workspace:*"
}
```

Because the extension builds to CJS via tsup (not Node ESM), tsup's bundler module resolution handles the ESM→CJS boundary at bundle time automatically — same pattern used for `@airtable-formula/shared` today.

---

## File-Level Change Summary

### New files to create

| File | Type | Content |
|------|------|---------|
| `packages/language-services/package.json` | Config | As above |
| `packages/language-services/tsconfig.json` | Config | Mirror shared: NodeNext, strict, declaration |
| `packages/language-services/src/index.ts` | Barrel | Re-export all engines + types |
| `packages/language-services/src/types.ts` | Types | `LsDiagnostic`, `LsRange`, `LsPosition`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp` |
| `packages/language-services/src/util/parser-context.ts` | Logic | `getExclusionRanges()` extracted from `diagnostics.ts` |
| `packages/language-services/src/util/levenshtein.ts` | Logic | `levenshteinDistance()` extracted from `diagnostics.ts` |
| `packages/language-services/src/util/position.ts` | Logic | `offsetToPosition()`, `positionToOffset()` |
| `packages/language-services/src/engines/formula/registry.ts` | Data | Move `FUNCTION_REGISTRY` + helpers from `extension/src/functions.ts` |
| `packages/language-services/src/engines/formula/validator.ts` | Logic | Extract all `check*` methods from `diagnostics.ts` |
| `packages/language-services/src/engines/formula/completions.ts` | Logic | Extract completion logic from `extension/src/completions.ts` |
| `packages/language-services/src/engines/formula/hover.ts` | Logic | Extract hover logic from `extension/src/hover.ts` |
| `packages/language-services/src/engines/formula/signature.ts` | Logic | Extract signature logic from `extension/src/signature.ts` |
| `packages/language-services/src/engines/formula/index.ts` | Facade | `FormulaEngine` class composing the above |
| `packages/language-services/src/engines/script/globals.ts` | Data | Scripting Extension global API registry |
| `packages/language-services/src/engines/script/validator.ts` | Logic | JS diagnostics scoped to script globals |
| `packages/language-services/src/engines/script/completions.ts` | Logic | Script global completions |
| `packages/language-services/src/engines/script/hover.ts` | Logic | Script global hover |
| `packages/language-services/src/engines/script/index.ts` | Facade | `ScriptEngine` class |
| `packages/language-services/src/engines/automation/globals.ts` | Data | Automation global API registry |
| `packages/language-services/src/engines/automation/validator.ts` | Logic | Automation diagnostics |
| `packages/language-services/src/engines/automation/completions.ts` | Logic | Automation completions |
| `packages/language-services/src/engines/automation/hover.ts` | Logic | Automation hover |
| `packages/language-services/src/engines/automation/index.ts` | Facade | `AutomationEngine` class |
| `packages/extension/src/language/convert.ts` | Adapter | `toVscodeDiagnostic()`, `toLsPosition()`, `fromLsHover()`, etc. |
| `packages/extension/src/language/formula-providers.ts` | Adapter | VS Code provider wrappers using `FormulaEngine` |
| `packages/extension/src/language/script-providers.ts` | Adapter | VS Code provider wrappers using `ScriptEngine` |
| `packages/extension/src/language/automation-providers.ts` | Adapter | VS Code provider wrappers using `AutomationEngine` |
| `packages/extension/src/language/registration.ts` | Registration | `registerLanguageProviders(context)` — all 3 engines |

### Files to modify

| File | Change |
|------|--------|
| `packages/extension/src/extension.ts` | Replace ~50 lines of inline provider registration with `registerLanguageProviders(context)` import |
| `packages/extension/src/diagnostics.ts` | Delete (content migrated to language-services + formula-providers.ts) |
| `packages/extension/src/completions.ts` | Delete (content migrated) |
| `packages/extension/src/hover.ts` | Delete (content migrated) |
| `packages/extension/src/signature.ts` | Delete (content migrated) |
| `packages/extension/src/functions.ts` | Delete (content moved to language-services/engines/formula/registry.ts) |
| `packages/extension/package.json` | Add `"@airtable-formula/language-services": "workspace:*"` |
| `package.json` (root) | Add `language-services` build step |

### Files that stay unchanged

`packages/extension/src/codeActions.ts` — code actions reference the diagnostics by code string (`'unknown-function'`, `'smart-quote'`, etc.) and use `vscode.CodeAction` directly. The diagnostic code strings will remain the same. Only update: import `ALL_CALLABLE` from `@airtable-formula/language-services/engines/formula` instead of `./functions`.

---

## Scalability Considerations

| Concern | Now (3 engines) | Later (N engines) |
|---------|-----------------|-------------------|
| Adding a new engine | Create `engines/<name>/` subtree + adapter + register one set of providers | Same pattern — no central registry to modify |
| Updating function metadata | Edit `engines/formula/registry.ts` once — all providers see the change | Same |
| Testing language logic | `vitest` runs against language-services with no VS Code host needed | Same |
| Extracting to true LSP | language-services already has LSP-shaped types; wrap in JSON-RPC layer | Language logic already portable |

---

## Sources

- Direct inspection: `packages/extension/src/{diagnostics,completions,hover,signature,functions}.ts`
- Direct inspection: `packages/extension/src/extension.ts` (provider registration pattern lines 183–240)
- Direct inspection: `packages/shared/src/types.ts` (export/module pattern to mirror)
- Direct inspection: `packages/shared/package.json` (tsup ESM build pattern to mirror)
- Direct inspection: `package.json` root (build script to extend)
- Project context: `.planning/PROJECT.md` (single language-services package decision, in-process over LSP)
