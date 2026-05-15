# Phase 9: Documentation - Research

**Researched:** 2026-05-15
**Domain:** Technical writing / documentation update
**Confidence:** HIGH

## Summary

Phase 9 is a pure documentation phase — no code changes, only file edits across four target files: `CHANGELOG.md` (root), `packages/mcp-server/README.md`, root `README.md`, and `CLAUDE.md`. All v2.0 features (daemon, LSP server, tunnel support) are now fully implemented and verified across Phases 5–8. Every fact needed to write the documentation is present in the codebase — this is a content authoring exercise, not a discovery exercise.

The four target files are all outdated relative to v2.0: CHANGELOG has no v2.0 entry, mcp-server README still describes only stdio transport and doesn't mention the daemon or `--no-daemon` flag, root README has no LSP section, and CLAUDE.md has no daemon architecture section. The extension is currently at v2.0.48 and mcp-server at v2.4.5.

**Primary recommendation:** Write one plan per requirement — four plans total (DOCS-01 through DOCS-04) — each editing a single file. Plans are fully parallelizable since the four target files are independent.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CHANGELOG entry | Static file | — | Root-level doc, no tier dependency |
| mcp-server README transport modes | Static file | — | npm-published package doc |
| Root README LSP section | Static file | — | Repo-level user-facing doc |
| CLAUDE.md daemon architecture | Static file | — | Developer-facing internal doc |

## Standard Stack

### Core (no libraries — documentation only)

| File | Current State | What's Missing |
|------|--------------|----------------|
| `CHANGELOG.md` | Has MCP 2.5.0 entry under `[Unreleased]`; no v2.0 section exists | Daemon transport, LSP server, tunnel support entries |
| `packages/mcp-server/README.md` | Describes stdio-only transport; 61-tool count in header (body says 62) | Three transport modes, `--no-daemon` flag, daemon CLI subcommands, `AIRTABLE_NO_DAEMON` env var |
| `README.md` (root) | No LSP section; still describes mono-product | `airtable-user-lsp` npm package, LSP setup for non-VS-Code editors, `airtable-user-lsp` badge |
| `CLAUDE.md` | No daemon section; mcp-server package described as stdio-only; monorepo listed as "four packages" | Daemon architecture section, `packages/mcp-server/src/daemon/` file layout, port source attribution, `packages/lsp-server/` package, five-package monorepo |

## Architecture Patterns

### Recommended Documentation Structure

```
CHANGELOG.md           # root — v2.0 milestone entry (new section above [Unreleased] subentries)
packages/
  mcp-server/
    README.md          # transport modes section + daemon CLI subcommands + --no-daemon
  lsp-server/
    README.md          # already written in Phase 6 — DO NOT TOUCH
README.md              # root — add LSP badge + LSP section
CLAUDE.md              # add daemon architecture section + lsp-server package description
```

### Pattern 1: Keep a Changelog Format

**What:** `CHANGELOG.md` follows the Keep a Changelog convention. New version entries go above `[Unreleased]`.

**When to use:** v2.0 entry should be a top-level `## [2.0.0]` section (or `## [Unreleased] — v2.0 features` if not yet releasing).

The current CHANGELOG has feature subentries nested under `## [Unreleased]`. The v2.0 entry should list three top-level feature groups: Daemon Transport, LSP Server, Tunnel Support.

### Anti-Patterns to Avoid

- **Duplicating the lsp-server README:** `packages/lsp-server/README.md` was written in Phase 6 (06-05-PLAN.md). Do not re-write or modify it — only reference it from root README.
- **Inventing new file locations:** All daemon files already exist. Document what was actually built.
- **Omitting the `--no-daemon` flag:** This is specifically called out in DOCS-02 success criterion and is the key backwards-compat escape hatch users need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Daemon docs | New architecture doc | Document existing `src/daemon/` structure | Already built in Phase 5 |
| LSP setup guide | New LSP-SETUP.md file | Root README section + reference to lsp-server/README.md | Success criterion says "root README" — no separate file needed |
| Transport diagram | ASCII art from scratch | Describe the three modes in prose/table | Text is sufficient for the README format used throughout |

