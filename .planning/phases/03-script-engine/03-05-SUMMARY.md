---
phase: 03-script-engine
plan: "05"
subsystem: extension-static-assets
tags: [grammar, language-config, icons, airtable-script]
dependency_graph:
  requires: []
  provides:
    - packages/extension/syntaxes/airtable-script.tmLanguage.json
    - packages/extension/language-configuration/airtable-script-language-configuration.json
    - packages/extension/icons/script-light.svg
    - packages/extension/icons/script-dark.svg
  affects:
    - packages/extension/package.json (consumes grammar + language config + icons)
tech_stack:
  added: []
  patterns:
    - TextMate grammar source.js delegation (no custom repository)
    - JS language configuration with backtick autoClosingPair
    - SVG placeholder icon pattern (mirrors formula icons)
key_files:
  created:
    - packages/extension/syntaxes/airtable-script.tmLanguage.json
    - packages/extension/language-configuration/airtable-script-language-configuration.json
    - packages/extension/icons/script-light.svg
    - packages/extension/icons/script-dark.svg
  modified: []
decisions:
  - D-13: airtable-script language ID for .script and .ats; grammar embeds source.js (no custom rules)
  - D-14: placeholder SVGs at icons/script-light.svg and script-dark.svg; user swaps artwork when ready
metrics:
  duration: "~5 minutes"
  completed: "2026-05-13T11:32:05Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
---

# Phase 3 Plan 05: Script Engine Static Assets Summary

**One-liner:** TextMate grammar delegating to source.js, JS language config with backtick support, and green SVG placeholder icons for the airtable-script language.

## What Was Built

Four static asset files for the `airtable-script` language ID with no compilation step:

1. **`airtable-script.tmLanguage.json`** — Minimal grammar with `scopeName: source.airtable-script` and a single `{ "include": "source.js" }` pattern. No `repository` section. VS Code's built-in JavaScript grammar handles all tokenization.

2. **`airtable-script-language-configuration.json`** — JS-appropriate language config with:
   - `lineComment: "//"` and block comment `/* */`
   - `wordPattern` extended to include `$` for JS identifiers
   - Brace-based `indentationRules` (replacing formula's paren-based rules)
   - All bracket pairs `{} [] ()`
   - `autoClosingPairs` and `surroundingPairs` including backtick for template literals
   - No `folding.markers` (formula-specific paren folding removed)

3. **`script-light.svg`** — 4-line SVG placeholder: green fill `#388E3C`, letter `S`, same structure as `formula-light.svg`.

4. **`script-dark.svg`** — 4-line SVG placeholder: darker green fill `#2E7D32`, letter `S`, same structure as `formula-dark.svg`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create grammar JSON and language configuration JSON | d151cb2 | syntaxes/airtable-script.tmLanguage.json, language-configuration/airtable-script-language-configuration.json |
| 2 | Create SVG placeholder icons for script files | 748776f | icons/script-light.svg, icons/script-dark.svg |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `script-light.svg` and `script-dark.svg` are placeholder icons per D-14 from CONTEXT.md. User will swap SVG content with final artwork when ready. These stubs are intentional and do not prevent the plan's goal (registering the language ID and enabling VS Code to load the files) from being achieved.

## Threat Flags

None. All files are static assets with no injection surface. Grammar contains only a single include rule (DoS surface zero). SVG icons contain no user data.

## Self-Check: PASSED

Files verified to exist:
- FOUND: packages/extension/syntaxes/airtable-script.tmLanguage.json
- FOUND: packages/extension/language-configuration/airtable-script-language-configuration.json
- FOUND: packages/extension/icons/script-light.svg
- FOUND: packages/extension/icons/script-dark.svg

Commits verified:
- FOUND: d151cb2 (feat(03-05): create grammar JSON and language configuration JSON)
- FOUND: 748776f (feat(03-05): create SVG placeholder icons for script files)

JSON parse check: PASSED (both JSON files parse without error)
Acceptance criteria: PASSED (all 9 grammar + language config criteria, all 7 SVG criteria)
