# Phase 3: Script Engine - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Register the `airtable-script` language ID for `.script` and `.ats` files with JS syntax highlighting (TextMate grammar embedding `source.js`) and a language configuration. Build a new `language-services/engines/script/` engine with a nested global registry documenting all Scripting Extension globals (`base`, `table`, `cursor`, `input`, `output`, `session`, `fetch`, `remoteFetchAsync`) and their methods. Implement dot-triggered completions, hover documentation, a missing-`await` diagnostic (SCRIPT-04), and an unknown-global diagnostic using a token-level scanner with a local symbol table (SCRIPT-05). Create thin VS Code wrapper classes in `src/language/script/` and extend `registration.ts`. Register a custom SVG file icon for `.script`/`.ats` files.

</domain>

<decisions>
## Implementation Decisions

### Scripting Global Surface

- **D-01:** Official Airtable scripting docs are the researcher's primary source for the global API surface. The researcher reads the official documentation verbatim — not the existing extension data, which may carry forward errors.
- **D-02:** The global registry uses a **nested object structure** in `language-services/engines/script/registry.ts`:
  ```typescript
  export const SCRIPT_GLOBALS: Record<string, ScriptGlobalInfo> = {
    base: { description: '...', methods: { getTables: { signature, description }, ... } },
    table: { description: '...', methods: { selectRecordsAsync: {...}, ... } },
    cursor: { ... },
    // etc.
  };
  ```
  This shape matches how callers use it: first-level completions (typing `b` to get `base`) and second-level completions after a `.` (typing `base.` to get method list).
- **D-03:** `cursor` is included if and only if it appears in the official docs. If `cursor.selectedRecordIds` and `cursor.selectedFieldIds` are confirmed, they are included. If the docs are ambiguous or silent, these properties are excluded from Phase 3 (do not guess). The researcher notes confidence level explicitly in the RESEARCH.md.

### Unknown-Global Diagnostic (SCRIPT-05)

- **D-04:** The unknown-global diagnostic uses a **token-level scan with a local symbol table**. The engine walks the text, collecting declarations from `const`, `let`, `var`, `function`, `class`, and `for...of` patterns into a local symbol set. Usages of bare identifiers followed by `.` or `()` are checked against: (Airtable globals ∪ JS built-in allowlist ∪ local symbol table). This approach matches the complexity level of Phase 2's formula diagnostics.
- **D-05:** The JS built-in allowlist is **Claude's discretion** — the researcher/planner assembles the complete set of JS globals that realistically appear in Airtable scripts. The REQUIREMENTS.md list (console, Math, JSON, Date, Promise, Array, Object, Error, parseInt, parseFloat, setTimeout, clearTimeout) is the minimum; extend it with Number, String, Boolean, RegExp, Map, Set, Symbol, undefined, NaN, Infinity, isNaN, isFinite, encodeURIComponent, decodeURIComponent, and any others that would produce false positives in real Airtable scripts.
- **D-06:** SCRIPT-05 produces **Warning** severity (yellow underline). Consistent with SCRIPT-04. Not blocking — users writing exploratory scripts are not halted.

### `fetch` and `remoteFetchAsync` Completions

- **D-07:** `fetch` receives **call-signature completions and hover docs only** — just `fetch(url, init?)`. No Response chain method completions (`.json()`, `.text()`, `.ok`, etc.). VS Code's built-in JS language server already provides those. The Airtable engine stays focused on Airtable-specific APIs.
- **D-08:** `remoteFetchAsync` receives **full completions + hover docs** — it is an Airtable-specific global not covered by the built-in JS server. Completions surface `remoteFetchAsync(url, init?)` with Airtable-specific documentation explaining its cross-origin use case.
- **D-09:** **No diagnostic for using `fetch` vs. `remoteFetchAsync`** in Phase 3. No warning is raised when a user calls `fetch` instead of `remoteFetchAsync`. This distinction is deferred to v2 if desired.

### Engine and Wrapper Structure

