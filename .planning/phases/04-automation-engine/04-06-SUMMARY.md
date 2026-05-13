---
phase: 04-automation-engine
plan: "04-06"
subsystem: extension
tags: [vscode, language-features, diagnostics, completions, hover, automation]

# Dependency graph
requires:
  - phase: 04-03
    provides: automationCompletions, automationHover stubs in language-services
  - phase: 04-04
    provides: automationDiagnostics engine implementation in language-services

provides:
  - AirtableAutomationDiagnosticsProvider (VS Code wrapper with languageId guard)
  - AirtableAutomationCompletionProvider (VS Code wrapper delegating to automationCompletions)
  - AirtableAutomationHoverProvider (VS Code wrapper delegating to automationHover)

affects: [04-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin VS Code wrapper class — imports engine fn from @airtable-formula/language-services, converts LsTypes to VS Code types via ../convert, delegates all logic to engine"
    - "languageId guard in updateDiagnostics prevents cross-language contamination"

key-files:
  created:
    - packages/extension/src/language/automation/automation-diagnostics.ts
    - packages/extension/src/language/automation/automation-completions.ts
    - packages/extension/src/language/automation/automation-hover.ts
  modified: []

key-decisions:
  - "Direct copy-adaptation of script/ wrappers — no new patterns introduced, consistent with formula/ and script/ analogs"
  - "Import from @airtable-formula/language-services package alias (not relative engine path) — same as all other wrapper classes"

patterns-established:
  - "automation/ wrapper pattern: mirrors script/ wrappers exactly with automation substitutions"

requirements-completed: [AUTO-01, AUTO-02, AUTO-03, AUTO-04]

# Metrics
duration: 2min
completed: 2026-05-13
---

# Phase 04 Plan 06: VS Code wrapper classes for automation providers Summary

**Three thin VS Code wrapper classes for automation language features — diagnostics with airtable-automation languageId guard, completions, and hover — all delegating to @airtable-formula/language-services engine functions**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-13T18:43:40Z
- **Completed:** 2026-05-13T18:45:06Z
- **Tasks:** 2 (Task 1: diagnostics, Task 2: completions + hover)
- **Files modified:** 3 created

## Accomplishments
- Created `packages/extension/src/language/automation/` directory with all three wrapper classes
- `AirtableAutomationDiagnosticsProvider` guards on `languageId === 'airtable-automation'` (T-04-10 mitigation), DiagnosticCollection scoped to `'airtable-automation'`
- `AirtableAutomationCompletionProvider` and `AirtableAutomationHoverProvider` delegate directly to engine functions; hover returns `null` when engine returns null
- `pnpm -F airtable-formula build` and `pnpm -F @airtable-formula/language-services build` both clean

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: Create all three automation wrapper classes** - `1a36ee4` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/extension/src/language/automation/automation-diagnostics.ts` - AirtableAutomationDiagnosticsProvider with languageId guard and DiagnosticCollection
- `packages/extension/src/language/automation/automation-completions.ts` - AirtableAutomationCompletionProvider delegating to automationCompletions
- `packages/extension/src/language/automation/automation-hover.ts` - AirtableAutomationHoverProvider delegating to automationHover, returns null on miss

## Decisions Made
- Followed script/ analog pattern exactly — no new decisions needed. Copy-adaptation with three substitutions per file (class name, import symbol, language ID strings).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `tsc --noEmit` run directly from extension package shows pre-existing `@airtable-formula/language-services` module resolution errors on all wrapper files (formula/, script/, and now automation/ all show same error). These are pre-existing workspace path alias resolution issues when running `tsc` directly outside tsup. The `pnpm -F airtable-formula build` (tsup) succeeds cleanly — consistent with how prior plans' wrappers behave.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three automation VS Code wrapper classes are ready for import
- Plan 04-07 can now import `AirtableAutomationDiagnosticsProvider`, `AirtableAutomationCompletionProvider`, `AirtableAutomationHoverProvider` from `./automation/automation-diagnostics`, `./automation/automation-completions`, `./automation/automation-hover`
- No blockers

---
*Phase: 04-automation-engine*
*Completed: 2026-05-13*
