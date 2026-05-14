---
phase: 6
slug: lsp-server
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^1.6.0 |
| **Config file** | `packages/lsp-server/vitest.config.ts` — Wave 0 installs |
| **Quick run command** | `pnpm -F airtable-user-lsp test` |
| **Full suite command** | `pnpm -F airtable-user-lsp test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F airtable-user-lsp test`
- **After every plan wave:** Run `pnpm -F airtable-user-lsp test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | LSP-02 | — | N/A | unit | `pnpm -F airtable-user-lsp test` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | LSP-02 | — | N/A | unit | `pnpm -F airtable-user-lsp test` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | LSP-01 | — | N/A | unit | `pnpm -F airtable-user-lsp test` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | LSP-02,LSP-03 | — | N/A | unit | `pnpm -F airtable-user-lsp test` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | LSP-04,LSP-05 | — | TCP binds 127.0.0.1 only | unit | `pnpm -F airtable-user-lsp test` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 4 | LSP-04 | — | N/A | unit | (daemon integration, manual) | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/lsp-server/src/test/lsp-convert.test.ts` — all 4 severity mappings + all 25 CompletionItemKind mappings (LSP-02)
- [ ] `packages/lsp-server/src/test/router.test.ts` — all language IDs, all file extensions, unknown returns null (LSP-02)
- [ ] `packages/lsp-server/src/test/tcp-server.test.ts` — port_lsp written after bind, port > 0 (LSP-04, LSP-05)
- [ ] `packages/lsp-server/vitest.config.ts` — test runner configuration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx airtable-user-lsp --stdio` serves completions end-to-end | LSP-03 | Requires real LSP client (editor or lsp-client CLI tool) | Run `npx airtable-user-lsp --stdio` with a CLI LSP test client, open a .formula file, verify completions returned |
| Daemon spawns LSP subprocess and port_lsp appears in lockfile | LSP-04 | Requires running daemon + LSP subprocess | Start daemon, check lockfile for port_lsp > 0 within 30s |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (2026-05-14)
