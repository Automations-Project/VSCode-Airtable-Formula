# Phase 6: LSP Server - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver `packages/lsp-server/` — a new workspace package published to npm as `airtable-user-lsp`. It wraps `language-services` via the `vscode-languageserver` protocol and provides diagnostics, completions, hover, and signature help for `.formula`, `.ats`/`.script`, and `.ata`/`.automation` files. Supports standalone stdio mode and daemon TCP attach via `port_lsp`. The VS Code extension's existing in-process language providers are NOT changed.

</domain>

<decisions>
## Implementation Decisions

### D-01: Package Identity

**Decision:** New workspace package at `packages/lsp-server/`, published to npm as `airtable-user-lsp` (unscoped, same naming pattern as `airtable-user-mcp`). Includes its own README for standalone use. Independent semver versioning added to the `release.yml` target choices alongside `extension` and `mcp-server`.

---

### D-02: Daemon LSP Launch — Subprocess Model

**Decision:** The daemon spawns `airtable-user-lsp --tcp` as a managed subprocess at startup. The LSP subprocess binds a TCP port, then writes `port_lsp` to `~/.airtable-user-mcp/daemon.lock` itself. The daemon polls the lockfile until `port_lsp` appears (same polling pattern as the MCP attach proxy). On daemon shutdown, the daemon sends SIGTERM to the LSP child process (holds child process reference).

**Subprocess interface:**
- Daemon spawns: `airtable-user-lsp --tcp` (no explicit port arg — OS assigns the port)
- LSP server writes `port_lsp` to existing daemon.lock once it has bound
- Daemon polls lockfile until `port_lsp` is non-null (or timeout → start without LSP)

---

### D-03: language-services Bundling

**Decision:** `language-services` stays `"private": true` in the monorepo. At build time, tsup/esbuild bundles it into the `airtable-user-lsp` dist output. The published npm package is self-contained — no external `language-services` dependency. Identical to how the extension bundles mcp-server source today.

---

### D-04: Stdio Mode — Always Fresh In-Process

**Decision:** `npx airtable-user-lsp --stdio` always starts a fresh in-process LSP server regardless of whether a daemon is running. There is NO stdio-to-TCP proxy. Editors wanting the shared daemon LSP instance configure their LSP client to connect directly to the TCP port (reading `port_lsp` from the lockfile). This keeps the stdio path simple and predictable.

---

### D-05: VS Code Extension — Unchanged

**Decision:** The VS Code extension continues to use `language-services` directly via the existing in-process providers (`convert.ts`, wrapper classes in `src/language/`). The extension does NOT become an LSP client. Phase 6 only delivers the standalone `airtable-user-lsp` package for external editors.

---

### D-06: LsXxx → LSP Protocol Conversion Layer

**Decision:** A new `lsp-convert.ts` (or `convert.ts`) lives inside `packages/lsp-server/src/` and maps `Ls*` values to `vscode-languageserver` protocol values. `language-services` remains clean with no LSP knowledge. Mirrors the pattern in `packages/extension/src/language/convert.ts` which maps `Ls*` → VS Code types.

Note: `LsSeverity` (0=Error) mirrors VS Code values; LSP protocol uses (1=Error, 2=Warning, 3=Information, 4=Hint). `LsCompletionItemKind` (0=Text) vs LSP (1=Text, 2=Method…). Conversion is non-trivial — the conversion module is mandatory.

---

### D-07: File-Type Routing

**Decision:** Use both language ID and file extension. Priority: language ID from client's `textDocument/didOpen` (if recognized) → fall back to file extension. Routing map:
- Language ID `airtable-formula` OR extension `.formula`/`.fx` → formula engine
- Language ID `airtable-script` OR extension `.ats`/`.script` → script engine
- Language ID `airtable-automation` OR extension `.ata`/`.automation` → automation engine

---

### D-08: LSP Capabilities — Include Signature Help

**Decision:** Phase 6 implements `textDocument/signatureHelp` in addition to diagnostics, completions, and hover. The formula engine already has a complete `signature.ts` with `LsSignatureHelp` output. Add it while the protocol plumbing is fresh. (Scope addition vs. LSP-02 — user explicitly confirmed.)

---

### Claude's Discretion

