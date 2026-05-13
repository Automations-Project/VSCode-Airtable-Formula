---
phase: 03-script-engine
plan: "06"
subsystem: extension/language/script
tags: [wrapper-classes, vscode-providers, script-engine, diagnostics, completions, hover]
dependency_graph:
  requires:
    - "03-03"  # script engine completions
    - "03-04"  # script engine diagnostics
    - "03-05"  # script engine hover (and language-services barrel export)
  provides:
    - "AirtableScriptDiagnosticsProvider in packages/extension/src/language/script/script-diagnostics.ts"
    - "AirtableScriptCompletionProvider in packages/extension/src/language/script/script-completions.ts"
    - "AirtableScriptHoverProvider in packages/extension/src/language/script/script-hover.ts"
  affects:
    - "03-07"  # registration.ts extension — consumes these three classes
tech_stack:
  added: []
  patterns:
    - "Thin VS Code wrapper pattern: class implements vscode provider interface, delegates to pure engine function via convert.ts"
    - "DiagnosticCollection as instance field (D-03): constructor creates collection, dispose() disposes it — no module-level singletons"
key_files:
  created:
    - packages/extension/src/language/script/script-diagnostics.ts
    - packages/extension/src/language/script/script-completions.ts
    - packages/extension/src/language/script/script-hover.ts
  modified: []
decisions:
  - "Exact copy-adapt from formula wrapper analogs: same structure, same import patterns, only language ID and class/function names substituted"
  - "DiagnosticCollection created in constructor (instance field), disposed in dispose() — not a module-level singleton (D-03)"
  - "languageId guard in updateDiagnostics: early return if document.languageId !== 'airtable-script'"
metrics:
  duration: "2 minutes"
  completed: "2026-05-13T11:52:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 3 Plan 06: Script VS Code Wrapper Classes Summary

Three thin VS Code wrapper classes created in packages/extension/src/language/script/ bridging pure script engine functions (scriptDiagnostics, scriptCompletions, scriptHover) to VS Code's provider interfaces (vscode.Disposable, vscode.CompletionItemProvider, vscode.HoverProvider).

## What Was Built

Three wrapper files following the exact formula wrapper pattern:

- **script-diagnostics.ts** — `AirtableScriptDiagnosticsProvider` implements `vscode.Disposable`. Constructor creates `DiagnosticCollection('airtable-script')` as an instance field. `updateDiagnostics()` guards on `languageId !== 'airtable-script'`, calls `scriptDiagnostics()`, maps results via `toVscodeDiagnostic`.
- **script-completions.ts** — `AirtableScriptCompletionProvider` implements `vscode.CompletionItemProvider`. `provideCompletionItems()` calls `scriptCompletions()` with `toLsPosition(position)`, maps results via `toVscodeCompletionItem`.
- **script-hover.ts** — `AirtableScriptHoverProvider` implements `vscode.HoverProvider`. `provideHover()` calls `scriptHover()`, returns `toVscodeHover(result)` or `null`.

All three import from `@airtable-formula/language-services` and converters from `../convert`.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: diagnostics + completions wrappers | 416477a | script-diagnostics.ts, script-completions.ts |
| Task 2: hover wrapper | 25564c3 | script-hover.ts |

## Verification

- `ls packages/extension/src/language/script/` shows 3 files: script-diagnostics.ts, script-completions.ts, script-hover.ts
- Extension build (`tsup src/extension.ts --format cjs --dts --external vscode --out-dir dist`) exits 0
- All three classes export the expected class names
- All three files import from `@airtable-formula/language-services`

## Deviations from Plan

None - plan executed exactly as written.

## Threat Flags

None. The three wrapper files introduce no new network endpoints, auth paths, file access patterns, or schema changes. They are pure VS Code provider adapters that forward document text to engine functions and convert results — consistent with the threat model in the plan (T-03-01 mitigated by languageId guard, T-03-02 mitigated by engine-only message content).

## Self-Check: PASSED

Files exist:
- FOUND: packages/extension/src/language/script/script-diagnostics.ts
- FOUND: packages/extension/src/language/script/script-completions.ts
- FOUND: packages/extension/src/language/script/script-hover.ts

Commits exist:
- 416477a: feat(03-06): create AirtableScriptDiagnosticsProvider and AirtableScriptCompletionProvider
- 25564c3: feat(03-06): create AirtableScriptHoverProvider wrapper class
