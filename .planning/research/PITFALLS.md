# Domain Pitfalls: Language Platform Milestone

**Domain:** Adding a 3-engine language platform to an existing VS Code extension
**Researched:** 2026-05-12
**Scope:** Formula engine refactor + Scripting Extension + Automation Script + icon registration

---

## Critical Pitfalls

Mistakes that cause broken builds, invisible features, or rewrites.

---

### Pitfall 1: ESM Package Exported to CJS Extension Host

**What goes wrong:** The new `language-services` package is built as ESM (`"type": "module"`, tsup ESM output) because that matches `packages/shared`. The extension host is CJS (tsup → CJS, `"main": "./dist/extension.js"`). At runtime, `require('@airtable-formula/language-services')` from the extension bundle throws `ERR_REQUIRE_ESM`.

**Why it happens:** The existing `shared` package is ESM-only — the extension avoids importing it directly (the code comment in `extension.ts` line 21 explicitly notes: *"Inlined to avoid pulling shared/ESM types into the CJS extension DTS build"*). A new `language-services` package will face the identical constraint unless addressed at the package level.

**Consequences:** Extension activates but all three language providers silently fail at the first `require()` call. No diagnostics, no completions. Error only visible in the extension host output channel.

**Prevention:**
- Build `language-services` with dual output: `tsup --format cjs,esm --dts`
- Set `package.json` exports:
  ```json
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
  ```
- Mark `vscode` as external in `language-services` tsup config (it cannot be bundled there — it must only be consumed in the extension wrapper layer, never imported in `language-services` itself)
- In the extension's tsup/esbuild config, bundle `language-services` inline (do NOT mark it external) so the CJS extension gets a single flat bundle that avoids runtime `require` of an ESM package

**Detection:** `pnpm -F airtable-formula build` succeeds but opening a `.formula` file shows no diagnostics and no completions. Extension host output shows `ERR_REQUIRE_ESM`.

**Phase:** Extract/Refactor phase (first phase of milestone).

---

### Pitfall 2: `vscode` Namespace Imported Inside `language-services`

**What goes wrong:** During refactor, a developer moves provider logic into `language-services` and imports `vscode` types for `Position`, `Range`, `Diagnostic`, etc. This creates a hard dependency on `vscode` inside the pure service layer. The package can no longer be tested outside VS Code, build fails when bundling for tests, and the architecture collapses to "VS Code extension disguised as a package."

**Why it happens:** `vscode` types (`vscode.Position`, `vscode.Diagnostic`) are familiar and convenient. The VS Code module is available in the extension host process, so it "works" in development — until unit tests run outside VS Code.

**Consequences:** All `language-services` tests require the full VS Code test harness. Test suite becomes slow and fragile. The package cannot be reused in a web worker or future LSP extraction.

**Prevention:**
- `language-services` must define its own plain-object types for positions, ranges, and diagnostics (e.g., `{ line: number; character: number }`) and never import `vscode`
- Extension wrapper files in `packages/extension/src/` convert between the plain types and `vscode.*` types at the boundary
- Enforce at the package level: add `"vscode": false` to tsup externals for `language-services` so any accidental import fails at build time
- Pattern to follow:
  ```typescript
  // language-services/src/types.ts — NO vscode import
  export interface LsPosition { line: number; character: number; }
  export interface LsDiagnostic { message: string; range: LsRange; severity: 'error' | 'warning' | 'info'; }
  
  // extension/src/formula/wrapper.ts — converts at boundary
  import * as vscode from 'vscode';
  import type { LsDiagnostic } from '@airtable-formula/language-services';
  function toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic { ... }
  ```

**Detection:** `pnpm -F language-services test` fails with "Cannot find module 'vscode'" or tests require `jest-mock-vscode` / `@vscode/test-electron`.

**Phase:** Extract/Refactor phase. The tsup "vscode external" guard prevents this silently for the build; the test run makes it explicit.

---

### Pitfall 3: Single DiagnosticCollection for All Three Engines

**What goes wrong:** A single `vscode.languages.createDiagnosticCollection('airtable')` is created in `activate()` and passed to all three engine wrappers. When the formula engine clears diagnostics for a `.formula` file, it accidentally clears diagnostics that the scripting engine set on an open `.script` file (and vice versa), because `diagnosticCollection.set(uri, [])` on the shared collection wipes that URI regardless of which engine set it.

**Why it happens:** The existing code creates one `AirtableFormulaDiagnosticsProvider` with one collection. Extending that same provider for the other two engines is the path of least resistance.

**Consequences:** Diagnostics flicker or disappear when the user switches between file types. Errors on `.script` files vanish when a `.formula` file is edited.

