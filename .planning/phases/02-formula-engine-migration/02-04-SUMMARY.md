---
plan: 02-04
phase: 02-formula-engine-migration
status: complete
wave: 2
subsystem: language-services
tags: [completions, hover, pure-engine, no-vscode]
dependency_graph:
  requires: [02-02]
  provides: [formulaCompletions, formulaHover]
  affects: [language-services/index.ts, engines/formula/index.ts]
tech_stack:
  added: []
  patterns: [pure-function-engine, positionToOffset-helper, registry-derived-completions]
key_files:
  created:
    - packages/language-services/src/engines/formula/completions.ts
    - packages/language-services/src/engines/formula/hover.ts
  modified: []
decisions:
  - TRUE/FALSE kind overridden from Function(2) to Constant(20) after initial registry pass
  - createFunctionHover accepts _name parameter (unused but kept for signature consistency)
  - BLANK, NOW, TODAY added as Constant kind since they are not in FUNCTION_REGISTRY
metrics:
  duration: 8m
  completed: "2026-05-13"
  tasks_completed: 2
  files_created: 2
---

# Phase 02 Plan 04: Create completions.ts and hover.ts Summary

## One-liner

Pure formula completions and hover engines — derive all items from FUNCTION_REGISTRY, zero vscode imports, TRUE/FALSE correctly typed as Constant (D-05 gap fix).

## What Was Done

- Created `completions.ts`: `formulaCompletions` derives all completion items directly from `FUNCTION_REGISTRY` (D-06 — no parallel `FUNCTION_SIGNATURES` structure). TRUE/FALSE overridden to `kind=Constant` (20) after the initial Function-kind pass. BLANK, NOW, TODAY added as Constant items. All 7 date unit strings added as Value (11) items. Single `$0` tab stop in `insertText` per Pitfall 4.

- Created `hover.ts`: `formulaHover` with pure-string helpers (`positionToOffset`, `offsetToPosition`, `extractWordAt`) replacing VS Code document API calls. `getCategoryEmoji` migrated verbatim from `packages/extension/src/hover.ts` lines 68-80. TRUE/FALSE resolved via `FUNCTION_REGISTRY` first branch (D-05 gap fix), BLANK/NOW/TODAY via CALLABLE_CONSTANTS fallback branch.

## Files Created

- `packages/language-services/src/engines/formula/completions.ts`
- `packages/language-services/src/engines/formula/hover.ts`

## Test Results

All 13 completions + hover tests pass (run isolated from missing diagnostics/signature stubs):

```
✓ formulaHover — known function > returns non-null hover with markdown content for IF at char 0
✓ formulaHover — known function > returns hover with range when hovering over a known function
✓ formulaHover — TRUE and FALSE (gap fix D-05) > returns non-null hover for TRUE in IF({x}, TRUE, FALSE)
✓ formulaHover — TRUE and FALSE (gap fix D-05) > returns non-null hover for FALSE
✓ formulaHover — unknown identifier > returns null for cursor on a number literal
✓ formulaCompletions — function items > includes IF with kind Function (2)
✓ formulaCompletions — function items > includes AND and OR
✓ formulaCompletions — function items > IF item has insertText "IF($0)" (single tab stop)
✓ formulaCompletions — function items > does not include AUTONUMBER, CREATED_BY, LOG10, TEXT (gap fix D-05)
✓ formulaCompletions — constants > TRUE has kind Constant (20)
✓ formulaCompletions — constants > FALSE and BLANK and NOW are present as constants
✓ formulaCompletions — date unit items > 'days' item has kind Value (11)
✓ formulaCompletions — date unit items > includes all 7 date unit strings

Test Files: 2 passed (2)
Tests: 13 passed (13)
```

Note: Full suite shows 5 failed suites due to missing `diagnostics.ts` (plan 02-03) and `signature.ts` (plan 02-05) — those are parallel wave dependencies not owned by this plan.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both files are fully implemented.

## Threat Flags

None — no network endpoints, auth paths, or file access patterns introduced.

## Self-Check: PASSED

- `packages/language-services/src/engines/formula/completions.ts` — FOUND
- `packages/language-services/src/engines/formula/hover.ts` — FOUND
- Commit `1614258` — FOUND