- **D-10:** The script engine follows the exact same structure as the formula engine:
  ```
  language-services/engines/script/
    index.ts          ← re-exports all public API
    registry.ts       ← SCRIPT_GLOBALS nested registry + ScriptGlobalInfo type + helpers
    diagnostics.ts    ← scriptDiagnostics(text, uri?)
    completions.ts    ← scriptCompletions(text, pos)
    hover.ts          ← scriptHover(text, pos)
  ```
  No `signature.ts` — signature help is v2 (SCRIPT-ADV-01).
- **D-11:** Thin VS Code wrapper classes live in `packages/extension/src/language/script/` following the same D-02/D-03 formula wrapper pattern: `script-diagnostics.ts`, `script-completions.ts`, `script-hover.ts`. Class names: `AirtableScriptDiagnosticsProvider`, `AirtableScriptCompletionProvider`, `AirtableScriptHoverProvider`.
- **D-12:** `registerLanguageProviders()` in `registration.ts` is extended to register all three script providers alongside the existing formula providers. Both `airtable-script` and `airtable-formula` are handled in the same function.

### Language ID and Icons

- **D-13:** The `airtable-script` language ID is registered for `.script` and `.ats` extensions. TextMate grammar embeds `source.js` (per SCRIPT-01: "grammar that includes `source.js`"). Language configuration enables comment toggling (`//`, `/* */`), bracket pairs, and code folding — same shape as the existing formula language configuration.
- **D-14:** Placeholder SVG icons are created at `packages/extension/icons/script-light.svg` and `packages/extension/icons/script-dark.svg` by the executor (same as Phase 2 D-07 formula pattern). User swaps SVG content when ready.

### Claude's Discretion

- Complete JS built-in allowlist for SCRIPT-05 (D-05 — researcher/planner assembles this, Claude picks final list).
- Exact token scanner implementation details (regex patterns, edge cases for destructuring/catch clauses, callback parameter detection).
- Exact diagnostic message wording for SCRIPT-04 and SCRIPT-05.
- Whether `ScriptGlobalInfo` and `ScriptMethodInfo` are separate exported types or inlined.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — SCRIPT-01 through SCRIPT-06: exact success criteria and acceptance criteria
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria, and dependency constraints

### Prior Phase Context (carry-forward decisions)
- `.planning/phases/01-language-services-scaffold/01-CONTEXT.md` — D-06 to D-09: type shapes, enum numeric values, LsSeverity/LsCompletionItemKind parity
- `.planning/phases/02-formula-engine-migration/02-CONTEXT.md` — D-01 to D-14: wrapper structure, subsystem pattern, DiagnosticCollection lifecycle (D-03), pure function API shape (D-09)

### Existing Code to Model (read before planning)
- `packages/language-services/src/engines/formula/registry.ts` — FUNCTION_REGISTRY structure to mirror (nested → method-level)
- `packages/language-services/src/engines/formula/diagnostics.ts` — formula diagnostics implementation; same text-scanning approach applies to SCRIPT-04/05
- `packages/language-services/src/engines/formula/completions.ts` — completion derivation pattern
- `packages/language-services/src/engines/formula/hover.ts` — hover implementation pattern
- `packages/language-services/src/engines/formula/index.ts` — barrel export pattern
- `packages/extension/src/language/formula/formula-diagnostics.ts` — wrapper class shape to replicate
- `packages/extension/src/language/formula/formula-completions.ts` — wrapper class shape to replicate
- `packages/extension/src/language/formula/formula-hover.ts` — wrapper class shape to replicate
- `packages/extension/src/language/registration.ts` — where to extend for script providers

### Code to Update (not deleted, only modified)
- `packages/extension/src/language/registration.ts` — add script provider registrations
- `packages/extension/package.json` — add `airtable-script` language entry with extensions, grammar, language configuration, and icon
- `packages/language-services/src/index.ts` — add `export * from './engines/script/index.js'`

