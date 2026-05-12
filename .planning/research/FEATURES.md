# Feature Landscape — Language Platform Milestone

**Domain:** Multi-engine VS Code language extension (formula + scripting + automation)
**Researched:** 2026-05-12
**Confidence:** HIGH for VS Code provider patterns (official docs), HIGH for scripting globals (community sources + official API pages), MEDIUM for automation globals (documentation pages render-blocked, reconstructed from community discussions)

---

## Context: What Already Exists

The extension already ships working formula language features as inline VS Code providers. This milestone adds two new engines and refactors the formula engine into a shared `language-services` package. The feature work divides into three tracks:

1. **Shared infrastructure** — new `language-services` package that all engines build on
2. **Formula engine migration** — refactor existing providers, fix gaps, no user-visible regression
3. **Script + Automation engines** — net-new language features for `.script` and `.automation` files

---

## Track 1: Shared language-services Package

### Table Stakes

Features that must exist for the package to be useful at all.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Framework-agnostic LS types (`LsDiagnostic`, `LsRange`, `LsPosition`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp`) | All 3 engines need to return typed results without importing `vscode` | Low | Pure TS interfaces — no logic |
| `parser-context.ts` utility — exclusion range detection (strings, comments, field refs) | Every engine needs to know "am I inside a string right now?" to avoid false-positive diagnostics | Medium | Extracted from existing `diagnostics.ts`; already proven correct |
| `levenshtein.ts` utility — edit distance for typo suggestions | Formula engine uses it today; script/automation engines can reuse for "did you mean?" | Low | Already implemented — pure extraction |
| `position.ts` utility — offset ↔ line/character conversion | All engines work on raw strings; VS Code adapter needs to convert | Low | Math utility; no dependencies |
| ESM build via tsup, `package.json` pointing at `dist/index.js` | Extension imports with `workspace:*` dep; same pattern as `shared` package | Low | tsup config is one copy of the `shared` package config |
| Vitest test setup | Language logic must be testable without VS Code host | Low | Mirror `webview` vitest config; no jsdom needed |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `FormulaEngine` / `ScriptEngine` / `AutomationEngine` facade classes | Callers invoke one object rather than wiring modules manually | Low | Thin composition layers; no logic of their own |
| Barrel export from `index.ts` | Extension and tests import from one place | Low | DX only |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Exporting VS Code types from language-services | Breaks portability, makes unit testing require VS Code host | Framework-agnostic `LsX` types only; conversion in extension adapter layer |
| Separate package per engine | Unnecessary build complexity; PROJECT.md explicitly chose single package | Single `language-services` with internal `engines/` subdirectories |
| Full JS/TS parser dependency (e.g., `@typescript-eslint/typescript-estree`) | Overkill for the stated scope; adds 20+ MB to bundle | Regex + string-scanning approach proven sufficient for global-name lookup |

---

## Track 2: Formula Engine Migration

### Table Stakes

Must-have to ship this milestone. Any regression here is a release blocker.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| All existing formula diagnostics pass through language-services unchanged | Users already depend on them; a refactor must be invisible | Medium | 10 check methods extracted from `diagnostics.ts`; tests required for each |
| All existing formula completions pass through language-services unchanged | Completions use a private FUNCTION_SIGNATURES table in `completions.ts` inconsistent with `functions.ts` — consolidation required | Medium | This is the only user-visible change: completions now driven by the single `FUNCTION_REGISTRY` |
| All existing hover and signature help pass through language-services unchanged | Users expect these to work on `.formula` files | Low | `hover.ts` and `signature.ts` already import from `functions.ts`; extraction is straightforward |
| Thin VS Code adapter wrappers — `formula-providers.ts` with zero business logic | Architecture requirement; makes the engine independently testable | Low | Conversion functions in `convert.ts` |
| Single `FUNCTION_REGISTRY` as authoritative data source | `completions.ts` has its own private copy that has drifted from `functions.ts` | Low | Delete private copy; point completion logic at the registry |

### Formula Feature Gaps (fix during migration)

These are gaps that should be resolved during the migration — they're discovered by inspecting the existing files.

| Gap | Impact | Complexity |
|-----|--------|-----------|
| `completions.ts` FUNCTION_SIGNATURES has different coverage than `functions.ts` FUNCTION_REGISTRY (e.g., `AUTONUMBER`, `CREATED_BY`, `LAST_MODIFIED_BY` present in completions but not diagnostics; `ODD`, `EVEN` present in diagnostics but not completions) | Inconsistent behavior: user can autocomplete a function that diagnostics flags as unknown, or vice versa | Low — one pass consolidation once both are in `language-services` |
| `diagnostics.ts` AIRTABLE_FUNCTIONS record list is missing functions present in `functions.ts` | Unknown-function false positives for valid functions | Low — same consolidation pass |
| `record` category in diagnostics only has `RECORD_ID`, `CREATED_TIME`, `LAST_MODIFIED_TIME` — missing `AUTONUMBER`, `CREATED_BY`, `LAST_MODIFIED_BY` | False "unknown function" errors | Low |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Formula engine unit tests (vitest, no VS Code) | Catch regressions in pure logic without extension host | Medium | Write tests for each `check*` method; establishes testing pattern for script/automation engines |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Changing formula behavior during refactor | Any behavioral change during a refactor makes regression testing impossible | Pure structural extraction first; fix bugs in a separate commit after tests are green |
| Rewriting the formula parser from scratch | Not in scope; existing string-scanning approach works for the stated use cases | Migrate what exists; improve incrementally |

---

## Track 3: Scripting Extension Engine (`.script` files)

### Airtable Scripting Extension Global API

The following globals are confirmed available in the Scripting Extension context. This is the authoritative list for `script/globals.ts`.

**Top-level globals (injected into script scope):**

| Global | Type | Key Methods/Properties | Context Notes |
|--------|------|----------------------|---------------|
| `base` | `Base` | `.name`, `.id`, `.tables[]`, `.getTable(name)`, `.createTableAsync(name, fields)` | Always available |
| `table` | `Table` | `.name`, `.id`, `.fields[]`, `.views[]`, `.getField(name)`, `.getView(name)`, `.selectRecordsAsync({fields, sorts})`, `.selectRecordAsync(id)`, `.createRecordsAsync(records[])`, `.updateRecordAsync(id, fields)`, `.updateRecordsAsync(records[])`, `.deleteRecordsAsync(ids[])`, `.createFieldAsync(name, type, opts)` | Always available — refers to the first table or the active table |
| `cursor` | `Cursor` | `.activeTableId`, `.activeViewId`, `.selectedRecordIds[]`, `.selectedFieldIds[]` | Scripting Extension ONLY — not in Automation |
| `session` | `Session` | `.currentUser.id`, `.currentUser.name`, `.currentUser.email` | Scripting Extension ONLY — not in Automation |
| `input` | `Input` | `.textAsync(label)`, `.tableAsync(label)`, `.viewAsync(label, opts)`, `.fieldAsync(label, opts)`, `.recordAsync(label, table)`, `.recordsAsync(label, table)`, `.buttonsAsync(label, options[])`, `.fileAsync(label)` | Scripting Extension ONLY — interactive input methods |
| `output` | `Output` | `.text(value)`, `.markdown(string)`, `.table(records, fields?)` | Scripting Extension ONLY |
| `fetch` | Function | Standard Web Fetch API — but may hit CORS in browser context | Available; prefer `remoteFetchAsync` for external APIs to avoid CORS |
| `remoteFetchAsync` | Function | Same signature as `fetch` but proxied through Airtable's servers — bypasses CORS | Scripting Extension ONLY — use when `fetch` causes CORS errors |

**Record methods (returned from `selectRecordsAsync`):**

- `record.id` — record ID string
- `record.name` — primary field value
- `record.getCellValue(fieldNameOrId)` — raw cell value
- `record.getCellValueAsString(fieldNameOrId)` — human-readable string

**Runtime constraints (relevant to diagnostics):**

- No `require()` or `import` — no module system
- No DOM access
- No external npm packages
- Async/await available and required for all `*Async` methods
- Batch limit: 50 records per `createRecordsAsync` / `updateRecordsAsync` / `deleteRecordsAsync` call
- No execution time limit (runs locally in user's browser)

### Table Stakes — Script Engine

Features a `.script` file user would consider missing if absent.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Global completions for `base`, `table`, `cursor`, `input`, `output`, `session`, `fetch`, `remoteFetchAsync` | Users open a `.script` file and expect `base.` to show methods | Medium | Member-access completions triggered on `.` — requires detecting `base.` prefix in text before cursor |
| Hover docs for every global and method | User hovers `selectRecordsAsync` and expects to see what it does | Medium | `globals.ts` data drives hover; same pattern as formula `FUNCTION_REGISTRY` |
| Diagnostics: unknown global warning | User types `basee.getTable()` — should warn about unrecognized global | Low | Regex scan for identifier followed by `(` or `.` that is not in globals list; same exclusion range approach as formula |
| `await` reminder for `*Async` methods | User writes `base.getTable('T').selectRecordsAsync({})` without `await` — Airtable will return a Promise silently | Medium | Pattern-match `identifer.nameAsync(` without preceding `await` keyword in same expression |
| Language ID `airtable-script` registered in `package.json` `contributes.languages` with `.script` extension | VS Code must associate file with the engine | Low | One `contributes.languages` entry + `contributes.grammars` entry for JS-based highlighting |
| File icon for `.script` files | Visual distinction in file explorer | Low | User provides SVG; registered via `icon: { light, dark }` in the `contributes.languages` entry |
| Syntax highlighting (JavaScript grammar reuse) | JS syntax highlighting is better than nothing; `.script` files are valid JS | Low | Point `contributes.grammars` at the built-in `source.js` scope name — no new grammar file needed |

### Differentiators — Script Engine

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Signature help for globals (e.g., `selectRecordsAsync({ fields, sorts })` param hints) | Reduces lookups to Airtable docs | High | Requires parameter parsing; same approach as formula signature help but for JS method calls |
| "Missing await" quick fix code action | One-click fix for the most common Airtable scripting mistake | Medium | Pairs with the `await` reminder diagnostic |
| `cursor` / `session` / `input` / `output` available-only-in-scripting-extension warnings | User pastes automation script into scripting extension context — wrong globals flagged | Low | Diagnostic: flag use of automation-only globals in `.script` files |

### Anti-Features — Script Engine

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full TypeScript type-checking for `.script` files | PROJECT.md explicitly out-of-scope; overlaps with VS Code's built-in TS language server; major complexity | Custom `airtable-script` language ID keeps the extension's providers isolated; don't override tsserver |
| Go-to-definition for field names or table names | Requires live Airtable API integration — not editor-only | Out of scope for this milestone |
| Script execution / REPL integration | PROJECT.md explicitly out-of-scope | Editor support only |
| Importing `@typescript-eslint/parser` or `acorn` as a dependency | Massive bundle size increase for marginal gain; regex approach handles the stated scope | Regex + string-scanning, same as formula engine |

---

## Track 4: Automation Script Engine (`.automation` files)

### Airtable Automation Script Global API

The automation script context is a subset of the scripting extension, running server-side on Airtable's infrastructure. Confirmed differences:

**Available in Automation — same as Scripting Extension:**
- `base` — full base access; same methods
- `table` — same record CRUD methods
- Standard `fetch()` — no CORS issues (server-side execution)

**Available in Automation — DIFFERENT from Scripting Extension:**
- `input.config(fields)` — returns declared input variables from the automation trigger/step configuration. NOT the interactive `input.textAsync()` etc. — this is a synchronous config object, not a prompt
- `output.set(name, value)` — passes output variables to subsequent automation steps; max 6 MB total

**NOT available in Automation (scripting extension only):**
- `cursor` — no UI context in automation
- `session.currentUser` — no interactive user in automation
- `input.textAsync()`, `input.tableAsync()`, `input.viewAsync()`, `input.fieldAsync()`, `input.recordAsync()`, `input.recordsAsync()`, `input.buttonsAsync()`, `input.fileAsync()` — all interactive input methods absent
- `output.text()`, `output.markdown()`, `output.table()` — display output methods absent
- `remoteFetchAsync()` — not needed; automation runs server-side where CORS is not an issue

**Automation runtime limits (relevant to diagnostics):**
- 30-second execution timeout
- 512 MB memory limit
- Max 50 `fetch()` requests per run
- Max 30 `selectRecordsAsync` queries per run
- Batching still applies: 50 records per CRUD call

**Schema-modifying methods NOT available in Automation:**
- `base.createTableAsync()` — scripting extension only
- `table.createFieldAsync()` — scripting extension only
- `field.updateOptionsAsync()` — scripting extension only

### Table Stakes — Automation Engine

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Global completions for `base`, `table`, `input`, `output`, `fetch` (automation-scoped) | Same expectation as script engine but for the automation context | Medium | `input.config()` must be listed (not `input.textAsync()` etc.) |
| Hover docs for automation globals — especially `input.config()` and `output.set()` explaining the data-passing pattern | Automation input/output is not intuitive for users coming from scripting extension | Medium | `input.config()` takes `{fields: [{type, key, label}]}` and returns `{[key]: value}` |
| Diagnostics: flag scripting-extension-only globals in `.automation` files | User pastes a scripting extension script into an automation — `cursor.activeTableId` is flagged as invalid | Medium | Check against an "automation-forbidden" globals list: `cursor`, `session`, `remoteFetchAsync`, `input.textAsync`, `input.tableAsync`, etc. |
| `await` reminder for `*Async` methods | Same issue as script engine | Medium | Same pattern |
| Language ID `airtable-automation` with `.automation` extension | VS Code must associate file with the engine | Low | Same as script engine setup |
| File icon for `.automation` files | Visual distinction | Low | User provides SVG |
| Syntax highlighting (JavaScript grammar reuse) | Same as script engine | Low | Reuse `source.js` scope name |

### Differentiators — Automation Engine

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `input.config()` field-type completions | When user writes `input.config({fields: [{type: '` — show valid field types (text, number, date, etc.) | High | Requires context-aware string-literal completions; needs to detect we are inside `input.config` field type argument |
| Automation timeout limit warning for loops | User writes an unbounded `while` loop or does N×M record fetches — warn that automation will hit 30-second limit | High | Static analysis of loop structure; risky for false positives; defer to later milestone |
| Cross-context paste detection | Detect when a `.automation` file has scripting-extension-only globals and show a migration hint | Medium | Pairs with "flag invalid globals" diagnostic |

### Anti-Features — Automation Engine

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Replicating all automation diagnostics from the scripting engine | Most logic is shared; creating a fully separate validator doubles maintenance | `automation/validator.ts` extends/composes from `script/validator.ts` with an "allowed globals" override parameter |
| Attempting to resolve actual Airtable table/field names from the live base | Requires MCP API calls during editing — extreme latency, wrong architecture | Name resolution is out of scope for static analysis |

---

## Track 5: File Type Icons

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Icon for `.formula` files | Already has custom language ID; icon makes it visually distinct | Low | `contributes.languages[airtable-formula].icon` in `package.json`; user provides SVGs |
| Icon for `.script` files | New engine gets a new icon | Low | Same approach — `contributes.languages[airtable-script].icon` |
| Icon for `.automation` files | New engine gets a new icon | Low | Same approach — `contributes.languages[airtable-automation].icon` |

### Icon Registration Pattern

VS Code supports per-language default icons since VS Code 1.79+ (PR #118846). The schema:

```json
{
  "contributes": {
    "languages": [
      {
        "id": "airtable-formula",
        "extensions": [".formula", ".min.formula", ".ultra-min.formula"],
        "icon": {
          "light": "./icons/formula-light.svg",
          "dark": "./icons/formula-dark.svg"
        }
      }
    ]
  }
}
```

The `icon` fallback applies only when the active file icon theme does not have an explicit icon for the language. All major themes (Material Icon Theme, VSCode Icons, Catppuccin) will show the fallback for unknown extension types, so this covers the majority of users.

**Limitation (MEDIUM confidence):** One icon per `contributes.languages` entry. `.formula`, `.min.formula`, and `.ultra-min.formula` share a language ID so they automatically share the icon — this is the correct behavior.

### Anti-Features — Icons

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Publishing a full icon theme (`contributes.iconThemes`) | Overrides ALL file icons for users who install it — hostile to users who prefer Material Icon Theme | Use `contributes.languages[].icon` fallback only |
| Animated or complex SVGs | Render poorly at 16×16; VS Code icon display at small sizes needs clean simple shapes | Simple single-color SVGs with light/dark variants |

---

## Feature Dependencies

```
language-services package (Track 1)
  → Formula engine migration (Track 2) — cannot start until Track 1 types exist
  → Script engine (Track 3) — cannot start until Track 1 utilities exist
  → Automation engine (Track 4) — cannot start until Track 3 globals pattern is established

Track 3 (Script) → Track 4 (Automation)
  — Automation globals.ts is a subset of script globals.ts
  — Automation validator.ts reuses script validator with a different allowed-globals list
  — Build Track 3 first; Track 4 is ~50% less work because of the shared foundation

File icons (Track 5)
  — Independent of all engine tracks
  — Blocked only on SVG asset availability (user-provided)
  — Can be done in any order; lowest risk
```

---

## MVP Recommendation

Build in this order:

1. **Track 1 — language-services scaffold** (types, utils, build config, vitest setup). No logic yet — just the skeleton. This is the foundation everything else depends on.

2. **Track 2 — Formula engine migration**. Move existing logic into the new package. Write vitest tests. Fix the function-list divergence bug. Extension behavior should be identical before and after — measure by running existing tests.

3. **Track 3 — Script engine**. Globals registry for scripting extension context. Completions on `.`. Hover. Missing-await diagnostic. Language registration.

4. **Track 5 — File icons**. Lowest risk, fast to ship, gives all 3 engines visual identity. Do this after language IDs are registered (Track 3 adds `airtable-script`).

5. **Track 4 — Automation engine**. Subset of Track 3. Add forbidden-global diagnostics. `input.config()` / `output.set()` hover docs.

**Defer to a later milestone:**
- Signature help for script/automation engines — very high complexity, limited MVP value vs. hover docs
- `input.config()` field-type string-literal completions — requires deep context parsing
- Automation timeout/loop static analysis — high false-positive risk, needs careful design

---

## What "Done" Looks Like Per Engine

### Formula Engine (done when)
- All existing `.formula` file behaviors work identically after refactor
- `language-services` vitest suite green with coverage of each validator check
- `completions.ts` and `diagnostics.ts` in extension/src are deleted; no vscode import in language-services
- Function list is unified: no functions in completions that are unknown to diagnostics

### Script Engine (done when)
- `.script` files show JS syntax highlighting
- Typing `base.` shows completion list with all `Base` methods and properties
- Hovering `selectRecordsAsync` shows method signature and description
- Writing `table.selectRecordsAsync({})` without `await` shows a diagnostic
- Using `cursor.activeTableId` in a `.script` file shows no error (it is valid there)
- File icon appears in VS Code explorer for `.script` files

### Automation Engine (done when)
- `.automation` files show JS syntax highlighting
- Typing `input.` shows `input.config()` only (not `input.textAsync()`)
- Typing `output.` shows `output.set()` only
- Using `cursor.activeTableId` in a `.automation` file shows an error diagnostic
- File icon appears in VS Code explorer for `.automation` files

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| VS Code provider patterns (Track 1/2/3/4 implementation) | HIGH | Official VS Code docs verified; existing codebase uses all relevant APIs |
| VS Code file icon registration schema | HIGH | Official contribution points docs; PR #118846 confirmed support |
| Scripting Extension globals (cursor, session, input, output, fetch, remoteFetchAsync) | HIGH | Multiple community sources + official announcement posts corroborate; specific method names like `input.textAsync()`, `output.markdown()` confirmed in release notes |
| Automation Script globals (input.config, output.set, forbidden globals list) | MEDIUM | Official support docs + community discussions confirm the pattern, but airtable.com/developers docs pages were non-rendering (JS-only content); exact `input.config()` schema inferred from multiple secondhand descriptions |
| `base.createTableAsync`, `table.createFieldAsync` scripting-extension-only status | MEDIUM | Community announcement confirmed "only in scripting app, not automation" — plausible, worth verifying against live Airtable |
| Automation runtime limits (30s, 50 fetch, 30 select queries) | MEDIUM | Kuovonne's guide (well-regarded community expert) matches search results from multiple threads |
| `cursor.selectedRecordIds` / `cursor.selectedFieldIds` existence | LOW | Mentioned in one community thread; official cursor API page non-rendering; treat as likely but verify |

---

## Sources

- [Airtable Scripting Overview](https://support.airtable.com/docs/scripting-extension-overview)
- [Airtable Run a Script Action](https://support.airtable.com/docs/run-a-script-action)
- [Airtable Scripting API Reference](https://airtable.com/developers/scripting/api)
- [Scripting Block API Changes — input methods, breaking changes](https://community.airtable.com/development-apis-11/scripting-block-updates-breaking-api-changes-new-input-methods-easier-debugging-6857)
- [Launched: cursor.activeTableId/activeViewId in scripting block](https://community.airtable.com/announcements-6/launched-get-the-active-table-view-in-the-scripting-block-1409)
- [remoteFetchAsync announcement](https://community.airtable.com/t5/announcements/new-remote-fetch-in-scripting-app/ba-p/120162)
- [Kuovonne's Guide: Converting scripting extension to automation](https://coda.io/@kuovonne/kuovonnes-guided-to-scripting-in-airtable/converting-a-script-to-run-as-an-automation-9)
- [Kuovonne's Guide: Automation script limits](https://coda.io/@kuovonne/kuovonnes-guided-to-scripting-in-airtable/automation-script-limits-54)
- [Scripting Extension limitations community thread](https://community.airtable.com/development-apis-11/limitations-of-scripting-extension-3573)
- [Create tables and fields from scripting app](https://community.airtable.com/development-apis-11/new-create-tables-create-fields-and-update-field-options-from-the-scripting-app-7220)
- [VS Code Programmatic Language Features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
- [VS Code Contribution Points — contributes.languages icon schema](https://code.visualstudio.com/api/references/contribution-points)
- [VS Code PR #118846 — language icon support](https://github.com/microsoft/vscode/pull/118846)
- Direct codebase inspection: `packages/extension/src/{diagnostics,completions,hover,signature,functions}.ts`
