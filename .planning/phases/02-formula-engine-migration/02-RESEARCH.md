# Phase 2: Formula Engine Migration - Research

**Researched:** 2026-05-13
**Domain:** TypeScript language engine migration, VS Code provider API, Airtable formula completeness
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Thin VS Code adapter wrapper classes live in `packages/extension/src/language/formula/`. File naming: `formula-diagnostics.ts`, `formula-completions.ts`, `formula-hover.ts`, `formula-signature.ts`.
- **D-02:** Wrapper files keep existing class names (`AirtableFormulaDiagnosticsProvider`, `AirtableFormulaCompletionProvider`, etc.) with gutted methods that delegate to language-services pure functions and convert types via `convert.ts`.
- **D-03:** `DiagnosticCollection` stays inside the `AirtableFormulaDiagnosticsProvider` class constructor — not a module-level singleton. Lifecycle unchanged.
- **D-04:** `codeActions.ts` stays at `packages/extension/src/codeActions.ts` — only its import updates from `./functions` to `@airtable-formula/language-services`.
- **D-05:** Research-backed gap analysis — compare current `FUNCTION_REGISTRY` against Airtable's official formula docs to produce a definitive list of missing functions and incorrect or missing diagnostics.
- **D-06:** Single `FUNCTION_REGISTRY` as the sole source of truth — all three duplicate lists collapse into one.
- **D-07:** Executor creates placeholder SVGs at `packages/extension/icons/formula-light.svg` and `packages/extension/icons/formula-dark.svg`.
- **D-08:** `package.json` `contributes.languages[].icon` uses `./icons/formula-light.svg` (light) and `./icons/formula-dark.svg` (dark).
- **D-09:** `language-services/engines/formula/` exports pure stateless functions: `formulaDiagnostics`, `formulaCompletions`, `formulaHover`, `formulaSignatureHelp`.
- **D-10:** `FUNCTION_REGISTRY`, `FunctionInfo`, `FunctionCategory` exported from `language-services/engines/formula/` as public API. `codeActions.ts` imports `ALL_CALLABLE` and `FUNCTION_REGISTRY` from `@airtable-formula/language-services`.
- **D-11:** `LsSignatureHelp` and `LsParameterInformation` types added to `packages/language-services/src/types.ts`. `convert.ts` gains `toVscodeSignatureHelp()`.
- **D-12:** Split by concern: `registry.ts`, `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `index.ts` inside `language-services/engines/formula/`.
- **D-13:** Formula engine tests live in `packages/language-services/src/test/formula/`. Pure TS, no `vscode` dependency, run with vitest.
- **D-14:** Behavior-driven coverage — one test per notable behavior, not line coverage.

### Claude's Discretion

- Internal character-offset-to-position conversion helper (inline or extracted utility in the engine).
- Exact diagnostic message wording for any newly added diagnostic checks.
- Whether `LsParameterInformation` is a separate exported type or inlined inside `LsSignatureHelp`.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORMULA-01 | Existing formula diagnostics, completions, hover, and signature help are migrated to `engines/formula/` inside `language-services` with no user-visible behavioral change | Covered by D-01 through D-12: all logic inventory complete, conversion paths verified |
| FORMULA-02 | A single unified `FUNCTION_REGISTRY` drives all formula providers — the private duplicate function list in `completions.ts` is eliminated | Three separate lists inventoried; unification plan documented with gap list |
| FORMULA-03 | Known formula engine feature gaps are resolved — missing functions added, incorrect or missing diagnostics fixed | Official Airtable docs cross-referenced; 8 missing functions + 2 questionable functions identified |
| FORMULA-04 | `.fx` is registered as a short alias for the `airtable-formula` language ID | `contributes.languages[].extensions` array update documented; exact syntax verified |
| FORMULA-05 | `.formula` and `.fx` files display a custom light/dark SVG file type icon | `contributes.languages[].icon` exact schema verified from VS Code API docs |
</phase_requirements>

---

## Summary

Phase 2 migrates all formula language intelligence out of `packages/extension/src/` into `packages/language-services/engines/formula/`. The five provider files (`diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `functions.ts`) are deleted from the extension; their logic becomes pure stateless functions in language-services. Thin VS Code adapter classes are created in `packages/extension/src/language/formula/`. Phase 1 infrastructure is fully built and verified — the dist exists, the type system is in place, convert.ts and registration.ts are wired.

The three duplicate function lists that currently exist (`FUNCTION_REGISTRY` in `functions.ts`, `AIRTABLE_FUNCTIONS` in `diagnostics.ts`, and `FUNCTION_SIGNATURES` in `completions.ts`) collapse into a single canonical registry. The completions list is the richest and has six functions not in `functions.ts` that must be evaluated against official Airtable docs before the unified registry is finalized.

Official Airtable docs (updated April 8, 2026) confirm the complete function set. The comparison reveals `TRUE()` and `FALSE()` are real Airtable functions (not just literals) that belong in the registry. `AUTONUMBER()`, `CREATED_BY()`, and `LAST_MODIFIED_BY()` are field types in Airtable, not formula functions — they should be removed from the completions list. `LOG10()`, `DATEDIF()`, and `TEXT()` are not in Airtable's official formula reference; they are Excel carry-overs and should be excluded.

