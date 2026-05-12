---
plan: 02-08
phase: 02-formula-engine-migration
status: complete
wave: 5
tags: [migration, wire-up, cleanup, icons, language-registration]
key-decisions:
  - Import paths in registration.ts point to ./formula/formula-* thin wrapper files
  - codeActions.ts imports directly from @airtable-formula/language-services package
  - .fx extension added as shorthand alias for airtable-formula language ID
  - SVG icons created as placeholder monogram icons (blue background, white/dark "f")
---

# Phase 02 Plan 08: Wire Registration + Delete Legacy Files + Icons Summary

## One-liner

Final wave — wired the 4 new wrapper classes into registration.ts, updated codeActions.ts to import from the language-services package, deleted all 5 legacy provider files, and added .fx extension support with SVG language icons.

## What Was Done

- `registration.ts` updated to import the 4 provider classes from `./formula/formula-diagnostics`, `./formula/formula-completions`, `./formula/formula-hover`, `./formula/formula-signature` (the thin wrapper files created in Wave 4)
- `codeActions.ts` updated to import `ALL_CALLABLE` and `FUNCTION_REGISTRY` from `@airtable-formula/language-services` instead of the now-deleted `./functions`
- Deleted 5 legacy extension source files: `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `functions.ts`
- Created placeholder SVG icons at `packages/extension/icons/formula-light.svg` and `formula-dark.svg`
- Updated `package.json` `contributes.languages` entry: added `.fx` to extensions array and `icon` block pointing to the two SVG files

## Files Modified

- `packages/extension/src/language/registration.ts`
- `packages/extension/src/codeActions.ts`
- `packages/extension/package.json`

## Files Deleted

- `packages/extension/src/diagnostics.ts`
- `packages/extension/src/completions.ts`
- `packages/extension/src/hover.ts`
- `packages/extension/src/signature.ts`
- `packages/extension/src/functions.ts`

## Files Created

- `packages/extension/icons/formula-light.svg`
- `packages/extension/icons/formula-dark.svg`

## Build & Test

- `pnpm -F airtable-formula build`: success (398ms, 0 TypeScript errors)
- `pnpm build` (full workspace): success
- `pnpm test` (full workspace): 205/205 pass (154 mcp-server, 8 webview, 43 extension)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — SVG icons are functional placeholder icons appropriate for language icon contributions.

## Self-Check: PASSED

- packages/extension/src/language/registration.ts: imports updated to ./formula/formula-* paths
- packages/extension/src/codeActions.ts: imports from @airtable-formula/language-services
- 5 legacy files deleted (verified by node script)
- packages/extension/icons/formula-light.svg: exists
- packages/extension/icons/formula-dark.svg: exists
- packages/extension/package.json: .fx present, icon contribution present
- Commit 9450c28: feat(02-08): wire migration