## Phase Requirements

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOCS-01 | CHANGELOG updated with v2.0 daemon + LSP features | Full v2.0 feature set confirmed in Phases 5–8; extension at v2.0.48, mcp-server at v2.4.5 |
| DOCS-02 | `packages/mcp-server/README.md` updated with daemon transport modes and `--no-daemon` flag | Three transport modes confirmed in `src/index.js` attach-proxy block; `AIRTABLE_NO_DAEMON` env var confirmed in `cli.js` help output; daemon CLI subcommands (`daemon start/stop/status`) confirmed in `cli.js` |
| DOCS-03 | Root README updated with LSP setup section | `airtable-user-lsp` npm package at v1.0.0; `packages/lsp-server/README.md` already has Neovim/Zed/OpenCode snippets; root README needs badge + section |
| DOCS-04 | `CLAUDE.md` updated with daemon architecture section and new file locations | `packages/mcp-server/src/daemon/` confirmed: lockfile.js, token.js, server.js, launcher.js, tunnel.js, install-tunnel.js, safe-write.js, cloudflared-pins.json, tunnel-providers/; port source is `C:\Users\admin\github-repos\VSCode-Perplexity-MCP`; `packages/lsp-server/` is a new fifth package |
</phase_requirements>

## DOCS-01 Gap Analysis: CHANGELOG.md

**Current state (lines 1–10):** Has `## [Unreleased]` with MCP 2.5.0 subentry. No v2.0 top-level section.

**What to add:**

```
## [2.0.0] — Daemon & LSP

### New Features

**Daemon transport** — `airtable-user-mcp` now runs as a shared background daemon...
**LSP server** — New `airtable-user-lsp` npm package...
**Tunnel support** — Cloudflare and ngrok tunnel integration...
**Setup tab** — Daemon status block, MCP config snippets, LSP config snippets...
```

Key facts for the CHANGELOG entry [VERIFIED: codebase]:
- Daemon: HTTP MCP via `StreamableHTTPServerTransport`, bearer token auth, SSE events, port written to `~/.airtable-user-mcp/daemon.lock`
- Stdio clients: transparently attach via proxy in `src/index.js`; `--no-daemon` / `AIRTABLE_NO_DAEMON` opt-out
- LSP server: `npx airtable-user-lsp --stdio`, TCP mode for daemon-shared instance, `port_lsp` in lockfile
- Tunnel: Cloudflare (cloudflared) and ngrok providers; 401-burst auto-disable; tunnel URL in Setup tab
- Setup tab: daemon status block, MCP snippets (5 IDEs × HTTP+stdio), LSP snippets (4 IDEs × TCP+stdio)

## DOCS-02 Gap Analysis: packages/mcp-server/README.md

**Current state:** Describes only stdio transport. Shows `npx airtable-user-mcp` as the only invocation. Does not mention daemon, HTTP transport, or `--no-daemon`. Header says "61 Tools" (body says 62 — minor count drift). CLI command section is missing the three new `daemon` subcommands.

**What to add / update [VERIFIED: codebase]:**

**Three transport modes** (confirmed in `src/index.js`):
1. **stdio standalone** — `npx airtable-user-mcp` with `AIRTABLE_NO_DAEMON=1`; runs in-process, no daemon
2. **stdio-proxy to daemon** — Default `npx airtable-user-mcp` when daemon lock exists; attaches stdin/stdout to the HTTP daemon
3. **HTTP (daemon)** — `http://127.0.0.1:{port}/mcp` with bearer token; VS Code extension uses this when daemon is healthy

**`--no-daemon` opt-out** (confirmed in `src/index.js` and `cli.js`):
```bash
AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp
```

**New CLI subcommands** (confirmed in `cli.js` help text):
```
npx airtable-user-mcp daemon start     Start the shared daemon process
npx airtable-user-mcp daemon stop      Stop the running daemon
npx airtable-user-mcp daemon status    Show daemon status (JSON)
```

**New environment variable** (confirmed in `cli.js`):
```
AIRTABLE_NO_DAEMON   Skip daemon; run in-process stdio directly
```

**Lockfile fields** (confirmed in `src/daemon/lockfile.js` typedef):
- `pid`, `uuid`, `port`, `port_lsp`, `bearerToken`, `version`, `startedAt`, `tunnelUrl`
- Location: `~/.airtable-user-mcp/daemon.lock`

