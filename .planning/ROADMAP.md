# Roadmap: VSCode-Airtable-Formula — Language Platform

## Overview

This milestone transforms the existing single-engine formula editor into a 3-engine language platform. The work proceeds in strict dependency order: scaffold the framework-agnostic `language-services` package first, migrate the existing formula engine into it to prove the architecture, then build the Scripting Extension engine, then build the Automation engine on top of the shared globals pattern the script engine establishes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Language Services Scaffold** - New `packages/language-services` workspace package with dual CJS+ESM build, framework-agnostic types, and VS Code adapter layer
- [ ] **Phase 2: Formula Engine Migration** - Extract all formula providers into `language-services/engines/formula/`, unify the function registry, fix feature gaps, add formula file icon
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
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — Create packages/language-services package scaffold with dual CJS+ESM build, framework-agnostic types, and test suite (INFRA-01, INFRA-02) [Wave 1, autonomous]
- [x] 01-02-PLAN.md — Wire VS Code adapter layer: convert.ts, registration.ts, extension.ts integration, and build script updates (INFRA-03) [Wave 2, depends_on: 01-01, autonomous]

### Phase 2: Formula Engine Migration
**Goal**: All formula language intelligence lives in `language-services/engines/formula/` — the five existing provider files in the extension are deleted and replaced by thin VS Code adapter wrappers, a single `FUNCTION_REGISTRY` drives all formula providers, and known feature gaps are fixed
**Depends on**: Phase 1
**Requirements**: FORMULA-01, FORMULA-02, FORMULA-03, FORMULA-04, FORMULA-05
**Success Criteria** (what must be TRUE):
  1. `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, and `functions.ts` no longer exist in `packages/extension/src/` — their logic lives in `language-services/engines/formula/`
  2. `codeActions.ts` import updated from `./functions` to the new `language-services` registry export — no dead imports remain in the extension
  3. Formula diagnostics, completions, hover, and signature help behave identically to before the migration (no user-visible behavioral regression)
  4. A single `FUNCTION_REGISTRY` is the source of truth — the private duplicate function list that previously existed in `completions.ts` is eliminated
  5. Known formula feature gaps are resolved: missing functions are added to the registry and incorrect or missing diagnostics are fixed
  6. `.fx` opens with `airtable-formula` language ID — identical diagnostics, completions, hover, and icon as `.formula`
  7. `.formula` and `.fx` files display a custom light/dark SVG file type icon via `contributes.languages[].icon`
**Plans**: 8 plans
Plans:
**Wave 1**
- [ ] 02-01-PLAN.md — Add LsSignatureHelp types to types.ts, fix WR-04 package.json exports ordering, create 5 Wave-0 test scaffolds (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 1, autonomous]
- [ ] 02-02-PLAN.md — Create engines/formula/registry.ts (unified FUNCTION_REGISTRY + gap fixes + helpers) and engines/formula/index.ts barrel (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 1, autonomous]

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 02-03-PLAN.md — Create engines/formula/diagnostics.ts pure engine (migrate from extension/src/diagnostics.ts) (FORMULA-01, FORMULA-03) [Wave 2, depends_on: 02-02, autonomous]
- [ ] 02-04-PLAN.md — Create engines/formula/completions.ts and engines/formula/hover.ts pure engines (FORMULA-01, FORMULA-02, FORMULA-03) [Wave 2, depends_on: 02-02, autonomous]
- [ ] 02-05-PLAN.md — Create engines/formula/signature.ts pure engine with findFunctionContext (FORMULA-01) [Wave 2, depends_on: 02-01, 02-02, autonomous]

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 02-06-PLAN.md — Fix convert.ts (WR-01, WR-02) and add toVscodeCompletionItem + toVscodeSignatureHelp; extend language-services/src/index.ts (FORMULA-01, FORMULA-02) [Wave 3, depends_on: 02-03, 02-04, 02-05, autonomous]

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 02-07-PLAN.md — Create all 4 VS Code wrapper classes in extension/src/language/formula/ (FORMULA-01) [Wave 4, depends_on: 02-06, autonomous]

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 02-08-PLAN.md — Wire registration.ts + codeActions.ts imports; delete 5 old source files; create SVG icons; update package.json (.fx + icon) (FORMULA-01, FORMULA-02, FORMULA-04, FORMULA-05) [Wave 5, depends_on: 02-07, autonomous]

### Phase 3: Script Engine
**Goal**: `.script` files have full language support in VS Code — JS syntax highlighting, dot-triggered completions for all Scripting Extension globals, hover documentation, missing-`await` and unknown-global diagnostics, and a custom file icon
**Depends on**: Phase 2
**Requirements**: SCRIPT-01, SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05, SCRIPT-06
**Success Criteria** (what must be TRUE):
  1. Files with `.script` and `.ats` extensions open in VS Code with JS syntax highlighting and `airtable-script` language ID; comment toggling, bracket pairs, and code folding work
  2. Typing `base.` in a `.script` file triggers completions listing the correct `base` methods; the same applies to `table`, `cursor`, `input`, `output`, `session`, `fetch`, and `remoteFetchAsync`
  3. Hovering over any Scripting Extension global or method shows documentation text
  4. Writing `someAsyncCall()` without `await` on `*Async`-suffixed calls produces a diagnostic warning
  5. `.script` files display the custom file icon (light and dark variants) in VS Code's file explorer
**Plans**: TBD
**UI hint**: yes

### Phase 4: Automation Engine
**Goal**: `.automation` files have full language support scoped to the Automation Script context — completions and hover are limited to automation-available globals, and diagnostics flag use of scripting-extension-only APIs; a custom file icon is registered
**Depends on**: Phase 3
**Prerequisite gate (must be resolved before planning Phase 4)**: Verify the complete Airtable Automation Script global surface against the official Airtable automation docs — specifically: (a) confirm `base`/`table`/`fetch` availability, (b) confirm exact `remoteFetchAsync` status (absent vs. deprecated-warning), (c) confirm `input.config()` field-type enum shape. Research confidence is MEDIUM for automation globals.
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05
**Success Criteria** (what must be TRUE):
  1. Files with `.automation` and `.ata` extensions open in VS Code with JS syntax highlighting and `airtable-automation` language ID; comment toggling, bracket pairs, and code folding work
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
| 1. Language Services Scaffold | 0/2 | Not started | - |
| 2. Formula Engine Migration | 0/8 | Not started | - |
| 3. Script Engine | 0/? | Not started | - |
| 4. Automation Engine | 0/? | Not started | - |
