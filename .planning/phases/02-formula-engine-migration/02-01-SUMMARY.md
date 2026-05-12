---
plan: 02-01
phase: 02-formula-engine-migration
status: complete
wave: 1
---

# Plan 02-01 Summary

## What Was Done
- Added LsSignatureHelp, LsSignatureInformation, LsParameterInformation to packages/language-services/src/types.ts
- Fixed WR-04: "types" condition is now first in language-services/package.json exports map
- Created 5 Wave-0 test scaffold files in packages/language-services/src/test/formula/

## Files Modified
- packages/language-services/src/types.ts — 3 new interfaces appended after LsHover
- packages/language-services/package.json — exports "." condition reordered (types first)
- packages/language-services/src/test/formula/registry.test.ts — created
- packages/language-services/src/test/formula/diagnostics.test.ts — created
- packages/language-services/src/test/formula/completions.test.ts — created
- packages/language-services/src/test/formula/hover.test.ts — created
- packages/language-services/src/test/formula/signature.test.ts — created

## Verification
- WR-04: package.json "types" is first export condition (node -e check passed)
- Build passes: pnpm -F @airtable-formula/language-services build
- 5 test files exist at packages/language-services/src/test/formula/
- Test files import from '../../engines/formula/index.js' (RED state expected until Wave 2)
- grep -c count for new interfaces: 5 matches in types.ts

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Test files import from engine paths that do not yet exist (intentional RED state for Wave 0).

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.
