# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension for Airtable formula editing with MCP server integration and AI skills installer. Published as `airtable-formula` by `Nskha` on the VS Code Marketplace.

## Commands

```bash
pnpm install              # install all workspace packages
pnpm build                # full build: tool-sync check → shared → webview → bundle MCP → extension
pnpm dev                  # webview dev server (Vite, browser preview)
pnpm test                 # tool-sync check + shared + mcp-server + webview + extension tests
pnpm check:tool-sync      # verify mcp-server ↔ extension tool-category mirror is in sync
pnpm package              # create .vsix (build must be run first)
pnpm packx                # full build + version bump + package host-target .vsix
pnpm packx:no-bump        # full build + package host-target .vsix without version bump
pnpm package:targets      # package + verify ALL 8 platform-specific .vsix (release rehearsal)
pnpm assert:vsix          # verify the .node binaries inside artifacts/*.vsix (byte-exact vs pins)
pnpm check:binary-digests # re-derive the native-binary pins from the registry and diff (network)
pnpm record:binary-digests # rewrite scripts/native-binary-digests.json — only after an impit/ngrok bump
```

### Per-package

```bash
pnpm -F shared build             # build shared types (tsup → ESM)
pnpm -F webview build            # build webview (Vite → extension/dist/webview/)
pnpm -F webview dev              # webview dev server
pnpm -F webview test             # vitest (webview)
pnpm -F airtable-user-mcp test   # node --test (mcp-server — 96 unit tests)
pnpm -F airtable-formula build   # build extension (tsup → CJS)
pnpm -F airtable-formula test    # vitest (extension)
```

### Running a single test

- **mcp-server** — `node --test packages/mcp-server/test/test-client.js` (specific file). Append `--test-name-pattern="getView"` to filter by name.
- **webview / extension** — vitest accepts `-t <pattern>`: `pnpm -F webview vitest run -t "merges static metadata"`.

## Architecture

**pnpm monorepo** with five packages:

### packages/shared
Typed message protocol between extension host and webview. Exports `ExtensionMessage` and `WebviewMessage` discriminated unions, plus shared types (`DashboardState`, `IdeStatus`, `IdeId`, `SettingsSnapshot`, `AuthState`, `BrowserInfo`, `BrowserDownloadState`). Both extension and webview import from here.

### packages/webview
React 19 + Vite 6 + Tailwind CSS v4 + Zustand 5 dashboard. Three tabs: Overview, Setup, Settings. Builds directly into `packages/extension/dist/webview/`. Communicates with the extension host via `acquireVsCodeApi().postMessage()` — messages are typed through the shared package.

### packages/mcp-server
The Airtable MCP server itself — ES modules Node app, **published to npm as `airtable-user-mcp`**. Provides **72 tools** across 16 categories (read, record-read, table-write, table-destructive, field-write, field-destructive, view-write, view-destructive, view-section, view-section-destructive, form-write, extension, record-write, record-destructive, sync, daemon) via `@modelcontextprotocol/sdk`. Includes `upload_attachment` (record-write) which writes attachment cells by URL — the general `update_records` tool cannot set attachment cells. The `daemon` category holds exactly one tool, `manage_daemon` (`src/daemon/manage.js`) — the only way the model can see its own runtime: `action=status` reports daemon liveness/holder/transport/uptime/tunnel plus the live session state (`sessionDead`, the last breaker trip including Airtable's captured response body, the browser busy queue), which is what distinguishes *daemon gone* from *session dead* from *browser busy*. `start`/`restart`/`stop`/`tunnel_*`/`token_rotate` administer the process; `stop`/`restart` answer first and exit from a `res.on('finish')` hook in `daemon/server.js` (exiting from the handler deadlocks the SDK's `enableJsonResponse` promise), `stop` writes a `daemon.stopped` sentinel so the extension does not silently respawn, and `token_rotate`/`tunnel_*` are refused for tunnel-origin callers. `daemon` is **`full`-profile only** and defaults off for pre-existing `custom` profiles. Uses `patchright` (Chromium stealth fork) with a persistent profile for browser-based authentication against Airtable's internal API. **Transport:** API calls run through a direct node HTTP transport (`src/http-transport.js`; `fetch` default, `impit` Chrome-TLS-impersonation via `AIRTABLE_HTTP_CLIENT=impit`) — NOT through the browser page; the browser mints/refreshes the session cookie only. Proxy env (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`) is honored by the `fetch` client via undici's `EnvHttpProxyAgent` (`src/proxy.js`; `undici` is an optionalDependency — absent → direct, one warning); the `impit` client is NOT proxy-aware, and TLS-inspecting proxies additionally need `NODE_EXTRA_CA_CERTS` (Node ignores the OS trust store). Auth is cookie-only (no bearer/API key). `AIRTABLE_AUTH_MODE`: `browser` (default) | `byo` (cookie-only, no browser — `AIRTABLE_COOKIE` or `~/.airtable-user-mcp/credentials.json`, csrf auto-scraped; `src/byo-credentials.js`) | `direct-login` (browser-free login via impit + otpauth TOTP replaying the HTTP login flow; `src/direct-login.js`).

Standalone users install via `npx airtable-user-mcp` or `npm i -g airtable-user-mcp`. The CLI exposes subcommands: `login`, `logout`, `status`, `doctor`, `install-browser`, `daemon start/stop/status`. Config and session data live in `~/.airtable-user-mcp/`.

`patchright` and `otpauth` are declared as `optionalDependencies` and lazy-loaded via dynamic `import()` so the server starts without them until browser-based auth is actually needed.

