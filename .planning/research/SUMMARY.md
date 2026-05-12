# Research Summary: Language Platform Milestone

**Project:** VSCode-Airtable-Formula — Language Platform Milestone
**Domain:** Multi-engine VS Code language extension (formula + scripting + automation)
**Researched:** 2026-05-12
**Confidence:** HIGH overall; MEDIUM on automation globals (Airtable docs JS-rendered, non-accessible during research)

---

## Executive Summary

This milestone transforms the existing single-engine formula editor into a 3-engine language platform by extracting a new `packages/language-services` workspace package, then building Airtable Scripting Extension (`.script`) and Automation Script (`.automation`) support on top of it.

The formula engine migration is primarily a structural extraction, not a rewrite — the existing approach is correct and sufficient. However, `completions.ts` maintains its own private function list that has drifted from `functions.ts`; fixing this divergence is part of the migration. For the new JS engines, no npm package provides Airtable-specific type definitions — they must be hand-rolled from the official API reference.

The single highest-risk item is the ESM/CJS boundary: `language-services` must use dual `cjs,esm` tsup output (not ESM-only like `shared`) and be bundled inline by the extension. The language ID strategy (custom `airtable-script` / `airtable-automation` rather than aliasing to `javascript`) is non-negotiable: using `javascript` triggers the built-in TypeScript language server, producing spurious Node.js completions.

---

## Stack Additions

Zero new npm runtime dependencies.

- **`packages/language-services` (new workspace package):** Pure TypeScript, `tsup --format cjs,esm --dts`, mirrors `packages/shared` structure but with dual output.
- **`contributes.languages[].icon`** (VS Code 1.64+): file type icons per language ID. Correct over `contributes.iconThemes`.
- **Hand-rolled `.d.ts` files in `language-services/src/types/`:** `airtable-scripting-api.d.ts` (shared types), `airtable-script-globals.d.ts`, `airtable-automation-globals.d.ts`. No DefinitelyTyped package covers this domain.
- **TextMate grammar files (2 new, minimal):** 3-line files that `include: source.js` — JS syntax highlighting without duplicating the full JS grammar.
- **Language configuration JSON files (2 new):** JS-style comment toggling, bracket pairs, code folding for `.script` and `.automation` files.

**Build pipeline insertion:**
```
check-tool-sync → shared → language-services → webview → bundle-mcp → extension
```

---

## Feature Table Stakes

### Formula engine (must-not-regress after migration)
- All existing diagnostics, completions, hover, signature help behave identically
- Unified `FUNCTION_REGISTRY` drives all formula providers — private duplicate in `completions.ts` deleted
- Vitest suite covering each validator method

### Script engine `.script` — must-have
- Global completions on `.` trigger for: `base`, `table`, `cursor`, `input`, `output`, `session`, `fetch`, `remoteFetchAsync`
- Hover docs for every global and method
- Missing-`await` diagnostic for `*Async` calls without `await`
- Unknown-global warning when identifier is not in the scripting globals list
- JS syntax highlighting + file icon

### Automation engine `.automation` — must-have
- Same structure as script engine, automation-scoped globals only
- `input.` shows only `input.config()` — not interactive methods
- `output.` shows only `output.set()`
- Diagnostic flagging `cursor`, `session`, `remoteFetchAsync`, and all interactive `input.*` as invalid
- File icon

### Defer to later milestone
- Signature help for script/automation engines
- `input.config()` field-type string-literal completions
- Automation timeout/loop static analysis
- Go-to-definition for field/table names (requires live MCP integration)

---

## Architecture Decisions

Single `packages/language-services` package with internal `engines/formula/`, `engines/script/`, `engines/automation/` subdirectories and shared `util/` layer.

**Component boundaries:**

| Component | Owns | VS Code dep |
|-----------|------|-------------|
| `language-services/types.ts` | `LsDiagnostic`, `LsRange`, `LsPosition`, `LsCompletionItem`, `LsHover` | None |
| `language-services/util/` | parser-context, levenshtein, position offset math | None |
| `language-services/engines/formula/` | registry, validator, completions, hover, signature | None |
| `language-services/engines/script/` | globals, validator, completions, hover | None |
| `language-services/engines/automation/` | globals (extends shared base), validator, completions, hover | None |
| `extension/src/language/convert.ts` | `toVscodeDiagnostic()`, position converters | Yes |
| `extension/src/language/*-providers.ts` (3 files) | Thin VS Code adapter per engine | Yes |
| `extension/src/language/registration.ts` | Single `registerLanguageProviders(context)` | Yes |

**Files deleted from extension after migration:** `diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `functions.ts`

**Globals shared-base pattern:** `shared-script-globals.ts` defines common subset. `script/globals.ts` extends with scripting-only additions. `automation/globals.ts` extends with automation additions and marks scripting-only globals as forbidden.

---

## Critical Pitfalls (Top 5)

1. **ESM/CJS runtime crash** — `language-services` built ESM-only; extension host requires CJS. Prevention: tsup dual `cjs,esm` output; bundle inline in extension's tsup config.

2. **`vscode` leaking into `language-services`** — collapses the framework-agnostic architecture; tests require VS Code host. Prevention: add `vscode` to `language-services` tsup externals.

3. **Single shared `DiagnosticCollection`** — clearing one engine wipes another engine's diagnostics. Prevention: one named collection per engine (`airtable-formula`, `airtable-script`, `airtable-automation`).

4. **Using `languageId: 'javascript'` for `.script`/`.automation`** — triggers built-in TS server, produces spurious Node.js completions. Prevention: custom language IDs always; TextMate grammar embeds `source.js` by `include` reference only.

5. **Duplicating globals metadata across script and automation engines** — drift when Airtable updates an API. Prevention: `shared-script-globals.ts` base + per-engine extends pattern.

---

## Recommended Phase Order

| Phase | Name | Rationale |
|-------|------|-----------|
| 1 | Language Services Scaffold | Load-bearing — ESM/CJS boundary and `vscode`-free constraint resolved here first |
| 2 | Formula Engine Migration | Lowest-risk extraction — proves architecture before net-new work; fixes registry divergence |
| 3 | Script Engine (`.script`) | Script before automation; automation is ~50% of the work as a result |
| 4 | File Icons (all 3 languages) | Self-contained, lowest-risk, visual polish for all engines |
| 5 | Automation Engine (`.automation`) | Composes from script engine's shared-base globals; no duplication |

---

## Research Flags (verify during plan-phase)

- **Phase 3:** `cursor.selectedRecordIds` / `cursor.selectedFieldIds` — LOW confidence. Verify against `https://airtable.com/developers/scripting/api`.
- **Phase 5:** `input.config()` field type enum + exact `base.*` methods blocked in automation — MEDIUM confidence. Verify before implementing automation completions.
- **Phase 1:** Validate dual `cjs,esm` build actually resolves correctly in extension host before Phase 2.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against live codebase + VS Code official docs |
| Features (script) | HIGH | Multiple official announcements + community sources |
| Features (automation) | MEDIUM | Airtable docs non-rendering; reconstructed from community |
| Architecture | HIGH | Direct codebase inspection of all 5 provider files |
| Pitfalls | HIGH | Sourced from official VS Code docs, merged PRs, confirmed GitHub issues |