### Language Configuration Assets
- `packages/extension/language-configuration/airtable-formula-language-configuration.json` — model for new `airtable-script-language-configuration.json`
- `packages/extension/syntaxes/airtable-formula.tmLanguage.json` — model for new grammar file (but script grammar embeds `source.js` instead of defining its own rules)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/language-services/src/types.ts` — `LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp` already defined; no new types needed for Phase 3
- `packages/extension/src/language/convert.ts` — `toLsPosition`, `toVscodeDiagnostic`, `toVscodeCompletionItem`, `toVscodeHover` already implemented; script wrappers use these directly
- `packages/language-services/src/test/formula/` — test structure to mirror for `src/test/script/`

### Established Patterns
- **Nested subsystem subdirectory**: `src/language/formula/` sets the pattern; `src/language/script/` follows exactly.
- **Pure function API**: stateless functions `scriptDiagnostics(text, uri?)`, `scriptCompletions(text, pos)`, `scriptHover(text, pos)` — mirrors formula engine shape.
- **DiagnosticCollection as instance field** (D-03 from Phase 2): `AirtableScriptDiagnosticsProvider` constructor creates its own collection, not module-level.
- **Enum numeric parity** (D-09 from Phase 1): `LsSeverity.Warning = 1` maps directly to `vscode.DiagnosticSeverity.Warning = 1` — direct cast, no lookup.
- **Placeholder icons**: `packages/extension/icons/formula-light.svg` and `formula-dark.svg` are the model for script icon files.

### Integration Points
- `packages/extension/src/language/registration.ts` line 57: extend `registerLanguageProviders` to initialize and register `AirtableScriptDiagnosticsProvider`, `AirtableScriptCompletionProvider`, `AirtableScriptHoverProvider`
- `packages/extension/package.json` `contributes.languages[]`: add `{ id: 'airtable-script', extensions: ['.script', '.ats'], configuration: ..., icon: {...} }`
- `packages/extension/package.json` `contributes.grammars[]`: add `{ language: 'airtable-script', scopeName: 'source.airtable-script', path: './syntaxes/airtable-script.tmLanguage.json' }`
- `packages/language-services/src/index.ts`: add `export * from './engines/script/index.js'`

</code_context>

<specifics>
## Specific Ideas

- The TextMate grammar for `airtable-script` should be a minimal JSON grammar that sets `scopeName: source.airtable-script` and includes `source.js` via `{ include: 'source.js' }`. This is the simplest correct way to get JS highlighting without reimplementing a grammar.
- The nested SCRIPT_GLOBALS registry needs to support two completion scenarios: (1) top-level — user types nothing or `b` → suggest `base`, `table`, etc.; (2) method-level — user types `base.` → suggest `getTables`, `getTable`, `createTableAsync`, etc.
- For SCRIPT-04 (missing-await): the pattern to detect is a call expression `identifier.xAsync(...)` or `xAsync(...)` at the end of a statement where no `await` precedes it on the same logical expression. Accepted patterns NOT to flag: `return expr.xAsync()`, `expr.xAsync().then(...)`, `Promise.all([expr.xAsync()])`, `const p = expr.xAsync()` (assignment to a non-awaited variable).
- `remoteFetchAsync` hover documentation should explain it as the Airtable-provided cross-origin fetch — note that standard `fetch` is also available but subject to CORS; `remoteFetchAsync` bypasses CORS restrictions in the Airtable runtime.
- The researcher should verify whether `input` and `output` in the Scripting Extension have the same shape as in Automation (they do NOT — Scripting has `input.textAsync()`, `output.text()`, etc. while Automation has only `input.config()` and `output.set()`).

</specifics>

<deferred>
## Deferred Ideas

- **Diagnostic: `fetch` vs. `remoteFetchAsync`** — No warning for using standard `fetch` instead of `remoteFetchAsync` in Phase 3. Deferred to v2 if desired.
- **Signature help for script methods** — SCRIPT-ADV-01 in v2 requirements. Not in Phase 3.
- **`input.config()` field-type completions** — SCRIPT-ADV-02 in v2 requirements.
- **Quick-fix: insert `await`** — SCRIPT-ADV-03 in v2 requirements.

</deferred>

---

*Phase: 3-Script Engine*
*Context gathered: 2026-05-13*
