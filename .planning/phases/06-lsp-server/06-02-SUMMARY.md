---
phase: 06-lsp-server
plan: 02
subsystem: lsp
tags: [vscode-languageserver, lsp, language-services, type-conversion, routing]

# Dependency graph
requires:
  - phase: 06-01
    provides: lsp-server package scaffold with test files (lsp-convert.test.ts, router.test.ts, tcp-server.test.ts)
provides:
  - lsp-convert.ts with 6 exported conversion functions (LsXxx → LSP protocol types, +1 offset)
  - router.ts with routeDocument() implementing D-07 language ID + extension routing
  - 18 passing tests (7 lsp-convert + 11 router)
affects: [06-03, 06-04, 06-05]

# Tech tracking
tech-stack:
  added: [vscode-languageserver-types (Range, Position, DiagnosticSeverity, CompletionItemKind)]
  patterns:
    - "+1 offset for all LsXxx → LSP enum conversions (LsSeverity, LsCompletionItemKind)"
    - "Language ID priority over file extension for engine routing (D-07)"
    - "try/catch around new URL(uri) for malformed URI safety (T-06-02-01)"

key-files:
  created:
    - packages/lsp-server/src/lsp-convert.ts
    - packages/lsp-server/src/router.ts
  modified: []

key-decisions:
  - "+1 offset for severity and completion kind (LsSeverity/LsCompletionItemKind are 0-based, LSP enums are 1-based) — differs from VS Code convert.ts which uses direct cast"
  - "routeDocument uses try/catch around URL parsing per T-06-02-01 threat model — returns null for malformed URIs, no crash, no path traversal"

patterns-established:
  - "Pattern 1: LsXxx → LSP type conversion: always apply +1 offset for enum values (verified for severity and completion kind)"
  - "Pattern 2: routeDocument priority: languageId first, extname fallback, null for unknown"

requirements-completed: [LSP-02, LSP-03]

# Metrics
duration: 15min
completed: 2026-05-14
---

# Phase 06 Plan 02: lsp-convert and router Summary

**Type-safe LSP conversion layer (6 functions, +1 offset) and D-07 language router (3 language IDs + 6 extensions) with 18 passing tests**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-14T22:25:00Z
- **Completed:** 2026-05-14T22:29:40Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented lsp-convert.ts with 6 exported functions covering all LsXxx → LSP protocol conversions
- Critical +1 offset applied correctly for severity (LsSeverity.Error=0 → DiagnosticSeverity.Error=1) and completion kind (LsCompletionItemKind.Text=0 → CompletionItemKind.Text=1)
- Implemented router.ts with routeDocument() routing formula/script/automation by language ID first, file extension fallback per D-07
- Malformed URI safety via try/catch mitigates T-06-02-01 threat
- All 18 tests pass (7 lsp-convert + 11 router); tcp-server.test.ts still fails as expected (module not yet created)

## Task Commits

1. **Task 1: Implement lsp-convert.ts** - `5aba078` (feat)
2. **Task 2: Implement router.ts** - `07a65c1` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `packages/lsp-server/src/lsp-convert.ts` - 6 exported conversion functions (toLspSeverity, toLspCompletionKind, toLspDiagnostic, toLspHover, toLspCompletionItem, toLspSignatureHelp)
- `packages/lsp-server/src/router.ts` - routeDocument() with LANG_TO_ENGINE and EXT_TO_ENGINE maps

## Decisions Made
- Used `vscode-languageserver-types` factory functions and object literals — no `new vscode.*` constructors (the lsp-server has no VS Code dependency)
- +1 offset is the critical difference from `packages/extension/src/language/convert.ts` which uses direct cast; this is correct because vscode.DiagnosticSeverity and LSP DiagnosticSeverity have different bases

## Deviations from Plan

**Deviation 1: Built language-services before running tests**
- **Found during:** Task 1 verification
- **Issue:** `@airtable-formula/language-services` had no `dist/` in the worktree (never built here), causing vitest resolution failure
- **Fix:** Ran `pnpm -F @airtable-formula/language-services build` before running tests
- **Rule:** Rule 3 (blocking issue)
- **Files modified:** packages/language-services/dist/ (generated artifacts, not committed)
- **Verification:** After build, lsp-convert.test.ts ran successfully

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** One-time worktree setup issue, no scope creep.

## Issues Encountered
- vitest version (v1.6.1) used by lsp-server resolves ESM imports strictly by `.js` extension — the test files import from `../lsp-convert.js` which vitest handles correctly by looking for the `.ts` source

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- lsp-convert.ts and router.ts are complete and tested
- Ready for Phase 06-03: tcp-server.ts implementation (the final failing test suite)
- tcp-server.test.ts currently fails with "file not found" — expected per plan's success criteria

## Self-Check

- [x] `packages/lsp-server/src/lsp-convert.ts` exists
- [x] `packages/lsp-server/src/router.ts` exists
- [x] Commit `5aba078` exists (lsp-convert.ts)
- [x] Commit `07a65c1` exists (router.ts)
- [x] 7 lsp-convert tests pass
- [x] 11 router tests pass

## Self-Check: PASSED

---
*Phase: 06-lsp-server*
*Completed: 2026-05-14*
