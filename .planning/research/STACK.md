# Technology Stack — Language Platform Milestone

**Project:** VSCode-Airtable-Formula / Language Platform milestone
**Researched:** 2026-05-12
**Scope:** Stack additions for (a) `packages/language-services` workspace package, (b) JS-engine Airtable-specific typings, (c) file-type icon registration

---

## 1. Shared `language-services` Package

### Decision: Pure TypeScript, zero new runtime dependencies

The `language-services` package is a pure TS library that exposes framework-agnostic functions (parse, validate, getCompletions, getHover, getSignatureHelp) consumed by `packages/extension`. It has no dependency on the `vscode` module — that is correct and intentional per the milestone constraint.

**No new runtime deps are needed.** The existing formula provider logic in `packages/extension/src/{diagnostics,completions,hover,signature,functions}.ts` plus the function registry (`functions.ts`) already does all parsing inline via regex/string walking. That logic moves to `language-services` unchanged, as pure TS.

### Package scaffold

| Item | Value | Rationale |
|------|-------|-----------|
| Package name | `@airtable-formula/language-services` | Consistent with existing `@airtable-formula/shared` naming |
| `type` in package.json | `"module"` | ESM-primary; dual output provides CJS entrypoint for direct-require paths |
| Build tool | `tsup` (already in workspace) | Zero new tooling; mirrors how `shared` is built |
| Output format | **Dual CJS+ESM** (`--format cjs,esm`) | Although tsup bundles the dep inline at extension build time, dual output is required: ESM for future consumers and to match the import map, CJS for any direct-require paths and d.ts compatibility. ESM-only risks `ERR_REQUIRE_ESM` if the dep is ever resolved at runtime rather than bundled (e.g. tests, tooling). See PITFALLS.md Pitfall #1. |
| `declaration: true` (`--dts`) | Yes | Extension imports types directly; `.d.ts` must exist |
| TypeScript version | Same as workspace (`^5.4.0`) | No upgrade needed |

**tsup build command for package.json:**
```
tsup src/index.ts --format cjs,esm --dts --out-dir dist
```

**Root build script change needed:** Add `pnpm -F language-services build` between `pnpm -F shared build` and `pnpm -F webview build` in the root `package.json` build script, and similarly in the test script.

### pnpm-workspace.yaml

No change needed — `packages/*` glob already covers a new `packages/language-services/` directory.

### Extension dependency

Add to `packages/extension/package.json` `dependencies`:
```json
"@airtable-formula/language-services": "workspace:*"
```

The extension's tsup build already externalises `vscode`; `language-services` has no vscode dependency so it bundles cleanly into `dist/extension.js`.

### tsconfig for language-services

Mirror `packages/shared/tsconfig.json` closely:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`NodeNext` is correct for an ESM package with explicit `.js` extensions in imports.

---

## 2. JS-Based Language Engines (Scripting Extension + Automation Script)

### Language registration in extension

Two new language IDs with `contributes.languages` entries in `packages/extension/package.json`:

| Language ID | Extensions | Purpose |
|-------------|-----------|---------|
| `airtable-script` | `.script` | Scripting Extension (interactive, has `cursor`, `remoteFetchAsync`) |
| `airtable-automation` | `.automation` | Automation Script (headless, `input.config`, `output.set`, no `cursor`) |

Each needs: `id`, `aliases`, `extensions`, `configuration` (language config JSON), `icon` (light/dark SVG paths).

Grammar (TextMate) for both: **reuse the built-in `source.js` scope** — do not write a custom JS grammar. Map it via `grammars[].language` + `"scopeName": "source.js"` with `"injectTo": ["source.js"]` not needed since these are standalone language IDs. Simpler: set `grammars[].language = "airtable-script"` and `"scopeName": "source.js"` — this gives JS syntax highlighting for free.

Alternative confirmed approach (HIGH confidence): declare `"embeddedLanguages": { "source.js": "javascript" }` or simply set the grammar path to the bundled JS grammar. The cleanest approach is to declare no custom grammar and add `"configuration"` only — VS Code will fall back to the nearest language for highlighting, but this does NOT give JS highlighting. You must explicitly declare the grammar. See the pattern used by many extensions that reuse JS grammars:

```json
{
  "language": "airtable-script",
  "scopeName": "source.js",
  "path": "./syntaxes/airtable-script.tmLanguage.json"
}
```

...where `airtable-script.tmLanguage.json` is a minimal 3-line file that just includes `source.js`:
```json
{
  "scopeName": "source.js",
  "patterns": [{ "include": "source.js" }]
}
```

This is the correct pattern (MEDIUM confidence — confirmed by several VS Code extension examples in the wild, not from official docs).

