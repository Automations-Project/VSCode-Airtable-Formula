---
phase: 01-language-services-scaffold
plan: "01"
subsystem: infra
tags: [typescript, tsup, vitest, dual-cjs-esm, language-services, workspace-package]

# Dependency graph
requires: []
provides:
  - "packages/language-services workspace package with dual CJS+ESM build"
  - "LsMarkdownString, LsPosition, LsRange, LsDiagnostic, LsCompletionItem, LsHover interfaces"
  - "LsSeverity and LsCompletionItemKind enums mirroring vscode numeric values (D-09)"
  - "INFRA-01: zero-vscode-dependency dual-build package"
  - "INFRA-02: automated type importability + enum value test suite (8 tests)"
affects:
  - "02-language-services-scaffold (Phase 1 Plan 02)"
  - "All future engine adapters that import from @airtable-formula/language-services"
  - "packages/extension dependency additions in future plans"

# Tech tracking
tech-stack:
  added:
    - "tsup ^8.0.0 (CJS+ESM+DTS bundler for new package)"
    - "vitest ^1.6.0 (test runner for new package)"
    - "typescript ^5.4.0 (type compiler)"
  patterns:
    - "Workspace package scaffold: package.json with dual exports map (import/require/types), tsconfig NodeNext"
    - "Regular enum instead of const enum for vitest/esbuild compatibility"
    - "Whitelist .gitignore: new packages require explicit !packages/<name>/ allowance"

key-files:
  created:
    - "packages/language-services/package.json"
    - "packages/language-services/tsconfig.json"
    - "packages/language-services/vitest.config.ts"
    - "packages/language-services/src/index.ts"
    - "packages/language-services/src/types.ts"
    - "packages/language-services/src/test/types.test.ts"
  modified:
    - ".gitignore (added packages/language-services/ whitelist)"
    - "pnpm-lock.yaml (new workspace package registered)"

key-decisions:
  - "Used regular enum instead of const enum for LsSeverity/LsCompletionItemKind — vitest/esbuild does not inline const enum at test time, causing runtime ReferenceError. Regular enum preserves identical numeric values and is semantically equivalent for D-09 cast compatibility."
  - "build script uses tsup --format cjs,esm --dts — produces index.js (ESM), index.cjs (CJS), index.d.ts (declarations), index.d.cts (CJS declarations)"
  - "gitignore whitelist update required — project uses whitelist-style .gitignore; new packages must be explicitly allowed or they are invisible to git"

patterns-established:
  - "Workspace package scaffold: copy packages/shared/package.json + add require condition + change --format to cjs,esm for dual output"
  - "Barrel export: src/index.ts with export * from './types.js' (NodeNext requires .js extension)"
  - "New workspace packages must be added to .gitignore whitelist section"

requirements-completed:
  - INFRA-01
  - INFRA-02

# Metrics
duration: 8min
completed: "2026-05-12"
---

# Phase 1 Plan 01: Language Services Scaffold Summary

**Dual CJS+ESM `@airtable-formula/language-services` workspace package with 8 framework-agnostic LS types, LsSeverity/LsCompletionItemKind enums mirroring vscode numerics, and vitest proof of zero-vscode-dependency importability**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-12T18:09:00Z
- **Completed:** 2026-05-12T18:17:15Z
- **Tasks:** 1 (TDD — 2 commits: RED + GREEN)
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- Created `packages/language-services` as a valid pnpm workspace package (auto-picked up by `packages/*` glob in pnpm-workspace.yaml)
- Dual CJS+ESM+DTS build confirmed: `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` + `dist/index.d.cts` (declarations)
- All 5 LS interfaces (`LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover`) plus `LsMarkdownString`, `LsSeverity`, `LsCompletionItemKind` exported from package index with zero `vscode` imports
- 8 vitest tests pass: shape correctness + D-09 enum numeric value assertions (`LsSeverity.Error === 0`, `LsCompletionItemKind.TypeParameter === 24`)
- INFRA-01 satisfied: dual build, zero vscode dependency
- INFRA-02 satisfied: automated proof via test suite

## Task Commits

TDD task with two commits (RED → GREEN):

1. **RED: test(01-01)** - `d2b486a` — add failing type importability tests for language-services
2. **GREEN: feat(01-01)** - `7ed05e5` — implement language-services types — INFRA-01 + INFRA-02

