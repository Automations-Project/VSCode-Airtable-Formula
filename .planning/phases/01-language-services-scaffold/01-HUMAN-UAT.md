---
status: partial
phase: 01-language-services-scaffold
source: [01-VERIFICATION.md]
started: 2026-05-12T21:40:00.000Z
updated: 2026-05-12T21:40:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Formula completions appear
expected: Type a partial function name (e.g. `IF`) in a `.formula` file — completion popup appears with matching Airtable formula functions
result: [pending]

### 2. Hover documentation appears
expected: Hover over a known function name (e.g. `IF`) in a `.formula` file — tooltip shows function documentation
result: [pending]

### 3. Diagnostics fire on unknown functions
expected: Type `BOGUS()` in a `.formula` file — a diagnostic error appears in the Problems panel identifying the unknown function
result: [pending]

### 4. Signature help appears on open paren
expected: Type `IF(` in a `.formula` file — signature help panel shows the IF function's parameter signature
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
