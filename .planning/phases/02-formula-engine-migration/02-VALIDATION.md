---
phase: 2
slug: formula-engine-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^1.6.0 |
| **Config file** | `packages/language-services/vitest.config.ts` |
| **Quick run command** | `pnpm -F @airtable-formula/language-services test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~15 seconds (quick), ~30 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F @airtable-formula/language-services test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-T-registry | — | 1 | FORMULA-01, FORMULA-02 | — | N/A | unit | `pnpm -F @airtable-formula/language-services test` | ❌ W0 | ⬜ pending |
| 02-T-diagnostics | — | 1 | FORMULA-01, FORMULA-03 | — | N/A | unit | `pnpm -F @airtable-formula/language-services test` | ❌ W0 | ⬜ pending |
| 02-T-completions | — | 1 | FORMULA-01, FORMULA-02 | — | N/A | unit | `pnpm -F @airtable-formula/language-services test` | ❌ W0 | ⬜ pending |
| 02-T-hover | — | 1 | FORMULA-01 | — | N/A | unit | `pnpm -F @airtable-formula/language-services test` | ❌ W0 | ⬜ pending |
| 02-T-signature | — | 1 | FORMULA-01 | — | N/A | unit | `pnpm -F @airtable-formula/language-services test` | ❌ W0 | ⬜ pending |
| 02-T-build | — | 2 | FORMULA-01, FORMULA-02 | — | N/A | build | `pnpm build` | — | ⬜ pending |
| 02-T-fx-icon | — | 2 | FORMULA-04, FORMULA-05 | — | N/A | manual | Open .fx and .formula files in VS Code | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/language-services/src/test/formula/registry.test.ts` — FUNCTION_REGISTRY exports, CALLABLE_CONSTANTS (5 entries: NOW/TODAY/BLANK/TRUE/FALSE), helper functions, TRUE()/FALSE() present
- [ ] `packages/language-services/src/test/formula/diagnostics.test.ts` — unknown function detection, bracket/paren balance, smart quotes, common typos, division-by-zero; `IF(x, TRUE, FALSE)` must NOT trigger false-positive
- [ ] `packages/language-services/src/test/formula/completions.test.ts` — function items (IF, AND, OR), constants (TRUE, FALSE, BLANK()), date units present
- [ ] `packages/language-services/src/test/formula/hover.test.ts` — known function returns markdown content, TRUE/FALSE return content, unknown returns null
- [ ] `packages/language-services/src/test/formula/signature.test.ts` — multi-param function returns correct activeParameter, variadic function, no match returns null

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.fx` file opens with `airtable-formula` language ID, completions/hover/diagnostics work | FORMULA-04 | Requires VS Code host; no mock covers file association | Open a `.fx` file in VS Code dev host; confirm language shown as "Airtable Formula" and IntelliSense fires |
| File icon appears for `.formula` and `.fx` in explorer sidebar | FORMULA-05 | VS Code icon rendering not testable in unit tests | Open folder in VS Code dev host; verify custom icon shows next to .formula and .fx files |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
