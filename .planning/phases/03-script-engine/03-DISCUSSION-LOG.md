# Phase 3: Script Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 03-script-engine
**Areas discussed:** Scripting global surface, Unknown-global diagnostic depth, `fetch` completion scope

---

## Scripting Global Surface

### Q1: Research ground-truth source

| Option | Description | Selected |
|--------|-------------|----------|
| Official Airtable scripting docs | Primary source — reads official documentation verbatim, highest accuracy | ✓ |
| Airtable TypeScript types package | Use `@airtable/blocks-scripting-types` or similar — fast but may not cover scripting extension globals | |
| Existing extension data as baseline | Start from existing hover/completion data, fill gaps — risk of carrying forward existing errors | |

**User's choice:** Official Airtable scripting docs

---

### Q2: Registry data structure shape

| Option | Description | Selected |
|--------|-------------|----------|
| Nested object registry | `{ base: { description, methods: { getTables: {...} } }, table: {...} }` — matches caller usage for first-level and dot-triggered completions | ✓ |
| Flat method map | `{ 'base.getTables': {...} }` — simpler iteration but loses parent-object structure for first-level completions | |
| TypeScript interface + runtime mirror | Most type-safe, most boilerplate | |

**User's choice:** Nested object registry

---

### Q3: cursor confidence handling

| Option | Description | Selected |
|--------|-------------|----------|
| Include with a confidence note | Document what official docs say verbatim; exclude if not found (better missing than wrong) | ✓ |
| Include both properties regardless | Flag for post-ship verification with `(verify)` tag in docs | |
| Skip cursor in Phase 3 | Leave cursor out entirely until verified | |

**User's choice:** Include with a confidence note — researcher notes confidence level in RESEARCH.md

---

## Unknown-Global Diagnostic Depth

### Q1: Analysis approach for SCRIPT-05

| Option | Description | Selected |
|--------|-------------|----------|
| Token-level scan with local symbol table | Walk text, collect const/let/var/function/class declarations, check usages — same complexity as Phase 2 formula diagnostics | ✓ |
| Statement-start only (conservative) | Only flag at very start of statement — very few false positives but misses mid-expression unknowns | |
| Skip SCRIPT-05, only SCRIPT-04 | Implement missing-await only, defer unknown-global detection | |

**User's choice:** Token-level scan with local symbol table

---

### Q2: JS built-in allowlist

| Option | Description | Selected |
|--------|-------------|----------|
| Use REQUIREMENTS.md list as-is | The 12 built-ins specified (console, Math, JSON, Date, Promise, Array, Object, Error, parseInt, parseFloat, setTimeout, clearTimeout) | |
| Extend it | Add Number, String, Boolean, RegExp, Map, Set, Symbol, etc. | |
| You decide the full list | Researcher/Claude compiles the complete set for real Airtable scripts | ✓ |

**User's choice:** Claude decides the full list

---

### Q3: Diagnostic severity

| Option | Description | Selected |
|--------|-------------|----------|
| Warning | Yellow underline — not blocking, consistent with SCRIPT-04 | ✓ |
| Error | Red underline — stronger but higher false-positive pain | |
| Hint | Barely visible — too weak | |

**User's choice:** Warning

---

## `fetch` Completion Scope

### Q1: `fetch` completions depth

| Option | Description | Selected |
|--------|-------------|----------|
| Call signature only | `fetch(url, init?)` + hover docs — VS Code built-in JS server covers Response chain | ✓ |
| Full Web Fetch API completions | `.json()`, `.text()`, `.ok`, `.status`, `.headers` etc. — duplicates built-in coverage | |
| Omit fetch, complete only remoteFetchAsync | Skip standard `fetch` entirely | |

**User's choice:** Call signature only

---

### Q2: `remoteFetchAsync` completions depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full method completions + hover docs | Airtable-specific global — full completion + docs explaining cross-origin use case | ✓ |
| Hover docs only, no completion | Don't surface in completions list | |
| Same as fetch — call signature only | Consistent but under-serves the Airtable-specific use case | |

**User's choice:** Full method completions + hover docs

**Notes:** User clarified: no special diagnostics for `fetch` vs. `remoteFetchAsync` in v1. `fetch` has normal JS signature help; `remoteFetchAsync` has full Airtable-specific completions + docs.

---

## Claude's Discretion

- Complete JS built-in allowlist for SCRIPT-05 (researcher/planner assembles, Claude picks final list)
- Exact token scanner implementation (regex patterns, destructuring/catch clause edge cases, callback param detection)
- Exact diagnostic message wording for SCRIPT-04 and SCRIPT-05
- Whether `ScriptGlobalInfo` and `ScriptMethodInfo` are separate exported types or inlined

## Deferred Ideas

- Diagnostic for `fetch` vs. `remoteFetchAsync` usage — deferred to v2
- Signature help for script methods (SCRIPT-ADV-01) — v2
- `input.config()` field-type completions (SCRIPT-ADV-02) — v2
- Quick-fix: insert `await` for missing-await (SCRIPT-ADV-03) — v2