**Prevention:**
- Create one `DiagnosticCollection` per engine with a distinct name:
  ```typescript
  vscode.languages.createDiagnosticCollection('airtable-formula')
  vscode.languages.createDiagnosticCollection('airtable-script')
  vscode.languages.createDiagnosticCollection('airtable-automation')
  ```
- Push each collection into `context.subscriptions` independently so VS Code disposes all three on deactivation
- Engine wrappers only call `set()` and `clear()` on their own collection
- The `onDidChangeTextDocument` handler checks `document.languageId` and routes to the correct collection

**Detection:** Open a `.script` file, get an error diagnostic, then open a `.formula` file and edit it — the `.script` diagnostic disappears.

**Phase:** Scripting engine phase. Must be designed correctly from the first engine addition.

---

### Pitfall 4: `.script` / `.automation` Language IDs Using `javascript` as the Base Language

**What goes wrong:** To get syntax highlighting "for free," `.script` files are associated with `languageId: 'javascript'` via `files.associations` or by registering the extension under the built-in `javascript` language. The VS Code built-in TypeScript/JavaScript language features extension then activates on these files, provides its own completions and hover, and the custom providers are buried under built-in provider output.

**Why it happens:** Registering under a custom language ID (e.g., `airtable-script`) requires authoring a TextMate grammar. Using `javascript` feels like a shortcut.

**Consequences:**
- Built-in TypeScript intellisense shows completions from `node_modules` that don't exist in the Airtable scripting environment
- `tsserver` tries to type-check `.script` files and produces spurious errors about missing Node types
- Custom completions from the extension are merged with — or outranked by — built-in JS completions
- The custom hover provider competes with the built-in JS hover provider; whichever has higher `providerScore` wins

**Prevention:**
- Register `.script` and `.automation` as distinct language IDs (`airtable-script`, `airtable-automation`)
- Provide a TextMate grammar that inherits from `source.js` (embed the JS grammar) rather than using the `javascript` language ID
- In `contributes.grammars`, use `"language": "airtable-script"` and `"scopeName": "source.airtable-script"` with the JS grammar embedded:
  ```json
  {
    "language": "airtable-script",
    "scopeName": "source.airtable-script",
    "path": "./syntaxes/airtable-script.tmLanguage.json",
    "embeddedLanguages": { "source.js": "javascript" }
  }
  ```
- `embeddedLanguages` tells VS Code to treat tokens scoped as `source.js` with JS-aware features while the outer language remains `airtable-script`

**Detection:** Open a `.script` file, run "Developer: Inspect Editor Tokens and Scopes" — if `languageId` is `javascript`, the association is wrong. Check completions for Node.js-specific globals like `process` or `require`.

**Phase:** Scripting engine phase (language ID registration).

---

### Pitfall 5: Custom Global Typings Via `jsconfig.json` + `.d.ts` Don't Work on Custom File Extensions

**What goes wrong:** To inject Airtable-specific globals (`base`, `table`, `cursor`, `input`, `output`, `remoteFetchAsync`) into the JS intellisense for `.script` files, the extension creates or instructs users to create a `globals.d.ts` + `jsconfig.json` in their workspace. The TypeScript language service ignores the `.d.ts` for custom extensions — it only applies to `.js` files natively.

**Why it happens:** VS Code's JavaScript language service uses file extension, not `languageId`, when deciding which `.d.ts` files apply. GitHub Issue #37772 confirms this is a known limitation: `.d.ts` files via `jsconfig.json` are ignored for custom-extension files even when `files.associations` maps them to `javascript`.

**Consequences:** The Airtable globals (`base`, `table`, etc.) are not suggested by the built-in JS IntelliSense. Users get `cannot find name 'base'` errors even with a globals file.

**Prevention — correct approach:** Since `.script` uses a custom language ID (`airtable-script`), the built-in TS language service does NOT run on these files at all. This is actually correct behavior — it means the extension owns 100% of completions and hovers and is free to implement them accurately. The implementation in `language-services` must:
  1. Parse the document text with a lightweight JS parser (e.g., `acorn` or a regex-based approach)
  2. Return completions for Airtable-specific globals from a hardcoded metadata table
  3. Return hover documentation from the same metadata table

**What NOT to do:**
- Do not attempt to hook into `vscode.extensions.getExtension('vscode.typescript-language-features')` to inject a TS plugin — this requires the file to be `languageId: 'javascript'` or `'typescript'` and breaks VS Code's own TS server stability
- Do not use `registerTextDocumentContentProvider` to create virtual `.d.ts` documents hoping the TS service picks them up — it won't for non-JS language IDs

