---
plan: 02-02
phase: 02-formula-engine-migration
status: complete
wave: 1
---

# Plan 02-02 Summary

## What Was Done
- Created packages/language-services/src/engines/formula/registry.ts with unified FUNCTION_REGISTRY
- Applied D-05 gap fixes: TRUE/FALSE added to Logical, TEXT removed (not a real Airtable formula function)
- CALLABLE_CONSTANTS set to 5 entries: NOW, TODAY, BLANK, TRUE, FALSE
- Migrated COMMON_TYPOS, SMART_QUOTES, levenshteinDistance from packages/extension/src/diagnostics.ts
- Created packages/language-services/src/engines/formula/index.ts barrel re-exporting all 5 engine modules

## Files Created
- packages/language-services/src/engines/formula/registry.ts
- packages/language-services/src/engines/formula/index.ts

## Verification
- registry.ts: TRUE/FALSE present, TEXT removed OK
- index.ts: all 5 re-exports present OK
- No vscode imports in registry.ts OK

## Notes
- LOG10 was in the original functions.ts and has been retained (D-05 only excluded AUTONUMBER, CREATED_BY, LAST_MODIFIED_BY — LOG10 was already in functions.ts and is kept)
- The barrel index.ts re-exports diagnostics.js, completions.js, hover.js, signature.js — these files do not exist yet; TypeScript compilation will fail until Plans 03-05 create them (expected Wave 1 behavior)
- levenshteinDistance migrated verbatim from the private class method in diagnostics.ts, promoted to a top-level exported function
