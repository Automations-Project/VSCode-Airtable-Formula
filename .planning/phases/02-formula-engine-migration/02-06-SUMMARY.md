---
plan: 02-06
phase: 02-formula-engine-migration
status: complete
wave: 3
---

# Plan 02-06 Summary

## What Was Done
- WR-01 fixed: toVscodeHover checks h.contents.kind before creating MarkdownString
- WR-02 fixed: toVscodeDiagnostic maps relatedInformation to vscode.DiagnosticRelatedInformation
- toVscodeCompletionItem added: LsCompletionItem -> vscode.CompletionItem with SnippetString insertText
- toVscodeSignatureHelp added: LsSignatureHelp -> vscode.SignatureHelp
- language-services/src/index.ts extended with formula engine re-export
- Build passes: formulaDiagnostics and FUNCTION_REGISTRY available from package public API

## Files Modified
- packages/extension/src/language/convert.ts
- packages/language-services/src/index.ts

## Verification
- WR-01 fixed: toVscodeHover plaintext/markdown branch checked at runtime
- WR-02 fixed: relatedInformation mapped to vscode.DiagnosticRelatedInformation
- toVscodeCompletionItem exported
- toVscodeSignatureHelp exported
- Build passes: @airtable-formula/language-services build 185ms (CJS + ESM + DTS)
- formulaDiagnostics callable from @airtable-formula/language-services (type: function)
- FUNCTION_REGISTRY exported from @airtable-formula/language-services (type: object)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
- packages/extension/src/language/convert.ts modified (53 lines added)
- packages/language-services/src/index.ts extended (1 line added)
- Commit 003e493: feat(02-06): fix WR-01/WR-02 in convert.ts, add new converters, extend LS index
