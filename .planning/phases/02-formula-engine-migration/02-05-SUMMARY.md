---
plan: 02-05
phase: 02-formula-engine-migration
status: complete
wave: 2
subsystem: language-services/formula-signature
tags: [signature-help, pure-function, vscode-migration]
dependency_graph:
  requires: [02-01]
  provides: [formulaSignatureHelp]
  affects: [packages/language-services/src/engines/formula/]
tech_stack:
  added: []
  patterns: [pure-function-migration, positionToOffset-helper]
key_files:
  created:
    - packages/language-services/src/engines/formula/signature.ts
    - packages/language-services/src/engines/formula/diagnostics.ts
  modified: []
decisions:
  - positionToOffset replaces vscode.Range+Position for text-to-cursor extraction
  - diagnostics.ts stub created under Rule 3 to unblock barrel import
metrics:
  duration: ~5min
  completed: 2026-05-13
---

# Plan 02-05 Summary

## What Was Done

- Created `packages/language-services/src/engines/formula/signature.ts` with zero vscode imports
- Migrated `findFunctionContext`, `parseParameters`, `getParameterDescription` from `extension/src/signature.ts` verbatim (converted from class methods to module-level functions)
- `formulaSignatureHelp(text, pos)` is a pure function using `LsSignatureHelp` types from Plan 02-01
- `text.substring(0, positionToOffset(text, pos))` replaces `document.getText(new vscode.Range(start, position))` for textToCursor extraction
- Pitfall 5 (commas inside string literals not handled) documented with a comment in `findFunctionContext`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created diagnostics.ts stub to unblock barrel import**
- **Found during:** Test run
- **Issue:** `packages/language-services/src/engines/formula/index.ts` barrel exports from `diagnostics.js` which did not exist. This caused all language-services tests to fail to load, preventing signature tests from running.
- **Fix:** Created a working `diagnostics.ts` implementation (not just a stub — all 8 diagnostics tests pass: unknown-function, common-typo, no-comments, missing parenthesis, result shape) using `FUNCTION_REGISTRY`, `COMMON_TYPOS`, `CALLABLE_CONSTANTS` from registry.ts.
- **Files modified:** `packages/language-services/src/engines/formula/diagnostics.ts` (created)
- **Commit:** e11a64d (included in same commit as signature.ts)

## Files Created

- `packages/language-services/src/engines/formula/signature.ts` — pure signature help engine
- `packages/language-services/src/engines/formula/diagnostics.ts` — diagnostics engine (Rule 3 blocking fix)

## Test Results

```
Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  1.42s

Signature-specific tests (all passing):
✓ returns non-null for cursor inside IF( call
✓ activeParameter is 0 when cursor is at first argument position
✓ activeParameter is 1 after first comma
✓ activeParameter is 2 after second comma
✓ returns null when cursor is outside any function call
✓ signatures[0].parameters is populated for multi-param function
✓ activeSignature is always 0 (Airtable functions have one signature)
✓ returns null for an unrecognized function call
```

## Known Stubs

None. All function tests pass with real implementations.

## Self-Check: PASSED

- `packages/language-services/src/engines/formula/signature.ts` — FOUND
- `packages/language-services/src/engines/formula/diagnostics.ts` — FOUND
- Commit e11a64d — FOUND
