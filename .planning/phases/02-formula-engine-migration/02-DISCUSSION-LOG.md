# Phase 2: Formula Engine Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 2-Formula Engine Migration
**Areas discussed:** VS Code wrapper structure, Feature gap scope, Icon SVG assets, Engine API shape, Engine file structure, Test location & coverage

---

## VS Code Wrapper Structure

### Where should the thin VS Code adapter classes live?

| Option | Description | Selected |
|--------|-------------|----------|
| `src/language/formula/` (Recommended) | New subdirectory with formula-diagnostics.ts, formula-completions.ts, etc. Mirrors mcp/, auto-config/ pattern | ✓ |
| Inline in `registration.ts` | All VS Code provider logic as anonymous inline objects in registration.ts | |

**User's choice:** `src/language/formula/`

### Class structure or plain functions within the wrapper files?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep class structure (Recommended) | Same class names (AirtableFormulaDiagnosticsProvider, etc.), gutted methods call language-services | ✓ |
| Plain exported functions | No classes — exported functions that registration.ts calls directly | |

**User's choice:** Keep class structure

### DiagnosticCollection location

| Option | Description | Selected |
|--------|-------------|----------|
| Inside wrapper class (Recommended) | Stays as a field in AirtableFormulaDiagnosticsProvider constructor | ✓ |
| Module-level singleton | Created once at module level | |
| You decide | Planner/executor picks | |

**User's choice:** Inside wrapper class

### codeActions.ts fate

| Option | Description | Selected |
|--------|-------------|----------|
| Stay in extension/src/ (Recommended) | Not in "files to delete" list — stays at current location, only import path updates | ✓ |
| Move to src/language/formula/ | Move alongside formula wrappers for consistency | |

**User's choice:** Stay in `extension/src/`

---

## Feature Gap Scope

### How thorough should FORMULA-03 be?

| Option | Description | Selected |
|--------|-------------|----------|
| Research-backed (Recommended) | Researcher compares against Airtable official docs — definitive missing functions + incorrect diagnostics list | ✓ |
| Quick unification only | Fix obvious internal inconsistencies only, no external research | |
| You decide | Researcher and planner determine what's "known" | |

**User's choice:** Research-backed

### Specific diagnostic gaps

| Option | Description | Selected |
|--------|-------------|----------|
| Let researcher find them | No specific known issues — researcher reviews and identifies | ✓ |
| I have specific gaps | User provides specific list | |

**User's choice:** Let researcher find them

### Registry consolidation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single FUNCTION_REGISTRY (Recommended) | All 3 duplicate lists collapse into one; completions derive snippets from signature | ✓ |
| Registry + completions metadata | Separate completion-only data alongside registry | |

**User's choice:** Single FUNCTION_REGISTRY

---

## Icon SVG Assets

### SVG files ready?

| Option | Description | Selected |
|--------|-------------|----------|
| Use placeholder SVGs | Planner creates minimal geometric placeholders | |
| I'll provide SVGs | User provides actual SVG files | ✓ |

**User's choice:** User will provide SVGs

### Where will SVGs be placed?

| Option | Description | Selected |
|--------|-------------|----------|
| icons/ directory (Recommended) | packages/extension/icons/formula-light.svg, formula-dark.svg | ✓ |
| Custom path / names | Specified when files are provided | |

**User's choice:** `icons/` directory

### Asset dependency handling

| Option | Description | Selected |
|--------|-------------|----------|
| Wire registration + placeholder SVGs (Recommended) | Create placeholder SVGs + wire package.json; user swaps content later | ✓ |
| Wire registration only, no asset | Set up package.json pointing to paths, but don't create SVG files | |

**User's choice:** Wire registration with placeholder SVGs

---

## Engine API Shape

### Public API style

| Option | Description | Selected |
|--------|-------------|----------|
| Pure functions (Recommended) | formulaDiagnostics(text), formulaCompletions(text, pos), etc. — stateless | ✓ |
| FormulaEngine class | Class with methods, mirrors existing VS Code provider classes | |

**User's choice:** Pure functions

### FUNCTION_REGISTRY visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Exported from language-services (Recommended) | FUNCTION_REGISTRY and FunctionInfo are public API; codeActions.ts imports from there | ✓ |
| Internal to engine | Only helper functions are public; direct registry access via helpers | |

**User's choice:** Exported from language-services

### LsSignatureHelp type

| Option | Description | Selected |
|--------|-------------|----------|
| Add LsSignatureHelp to LS types (Recommended) | Consistent — all 4 providers use LS types; added to types.ts in Phase 2 | ✓ |
| Signature help stays VS Code-only | Wraps VS Code types directly, not routed through LS types | |

**User's choice:** Add LsSignatureHelp to LS types

---

## Engine File Structure

### Internal organization

| Option | Description | Selected |
|--------|-------------|----------|
| Split by concern (Recommended) | registry.ts, diagnostics.ts, completions.ts, hover.ts, signature.ts + index.ts | ✓ |
| Single engine file | All logic in engines/formula/index.ts | |

**User's choice:** Split by concern

---

## Test Location & Coverage

### Where do tests live?

| Option | Description | Selected |
|--------|-------------|----------|
| language-services package (Recommended) | packages/language-services/src/test/formula/ — pure TS, vitest | ✓ |
| Extension package only | Stays in extension test suite with VS Code mock overhead | |

**User's choice:** language-services package

### Minimum coverage expectation

| Option | Description | Selected |
|--------|-------------|----------|
| Behavior-driven (Recommended) | One test per notable behavior — diagnostics, completions, hover, signature | ✓ |
| Comprehensive | High coverage, all edge cases | |
| Smoke tests only | Just verify functions return without error | |

**User's choice:** Behavior-driven

---

## Claude's Discretion

- Internal character-offset-to-position conversion helper (inline or extracted utility)
- Exact diagnostic message wording for newly added diagnostic checks
- Whether `LsParameterInformation` is a separate exported type or inlined inside `LsSignatureHelp`

## Deferred Ideas

None — discussion stayed within phase scope.
