---
phase: 03-script-engine
plan: "01"
subsystem: language-services/test
tags: [tdd, test-scaffold, script-engine, red-state]
dependency_graph:
  requires: []
  provides:
    - "Wave 0 test contract for script engine (SCRIPT-02 through SCRIPT-05)"
  affects:
    - "packages/language-services/src/test/script/"
tech_stack:
  added: []
  patterns:
    - "TDD RED scaffold — tests import from non-existent engine module"
    - "Vitest describe/it/expect pattern mirroring formula test analogs"
key_files:
  created:
    - packages/language-services/src/test/script/registry.test.ts
    - packages/language-services/src/test/script/completions.test.ts
    - packages/language-services/src/test/script/hover.test.ts
    - packages/language-services/src/test/script/diagnostics.test.ts
  modified: []
decisions:
  - "Test scaffolds match plan spec exactly — no deviations required"
  - "All 4 files import from engines/script/index.js (non-existent) for correct RED state"
metrics:
  duration: "~5min"
  completed: "2026-05-13T11:21:53Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
---

# Phase 3 Plan 01: Script Engine Wave 0 Test Scaffolds Summary

Four Wave 0 test scaffold files for the script engine — defines the acceptance contract (SCRIPT-02 through SCRIPT-05) before any implementation exists.

## What Was Built

Four test files in `packages/language-services/src/test/script/` that collectively define the behavioral contract for the script engine:

**registry.test.ts** — 9 tests covering:
- All 8 Airtable scripting globals present (`base`, `table`, `cursor`, `input`, `output`, `session`, `fetch`, `remoteFetchAsync`)
- Each global has string description and methods object
- `base.getTables` has signature containing "getTables" and a truthy description
- `table.selectRecordsAsync` defined
- `cursor` has `selectedRecordIds` / `activeTableId` (D-03)
- `SCRIPT_GLOBAL_NAMES` has length 8
- `getScriptGlobal('base')` returns the entry; `getScriptGlobal('unknownXYZ')` returns undefined

**completions.test.ts** — 9 tests covering:
- All 8 globals returned as top-level completions
- `base` item has `kind = LsCompletionItemKind.Variable` (5)
- Top-level `insertText` equals label
- Dot-triggered: `base.` returns `getTables` with `kind = Method` (1) and `insertText` matching `/\(\$0\)$/`
- Dot-triggered: `table.` returns `selectRecordsAsync`
- Unknown object dot returns empty array
- All dot-triggered items have kind Method

**hover.test.ts** — 6 tests covering:
- `scriptHover('base', {0,0})` returns non-null with `contents.kind === 'markdown'`
- Content for `base` contains "base"
- Method hover at `char 6` in `'base.getTables()'` returns hover containing "getTables"
- Method hover for `selectRecordsAsync`
- Unknown identifier returns null
- Empty string returns null

**diagnostics.test.ts** — 13 tests covering:
- SCRIPT-04: bare `selectRecordsAsync({})` flagged as `missing-await` (Warning severity)
- SCRIPT-04: bare `createRecordAsync({})` also flagged
- SCRIPT-04: `await`, `return`, `const p =`, `.then()`, and chained await patterns are NOT flagged
- SCRIPT-05: `myLib.doThing()` flagged as `unknown-global` (Warning severity)
- SCRIPT-05: `console`, `Math` (JS built-ins) NOT flagged
- SCRIPT-05: Airtable global `base` NOT flagged
- SCRIPT-05: locally-declared variable NOT flagged
- SCRIPT-05: function parameter identifier NOT flagged

## Verification Result

```
Test Files  4 failed | 6 passed (10)
      Tests  48 passed (48)
```

All 4 script test files discovered and failing with:
```
Error: Failed to load url ../../engines/script/index.js ... Does the file exist?
```

This is the correct RED state — the engine does not exist yet. All formula tests continue to pass (48 tests).

`grep -l "engines/script/index.js" packages/language-services/src/test/script/*.test.ts` returns 4 paths (verified).

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: registry + completions scaffolds | `6e8c632` | registry.test.ts, completions.test.ts |
| Task 2: hover + diagnostics scaffolds | `752e938` | hover.test.ts, diagnostics.test.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. These are test scaffold files with no data to wire.

## TDD Gate Compliance

This plan is Wave 0 (RED gate only). Both commits use `test(...)` type — RED gate is present. GREEN gate will be established in Plans 03-02 through 03-04 when the engine is implemented.

## Self-Check: PASSED

- `packages/language-services/src/test/script/registry.test.ts` — FOUND
- `packages/language-services/src/test/script/completions.test.ts` — FOUND
- `packages/language-services/src/test/script/hover.test.ts` — FOUND
- `packages/language-services/src/test/script/diagnostics.test.ts` — FOUND
- Commit `6e8c632` — FOUND
- Commit `752e938` — FOUND
