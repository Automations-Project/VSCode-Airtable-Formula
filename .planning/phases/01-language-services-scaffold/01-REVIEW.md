---
phase: 01-language-services-scaffold
reviewed: 2026-05-12T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - packages/language-services/package.json
  - packages/language-services/tsconfig.json
  - packages/language-services/vitest.config.ts
  - packages/language-services/src/index.ts
  - packages/language-services/src/types.ts
  - packages/language-services/src/test/types.test.ts
  - packages/extension/src/language/convert.ts
  - packages/extension/src/language/registration.ts
  - packages/extension/src/extension.ts
  - packages/extension/package.json
  - package.json
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 01: Language Services Scaffold — Code Review Report

**Reviewed:** 2026-05-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The scaffold correctly establishes the `@airtable-formula/language-services` workspace package with dual CJS+ESM output, zero vscode dependency, the 8 framework-agnostic types, and wires `registerLanguageProviders` into `extension.ts`. The D-09 numeric mirror assumption for `LsSeverity` and `LsCompletionItemKind` is verified correct against the installed `@types/vscode`.

Four issues are worth fixing before the scaffold is used as a real integration base: a behavioral bug in `toVscodeHover` (plaintext rendered as Markdown), a silent data loss in `toVscodeDiagnostic` (relatedInformation dropped), a missing adapter function for `LsCompletionItem`, and a gap in the CJS types export path. Three additional informational items note the disconnected adapter layer, an unused import in `convert.ts`, and a missing `"types"` condition in the exports map.

---

## Warnings

### WR-01: `toVscodeHover` ignores `kind: 'plaintext'` — always renders as Markdown