### Airtable-specific type definitions — hand-rolled `.d.ts`

**Verdict: Hand-roll `.d.ts` files inside `packages/language-services/src/types/`. No npm package exists.**

Research findings:

- `@types/airtable` (DefinitelyTyped) — covers the **REST API client** (`Airtable.Base`, `Airtable.Table`, `Airtable.Record`), NOT the scripting extension globals. Wrong package.
- `airtable-ts`, `airtable-typegen`, `airtable-ts-codegen` — all target the REST Web API. Not applicable.
- No npm package providing type declarations for the in-browser scripting globals (`base`, `output`, `input`, `cursor`, `remoteFetchAsync`) was found after searching npm, GitHub, and community forums. The Airtable scripting IDE bundles its own undocumented typings internally.
- Community practice confirmed by the Airtable forum: developers hand-roll `global.d.ts` files from the official API reference at `https://airtable.com/developers/scripting/api`.

**Scripting Extension globals to type (`airtable-script`):**

| Global | Type summary |
|--------|-------------|
| `base` | `Base` — `.getTables()`, `.getTable(nameOrId)`, `.name`, `.id` |
| `cursor` | `Cursor` — `.activeTableId`, `.activeViewId`, `.selectedRecordIds`, `.selectedFieldIds` |
| `input` | `Input` — `.textAsync(label)`, `.buttonsAsync(label, options)`, `.tableAsync(label)`, `.viewAsync(label)`, `.fieldAsync(label)`, `.recordAsync(label, table)`, `.fileAsync(label)`, `.config()` |
| `output` | `Output` — `.text(msg)`, `.table(data)`, `.markdown(md)`, `.inspect(value)`, `.clear()` |
| `remoteFetchAsync(url, init?)` | Same signature as `fetch` but proxied through Airtable servers |

**Automation Script globals (`airtable-automation`) — different surface:**

| Global | Type summary |
|--------|-------------|
| `input` | `AutomationInput` — `.config()` returns typed variable map; `base`, `cursor`, `remoteFetchAsync` NOT available |
| `output` | `AutomationOutput` — `.set(name, value)` to pass values downstream |

The two engines diverge specifically on: (1) `cursor` not available in automation, (2) `remoteFetchAsync` available in scripting only, (3) `output.set()` is automation-specific, (4) `input.config()` has different semantics per context, (5) `base` not directly available in automation actions (accessed via `input.config` variable bindings).

**Where to put the `.d.ts` files:**

```
packages/language-services/src/types/
  airtable-script-globals.d.ts    # scripting extension globals
  airtable-automation-globals.d.ts  # automation script globals
  airtable-scripting-api.d.ts       # shared types (Base, Table, Field, Record, View, etc.)
```

These are consumed by the `language-services` package itself for metadata (completions, hover docs) — they are NOT ambient declarations injected into user files (that would require a full TS language server, which is out of scope per PROJECT.md).

The completions and hover providers for the JS engines will use the metadata in these files as structured data (name, description, return type, parameters) rather than actual TypeScript ambient injection.

### TypeScript language service for JS files — NOT needed

The milestone explicitly excludes "full TypeScript type checking for script files." Therefore:
- Do NOT add `typescript` (the `tsc` compiler API) as a runtime dependency to `language-services`
- Do NOT spawn a TS language server process
- Do NOT use `@vscode/vscode-languageserver-node` (`vscode-languageserver-protocol`, `vscode-languageserver-textdocument`) — these are for separate LSP processes, also explicitly out of scope

The JS engine providers in `language-services` implement the same pattern as the formula engine: text scanning + metadata registry lookup, no real parser needed for the Airtable-specific completions layer.

---

## 3. File Type Icon Registration

### Verdict: `contributes.languages[].icon` — use this, NOT `contributes.iconThemes`

**Comparison:**

| Approach | When to Use | Behavior |
|----------|-------------|---------|
| `contributes.languages[].icon` | Single extension adding icons for its own language IDs | Icon is a language default; file icon themes override it. Simple, no extra files beyond SVG. |
| `contributes.iconThemes` | Building a general-purpose icon theme for many file types | Requires a full theme manifest JSON; overrides other themes; complex |

