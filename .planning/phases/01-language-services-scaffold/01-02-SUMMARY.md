---
phase: 01-language-services-scaffold
plan: "02"
subsystem: infra
tags: [typescript, vscode, language-services, adapter-layer, registration, monorepo]

# Dependency graph
requires:
  - phase: 01-01
    provides: "@airtable-formula/language-services dual CJS+ESM package with LsPosition, LsRange, LsDiagnostic, LsHover types"
provides:
  - "packages/extension/src/language/convert.ts — 6 vscode/LS type conversion functions"
  - "packages/extension/src/language/registration.ts — registerLanguageProviders(context) function absorbing all 5 formula provider registrations"
  - "extension.ts delegates formula wiring to registerLanguageProviders(context) — no inline provider registrations remain"
  - "INFRA-03: extension adapter layer proven live, not a stub"
  - "Full pnpm build pipeline: check-tool-sync → shared → language-services → webview → bundle-mcp → extension"
affects:
  - "02-language-services-scaffold onwards (Phase 2 engine adapters expand src/language/)"
  - "All future engine adapters that follow the registration.ts pattern"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "src/language/ adapter subdirectory: follows established subsystem pattern (src/mcp/, src/auto-config/)"
    - "registerLanguageProviders(context): void — absorbs all language provider wiring, pushes to context.subscriptions internally"
    - "import type for cross-package LS type imports — avoids value import when only type annotations needed"
    - "language-services in runtime dependencies (not devDependencies) — same pattern as @airtable-formula/shared"

key-files:
  created:
    - "packages/extension/src/language/convert.ts"
    - "packages/extension/src/language/registration.ts"
  modified:
    - "packages/extension/src/extension.ts (removed 5 provider class imports + 59 lines of formula wiring, added 2 lines)"
    - "packages/extension/package.json (added @airtable-formula/language-services dependency)"
    - "package.json (inserted language-services in build and test scripts)"
    - "pnpm-lock.yaml (updated for new workspace dependency)"

key-decisions:
  - "import type (not value import) for LsPosition/LsRange/LsDiagnostic/LsHover in convert.ts — these are only used as TypeScript type annotations, keeping the import side-effect free and avoiding any unused-value warnings"
  - "LsSeverity not imported in convert.ts despite plan template showing it — the D-09 cast (d.severity as unknown as vscode.DiagnosticSeverity) works without referencing the LsSeverity enum identifier at runtime; clean import"
  - "Actual extension.ts registration block was lines 183-241 (59 lines), matching plan estimate"

patterns-established:
  - "adapter layer in src/language/: convert.ts (type boundary) + registration.ts (provider wiring) — Phase 2 engine adapters expand this directory"
  - "registerLanguageProviders pattern: single context: vscode.ExtensionContext parameter, void return, all disposables pushed to context.subscriptions"

requirements-completed:
  - INFRA-03

# Metrics
duration: 20min
completed: "2026-05-12"
---

# Phase 1 Plan 02: Extension Adapter Layer Summary

