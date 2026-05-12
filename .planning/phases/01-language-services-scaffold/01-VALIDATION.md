---
phase: 1
slug: language-services-scaffold
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^1.6.0 (workspace-hoisted) |
| **Config file** | `packages/language-services/vitest.config.ts` — Wave 0 gap (must be created) |
| **Quick run command** | `pnpm -F language-services build` |
| **Full suite command** | `pnpm build && pnpm -F airtable-formula test` |
| **Estimated runtime** | ~15 seconds (types only, no logic) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F language-services build`
- **After every plan wave:** Run `pnpm build` (full — catches regressions in extension)
- **Before `/gsd-verify-work`:** `pnpm build` green + `pnpm -F airtable-formula test` green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-01 | — | N/A | build smoke | `pnpm -F language-services build` | ❌ Wave 0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-02 | — | N/A | unit | `pnpm -F language-services test` | ❌ Wave 0 | ⬜ pending |
| 1-01-03 | 01 | 1 | INFRA-03 | — | N/A | build smoke | `pnpm -F airtable-formula build` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/language-services/vitest.config.ts` — vitest config for the new package
- [ ] `packages/language-services/src/test/types.test.ts` — verifies LsPosition, LsRange, LsDiagnostic, LsCompletionItem, LsHover importable without vscode (covers INFRA-02)

*Note: vitest itself needs no install — it is hoisted in the workspace. The only Wave 0 gap is the vitest.config.ts and test stub file.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Formula completions, hover, diagnostics, signature help work identically in VS Code after adapter wiring | INFRA-03 regression | Requires running VS Code with extension loaded | Open a .formula file; verify completions appear, hover shows docs, diagnostics fire on errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