## DOCS-03 Gap Analysis: Root README.md

**Current state:** No mention of `airtable-user-lsp`, no LSP section, no badge for the lsp package. Monorepo packages table lists only 4 packages. "What's In This Repo" section says "two products."

**What to add [VERIFIED: codebase]:**

1. **Badge row:** Add `airtable-user-lsp` npm badge alongside the existing badges
2. **LSP section** (after or within the Features section):
   - What it is: language server for `.formula`/`.ats`/`.ata` files, any LSP-capable editor
   - How to use: `npx airtable-user-lsp --stdio` (link to `packages/lsp-server/README.md` for per-editor config)
   - Daemon TCP mode: when daemon is running, `port_lsp` in `~/.airtable-user-mcp/daemon.lock` provides a shared instance
3. **Monorepo table:** Add `packages/lsp-server` row (`airtable-user-lsp` — LSP server)
4. **What's In This Repo:** Update "two products" to "three products" (extension + MCP server + LSP server)

**lsp-server README reference:** `packages/lsp-server/README.md` already contains Neovim, Zed, OpenCode, Helix config snippets. Root README should link to it rather than duplicate the content.

## DOCS-04 Gap Analysis: CLAUDE.md

**Current state:** Describes the monorepo as "four packages". `packages/mcp-server` section describes it as stdio-only. No daemon architecture section. No mention of `packages/lsp-server`.

**What to add [VERIFIED: codebase]:**

**Update monorepo description:** "four packages" → "five packages": add `packages/lsp-server`.

**Add `packages/lsp-server` section:**
- Published as `airtable-user-lsp` on npm
- Entry point: `src/index.ts` (builds to `dist/index.mjs` via tsup)
- Key files: `server.ts`, `tcp-server.ts`, `lockfile-writer.ts`, `lsp-convert.ts`, `router.ts`
- Modes: `--stdio` (standalone) and `--tcp` (spawned by daemon, writes `port_lsp` to lockfile)

**Update `packages/mcp-server` section:**

Add daemon subsection:
```
### packages/mcp-server — Daemon subsystem

New in v2.0: packages/mcp-server/src/daemon/

Port source: C:\Users\admin\github-repos\VSCode-Perplexity-MCP
Files ported (with Airtable-specific adaptations):
  lockfile.ts → lockfile.js   — acquire/release/replace/isStale lockfile lifecycle
  launcher.ts → launcher.js   — ensureDaemon, startDaemon, stopDaemon, spawnDetachedDaemon
  server.ts   → server.js     — Express HTTP server (MCP + health + SSE events + tunnel endpoints)
  attach.ts   → (inline in src/index.js attach-proxy block)

New files (Airtable-specific, not in Perplexity source):
  token.js                    — bearer token generate/read/rotate
  tunnel.js                   — tunnel lifecycle coordinator
  install-tunnel.js           — cloudflared binary download/verify
  safe-write.js               — atomic JSON writes (used by lockfile, token, settings)
  cloudflared-pins.json       — SHA256 pin map for cloudflared binary verification
  index.js                    — barrel export
  tunnel-providers/
    types.js                  — TunnelProvider interface
    cloudflared-quick.js      — Cloudflare Quick Tunnel (ephemeral URL)
    cloudflared-named.js      — Cloudflare Named Tunnel (persistent hostname)
    cloudflared-named-setup.js — wizard for named tunnel credential setup
    ngrok.js                  — ngrok tunnel provider
    index.js                  — provider registry + settings I/O
```

**Update `packages/mcp-server` Key files list:**

Add:
- `src/daemon/` — daemon subsystem (see above)
- `src/safe-write.js` — atomic JSON write helper used by lockfile and token

**Update Build Pipeline section:**

Add: the extension's DaemonManager (`src/mcp/daemon-manager.ts`) reads the lockfile from `~/.airtable-user-mcp/daemon.lock` to check health and expose port/bearerToken to `registration.ts`.

**Note:** The `<!-- PERPLEXITY-MCP-START -->` / `<!-- PERPLEXITY-MCP-END -->` block at the bottom of CLAUDE.md is injected by the Perplexity MCP server configuration — do not remove or modify it.