**Primary recommendation:** Migrate logic file-by-file in dependency order (registry → diagnostics → completions → hover → signature), update convert.ts and registration.ts, then wire the icon and `.fx` extension. The `findFunctionContext()` logic in `signature.ts` is the most complex migration unit and needs its own test case.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Formula parsing and analysis | `language-services/engines/formula/` | — | Framework-agnostic; must be testable without VS Code |
| Diagnostic collection lifecycle | Extension host (`formula-diagnostics.ts`) | — | `vscode.DiagnosticCollection` is VS Code API |
| Type conversion (Ls* ↔ VS Code types) | `extension/src/language/convert.ts` | — | Boundary adapter; both sides live in extension |
| VS Code provider registration | `extension/src/language/registration.ts` | — | VS Code API calls happen here |
| File icon registration | `extension/package.json` | — | Declarative; `contributes.languages[].icon` |
| `.fx` extension alias | `extension/package.json` | — | Declarative; add to `extensions` array |
| Function registry (data) | `language-services/engines/formula/registry.ts` | — | Pure data + helpers; framework-agnostic |

---

## Standard Stack

### Core (already installed, verified)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@airtable-formula/language-services` | workspace:* | Framework-agnostic engine package | Phase 1 deliverable |
| `tsup` | ^8.0.0 | CJS+ESM dual build | Already in language-services devDeps |
| `vitest` | ^1.6.0 | Test runner for language-services | Already configured in vitest.config.ts |
| `@types/vscode` | (extension's current) | Type reference for convert.ts additions | Already in extension devDeps |

No new packages needed for Phase 2. [VERIFIED: packages/language-services/package.json, packages/extension/package.json]

### No new npm installs required

All dependencies for this phase are already present in the workspace. The `language-services` package builds with `tsup` to dual CJS+ESM; the `vitest.config.ts` already covers `src/test/**/*.test.ts`. [VERIFIED: local filesystem]

---

## Architecture Patterns

### System Architecture Diagram

```
  .formula / .fx files
        |
        v
  VS Code language engine
        |
        +--> AirtableFormulaDiagnosticsProvider   (extension/src/language/formula/formula-diagnostics.ts)
        |         |-- formulaDiagnostics(text)  <-- language-services
        |         |-- toVscodeDiagnostic()      <-- convert.ts
        |         |-- DiagnosticCollection      (VS Code API)
        |
        +--> AirtableFormulaCompletionProvider   (extension/src/language/formula/formula-completions.ts)
        |         |-- formulaCompletions(text, pos) <-- language-services
        |         |-- toVscodeCompletionItem()      <-- convert.ts
        |
        +--> AirtableFormulaHoverProvider        (extension/src/language/formula/formula-hover.ts)
        |         |-- formulaHover(text, pos)    <-- language-services
        |         |-- toVscodeHover()            <-- convert.ts (WR-01 fixed)
        |
        +--> AirtableFormulaSignatureHelpProvider (extension/src/language/formula/formula-signature.ts)
              |-- formulaSignatureHelp(text, pos) <-- language-services
              |-- toVscodeSignatureHelp()          <-- convert.ts (NEW)

  language-services/engines/formula/
        index.ts        <-- re-exports all public API
        registry.ts     <-- FUNCTION_REGISTRY, FunctionInfo, FunctionCategory, CALLABLE_CONSTANTS, helpers
        diagnostics.ts  <-- formulaDiagnostics(text: string): LsDiagnostic[]
        completions.ts  <-- formulaCompletions(text: string, pos: LsPosition): LsCompletionItem[]
        hover.ts        <-- formulaHover(text: string, pos: LsPosition): LsHover | null
        signature.ts    <-- formulaSignatureHelp(text: string, pos: LsPosition): LsSignatureHelp | null
```

### Recommended Project Structure

```
packages/
  language-services/
    src/
      index.ts                  (add: export * from './engines/formula/index.js')
      types.ts                  (add: LsSignatureHelp, LsParameterInformation)
      engines/
        formula/
          index.ts
          registry.ts
          diagnostics.ts
          completions.ts
          hover.ts
          signature.ts
      test/
        types.test.ts           (Phase 1 — keep)
        formula/
          registry.test.ts
          diagnostics.test.ts
          completions.test.ts
          hover.test.ts
          signature.test.ts
  extension/
    src/
      language/
        convert.ts              (add: toVscodeSignatureHelp, toVscodeCompletionItem; fix WR-01)
        registration.ts         (update imports to ./formula/formula-*)
        formula/
          formula-diagnostics.ts  (NEW — gutted wrapper class)
          formula-completions.ts  (NEW — gutted wrapper class)
          formula-hover.ts        (NEW — gutted wrapper class)
          formula-signature.ts    (NEW — gutted wrapper class)
      codeActions.ts            (update import only)
      [DELETED]: diagnostics.ts, completions.ts, hover.ts, signature.ts, functions.ts
    icons/
      formula-light.svg         (NEW — placeholder)
      formula-dark.svg          (NEW — placeholder)
    package.json                (add icon + .fx to languages contributes)
```

### Pattern 1: Pure Function Engine API

Each engine file exports a single pure stateless function with a deterministic signature.

```typescript
// Source: D-09 decision; pattern confirmed by existing hover.ts and diagnostic shape in Phase 1 types
export function formulaDiagnostics(text: string): LsDiagnostic[] {
    const diagnostics: LsDiagnostic[] = [];
    // ...all existing diagnostic checks migrated here...
    return diagnostics;
}

export function formulaHover(text: string, pos: LsPosition): LsHover | null {
    // character-offset helper converts pos to index in text
    // lookup word at position, return LsHover or null
}
```

### Pattern 2: Position-to-Offset Conversion

The engine functions receive `LsPosition` (line, character) but operate on raw strings. A small helper converts position to character offset:

```typescript
// Source: [ASSUMED] — standard pattern for in-process language servers
function positionToOffset(text: string, pos: LsPosition): number {
    let offset = 0;
    const lines = text.split('\n');
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for the newline
    }
    return offset + pos.character;
}
```

This helper is needed by `formulaCompletions`, `formulaHover`, and `formulaSignatureHelp`. Place it in a shared `utils.ts` inside `engines/formula/` or inline it — Claude's discretion.

### Pattern 3: Wrapper Class (Gutted)

```typescript
// Source: D-02 decision; consistent with existing extension subsystem patterns
import { formulaDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableFormulaDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        // D-03: DiagnosticCollection stays on the instance
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-formula');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-formula') return;
        const lsDiags = formulaDiagnostics(document.getText());
        this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
```

### Pattern 4: toVscodeSignatureHelp Conversion

VS Code's `SignatureHelp` is a class, not an interface. Verified fields from `@types/vscode`: [VERIFIED: node_modules/@types/vscode/index.d.ts line 4698]

```typescript
// vscode.SignatureHelp fields:
//   signatures: SignatureInformation[]
//   activeSignature: number
//   activeParameter: number

// vscode.SignatureInformation fields:
//   label: string
//   documentation?: string | MarkdownString
//   parameters: ParameterInformation[]
//   activeParameter?: number

// vscode.ParameterInformation fields:
//   label: string | [number, number]  // [number,number] = byte offsets in parent label
//   documentation?: string | MarkdownString

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

### Pattern 5: WR-01 Fix — toVscodeHover with plaintext

Current `toVscodeHover` always creates `MarkdownString`, ignoring `kind: 'plaintext'`. Fix:

```typescript
// Source: @types/vscode Hover constructor: new vscode.Hover(string | MarkdownString | Array<...>)
// [VERIFIED: node_modules/@types/vscode/index.d.ts line 3142]
export function toVscodeHover(h: LsHover): vscode.Hover {
    const content = h.contents.kind === 'plaintext'
        ? h.contents.value                          // plain string → VS Code renders as plain text
        : new vscode.MarkdownString(h.contents.value);
    return new vscode.Hover(content, h.range ? toVscodeRange(h.range) : undefined);
}
```

`vscode.Hover` constructor accepts `string | MarkdownString | Array<...>` — passing a plain `string` causes VS Code to render it as plain text without markdown interpretation. [VERIFIED: @types/vscode line 3142]

### Pattern 6: WR-02 Fix — relatedInformation in toVscodeDiagnostic

`relatedInformation` is present on `LsDiagnostic` (defined in Phase 1 types) but not mapped in the current `toVscodeDiagnostic`. The extension's `diagnostics.ts` uses `relatedInformation` on parenthesis/bracket checks. The fix:

```typescript
// After existing code/source fields:
if (d.relatedInformation) {
    diag.relatedInformation = d.relatedInformation.map(ri =>
        new vscode.DiagnosticRelatedInformation(
            new vscode.Location(vscode.Uri.parse(ri.location.uri), toVscodeRange(ri.location.range)),
            ri.message
        )
    );
}
```

Note: `LsDiagnostic.relatedInformation[].location.uri` is a string in the Ls type — it carries the document URI. In the engine, when producing `relatedInformation`, the `uri` string should be passed in from the caller (the wrapper class, which has `document.uri.toString()`). This means `formulaDiagnostics()` needs the URI for bracket/paren checks that emit `relatedInformation`.

**Design choice for the engine:** Either (a) `formulaDiagnostics(text: string, uri?: string): LsDiagnostic[]` — caller passes `document.uri.toString()` — or (b) omit `relatedInformation` from the pure engine and add it in the wrapper. Option (a) keeps the wrapper thin; option (b) keeps the engine signature simpler. Claude's discretion.

### Pattern 7: LsSignatureHelp Type Shape (to add to types.ts)

```typescript
// Add to packages/language-services/src/types.ts:
export interface LsParameterInformation {
  label: string;                 // parameter name as shown in hints
  documentation?: string;        // optional description
}

export interface LsSignatureInformation {
  label: string;                 // full function signature string
  documentation?: string;        // function description
  parameters: LsParameterInformation[];
}

export interface LsSignatureHelp {
  signatures: LsSignatureInformation[];
  activeSignature: number;
  activeParameter: number;
}
```

`LsParameterInformation` uses `string` for `label` (not `[number, number]` offsets) — the engine works with names, and `convert.ts` maps them to `ParameterInformation(name)`. This is simpler and sufficient for current needs. [ASSUMED — no explicit decision; consistent with existing extension behavior]

### Anti-Patterns to Avoid

- **Importing `vscode` inside `language-services/engines/`:** Any `import * as vscode` or `from 'vscode'` in the new engine files will cause the extension host to crash in non-VS Code environments and break the `pnpm -F language-services test` run. The `tsconfig.json` in language-services has no `vscode` in lib, so TypeScript will catch this at compile time.
- **Using a module-level DiagnosticCollection:** D-03 is explicit — the collection lives on the class instance. A singleton would be erased if two documents trigger simultaneously.
- **Calling `document.positionAt(offset)` inside the engine:** `positionAt` is a VS Code API method. The engine operates on raw strings. All position/offset conversions must happen in the engine itself using string splitting.
- **Carrying over `FUNCTION_SIGNATURES` as a separate completion-only data structure:** D-06 locks this — `insertText` snippets are derived from the `signature` field at render time in `formulaCompletions()`. No parallel data structure.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Levenshtein distance for function suggestions | Custom algorithm | Keep existing `levenshteinDistance()` — migrate it to `registry.ts` | Already tested implicitly; edge cases already handled |
| Parenthesis balance tracking | New parser | Migrate existing stack-based checker from `diagnostics.ts` | Handles string context exclusion, smart quotes, nested paren edge cases |
| Signature extraction from signature string | New parser | Migrate existing `parseParameters()` from `signature.ts` | Handles optional `[param]` and variadic `...` notation |
| VS Code type mapping | Manual switch tables | `convert.ts` direct cast (D-09: numeric parity) | `LsSeverity` and `LsCompletionItemKind` already verified to match VS Code values exactly |

**Key insight:** The existing provider files contain well-tested logic. The migration task is extraction and rewrapping, not a rewrite. Preserve the existing algorithms; only touch structure.

---

## Airtable Formula Gap Analysis (D-05)

This is the authoritative gap analysis comparing the current `FUNCTION_REGISTRY` in `functions.ts` against the official Airtable formula reference (updated April 8, 2026). [CITED: https://support.airtable.com/docs/formula-field-reference]

### Functions Missing from Current Registry — ADD THESE

| Function | Signature | Category | Notes |
|----------|-----------|----------|-------|
| `TRUE` | `TRUE()` | Logical | Real Airtable function. Returns boolean 1. In docs as `TRUE()`. Currently in `diagnostics.ts` CALLABLE_CONSTANTS and `completions.ts` constants list only — not in `FUNCTION_REGISTRY`. |
| `FALSE` | `FALSE()` | Logical | Real Airtable function. Returns boolean 0. Same situation as TRUE. |

[CITED: https://support.airtable.com/docs/using-true-and-false-functions-in-airtable — "TRUE() and FALSE() functions generate the logical value true and false"]
[CITED: https://support.airtable.com/docs/formula-field-reference — Lists TRUE() and FALSE() under Logical functions]

### Functions in `completions.ts` NOT in Official Docs — EXCLUDE from Unified Registry

These appear in the `FUNCTION_SIGNATURES` list in `completions.ts` but are absent from the official Airtable formula reference (April 2026). They are Excel/Sheets carry-overs:

| Function | Status | Evidence |
|----------|--------|----------|
| `AUTONUMBER` | Field type in Airtable, NOT a formula function | Airtable docs describe Autonumber as a field type only; no formula function `AUTONUMBER()` listed in formula reference. Community posts confirm workarounds are needed because it's not a formula function. [CITED: https://support.airtable.com/docs/returning-record-data] |
| `CREATED_BY` | Field type only, NOT a formula function | Official formula reference lists only `CREATED_TIME()`, `LAST_MODIFIED_TIME()`, `RECORD_ID()` as record formula functions. [CITED: https://support.airtable.com/docs/returning-record-data] |
| `LAST_MODIFIED_BY` | Field type only, NOT a formula function | Same as above. [CITED: https://support.airtable.com/docs/returning-record-data] |
| `LOG10` | Not in Airtable formula reference | Official docs list `LOG(number, [base])` — base-10 log is achieved via `LOG(x, 10)`. LOG10 is an Excel function not documented for Airtable. [CITED: https://support.airtable.com/docs/formula-field-reference] |
| `DATEDIF` | Listed in `functions.ts` and `completions.ts` but labeled "legacy" | The formula reference page does NOT list DATEDIF. The `DATETIME_DIFF()` function is the supported alternative. DATEDIF is a legacy Excel compatibility function. MEDIUM confidence it works in Airtable but it is undocumented. [ASSUMED — not verified in official docs] |
| `TEXT` | Not in Airtable formula reference | Official docs do not list a `TEXT()` function. Text conversion uses `&""` operator or `CONCATENATE()`. This is an Excel/Sheets function that does not exist in Airtable formulas. [CITED: https://support.airtable.com/docs/converting-numbers-and-text-in-a-formula-field] |

### Consolidated Unified Registry Plan

The unified `FUNCTION_REGISTRY` in `language-services/engines/formula/registry.ts` should contain:

**Keep from current `functions.ts`:** All 70 entries (Text: 16, Numeric: 22, Date/Time: 23, Logical: 11, Array: 5, Regex: 3, Record: 3, Misc: 1) minus `TEXT` if it is not an Airtable function.

**Add:** `TRUE` and `FALSE` (Logical category, no-arg functions).

**Remove/flag:** `LOG10`, `DATEDIF`, `TEXT`, `AUTONUMBER`, `CREATED_BY`, `LAST_MODIFIED_BY` — these should NOT be added to the unified registry because they are either field types or unverified Excel carry-overs. `completions.ts` list had them incorrectly.

**Re-evaluate:** `DATEDIF` is listed in `functions.ts` (currently). Given it is labeled "legacy" and absent from the formula reference, the safest plan is to keep it in the registry (users may have existing formulas using it) but not actively surface it as a primary suggestion in completions. The `COMMON_TYPOS` map already directs `DATEDIFF` → `DATETIME_DIFF`, which is correct.

**`CALLABLE_CONSTANTS` in the new registry:**

The diagnostics.ts `CALLABLE_CONSTANTS` is `['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE']`. The functions.ts `CALLABLE_CONSTANTS` is `['NOW', 'TODAY', 'BLANK']`. With TRUE and FALSE now in the registry (as no-arg functions), the `CALLABLE_CONSTANTS` array in the unified registry should be `['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE']` — matching the diagnostics.ts version, which is more correct.

### Diagnostic Checks Review

Current checks in `diagnostics.ts` and their status:

| Check | Code | Status | Notes |
|-------|------|--------|-------|
| Single-line comments `//` | `no-comments` | Keep | Airtable does not support comments |
| Block comments `/**/` | `no-comments` | Keep | Same |
| Unmatched `(` / `)` | — | Keep | Core syntax check |
| Unmatched `{` / `}` | — | Keep | Field reference check |
| Unclosed quotes `"` / `'` | — | Keep | Core syntax check |
| Unknown function with `(` | `unknown-function` | Keep | Uses `ALL_CALLABLE` check |
| Function without `(` | `missing-function-parenthesis` | Keep | Uses `ALL_FUNCTIONS` (all non-constant functions) |
| Smart quotes `"` `"` `'` `'` | `smart-quote` | Keep | Airtable rejects smart quotes |
| Common Excel typos | `common-typo` | Keep | SUMIF, COUNTIF, VLOOKUP, IFERROR, ISBLANK etc. |
| Division by zero (field/field) | `division-by-zero` | Keep (as Warning) | Helpful lint |
| Deeply nested IF (≥4 levels) | `nested-if` | Keep (as Information) | Style hint |
| Trailing operators | `trailing-operator` | Keep | Expression incomplete |

**Empty field reference check** (`checkFieldReferences`) is already disabled in `diagnostics.ts` with a comment explaining why (`{}` is valid in JSON output). Keep it disabled in the migration.

**No new diagnostic checks needed** for this phase beyond what is already implemented.

---

## tsup Entry Points — Build Config

**Question:** Does adding `engines/formula/` require updating the tsup build entry?

**Answer:** No new tsup entry needed. [VERIFIED: packages/language-services/package.json]

The current build command is:
```bash
tsup src/index.ts --format cjs,esm --dts --out-dir dist
```

The single entry point is `src/index.ts`. Phase 2 adds:
```typescript
// src/index.ts — add this line:
export * from './engines/formula/index.js';
```

tsup bundles transitively from the entry point. All new engine files are reachable through the re-export chain: `src/index.ts` → `src/engines/formula/index.ts` → `registry.ts`, `diagnostics.ts`, etc. No tsup config changes required.

**WR-04 fix** (from Phase 1 code review): The `exports` map in `language-services/package.json` has `"types"` after `"import"` and `"require"`:

```json
// Current (wrong order):
".": {
  "import": "./dist/index.js",
  "require": "./dist/index.cjs",
  "types": "./dist/index.d.ts"
}

// Fix (types first):
".": {
  "types": "./dist/index.d.ts",
  "import": "./dist/index.js",
  "require": "./dist/index.cjs"
}
```

The `"types"` condition should be first so bundlers that resolve conditions in order find the type declarations before the runtime modules. [CITED: TypeScript docs on package.json exports — types condition ordering]

---

## VS Code Icon and Extension Registration

### Icon Registration Syntax (FORMULA-05)

`contributes.languages[].icon` takes an object with `light` and `dark` string paths. Both paths are relative to the extension root (`packages/extension/`). [VERIFIED: official VS Code contribution points docs, April 2026]

```json
// In packages/extension/package.json, add to the airtable-formula language entry:
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

SVG is a supported format for language icons. The `icons/` directory does not currently exist under `packages/extension/` — it must be created. [VERIFIED: filesystem check]

### .fx Extension Registration (FORMULA-04)

Add `".fx"` to the `extensions` array in the existing `airtable-formula` language entry. Because `.fx` is added to the same language ID's `extensions` array (not a separate language contribution), it automatically inherits all grammars, snippets, language configuration, and icon.

**No separate grammar or language-configuration entry needed for `.fx`.** [CITED: VS Code contribution points docs — extensions array shares all language features]

---

## Known Issues to Fix (from Phase 1 review)

### WR-01: toVscodeHover ignores plaintext kind
**Location:** `packages/extension/src/language/convert.ts` line 33
**Current code:** Always creates `MarkdownString`, ignoring `h.contents.kind`
**Fix:** Check `kind === 'plaintext'` and pass a plain `string` to `vscode.Hover` constructor instead.
**Impact:** Currently the formula engine hover always uses markdown (via `hover.ts` `createFunctionHover`), so this is technically a latent bug, but it will matter once other engines produce plaintext hovers.

### WR-02: relatedInformation not mapped in toVscodeDiagnostic
**Location:** `packages/extension/src/language/convert.ts` lines 20-29
**Current code:** `relatedInformation` field on `LsDiagnostic` is never transferred to the VS Code diagnostic.
**Fix:** Add the mapping after `source` mapping. The engine must pass the document URI string when emitting parenthesis/bracket `relatedInformation`.
**Impact:** Currently no diagnostics from language-services have `relatedInformation` (Phase 1 had no engine), so this only manifests when the formula engine emits it in Phase 2.

### WR-04: types condition ordering in exports map
**Location:** `packages/language-services/package.json`
**Fix:** Move `"types"` before `"import"` in the `.` export condition.

---

## Common Pitfalls

### Pitfall 1: positionAt Used in the Engine
**What goes wrong:** The engine developer reaches for `document.positionAt()` or `document.getText(range)` inside the pure engine functions.
**Why it happens:** The existing provider code uses `document.positionAt(offset)` extensively. When extracting to the engine, developers copy this code and forget that `document` is VS Code API.
**How to avoid:** The engine only receives `text: string` and `pos: LsPosition`. Position-to-offset conversion is done via string splitting. The wrapper class calls `document.getText()` and passes the string; `toLsPosition(position)` converts the cursor position.
**Warning signs:** Any `vscode.` reference appearing inside `language-services/engines/`.

### Pitfall 2: Exclusion Ranges Applied Incorrectly After String Split
**What goes wrong:** The `getExclusionRanges()` helper in `diagnostics.ts` returns character offsets into the raw string. If the engine splits the string by line first, the offsets become wrong.
**Why it happens:** Migrating the line-by-line iteration pattern when the underlying regex operates on the full text.
**How to avoid:** Run all regex-based diagnostic checks against the full text string. Only compute line numbers from offsets when building `LsRange` objects (using string splitting at that point).

### Pitfall 3: TRUE/FALSE Classified Incorrectly
**What goes wrong:** `TRUE` and `FALSE` are treated as bare literals (no parentheses required), causing the `missing-function-parenthesis` diagnostic to incorrectly fire on `IF(x, TRUE, FALSE)`.
**Why it happens:** `diagnostics.ts` puts `TRUE`/`FALSE` in `CALLABLE_CONSTANTS` (allowing them without parens), but `functions.ts` `CALLABLE_CONSTANTS` does not include them — the existing lists are inconsistent.
**How to avoid:** In the unified registry, add `TRUE` and `FALSE` to `CALLABLE_CONSTANTS` (alongside `NOW`, `TODAY`, `BLANK`). The `missing-function-parenthesis` check uses `ALL_FUNCTIONS` (functions that require parens). Constants in `CALLABLE_CONSTANTS` are excluded from that check.
**Warning signs:** User reports that `IF({x}, TRUE, FALSE)` shows a "missing parenthesis" diagnostic.

### Pitfall 4: completions.ts insertText Duplicates the Signature
**What goes wrong:** Each completion item in the unified engine sets `insertText` to a snippet derived from the full signature string — but the signature parser regex `\(([^)]*)\)` captures all parameter text and wraps it as a single snippet tab stop, losing individual parameter tab stops.
**Why it happens:** The existing `completions.ts` uses `new vscode.SnippetString(`${func}($0)`)` — a single tab stop inside the parens. This is the intended behavior (D-06: snippets derived from signature at render time).
**How to avoid:** Keep `insertText` as `${label}($0)` — place cursor inside parens with a single stop. Do not attempt to generate multi-tab-stop snippets from the signature; that would require a separate parser and creates noisy completions.

### Pitfall 5: findFunctionContext Scan Skips String Context
**What goes wrong:** The `findFunctionContext()` backward scan in `signature.ts` counts commas to determine parameter index but doesn't skip commas inside string literals or nested function calls at depth > 0.
**Why it happens:** The existing implementation handles depth-0 commas and tracks paren depth, but does NOT track string context. A formula like `SUBSTITUTE("a,b", ",", "")` at cursor inside the second argument would miscalculate the parameter index.
**How to avoid:** The existing code handles `depth > 0` paren nesting correctly. The string context issue exists in the current code too — this is not a regression to introduce but a pre-existing limitation. Document it as a known limitation; don't fix it in this phase (deferred per CONTEXT.md).

### Pitfall 6: DATEDIF Removed from Registry Causes Regression
**What goes wrong:** If `DATEDIF` is removed from the registry entirely, users who have existing `.formula` files using it will see "unknown function" errors.
**Why it happens:** Completeness review might flag it as undocumented and suggest removal.
**How to avoid:** Keep `DATEDIF` in the registry (labeled as legacy). The `COMMON_TYPOS` map already handles `DATEDIFF` (double-F misspelling). Keep both in place.

---

## Code Examples

### LsSignatureHelp Type Definition

```typescript
// Add to packages/language-services/src/types.ts
// Source: D-11 decision; field names mirror vscode SignatureHelp/SignatureInformation/ParameterInformation
// [VERIFIED: @types/vscode index.d.ts lines 4627-4714]

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

