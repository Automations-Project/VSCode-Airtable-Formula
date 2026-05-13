---
phase: 03
slug: script-engine
type: code-review
depth: standard
status: complete
created: 2026-05-13
files_reviewed:
  - packages/language-services/src/engines/script/diagnostics.ts
  - packages/language-services/src/engines/script/completions.ts
  - packages/language-services/src/engines/script/hover.ts
  - packages/language-services/src/engines/script/registry.ts
  - packages/language-services/src/engines/script/index.ts
---

# Phase 03 — Code Review

> Standard review of all 5 script engine files. 5 findings total: 2 Critical, 3 Important.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Important | 3 |
| Info | 0 |

All findings are in the pure `language-services` package (no vscode imports). The regex patterns are otherwise linear and threat model T-03-01 is satisfied. No security issues found.

---

## Findings

### C-1 — `.then()` suppression scans unbounded to EOF

**File:** `packages/language-services/src/engines/script/diagnostics.ts:189`
**Severity:** Critical
**Category:** Logic error / false negative

**Code:**
```typescript
/\)\s*\.then\s*\(/.test(text.slice(match.index));
```

`text.slice(match.index)` produces a substring from the match position to the **end of the file**. If any `.then(` exists later in the file in a completely different statement, the check returns true and suppresses the diagnostic incorrectly.

**Fix:** Scope the check to the current line/statement boundary — e.g., test `text.slice(match.index, text.indexOf('\n', match.index) + 1 || text.length)` or scan for `)` followed by `.then(` within a fixed token window after the call's closing paren.

---

### C-2 — `Promise.` combinator pattern missing from accepted list

**File:** `packages/language-services/src/engines/script/diagnostics.ts:181–189`
**Severity:** Critical
**Category:** Missing feature (documented in RESEARCH.md Pattern 4)

RESEARCH.md Pattern 4 documents `Promise.all([...xAsync()])` / `Promise.allSettled` / etc. as accepted patterns. The `isAccepted` check has no `Promise.` guard. This causes false positives on valid code like:

```typescript
const results = await Promise.all([table.selectRecordsAsync(), base.getTableAsync('x')]);
```

Here `table.selectRecordsAsync()` and `base.getTableAsync('x')` will be flagged because neither the local statement context (inside the array literal) nor the `.then()` scan matches `await`/`return`/`const`.

**Fix:** Add `/\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(/.test(text.slice(stmtStart))` to the `isAccepted` OR-chain (search from `stmtStart` for the `Promise.` context).

---

### I-1 — Property members get `($0)` snippet insertText

**File:** `packages/language-services/src/engines/script/completions.ts:50–53`
**Severity:** Important
**Category:** UX / correctness

All method completions use `insertText: \`${name}($0)\`` regardless of kind. The registry has both methods (callable) and properties (non-callable) — e.g., `cursor.selectedRecordIds`, `table.name`, `base.name`. Inserting `selectedRecordIds($0)` produces invalid JS.

**Fix:** Check whether the registry entry has a `signature` that includes `()` or inspect the method kind before adding the snippet. Properties should use `insertText: name` with `CompletionItemKind.Property`.

---

### I-2 — Destructured bindings not collected in `buildLocalSymbols`

**File:** `packages/language-services/src/engines/script/diagnostics.ts:223–226`
**Severity:** Important
**Category:** False positive

The comment on line 222 explicitly notes: `// const/let/var x (best-effort simple name only -- destructuring not detected)`. This means:

```typescript
const { id, name } = record;
console.log(id); // flags 'id' as unknown-global
```

Destructured bindings are a first-class Airtable scripting pattern (e.g., `const { id, primaryFieldValue } = record`). False positives here will be highly visible to users.

**Fix:** Add an additional regex pass for object destructuring:
```typescript
const destructureRegex = /\b(?:const|let|var)\s*\{([^}]+)\}/g;
```
then split on `,` and extract identifiers (strip defaults, renames). Not required to be exhaustive — a best-effort pass is a significant improvement.

---

### I-3 — Method hover missing `range` field

**File:** `packages/language-services/src/engines/script/hover.ts:98–104`
**Severity:** Important
**Category:** Inconsistency

The method-level hover return (Level 2) omits the `range` field:
```typescript
return {
    contents: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
};
```

Global hover (Level 1) correctly includes `range`. Missing `range` means VS Code cannot underline the hovered token, reducing hover UX quality. The method absolute start/end positions are already computed in the surrounding code (`methodAbsStart`, `methodAbsEnd`).

**Fix:** Compute the range from `methodAbsStart`/`methodAbsEnd` using `offsetToPosition` and include it in the return:
```typescript
return {
    contents: { ... },
    range: {
        start: offsetToPosition(text, methodAbsStart),
        end: offsetToPosition(text, methodAbsEnd),
    },
};
```

---

## Disposition

| ID | Severity | Fix Now? | Notes |
|----|----------|----------|-------|
| C-1 | Critical | Recommended | Scoping bug — real false negatives in multi-statement files |
| C-2 | Critical | Recommended | Documented in RESEARCH.md; missing guard causes false positives in `Promise.all` patterns |
| I-1 | Important | Recommended | Produces invalid JS insertions for property-type members |
| I-2 | Important | Recommended | Common Airtable scripting pattern; false positives reduce trust |
| I-3 | Important | Optional | Cosmetic hover UX; low user impact |

All 5 fixes are isolated to 2 files (`diagnostics.ts` and `completions.ts` / `hover.ts`). No architectural changes needed. The test suite (85 tests, all GREEN) should be extended with cases covering C-1, C-2, and I-2 scenarios.
