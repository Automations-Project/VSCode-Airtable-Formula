---
phase: 06-lsp-server
plan: 01
subsystem: lsp
tags: [vscode-languageserver, tsup, vitest, noExternal, workspace-package, wave0-tests]

# Dependency graph
requires: []
provides:
  - packages/lsp-server workspace package scaffold (airtable-user-lsp)
  - tsup build config with noExternal bundling of @airtable-formula/language-services
  - vitest test infrastructure for lsp-server package
  - Wave 0 TDD test scaffolds for lsp-convert, router, tcp-server (fail red — source not yet created)
affects:
  - 06-02: Wave 1 implementation (lsp-convert.ts, router.ts, tcp-server.ts) — tests turn green
  - 06-03: LSP server entry point and stdio mode
  - 06-04: VS Code extension integration
  - 06-05: Documentation

# Tech tracking
tech-stack:
  added:
    - vscode-languageserver@^9.0.1
    - vscode-languageserver-textdocument@^1.0.12
    - tsup@^8.0.0 (devDep)
    - vitest@^1.6.0 (devDep)
    - "@airtable-formula/language-services: workspace:*" (devDep)
  patterns:
    - tsup noExternal pattern: private workspace packages bundled into public npm binary
    - Wave 0 TDD pattern: test scaffolds created before source modules; fail red until Wave 1
    - .js extension in TS imports: ESM module resolution convention in vitest

key-files:
  created:
    - packages/lsp-server/package.json
    - packages/lsp-server/tsconfig.json
    - packages/lsp-server/tsup.config.ts
    - packages/lsp-server/vitest.config.ts
    - packages/lsp-server/src/test/lsp-convert.test.ts
    - packages/lsp-server/src/test/router.test.ts
    - packages/lsp-server/src/test/tcp-server.test.ts
  modified:
    - .gitignore
    - pnpm-lock.yaml

key-decisions:
  - "tsup noExternal bundles @airtable-formula/language-services into airtable-user-lsp so the binary works outside the monorepo"
  - "Wave 0 tests are intentionally red — source modules created in 06-02 turn them green"
  - "Whitelist .gitignore required packages/lsp-server/** to be explicitly added to allow tracking"

patterns-established:
  - "noExternal: tsup.config.ts must list all private workspace deps in noExternal array"
  - "Wave 0 TDD scaffold: test file uses .js imports referencing non-existent source — fails with 'Failed to load url' not config error"

requirements-completed:
  - LSP-01
  - LSP-02

# Metrics
duration: 4min
completed: 2026-05-14
---

# Phase 06 Plan 01: lsp-server Scaffold Summary

**airtable-user-lsp pnpm workspace package scaffolded with tsup/noExternal build config, vitest test runner, and 3 Wave 0 TDD test scaffolds for lsp-convert, router, and tcp-server**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-14T19:16:17Z
- **Completed:** 2026-05-14T19:20:25Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created `packages/lsp-server/` as a fully configured pnpm workspace package (`airtable-user-lsp@1.0.0`)
- Configured tsup with `noExternal: ['@airtable-formula/language-services']` ensuring the private workspace dep is bundled into the public binary
- Configured vitest with `src/test/**/*.test.ts` glob matching the language-services pattern
- Created 3 Wave 0 test scaffolds covering lsp-convert (severity/completion kind conversions), router (language ID + extension routing), and tcp-server (bind, lockfile write, loopback-only)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create package scaffold** - `1cbde23` (feat)
2. **Task 2: Create Wave 0 test scaffolds** - `3039ab2` (test)

## Files Created/Modified
- `packages/lsp-server/package.json` - Package identity, bin entry (dist/index.mjs), publishConfig.provenance
- `packages/lsp-server/tsconfig.json` - NodeNext/ES2022 TypeScript config
- `packages/lsp-server/tsup.config.ts` - ESM bundle config with noExternal for language-services
- `packages/lsp-server/vitest.config.ts` - Test runner config matching language-services pattern
- `packages/lsp-server/src/test/lsp-convert.test.ts` - Wave 0 tests for toLspSeverity and toLspCompletionKind (+1 offset assertions)
- `packages/lsp-server/src/test/router.test.ts` - Wave 0 tests for routeDocument (language ID routing + 8 extension fallbacks + 2 null cases)
- `packages/lsp-server/src/test/tcp-server.test.ts` - Wave 0 tests for startTcpServer (port > 0, lockfile write, 127.0.0.1 binding)
- `.gitignore` - Added `packages/lsp-server/**` to whitelist (deviation fix)
- `pnpm-lock.yaml` - Updated by pnpm install after package registration

## Decisions Made
- Used `noExternal` in tsup.config.ts to bundle `@airtable-formula/language-services` — necessary because language-services is `"private": true` and can't be a runtime npm dep of airtable-user-lsp
- Wave 0 tests intentionally reference non-existent source modules — they will fail red until 06-02 implements those modules

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added packages/lsp-server/** to .gitignore whitelist**
- **Found during:** Task 1 (package scaffold creation)
- **Issue:** The repo uses a whitelist `.gitignore` (ignores everything by default, then opts in). `packages/lsp-server/` was not in the whitelist, so all created files were silently ignored — git status showed nothing untracked
- **Fix:** Added `!packages/lsp-server/` and `!packages/lsp-server/**` entries to `.gitignore` section 6 (Allow packages directory structure)
- **Files modified:** `.gitignore`
- **Verification:** After edit, `git status` showed `?? packages/lsp-server/` — files trackable
- **Committed in:** `1cbde23` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing gitignore whitelist entry)
**Impact on plan:** Essential for files to be tracked in git. No scope creep.

## Issues Encountered
- language-services `dist/` did not exist at test time — vitest's Vite-based resolver couldn't resolve `@airtable-formula/language-services` without a built dist. Built language-services (`pnpm -F @airtable-formula/language-services build`) before re-running tests. After building, all 3 tests fail with the correct "Failed to load url" (source file missing) errors rather than package resolution errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Package scaffold is complete and registered in pnpm workspace
- Wave 0 tests are in place and failing red for the correct reason (source modules not yet created)
- 06-02 can immediately implement `lsp-convert.ts`, `router.ts`, and `tcp-server.ts` to turn these tests green

---
*Phase: 06-lsp-server*
*Completed: 2026-05-14*
