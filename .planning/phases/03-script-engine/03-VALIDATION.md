---
phase: 03
slug: script-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^1.6.0 |
| **Config file** | `packages/language-services/vitest.config.ts` (existing, `include: ['src/test/**/*.test.ts']`) |
| **Quick run command** | `pnpm -F language-services vitest run` |
| **Full suite command** | `pnpm -F language-services vitest run` |
| **Estimated runtime** | ~10 seconds |

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
| 03-W0-registry | W0 | 0 | SCRIPT-02 | — | N/A | unit | `pnpm -F language-services vitest run -t "registry"` | ❌ W0 | ⬜ pending |
| 03-W0-completions | W0 | 0 | SCRIPT-02 | — | N/A | unit | `pnpm -F language-services vitest run -t "scriptCompletions"` | ❌ W0 | ⬜ pending |
| 03-W0-hover | W0 | 0 | SCRIPT-03 | — | N/A | unit | `pnpm -F language-services vitest run -t "scriptHover"` | ❌ W0 | ⬜ pending |
| 03-W0-diagnostics | W0 | 0 | SCRIPT-04, SCRIPT-05 | T-03-01, T-03-02 | No catastrophic backtracking; strict allowlist | unit | `pnpm -F language-services vitest run -t "scriptDiagnostics"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/language-services/src/test/script/registry.test.ts` — SCRIPT_GLOBALS has expected global names; methods shape is correct
- [ ] `packages/language-services/src/test/script/completions.test.ts` — top-level returns all globals; `base.` returns base methods; unknown object returns empty
- [ ] `packages/language-services/src/test/script/hover.test.ts` — global hover, method hover, unknown returns null
- [ ] `packages/language-services/src/test/script/diagnostics.test.ts` — missing-await cases (SCRIPT-04); unknown-global cases (SCRIPT-05)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grammar file has correct JSON structure | SCRIPT-01 | VS Code grammar loading requires extension activation; not unit-testable | Open a `.script` file in VS Code; verify JS syntax highlighting activates |
| `.script` and `.ats` file icon appears | SCRIPT-06 | VS Code icon rendering requires UI; not unit-testable | Open file explorer with a `.script` file; verify custom icon shown |
| Comment toggling works (⌘/) | SCRIPT-01 | VS Code keybinding; not unit-testable | Open `.script` file; press comment toggle shortcut; verify `//` inserted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