**File:** `packages/extension/src/language/convert.ts:32-35`
**Issue:** `toVscodeHover` constructs `new vscode.MarkdownString(h.contents.value)` unconditionally, regardless of whether `h.contents.kind` is `'plaintext'` or `'markdown'`. When the language service returns `kind: 'plaintext'`, any Markdown syntax characters (`*`, `_`, `` ` ``, `#`) in the value will be interpreted as Markdown markup by VS Code's hover renderer. This is incorrect behavior — plaintext hovers must not be rendered as Markdown.

**Fix:**
```typescript
export function toVscodeHover(h: LsHover): vscode.Hover {
    let contents: vscode.MarkdownString | string;
    if (h.contents.kind === 'markdown') {
        contents = new vscode.MarkdownString(h.contents.value);
    } else {
        // plaintext: pass as bare string — VS Code will not interpret Markdown syntax
        contents = h.contents.value;
    }
    return new vscode.Hover(contents, h.range ? toVscodeRange(h.range) : undefined);
}
```

---

### WR-02: `toVscodeDiagnostic` silently drops `relatedInformation`

**File:** `packages/extension/src/language/convert.ts:20-30`
**Issue:** `LsDiagnostic.relatedInformation` is fully declared in `types.ts` (lines 22-26) with a location URI and range, but `toVscodeDiagnostic` never maps this field to `vscode.Diagnostic.relatedInformation`. Any related information produced by the language service is silently lost, meaning errors that reference related locations (e.g., "first declared here") will appear without their cross-reference in the Problems panel.

**Fix:**
```typescript
export function toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic {
    const diag = new vscode.Diagnostic(
        toVscodeRange(d.range),
        d.message,
        d.severity as unknown as vscode.DiagnosticSeverity
    );
    if (d.code !== undefined) { diag.code = d.code; }
    if (d.source !== undefined) { diag.source = d.source; }
    if (d.relatedInformation?.length) {
        diag.relatedInformation = d.relatedInformation.map(ri => ({
            location: new vscode.Location(
                vscode.Uri.parse(ri.location.uri),
                toVscodeRange(ri.location.range)
            ),
            message: ri.message,
        }));
    }
    return diag;
}
```

---

### WR-03: No `toVscodeCompletionItem` converter — `LsCompletionItem` type is unusable from the adapter layer

**File:** `packages/extension/src/language/convert.ts:1-35`
**Issue:** `convert.ts` exports converters for `LsPosition`, `LsRange`, `LsDiagnostic`, and `LsHover`, but has no `toVscodeCompletionItem` function for `LsCompletionItem`. The `LsCompletionItem` type (with `kind`, `detail`, `documentation`, `insertText`, `filterText`, `sortText`, `commitCharacters`) is the most data-rich type in the scaffold. Without a converter, any future language service that returns `LsCompletionItem[]` cannot be wired to VS Code's completion provider through the adapter layer without duplicating conversion logic in the provider itself.

**Fix:** Add a conversion function before the phase that migrates formula completions:
```typescript
import type { LsCompletionItem } from '@airtable-formula/language-services';
import { LsCompletionItemKind } from '@airtable-formula/language-services';

export function toVscodeCompletionItem(item: LsCompletionItem): vscode.CompletionItem {
    const ci = new vscode.CompletionItem(
        item.label,
        item.kind !== undefined
            ? (item.kind as unknown as vscode.CompletionItemKind)
            : undefined
    );
    if (item.detail !== undefined) { ci.detail = item.detail; }
    if (item.documentation !== undefined) {
        ci.documentation = typeof item.documentation === 'string'
            ? item.documentation
            : new vscode.MarkdownString(item.documentation.value);
    }
    if (item.insertText !== undefined)      { ci.insertText      = item.insertText; }
    if (item.filterText !== undefined)      { ci.filterText      = item.filterText; }
    if (item.sortText !== undefined)        { ci.sortText        = item.sortText; }
    if (item.commitCharacters !== undefined){ ci.commitCharacters = item.commitCharacters; }
    return ci;
}
```
Note: the `documentation` field has the same plaintext/markdown kind ambiguity as `toVscodeHover` — apply the same `kind` check when implementing this.

---

### WR-04: CJS consumers get no `.d.cts` types — `"require"` export entry missing `"types"` condition

**File:** `packages/language-services/package.json:8-13`
**Issue:** The `exports` map provides `"types": "./dist/index.d.ts"` as a top-level condition, but TypeScript's `moduleResolution: "bundler"` / `"node16"` / `"nodenext"` resolution resolves `types` per export condition. The `"require"` condition has no paired `"types"` entry, so a CJS consumer (like the extension, which builds to CJS via tsup) may fail to resolve types correctly depending on TypeScript version and `moduleResolution` mode. The built dist already contains `index.d.cts` — it just needs to be wired up.

**Fix:**
```json
"exports": {
  ".": {
    "import": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "require": {
      "types": "./dist/index.d.cts",
      "default": "./dist/index.cjs"
    }
  }
}
```

---

## Info

### IN-01: `convert.ts` is never imported — adapter layer is entirely disconnected

**File:** `packages/extension/src/language/convert.ts:1-35`
**Issue:** No file in `packages/extension/src/` imports from `./language/convert` or `../language/convert`. All five exported functions (`toLsPosition`, `toVscodePosition`, `toLsRange`, `toVscodeRange`, `toVscodeDiagnostic`, `toVscodeHover`) are dead code at runtime. This is expected for a scaffold phase, but worth flagging as a tracking item: the adapter layer must be imported by at least one provider before Phase 2 migrates formula logic, otherwise the convert functions will not be exercised.

**Fix:** No change needed in Phase 1. When Phase 2 migrates the first language provider, import and use `toVscodeDiagnostic` / `toVscodeHover` from `'./language/convert.js'` in that provider.

---

### IN-02: `types.ts` import in `convert.ts` uses `import type` — enum values not available at runtime if needed

**File:** `packages/extension/src/language/convert.ts:2`
**Issue:** Line 2 uses `import type { LsPosition, LsRange, LsDiagnostic, LsHover }` which is correct for type-only imports. However, if a future `toVscodeCompletionItem` (see WR-03) needs to reference `LsCompletionItemKind` values at runtime (e.g., for a default fallback), it will need a value import, not a type import. This is a pre-emptive note for when WR-03 is implemented.

**Fix:** When adding `toVscodeCompletionItem`, add a separate value import line:
```typescript
import { LsCompletionItemKind } from '@airtable-formula/language-services';
```

---

### IN-03: `tsconfig.json` is not the actual build driver — drift risk between tsc type-check config and tsup output

**File:** `packages/language-services/tsconfig.json:1-12`
**Issue:** The `tsconfig.json` specifies `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`, but the build script uses `tsup` which internally runs esbuild (not tsc). The `outDir: "dist"` and `rootDir: "src"` in tsconfig are only relevant if `tsc` is invoked directly for type-checking (e.g., by an IDE or CI `tsc --noEmit`). There is no `tsc --noEmit` step in the `build` script — the `--dts` flag in tsup generates declarations via its own mechanism. If a CI step runs bare `tsc` against this package, it will emit to `dist/` in parallel with tsup output and may produce different file layouts. Recommend adding `"noEmit": true` to the tsconfig to make its role explicit.

**Fix:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "noEmit": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

_Reviewed: 2026-05-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
