# Phase 4: Automation Engine - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Register the `airtable-automation` language ID for `.automation` and `.ata` files with JS syntax highlighting (TextMate grammar embedding `source.js`) and a language configuration. Build a new `language-services/engines/automation/` engine with an independent AUTOMATION_GLOBALS registry covering only confirmed automation-context globals (`base`, `table`, `fetch`, restricted `input`/`output`). Implement dot-triggered completions, hover documentation, and a wrong-context diagnostic (`automationDiagnostics`) that flags scripting-extension-only APIs. Create thin VS Code wrapper classes in `src/language/automation/` and extend `registration.ts`. Register a custom SVG file icon for `.automation`/`.ata` files.

</domain>

<decisions>
## Implementation Decisions

### Registry Architecture

- **D-01:** AUTOMATION_GLOBALS is a **fully independent registry** defined in `engines/automation/registry.ts`. No imports from `engines/script/`. The two engines are decoupled modules — automation can diverge freely as the Airtable API evolves without risk of inheriting scripting-only globals.
- **D-02:** **Conservative inclusion** — only methods explicitly confirmed for the automation context in official Airtable docs are included in AUTOMATION_GLOBALS. Methods that are uncertain or undocumented for automation are **omitted**. Better to show fewer completions than suggest APIs that fail at automation runtime.

### remoteFetchAsync and Wrong-Context Diagnostic

- **D-03:** `remoteFetchAsync` used in a `.automation` file → **Warning severity**. Diagnostic message: `"remoteFetchAsync is not available in Automation Scripts — use fetch() instead."` (matches REQUIREMENTS.md AUTO-04 intent and the non-blocking philosophy of SCRIPT-04/05).
- **D-04:** The public export is `automationDiagnostics(text: string, _uri?: string): LsDiagnostic[]` — same shape as `scriptDiagnostics`. Internally calls `checkWrongContext(text, exclusionRanges)`. No missing-await check and no unknown-global check (automation diagnostics are focused solely on wrong-context usage).

### Unknown-Global Check

- **D-05:** **No unknown-global check** in the automation engine. `automationDiagnostics()` only runs the wrong-context check. AUTO-04 is the entire stated scope. Adding an unknown-global check would be scope creep and risks false positives on automation patterns not yet observed.

### Global Surface and Forbidden-Pattern Detection

- **D-06:** Researcher fallback for uncertain methods: **omit**. If official Airtable automation docs do not explicitly confirm a method, the researcher excludes it from AUTOMATION_GLOBALS and notes it in RESEARCH.md. No "unconfirmed" hover caveats — users either see the completion or they don't.
- **D-07:** The wrong-context check flags **both top-level forbidden globals and forbidden method patterns** on `input`/`output`:
  - **Forbidden top-level globals**: `cursor`, `session`, `remoteFetchAsync`
  - **Forbidden method patterns**: `input.textAsync()`, `input.buttonsAsync()`, `output.text()`, `output.markdown()`, `output.table()` (and other interactive input/output methods)
  - Rationale: automation files have `input` and `output` globals (restricted), so just flagging the top-level name would miss `input.textAsync()` usage; method-pattern detection is required to catch the common mistake.

### Claude's Discretion

