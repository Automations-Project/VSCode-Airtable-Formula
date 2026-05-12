# Phase 1: Language Services Scaffold - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 1-Language Services Scaffold
**Areas discussed:** Phase 1 wiring depth, Adapter location, LS type shape

---

## Phase 1 Wiring Depth

### Q1: Wiring vs. stub in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Wire in Phase 1 | extension.ts calls registerLanguageProviders(context), replacing 5 inline registrations. Proves integration path before Phase 2 touches formula logic. | ✓ |
| Stub only | Files exist but extension.ts doesn't call them until Phase 2. Less Phase 1 risk, but architecture stays unproven. | |

**User's choice:** Wire in Phase 1

### Q2: What does registration.ts absorb?

| Option | Description | Selected |
|--------|-------------|----------|
| Everything formula-related | DiagnosticsProvider creation, both event listeners, and all 5 vscode.languages.register*() calls move to registration.ts | ✓ |
| Provider registrations only | Only the 5 register*() calls move; diagnostic event listeners stay in extension.ts | |

**User's choice:** Everything formula-related

---

## Adapter Location

### Q1: Where do convert.ts and registration.ts live?

| Option | Description | Selected |
|--------|-------------|----------|
| src/language/ subdirectory | Matches existing pattern: src/mcp/, src/auto-config/, src/debug/. Groups all language adapter files together for Phase 2+ expansion. | ✓ |
| Flat in src/ | Alongside diagnostics.ts, completions.ts etc. Simpler now, but crowded when all 3 engines have adapters. | |

**User's choice:** src/language/ subdirectory

---

## LS Type Shape

### Q1: Minimal vs. all-engines from day one?

| Option | Description | Selected |
|--------|-------------|----------|
| All-engines from day one | Design types to cover all 3 engine needs now (source, filterText, sortText, relatedInformation, etc.) | ✓ |
| Minimal — formula engine needs only | Only fields the formula engine uses now; Phase 2+ extends as needed | |

**User's choice:** All-engines from day one

### Q2: Markdown string support?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — markdown string type | contents: { kind: 'markdown' \| 'plaintext'; value: string }. convert.ts maps to vscode.MarkdownString. | ✓ |
| Plain string only | Simpler, all docs are plain text. Can be upgraded later but requires changing interface. | |

**User's choice:** Yes — markdown string type

### Q3: Mirror VS Code enum values?

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror VS Code values | LsSeverity.Error = 0 etc. Direct cast in convert.ts, no lookup table. | ✓ |
| Independent values | Own sequence, convert.ts needs explicit lookup table. More portable but no actual value. | |

**User's choice:** Mirror VS Code values

---

## Claude's Discretion

- Internal source tree layout inside `packages/language-services/src/` (single `types.ts` vs `types/index.ts`)
- Whether to pre-create empty `src/engines/` directory (YAGNI applies)
- `registerLanguageProviders` internal helper structure

## Deferred Ideas

None raised during discussion.