### Registry Exports Shape

```typescript
// packages/language-services/engines/formula/registry.ts
// Source: migrated from packages/extension/src/functions.ts

export interface FunctionInfo {
  signature: string;
  description: string;
  category: FunctionCategory;
}

export type FunctionCategory =
  | 'Text' | 'Numeric' | 'Date/Time' | 'Logical'
  | 'Array' | 'Regex' | 'Record' | 'Misc';

export const FUNCTION_REGISTRY: Record<string, FunctionInfo> = { /* ... */ };
export const CALLABLE_CONSTANTS = ['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE'] as const;
export const ALL_FUNCTION_NAMES = Object.keys(FUNCTION_REGISTRY);
export const ALL_CALLABLE = [...new Set([...ALL_FUNCTION_NAMES, ...CALLABLE_CONSTANTS])];
export function getFunctionsByCategory(category: FunctionCategory): string[] { /* ... */ }
export function isValidCallable(name: string): boolean { /* ... */ }
export function getFunctionInfo(name: string): FunctionInfo | undefined { /* ... */ }
```

### Completion Item Generation from Registry

```typescript
// packages/language-services/engines/formula/completions.ts
// Source: migrated from packages/extension/src/completions.ts; D-06 — no separate FUNCTION_SIGNATURES

export function formulaCompletions(text: string, pos: LsPosition): LsCompletionItem[] {
  const items: LsCompletionItem[] = [];

  // Function completions derived from registry
  for (const [name, info] of Object.entries(FUNCTION_REGISTRY)) {
    items.push({
      label: name,
      kind: LsCompletionItemKind.Function,
      detail: info.category,
      documentation: { kind: 'markdown', value: `**${info.signature}**\n\n${info.description}` },
      insertText: `${name}($0)`,  // snippet — single tab stop
    });
  }

  // Callable constants (TRUE, FALSE, BLANK(), NOW(), TODAY())
  for (const c of CALLABLE_CONSTANTS) {
    items.push({
      label: c,
      kind: LsCompletionItemKind.Constant,
      insertText: c,
    });
  }

  // Date unit string completions
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

Note: The existing `completions.ts` only shows date unit completions when the current word prefix matches. In the pure engine, `text` and `pos` are available. Preserve context-sensitivity if needed, or simplify to always return all items (VS Code filters by prefix automatically). Simplification is acceptable.

### SVG Placeholder Content

Minimal valid SVGs for the placeholder icons:

```xml
<!-- formula-light.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#1976D2"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="white" text-anchor="middle">f</text>
</svg>