## Common Pitfalls

### Pitfall 1: Daemon Core (Phase 5) Is Not Yet Complete
**What goes wrong:** ROADMAP.md shows Phase 5 (Daemon Core) as "Not started" (0/7 plans complete), yet Phase 6 (LSP Server), Phase 7 (Tunnel), and Phase 8 (Setup Tab) are all marked complete. STATE.md says "Phase 8 complete — proceed to Phase 9."
**Why it happens:** The roadmap shows Phase 5 plan status as planned but not executed. However, the actual code in `packages/mcp-server/src/daemon/` is fully present (lockfile.js, launcher.js, server.js, token.js, tunnel.js, etc.) and Phase 6–8 depend on it. REQUIREMENTS.md marks DAEMON-* as "Pending" but the implementation exists.
**How to avoid:** Document what is actually in the codebase, not what the requirements tracker says. The daemon code is there and working — Phase 8 was approved by human UAT after 295 tests passed. Write the docs to match the implementation.
**Warning signs:** If documentation contradicts what `ls packages/mcp-server/src/daemon/` shows, the docs are wrong.

### Pitfall 2: LSP Server README Already Exists
**What goes wrong:** Writer creates or overwrites `packages/lsp-server/README.md`.
**Why it happens:** DOCS-03 asks for LSP documentation; writer assumes it needs to be created.
**How to avoid:** `packages/lsp-server/README.md` was created in Phase 6 (06-05-PLAN.md) and already contains Neovim, Zed, OpenCode, and Helix snippets. Only the ROOT README needs a new LSP section.

### Pitfall 3: Confusing the Three Transport Modes
**What goes wrong:** README describes only stdio standalone and misses the proxy vs. HTTP distinction.
**Why it happens:** The three modes have subtly different invocations.
**How to avoid:** Always describe all three modes:
1. `AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp` — stdio standalone (no daemon, in-process)
2. `npx airtable-user-mcp` (daemon lock exists) — stdio-proxy (stdin/stdout bridged to daemon HTTP)
3. VS Code extension with `mcp.useDaemon: true` — direct HTTP to `http://127.0.0.1:{port}/mcp`

### Pitfall 4: Perplexity Source Attribution
**What goes wrong:** CLAUDE.md daemon section omits or gets wrong the source project for the ported files.
**Why it happens:** The port source is a specific file path on the local machine.
**How to avoid:** Attribution confirmed in STATE.md Decisions and PROJECT.md Context:
- Source: `C:\Users\admin\github-repos\VSCode-Perplexity-MCP`
- Files ported: `lockfile.ts`, `launcher.ts`, `server.ts`, `attach.ts` (attach was inlined into `src/index.js`)

### Pitfall 5: Tool Count Drift in mcp-server README
**What goes wrong:** README header still says "61 Tools" but the actual count is 62 (confirmed in CLAUDE.md and coverage table).
**Why it happens:** The 2.5.0 release added the 9th record template tool (`list_record_templates`) moving from 61 to 61... actually CHANGELOG says "52 → 61 tools" but the current README header says "62 tools." Both the root README and CLAUDE.md say 62.
**How to avoid:** Use 62 as the canonical count. The tool table in `packages/mcp-server/README.md` has a header that says "Tools (61)" — this needs updating to 62.

## Code Examples

### Three Transport Modes (for mcp-server README)

**Mode 1 — stdio standalone (no daemon):**
```bash
# Bypass daemon entirely — runs in-process
AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp
# OR (PowerShell):
$env:AIRTABLE_NO_DAEMON=1; npx airtable-user-mcp
```
Source: `src/index.js` — `if (cliArgs.length === 0 && !process.env.AIRTABLE_NO_DAEMON)` [VERIFIED: codebase]

**Mode 2 — stdio-proxy to daemon (default when lock exists):**
```bash
# Default behavior when daemon.lock exists
npx airtable-user-mcp
# stdin/stdout are transparently bridged to the running daemon
```
Source: `src/index.js` attach-proxy block [VERIFIED: codebase]

**Mode 3 — HTTP (daemon direct, for VS Code extension):**
```
POST http://127.0.0.1:{port}/mcp
Authorization: Bearer {token}
```
Source: `src/daemon/server.js` StreamableHTTPServerTransport setup [VERIFIED: codebase]

