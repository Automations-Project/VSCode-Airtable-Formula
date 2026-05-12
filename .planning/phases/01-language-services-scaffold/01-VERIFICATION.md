---
phase: 01-language-services-scaffold
verified: 2026-05-12T21:45:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open a .formula file in VS Code with the extension loaded. Type a partial function name and confirm completions appear."
    expected: "Completion list populated with Airtable formula function names"
    why_human: "Provider registration correctness cannot be verified without the VS Code host — registerLanguageProviders wiring is confirmed by code inspection but runtime behavior requires a live extension"
  - test: "Hover over a known function name (e.g. IF) in a .formula file."
    expected: "Hover tooltip shows function documentation"
    why_human: "Same reason — live VS Code extension host required"
  - test: "Type an unknown function name in a .formula file (e.g. BOGUS()) and observe the Problems panel."
    expected: "Diagnostic error appears for the unknown function"
    why_human: "Diagnostic provider wiring is confirmed by code inspection; correctness under the new registration.ts wrapper requires live verification"
  - test: "Place cursor inside parentheses of a known function call (e.g. IF(|)) and observe signature help."
    expected: "Signature help panel appears showing parameter hints"
    why_human: "Signature help provider wiring requires live VS Code host to verify"
---

# Phase 1: Language Services Scaffold Verification Report

