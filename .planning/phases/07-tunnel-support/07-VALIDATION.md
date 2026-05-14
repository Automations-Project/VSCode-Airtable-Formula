---
phase: 7
slug: tunnel-support
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no external test runner) |
| **Config file** | none — test scripts use `node --test "test/*.test.js"` |
| **Quick run command** | `pnpm -F airtable-user-mcp test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F airtable-user-mcp test`
- **After every plan wave:** Run `pnpm test` (all packages)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| allowlist | TBD | 1 | TUNNEL-01 | Elevation of privilege | `/daemon/*` returns 404 for tunnel-originated requests | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnel allowlist"` | ❌ Wave 0 | ⬜ pending |
| enable-tunnel | TBD | 1 | TUNNEL-01 | — | N/A | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="enable-tunnel"` | ❌ Wave 0 | ⬜ pending |
| tunnelUrl-lockfile | TBD | 1 | TUNNEL-02 | — | N/A | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnelUrl"` | ❌ Wave 0 | ⬜ pending |
| 401-burst | TBD | 1 | TUNNEL-03 | Brute-force | Auto-disable after 10 failures / 60s | integration | `pnpm -F airtable-user-mcp test --test-name-pattern="401-burst"` | ❌ Wave 0 | ⬜ pending |
| tunnel-settings | TBD | 1 | TUNNEL-04 | — | N/A | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="tunnel settings"` | ❌ Wave 0 | ⬜ pending |
| provider-registry | TBD | 1 | TUNNEL-04 | — | N/A | unit | `pnpm -F airtable-user-mcp test --test-name-pattern="provider registry"` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/mcp-server/test/test-tunnel-allowlist.test.js` — covers TUNNEL-01 (allowlist), ported from Perplexity
- [ ] `packages/mcp-server/test/test-tunnel-lifecycle.test.js` — covers TUNNEL-01 (enable endpoint), TUNNEL-02, TUNNEL-03
- [ ] `packages/mcp-server/test/test-tunnel-settings.test.js` — covers TUNNEL-04 (settings round-trip, provider registry)

*All three test files must be stubs at Wave 0. Implementations fill in as their corresponding feature tasks complete.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| cf-quick tunnel starts and URL appears in Setup tab | TUNNEL-01/02 | Requires live cloudflared binary + internet | Run daemon, click Enable in Setup tab, verify URL appears |
| ngrok tunnel starts with authtoken from SecretStorage | TUNNEL-01/02 | Requires live ngrok account + NAPI binding | Set authtoken in Setup tab, click Enable, verify URL appears |
| cf-named tunnel wizard runs to completion | TUNNEL-01 | Requires cloudflared login + DNS setup | Run daemon install-tunnel cf-named, follow wizard |
| 401-burst warning banner renders in Setup tab | TUNNEL-03 | Browser UI verification | Trigger burst via curl, verify banner appears in webview |
| Tunnel persists across daemon restart | TUNNEL-02 | Requires live tunnel + daemon restart | Start tunnel, restart daemon, verify tunnelUrl still in lockfile |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