### Daemon CLI Subcommands (for mcp-server README)

```bash
npx airtable-user-mcp daemon start     # Start the shared daemon process
npx airtable-user-mcp daemon stop      # Stop the running daemon
npx airtable-user-mcp daemon status    # Show daemon status (JSON)
```
Source: `src/cli.js` help text output [VERIFIED: codebase]

### Daemon Lockfile Schema (for CLAUDE.md)

```js
// ~/.airtable-user-mcp/daemon.lock
{
  pid: number,
  uuid: string,
  port: number,          // HTTP MCP server port
  port_lsp: number|null, // LSP TCP port (null if lsp-server not spawned)
  bearerToken: string,
  version: string,
  startedAt: string,     // ISO 8601
  tunnelUrl: string|null // Active tunnel URL, null if no tunnel
}
```
Source: `src/daemon/lockfile.js` `DaemonLockRecord` typedef [VERIFIED: codebase]

### LSP Quick Start (for root README)

```bash
# stdio mode — works standalone, no daemon needed
npx airtable-user-lsp --stdio

# TCP mode — read port from daemon lockfile (multi-editor sharing)
node -e "const f=require('fs').readFileSync(require('os').homedir()+'/.airtable-user-mcp/daemon.lock','utf8'); console.log(JSON.parse(f).port_lsp)"
```
Source: `packages/lsp-server/README.md` [VERIFIED: codebase]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| stdio-only MCP server | Daemon with HTTP transport + stdio-proxy fallback | v2.0 (Phase 5) | Multiple clients share one Chromium session |
| Extension-only LSP (in-process) | Public `airtable-user-lsp` npm package | v2.0 (Phase 6) | Any LSP-capable editor can use Airtable language intelligence |
| No tunnel support | Cloudflare/ngrok tunnel integration | v2.0 (Phase 7) | Remote AI clients can reach local MCP server |
| Manual IDE config snippets | Setup tab with copy-paste snippets | v2.0 (Phase 8) | 5 IDEs × MCP + 4 IDEs × LSP snippets in VS Code webview |

## File Inventory: What Exists vs. What's New

This is a documentation-only phase. No new source files. Only edits to these 4 files:

| File | Action | Estimated Lines |
|------|--------|-----------------|
| `CHANGELOG.md` | ADD v2.0 section above existing `[Unreleased]` subentries | ~40 lines |
| `packages/mcp-server/README.md` | UPDATE transport section, CLI table, env vars table | ~50 lines changed |
| `README.md` | ADD lsp-server badge, LSP section, update monorepo table | ~30 lines added |
| `CLAUDE.md` | ADD daemon architecture section, lsp-server package section, update four→five packages | ~60 lines added |

**Question about new file:** The success criteria say "A user reading the root README can find the LSP setup section" — this means the root README, not a new `LSP-SETUP.md`. No new files should be created. [VERIFIED: success criteria text, DOCS-03]

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this is a pure documentation editing phase with no build, test, or runtime tools required beyond a text editor).

## Validation Architecture

No automated tests exist or are needed for documentation. Validation is human-review-only:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DOCS-01 | CHANGELOG has v2.0 entry with daemon/LSP/tunnel | manual review | — | — |
| DOCS-02 | mcp-server README explains 3 transport modes + `--no-daemon` | manual review | — | — |
| DOCS-03 | Root README has LSP section with setup instructions | manual review | — | — |
| DOCS-04 | CLAUDE.md has daemon architecture section + file layout | manual review | — | — |

**Wave 0 Gaps:** None — no test infrastructure needed for documentation.

**Phase gate:** Human reads each updated document and confirms success criteria before `/gsd-verify-work`.

## Security Domain

Not applicable — documentation phase has no security surface.

## Project Constraints (from CLAUDE.md)

