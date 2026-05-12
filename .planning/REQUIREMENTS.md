# Requirements: VSCode-Airtable-Formula — Language Platform

**Defined:** 2026-05-12
**Milestone:** v1.0 Language Platform
**Core Value:** Airtable-aware language intelligence directly in VS Code — accurate completions, diagnostics, and hover docs for formulas, scripts, and automation scripts.

## v1 Requirements

### Infrastructure — Language Services Package

- [ ] **INFRA-01**: The `packages/language-services` workspace package exists with a dual CJS+ESM tsup build and zero VS Code runtime dependency
- [ ] **INFRA-02**: Framework-agnostic types are defined (`LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover`) so engines never import from `vscode`
- [ ] **INFRA-03**: VS Code adapter layer exists in the extension (`convert.ts`, `registration.ts`) that translates between VS Code types and language-services types for all 3 engines

### Formula Engine Migration

- [ ] **FORMULA-01**: Existing formula diagnostics, completions, hover, and signature help are migrated to `engines/formula/` inside `language-services` with no user-visible behavioral change
- [ ] **FORMULA-02**: A single unified `FUNCTION_REGISTRY` drives all formula providers — the private duplicate function list in `completions.ts` is eliminated
- [ ] **FORMULA-03**: Known formula engine feature gaps are resolved — missing functions added, incorrect or missing diagnostics fixed

### Script Engine (`.script` files)

- [ ] **SCRIPT-01**: The `airtable-script` language ID is registered for `.script` files with JS syntax highlighting (TextMate grammar that includes `source.js`) and a language configuration (comment toggling, bracket pairs, folding)
- [ ] **SCRIPT-02**: Dot-triggered completions surface all Scripting Extension globals and their methods: `base`, `table`, `cursor`, `input`, `output`, `session`, `fetch`, `remoteFetchAsync`
- [ ] **SCRIPT-03**: Hover documentation is shown for all Scripting Extension globals and their methods
- [ ] **SCRIPT-04**: A diagnostic is raised for `*Async` calls not preceded by `await` (most common Airtable scripting mistake)
- [ ] **SCRIPT-05**: A diagnostic is raised when an identifier is not in the Scripting Extension globals list
- [ ] **SCRIPT-06**: `.script` files display a custom light/dark SVG file type icon in VS Code

### Automation Engine (`.automation` files)

- [ ] **AUTO-01**: The `airtable-automation` language ID is registered for `.automation` files with JS syntax highlighting and a language configuration
- [ ] **AUTO-02**: Completions are scoped to the automation context — `input.` shows only `input.config()`, `output.` shows only `output.set()`; interactive input methods, `cursor`, and `session` are absent
- [ ] **AUTO-03**: Hover documentation is shown for all automation globals and their methods
- [ ] **AUTO-04**: A diagnostic is raised when a scripting-extension-only global (`cursor`, `session`, `remoteFetchAsync`, interactive `input.*Async()`, `output.text/markdown/table`) is used in an automation file
- [ ] **AUTO-05**: `.automation` files display a custom light/dark SVG file type icon in VS Code

## v2 Requirements

### Script & Automation — Advanced Features

- **SCRIPT-ADV-01**: Signature help (parameter hints) for script engine method calls
- **SCRIPT-ADV-02**: `input.config()` field-type string-literal completions (`{type: 'number', label: ...}`)
- **SCRIPT-ADV-03**: Quick-fix code action to insert `await` for missing-await diagnostic
- **SCRIPT-ADV-04**: Cross-context paste hint when automation file uses scripting-extension-only globals
- **AUTO-ADV-01**: Signature help for automation engine method calls
- **INT-01**: Go-to-definition for field and table names (requires live MCP API integration)
- **INT-02**: Automation runtime limit static analysis (30s limit, 50 fetch/30 selectRecords per run)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Separate LSP node process (JSON-RPC) | VS Code-only target; in-process service layer achieves the same goals with far less complexity; extractable later |
| Full TypeScript type checking for script files | Would conflict with/duplicate the built-in TS language server; Airtable-specific globals only |
| Script file execution / REPL | Editor support only — no runtime integration |
| `@types/airtable` npm package | Covers REST API client only; hand-rolled `.d.ts` files required for scripting globals |
| Automation timeout static analysis (this milestone) | High false-positive risk; defer to v2 |

## Traceability

*(Populated by roadmapper)*

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | — | Pending |
| INFRA-02 | — | Pending |
| INFRA-03 | — | Pending |
| FORMULA-01 | — | Pending |
| FORMULA-02 | — | Pending |
| FORMULA-03 | — | Pending |
| SCRIPT-01 | — | Pending |
| SCRIPT-02 | — | Pending |
| SCRIPT-03 | — | Pending |
| SCRIPT-04 | — | Pending |
| SCRIPT-05 | — | Pending |
| SCRIPT-06 | — | Pending |
| AUTO-01 | — | Pending |
| AUTO-02 | — | Pending |
| AUTO-03 | — | Pending |
| AUTO-04 | — | Pending |
| AUTO-05 | — | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0 (roadmap pending)
- Unmapped: 17 ⚠️

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after initial definition*
