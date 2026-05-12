---
plan: 02-03
phase: 02-formula-engine-migration
status: complete
wave: 2
subsystem: language-services/engines/formula
tags: [diagnostics, migration, pure-ts, no-vscode]
dependency-graph:
  requires: [02-01, 02-02]
  provides: [formulaDiagnostics]
  affects: [02-06, 02-07]
tech-stack:
  added: []
  patterns: [module-level-functions, offset-to-position-helper, exclusion-ranges, callable-constants-set]
key-files:
  created:
    - packages/language-services/src/engines/formula/diagnostics.ts
  modified: []
decisions:
  - Replaced 02-05 stub (86 lines) with full implementation (370 lines) from extension/src/diagnostics.ts
  - uri? parameter threads relatedInformation for paren/bracket checks (option a from RESEARCH.md)
  - CALLABLE_CONSTANTS Set built at call-time inside checkFunctions (not module-level) for clarity
metrics:
  duration: ~8 minutes
  completed: 2026-05-13
  tasks: 1
  files: 1
---

# Phase 02 Plan 03 Summary

## What Was Done

Full migration of the formula diagnostics engine from `packages/extension/src/diagnostics.ts` (713-line VS Code class) to `packages/language-services/src/engines/formula/diagnostics.ts` (370-line pure TypeScript module).

The existing stub created by Plan 02-05 (86 lines, minimal implementation) was replaced with the complete implementation covering all 10 diagnostic check functions.

## Files Created

- `packages/language-services/src/engines/formula/diagnostics.ts` — full diagnostics engine, zero vscode imports

## Key Implementation Details

**Position helpers**: `offsetToPosition(text, offset)` and `makeRange(text, start, end)` replace all `document.positionAt(offset)` and `new vscode.Range(...)` calls from the original VS Code class.

**CALLABLE_CONSTANTS fix (Pitfall 3)**: `checkFunctions` builds `functionsRequiringParens` by filtering `ALL_FUNCTION_NAMES` against a `Set` of `CALLABLE_CONSTANTS` (which includes TRUE and FALSE). This ensures `IF({Field}, TRUE, FALSE)` never triggers `missing-function-parenthesis`.

**relatedInformation (WR-02)**: `checkParentheses` and `checkBrackets` accept an optional `uri?: string` parameter. When provided, unclosed-delimiter diagnostics include `relatedInformation` pointing to the opening delimiter. The VS Code wrapper passes `document.uri.toString()`.

**Exclusion ranges (Pitfall 2)**: `getExclusionRanges` operates on raw offsets into the full text string — no line splitting — to avoid offset drift when checking identifiers inside field refs, strings, or comments.

**checkFieldReferences**: Intentionally disabled with comment, matching the original (empty `{}` is valid in JSON formula output).

## Deviations from Plan

### Deviation 1: Replaced existing stub

**Type**: Expected — stub was left by Plan 02-05 (Rule 3 blocker fix to unblock signature tests)

**Action**: Overwrote stub with full implementation. The stub provided minimal coverage; the full implementation passes all 7 diagnostic-specific test cases plus maintains the 41 existing tests from other modules (48 total pass).

No other deviations — plan executed as specified.

## Test Results

All 48 tests pass (6 test files):

```
Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  1.31s
```

Diagnostics-specific tests all green:
- `formulaDiagnostics('NOTAFUNC(1, 2)')` — finds diagnostic with code 'unknown-function'
- `formulaDiagnostics('IF({Field}, TRUE, FALSE)')` — zero diagnostics with code 'missing-function-parenthesis'
- `formulaDiagnostics('VLOOKUP(x)')` — finds diagnostic with code 'common-typo'
- `formulaDiagnostics('IF(1, 2, 3) // comment')` — finds diagnostic with code 'no-comments'
- `formulaDiagnostics('IF(AND(1, 2), CONCATENATE("a", "b"), "")')` — zero diagnostics total
- Range shape: `d.range.start.line` and `d.range.start.character` are numbers

## Self-Check: PASSED

- File exists: `packages/language-services/src/engines/formula/diagnostics.ts` — FOUND
- Commit 691b561 exists — FOUND
- No vscode imports in file — VERIFIED
- All 13 required symbols present — VERIFIED