Key files:
- `src/index.js` — MCP server entry point, tool registration
- `src/auth.js` — `AirtableAuth` class, browser launch, CSRF/secretSocketId capture
- `src/client.js` — `AirtableClient`, wraps internal API with caching. `normalizeFieldType()` translates public-API type names to internal names before every request: `multipleSelects` → `multiSelect`, `singleSelect` → `select`. Always use the public names (`singleSelect`, `multipleSelects`) in tool calls — never the internal names. Choices arrays are also normalised here from `[{ name, color }]` to the keyed-object format the internal API requires.
- `src/cache.js` — request cache
- `src/proxy.js` — proxy-env detection + memoized undici dispatcher for the fetch transport, plus `describeFetchError` (unwraps undici's `fetch failed` → real cause + CA/proxy advice)
- `src/login.js` — interactive CLI login
- `src/login-runner.js` — programmatic login spawned by extension host
- `src/health-check.js` — session health check spawned by extension host. Probes up to 3× (the marker arrives with the page bootstrap; one shot reports a slow render as signed out, and the extension answers `expired` by relaunching Chrome). Exports `sessionVerdict()` and only runs `main()` when it IS the process entry point, so tests import it without launching a browser.
- `src/session-user.js` — **who is signed in, and the single login poll loop.** Issue #21: `/v0.3/getUserProperties` carries NO identity at all (its authenticated 200 body is 8 feature-flag booleans), so the old `data.data.userId` read was a phantom field and every poll declared success on the first 2xx — printing `User: undefined` on successful logins too. The id lives in page HTML as `"sessionUserId":"usr…"`. **Present ⇒ signed in; absent proves nothing** (wrong page, incomplete render, renamed key). That asymmetry is why the check is **STRICT** at the login/health probes (a human waits on a green light; a false green IS the bug) and **ADVISORY** in `auth._verifySession` (the cookie was already accepted over direct HTTP, so gating there turns one scrape drift into an outage of every tool). Also owns `POLL_INTERVAL_MS`/`POLL_MAX_ATTEMPTS` (150 × 2s = 5 min) — `login.js` (×2), `login-runner.js` and `manual-login-runner.js` each kept a private copy of this loop and had already drifted (one polled 60s, three polled 300s), which is how #21 survived. `SESSION_PROBE_SOURCE` is a source STRING because playwright ships an evaluate callback's own source to the browser, so a callback referencing an import throws in-page.
- `src/cli.js` — `status` / `doctor` / `login` / `logout` / `install-browser` / `daemon *`. **`doctor` probes the session for real** (it used to report all-green for exactly the broken profile in #21) and prefers the RUNNING daemon over opening its own Chromium — the persistent profile is single-owner, so a second browser collides (Chrome exit 21) and auth's lock recovery would kill the live daemon's browser as a "stale holder". **`status` claims nothing about the session**: it reports the browser profile and daemon lock (the legacy `session.json` it used to stat has not been written for versions, so it printed "not found" on healthy installs), because those files exist whether or not the login completed.
- `src/tool-config.js` — **authoritative** tool → category map + profile gating (`~/.airtable-user-mcp/tools-config.json`). Any change here must also land in `packages/extension/src/mcp/tool-profile.ts` + `packages/extension/package.json` + `packages/webview/src/tabs/Settings.tsx` + `packages/shared/src/types.ts`. `scripts/check-tool-sync.mjs` fails the build if drift is detected.
- `dev-tools/` — reverse-engineering helpers (capture.js, analyze.js, debug-*.js), **gitignored** — kept locally for future reference when Airtable changes their internal API
- `src/daemon/` — daemon subsystem (see daemon subsection below)
- `src/safe-write.js` — atomic JSON write helper (used by lockfile, token, and settings)
- `src/sync/` — base-to-base schema + record sync engine. Plan side: `snapshot` → `idmap` (match-by-name) → `diff` (ordered Plan). Apply side (`apply.js` + `journal.js` + `remap.js`'s `remapRefs`/`toWritableComputedOptions`): executes a saved Plan against the destination — creates tables (deleting Airtable's auto-scaffolding fields), reconciles the primary, creates scalar/link(`foreignKey`)/computed fields with source→dest ref remapping + formula validation, applies non-destructive field updates. A computed-field `updateField` that 422s on a same-pass link change ("requires a link field / link field was changed by a collaborator") is returned as `deferred` (not hard-failed) so the retry-until-stable loop re-applies it after the link update settles. Drift-guarded + resumable (journal; a journal with ≥1 done action bypasses the drift guard with `RESUME_DRIFT_BYPASS`, so resume is reachable past sync's own mutations). Concurrent applies to the same base pair are refused via a per-pair `apply.lock` (`src/sync/apply-lock.js`: pid-liveness stale detection, held until the background records job settles; `mode=reconcile` takes the same lock; error code `APPLY_LOCKED`). Exposed via the `sync_base` tool (`mode: diff | plan | apply | status | reconcile`) in the `sync` category. Out of scope: non-scalar retypes (computed/link/attachment on either side → `RETYPE_DEFERRED`), deletions (M4); scalar retypes are now in scope (see below). `mode=diff` (read-only): comprehensive schema comparison via pure `src/sync/compare.js` — every difference classified as **drift** (sync enforces: table/field/view existence, field type/options/choices, view filters/sorts/groups content, column visibility, colors/cover/frozen/rowHeight, primary, form), **best-effort** (sync applies but doesn't guarantee: field/view/column order, sort/group clause order), or **not-synced** (view sections — now captured by snapshot). Verdicts: `identical` (zero diffs) or `converged` (zero drift; best-effort/not-synced may remain). Persists full diff to `~/.airtable-user-mcp/sync/<src>__<dest>/diff-<id>.json`; returns a token-budgeted DIGEST (verdicts + class counts + per-table rollup + capped driftSample ≤25). Drill in with `detail="<table>"` (params: `detail`, `diffId`, `offset`, `limit`). `mode=plan` now emits a curatable **changeset**: each action carries a stable name-based `changeId` (`<op>|<table>|<target>`), a `class`, and an `apply:true` flag; digest includes a `sample` + `editHint`. New `direction` param (`to-dest` default | `to-source`) targets either base. View sync: `snapshot` also captures collaborative views + live config + **view sections** (not-synced class); `remap.remapViewConfig` rewrites field/choice IDs in view config; `diff` emits `createView`/`applyViewConfig` (convergent canonical compare); `apply` reuses the client view methods (filters/sorts/groups/columns/frozen/colors/cover/calendar/form/rowHeight) with per-type anchor validation + grid fallback. `sync_base mode=apply` syncs collaborative views after fields (personal views skipped; orphan views reported); accepts a `skip:[changeId]` list (and honors `apply:false` on changeset entries) — applies everything except removed changes (journal-safe; skipped dependencies degrade to UNRESOLVABLE_REF). Record sync (M3-records): after schema/view apply, `mode=apply` launches a **background** record sync and returns a `jobId` (= planId) immediately. Two-pass: Pass 1 creates/updates scalar + select cells (computed fields + computed primary never written — this skips computed SOURCE fields AND computed DEST fields: a scalar-source name-matched to a computed dest field like a lookup/rollup would otherwise put that dest field in the row payload and Airtable 403s the whole create with `INVALID_PERMISSIONS`/"cannot be updated"; `buildCreateCells`/`buildUpdateCells` both consult `destComputedFldIds`). Relatedly, a per-request permanent `403 INVALID_PERMISSIONS`/"cannot be updated" is now surfaced by `auth._apiCall` as a distinct non-latching `FIELD_FORBIDDEN` error (does NOT feed the dead-session breaker) so ONE forbidden field fails just its row instead of aborting the whole records job), fills persisted `idmap.records` (rec→rec map); Pass 2 writes linked-record cells (remapped via record map, unresolved targets reported); then attachments (download source → re-upload dest → dedupe scoped to the dest cell `row|field|filename|size`); then restores record-referencing view filters stripped during view sync (per-view failures warn + continue, never block prune). Pass 2 + attachments honor `conflicts=dest-wins` for pre-existing mapped rows; rows created by this plan — tracked resume-durably as `createdDestIds` in the records journal — always receive their links/attachments. Throttle handling = per-request 429 backoff in the auth queue; the record engine ALSO paces every internal per-row POST through a phase-local rate gate (`makeGate(createLimiter({ rps:5 }))` in `records.js`), so per-row creates/updates/link-adds ARE rate-limited (an earlier note claiming they bypass the limiter was wrong). **Session recovery (`auth.js._apiCall`):** in browser-free modes (byo/direct-login) a `403` that persists past one throttle backoff now escalates to session re-auth (re-mints cookie+CSRF via `_recoverSession`) instead of being treated as pure throttle — this is the auth-expiry-as-403 case that previously killed long record jobs (all rows `SESSION_INVALID`); `429`/`503` stay throttle in all modes, browser mode keeps 403=throttle, and the status that tripped the dead-session breaker is retrievable via `auth.getLastTrip()`. **Records session-death abort:** the records job (`applyRecords`) re-mints/probes the session at phase start (`resetSessionHealth()` then `ensureSessionHealthy()`) and ABORTS the whole job on a mid-run session death (`isSessionDead()` or a `SESSION_INVALID` throw) — and on a general all-writes-failed run (`RECORDS_ALL_FAILED`, i.e. `failed>0 && created==0 && updated==0 && skipped==0`, which also catches non-session run-wide hangs) — by setting `result.aborted` → records-job `phase=failed` with a resume hint, skipping `reapplyViewFilters`+`pruneRecords` (a dead/partial session must NEVER prune) instead of walking every row into a warning and reporting a false `done`; resumable (records journal, per-chunk persist of ~50 creates); continue-on-failure otherwise (non-session per-record errors are warnings and the run continues). Truncation safety: a table whose snapshot hits the 1000-row cap on either base is added to `truncatedTables` by `collectTruncatedTableNames` and skipped by `pruneRecords` under mirror (`RECORDS_TRUNCATED_PRUNE_SKIPPED`) so a record beyond the snapshot window is never deleted as a false orphan; each truncated table also emits `RECORDS_TRUNCATED` on the result; >1000-row read pagination remains a capture-gated follow-up. `mode=plan` and `mode=apply` themselves now run as BACKGROUND jobs (`src/sync/job-status.js` `sync-job-<planId>.json`, phases `planning→schema→records→done|failed`, pid-liveness) — they return `{jobId,status:running}` immediately (a synchronous plan/apply on a view-heavy base is minutes-long and trips the MCP client's response window → "Connection closed" despite completing server-side); `planJob`/`applyJob`/`syncStatus` in `src/sync/index.js`, `plan()`/`apply()` stay callable as sync engine fns. `mode=diff`/`reconcile` stay synchronous. `mode=status` polls a background job by planId — returns phase + running/done/failed + live records-mapped count + planDigest/schemaResult/recordsResult (FIELD_MAP_INVALID/APPLY_LOCKED now surface here as phase=failed; a records-job abort — session death or `RECORDS_ALL_FAILED` — surfaces as phase=failed with the partial counts + abort reason). To keep the response inside the MCP window, `mode=status` returns `planDigest` as **human-only by default** (`{ human, machineOmitted:true }`) — the full changeset (`planDigest.machine`, ~145 view-config actions on a view-heavy base) is omitted and only returned when `verbose:true` is passed (it always persists on disk in `plan-<id>.json`). Likewise the `schemaResult.warnings`/`recordsResult.warnings` arrays (thousands of entries on a view-heavy apply — the cause of the 608K-char truncated blob) are **capped to the first 25** by default via `leanSyncResult`, with `warningCount`+`warningsOmitted` pointers; the full set stays in the on-disk job file and returns inline with `verbose:true`. The status response also orders `summary`/`schemaResult`/`recordsResult` before `planDigest` so any residual truncation cuts the least-useful field last. A records-job abort reason now embeds Airtable's actual response BODY at the trip (`getLastTrip().body`, captured by `auth._captureTripBody`) — its 4xx JSON states the REAL reason (permission / CSRF / rate / forbidden action) that a bare `403` status hides. `mode=reconcile` **prunes** dead record-map entries (existence-prune, truncation-guarded — skipped with a warning when any dest table hits the 1000-row snapshot cap, so live mappings beyond the cap are never dropped; per-table natural-key re-match now matches by key value — see natural-key matching below; reconcile does NOT de-duplicate records). State lives under `~/.airtable-user-mcp/sync/<src>__<dest>/` (idmap.json, journals, records-job-<planId>.json, diff-<id>.json). New modules: `cells.js` (per-type cell coercion), `ratelimit.js` (token bucket + retry), `records.js` (Pass 1/2 + attachments + reapplyViewFilters + applyRecords orchestrator + reconcile), `compare.js` (pure classified compare, no I/O); plus `snapshot.snapshotSchemaOnly`/`snapshotTableRecords`, `idmap.records`, and a records-journal in `journal.js`. Reconciliation policy (`src/sync/policy.js`): `mode=apply` accepts a `policy` param (`mirror` | `overlay` | `preserve`, default `overlay`) that controls two axes — **extras** (what to do with dest-only records) and **conflicts** (whose value wins when both bases have the record). Presets: `mirror` = {remove, source-wins} (make dest identical to source); `overlay` = {keep, source-wins} (today's default: keep dest-only rows, source updates win); `preserve` = {keep, dest-wins} (keep dest-only rows and never overwrite dest edits). `policyOverrides` (`{ [tableName]: preset }`) overrides the global preset per table. `confirmDeletions` (boolean, default false) is a safety gate for `mirror`: without it, `pruneRecords` reports a `DELETION_GATED` warning with the would-delete count but deletes nothing; set `confirmDeletions:true` to actually delete. Separately, `createTable` unconditionally clears the ~3 blank scaffolding rows it seeds (best-effort; `SCAFFOLDING_ROWS_KEPT` warning if the deletion attempt fails); `pruneRecords` under `mirror`+`confirmDeletions` additionally removes any leftover dest-only blank rows as part of the ordinary orphan prune. Attachment deletion under mirror is a deferred follow-up. Schema-orphan deletion (`pruneSchema`) runs synchronously in `mode=apply` AFTER `applyPlan`, consuming `plan.orphans` (`{kind:'table'|'field'|'view', destId, name, tableName}`). Order: (1) views — deleted first (no dependents); (2) fields — batch `deleteFields` WITHOUT force (so a matched field is never cascade-deleted), retry-until-stable loop resolves orphan→orphan deps; a field still blocked after no progress is kept + `SCHEMA_DELETE_BLOCKED`; (3) tables — deleted last (after their content). Gating: dest-only fields + views require `confirmDeletions:true` (same flag as `pruneRecords`); dest-only tables require the new `confirmTableDeletions:true` — `confirmDeletions` alone never drops a whole table. Without each gate the operation is a dry-count: `DELETION_GATED` for fields/views, `TABLE_DELETION_GATED` for tables. Applied counts: `schemaDeleted` (fields+views) + `tablesDeleted`. Per-table `policyOverrides` apply; `overlay`/`preserve` → no schema deletion. Continue-on-failure (`SCHEMA_DELETE_FAILED`). Module: `src/sync/prune-schema.js`. View-section orphans (dest-only sidebar sections in a matched table) are now deleted by `pruneSchema` as **step 0** (before views, so Airtable auto-promotes their contained views to top-level before view orphan deletion); gated by `confirmDeletions` (same flag as fields/views); `deleteViewSection` is the client method used. Attachment-strip under mirror remains a deferred follow-up. Scalar field retypes (`mode=apply`): a matched dest field whose scalar type diverges from source is retyped via `updateFieldConfig`, gated by the new `confirmRetypes` param (boolean, default false); without it the field is kept and a `RETYPE_GATED` warning is emitted (count surfaced in the result). Non-scalar retypes (either side is computed/link/attachment) stay `RETYPE_DEFERRED`. Select retypes converge their choice map on re-sync exactly like created selects (`mergeChoices`). Continue-on-failure: per-field retype errors emit `RETYPE_FAILED` and do not abort apply. Primary-field retypes remain the separate `reconcilePrimary` path. This closes the last schema-drift category sync can fix; records data migration remains `pruneRecords`/Pass 1. Custom field mappings: `fieldMappings` (`{ [tableName]: { sourceFieldName: destFieldName } }`) injects a source field's value into a different writable scalar dest field during record sync — useful when the source is computed (e.g., `autoNumber`/formula) and you want its value preserved in a writable dest field (classic use: inject source autoNumber `Code` into dest text field `InjectID` so a dest formula can reconstruct original identity). Fail-fast pre-flight validation in `apply` (and dry-run in `plan`/`diff` via `fieldMappingErrors` in the machine output) with codes: `FIELD_MAP_TABLE_MISSING`, `FIELD_MAP_SOURCE_MISSING`, `FIELD_MAP_TARGET_MISSING`, `FIELD_MAP_TARGET_COMPUTED` (dest must be writable scalar), `FIELD_MAP_TYPE_INCOMPATIBLE` (array-typed source/dest not supported), `FIELD_MAP_COLLISION` (two sources map to same dest); an invalid mapping aborts `apply` synchronously (`FIELD_MAP_INVALID` error code). Natural-key record matching: `naturalKeys` (`{ [tableName]: fieldName }`) matches dest↔source records by the key field's **value** (field ID resolved per-base by name), growing `idmap.records`. Add-only + ambiguity-safe — never removes/overwrites an existing mapping, never claims an already-mapped dest; ambiguous/duplicate key values are skipped with `NATURAL_KEY_AMBIGUOUS`; a missing key field emits `NATURAL_KEY_FIELD_MISSING`. Runs in `mode=reconcile` (after the existence-prune, snapshots source records + calls matcher, then saves idmap) AND as an automatic pre-pass in `mode=apply` **before Pass 1 and prune** — so records `mirror` no longer deletes real-but-unmapped dest records as false orphans, and re-syncs don't duplicate them. The key field must be **stable across bases** (autoNumber renumbers → bad key; name/email/injected `InjectID` → good key). Single-field keys only; composite keys and value normalization are deferred. Returns a `matched` count in the result. Hardening pass (2026-07, 25 commits, ~100 regression tests — full audit + fixes): `plan`/`diff` preserve persisted `idmap.records`/`idmap.attachments` verbatim (schema maps refresh; record identity is never wiped). Apply journals by **disposition** — only genuinely applied actions are `done`; gated (`RETYPE_GATED`) and deferred (`UNRESOLVABLE_REF`, link target table not yet mapped) actions stay retryable, and deferred creates/updates retry within the same run until no progress, so forward-referenced computed/link fields converge in one apply. Reverse-link adoption is exact (idmap-based `symmetricColumnId` match — cross-run safe; two links between the same table pair never cross-wire); link `updateField`s ship writable options only (`{foreignTableId, relationship}`, remapped). `reconcilePrimary` gates pre-existing-primary retypes behind `confirmRetypes` (an applied rename is journaled as an `<idx>:rename` sub-action so the same-plan follow-up resumes past the drift guard) and writes computed primaries via `toWritableComputedOptions`. Diff/compare: matched link fields compare canonically (no phantom `updateField`), writable display-format options on computed fields are compared, collaborator `usr` ids pass through view-filter remap verbatim (user ids are Airtable-global), views match by **(name, type)** — apply adopts by the same key — and the dest primary is never emitted as a deletable orphan. Cells: internal type spellings (`multipleAttachment`, `multiCollaborator`, …) are recognized in `cells.js` + `policy.js`; ALL array-shaped cells are deferred on the Pass-1 update path; cells cleared on source propagate as explicit nulls under `conflicts=source-wins` (only idmap-mapped fields whose source AND dest are non-computed); empty update rows are skipped. Records mirror propagates source-side record deletions (a mapping whose source row is gone stops protecting its dest row — truncation-guarded, gated by `confirmDeletions`, stale mapping dropped); truncation detection counts actually-fetched rows (immune to `mirrorFoldedLinks` inflation). New select/multiSelect fields register their real choice map at creation, so first-run records write select cells. Record snapshots avoid filtered views (prefer an unfiltered collaborative view; else `SNAPSHOT_VIEW_FILTERED` and the table is treated as truncated — no prune). Background job files carry the worker `pid`; `mode=status` reports a `running` job with a dead pid as failed with resume advice. Remaining capture-gated deferrals: unfiltered/paginated table reads (`readQueries` non-view source), and array-cell VALUE updates on existing records (multiSelect/collaborator edits after creation).

#### packages/mcp-server — Daemon subsystem

New in v2.0: `packages/mcp-server/src/daemon/`

**Port source:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP`

Files ported (with Airtable-specific adaptations):
- `lockfile.ts` → `lockfile.js` — acquire/release/replace/isStale lockfile lifecycle
- `launcher.ts` → `launcher.js` — `ensureDaemon`, `startDaemon`, `stopDaemon`, `spawnDetachedDaemon`
- `server.ts` → `server.js` — Express HTTP server (MCP + health + SSE events + tunnel endpoints)
- `attach.ts` → inlined in `src/index.js` attach-proxy block

New files (Airtable-specific, not in Perplexity source):
- `token.js` — bearer token generate/read/rotate
- `tunnel.js` — tunnel lifecycle coordinator
- `install-tunnel.js` — cloudflared binary download/verify
- `safe-write.js` — atomic JSON writes (used by lockfile, token, settings)
- `cloudflared-pins.json` — SHA256 pin map for cloudflared binary verification
- `manage.js` — `manageDaemon(params, deps)`, the `manage_daemon` tool's 7 actions; every side effect is injected via `deps` so it is testable with no daemon and no Chromium
- `exit-intent.js` — single-slot store for a staged stop/restart; `daemon/server.js` consumes it from `res.on('finish')` so the response is flushed before the process goes away
- `stop-sentinel.js` — `<configDir>/daemon.stopped`, written only by a stop that actually reached the exit. Readers must ignore it whenever a healthy lockfile exists; `startDaemon()` clears it, so a stale sentinel survives only until the next intentional start
- `index.js` — barrel export
- `tunnel-providers/`
  - `types.js` — TunnelProvider interface
  - `cloudflared-quick.js` — Cloudflare Quick Tunnel (ephemeral URL)
  - `cloudflared-named.js` — Cloudflare Named Tunnel (persistent hostname); forces `protocol: http2` and waits for cloudflared's HA connections to settle before reporting the tunnel ready (avoids startup 502s)
  - `cloudflared-named-setup.js` — wizard for named tunnel credential setup
  - `ngrok.js` — ngrok tunnel provider
  - `index.js` — provider registry + settings I/O

**Lockfile schema** (`~/.airtable-user-mcp/daemon.lock`):

```js
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

**Transport modes:**
1. `AIRTABLE_NO_DAEMON=1 npx airtable-user-mcp` — stdio standalone (in-process, no daemon)
2. `npx airtable-user-mcp` when daemon lock exists — stdio-proxy (stdin/stdout bridged to HTTP daemon)
3. VS Code extension via `DaemonManager` — direct HTTP to `http://127.0.0.1:{port}/mcp` with bearer token

**Daemon auto-start (2026-07-30).** `registration.ts` calls `ensureDaemon({ implicit: true, timeoutMs: 15_000 })` instead of the passive `getDaemonStatus()` it used before, so an **MCP tool call can bring the daemon up**. Previously, unless the user had opened the dashboard or run a formula command, every session fell through to the stdio branch — and that branch spawns an in-process server **per VS Code window**, each with its own Chromium on the single-owner `.chrome-profile`. Starting the daemon here therefore makes profile collisions (Chrome exit 21, historically mis-reported as "session dead") **less** likely, not more. `implicit: true` is load-bearing: it preserves the `_userStopped` latch (a deliberate Stop must survive the next tool call) and the `SPAWN_SUPPRESS_MS` window that closed the runaway-spawn OOM. **Never pass `implicit: false` from there.** On failure it falls through to stdio rather than returning `[]`, so MCP still works — see the `ponytail:` comment there for the narrow window this leaves. Consequently the credential-injection branch now gates on *"is a daemon actually serving us"* (`daemon !== null`), **not** on the `useDaemon` setting: those were the same thing until the daemon could fail to start, and with the setting-based test a `byo`/`direct-login` user whose daemon failed got a stdio server with no credentials and no browser — `*_CREDENTIALS_MISSING` on every call.

**Cross-client config override — deliberate, and announced once.** Because a `daemon.lock` now exists on essentially every VS Code session, a standalone client (Claude Desktop / Cursor / Cline / Amp) that finds one **attach-proxies into VS Code's daemon** and every tool call runs under *that* process's env. The attach path (`index.js:16-28`) reads only `AIRTABLE_NO_DAEMON` and `AIRTABLE_USER_MCP_HOME` from the client's own environment; its configured `AIRTABLE_AUTH_MODE`, `AIRTABLE_HTTP_CLIENT`, browser channel and idle-park tuning are void. **We attach anyway on purpose** — refusing sends the process down the in-process path and puts a *second* Chromium on the shared profile, which is the exit-21 crash class. The remedy is visibility, not refusal: the attach prologue writes ONE stderr line naming each differing key (only keys the daemon actually returned, so an older daemon reporting `undefined` is not a false mismatch), and `getHealth()` / `/daemon/health` / `manage_daemon action=status` all expose `authMode`, `httpClient` and `configDir`. Opt out with `AIRTABLE_NO_DAEMON=1`, or stop the daemon and let it restart from your own env.

### packages/lsp-server
Airtable language server — **published to npm as `airtable-user-lsp`**. Provides diagnostics, completions, hover, and signature help for Airtable formula, script, and automation files in any LSP-capable editor.

Entry point: `src/index.ts` (builds to `dist/index.mjs` via tsup).

Modes:
- `--stdio` — standalone LSP process (one per editor session)
- `--tcp` — spawned by daemon; multiple editors share one instance; port written to `port_lsp` in lockfile

Key files:
- `src/server.ts` — LSP server init, capability registration
- `src/tcp-server.ts` — TCP listener for daemon-spawned mode
- `src/lockfile-writer.ts` — writes `port_lsp` into `~/.airtable-user-mcp/daemon.lock`
- `src/lsp-convert.ts` — converts internal diagnostics/completions to LSP protocol types
- `src/router.ts` — routes requests to formula / script / automation engines

### View config reads — two-call pattern

`AirtableClient.getView()` makes **two** API calls:
1. `application/{appId}/read` (cached) — resolves `tableId` from `viewId` and returns static metadata (name, type, description).
2. `table/{tableId}/readData?includeDataForViewIds=[viewId]` (un-cached) — returns live state: `filters`, `lastSortsApplied` (exposed as `sorts`), `groupLevels`, `columnOrder` (rich `[{columnId, visibility, width?}]`), `frozenColumnCount`, `colorConfig`, `metadata`.

The `application/read` endpoint alone does **not** carry filter/sort/group state — it's why `update_view_filters`, `apply_view_sorts`, and `update_view_group_levels` all accept `operation: 'replace' | 'append'`. Append mode calls `getView()` internally to merge with existing config.

### packages/extension
VS Code extension host. Entry point: `src/extension.ts`.

Key subsystems:
- **Formula language features** — diagnostics (`diagnostics.ts`), completions (`completions.ts`), hover (`hover.ts`), signature help (`signature.ts`), code actions (`codeActions.ts`). Function metadata lives in `functions.ts`.
- **Webview host** — `src/webview/DashboardProvider.ts` implements `WebviewViewProvider`, manages state flow to the React dashboard.
- **MCP server** — `src/mcp/registration.ts` registers the bundled MCP server via VS Code's `McpServerDefinitionProvider` API. The MCP server source lives in the sibling `packages/mcp-server` workspace package and is bundled via `scripts/bundle-mcp.mjs` (esbuild) into `dist/mcp/index.mjs`.
- **Auth manager** — `src/mcp/auth-manager.ts` manages credential storage (VS Code SecretStorage), session health checks, programmatic login, auto-refresh timer, and browser detection/download orchestration.
- **Browser download** — `src/mcp/browser-download.ts` spawns `patchright-core install chromium` on demand for users without system Chrome/Edge/Chromium.
- **Auto-config** — `src/auto-config/` detects installed IDEs (Cursor, Windsurf, Claude Desktop/Code, Cline, Amp) and writes MCP server entries to their config files.
- **Skills installer** — `src/skills/` installs AI-specific rules/skills/workflows into IDE config directories.
- **Formatter** — `src/commands/` provides beautify and minify commands using vendored engines in `src/vendor/`.

### Extension ↔ Webview data flow
Extension computes `DashboardState` → sends `state:update` message → webview Zustand store updates → React re-renders. User actions in webview send typed `WebviewMessage` back → extension handles in `DashboardProvider`.

## Build Pipeline

Build order matters (drift check first, then shared → webview → MCP → extension):
1. `scripts/check-tool-sync.mjs` — verifies the extension's tool-category mirror matches `mcp-server/src/tool-config.js` and that profile counts in extension/package.json `enumDescriptions` are accurate. Build fails fast on drift.
2. `tsup` builds shared types to ESM
3. `vite build` compiles React webview into `packages/extension/dist/webview/`
4. `scripts/bundle-mcp.mjs` uses esbuild to bundle the MCP server (from `packages/mcp-server/src/`) into `packages/extension/dist/mcp/{index,login-runner,health-check,manual-login-runner}.mjs`. Patchright and otpauth are kept external and vendored separately. It also emits `dist/mcp/version.json` containing the bundled server version, package name, build timestamp, and git SHA — the extension dashboard reads this at runtime to display the active MCP server version.
5. `scripts/prepare-package-deps.mjs` copies `patchright`, `patchright-core`, `otpauth`, `impit` and `@ngrok/ngrok` from the workspace's hoisted `node_modules/` into `packages/extension/dist/node_modules/` using `dereference: true` to follow pnpm symlinks (invoked during `package:vsix`). **It is per-target**: `--target=<vsce target>` (default = host) selects which `impit-*` / `@ngrok/ngrok-*` native package is vendored, so it must be re-run before each `vsce package --target`.
6. `tsup` builds extension to CJS, then copies `src/vendor/` to `dist/vendor/`

### Platform-specific VSIX packaging

`impit` and `@ngrok/ngrok` keep their compiled `.node` binary in **separate per-platform npm packages** (their own `optionalDependencies`), and only the build host's variant is ever installed — so one untargeted VSIX cannot work everywhere. The extension is therefore published as **one VSIX per target**.

- `scripts/vsix-targets.mjs` — **single source of truth**: 8 targets (`win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`) → their exact platform packages, plus expected `os`/`cpu`/`libc`. Versions are **never hardcoded**; they are read from `pnpm-lock.yaml` together with the integrity hash. `linux-armhf` is an explicit, documented exclusion (`EXCLUDED_TARGETS`) — impit ships no 32-bit-ARM build. Adding a target = adding one row here.
- `scripts/vendor-platform-packages.mjs` — fetches a foreign target's platform packages as plain npm tarballs, verifies SHA-512 against `pnpm-lock.yaml`, unpacks into `.cache/vsix-platform-packages/`. The host's own packages are reused from `node_modules` when the version matches. Cached copies are **re-validated against the pinned per-binary digests on every reuse** — the `.vendored.json` marker sits inside the directory it vouches for, so it is never treated as evidence. No native runners, no `supportedArchitectures`.
- `scripts/record-native-binary-digests.mjs` — regenerates `scripts/native-binary-digests.json`, the committed SHA-256 of every `.node` each platform package ships. Downloads each tarball and verifies its SHA-512 against `pnpm-lock.yaml` **before** hashing anything inside, so expected values derive from the lockfile and never from an artifact under test. Run it only when `impit` or `@ngrok/ngrok` changes version; `--check` re-derives and diffs without writing. A stale or missing pin **fails packaging and assertion closed**, never degrades to a weaker check.
- `scripts/safe-symlinks.mjs` — `assertSafeSymlinks`, applied before every `cpSync(…, {dereference:true})` on both the workspace path (`prepare-package-deps.mjs`) and the foreign-tarball path (`vendor-platform-packages.mjs`); `tar` will happily create a symlink pointing at `~/.ssh`.
- `scripts/package-targets.mjs` — `pnpm package:targets`. Per target: vendor → `vsce package --target` → assert. Aborts on the first failure. `--targets=host` builds only this machine's (what `pnpm packx` and `pnpm package` do).
- `scripts/assert-vsix-binaries.mjs` — `pnpm assert:vsix`. Reads the `.vsix` zip directly and asserts the target's expected `.node` files are **present** at the lockfile-pinned version **and byte-identical to the pinned digest**, **and** that no other platform's are. Also rejects an untargeted VSIX and a `--dir` set missing any target.

**Verify bytes, not labels.** Package name, `package.json` `os`/`cpu`/`version` and filename are labels the artifact carries about itself, and a magic number proves only PE vs ELF vs Mach-O — the OS. None of them can tell an x64 build from an ARM64 one on the same OS, or a glibc build from a musl one; those swaps passed every check until per-binary digests were added. The magic check remains as a fast readable diagnosis, but the exact SHA-256 is what makes the assertion sound.

**Terminology.** These are **eight target artifact packaging/assertion smokes** — eight `.vsix` files are built and their contents verified. They are **not** runtime smokes of eight native bindings: a single host can only `require()` the binding built for itself, so **only the host target's binding can receive a genuine runtime smoke**. Do not describe the matrix as runtime-testing all eight.

**No untargeted VSIX may be published** — it is only ever correct on the machine that built it. The standalone npm package `airtable-user-mcp` stays **universal** and must not gain per-platform publishing; npm resolves the right optional dependency on the user's machine.

**DaemonManager integration:** The extension's `src/mcp/daemon-manager.ts` reads `~/.airtable-user-mcp/daemon.lock` at startup and on file-watch events to check daemon health and expose `port` and `bearerToken` to `src/mcp/registration.ts` for direct HTTP transport.

The MCP server source lives in `packages/mcp-server/` and is resolved via `"airtable-user-mcp": "workspace:*"` in both root and extension devDependencies. The shared `pnpm-workspace.yaml` uses `packages/*` glob so the package is picked up automatically.

## Release Flow

Single unified workflow (`release.yml`) triggered manually via GitHub Actions UI:

1. **Go to:** Actions → Release → Run workflow
2. **Choose:** `target` (extension / mcp-server / both), `bump` (patch / minor / major), `dry_run`
3. **Workflow:** computes next version → builds → tests → publishes → commits bump → tags → creates GitHub Release

- **Extension** publishes to VS Code Marketplace + Open VSX — **8 platform-specific VSIXes, no untargeted fallback** (see "Platform-specific VSIX packaging" above). Every artifact must pass `assert-vsix-binaries.mjs` before any publish step runs.
- **MCP server** publishes to npm with provenance — **universal, single artifact** (not per-platform)
- Version numbers are independent. The extension bundles whatever MCP server version was in `packages/mcp-server/` at build time.
- Version bump is only committed **after** successful publish — no stale tags.

## Language

The extension registers language ID `airtable-formula` for file extensions `.formula`, `.min.formula`, `.ultra-min.formula`. TextMate grammar is at `src/syntaxes/airtable-formula.tmLanguage.json`.

## Dev-Tools: API Capture & Recording

Local-only (gitignored) tools for reverse-engineering Airtable's internal API. Used when we need to discover new endpoints or debug payload changes.

### Capture scripts

```bash
pnpm capture                # GUI Chrome, capture all v0.3 traffic to files
pnpm capture:mutations      # same, but only POST/PATCH/PUT/DELETE
pnpm capture:cdp            # GUI Chrome + CDP port 9222 (Chrome DevTools MCP can attach)
pnpm capture:cdp:mutations  # CDP + mutations only
```

All capture sessions save two files to `packages/mcp-server/dev-tools/captures/`:
- `<timestamp>.json` — full structured capture (requests, responses, mutations, WebSockets)
- `<timestamp>.summary.txt` — human-readable mutation chronicle

### Reading captures

When the user says they recorded something, check `packages/mcp-server/dev-tools/captures/` for the latest `.json` and `.summary.txt` files. The JSON contains:
- `mutations[]` — POST/PUT/PATCH/DELETE requests with decoded payloads
- `responses[]` — matched response status and body
- `stats.endpoints` — unique v0.3 endpoint patterns discovered

### Chrome DevTools MCP (local dev only)

Two MCP configs are registered for this project:
- **`chrome-devtools`** — launches its own GUI Chrome (profile: `~/.cache/chrome-devtools-mcp/airtable-profile`)
- **`chrome-devtools-patchright`** — attaches to patchright on `127.0.0.1:9222` (use with `pnpm capture:cdp`)

### Workflow: new endpoint → new tool

1. Run `pnpm capture:cdp` → perform the action manually in the browser
2. Read the capture JSON to identify the endpoint pattern and payload shape
3. Add the request method in `packages/mcp-server/src/client.js`
4. Add the tool definition in `packages/mcp-server/src/index.js`
5. Add the tool to a category in `packages/mcp-server/src/tool-config.js`

### Dev-tools file index

Located at `packages/mcp-server/dev-tools/` (gitignored):
- `capture.js` — main traffic capture tool (patchright + network interception)
- `analyze.js` — post-capture analysis
- `debug-login.js` / `debug-csrf.js` — auth/CSRF debugging
- `debug-create.js` / `debug-update.js` — payload format testing
- `debug-persistent.js` — persistent profile API testing

## Key Settings

All under `airtableFormula.*`:
- `mcp.autoConfigureOnInstall` — auto-write MCP config to detected IDEs on first launch
- `mcp.toolProfile` — `read-only` (12 tools) / `safe-write` (54 tools) / `full` (72 tools) / `custom`
- `mcp.categories.{read,recordRead,recordWrite,recordDestructive,tableWrite,tableDestructive,fieldWrite,fieldDestructive,viewWrite,viewDestructive,viewSection,viewSectionDestructive,formWrite,extension,sync,daemon}` — per-category toggles when profile is `custom`. `sync`, `recordDestructive` and `daemon` default to **off**; the other 13 default to on.
- `mcp.daemonPort` — fixed TCP port for the shared MCP daemon HTTP server (default 8723, kept stable across restarts; 0 = automatic/ephemeral; falls back to an automatic port if the chosen port is busy; takes effect on next daemon restart)
- `mcp.authMode` — `browser` (default; headless Chrome mints the cookie, calls go direct-HTTP) / `byo` (cookie-only, no browser; cookie from `~/.airtable-user-mcp/credentials.json` or `AIRTABLE_COOKIE`) / `direct-login` (browser-free email+password+TOTP; `login.json` or `AIRTABLE_EMAIL/PASSWORD/TOTP_SECRET`). Injected as `AIRTABLE_AUTH_MODE` into the spawned server via `buildDaemonEnv`/`registration.ts` (non-default only). Takes effect on next daemon/server restart.
- `mcp.httpClient` — `fetch` (default) / `impit` (Chrome-TLS impersonation fallback). Injected as `AIRTABLE_HTTP_CLIENT`. `impit` must be available to the server (optionalDependency; add to the vendored deps for the bundled path).
- `ai.autoInstallFiles` — auto-install AI skills/rules on first launch
- `formula.formatterVersion` — `v1` or `v2` beautifier/minifier engine

## Keeping tool categories in sync

The **authoritative** tool → category mapping lives in `packages/mcp-server/src/tool-config.js`. When adding, removing, renaming, or re-categorizing a tool, update all of:

1. `packages/mcp-server/src/tool-config.js` — source of truth
2. `packages/mcp-server/src/index.js` — tool definition + handler
3. `packages/shared/src/types.ts` — `ToolCategories` interface (if new category)
4. `packages/extension/src/mcp/tool-profile.ts` — mirror table + `CATEGORY_LABELS` + `BUILTIN_PROFILES` + `SETTINGS_TO_CATEGORY` + `getSnapshot()` + `categoryOrder` in `renderStatusReport`
5. `packages/extension/package.json` — `airtableFormula.mcp.categories.<key>` setting block + `enumDescriptions` profile counts + `mcpServerDefinitionProviders[].description` total count
6. `packages/webview/src/tabs/Settings.tsx` — `SettingToggle` row
7. `packages/webview/src/store.ts` + `src/test/store.test.ts` — default categories + `enabledCount` / `totalCount`
8. `packages/mcp-server/server.json` — MCP Registry manifest: the `tools` array and both version fields (this is what registry.modelcontextprotocol.io shows; `mcp-publisher publish` reads it)

Run `pnpm check:tool-sync` — must print green ✓ before committing. It also runs as part of `pnpm build` and `pnpm test`.

**What the guard covers (2026-07-30 — it now reads `index.js` itself).** It previously walked `tool-config.js` and its mirrors only — i.e. it compared the category map against *copies of itself*, which structurally cannot see a tool belonging to **no** category. `manage_daemon` shipped with a definition and a handler in `index.js` and no `TOOL_CATEGORIES` entry: since `enabledToolNames()` iterates that map, it was yielded by nothing, `isToolEnabled()` returned false in **every** profile including `full`, and the tool was registered and permanently uncallable — while `check:tool-sync` printed green. The guard now cross-checks the `index.js` tool surface against `tool-config.js` in **both** directions (every defined/handled tool is categorized; every categorized tool has both a definition and a handler), plus `server.json`, CLAUDE.md, both published READMEs, skill templates, `serverInfo`, and the banner/architecture SVGs. It `die()`s if either extraction yields zero tools, so a reformat degrades to a failure rather than a silent pass.

**Still unguarded:** `contributes.mcpServerDefinitionProviders[0].description` in `packages/extension/package.json` carries a hardcoded tool count that nothing verifies — update it by hand.

A newly added *category* defaults to **off** for pre-existing `custom`-profile users by design: `ToolConfigManager.enabledToolNames()` in `tool-config.js` resolves a tool with no key in an on-disk `customTools` map to enabled only if its category is in the frozen `LEGACY_CATEGORIES_DEFAULT_ON` allowlist. Do not add the new category to that allowlist — leaving it out is what keeps a `custom` profile from silently widening to include a *new category's* tools it never explicitly opted into.

This guards categories only, not individual tools — it is not a fully-solved invariant. A new tool added to an *already-legacy* category (one already on the allowlist, e.g. a future addition to `record-write`) still resolves an absent `customTools` key to enabled, indistinguishable from a tool that predates the config. This affects **standalone `airtable-user-mcp` npm/CLI users only**: the VS Code extension's `syncSettingsToFile()` (`tool-profile.ts`) always writes an explicit key for all 72 tools, so the absent-key path never applies to it. Tracked as known standalone-server hardening (see the `ponytail:` comment on `LEGACY_CATEGORIES_DEFAULT_ON` in `tool-config.js` and `packages/mcp-server/CHANGELOG.md`'s "Known limitations" entry); remedy is re-running `manage_tools` (`toggle_tool`/`toggle_category`) or hand-editing `~/.airtable-user-mcp/tools-config.json` with an explicit key for the new tool. The real fix — a frozen tool-**name** allowlist alongside/instead of the category allowlist — is a deliberate scope cut, not yet done.

<!-- PERPLEXITY-MCP-START -->
# Perplexity MCP Server

## Available Tools

- **perplexity_search** — Fast web search with source citations. Use for quick factual lookups. Works with or without authentication.
- **perplexity_reason** — Step-by-step reasoning with web context. Requires Pro account.
- **perplexity_research** — Deep multi-section research reports (30-120s). Requires Pro account.
- **perplexity_ask** — Flexible queries with explicit model/mode/follow-up control.
- **perplexity_compute** — ASI/Computer mode for complex multi-step tasks. Requires Max account.
- **perplexity_models** — List available models, account tier, and rate limits.
- **perplexity_retrieve** — Poll results from pending research/compute tasks.
- **perplexity_list_researches** — List saved research history with status.
- **perplexity_get_research** — Fetch full content of a saved research.
- **perplexity_login** — Open browser for Perplexity authentication.

## Usage Guidelines

1. **Start with perplexity_search** for quick questions. Only escalate to research or reason when depth is needed.
2. **Check rate limits** with perplexity_models before batch operations.
3. **Always cite sources** from search results in your responses.
4. **For multi-turn conversations**, pass the follow_up_context JSON from perplexity_ask responses back in subsequent calls.
5. **Long-running research**: perplexity_compute may time out. Use perplexity_retrieve with the returned research_id to poll for results.
6. **Language parameter**: Defaults to en-US. Set explicitly for non-English queries.

## Model Selection

| Tool | Default Model | Best For |
|------|--------------|----------|
| perplexity_search | pplx_pro | General web search |
| perplexity_reason | claude46sonnetthinking | Step-by-step analysis |
| perplexity_research | pplx_alpha | Deep research reports |
| perplexity_compute | pplx_asi | Complex multi-step tasks |
<!-- PERPLEXITY-MCP-END -->