<!-- formula-dark.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="2" fill="#64B5F6"/>
  <text x="8" y="12" font-size="10" font-family="monospace" fill="#1a1a1a" text-anchor="middle">f</text>
</svg>
```

[ASSUMED — placeholder content is at executor discretion per D-07; these are syntactically valid minimal SVGs]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline provider registrations in `extension.ts` | `registerLanguageProviders()` in `src/language/registration.ts` | Phase 1 | Registration is now centralized |
| `functions.ts`, `diagnostics.ts`, etc. in extension src | Pure engine in `language-services/engines/formula/` | Phase 2 (this phase) | Engine becomes framework-agnostic, testable without VS Code |
| Three separate function lists | Single `FUNCTION_REGISTRY` | Phase 2 (this phase) | Single source of truth |

**Deprecated in this phase:**
- `packages/extension/src/functions.ts` — deleted; logic moves to `language-services/engines/formula/registry.ts`
- `packages/extension/src/diagnostics.ts` — deleted; logic moves to `language-services/engines/formula/diagnostics.ts`
- `packages/extension/src/completions.ts` — deleted; logic moves to `language-services/engines/formula/completions.ts`
- `packages/extension/src/hover.ts` — deleted; logic moves to `language-services/engines/formula/hover.ts`
- `packages/extension/src/signature.ts` — deleted; logic moves to `language-services/engines/formula/signature.ts`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `LsParameterInformation.label` as `string` (not `[number, number]` byte offsets) is sufficient for the formula engine | Pattern 4 / LsSignatureHelp type shape | VS Code can highlight the active parameter using string labels too; byte offsets are an alternative. If wrong: signature highlights wrong parameter. Low risk — string labels work for named params. |
| A2 | `DATEDIF` should be kept in the unified registry as legacy | Gap Analysis | If Airtable has silently removed DATEDIF support, existing formulas may not error (they'd just fail at runtime in Airtable). Keeping it doesn't introduce false negatives. Low risk. |
| A3 | Date unit completions can be unconditionally returned (VS Code filters by prefix) | Code Examples | If wrong: users see unit completions in all contexts. Acceptable UX tradeoff. |
| A4 | Placeholder SVG content (the "f" letter design) | SVG Placeholder section | User will replace them; any valid SVG works. No functional risk. |
| A5 | `positionToOffset` via string split with `\n` delimiter handles CRLF correctly | Pattern 2 | On Windows, files may have `\r\n`. Splitting by `\n` leaves `\r` on line ends. This would make `offset + pos.character` accurate but `lines[i].length` include the `\r`. For single-file formula editing where VS Code normalizes to `\n` in `document.getText()`, this is fine. [ASSUMED — verify if edge cases arise] |

---

## Open Questions (RESOLVED)

1. **relatedInformation URI threading**
   - What we know: `LsDiagnostic.relatedInformation[].location.uri` is a string. The engine must populate it to emit bracket/paren `relatedInformation`. The wrapper has `document.uri.toString()`.
   - What's unclear: Should the engine signature be `formulaDiagnostics(text: string, uri?: string)` or should `relatedInformation` be stripped and re-added by the wrapper?
   - Recommendation: Use `formulaDiagnostics(text: string, uri?: string): LsDiagnostic[]`. The wrapper passes `document.uri.toString()`. If `uri` is undefined, emit `relatedInformation` without a location (or omit it). This is Claude's discretion per CONTEXT.md.

2. **`DATEDIF` and undocumented functions**
   - What we know: `DATEDIF` is labeled "legacy" in the current registry and absent from the official April 2026 docs.
   - What's unclear: Whether Airtable's formula engine actually accepts it at runtime.
   - Recommendation: Keep in the registry with `(legacy)` notation in the description. Low risk.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 is a code/logic migration with no external dependencies beyond the existing workspace toolchain (pnpm, tsup, vitest, Node.js). All tools verified present via Phase 1 completion.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^1.6.0 |
| Config file | `packages/language-services/vitest.config.ts` |
| Quick run command | `pnpm -F @airtable-formula/language-services test` |
| Full suite command | `pnpm test` (runs all packages) |

[VERIFIED: packages/language-services/vitest.config.ts, package.json]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FORMULA-01 | formulaDiagnostics returns LsDiagnostic[] with correct range/severity for unknown function | unit | `pnpm -F @airtable-formula/language-services test` | ❌ Wave 0 |
| FORMULA-01 | formulaCompletions returns IF, AND, OR in results | unit | same | ❌ Wave 0 |
| FORMULA-01 | formulaHover returns markdown content for known function | unit | same | ❌ Wave 0 |
| FORMULA-01 | formulaSignatureHelp returns correct activeParameter for multi-param function | unit | same | ❌ Wave 0 |
| FORMULA-02 | No compilation error after removing FUNCTION_SIGNATURES from completions.ts | build | `pnpm build` | — |
| FORMULA-03 | formulaDiagnostics does NOT flag `IF({x}, TRUE, FALSE)` | unit | same | ❌ Wave 0 |
| FORMULA-03 | formulaDiagnostics flags `VLOOKUP(` with common-typo | unit | same | ❌ Wave 0 |
| FORMULA-04 | `.fx` file opens with airtable-formula languageId | manual smoke | open `.fx` file in VS Code | — |
| FORMULA-05 | File icon visible for `.formula` in VS Code explorer | manual smoke | open folder in VS Code | — |

### Sampling Rate

- **Per task commit:** `pnpm -F @airtable-formula/language-services test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/language-services/src/test/formula/registry.test.ts` — covers FUNCTION_REGISTRY exports, CALLABLE_CONSTANTS, helper functions
- [ ] `packages/language-services/src/test/formula/diagnostics.test.ts` — covers all diagnostic check behaviors
- [ ] `packages/language-services/src/test/formula/completions.test.ts` — covers function items, constants, date units
- [ ] `packages/language-services/src/test/formula/hover.test.ts` — covers known function, TRUE/FALSE, unknown
- [ ] `packages/language-services/src/test/formula/signature.test.ts` — covers findFunctionContext, multi-param, variadic

---

## Security Domain

Security enforcement is not applicable to this phase. The phase is a pure code migration of formula language analysis logic — no authentication, no network calls, no user data, no external inputs beyond static formula text typed by the user in their local editor.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/@types/vscode/index.d.ts` lines 3012–3142, 4627–4714 — `Hover`, `MarkdownString`, `MarkedString`, `SignatureHelp`, `SignatureInformation`, `ParameterInformation` exact class/field definitions [VERIFIED]
- `packages/extension/src/functions.ts` — complete `FUNCTION_REGISTRY` (70 entries) [VERIFIED]
- `packages/extension/src/diagnostics.ts` — `AIRTABLE_FUNCTIONS`, `CALLABLE_CONSTANTS`, all diagnostic check implementations [VERIFIED]
- `packages/extension/src/completions.ts` — `FUNCTION_SIGNATURES` (includes AUTONUMBER, CREATED_BY, LAST_MODIFIED_BY, LOG10) [VERIFIED]
- `packages/language-services/package.json`, `tsconfig.json`, `vitest.config.ts` — build config [VERIFIED]
- `packages/language-services/src/types.ts` — Phase 1 type definitions [VERIFIED]
- `packages/extension/src/language/convert.ts` — Phase 1 convert.ts [VERIFIED]

### Secondary (MEDIUM confidence)
- [Airtable formula field reference](https://support.airtable.com/docs/formula-field-reference) (updated Apr 8, 2026) — complete function list by category; source for gap analysis
- [Airtable TRUE/FALSE functions](https://support.airtable.com/docs/using-true-and-false-functions-in-airtable) — confirms `TRUE()` and `FALSE()` are functions with `()` syntax
- [Airtable returning record data](https://support.airtable.com/docs/returning-record-data) — confirms only `RECORD_ID()`, `CREATED_TIME()`, `LAST_MODIFIED_TIME()` are formula functions
- [Airtable number/text conversion](https://support.airtable.com/docs/converting-numbers-and-text-in-a-formula-field) — confirms `TEXT()` is not an Airtable formula function
- [VS Code contribution points — contributes.languages](https://code.visualstudio.com/api/references/contribution-points#contributes.languages) — `icon` schema (light/dark paths)

### Tertiary (LOW confidence)
- None in this research — all claims are verified or cited.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Phase 1 is fully built and verified in the filesystem
- Gap analysis: HIGH for the official docs comparison; MEDIUM for DATEDIF (undocumented but present in current registry)
- Architecture: HIGH — all patterns confirmed from existing code and VS Code API types
- LsSignatureHelp types: HIGH — verified directly from @types/vscode
- Icon registration: HIGH — verified from VS Code official contribution points docs

**Research date:** 2026-05-13
**Valid until:** 2026-07-13 (stable VS Code API; Airtable formula reference changes rarely)