- **LSP subprocess shutdown:** Daemon sends SIGTERM to the LSP child process on daemon shutdown (holds child process ref). This is the simpler approach consistent with existing daemon lifecycle management.
- **TCP port assignment:** OS assigns the port (bind on port 0, read back assigned port). No hardcoded default port.
- **Workspace/configuration support:** `workspace/didChangeConfiguration` is out of scope for Phase 6 (listed as LSP-ADV-01 future requirement).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 Requirements and Roadmap
- `.planning/ROADMAP.md` §"Phase 6: LSP Server" — Goal, success criteria, requirements scope
- `.planning/REQUIREMENTS.md` §"LSP Server" — LSP-01 through LSP-05 requirement statements
- `.planning/phases/05-daemon-core/05-CONTEXT.md` — Daemon lockfile schema (DaemonLockRecord with `port_lsp`), config dir conventions, env vars, DaemonManager patterns

### Port Source / Reference Implementations
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\` — lockfile, launcher, server patterns (ported in Phase 5); no LSP analog exists in Perplexity — Phase 6 is net-new

### Existing Code to Reuse
- `packages/language-services/src/` — all 3 engines (formula, script, automation) with full `Ls*` API
- `packages/extension/src/language/convert.ts` — reference implementation for `Ls*` → framework type conversion (mirror this pattern for LSP protocol)
- `packages/extension/src/mcp/daemon-manager.ts` — DaemonManager class; LSP subprocess spawn follows same pattern as `_spawnDetached`

### Build and Release Patterns
- `scripts/bundle-mcp.mjs` — esbuild bundling pattern for workspace deps; adapt for `lsp-server`
- `.github/workflows/release.yml` — existing release pipeline; add `lsp-server` as a target choice

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/language-services/src/engines/formula/` — diagnostics, completions, hover, signature (all implemented)
- `packages/language-services/src/engines/script/` — diagnostics, completions, hover (implemented)
- `packages/language-services/src/engines/automation/` — diagnostics, completions, hover (implemented)
- `packages/language-services/src/types.ts` — `LsDiagnostic`, `LsCompletionItem`, `LsHover`, `LsSignatureHelp`, `LsSeverity`, `LsCompletionItemKind`
- `packages/extension/src/language/convert.ts` — `Ls*` → VS Code type converter; direct structural analog for the LSP converter

### Established Patterns
- **Conversion layer pattern:** `convert.ts` maps framework-agnostic `Ls*` types to framework-specific types. Phase 6 adds `lsp-convert.ts` that maps `Ls*` → `vscode-languageserver` protocol types
- **Engine dispatch by language ID:** `registration.ts` dispatches to engines by language ID. LSP router uses same map
- **esbuild bundling for publish:** `bundle-mcp.mjs` bundles workspace dep source into a single output. Phase 6 creates `bundle-lsp.mjs` with same approach
- **Subprocess spawn pattern:** `DaemonManager._spawnDetached()` for detached child processes; adapt for LSP subprocess

### Integration Points
- `packages/mcp-server/src/daemon/launcher.js` — add LSP subprocess spawn call during `startDaemon()`
- `packages/mcp-server/src/daemon/lockfile.js` — `port_lsp` field already in schema (null → populated by LSP subprocess)
- `packages/mcp-server/src/daemon/server.js` — daemon shutdown path needs to SIGTERM the LSP subprocess
- `release.yml` — add `lsp-server` target to the workflow `target` input choices

</code_context>

<specifics>
## Specific Ideas

- **Package naming:** `airtable-user-lsp` (unscoped) — user confirmed this mirrors `airtable-user-mcp`
- **Standalone README:** Include in `packages/lsp-server/README.md` — covers `npx airtable-user-lsp --stdio`, editor config examples (Neovim, OpenCode, Zed), TCP attach pattern
- **Signature help scope expansion:** User explicitly chose to include `textDocument/signatureHelp` (formula engine only, script/automation don't have signature implementations)

</specifics>

<deferred>
## Deferred Ideas

- **`workspace/didChangeConfiguration` support** — LSP-ADV-01 in REQUIREMENTS.md future scope
- **LSP code actions** — LSP-ADV-02 in REQUIREMENTS.md future scope
- **Setup Tab LSP config snippets (UI-03)** — Phase 8 scope (Setup tab shows copy-paste LSP config for editors)

</deferred>

---

*Phase: 6-lsp-server*
*Context gathered: 2026-05-14*
