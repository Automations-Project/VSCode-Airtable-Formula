---
phase: 04
slug: automation-engine
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-13
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^1.6.0 |
| **Config file** | `packages/language-services/vitest.config.ts` (existing, `include: ['src/test/**/*.test.ts']`) |
| **Quick run command** | `pnpm -F language-services vitest run` |
| **Full suite command** | `pnpm -F language-services vitest run` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F language-services vitest run`
- **After every plan wave:** Run `pnpm -F language-services vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-W0-registry | W0 | 0 | AUTO-02 | — | N/A | unit | `pnpm -F language-services vitest run -t "AUTOMATION_GLOBALS"` | ❌ W0 | ⬜ pending |
| 04-W0-completions | W0 | 0 | AUTO-02 | — | N/A | unit | `pnpm -F language-services vitest run -t "automationCompletions"` | ❌ W0 | ⬜ pending |
| 04-W0-hover | W0 | 0 | AUTO-03 | — | N/A | unit | `pnpm -F language-services vitest run -t "automationHover"` | ❌ W0 | ⬜ pending |
| 04-W0-diagnostics | W0 | 0 | AUTO-04 | T-03-01 | No catastrophic backtracking; lastIndex reset on module-scope /g patterns | unit | `pnpm -F language-services vitest run -t "automationDiagnostics"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/language-services/src/test/automation/registry.test.ts` — AUTOMATION_GLOBALS has exactly 5 globals; correct method counts per global; cursor/session/remoteFetchAsync absent; createTableAsync/createFieldAsync absent
- [ ] `packages/language-services/src/test/automation/completions.test.ts` — top-level returns all 5 globals; `input.` returns only `config`; `output.` returns only `set`; unknown object returns empty
- [ ] `packages/language-services/src/test/automation/hover.test.ts` — global hover, method hover, unknown returns null
- [ ] `packages/language-services/src/test/automation/diagnostics.test.ts` — flags cursor/session/remoteFetchAsync; flags input.*Async methods; flags output.text/markdown/table/clear/inspect; does NOT flag input.config() or output.set(); excluded inside strings/comments

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grammar file has correct JSON structure | AUTO-01 | VS Code grammar loading requires extension activation; not unit-testable | Open a `.automation` file in VS Code; verify JS syntax highlighting activates |
| `.automation` and `.ata` file icon appears | AUTO-05 | VS Code icon rendering requires UI; not unit-testable | Open file explorer with a `.automation` file; verify custom icon shown |
| Comment toggling works (⌘/) | AUTO-01 | VS Code keybinding; not unit-testable | Open `.automation` file; press comment toggle shortcut; verify `//` inserted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