**Phase Goal:** The `packages/language-services` workspace package exists, builds successfully with dual CJS+ESM output, exports framework-agnostic types, and the VS Code extension adapter layer is in place — all without any `vscode` dependency leaking into the new package
**Verified:** 2026-05-12T21:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `pnpm -F language-services build` exits 0 and produces dist/index.js (ESM), dist/index.cjs (CJS), and dist/index.d.ts | VERIFIED | Build ran: ESM `dist/index.js` (2.34 KB), CJS `dist/index.cjs` (3.40 KB), DTS `dist/index.d.ts` (1.53 KB) all confirmed present |
| 2  | LsDiagnostic, LsPosition, LsRange, LsCompletionItem, LsHover, LsMarkdownString, LsSeverity, and LsCompletionItemKind are all exported from the package index | VERIFIED | `packages/language-services/src/index.ts` barrel-exports `export * from './types.js'`; all 8 types/enums confirmed in `types.ts`; CJS dist loaded via Node confirms LsSeverity and LsCompletionItemKind are present at runtime |
| 3  | No import from 'vscode' exists anywhere in packages/language-services/src/ | VERIFIED | `grep -r "from 'vscode'"` and `grep -r "from \"vscode\""` both return zero matches |
| 4  | `pnpm -F language-services test` passes with all 8 type importability tests green | VERIFIED | Test run output: 8/8 pass in 3ms — including LsSeverity and LsCompletionItemKind enum value assertions |
| 5  | D-06: LsCompletionItem includes filterText, sortText, and commitCharacters | VERIFIED | `types.ts` lines 34–36: `filterText?: string`, `sortText?: string`, `commitCharacters?: string[]` |
| 6  | D-07: LsHover.contents field type is LsMarkdownString (not a plain string) | VERIFIED | `types.ts` line 40: `contents: LsMarkdownString` — required field, no union with string |
| 7  | D-08: LsCompletionItem.documentation is typed as string \| LsMarkdownString | VERIFIED | `types.ts` line 32: `documentation?: string \| LsMarkdownString` |
| 8  | D-09: LsSeverity.Error===0, Warning===1, Information===2, Hint===3; LsCompletionItemKind.Function===2, TypeParameter===24 — verified by test assertions | VERIFIED | Test file assertions confirmed; Node CJS load confirms `LsSeverity.Error=0` and `LsCompletionItemKind.TypeParameter=24` at runtime |
| 9  | `packages/extension/src/language/registration.ts` exists and exports `registerLanguageProviders(context: vscode.ExtensionContext): void` | VERIFIED | File exists at correct path; exports the function with correct signature; contains all 5 provider registrations plus 2 event listeners |
| 10 | `packages/extension/src/language/convert.ts` exists and exports toLsPosition, toVscodePosition, toLsRange, toVscodeRange, toVscodeDiagnostic, toVscodeHover | VERIFIED | File exists; `grep -c "^export function"` returns 6; all 6 function names confirmed in file content |
| 11 | `extension.ts` calls `registerLanguageProviders(context)` in place of the 5 inline formula provider registrations — no provider class imports remain in extension.ts | VERIFIED | `extension.ts` line 11: import from `./language/registration.js`; line 179: `registerLanguageProviders(context)`; grep for `AirtableFormulaDiagnosticsProvider` finds only a non-import string literal in a console.warn — no class import or instantiation |
| 12 | `pnpm -F airtable-formula build` exits 0 — extension compiles with the adapter wired in | VERIFIED | Full `pnpm build` completed successfully: CJS bundle `dist/extension.js` (1.15 MB) produced with no TypeScript errors |
| 13 | `pnpm build` exits 0 — full build pipeline including language-services step succeeds with no regression | VERIFIED | Full pipeline confirmed: check-tool-sync → shared → language-services → webview → bundle-mcp → extension — all steps exit 0 |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/language-services/package.json` | Dual CJS+ESM package definition with `"require": "./dist/index.cjs"` | VERIFIED | `"require"` condition present; `"main": "./dist/index.cjs"`; build script: `tsup src/index.ts --format cjs,esm --dts --out-dir dist` |
| `packages/language-services/tsconfig.json` | NodeNext module resolution, ES2022 target, strict | VERIFIED | Verbatim match to `packages/shared/tsconfig.json` — all fields confirmed |
| `packages/language-services/vitest.config.ts` | Includes `src/test/**/*.test.ts` | VERIFIED | File contains correct include pattern |
| `packages/language-services/src/types.ts` | All 8 exports: LsMarkdownString, LsPosition, LsRange, LsDiagnostic, LsCompletionItem, LsHover, LsSeverity, LsCompletionItemKind | VERIFIED | All 8 present; enums use regular `enum` (not `const enum`) per documented vitest/esbuild workaround |
| `packages/language-services/src/index.ts` | Barrel re-export `export * from './types.js'` | VERIFIED | Single line: `export * from './types.js'` |
| `packages/language-services/src/test/types.test.ts` | 8 tests proving importability without vscode | VERIFIED | 8 tests present and passing; includes D-09 enum numeric assertions |
| `packages/language-services/dist/index.js` | ESM output | VERIFIED | Present (2.34 KB) |
| `packages/language-services/dist/index.cjs` | CJS output | VERIFIED | Present (3.40 KB) |
| `packages/language-services/dist/index.d.ts` | Type declarations | VERIFIED | Present (1.53 KB) |
| `packages/extension/src/language/registration.ts` | All formula provider registrations in registerLanguageProviders | VERIFIED | 5 provider instantiations + 2 event listeners + all pushed to context.subscriptions; formatter NOT moved (D-02 boundary held) |
| `packages/extension/src/language/convert.ts` | 6 type conversion functions; imports from @airtable-formula/language-services | VERIFIED | 6 functions; `import type { LsPosition, LsRange, LsDiagnostic, LsHover }` from language-services |
| `packages/extension/src/extension.ts` | Single `registerLanguageProviders(context)` call; 5 provider class imports removed | VERIFIED | Line 11 import, line 179 call; no AirtableFormulaXxxProvider imports remain |
| `packages/extension/package.json` | `"@airtable-formula/language-services": "workspace:*"` in dependencies | VERIFIED | Line 473 confirmed |
| `package.json` | Build and test scripts include language-services step | VERIFIED | Both scripts insert `pnpm -F language-services build/test` after `pnpm -F shared build/test` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/language-services/src/index.ts` | `packages/language-services/src/types.ts` | `export * from './types.js'` | WIRED | Confirmed in file |
| `packages/language-services/package.json exports map` | `dist/index.cjs` | `"require"` condition | WIRED | `"require": "./dist/index.cjs"` confirmed; `"main": "./dist/index.cjs"` also present |
| `packages/extension/src/extension.ts` | `packages/extension/src/language/registration.ts` | `import { registerLanguageProviders } from './language/registration.js'` | WIRED | Line 11 import + line 179 call |
| `packages/extension/src/language/convert.ts` | `@airtable-formula/language-services` | `import type { LsPosition, LsRange, LsDiagnostic, LsHover }` | WIRED | Line 2 of convert.ts confirmed |
| `packages/extension/src/language/registration.ts` | `packages/extension/src/diagnostics.ts` | `import { AirtableFormulaDiagnosticsProvider } from '../diagnostics'` | WIRED | Line 2 of registration.ts confirmed; source file exists |

### Data-Flow Trace (Level 4)

