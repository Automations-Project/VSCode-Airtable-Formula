# Roadmap: VSCode-Airtable-Formula — Language Platform

## Overview

This milestone transforms the existing single-engine formula editor into a 3-engine language platform. The work proceeds in strict dependency order: scaffold the framework-agnostic `language-services` package first, migrate the existing formula engine into it to prove the architecture, then build the Scripting Extension engine, then build the Automation engine on top of the shared globals pattern the script engine establishes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Language Services Scaffold** - New `packages/language-services` workspace package with dual CJS+ESM build, framework-agnostic types, and VS Code adapter layer
- [ ] **Phase 2: Formula Engine Migration** - Extract all formula providers into `language-services/engines/formula/`, unify the function registry, fix feature gaps
- [ ] **Phase 3: Script Engine** - `airtable-script` language ID, globals completions/hover, missing-await and unknown-global diagnostics, file icon for `.script` files
- [ ] **Phase 4: Automation Engine** - `airtable-automation` language ID, automation-scoped globals, cross-context diagnostics, file icon for `.automation` files

## Phase Details

### Phase 1: Language Services Scaffold
**Goal**: The `packages/language-services` workspace package exists, builds successfully with dual CJS+ESM output, exports framework-agnostic types, and the VS Code extension adapter layer is in place — all without any `vscode` dependency leaking into the new package
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `pnpm -F language-services build` produces both CJS and ESM outputs with no TypeScript errors
  2. `pnpm build` completes without regressions — existing formula features still work identically in VS Code after the adapter layer is wired in
  3. `LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, and `LsHover` types are importable from `language-services` without triggering a `vscode` module resolution
  4. `packages/extension/src/language/convert.ts` exists and translates between VS Code types and language-services types; `registration.ts` exists and calls `registerLanguageProviders(context)`
**Plans**: TBD

### Phase 2: Formula Engine Migration
**Goal**: All formula language intelligence lives in `language-services/engines/formula/` — the five existing provider files in the extension are deleted and replaced by thin VS Code adapter wrappers, a single `FUNCTION_REGISTRY` drives all formula providers, and known feature gaps are fixed
**Depends on**: Phase 1
**Requirements**: FORMULA-01, FORMULA-02, FORMULA-03
**Success Criteria** (what must be TRUE):
  1. `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, and `functions.ts` no longer exist in `packages/extension/src/` — their logic lives in `language-services/engines/formula/`
  2. Formula diagnostics, completions, hover, and signature help behave identically to before the migration (no user-visible behavioral regression)
  3. A single `FUNCTION_REGISTRY` is the source of truth — the private duplicate function list that previously existed in `completions.ts` is eliminated
  4. Known formula feature gaps are resolved: missing functions are added to the registry and incorrect or missing diagnostics are fixed
**Plans**: TBD

### Phase 3: Script Engine
**Goal**: `.script` files have full language support in VS Code — JS syntax highlighting, dot-triggered completions for all Scripting Extension globals, hover documentation, missing-`await` and unknown-global diagnostics, and a custom file icon
**Depends on**: Phase 2
**Requirements**: SCRIPT-01, SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05, SCRIPT-06
**Success Criteria** (what must be TRUE):
  1. A file with `.script` extension opens in VS Code with JS syntax highlighting and `airtable-script` language ID; comment toggling, bracket pairs, and code folding work
  2. Typing `base.` in a `.script` file triggers completions listing the correct `base` methods; the same applies to `table`, `cursor`, `input`, `output`, `session`, `fetch`, and `remoteFetchAsync`
  3. Hovering over any Scripting Extension global or method shows documentation text
  4. Writing `someAsyncCall()` without `await` on `*Async`-suffixed calls produces a diagnostic warning
  5. `.script` files display the custom file icon (light and dark variants) in VS Code's file explorer
**Plans**: TBD
**UI hint**: yes

### Phase 4: Automation Engine
**Goal**: `.automation` files have full language support scoped to the Automation Script context — completions and hover are limited to automation-available globals, and diagnostics flag use of scripting-extension-only APIs; a custom file icon is registered
**Depends on**: Phase 3
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05
**Success Criteria** (what must be TRUE):
  1. A file with `.automation` extension opens in VS Code with JS syntax highlighting and `airtable-automation` language ID; comment toggling, bracket pairs, and code folding work
  2. Typing `input.` in an `.automation` file shows only `input.config()` — interactive input methods are absent; `output.` shows only `output.set()`
  3. Hovering over any automation global or method shows documentation text
  4. Writing `cursor.selectedRecordIds` or using `session`, `remoteFetchAsync`, or interactive `input.*Async()` / `output.text/markdown/table` in an `.automation` file produces a diagnostic error identifying the API as scripting-extension-only
  5. `.automation` files display the custom file icon (light and dark variants) in VS Code's file explorer
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Language Services Scaffold | 0/? | Not started | - |
| 2. Formula Engine Migration | 0/? | Not started | - |
| 3. Script Engine | 0/? | Not started | - |
| 4. Automation Engine | 0/? | Not started | - |