- Exact AUTOMATION_GLOBALS method set for `base` and `table` (researcher/planner assembles from docs — D-02 applies: conservative).
- Exact `input.config()` and `output.set()` signatures and descriptions (researcher reads docs).
- Exact forbidden method list for wrong-context scanner (researcher confirms which `input.*Async()` and `output.*` variants are scripting-only vs. automation-available).
- SVG placeholder icon content (same green-letter placeholder pattern as script engine).
- TextMate grammar and language configuration (identical to script engine pattern — `source.airtable-automation` scoping `source.js`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — AUTO-01 through AUTO-05: exact success criteria and acceptance criteria; prerequisite gate note on global surface verification
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, and prerequisite gate

### Prior Phase Context (carry-forward decisions)
- `.planning/phases/01-language-services-scaffold/01-CONTEXT.md` — D-06 to D-09: type shapes, enum numeric values, LsSeverity/LsCompletionItemKind parity
- `.planning/phases/02-formula-engine-migration/02-CONTEXT.md` — D-01 to D-14: wrapper structure, DiagnosticCollection lifecycle (D-03), pure function API shape (D-09)
- `.planning/phases/03-script-engine/03-CONTEXT.md` — D-01 to D-14: registry shape, engine layout, wrapper pattern, registration extension — AUTOMATION follows the same structure

### Existing Code to Model (read before planning)
- `packages/language-services/src/engines/script/registry.ts` — SCRIPT_GLOBALS structure to mirror (AUTOMATION_GLOBALS uses same ScriptGlobalInfo/ScriptMethodInfo interfaces)
- `packages/language-services/src/engines/script/diagnostics.ts` — `scriptDiagnostics` pattern; `checkMissingAwait` exclusion-range helpers to reuse for `automationDiagnostics`
- `packages/language-services/src/engines/script/completions.ts` — two-level completion pattern
- `packages/language-services/src/engines/script/hover.ts` — two-level hover pattern
- `packages/language-services/src/engines/script/index.ts` — barrel export pattern
- `packages/extension/src/language/script/script-diagnostics.ts` — wrapper class shape to replicate
- `packages/extension/src/language/script/script-completions.ts` — wrapper class shape to replicate
- `packages/extension/src/language/script/script-hover.ts` — wrapper class shape to replicate
- `packages/extension/src/language/registration.ts` — where to extend for automation providers

### Code to Update (not deleted, only modified)
- `packages/extension/src/language/registration.ts` — add automation provider registrations
- `packages/extension/package.json` — add `airtable-automation` language entry with extensions, grammar, language configuration, and icon
- `packages/language-services/src/index.ts` — add `export * from './engines/automation/index.js'`

### Language Configuration Assets
- `packages/extension/language-configuration/airtable-formula-language-configuration.json` — model for new `airtable-automation-language-configuration.json`
- `packages/extension/syntaxes/airtable-script.tmLanguage.json` — model for automation grammar (same pattern: embed `source.js`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/language-services/src/engines/script/registry.ts` — `ScriptGlobalInfo` and `ScriptMethodInfo` interfaces are directly reusable; AUTOMATION_GLOBALS uses the same types
- `packages/language-services/src/types.ts` — `LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover` already defined; no new types needed
- `packages/extension/src/language/convert.ts` — `toLsPosition`, `toVscodeDiagnostic`, `toVscodeCompletionItem`, `toVscodeHover` already implemented; automation wrappers use these directly
- `packages/language-services/src/engines/script/diagnostics.ts` — `positionToOffset`, `offsetToPosition`, `makeRange`, `getExclusionRanges`, `isInsideExclusionRange`, `findLineStart` helpers are directly copyable into `automationDiagnostics`

### Established Patterns
- **Nested subsystem subdirectory**: `src/language/script/` is the direct model; `src/language/automation/` follows exactly.
- **Pure function API**: stateless functions `automationDiagnostics(text, uri?)`, `automationCompletions(text, pos)`, `automationHover(text, pos)` — mirrors script engine shape.
- **DiagnosticCollection as instance field**: `AirtableAutomationDiagnosticsProvider` constructor creates its own collection (same as script/formula pattern).
- **Enum numeric parity**: `LsSeverity.Warning = 1` maps directly to `vscode.DiagnosticSeverity.Warning = 1` — direct cast.
- **Placeholder icons**: `packages/extension/icons/script-light.svg` and `script-dark.svg` are the model for automation icon files.

### Integration Points
- `packages/extension/src/language/registration.ts` line 92: extend `registerLanguageProviders` to initialize and register `AirtableAutomationDiagnosticsProvider`, `AirtableAutomationCompletionProvider`, `AirtableAutomationHoverProvider`
- `packages/extension/package.json` `contributes.languages[]`: add `{ id: 'airtable-automation', extensions: ['.automation', '.ata'], configuration: ..., icon: {...} }`
- `packages/extension/package.json` `contributes.grammars[]`: add `{ language: 'airtable-automation', scopeName: 'source.airtable-automation', path: './syntaxes/airtable-automation.tmLanguage.json' }`
- `packages/language-services/src/index.ts`: add `export * from './engines/automation/index.js'`

</code_context>

<specifics>
## Specific Ideas

- The wrong-context check for `input.*Async()` and `output.text/markdown/table` needs to detect method calls on known globals. Since `input` and `output` ARE available in automation (just restricted), the check must be at the method-name level (e.g., scan for `input\.textAsync\s*\(` pattern), not just the identifier level.
- `remoteFetchAsync` diagnostic message should explain the alternative clearly: "remoteFetchAsync is not available in Automation Scripts — use fetch() instead."
- For `cursor` and `session`: message should be "cursor is only available in Airtable Scripting Extension, not Automation Scripts."
- The AUTOMATION_GLOBALS `input` entry should document only `input.config()` — it has a different description from the scripting `input` (which supports interactive methods). Same for `output` — automation's `output.set()` is a different API from scripting's `output.text()`.
- The researcher should note explicitly which `base.*` and `table.*` methods are confirmed for automation (e.g., is `base.createTableAsync` available in automation? Conservative policy means omit if uncertain).

</specifics>

<deferred>
## Deferred Ideas

- **Unknown-global check for automation** — not in scope. AUTO-04 is the only stated diagnostic requirement. If desired, can be added in a future phase.
- **Signature help for automation methods** — AUTO-ADV-01 in v2 requirements.
- **`input.config()` field-type string-literal completions** — SCRIPT-ADV-02 / v2 requirements. Phase 4 only surfaces `input.config()` as a completion; the field-type object structure inside `config()` is deferred.
- **Cross-context paste hint** — SCRIPT-ADV-04 in v2 requirements.
- **Automation runtime limit analysis** — explicitly out of scope per REQUIREMENTS.md.

</deferred>

---

*Phase: 4-Automation Engine*
*Context gathered: 2026-05-13*
