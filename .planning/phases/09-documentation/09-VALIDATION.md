---
phase: 9
slug: documentation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — documentation-only phase |
| **Config file** | none |
| **Quick run command** | `git diff --stat` (verify only target files changed) |
| **Full suite command** | human review of each updated document |
| **Estimated runtime** | ~5 min (human read-through) |

---

## Sampling Rate

- **After every task commit:** Verify only the target file changed via `git diff --stat`
- **After every plan wave:** Human scans the changed file against the success criterion for that requirement
- **Before `/gsd-verify-work`:** Human reads all four documents against Phase 9 success criteria
- **Max feedback latency:** N/A — documentation changes are immediately reviewable

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | DOCS-01 | — | N/A | manual | `grep -n "Unreleased" CHANGELOG.md` | ✅ | ⬜ pending |
| 09-02-01 | 02 | 1 | DOCS-02 | — | N/A | manual | `grep -n "no-daemon\|AIRTABLE_NO_DAEMON" packages/mcp-server/README.md` | ✅ | ⬜ pending |
| 09-03-01 | 03 | 1 | DOCS-03 | — | N/A | manual | `grep -n "airtable-user-lsp" README.md` | ✅ | ⬜ pending |
| 09-04-01 | 04 | 1 | DOCS-04 | — | N/A | manual | `grep -n "daemon" CLAUDE.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

None — no test infrastructure needed for a documentation-only phase. All four target files already exist on disk.

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CHANGELOG has v2.0 entry with daemon/LSP/tunnel/setup-tab details | DOCS-01 | Human judgment required for content correctness | Read the new v2.0 section; confirm daemon transport, LSP server, tunnel support, and Setup tab are mentioned with enough detail for a user to understand what changed |
| mcp-server README explains 3 transport modes and `--no-daemon` | DOCS-02 | Human judgment required for clarity | Read the transport section; confirm all 3 modes are described, `AIRTABLE_NO_DAEMON` is shown, and daemon CLI subcommands appear |
| Root README has LSP section a user can follow | DOCS-03 | Human judgment required for usability | Read the LSP section; confirm `npx airtable-user-lsp --stdio` is shown and a link to per-editor config exists |
| CLAUDE.md has daemon architecture section with file layout and port source | DOCS-04 | Human judgment required for completeness | Read the daemon section; confirm `src/daemon/` file inventory is present, port source is attributed, and lsp-server is listed as the fifth package |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (manual review after each commit)
- [x] Wave 0 covers all MISSING references (none needed)
- [x] No watch-mode flags
- [x] Feedback latency < 5 min (human read-through)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