**Detection:** If completions for `base.getTable()` appear alongside `Array.prototype.map`, the TS server is interfering. If completions only show what the extension provides, the architecture is correct.

**Phase:** Scripting engine phase (completion/hover implementation).

---

### Pitfall 6: `deactivate()` Is a No-Op — Provider Subscriptions Not Cleaned Up

**What goes wrong:** Providers registered via `context.subscriptions.push(...)` are disposed automatically on deactivation. But diagnostic collections created without being pushed to subscriptions, or event listeners stored in module-level arrays, are not disposed. This causes stale diagnostics to persist in the Problems panel after the extension is disabled or reloaded.

**Why it happens:** The existing `deactivate()` is `export function deactivate(): void {}` — it does nothing. This is safe only because everything is pushed to `context.subscriptions`. Adding new providers or collections that are accidentally held in module scope (e.g., a `let scriptDiagnostics: vscode.DiagnosticCollection` at the top of a file, assigned in `activate()`, but not pushed to subscriptions) escapes the cleanup.

**Consequences:** After `extension.reload`, old diagnostics from the previous activation persist in the Problems panel until the user explicitly opens and saves the affected file.

**Prevention:**
- Every `vscode.languages.createDiagnosticCollection()` call must be immediately followed by `context.subscriptions.push(collection)`
- Every `vscode.languages.register*Provider()` result must be pushed to `context.subscriptions`
- Pattern for engine wrapper initialization:
  ```typescript
  export function activateScriptEngine(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection('airtable-script');
    context.subscriptions.push(collection); // immediately
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId === 'airtable-script') updateDiagnostics(e.document, collection);
      }),
      vscode.languages.registerHoverProvider('airtable-script', new ScriptHoverProvider()),
      vscode.languages.registerCompletionItemProvider('airtable-script', new ScriptCompletionProvider(), '.'),
    );
  }
  ```

**Detection:** Disable the extension from the Extensions panel without reloading VS Code. Open the Problems panel — if diagnostics from the extension are still visible, subscriptions were not managed correctly.

**Phase:** All phases. Establish the pattern in the refactor phase and maintain it.

---

## Moderate Pitfalls

---

### Pitfall 7: Icon Registration Silently Ignored by Most Icon Themes

**What goes wrong:** The `icon` property is added to `contributes.languages` entries for all three engines. Icons never appear in the file explorer. Users report the feature "doesn't work."

