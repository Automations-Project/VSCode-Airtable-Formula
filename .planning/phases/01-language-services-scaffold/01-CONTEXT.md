# Phase 1: Language Services Scaffold - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Create `packages/language-services` as a new pnpm workspace package: dual CJS+ESM tsup build, zero `vscode` dependency, framework-agnostic types (`LsDiagnostic`, `LsPosition`, `LsRange`, `LsCompletionItem`, `LsHover`). Wire the VS Code adapter layer into the extension — `packages/extension/src/language/convert.ts` and `registration.ts` — and have `extension.ts` call `registerLanguageProviders(context)` to prove the integration path. No formula logic moves in this phase; existing providers stay in place and are imported by `registration.ts`.

</domain>

<decisions>
## Implementation Decisions

### Phase 1 Wiring

- **D-01:** `extension.ts` calls `registerLanguageProviders(context)` in Phase 1, replacing the 5 inline formula registrations. The adapter is live and proven, not a stub.
- **D-02:** `registration.ts` absorbs **everything** formula-related from `extension.ts`: `AirtableFormulaDiagnosticsProvider` creation, `onDidChangeTextDocument` and `onDidOpenTextDocument` event listeners, and all 5 `vscode.languages.register*()` calls. `extension.ts` calls `registerLanguageProviders(context)` and nothing else formula-related.
- **D-03:** The existing provider classes (`diagnostics.ts`, `completions.ts`, `hover.ts`, `signature.ts`, `codeActions.ts`) are **not moved** in Phase 1 — `registration.ts` imports them from their current locations. They move to `language-services/engines/formula/` in Phase 2.
- **D-04:** `registerLanguageProviders(context: vscode.ExtensionContext): void` — pushes all registrations to `context.subscriptions` internally; no return value.

### Adapter Layer Location

- **D-05:** `convert.ts` and `registration.ts` live in `packages/extension/src/language/` — a new subdirectory following the established subsystem pattern (`src/mcp/`, `src/auto-config/`, `src/debug/`). Phase 2+ engine adapters expand this directory.

### Framework-Agnostic Type Shape

- **D-06:** Types are designed for **all 3 engines from day one** — not minimal formula-only. Include fields needed across formula, script, and automation engines.
- **D-07:** `LsHover.contents` is `{ kind: 'markdown' | 'plaintext'; value: string }` (a shared `LsMarkdownString` type). Hover docs across all engines use markdown for function names, code formatting, and descriptions.
- **D-08:** `LsCompletionItem.documentation` is `string | LsMarkdownString`. All other documentation fields in the types support markdown where VS Code supports it.
- **D-09:** `LsSeverity` and `LsCompletionItemKind` enums **mirror VS Code's numeric values exactly** (`LsSeverity.Error = 0`, `Warning = 1`, `Information = 2`, `Hint = 3`; `LsCompletionItemKind` matches `vscode.CompletionItemKind`). `convert.ts` can cast directly without a lookup table.

### Type Definitions (all-engines shape)

The 5 types plus supporting types to define in `packages/language-services/src/types.ts` (or `src/types/index.ts`):

```typescript
export interface LsMarkdownString {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export interface LsPosition { line: number; character: number; }
export interface LsRange { start: LsPosition; end: LsPosition; }

export interface LsDiagnostic {
  range: LsRange;
  message: string;
  severity: LsSeverity;
  code?: string | number;        // for quick-fix matching
  source?: string;               // engine identifier
  relatedInformation?: Array<{ location: { uri: string; range: LsRange }; message: string; }>;
}

export interface LsCompletionItem {
  label: string;
  kind?: LsCompletionItemKind;
  detail?: string;
  documentation?: string | LsMarkdownString;
  insertText?: string;
  filterText?: string;           // for search filtering
  sortText?: string;             // for ordering in list
  commitCharacters?: string[];
}

export interface LsHover {
  contents: LsMarkdownString;
  range?: LsRange;
}

export const enum LsSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }
export const enum LsCompletionItemKind { /* mirror vscode.CompletionItemKind values */ }
```

