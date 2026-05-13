---
phase: 04-automation-engine
plan: "04-01"
subsystem: testing
tags: [vitest, typescript, tdd, automation-engine, language-services]

# Dependency graph
requires:
  - phase: 03-script-engine
    provides: test scaffold pattern (registry/completions/hover/diagnostics per engine)
provides:
  - Four RED test scaffolds encoding exact AUTOMATION_GLOBALS contract (5 globals, method counts, omissions)
  - diagnostics.test.ts with all 15 forbidden patterns, 5 allowed-API checks, 5 exclusion-range checks, lastIndex regression guard
affects: [04-02, 04-03, 04-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD RED scaffold — tests import from not-yet-created engine module; vitest fail-fast on missing module]

key-files:
  created:
    - packages/language-services/src/test/automation/registry.test.ts
    - packages/language-services/src/test/automation/completions.test.ts
    - packages/language-services/src/test/automation/hover.test.ts
    - packages/language-services/src/test/automation/diagnostics.test.ts
  modified: []

key-decisions:
  - "Test files import from engines/automation/index.js which does not exist — intentional RED state for Wave 0 TDD"
  - "diagnostics.test.ts encodes all 15 forbidden patterns as the exact contract for Plans 04-02 through 04-04"

patterns-established:
  - "Wave 0 scaffolding: write tests first, all fail with missing engine import, turn GREEN as engine plans execute"
  - "exclusion-ranges tests (string literals, comments, template literals) always included in diagnostics scaffolds"
  - "lastIndex sequential-call regression test always included to guard against stateful regex bugs"

requirements-completed: [AUTO-02, AUTO-03, AUTO-04]

# Metrics
duration: 8min
completed: 2026-05-13
---

# Phase 4 Plan 01: Wave 0 Test Scaffolds for Automation Engine Summary

**Four RED vitest scaffolds encoding the exact AUTOMATION_GLOBALS contract — 5 globals, 14 table methods, input.config/output.set only, 15 forbidden wrong-context patterns with exclusion ranges**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-13T21:19:00Z
- **Completed:** 2026-05-13T21:27:00Z
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- Created four test scaffolds that encode the exact automation engine contract before any production code is written
- registry.test.ts: 11 assertions covering AUTOMATION_GLOBALS shape, per-global method counts, and omissions (cursor/session/remoteFetchAsync absent, createTableAsync/createFieldAsync absent)
- completions.test.ts: 12 assertions covering 5 top-level Variable items, dot-trigger Method items for each global (input.→config only, output.→set only, fetch.→empty), unknown object returns empty
- hover.test.ts: 14 assertions covering global hover (markdown kind, "automation" in base hover, config() in input hover), method hover, null for wrong-context globals
- diagnostics.test.ts: 28 assertions — 3 top-level forbidden globals, 12 forbidden method patterns, 5 allowed automation APIs not flagged, 5 exclusion-range checks (strings/comments/template literals), lastIndex sequential-call regression guard
- All existing formula and script tests remain GREEN (86 tests pass)

## Task Commits

Each task was committed atomically:

1. **Task 1: Registry and completions scaffolds** - `b229556` (test)
2. **Task 2: Hover and diagnostics scaffolds** - `0b5159c` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `packages/language-services/src/test/automation/registry.test.ts` - AUTOMATION_GLOBALS shape contract (global count, per-global method counts, omission checks)
- `packages/language-services/src/test/automation/completions.test.ts` - Two-level completion contract (5 top-level Variable items + dot-trigger Method items per global)
- `packages/language-services/src/test/automation/hover.test.ts` - Hover resolution contract (global hover with markdown kind, method hover, null for non-automation globals)
- `packages/language-services/src/test/automation/diagnostics.test.ts` - Wrong-context diagnostic contract (15 forbidden patterns, 5 allowed APIs, 5 exclusion ranges, lastIndex guard)

## Decisions Made
None - followed plan as specified. All test content was verbatim from plan.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four test scaffolds are in RED state, ready to turn GREEN as Plans 04-02 (registry), 04-03 (completions+hover), and 04-04 (diagnostics) implement the engine
- The test contract is the single source of truth — Plans 04-02 through 04-04 must satisfy these assertions exactly
- No blockers

## Self-Check

Files exist:
- packages/language-services/src/test/automation/registry.test.ts: FOUND
- packages/language-services/src/test/automation/completions.test.ts: FOUND
- packages/language-services/src/test/automation/hover.test.ts: FOUND
- packages/language-services/src/test/automation/diagnostics.test.ts: FOUND

Commits exist:
- b229556: FOUND (test(04-01): add RED scaffold for automation registry and completions)
- 0b5159c: FOUND (test(04-01): add RED scaffold for automation hover and diagnostics)

## Self-Check: PASSED

---
*Phase: 04-automation-engine*
*Completed: 2026-05-13*