## Files Created/Modified

- `packages/language-services/package.json` — dual CJS+ESM exports map, tsup build, vitest test script
- `packages/language-services/tsconfig.json` — verbatim copy of shared tsconfig (NodeNext, ES2022)
- `packages/language-services/vitest.config.ts` — includes src/test/**/*.test.ts
- `packages/language-services/src/index.ts` — barrel export: `export * from './types.js'`
- `packages/language-services/src/types.ts` — all 8 exports: LsMarkdownString, LsPosition, LsRange, LsDiagnostic, LsCompletionItem, LsHover, LsSeverity, LsCompletionItemKind
- `packages/language-services/src/test/types.test.ts` — 8 tests: shape + D-09 enum numeric proofs
- `.gitignore` — added `!packages/language-services/` and `!packages/language-services/**` to whitelist
- `pnpm-lock.yaml` — updated for new workspace package registration

## Decisions Made

**const enum vs enum:** The plan specified `const enum` for `LsSeverity` and `LsCompletionItemKind`. During GREEN phase, vitest (which uses esbuild for transforms, not tsc) does not inline `const enum` values — importing a `const enum` at runtime results in `undefined`. Changed to regular `enum` to make D-09 test assertions work. The numeric values are identical; D-09 direct-cast compatibility is preserved. This is the recommended vitest workaround documented in the plan's IMPORTANT note.

**Actual tsup command:** `tsup src/index.ts --format cjs,esm --dts --out-dir dist`

**Dist output confirmed:**
- `dist/index.js` — ESM
- `dist/index.cjs` — CJS
- `dist/index.d.ts` — type declarations (ESM)
- `dist/index.d.cts` — type declarations (CJS, auto-generated by tsup)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added packages/language-services/ to .gitignore whitelist**
- **Found during:** Task 1 (after file creation, pre-commit)
- **Issue:** Project uses a whitelist-style `.gitignore` (ignores everything, then explicitly allows). The `packages/*` glob in pnpm-workspace.yaml picks up the new package for pnpm, but git still ignores it without an explicit `!packages/language-services/` allowance. `git status` showed no new files.
- **Fix:** Added two lines to `.gitignore` section 6: `!packages/language-services/` and `!packages/language-services/**`
- **Files modified:** `.gitignore`
- **Verification:** `git status -uall` after fix showed all 6 new files as untracked/staged
- **Committed in:** `7ed05e5` (GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking)
**Impact on plan:** Essential for git to track the new package. Zero scope creep.

## Issues Encountered

**const enum runtime issue:** vitest/esbuild does not inline `const enum` — importing `LsSeverity` or `LsCompletionItemKind` as value imports would return `undefined`. Used regular `enum` as specified in the plan's IMPORTANT note. This is a known vitest limitation.

## User Setup Required

None — no external service configuration required. Run `pnpm install` to register the workspace package if working in a fresh clone.

## Next Phase Readiness

- `@airtable-formula/language-services` is a working, tested, dual-build workspace package
- INFRA-01 and INFRA-02 are satisfied
- Plan 01-02 (INFRA-03: extension adapter layer) can proceed immediately
- The package is ready to be added to `packages/extension/package.json` as `"@airtable-formula/language-services": "workspace:*"` in Plan 01-02

---
*Phase: 01-language-services-scaffold*
*Completed: 2026-05-12*

## TDD Gate Compliance

- RED gate: `test(01-01)` commit `d2b486a` — test file written before implementation (confirmed failing)
- GREEN gate: `feat(01-01)` commit `7ed05e5` — implementation written after tests, all 8 tests pass
- REFACTOR gate: not needed (pure type declarations, no logic to refactor)

## Self-Check: PASSED

Files confirmed present:
- `packages/language-services/package.json` — FOUND
- `packages/language-services/tsconfig.json` — FOUND
- `packages/language-services/vitest.config.ts` — FOUND
- `packages/language-services/src/index.ts` — FOUND
- `packages/language-services/src/types.ts` — FOUND
- `packages/language-services/src/test/types.test.ts` — FOUND
- `packages/language-services/dist/index.js` — FOUND
- `packages/language-services/dist/index.cjs` — FOUND
- `packages/language-services/dist/index.d.ts` — FOUND

Commits confirmed:
- `d2b486a` (RED) — FOUND in git log
- `7ed05e5` (GREEN) — FOUND in git log