**VS Code adapter layer wired live: convert.ts provides 6 LS↔vscode type conversions, registration.ts absorbs all 5 formula provider registrations into registerLanguageProviders(context), extension.ts reduced to a single delegation call — full pnpm build pipeline green with no formula regression**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-12T21:10:00Z
- **Completed:** 2026-05-12T21:30:00Z
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Created `packages/extension/src/language/convert.ts` with 6 type conversion functions at the vscode/LS boundary: `toLsPosition`, `toVscodePosition`, `toLsRange`, `toVscodeRange`, `toVscodeDiagnostic`, `toVscodeHover`
- Created `packages/extension/src/language/registration.ts` with `registerLanguageProviders(context: vscode.ExtensionContext): void` absorbing all 5 formula provider registrations and 2 event listeners from extension.ts
- Slimmed `extension.ts` from 59 inline formula registration lines down to 1 call: `registerLanguageProviders(context)`; all 5 provider class imports removed
- Added `@airtable-formula/language-services: workspace:*` to extension runtime dependencies
- Inserted `pnpm -F language-services build` and `pnpm -F language-services test` into root package.json pipeline
- Full `pnpm build` pipeline confirmed: check-tool-sync → shared → language-services → webview → bundle-mcp → extension — exits 0
- Extension regression test: 43/43 tests pass (4 test files)
- INFRA-03 satisfied; Phase 1 complete (INFRA-01 + INFRA-02 from Plan 01 + INFRA-03 from Plan 02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/language/convert.ts and src/language/registration.ts** - `7a40916` (feat)
2. **Task 2: Update extension.ts, extension/package.json, and root package.json** - `563d283` (feat)

**Plan metadata:** committed with SUMMARY

## Files Created/Modified

- `packages/extension/src/language/convert.ts` — 6 vscode/LS type conversion functions (toLsPosition, toVscodePosition, toLsRange, toVscodeRange, toVscodeDiagnostic, toVscodeHover)
- `packages/extension/src/language/registration.ts` — registerLanguageProviders(context) with all 5 formula provider registrations + 2 event listeners
- `packages/extension/src/extension.ts` — removed 5 provider class imports, replaced 59-line registration block with single `registerLanguageProviders(context)` call; added import from './language/registration.js'
- `packages/extension/package.json` — added `@airtable-formula/language-services: workspace:*` to dependencies block
- `package.json` — inserted `pnpm -F language-services build` in build script; `pnpm -F language-services test` in test script
- `pnpm-lock.yaml` — updated for new workspace dependency resolution

## Decisions Made

**import type vs value import for LsSeverity:** The plan template showed `import { LsSeverity } from '@airtable-formula/language-services'` as a separate value import. In the actual implementation, `LsSeverity` is not referenced by name in the function body — `d.severity` is typed as `LsSeverity` via the `LsDiagnostic` interface, but the cast `d.severity as unknown as vscode.DiagnosticSeverity` doesn't need to mention the enum identifier. Used `import type` only (single import line) to avoid a potentially-unused value import. The D-09 direct-cast compatibility is preserved — numeric values are identical.

**Actual line range:** The formula registration block in extension.ts was lines 183-241 (59 lines), exactly matching the plan's estimate. The replacement is a single `registerLanguageProviders(context)` call.

## Deviations from Plan

None — plan executed exactly as written. The only adaptation was using `import type` for language-services imports in convert.ts (omitting the separate `LsSeverity` value import), which is a clean simplification since `LsSeverity` is not referenced as a value identifier in the function implementations.

## Issues Encountered

**pnpm install required before first build:** The worktree had no `node_modules` (fresh git worktree). Ran `pnpm install` before `pnpm -F language-services build` — succeeded in 15s reusing 613 cached packages. This is expected worktree initialization behavior, not a blocker.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 is fully complete: INFRA-01 (language-services package) + INFRA-02 (8-test suite) + INFRA-03 (adapter wired live)
- Phase 2 can begin: engine adapters expand `src/language/` directory, language-services receives formula engine implementation, `registration.ts` routes through language-services calls
- `convert.ts` conversion functions are ready for Phase 2 use — when language-services returns `LsDiagnostic[]`, `toVscodeDiagnostic` is the boundary function
- The `registerLanguageProviders` pattern established here is the template all 3 engine adapters (formula, script, automation) follow in Phases 3-4

---
*Phase: 01-language-services-scaffold*
*Completed: 2026-05-12*

## Self-Check: PASSED

Files confirmed present:
- `packages/extension/src/language/convert.ts` — FOUND
- `packages/extension/src/language/registration.ts` — FOUND
- `packages/extension/src/extension.ts` (modified) — FOUND
- `packages/extension/package.json` (modified) — FOUND
- `package.json` (modified) — FOUND

Commits confirmed:
- `7a40916` (Task 1 — convert.ts + registration.ts) — FOUND in git log
- `563d283` (Task 2 — extension.ts + package.json + root package.json) — FOUND in git log

Build verification:
- `pnpm build` exits 0 — CONFIRMED
- `pnpm -F airtable-formula test` exits 0, 43/43 pass — CONFIRMED
- `pnpm -F language-services test` exits 0, 8/8 pass — CONFIRMED
- Zero vscode imports in language-services/src/ — CONFIRMED