1. **Milestone propagation checklist** (from memory/feedback_milestone_propagation.md): ship docs/UI with code — CHANGELOG, all READMEs, CLAUDE.md. This entire phase IS that checklist item.
2. **Perplexity MCP block in CLAUDE.md:** Lines 190–223 are wrapped in `<!-- PERPLEXITY-MCP-START -->` / `<!-- PERPLEXITY-MCP-END -->` — do not remove or modify.
3. **No new documentation files** unless explicitly required (LSP-SETUP.md is NOT required — root README section is sufficient per DOCS-03 success criterion).
4. **Keep a Changelog format** for CHANGELOG.md.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 5 (Daemon Core) code is fully present even though ROADMAP and REQUIREMENTS show it as "Pending" | DOCS-04 Gap Analysis | If daemon code is incomplete, DOCS-02/DOCS-04 would document non-existent features — low risk, codebase was verified directly |
| A2 | CHANGELOG v2.0 entry should use `## [2.0.0]` version header | DOCS-01 Gap Analysis | If release version will be different (e.g., 2.1.0), header label changes — cosmetic only |

## Open Questions (RESOLVED)

1. **CHANGELOG version header:** Should the v2.0 section use `## [2.0.0]` or `## [Unreleased] — Daemon & LSP`?
   - What we know: Current extension is v2.0.48; mcp-server is v2.4.5. The "v2.0" milestone name doesn't map directly to a semver tag.
   - What's unclear: Whether these docs updates go out with a specific version bump or as an unreleased section.
   - Recommendation: Use `## [Unreleased] — v2.0 Daemon & LSP` as the section header, following the existing pattern in the file where `[Unreleased]` already has subentries. The planner should confirm.
   - **RESOLVED:** Use `## [2.0.0] — Daemon & LSP` as a top-level entry between `[Unreleased]` and `[2.0.11]` per 09-01-PLAN.md must_haves.

2. **mcp-server README tool count in header:** Header says "62 tools" but section heading "Tools (61)" is out of sync.
   - What we know: CLAUDE.md and root README both say 62. CHANGELOG 2.5.0 entry says "52 → 61 tools" but that was the mcp-server 2.5.0 count before the 62nd tool was added.
   - Recommendation: Update "Tools (61)" heading to "Tools (62)" — use 62 as canonical.
   - **RESOLVED:** Update `## Tools (61)` → `## Tools (62)` per 09-02-PLAN.md must_haves.

## Sources

### Primary (HIGH confidence)
- `packages/mcp-server/src/index.js` — attach-proxy block and transport modes [VERIFIED: codebase]
- `packages/mcp-server/src/daemon/lockfile.js` — `DaemonLockRecord` typedef [VERIFIED: codebase]
- `packages/mcp-server/src/daemon/launcher.js` — daemon lifecycle functions [VERIFIED: codebase]
- `packages/mcp-server/src/daemon/server.js` — HTTP server endpoints [VERIFIED: codebase]
- `packages/mcp-server/src/cli.js` — CLI help text with all subcommands [VERIFIED: codebase]
- `packages/lsp-server/README.md` — LSP quickstart and per-editor config [VERIFIED: codebase]
- `packages/lsp-server/package.json` — version 1.0.0, name airtable-user-lsp [VERIFIED: codebase]
- `packages/extension/package.json` — extension version 2.0.48 [VERIFIED: codebase]
- `packages/mcp-server/package.json` — mcp-server version 2.4.5 [VERIFIED: codebase]
- `.planning/STATE.md` — decisions log, port source [VERIFIED: codebase]
- `.planning/PROJECT.md` — context, constraints, decisions [VERIFIED: codebase]
- `CHANGELOG.md` — current state confirmed [VERIFIED: codebase]
- `README.md` — current state confirmed [VERIFIED: codebase]
- `packages/mcp-server/README.md` — current state confirmed [VERIFIED: codebase]
- `CLAUDE.md` — current state confirmed [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- `.planning/phases/08-setup-tab-ui/08-05-SUMMARY.md` — LSP snippet formats per IDE [VERIFIED: codebase]
- `.planning/ROADMAP.md` — Phase 9 success criteria [VERIFIED: codebase]
- `.planning/REQUIREMENTS.md` — DOCS-01 through DOCS-04 [VERIFIED: codebase]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pure documentation, no library decisions needed
- Architecture: HIGH — all four target files confirmed, gap analysis done from live codebase
- Pitfalls: HIGH — all pitfalls derived from actual file contents

**Research date:** 2026-05-15
**Valid until:** Permanent for this phase (documentation targets are static)
