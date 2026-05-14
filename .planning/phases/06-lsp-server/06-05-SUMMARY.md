---
phase: 06-lsp-server
plan: 05
subsystem: lsp-release
tags: [release-pipeline, github-actions, npm-publish, readme, documentation]

# Dependency graph
requires:
  - 06-03  # lsp-server package (airtable-user-lsp) exists and builds
  - 06-04  # daemon integration (port_lsp in lockfile) documented
provides:
  - lsp-server release pipeline in release.yml
  - packages/lsp-server/README.md standalone npm docs
affects:
  - .github/workflows/release.yml — lsp-server selectable as release target
  - packages/lsp-server/README.md — public npm package documentation

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Mirror mcp-server release pattern for independent package publishing
    - npm provenance via --provenance flag (SLSA attestation)

key-files:
  created:
    - packages/lsp-server/README.md
  modified:
    - .github/workflows/release.yml

key-decisions:
  - "lsp-server release is independent (not part of 'both') — lsp-server and mcp-server ship on separate cadences"
  - "Build LSP server step placed before publish step — dist/ is absent until build runs"
  - "npm publish uses --provenance --access public matching mcp-server pattern (SLSA attestation)"

requirements-completed:
  - LSP-01

# Metrics
duration: 8min
completed: 2026-05-14
---

# Phase 06 Plan 05: Release Pipeline and README Summary

**lsp-server release pipeline added to release.yml (version bump + build + npm publish + tag + GitHub Release) and standalone README created for airtable-user-lsp npm package**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-14T23:29:00Z
- **Completed:** 2026-05-14T23:37:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added 'lsp-server' as a selectable target in the GitHub Actions release workflow UI
- Mirrored the mcp-server release pattern exactly: version bump reads from npm registry (`airtable-user-lsp`), picks higher of local vs published, bumps by major/minor/patch input
- Added build step (`pnpm -F airtable-user-lsp build`) before publish — required because dist/ is absent until build runs
- npm publish uses `--provenance --access public` for SLSA attestation (T-06-05-01 mitigated)
- Git tag pattern: `lsp-server/vX.Y.Z`; GitHub Release titled `LSP Server vX.Y.Z`
- Created complete standalone README for `airtable-user-lsp` npm package with quick start, 4 editor configs (Neovim, Zed, OpenCode/Claude Code, Helix), file type table, and daemon TCP mode section

## Task Commits

Each task was committed atomically:

1. **Task 1: Add lsp-server target to release.yml** — `ca57d16` (feat)
2. **Task 2: Create packages/lsp-server/README.md** — `11a493f` (docs)

## Files Created/Modified

- `.github/workflows/release.yml` — 77 lines added: lsp-server option in target choices, Bump LSP server version step, Build LSP server step, Publish LSP server to npm step, lsp-server commit/tag block, Create LSP server GitHub Release step, lsp-server Summary line
- `packages/lsp-server/README.md` — 116 lines: features list, quick start (npx), 4 editor configs, file type table, daemon TCP mode, MIT license

## Decisions Made

- lsp-server is independent from `both` — publishing lsp-server doesn't bundle with extension or mcp-server; each ships on its own cadence
- Build step is separate from the global `pnpm build` step — lsp-server build is only run when `target == 'lsp-server'` to avoid wasted CI time on unrelated targets
- README covers Helix in addition to the plan's specified editors (Neovim, OpenCode, Zed) — Helix is a natural LSP-native editor audience; added as a small addition, no scope impact

## Deviations from Plan

None — plan executed exactly as written. The only minor addition was Helix editor config in README (Neovim, Zed, OpenCode/Claude Code, Helix vs. the plan's Neovim, OpenCode, Zed) — this is purely additive documentation.

## Verification

- YAML syntax valid: `node -e "require('js-yaml').load(...)"` returns success
- All 7 release.yml acceptance criteria confirmed via Node.js assertions
- All 6 README.md acceptance criteria confirmed
- `pnpm -F airtable-user-lsp test` — 21 tests pass across 3 files (after `pnpm -F @airtable-formula/language-services build`)

## Known Stubs

None.

## Threat Flags

None — no new network endpoints or auth paths introduced. The npm publish provenance flag (T-06-05-01) is included as specified.

---

## Self-Check

Checking created/modified files exist and commits are present...

## Self-Check: PASSED

- FOUND: .github/workflows/release.yml
- FOUND: packages/lsp-server/README.md
- FOUND: commit ca57d16 (feat — release.yml)
- FOUND: commit 11a493f (docs — README.md)
