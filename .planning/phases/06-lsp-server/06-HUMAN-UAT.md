---
status: partial
phase: 06-lsp-server
source: [06-VERIFICATION.md]
started: 2026-05-14T23:45:00.000Z
updated: 2026-05-14T23:45:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Publish `airtable-user-lsp` to npm and verify `npx` works

expected: Trigger GitHub Actions "Release" workflow with `target=lsp-server`, `bump=patch`, `dry_run=false`. After it completes: `npm view airtable-user-lsp version` returns `1.0.0`; `npx airtable-user-lsp --stdio` starts a working LSP server that responds to LSP initialize requests.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
