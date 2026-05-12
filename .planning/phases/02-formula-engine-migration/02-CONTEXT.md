# Phase 2: Formula Engine Migration - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract all formula language intelligence from the extension into `packages/language-services/engines/formula/`. The five existing provider files (`diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `functions.ts`) are deleted from `packages/extension/src/`; their logic becomes framework-agnostic pure functions in `language-services`. Thin VS Code wrapper classes are created in `packages/extension/src/language/formula/`. A single `FUNCTION_REGISTRY` becomes the sole source of truth. Research-backed formula feature gaps are identified and fixed. `.fx` is registered as a language alias. Custom SVG file icons are wired up.

</domain>

<decisions>
## Implementation Decisions

### VS Code Wrapper Structure

- **D-01:** Thin VS Code adapter wrapper classes live in `packages/extension/src/language/formula/` (new subdirectory). File naming: `formula-diagnostics.ts`, `formula-completions.ts`, `formula-hover.ts`, `formula-signature.ts`. Mirrors the `src/mcp/`, `src/auto-config/` subsystem pattern established in Phase 1.
- **D-02:** Wrapper files keep the existing class structure — named classes (`AirtableFormulaDiagnosticsProvider`, `AirtableFormulaCompletionProvider`, etc.) with gutted `provide*()` / `updateDiagnostics()` methods that delegate to language-services pure functions and convert types via `convert.ts`.
- **D-03:** `DiagnosticCollection` stays inside the `AirtableFormulaDiagnosticsProvider` class constructor (field on the instance) — not a module-level singleton. Lifecycle unchanged from Phase 1 wiring.
- **D-04:** `codeActions.ts` is NOT moved — it stays at `packages/extension/src/codeActions.ts`. Only its import updates: `from './functions'` → `from '@airtable-formula/language-services'`. No class migration, no new files.

### Feature Gap Scope

- **D-05:** Research-backed gap analysis — the Phase researcher compares the current `FUNCTION_REGISTRY` against Airtable's official formula docs to produce a definitive list of missing functions and incorrect or missing diagnostics. No shortcuts to just unifying the existing diverging lists.
- **D-06:** Single `FUNCTION_REGISTRY` as the sole source of truth — all three duplicate lists (`FUNCTION_SIGNATURES` in `completions.ts`, `AIRTABLE_FUNCTIONS` in `diagnostics.ts`, `FUNCTION_REGISTRY` in `functions.ts`) collapse into one registry in language-services. Completions derive their `insertText` snippets from the `signature` field at render time; no separate completion-only data structure.

### Icon SVG Assets

- **D-07:** Executor creates placeholder SVGs at `packages/extension/icons/formula-light.svg` and `packages/extension/icons/formula-dark.svg`. User swaps SVG content when ready. Icons are fully wired at the end of the phase — they appear in VS Code immediately.
- **D-08:** `package.json` `contributes.languages[].icon` entry uses `./icons/formula-light.svg` (light) and `./icons/formula-dark.svg` (dark) for the `airtable-formula` language. Both `.formula` and `.fx` extensions share the same language ID so they get the same icon automatically.

### Engine API Shape

- **D-09:** `language-services/engines/formula/` exports pure stateless functions:
  ```typescript
  export function formulaDiagnostics(text: string): LsDiagnostic[]
  export function formulaCompletions(text: string, pos: LsPosition): LsCompletionItem[]
  export function formulaHover(text: string, pos: LsPosition): LsHover | null
  export function formulaSignatureHelp(text: string, pos: LsPosition): LsSignatureHelp | null
  ```
  No `FormulaEngine` class — stateless formula analysis has no benefit from class structure.
- **D-10:** `FUNCTION_REGISTRY`, `FunctionInfo`, and `FunctionCategory` are exported from `language-services/engines/formula/` as part of the public API. `codeActions.ts` imports `ALL_CALLABLE` and `FUNCTION_REGISTRY` from `@airtable-formula/language-services` (not from a local `functions.ts`).
- **D-11:** `LsSignatureHelp` and `LsParameterInformation` types are added to `packages/language-services/src/types.ts` in Phase 2. `convert.ts` gains a `toVscodeSignatureHelp()` conversion function.

### Engine File Structure

- **D-12:** `language-services/engines/formula/` is split by concern — mirrors the extension's current file structure:
  ```
  language-services/engines/formula/
    index.ts          ← re-exports all public API
    registry.ts       ← FUNCTION_REGISTRY, FunctionInfo, FunctionCategory, CALLABLE_CONSTANTS, helpers
    diagnostics.ts    ← formulaDiagnostics()
    completions.ts    ← formulaCompletions()
    hover.ts          ← formulaHover()
    signature.ts      ← formulaSignatureHelp()
  ```

### Tests

- **D-13:** Formula engine tests live in `packages/language-services/src/test/formula/`. Pure TS, no `vscode` dependency, run with vitest alongside Phase 1 type tests.
- **D-14:** Behavior-driven coverage — one test per notable behavior: diagnostics fire on unknown functions / bad syntax, completions return expected items for known functions, hover returns docs for a known function, signature help returns correct param count for a multi-param function. Line coverage is not the goal.

### Claude's Discretion

- Internal character-offset-to-position conversion helper (inline or extracted utility in the engine).
- Exact diagnostic message wording for any newly added diagnostic checks.
- Whether `LsParameterInformation` is a separate exported type or inlined inside `LsSignatureHelp`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — FORMULA-01 through FORMULA-05: exact success criteria and acceptance criteria for this phase
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and "files to delete" list

### Phase 1 Context (prior decisions)
- `.planning/phases/01-language-services-scaffold/01-CONTEXT.md` — D-01 through D-09: type shape decisions, adapter layer location, build order, enum numeric values (LsSeverity, LsCompletionItemKind mirrors), D-09 direct-cast constraint

