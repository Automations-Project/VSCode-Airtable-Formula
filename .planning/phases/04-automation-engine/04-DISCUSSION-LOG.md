# Phase 4: Automation Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 4-Automation Engine
**Areas discussed:** Registry architecture, remoteFetchAsync treatment, Unknown-global check, Global surface confidence

---

## Registry Architecture

**Question 1: Registry sharing strategy**

| Option | Description | Selected |
|--------|-------------|----------|
| Fully independent | AUTOMATION_GLOBALS in engines/automation/registry.ts. No imports from engines/script/. Engines are decoupled. | ✓ |
| Shared core module | Extract a shared engines/shared-globals/ module; both engines import from it. | |
| Automation imports script + overrides | Start from SCRIPT_GLOBALS and filter/override. | |

**User's choice:** Fully independent
**Notes:** Decoupling the two engines was the priority. Automation can diverge freely as the Airtable API evolves without risk of inheriting scripting-only globals by accident.

**Question 2: Uncertain method inclusion**

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative — only confirmed methods | Omit methods not explicitly confirmed for automation in the docs. | ✓ |
| Mirror scripting — researcher notes gaps | Start from scripting surface; researcher flags uncertain items. | |

**User's choice:** Conservative — only confirmed methods
**Notes:** Better to show fewer completions than suggest broken APIs.

---

## remoteFetchAsync Treatment

**Question 1: Diagnostic severity**

| Option | Description | Selected |
|--------|-------------|----------|
| Warning | Yellow underline. "remoteFetchAsync is not available in Automation Scripts — use fetch() instead." | ✓ |
| Error | Red underline. More forceful — signals runtime failure. | |

**User's choice:** Warning
**Notes:** Consistent with REQUIREMENTS.md AUTO-04 and the non-blocking philosophy of SCRIPT-04/05.

**Question 2: Function shape**

| Option | Description | Selected |
|--------|-------------|----------|
| automationDiagnostics(text) — single function | One public export; internally calls checkWrongContext(). Same shape as scriptDiagnostics. | ✓ |
| Only a wrong-context checker, no wrapper | Export checkWrongContext() directly. | |

**User's choice:** automationDiagnostics(text) — single function
**Notes:** Consistency with the established formula/script pattern takes priority.

---

## Unknown-Global Check

**Question 1: Add or omit**

| Option | Description | Selected |
|--------|-------------|----------|
| Wrong-context only — no unknown-global check | automationDiagnostics() only runs checkWrongContext(). Minimal scope per AUTO-04. | ✓ |
| Add unknown-global check too | Mirror SCRIPT-05 for automation — flag bare identifiers not in AUTOMATION_GLOBALS. | |

**User's choice:** Wrong-context only
**Notes:** AUTO-04 is the only stated requirement. Adding unknown-global would be scope creep and risks false positives on automation patterns not yet seen.

---

## Global Surface Confidence

**Question 1: Fallback for uncertain methods**

| Option | Description | Selected |
|--------|-------------|----------|
| Omit uncertain methods | Skip if not confirmed. Researcher notes in RESEARCH.md. | ✓ |
| Include with caveat in hover docs | Show completion but hover says "Availability unconfirmed." | |
| Block planning on uncertain methods | User decides each one before planning. | |

**User's choice:** Omit
**Notes:** Conservative policy. User can always add in a future phase once confirmed.

**Question 2: Forbidden-pattern detection granularity**

| Option | Description | Selected |
|--------|-------------|----------|
| Flag both globals AND forbidden method patterns | cursor/session/remoteFetchAsync as globals; input.textAsync() etc. as method patterns. | ✓ |
| Only flag top-level forbidden globals | cursor and session only. Simpler but misses input.textAsync() in automation. | |

**User's choice:** Both globals AND forbidden method patterns
**Notes:** Since automation has input and output globals (just restricted), flagging only the top-level name would miss the most common mistake (calling scripting-only methods on those globals).

---

## Claude's Discretion

- Exact AUTOMATION_GLOBALS method set for `base` and `table` (researcher assembles from docs; D-02 conservative policy applies)
- Exact `input.config()` and `output.set()` signatures and descriptions
- Exact forbidden method list for wrong-context scanner (researcher confirms which `input.*Async()` and `output.*` variants are scripting-only)
- SVG placeholder icon content (same green-letter placeholder pattern as script engine)
- TextMate grammar and language configuration structure

## Deferred Ideas

- Unknown-global check for automation — not in AUTO-01 through AUTO-05; defer if desired
- Signature help for automation — AUTO-ADV-01 in v2
- `input.config()` field-type string-literal completions — SCRIPT-ADV-02 / v2
- Cross-context paste hint — SCRIPT-ADV-04 in v2
- Automation runtime limit analysis — explicitly out of scope