For this extension — which owns the three language IDs and just wants a sensible icon when no other icon theme covers `.formula`/`.script`/`.automation` — `contributes.languages[].icon` is the correct and minimal choice. (HIGH confidence — confirmed via VS Code docs, PR #118846, and VS Code 1.64 release notes.)

### API details

Finalized in VS Code **1.64** (January 2022). The extension currently targets `"vscode": "^1.100.0"` — no compatibility concern whatsoever.

Supported formats: SVG, PNG, GIF (SVG confirmed in PR #118846 discussion and VS Code icon theme guide). SVG is recommended (scales without aliasing, smaller file size).

Schema:
```json
{
  "id": "airtable-formula",
  "icon": {
    "light": "./images/icons/formula-light.svg",
    "dark": "./images/icons/formula-dark.svg"
  }
}
```

### Where to place SVG assets

```
packages/extension/images/icons/
  formula-light.svg
  formula-dark.svg
  script-light.svg
  script-dark.svg
  automation-light.svg
  automation-dark.svg
```

These are already inside the extension package directory so `vsce package` picks them up automatically. No build step needed — static assets.

The paths in `package.json` `contributes.languages[].icon` are relative to the extension root (where `package.json` lives), so `"./images/icons/formula-light.svg"` is correct.

### Behavior note

The icon appears in the file explorer and tab bar when:
- The user's active icon theme has NO icon for that file extension/language, OR
- The theme's `showLanguageModeIcons: true` is set

Popular icon themes (Material Icon Theme, Fluent Icons, vscode-icons) will define their own icons for `.formula` / `.script` / `.automation` if they ever add them, and those override the language default. This is expected and acceptable — the language icon is a fallback.

---

## 4. Build Pipeline Changes Summary

| Change | Where | What |
|--------|-------|------|
| Add `pnpm -F language-services build` | Root `package.json` `build` and `test` scripts | Insert after `shared` build, before `webview` build |
| Add workspace dep | `packages/extension/package.json` `dependencies` | `"@airtable-formula/language-services": "workspace:*"` |
| New `packages/language-services/package.json` | New file | tsup build, ESM output, `@airtable-formula/language-services` name |
| New `packages/language-services/tsconfig.json` | New file | Mirror `packages/shared/tsconfig.json` |
| Static SVG assets | `packages/extension/images/icons/` | No build step — static |
| Language config JSONs | `packages/extension/language-configuration/` | Two new files for `airtable-script` and `airtable-automation` |
| Grammar JSON files | `packages/extension/syntaxes/` | Two minimal JSON files that include `source.js` |

---

## 5. What NOT to Add

| Temptation | Why to avoid |
|------------|-------------|
| `vscode-languageserver-node` / `vscode-languageserver-textdocument` | These are for a separate LSP process. In-process architecture is decided. No JSON-RPC, no child process. |
| `typescript` compiler API as a runtime dep | Full TS type checking of script files is out of scope. |
| `@types/airtable` (DefinitelyTyped) | Covers REST API client, not scripting extension globals. Wrong package, will create confusion. |
| `contributes.iconThemes` | Overkill. Only needed if building a standalone icon theme extension. |
| Custom JS grammar (new `.tmLanguage.json` from scratch) | Reusing `source.js` via include is correct and avoids duplicating the entire JS grammar. |
| `monaco-editor` or `@codemirror/*` | The webview dashboard does not need a code editor. |
| Separate `packages/scripting-types` npm package | Types belong in `language-services`; no reason to split. |

---

## 6. Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| `contributes.languages[].icon` API + SVG support | HIGH | VS Code 1.64 release notes (official), PR #118846 (official GitHub) |
| Icon finalized in VS Code 1.64, extension targets ^1.100.0 | HIGH | Official docs + package.json read directly |
| No npm package for scripting extension globals | HIGH | Exhaustive npm/GitHub search; community forum confirms hand-rolled approach |
| Scripting vs automation global surface differences | MEDIUM | Airtable developer docs + community posts; exact type shapes need validation against live docs before implementation |
| tsup ESM-only for `language-services` works with extension CJS build | HIGH | Same pattern already working for `@airtable-formula/shared` in this repo |
| Minimal JS grammar that includes `source.js` | MEDIUM | Community pattern observed in multiple extensions; not explicitly in VS Code official docs |

---

## Sources

- [VS Code Contribution Points — contributes.languages](https://code.visualstudio.com/api/references/contribution-points#contributes.languages)
- [VS Code January 2022 (1.64) Release Notes — Language icon](https://code.visualstudio.com/updates/v1_64)
- [Finalize icon property of language contribution point — GitHub Issue #140047](https://github.com/microsoft/vscode/issues/140047)
- [Adding default fileicon support to language contributions — PR #118846](https://github.com/microsoft/vscode/pull/118846)
- [Airtable Scripting API Reference](https://airtable.com/developers/scripting/api)
- [Airtable Community — Scripting TypeScript support in IDE](https://community.airtable.com/development-apis-11/airtable-scripting-typescript-support-in-ide-4521)
- [Airtable Community — Using remoteFetchAsync in scripting](https://community.airtable.com/development-apis-11/using-remotefetchasync-in-a-button-s-script-4088)
- [tsup documentation](https://tsup.egoist.dev/)