### Existing Code to Migrate (all 5 must be read before planning)
- `packages/extension/src/functions.ts` — authoritative FUNCTION_REGISTRY, FunctionInfo, FunctionCategory, CALLABLE_CONSTANTS; these move to language-services/engines/formula/registry.ts
- `packages/extension/src/diagnostics.ts` — AirtableFormulaDiagnosticsProvider (713 lines); has its own AIRTABLE_FUNCTIONS duplicate and COMMON_TYPOS map; logic moves to language-services
- `packages/extension/src/completions.ts` — AirtableFormulaCompletionProvider (496 lines); has its own FUNCTION_SIGNATURES duplicate; includes date-unit completions and boolean constants (TRUE, FALSE); logic moves to language-services
- `packages/extension/src/hover.ts` — AirtableFormulaHoverProvider (81 lines); already imports from functions.ts
- `packages/extension/src/signature.ts` — AirtableFormulaSignatureHelpProvider (218 lines); has parameter index logic (`findFunctionContext`) that must move to language-services

### Code to Update (not deleted, only modified)
- `packages/extension/src/codeActions.ts` — stays at current location; line 1 import `./functions` → `@airtable-formula/language-services`
- `packages/extension/src/language/registration.ts` — updates imports from old provider locations to new `./formula/formula-*` wrapper files
- `packages/extension/src/language/convert.ts` — gains `toVscodeSignatureHelp()` and `toVscodeCompletionItem()` (if not already present); WR-01 fix: `toVscodeHover` must handle `kind: 'plaintext'`
- `packages/extension/package.json` — adds `icon` property to `contributes.languages` entry for `airtable-formula`; `.fx` added to `extensions` array

### Phase 1 Infrastructure
- `packages/language-services/src/types.ts` — existing types (LsDiagnostic, LsPosition, LsRange, LsCompletionItem, LsHover); Phase 2 adds LsSignatureHelp, LsParameterInformation
- `packages/language-services/package.json` — Phase 2 adds `engines/formula/` to the tsup entry points if needed, or the single `src/index.ts` re-export covers it

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/extension/src/language/convert.ts` (Phase 1): `toLsPosition`, `toVscodePosition`, `toLsRange`, `toVscodeRange`, `toVscodeDiagnostic`, `toVscodeHover` — Phase 2 extends with `toVscodeSignatureHelp`, `toVscodeCompletionItem`
- `packages/extension/src/language/registration.ts` (Phase 1): current registration structure; Phase 2 replaces the 5 direct provider imports with imports from `./formula/` wrappers
- `packages/language-services/src/test/types.test.ts` (Phase 1): model for how formula engine tests should be structured in `src/test/formula/`

### Established Patterns
- **Subsystem subdirectory**: `src/mcp/`, `src/auto-config/`, `src/skills/` all have a subdirectory + wrapper classes — `src/language/formula/` follows this exactly.
- **Pure function API**: language-services exports pure functions; VS Code adapters call them and convert types. No shared state between calls.
- **Enum numeric parity** (D-09 from Phase 1): `LsSeverity` and `LsCompletionItemKind` match VS Code numeric values — `convert.ts` casts directly without lookup tables.
- **FUNCTION_REGISTRY already has 3 helper exports** (`ALL_FUNCTION_NAMES`, `ALL_CALLABLE`, `getFunctionsByCategory`, `isValidCallable`, `getFunctionInfo`) — these move to language-services as well.

### Integration Points
- `packages/extension/src/language/registration.ts`: update imports from `../diagnostics`, `../completions`, `../hover`, `../signature` → `./formula/formula-diagnostics`, etc.
- `packages/extension/src/codeActions.ts` line 1: `from './functions'` → `from '@airtable-formula/language-services'`
- `packages/extension/package.json` `contributes.languages[0]` (airtable-formula): add `"icon": { "light": "./icons/formula-light.svg", "dark": "./icons/formula-dark.svg" }`; add `"fx"` to `extensions` array
- `packages/language-services/src/index.ts`: add `export * from './engines/formula/index.js'`
- Root `pnpm-workspace.yaml`: no change needed (packages/* glob already picks up language-services)

### Known Issues to Fix (from Phase 1 code review WR-01, WR-02, WR-04)
- **WR-01**: `toVscodeHover` in `convert.ts` ignores `kind: 'plaintext'` — always creates `MarkdownString`. Fix: check `contents.kind` and return plain string for `plaintext`.
- **WR-02**: `relatedInformation` on `LsDiagnostic` is dropped in `toVscodeDiagnostic` — add the mapping.
- **WR-04**: `"types"` condition ordering in `language-services/package.json` exports map — move before `"import"` and `"require"`.

</code_context>

<specifics>
## Specific Ideas

- `TRUE` and `FALSE` appear in `completions.ts` as boolean constants but are absent from `FUNCTION_REGISTRY` and `functions.ts` `CALLABLE_CONSTANTS`. Researcher should verify if Airtable treats them as built-in literals or functions and add to the correct list (constants vs. registry).
- `formulaCompletions()` must include date unit strings (`'days'`, `'weeks'`, etc.) as `LsCompletionItemKind.Value` items — currently in `completions.ts` lines ~481-493. These move to the language-services completions engine.
- The `findFunctionContext()` helper in `signature.ts` (parameter index tracking by scanning backwards for open parens and commas) is the most complex logic to migrate — planner should plan a unit test for it specifically.
- Placeholder SVG files should be minimal valid SVGs (e.g., a simple circle or rectangle with an "f" label) in both light and dark variants.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-Formula Engine Migration*
*Context gathered: 2026-05-13*
