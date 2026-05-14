# Phase 6: LSP Server - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 6-lsp-server
**Areas discussed:** Daemon LSP launch, language-services bundling, stdio-proxy vs. new process when daemon running, LsXxx → LSP protocol conversion

---

## Daemon LSP launch

### Q1: Who starts the TCP LSP server and writes port_lsp?

| Option | Description | Selected |
|--------|-------------|----------|
| Daemon spawns lsp-server subprocess | daemon/server.js spawns `airtable-user-lsp --tcp` as managed subprocess; writes port_lsp after subprocess is ready | ✓ |
| Daemon runs LSP inline | server.js imports language-services directly and binds TCP LSP in-process | |
| LSP server self-registers | airtable-user-lsp detects daemon, binds TCP, updates port_lsp itself; daemon has no LSP knowledge | |

**User's choice:** Daemon spawns lsp-server subprocess
**Notes:** Clean separation — lsp-server package stays fully independent from mcp-server.

---

### Q2: How does the daemon know which port the LSP subprocess bound to?

| Option | Description | Selected |
|--------|-------------|----------|
| LSP process writes port_lsp to lockfile, daemon reads it | LSP server writes port_lsp into daemon.lock once bound; daemon polls until it appears | ✓ |
| Daemon picks the port, passes it via --port flag | Daemon picks free port, spawns `airtable-user-lsp --tcp --port <N>`, writes port_lsp itself | |
| stdout handshake | LSP subprocess prints `READY:{port}` to stdout; daemon reads and parses | |

**User's choice:** LSP process writes port_lsp to lockfile, daemon reads it
**Notes:** Most decoupled — lsp-server owns its own port reporting.

---

### Q3: What happens to the LSP subprocess when the daemon stops?

| Option | Description | Selected |
|--------|-------------|----------|
| Daemon kills it on shutdown (SIGTERM) | Daemon holds child process ref, sends SIGTERM when stopDaemon() called | |
| LSP server detects daemon exit and self-terminates | LSP server polls lockfile; exits when daemon PID changes or lockfile disappears | |
| You decide | Claude picks the simpler approach | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Claude chose: Daemon sends SIGTERM (holds child process ref). Simpler, consistent with daemon lifecycle management.

---

## language-services bundling

### Q1: How does airtable-user-lsp include language-services?

| Option | Description | Selected |
|--------|-------------|----------|
| Bundle at build time | tsup/esbuild bundles language-services into lsp-server dist; self-contained npm package | ✓ |
| Publish language-services to npm | Change from private to public; airtable-user-lsp depends on it externally | |
| Copy source into lsp-server | Physically duplicate engines/ into packages/lsp-server/src/ | |

**User's choice:** Bundle at build time (plus: package name confirmed as `airtable-user-lsp`, unscoped, with own standalone README)
**Notes:** User clarified they want the LSP server to be usable standalone ("alone service") with its own README for users who want it independent of the extension. Name mirrors `airtable-user-mcp`.

---

### Q2: Should language-services itself be published to npm?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep private, bundle into airtable-user-lsp | language-services stays @private; bundled at build time | ✓ |
| Publish language-services to npm | Separate public package; external devs can embed engines | |

**User's choice:** Keep private, bundle into airtable-user-lsp

---

### Q3: Release pipeline versioning

| Option | Description | Selected |
|--------|-------------|----------|
| Independent versioning | Own semver; added to release.yml target choices | ✓ |
| Version-lock to mcp-server | Both packages always publish the same version | |
| You decide | Claude picks | |

**User's choice:** Independent versioning

---

## stdio-proxy vs. new process when daemon running

### Q1: What does `npx airtable-user-lsp --stdio` do when daemon is running with port_lsp set?

| Option | Description | Selected |
|--------|-------------|----------|
| Start fresh in-process LSP server | Always start a new standalone instance; TCP is for direct editor connection | ✓ |
| Proxy stdio → daemon TCP | Bridge stdin/stdout to the TCP LSP port (mirror Phase 5 MCP attach proxy) | |

**User's choice:** Start fresh in-process LSP server
**Notes:** Editors wanting the shared instance configure TCP directly; stdio mode stays simple.

---

### Q2: Should Phase 6 wire the VS Code extension to use the standalone LSP server?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave extension providers unchanged | Extension keeps using language-services directly via existing in-process wrappers | ✓ |
| Extension becomes an LSP client too | Extension spawns airtable-user-lsp --stdio as its LSP client | |

**User's choice:** Leave extension providers unchanged

---

## LsXxx → LSP protocol conversion

### Q1: Where does the conversion layer live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside lsp-server only | New convert.ts in packages/lsp-server/src/; language-services stays clean | ✓ |
| Add LSP helpers to language-services | language-services exports LSP protocol converters; becomes aware of vscode-languageserver | |

**User's choice:** Inside lsp-server only

---

### Q2: How does the LSP server route to the right engine?

| Option | Description | Selected |
|--------|-------------|----------|
| File extension routing | .formula → formula, .ats/.script → script, .ata/.automation → automation | |
| Language ID from client | Use languageId from textDocument/didOpen | |
| Both: language ID first, fall back to extension | Recognized languageId takes priority; extension-based fallback | ✓ |

**User's choice:** Both: language ID first, fall back to extension

---

### Q3: Include signature help in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnostics + completions + hover only (LSP-02 scope) | Strict to requirements; signature help is v3+ future | |
| Include signature help too | formula engine already has complete signature.ts; add while plumbing is fresh | ✓ |

**User's choice:** Include signature help too (scope expansion from LSP-02)

---

## Claude's Discretion

- **LSP subprocess shutdown mechanism:** Daemon sends SIGTERM to child process on stopDaemon() (holds child process ref). Simpler approach consistent with existing lifecycle management.
- **TCP port assignment:** OS assigns port (bind on 0); no hardcoded default.

## Deferred Ideas

- `workspace/didChangeConfiguration` support (LSP-ADV-01 — listed as v3+ future in REQUIREMENTS.md)
- LSP code actions / quick fix (LSP-ADV-02 — v3+ future)
- Setup Tab LSP config snippets (UI-03 — Phase 8 scope)