Not applicable — Phase 1 creates type definitions and structural wiring only. No dynamic data rendering artifacts. `convert.ts` functions are defined but not yet invoked with engine output (engines connect in Phase 2). The registration.ts providers delegate to existing classes unchanged — no new data pipelines introduced.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| language-services build produces CJS+ESM | `pnpm -F language-services build` | Both outputs produced, exit 0 | PASS |
| All 8 type tests pass | `pnpm -F language-services test` | 8/8 pass in 3ms | PASS |
| Zero vscode imports in language-services | `grep -r "from 'vscode'"` in src/ | No matches | PASS |
| Extension compiles with adapter wired | `pnpm build` (full pipeline) | Exit 0, 1.15 MB bundle | PASS |
| Extension regression tests | `pnpm -F airtable-formula test` | 43/43 pass | PASS |
| CJS dist exports enums with correct values | Node require + property read | LsSeverity.Error=0, TypeParameter=24 | PASS |
| Formatter stays in extension.ts | grep for registerDocumentFormattingEditProvider | Found in extension.ts (line 182), absent from registration.ts | PASS |
| D-03: original provider files not moved | `ls packages/extension/src/{diagnostics,completions,hover,signature,codeActions}.ts` | All 5 present | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| INFRA-01 | 01-01-PLAN.md | `packages/language-services` workspace package exists with dual CJS+ESM tsup build and zero VS Code runtime dependency | SATISFIED | Package exists; build exits 0; CJS+ESM outputs confirmed; zero vscode imports in src/ |
| INFRA-02 | 01-01-PLAN.md | Framework-agnostic types defined (LsDiagnostic, LsPosition, LsRange, LsCompletionItem, LsHover) — engines never import from vscode | SATISFIED | All 5 interfaces present in types.ts + LsMarkdownString; 8 vitest tests prove importability without vscode |
| INFRA-03 | 01-02-PLAN.md | VS Code adapter layer exists in extension (convert.ts, registration.ts) that translates between VS Code types and language-services types | SATISFIED | convert.ts (6 functions), registration.ts (registerLanguageProviders wired live); extension.ts delegates to it; full build green |

All 3 Phase 1 requirement IDs are accounted for. No orphaned requirements for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/language-services/package.json` | 12 | `"types"` condition appears after `"import"` and `"require"` — esbuild warns "condition will never be used" | Info | No runtime impact; TypeScript tooling reads the top-level `"types"` field instead. Build still exits 0. Not a blocker. |

No stubs, no empty implementations, no TODO/FIXME/PLACEHOLDER comments found in any Phase 1 files. The `toVscodeDiagnostic` and `toVscodeHover` functions in convert.ts have real implementations (not stubs), even though they are not yet called — they will be used in Phase 2.

### Human Verification Required

Phase 1's code path through `registerLanguageProviders` is live and functional in production — the existing provider classes are the same ones that were directly registered in extension.ts before. The refactoring moves the call site, not the logic. However, confirming no regression in the running extension requires the VS Code host:

#### 1. Formula Completions Still Appear

**Test:** Open a `.formula` file in VS Code with the extension loaded. Type a partial function name (e.g., `IF`) and wait for the completion popup.
**Expected:** Completion list appears with Airtable formula function names.
**Why human:** VS Code language provider registration (`vscode.languages.registerCompletionItemProvider`) can only be exercised in the extension host — not in unit tests.

#### 2. Hover Documentation Still Works

**Test:** In a `.formula` file, hover over a known function name (e.g., `IF`).
**Expected:** Hover tooltip shows function name and documentation.
**Why human:** `vscode.languages.registerHoverProvider` invocation requires the live extension host.

#### 3. Diagnostics Still Fire on Unknown Functions

**Test:** In a `.formula` file, type `BOGUS()` (an unknown function). Check the Problems panel.
**Expected:** A diagnostic error appears for the unknown function.
**Why human:** `AirtableFormulaDiagnosticsProvider` initialization and event listener wiring in registration.ts requires the running extension host to confirm.

#### 4. Signature Help Still Appears

**Test:** In a `.formula` file, type `IF(` and observe if signature help appears inside the parentheses.
**Expected:** Signature help panel shows parameter names/types.
**Why human:** `vscode.languages.registerSignatureHelpProvider` requires the live extension host.

### Gaps Summary

No gaps. All 13 must-haves are verified by direct code inspection, confirmed dist outputs, green test runs, and green full build pipeline. The phase goal is structurally achieved. The 4 human verification items are smoke-test confirmations of existing functionality after code reorganization — they are not suspected failures, but require the VS Code host to confirm.

---

_Verified: 2026-05-12T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