**Why it happens:** The `contributes.languages[].icon` property (finalized in VS Code 1.64, January 2022 release, PR #118846) is a **fallback** that only activates when:
1. The user has a file icon theme active that has at least one file icon defined, AND
2. That theme does not define an icon for the specific language, AND
3. The theme does not set `showLanguageModeIcons: false`

The two most popular icon themes — Material Icon Theme and vscode-icons — define icons for virtually every language and will always override the language contribution icon. Users who have no icon theme active (default "No File Icons") also see nothing.

**Consequences:** The feature works in limited circumstances. It is not a reliable way to ship icons for all users.

**Prevention:**
- Set realistic expectations: the `contributes.languages[].icon` entry is correct and should be included, but treat it as a bonus fallback, not the primary delivery
- The SVG assets used for the language icon must include both `light` and `dark` paths:
  ```json
  "icon": {
    "light": "./images/airtable-script-light.svg",
    "dark": "./images/airtable-script-dark.svg"
  }
  ```
- VS Code 1.100.0 (the current engine minimum) fully supports this property — no version guard needed
- If guaranteed icon visibility is required, the only reliable path is a full `contributes.iconThemes` contribution (a separate full icon theme definition file), which is significantly more effort and an unusual approach for a language extension

**Detection:** Switch to "Minimal" file icon theme. If icons appear, the language icon fallback is working. Switch to Material Icon Theme — icons likely disappear (the theme overrides them).

**Phase:** Icon registration phase (final phase of milestone).

---

### Pitfall 8: `activationEvents` Not Needed for Contributed Languages, but `onStartupFinished` Hides Startup Errors

**What goes wrong:** Since VS Code 1.74.0, languages contributed by the extension no longer need explicit `onLanguage:<id>` activation events — the extension activates automatically when a contributed language file is opened. The existing extension uses `onStartupFinished` (a single broad event). This is correct but masks a subtlety: if `activate()` throws during the initialization of a new engine, the thrown error is caught by VS Code and the extension host continues — but the failed engine's providers are never registered, with no user-visible error.

**Why it happens:** `onStartupFinished` fires once at startup. If the scripting engine initialization fails silently (e.g., the shared `language-services` package fails to load), the entire engine is absent with no warning.

**Prevention:**
- Wrap each engine's activation in a try/catch that logs to the extension's output channel and shows a warning notification:
  ```typescript
  try {
    activateScriptEngine(context);
  } catch (err) {
    console.error('[AirtableFormula] Script engine failed to activate:', err);
    void vscode.window.showWarningMessage('Airtable Formula: Script engine failed to load. See output channel.');
  }
  ```
- Do not add `onLanguage:airtable-script` etc. to `activationEvents` — they are redundant for contributed languages in VS Code 1.74+ and add noise to the manifest

**Detection:** Intentionally break the `language-services` import path and open a `.script` file. If no error appears, the activation error is being swallowed.

**Phase:** All phases that add new engine activations.

---

### Pitfall 9: Embedding Full JS Grammar Causes Editor Slowdown

**What goes wrong:** The TextMate grammar for `airtable-script` embeds the complete `source.js` grammar by reference. On files over 500 lines, the tokenizer becomes noticeably slow — especially when the file contains complex regex literals or nested template literals — because Oniguruma regexes in TextMate grammars run synchronously in the renderer process.

**Why it happens:** The full JavaScript TextMate grammar is one of the most complex grammars in existence. Embedding it entirely is correct for small files but creates a performance ceiling.

**Consequences:** Editor lag when typing in large `.script` files. VS Code may disable the grammar entirely for large files (its internal 10,000 line limit).

**Prevention:**
- For `airtable-script` and `airtable-automation`, embed the JS grammar using `"include": "source.js"` rather than duplicating grammar rules — this keeps the grammar file small
- VS Code handles the embedded grammar inclusion efficiently through its grammar registry; do not copy-paste the JS grammar content inline
- If performance is observed to be poor, subset the embedded grammar to only the constructs valid in the Airtable scripting environment (no `import`/`export`, no `require`, limited to ES2020 constructs)
- Profile using "Developer: Inspect Editor Tokens and Scopes" and the built-in extension profiler (Help → Toggle Developer Tools → Performance tab)

**Detection:** Open a 200+ line `.script` file with complex JS. Observe if typing latency increases. Compare with a plain `.js` file of the same content.

**Phase:** Grammar authoring phase (part of scripting engine phase).

---

### Pitfall 10: `check-tool-sync.mjs` Does Not Cover Language Engine Additions

**What goes wrong:** The existing `scripts/check-tool-sync.mjs` enforces MCP tool-category consistency across 7 files. It does not know about the language engine additions. No equivalent guard exists for the language platform additions. When a developer adds a new Airtable scripting API function to `language-services` metadata, they may forget to update the corresponding completion provider or the hover documentation, and no CI check catches the drift.

**Why it happens:** The language metadata (function signatures, parameter descriptions, global API surfaces for `.script` vs `.automation`) spans multiple layers: the pure service (`language-services`), the hover/completion/signature providers, and potentially the diagnostics rules. Without a sync check, these drift.

**Consequences:** Completions suggest APIs that have no hover documentation, or hover docs describe parameters that don't match the completion signature.

**Prevention:**
- Design `language-services` with a single source of truth for each engine's API metadata (one `airtable-script-globals.ts` file, one `airtable-formula-functions.ts` file)
- All providers (completion, hover, signature, diagnostics) read from that single source — never maintain separate lists in separate files
- This is a design choice, not a build check, but it eliminates the class of drift entirely

**Phase:** Architecture of `language-services`. Must be established before implementing any individual provider.

---

## Minor Pitfalls

---

### Pitfall 11: `contributes.languages` Extension Array Does Not Support Glob Patterns

**What goes wrong:** The developer adds `"*.script"` to the `extensions` array in `contributes.languages` (confusing it with `filenamePatterns` which does accept globs). VS Code silently ignores the entry. Files named `foo.script` are not associated with `airtable-script`.

**Prevention:** Use `"extensions": [".script", ".automation"]` (leading dot, no wildcards). For glob-based associations, use `"filenamePatterns": ["*.script"]` instead. Both can coexist. Use both for maximum coverage.

**Phase:** Language ID registration (package.json contributes).

---

### Pitfall 12: Language Configuration File Not Provided for Script Languages

**What goes wrong:** `contributes.languages` entries for `airtable-script` and `airtable-automation` omit the `"configuration"` key. Auto-closing brackets, comment toggling (`//`), and code folding do not work. Users notice immediately because `Ctrl+/` does nothing in script files.

**Prevention:** Create `language-configuration/airtable-script-language-configuration.json` and `language-configuration/airtable-automation-language-configuration.json`. Copy the existing formula configuration as a starting point but adjust: script files are JavaScript-like, so use `//` and `/* */` for comments, `()`, `[]`, `{}`, and template literal backtick pairs. Point each language entry to its configuration file.

**Phase:** Language ID registration (package.json contributes).

---

### Pitfall 13: Completion Provider Trigger Characters Conflict Across Engines

**What goes wrong:** All three engines register completion providers with `'('` as a trigger character. When the user types `(` in a `.formula` file, VS Code queries all three registered completion providers for that trigger character (VS Code queries providers in parallel by document selector, but the `languageId` filter prevents cross-engine calls). This is not actually a conflict — VS Code uses the `DocumentSelector` to route correctly. However, if a developer registers a provider with `'javascript'` as the selector instead of `'airtable-script'`, they will accidentally receive triggers from `.js` files in the workspace.

**Prevention:** Always use the specific language ID string (`'airtable-script'`) rather than a `DocumentFilter` object without a scheme, and never use `'javascript'` or `{ pattern: '**/*.{js,script}' }` as the selector for Airtable-specific providers.

**Phase:** Provider registration in all engine phases.

---

### Pitfall 14: Two Scripting Engines Share 95% of Globals — Don't Duplicate the Metadata

**What goes wrong:** Scripting Extension (`.script`) and Automation Script (`.automation`) are created as fully independent metadata tables. `base`, `table`, `cursor`, and common JS APIs are duplicated. When Airtable updates a scripting API, the developer updates one engine's metadata but forgets the other.

**Why it happens:** The two engines have different top-level globals (`input`/`output`/`remoteFetchAsync` exist in automation only), making them feel like separate domains.

**Prevention:**
- Create a `shared-script-globals.ts` in `language-services` with the common subset (`base`, `table`, `cursor`, async/await, `fetch`)
- `airtable-script-globals.ts` extends shared with Scripting Extension-only additions
- `airtable-automation-globals.ts` extends shared with Automation Script-only additions (`input.config`, `output.set`, `remoteFetchAsync` differences)
- Neither file duplicates the shared subset

**Phase:** Scripting engine phase (metadata design).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Extracting formula providers to `language-services` | ESM/CJS boundary (Pitfall 1) + `vscode` import leaking in (Pitfall 2) | Dual-format build; vscode external guard; pure-types layer |
| Registering `airtable-script` language ID | `javascript` language takeover (Pitfall 4) + missing language-config file (Pitfall 12) + grammar perf (Pitfall 9) | Custom language ID; embed JS grammar by reference; provide language-config JSON |
| Scripting engine diagnostics/completions | DiagnosticCollection shared across engines (Pitfall 3) + d.ts injection misconception (Pitfall 5) | One collection per engine; implement completions in language-services, not via TS server |
| Automation engine | Metadata duplication (Pitfall 14) | Shared base globals + per-engine extends |
| Icon registration | Icon invisible under most themes (Pitfall 7) | Set expectations; include both light/dark paths; this is a fallback, not a primary icon system |
| Ongoing maintenance | No sync guard for language metadata (Pitfall 10) | Single source of truth per engine; all providers read from it |

---

## Sources

- [VS Code Contribution Points — contributes.languages](https://code.visualstudio.com/api/references/contribution-points#contributes.languages) — HIGH confidence (official docs)
- [VS Code Programmatic Language Features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features) — HIGH confidence (official docs)
- [VS Code Syntax Highlight Guide (TextMate grammars)](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide) — HIGH confidence (official docs)
- [File Icon Theme guide](https://code.visualstudio.com/api/extension-guides/file-icon-theme) — HIGH confidence (official docs)
- [Language icon PR #118846 — finalized the `icon` property](https://github.com/microsoft/vscode/pull/118846) — HIGH confidence (merged PR, Jan 2022)
- [Language icon Issue #140047 — finalization tracking](https://github.com/microsoft/vscode/issues/140047) — HIGH confidence
- [jsconfig with custom extensions Issue #37772](https://github.com/microsoft/vscode/issues/37772) — HIGH confidence (known VS Code limitation)
- [Writing a VS Code extension in ES modules (2025)](https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension) — MEDIUM confidence (community, verified against official limitation)
- [VS Code Extension Bundling guide](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) — HIGH confidence (official docs)
- [VS Code extensions do not support ESM natively — pnp/vscode-viva Issue #114](https://github.com/pnp/vscode-viva/issues/114) — MEDIUM confidence (confirmed by multiple sources)
- [onLanguage activation no longer required for contributed languages (VS Code 1.74)](https://code.visualstudio.com/api/references/activation-events) — HIGH confidence (official docs)
