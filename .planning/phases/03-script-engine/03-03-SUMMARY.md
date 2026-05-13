---
phase: 03-script-engine
plan: "03"
subsystem: language-services/engines/script
tags: [typescript, language-services, script-engine, completions, hover, pure-function]
dependency_graph:
  requires:
    - phase: 03-script-engine
      plan: 02
      provides: SCRIPT_GLOBALS registry, ScriptGlobalInfo/ScriptMethodInfo types
  provides:
    - scriptCompletions pure function (completions.ts)
    - scriptHover pure function (hover.ts)
  affects:
    - packages/language-services/src/engines/script/completions.ts
    - packages/language-services/src/engines/script/hover.ts
tech_stack:
  added: []
  patterns:
    - Two-level completion engine: dot-triggered Method-kind and top-level Variable-kind
    - Two-level hover engine: window-based method hover (level 2) then global identifier hover (level 1)
    - Pure function API — no vscode imports in engine layer (D-10 pattern)
    - End-anchored dot-trigger regex on textToCursor slice (T-03-01 DoS mitigation)
    - Fixed 80-char window for hover dot-pattern search (T-03-01 DoS mitigation)
key_files:
  created:
    - packages/language-services/src/engines/script/completions.ts
    - packages/language-services/src/engines/script/hover.ts
  modified: []
decisions:
  - "index.ts NOT modified — Plan 03-04 owns index.ts re-exports per parallel execution constraint"
  - "hover Level 2 uses window-scan with cursor-in-method-span check (not end-anchored regex) to correctly handle e.g. 'base.getTables()' where the word ends before method span"
  - "fetch dot-trigger returns [] correctly — empty methods{} means no method completions (D-07)"
  - "JS identifier regex /[a-zA-Z_$][a-zA-Z0-9_$]*/g in extractWordAt (no toUpperCase) — case-sensitive lookup"
metrics:
  duration: "~10min"
  completed: "2026-05-13T14:33:00Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 3 Plan 03: Script Completions and Hover Engines Summary

**scriptCompletions() and scriptHover() pure functions implementing two-level completion and hover resolution from SCRIPT_GLOBALS registry — zero vscode dependencies**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-13T14:23:00Z
- **Completed:** 2026-05-13T14:33:00Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- Created `engines/script/completions.ts` — pure `scriptCompletions(text, pos)` function with two-level logic: dot-triggered method completions (Method kind) and top-level global completions (Variable kind). End-anchored regex on textToCursor slice provides O(n) bounded DoS protection per T-03-01. fetch global correctly returns [] on dot-trigger (D-07 call-sig-only design).
- Created `engines/script/hover.ts` — pure `scriptHover(text, pos)` function with two-level resolution: method hover via fixed 80-char window scan (O(1) bounded, T-03-01), and global identifier hover via extractWordAt. JS identifier regex `/[a-zA-Z_$][a-zA-Z0-9_$]*/g` used (no `.toUpperCase()`, case-sensitive). Both files have zero vscode imports.

## Task Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Create engines/script/completions.ts | `2cd476e` | completions.ts |
| Task 2: Create engines/script/hover.ts | `0d6d22f` | hover.ts |

## Files Created

- `packages/language-services/src/engines/script/completions.ts` — `scriptCompletions` export, two-level completion logic, no vscode imports
- `packages/language-services/src/engines/script/hover.ts` — `scriptHover` export, two-level hover logic, adapted extractWordAt, no vscode imports

## Decisions Made

1. **index.ts not modified** — Per the parallel execution constraint and plan instructions. Plan 03-04 will add `export * from './completions.js'` and `export * from './hover.js'` after diagnostics.ts is created. The vitest tests for completions and hover remain in the failing state until Plan 03-04 completes.

2. **hover Level 2 window-scan approach** — The method hover check extracts a fixed 80-char window around the cursor and iterates all `globalName.methodName` matches, then checks if the cursor offset falls within the method name span. This is more robust than a `$`-anchored match (which would fail for inputs like `base.getTables()` where the word is followed by `()`).

3. **extractWordAt regex** — `/[a-zA-Z_$][a-zA-Z0-9_$]*/g` uses lowercase chars and `$` sigil per the plan spec. Returns `match[0]` directly without `.toUpperCase()` — JS identifier lookups in SCRIPT_GLOBALS are case-sensitive.

4. **fetch dot-trigger returns []** — `fetch` has `methods: {}` in the registry (D-07). When the user types `fetch.`, the Level 2 branch finds a globalInfo with no methods, returns `Object.entries({}).map(...)` = []. Correct behavior.

## Deviations from Plan

None — plan executed exactly as written. The parallel execution constraint (no index.ts modifications) was honored.

## Known Stubs

None. These are fully implemented pure functions. The test scaffolds remain in the failing state because index.ts has not yet been updated (owned by Plan 03-04), but the implementation itself is complete.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The two files are pure text-processing functions operating entirely on user document content passed as parameters. Both files are within the scope of the plan's threat model (T-03-01, T-03-02).

## Self-Check: PASSED

- `packages/language-services/src/engines/script/completions.ts` — FOUND
- `packages/language-services/src/engines/script/hover.ts` — FOUND
- Commit `2cd476e` — FOUND
- Commit `0d6d22f` — FOUND
- Build passes: pnpm -F language-services build exits 0 — VERIFIED
- index.ts NOT modified — VERIFIED
- No vscode imports in either file — VERIFIED (grep returns no matches)