### Claude's Discretion

- Internal source tree layout inside `packages/language-services/src/` — planner/executor decides whether types go in `src/types.ts` or `src/types/index.ts`. Either is fine.
- Whether to pre-create `src/engines/` directory stubs — YAGNI applies; only create what Phase 1 actually needs.
- `registerLanguageProviders` return type — `void` confirmed, but any helper internal structure is executor's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — INFRA-01, INFRA-02, INFRA-03: exact success criteria for this phase
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and dependency constraints

### Research (critical reading)
- `.planning/research/STACK.md` — Package scaffold details: tsup command, `package.json` exports map, tsconfig shape, where SVG/language-config assets go, extension dependency wiring
- `.planning/research/PITFALLS.md` — Critical pitfalls to avoid: ESM-only crash risk, `vscode` leak into `language-services`, shared DiagnosticCollection erasure (for future phases)
- `.planning/research/ARCHITECTURE.md` — In-process architecture rationale; how language-services integrates with the extension

### Existing Code (integration points)
- `packages/shared/package.json` — Exact model for `language-services/package.json` (tsup, exports map, devDependencies); **language-services must use `--format cjs,esm` instead of `--format esm`**
- `packages/shared/tsconfig.json` — Exact model for `language-services/tsconfig.json`
- `packages/extension/src/extension.ts:183–240` — Current formula provider registrations being replaced by `registerLanguageProviders(context)` in Phase 1
- `packages/extension/package.json` — Must add `"@airtable-formula/language-services": "workspace:*"` to `dependencies`; root `build` and `test` scripts need `pnpm -F language-services build` inserted after shared

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/shared/package.json` + `tsconfig.json`: copy-and-modify template for the new `language-services` package (change name, add `cjs` to format, adjust exports for dual output)
- `packages/extension/src/mcp/registration.ts`: model for how a subsystem's registration file is structured (imports from subsystem, pushes to context.subscriptions, exports a single register function)

### Established Patterns
- **Subsystem subdirectories**: `src/mcp/`, `src/auto-config/`, `src/debug/`, `src/skills/`, `src/webview/` — all use a subdirectory + single registration/entry export. `src/language/` follows this exactly.
- **Workspace deps**: Extension uses `"@airtable-formula/shared": "workspace:*"` in `dependencies` (not devDependencies) — `language-services` follows the same pattern.
- **External vscode**: Extension's tsup build uses `--external vscode`. `language-services` must NOT import `vscode` so this constraint is satisfied automatically.
- **Build order in root package.json**: `check-tool-sync → shared → webview → bundle-mcp → extension`. `language-services` inserts between `shared` and `webview`.

### Integration Points
- `packages/extension/src/extension.ts` line 183: `new AirtableFormulaDiagnosticsProvider()` — becomes `registerLanguageProviders(context)` call
- `packages/extension/src/extension.ts` lines 184–240: all formula event registrations are deleted and relocated to `src/language/registration.ts`
- Root `package.json` `scripts.build`: insert `pnpm -F language-services build &&` after `pnpm -F shared build &&`
- Root `package.json` `scripts.test`: same insertion

</code_context>

<specifics>
## Specific Ideas

- The `registration.ts` in `src/language/` becomes the pattern all 3 engine adapters follow. In Phase 1 it wraps the existing formula providers; in Phase 2 it routes through language-services calls; in Phases 3–4 new engine registrations are added here alongside formula.
- `convert.ts` in Phase 1 will primarily be a type-mapping file (LS types → VS Code types). The actual translation functions become meaningful in Phase 2 when language-services actually returns `LsDiagnostic[]` etc. Phase 1 can define the function signatures with pass-through or no-op implementations.
- The dual CJS+ESM output is the single most critical build constraint. Phase 1's primary verification is: `pnpm -F language-services build` succeeds AND `pnpm build` completes with zero TS errors and formula features still work identically in VS Code.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Language Services Scaffold*
*Context gathered: 2026-05-12*
