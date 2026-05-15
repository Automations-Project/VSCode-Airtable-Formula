---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — Daemon & LSP
status: completed
stopped_at: Phase 8 UI-SPEC approved
last_updated: "2026-05-15T14:37:21.794Z"
last_activity: 2026-05-15 -- Phase 07 marked complete
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 21
  completed_plans: 21
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Airtable-aware language intelligence directly in VS Code — accurate completions, diagnostics, and hover docs for formulas, scripts, and automation scripts
**Current focus:** Phase 07 — tunnel-support

## Current Position

Phase: 07 — COMPLETE
Plan: 9 of 9 — COMPLETE
Status: Phase 07 complete
Last activity: 2026-05-15 -- Phase 07 marked complete

```
Progress: [██████████] 100%
```

## Performance Metrics

**Velocity (v1.0 baseline):**

- Total plans completed (v1.0): 24
- Average duration: —
- Total execution time: —

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | - | - |
| 02 | 8 | - | - |
| 03 | 7 | - | - |
| 04 | 7 | - | - |

**v2.0 phases:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 05 | TBD | - | - |
| 06 | 5 | - | - |
| 07 | TBD | - | - |
| 08 | TBD | - | - |
| 09 | TBD | - | - |

**Recent Trend:**

- Last session: Phase 06 execution (2026-05-15)
- Trend: on track

| Phase 07-tunnel-support P02 | 15min | 2 tasks | 4 files |
| Phase 07-tunnel-support P03 | 20min | 2 tasks | 5 files |
| Phase 07-tunnel-support P04 | 35 | 2 tasks | 5 files |
| Phase 07-tunnel-support P05 | 12min | 2 tasks | 1 file |
| Phase 07-tunnel-support P06 | 15min | 2 tasks | 3 files |
| Phase 07-tunnel-support P07 | 5 | 2 tasks | 2 files |
| Phase 07-tunnel-support P08 | 15min | 2 tasks | 2 files |
| Phase 07-tunnel-support P09 | 18min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v2.0: Daemon over separate-process-per-client — shared Chromium session, faster auth, reduced resource usage; existing stdio clients attach transparently via proxy
- v2.0: `language-services` stays private; only LSP transport binary is public (`airtable-user-lsp`)
- v2.0: No OAuth 2.1 in Airtable daemon — bearer token sufficient for local loopback; OAuth only for public multi-user scenario
- v2.0: Port source is `C:\Users\admin\github-repos\VSCode-Perplexity-MCP` — lockfile.ts, launcher.ts, server.ts, attach.ts are direct port sources
- v2.0: Phase 6 (LSP) and Phase 7 (Tunnel) can execute in parallel after Phase 5 (Daemon Core) completes
- 07-01: /daemon/shutdown excluded from DAEMON_PATHS allowlist test loop — calling it mid-suite kills the server and breaks subsequent fetch calls
- 07-01: Allowlist tests are intentionally RED at Wave 0 — assert 404 for tunnel requests to /daemon/* paths; GREEN when Plan 05 adds allowlist middleware
- [Phase ?]: TunnelState types before DashboardState, following BrowserDownloadState pattern; tunnel? optional field

### Pending Todos

- Run GitHub Actions Release workflow with `target=lsp-server` to publish airtable-user-lsp to npm (human UAT item)
- Run /gsd-plan-phase 8 — plan Phase 8 execution

### Blockers/Concerns

None.

### Known Advisory Issues (non-blocking)

From Phase 3 REVIEW.md (v1.0) — not fixed but documented:

- C-1: `.then()` suppression uses unbounded `text.slice(match.index)` — false negatives possible
- I-1: Property-type members get `($0)` snippet insertText (invalid for non-callable props)
- I-2: Destructured bindings not collected in buildLocalSymbols (best-effort per D-04)
- I-3: Method hover missing `range` field

From Phase 6 REVIEW.md — all criticals fixed (verified 2026-05-15):

- CR-01 ✓ tcp-server.ts: socket.on('error') handler added, ECONNRESET isolated
- CR-02 ✓ release.yml: `both` target now includes lsp-server in all bump/publish/tag steps
- CR-03 ✓ launcher.js: setLspChild/lsp-child shutdown step removed from server.js; single SIGTERM path in finalize()

## Session Continuity

Last session: 2026-05-15T14:37:21.785Z
Stopped at: Phase 8 UI-SPEC approved
Next: Phase 08 (or release of Phase 07 work)
Resume file: .planning/phases/08-setup-tab-ui/08-UI-SPEC.md
