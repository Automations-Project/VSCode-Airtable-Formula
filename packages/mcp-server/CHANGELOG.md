# Changelog

## [Unreleased]

### Fixed (2026-07-30 sync drift detection — two ways a collaborator's edit got overwritten)

External review (PR #19) found both, with a reproduction. Sync's drift guard is what stops
`mode=apply` writing over changes made to the destination between `plan` and `apply`, and it had
two holes that compounded: the fingerprint usually could not see the change, and once a run was
resuming it stopped looking.

- **Second review round (same day): the widening itself had three defects, all fixed as engine `2d`.**
  (1) The fingerprint hashed `f.options` — a key NO normalized snapshot carries; the real key is
  `typeOptions` (`normalizeSchema`), so the widening was inert in production while its tests
  passed on synthetic shapes using the same wrong key. Fixed, and a normalizeSchema-parity test
  now fingerprints a snapshot produced by the real normalizer so the two can never drift apart
  again. (2) `applyJob()` accepted `resumeAfterDrift` but never forwarded it to `apply()` —
  the flag was unusable through `sync_base`, which only calls the background path (failed
  closed: it refused resumes rather than overwriting). Fixed + a background-path regression
  test. (3) Table **sections** were in neither fingerprint mode, while mirror prune deletes
  dest-only sections by id — a section renamed between plan and apply was deleted under its old
  identity. Sections are now in the DEFAULT fingerprint (they ride on the schema-only snapshot;
  free). Plans saved by `2c` abort with `PLAN_STALE` and a re-plan instruction.
- **The drift fingerprint now covers field `typeOptions` and `description`.** `fingerprintSchema()`
  hashed `id=name=type` only. A collaborator could rewrite a formula, retarget a link, add a
  select choice or edit a description and produce a **byte-identical** fingerprint — the guard
  passed and apply overwrote them. Both facets already ride on the schema-only snapshot, so this
  costs no extra API calls. Options are hashed with a key-order-stable serializer, so a
  re-serialization difference is not mistaken for a schema change.
- **Live view config is opt-in, via `strictDrift:true` on `mode=plan`.** Filters/sorts/groups/
  colors/column order are *not* in the default fingerprint: `apply` deliberately uses
  `snapshotSchemaOnly` to skip one ~1s `getView` per view, and folding config in unconditionally
  would reintroduce that storm on every apply. The plan records which basis built it and `apply`
  reuses that setting — it cannot infer it, because `plan` snapshots *with* view config and
  `apply` *without*, so an inferred flag would mismatch every time and abort every apply with a
  phantom `DRIFT`.
- **Resuming past drift is now gated by `resumeAfterDrift:true`.** One `done` journal action used
  to switch the drift guard off for the whole remaining run, silently. Prior progress proves *this
  plan* mutated the destination; it does not prove a collaborator did not also, and the remaining
  actions — deletions included — would overwrite them. `apply` now aborts with `RESUME_DRIFT` and
  says what to do (re-run `mode=plan`, preferred; or pass the flag to overwrite). This matches how
  every other destructive path here is gated (`confirmDeletions` / `confirmTableDeletions` /
  `confirmRetypes`). Known limit: still a whole-run decision — per-action preconditions are the
  tracked follow-up.
- **A plan from an older engine aborts with `PLAN_STALE`, not `DRIFT`.** An older plan hashed
  fewer facets, so its digest can never match a current one. Reporting that as `DRIFT` blamed a
  collaborator; mid-resume it invited the user to wave an overwrite through to fix what was really
  a version mismatch. `ENGINE_VERSION` is exported (now `2d` — see the second-round entry above),
  so test fixtures track it instead of pinning a literal that goes stale on the next bump.

### Changed (2026-07-30 — `mirror` no longer claims more than it does)

- The `policy: "mirror"` description said "make dest identical to source". It does not, and the
  code already knew: dest-extra **linked-record** entries are never unlinked (Pass 2 only adds),
  and a source row that **cleared** its attachments leaves the dest attachment cell untouched.
  Both are reported rather than performed. The preset is now described as "converge dest toward
  source" with those two exclusions stated inline. Implementing them remains a deferred follow-up;
  the contract no longer overstates it in the meantime.

### Added (2026-07-30 `manage_daemon` — model-facing daemon control)

- **New tool `manage_daemon`, in a new `daemon` category, `full` profile only.**
  Tool counts move **71 → 72** (`read-only` stays 12, `safe-write` stays 54);
  categories move 15 → 16. Actions: `status`, `start`, `restart`, `stop`,
  `tunnel_enable`, `tunnel_disable`, `token_rotate`.
  - `action="status"` is the read-only diagnostic and the reason the tool exists:
    it reports daemon liveness, **whether this process is the daemon**, transport,
    uptime, version/provenance and tunnel URL, plus the live session state
    (`sessionDead`, the last circuit-breaker trip *including Airtable's captured
    4xx response body*, and the browser/auth busy queue). Those three were
    previously reachable only by the VS Code extension over HTTP, so a model
    watching a sync job die could not tell *daemon gone* from *session dead* from
    *browser busy*. It never launches a browser and never mutates the lockfile.
  - `stop`/`restart` answer **first** and exit afterwards, from a `res.on('finish')`
    hook in `daemon/server.js`. Exiting from inside the handler deadlocks: closing
    the transport clears the request map without resolving the SDK's
    `enableJsonResponse` promise, so the response never flushes and the socket
    never closes. `stop` also writes a `daemon.stopped` sentinel, so the VS Code
    extension does not silently respawn the daemon the model just stopped.
  - `token_rotate` and `tunnel_*` are **loopback-only** and are refused for callers
    arriving through the tunnel; `status` is returned to them with host-identifying
    fields blanked. `/mcp` is the one route a tunnel caller can reach — every other
    `/daemon/*` route 404s for them — so putting daemon administration on the `/mcp`
    plane without this guard would have handed back exactly what that allowlist
    takes away. The bearer token is never returned to any caller, in any mode.
  - Interactive tunnel setup (`cloudflared login`, creating a named tunnel) is
    deliberately **not** exposed: readline prompts, an up-to-10-minute block, and a
    new Cloudflare tunnel per call. Use the CLI or the VS Code dashboard.
- **Standalone `airtable-user-mcp` npm/CLI users on the `custom` profile will not
  get `manage_daemon` automatically** — and that is intended. `daemon` is a new
  category, so it is correctly excluded from the frozen
  `LEGACY_CATEGORIES_DEFAULT_ON` allowlist and an absent `customTools` key resolves
  to **disabled**, exactly as `sync` and `record-destructive` did when they shipped.
  A tool that can stop or restart the server the caller is talking through must
  never arrive by upgrade alone. **To enable it:** run
  `manage_tools toggle_category daemon true`, or add an explicit
  `"manage_daemon": true` to `~/.airtable-user-mcp/tools-config.json`. VS Code
  extension users are unaffected: `syncSettingsToFile()` always writes an explicit
  key for every tool, and the new `airtableFormula.mcp.categories.daemon` setting
  ships **off** by default.

### Fixed (2026-07-30 stale category/tool enumerations)

- **`manage_tools`' own `category` parameter listed 8 of the 15 categories.** It was
  a hand-written string that nobody updated when a category shipped, so a model had
  no way to discover that `record-write`, `view-section`, `sync` or `daemon` were
  toggleable at all. It is now derived from `CATEGORY_LABELS` — both the prose and a
  real JSON-Schema `enum`, so the list cannot go stale again and clients can
  validate the argument.
- **The published MCP Registry manifest (`server.json`) advertised 32 of 72 tools at
  version 2.1.1 while the package was at 2.4.15.** `mcp-publisher publish` reads this
  file, so that was the tool list shown on registry.modelcontextprotocol.io. The
  `tools` array is regenerated (all 72 + `manage_tools`) and both version fields now
  track `package.json`. `check:tool-sync` guards the tool-name set and the versions
  from now on; the blurbs stay free prose, so ordinary copy edits do not fail the
  build.

### Fixed (2026-07-30 cross-client config override is no longer silent)

- **A standalone client that attach-proxies into someone else's daemon now says so,
  once, on stderr.** Since the daemon is now started on MCP request, a
  `daemon.lock` exists on essentially every VS Code session — so a standalone client
  (Claude Desktop, Cursor, Cline, Amp) that finds one attaches to **VS Code's**
  daemon and every tool call runs under **that** process's environment. The attach
  path reads only `AIRTABLE_NO_DAEMON` and `AIRTABLE_USER_MCP_HOME` from the
  client's own env; its configured `AIRTABLE_AUTH_MODE`, `AIRTABLE_HTTP_CLIENT`,
  browser channel and idle-park tuning were silently void. The attach still
  happens — refusing it would send the process down the in-process path and put a
  **second** Chromium on the shared persistent profile, which is the Chrome-exit-21
  failure this codebase has historically mis-reported as "session dead" — but the
  mismatch is now named explicitly, with the two ways to opt out
  (`AIRTABLE_NO_DAEMON=1`, or stop the daemon and let it restart from your env).
- **`/daemon/health` now reports the daemon's effective `authMode`, `httpClient` and
  `configDir`**, so a caller can ask "whose settings am I actually running under?"
  after the fact. `manage_daemon action="status"` reports the same three.
- **This is deliberate, not a bug to be fixed later.** A standalone client that
  attaches inherits **that daemon's** auth mode and HTTP client, and its own
  `AIRTABLE_AUTH_MODE` / `AIRTABLE_HTTP_CLIENT` are not applied — because the whole
  point of the shared daemon is that exactly **one** browser owns the persistent
  Chrome profile. Two processes on that profile is the crash class, so the shared
  configuration wins by design. The stderr line is the discovery mechanism: it is
  the only place that mismatch is ever announced.

### Changed (2026-07-30 the daemon now starts on an MCP request)

- **An MCP tool call can now bring the daemon up; previously only the VS Code
  dashboard or a formula command could.** `registration.ts` called a passive
  `getDaemonStatus()`, so unless the user had already opened the dashboard, *every*
  session fell through to the stdio branch — and that branch spawns an in-process
  server **per VS Code window**, each with its own Chromium on the single-owner
  `.chrome-profile`. That is the Chrome exit-21 collision this project has
  repeatedly mis-reported as "session dead". Starting the daemon here makes profile
  collisions **less** likely, not more: one shared daemon replaces N stdio servers.
  - **What changes for users:** a `daemon.lock` now exists on essentially every VS
    Code session, browser logins are shared instead of duplicated, and standalone
    clients on the same machine attach to it (see the cross-client note above).
  - The start is **implicit**: it preserves the `_userStopped` latch, so a daemon
    you deliberately stopped is *not* resurrected by the next tool call, and it
    keeps the spawn-suppression window that closed the runaway-spawn OOM.
  - **If the daemon cannot start, MCP still works** — the provider falls through to
    stdio rather than returning no server at all.
- **`byo` / `direct-login` users no longer get a credential-less stdio server when
  the daemon is unavailable.** The credential-injection branch used to test the
  `useDaemon` *setting*; it now tests whether a daemon is *actually serving this
  registration*. Those were the same thing until the daemon could fail to start.
  With the old test, a `byo`/`direct-login` user whose daemon failed to start (or
  who had pressed Stop) got a stdio server with no credentials and no browser to
  fall back on — `*_CREDENTIALS_MISSING` on every single tool call. When the daemon
  *is* serving, `/daemon/auth-credentials` remains the single credential channel and
  secrets are still never duplicated into the child environment.

### Fixed (2026-07-30 daemon lifecycle hardening)

- **A malformed `AIRTABLE_IDLE_PARK_MS` disabled idle parking instead of being
  ignored.** Anything unparseable — `"30m"`, `"1_800_000"`, a stray quote — fell
  through to `0`, and `0` means *never park*. So the env var meant to **tune**
  parking silently **switched it off**, pinning a ~300–600 MB Chromium tree
  resident forever. Unparseable input now returns the 30-minute default; only an
  explicit, well-formed `0` (or negative) disables parking.
- **A cookie-less idle park no longer reads as a stranded browser.** The abort path
  logs "deferred … will retry when idle again" and is genuinely re-armed by the
  busy→idle edge, rather than claiming it is "keeping browser up" forever.
- **The tool-config watcher is awaited at daemon startup.** `startWatching()` only
  assigns its watcher after an internal `await mkdir`, so the un-awaited call let
  `stop()` run `stopWatching()` while the handle was still null. The watcher was
  then created with nobody left to close it, the fs handle kept the process alive
  past shutdown, and `stopDaemon()` waited out its timeout and escalated to
  SIGKILL.

### Fixed (2026-07-30 issue #21 — login reported success without checking who was signed in)

- **`login` declared success on the first 2xx and printed `User: undefined` even
  when it worked** ([#21]). The root cause is counter-intuitive, so state it
  plainly: **`/v0.3/getUserProperties` carries no identity at all.** Its
  *authenticated* 200 body is eight feature-flag booleans
  (`{"gemini":false,"libra":false,…}`) — there is no `userId` in it, anywhere. The
  `data.data.userId` that every probe read was a **phantom field that never
  existed**, which is why the success line printed `undefined` on *successful*
  logins too. The checkmark had never been reporting identity; it was reporting an
  HTTP status and labelling it a user.
  - **Consequence for the reporter:** because any 2xx counted, `login` closed the
    browser roughly 2 s after opening it — before an SSO round trip or a
    hand-typed 2FA code could possibly finish — and then reported success.
  - **The fix:** identity now comes from the page bootstrap, where it actually
    lives (`"sessionUserId":"usr…"` in the served HTML — the SPA reads it there
    and builds its own `/v0.3/user/<usr…>/…` URLs from it). New module
    `src/session-user.js` holds the scrape, the predicate, and the single poll
    loop that `login.js` (×2), `login-runner.js` and `manual-login-runner.js` each
    used to keep a private copy of. Those copies had already drifted — one polled
    60 s while the other three polled 300 s — and that divergence is how #21
    survived this long. All four now poll for the same 5 minutes, which is what
    SSO plus a typed 2FA code actually needs.
- **The identity check is STRICT at the login and health probes, ADVISORY at
  session verify — and that asymmetry is the design, not an inconsistency.**
  - **STRICT** (`login`, the spawned `health-check`): a real `usr…` id is
    *required*. A human is waiting on a green light here, and a false green **is**
    the bug being fixed. A cookieless caller gets `401` from `getUserProperties`,
    so an accepted call carries real signal — but not conclusive signal: the
    reporter demonstrably reached a state where a stale/partial profile cookie was
    still accepted while the session was not usable.
  - **ADVISORY** (`auth._verifySession` at server init): a missing id is logged and
    ignored. The cookie has *already* been accepted over direct HTTP by that point,
    and a missing marker is equally what you see when the wrong page loaded, the
    render had not finished, or Airtable renamed the key. Gating there would turn
    one scrape drift into a total outage of all 72 tools.
  - The same reasoning is why the VS Code extension takes the daemon's verdict as
    given and does **not** add its own "no userId ⇒ signed out" gate: `byo` and a
    parked browser may never have had a page to read an id from.
- **`userId` is never invented and never inherited.** It is dropped on `close()`,
  so a leftover id from a previous login cannot stand in as proof about a session
  it knows nothing about; `byo` reports `(user id unavailable — byo has no page to
  read it from)` instead of a fabricated one. It is read in the same
  `page.evaluate()` that already scrapes the CSRF token rather than via
  `page.content()`, which serializes the entire multi-MB DOM over CDP and throws
  mid-navigation.
- **`direct-login` can now fail with `DIRECT_LOGIN_UNVERIFIED`.** It fires when the
  HTTP login flow completes and a `__Host-airtable-session` cookie **is** present,
  but the page airtable.com then serves carries **no** signed-in user — i.e. a
  session cookie exists while the sign-in never actually completed (an incomplete
  SSO or 2FA step). A cookie alone was previously treated as a completed login;
  that is the same false-green as #21, on the browser-free path. **Remedy:** check
  `AIRTABLE_EMAIL` / `AIRTABLE_PASSWORD` / `AIRTABLE_TOTP_SECRET`, or switch to
  `AIRTABLE_AUTH_MODE=browser`.
  - Deliberately **tri-state**, because getting this wrong breaks working logins:
    `usr…` = signed in, `null` = the page says nobody is, `undefined` = never read.
    **Only the middle case raises the error.** This client does not follow
    redirects, so a perfectly good login whose `GET /` answers `302` hands back an
    empty body; treating that as "signed out" failed successful logins and, through
    `_recoverSession`, fed the dead-session breaker that aborts exactly the long
    unattended jobs this mode exists to serve.
- **`health-check` probes up to three times instead of once.** The marker arrives
  with the page bootstrap, so a single shot reports a healthy session as signed out
  on a slow render — and the extension answers an `expired` verdict by relaunching
  Chrome, so a false red costs a full launch against the single-owner profile.
- **`login-runner` is given 330 s by the extension, matching the runner's own
  5-minute poll.** The previous 120 s default sent it `SIGTERM` mid-poll and threw
  away the diagnostic it was about to print.

### Changed (2026-07-30 `status` and `doctor` now tell you different, true things)

- **`doctor` actually probes the session.** It previously reported all-green for
  precisely the broken profile in #21, because it never checked the session at all.
  It now prints one of `Session: signed in as usr…`, `Session: signed in, user id
  unavailable in this auth mode`, or `Session: NOT signed in — <reason>`, and says
  which route it used (`via the running daemon` / `checked directly`).
  - It **prefers the running daemon** over opening its own browser. The persistent
    profile is single-owner: launching a second Chromium against it collides
    (Chrome exit 21), and auth's lock recovery would then kill the live daemon's
    browser as a "stale holder". Only with no healthy daemon does `doctor` open its
    own.
- **`status` stopped lying in the other direction.** It reported
  `Session: found`/`not found` from the existence of `session.json` — a file
  nothing has written for several versions, so healthy installs read `not found`.
  It now reports what the login flow actually produces (`Browser profile: …`,
  `Daemon: …`) and explicitly claims **nothing** about whether you are signed in:
  those files exist whether or not the login completed. `doctor` is the command
  that can answer that, and `status` now says so.

[#21]: https://github.com/Automations-Project/VSCode-Airtable-Formula/issues/21

### Known limitations (2026-07-25 tool profile safety — standalone CLI users)

- **`LEGACY_CATEGORIES_DEFAULT_ON` is category-granular, not tool-name-granular —
  a *new tool in an already-adopted category* can still be silently regained.**
  This only affects **standalone `airtable-user-mcp` npm/CLI users** with a
  hand-edited or pre-existing `~/.airtable-user-mcp/tools-config.json` on
  `activeProfile: "custom"` — **not** the VS Code extension, whose
  `syncSettingsToFile()` always writes an explicit `true`/`false` for all 71
  tools, so it never hits the absent-key resolution path described below.
  - **Who's affected:** a standalone user who set `activeProfile: "custom"` and
    explicitly turned the **Record Write** category off (`table-write`,
    `field-write`, `view-write`, etc. are equally affected — Record Write is
    just the concrete case that shipped on this branch) before this branch's
    new tools existed in their on-disk config.
  - **What they gain:** on upgrade, `upload_attachment` (new tool) — and
    `create_records`/`update_records` if those also postdate their config —
    resolve their absent `customTools` key to *enabled*, because
    `LEGACY_CATEGORIES_DEFAULT_ON` allowlists the whole `record-write`
    *category* (frozen at the 13 categories that existed when per-tool
    overrides were introduced), not the individual tool names within it. A
    tool with no key at all is judged solely by whether its *category* is
    legacy — it has no way to know the user's config predates the *tool*
    specifically, only the *category*.
  - **What they do NOT gain:** `delete_records` — `record-destructive` is a
    brand-new category on this branch and is correctly excluded from the
    allowlist, so it resolves absent keys to disabled as intended. Only
    record-**write** tools are affected, never destructive ones.
  - **Net effect vs. pre-hardening-pass behavior:** strictly better. Before this
    pass, ALL new tools (including `sync_base` and `delete_records`) resolved
    absent keys to enabled with no category gate at all; this pass closed that
    for every *new category*. The residual is narrower: only new *tools* inside
    a category the user had already adopted (and then explicitly disabled) can
    still slip through.
  - **Remedy:** re-run `manage_tools` (`get_tool_status` to see what's enabled,
    `toggle_tool`/`toggle_category` to turn `upload_attachment` back off if
    unwanted) or hand-edit `~/.airtable-user-mcp/tools-config.json` to add an
    explicit `"upload_attachment": false` entry. The real fix — a frozen
    tool-**name** allowlist alongside (or instead of) the category allowlist —
    is deliberately deferred: it is a semantic change to credential-adjacent
    tool-gating logic and does not belong in the closing commits of a
    pre-merge hardening pass. See the `ponytail:` comment on
    `LEGACY_CATEGORIES_DEFAULT_ON` in `src/tool-config.js`.

### Changed (2026-07-25 tool profile safety, pre-merge hardening pass)

- **`safe-write` no longer includes `sync_base`.** `sync_base` reaches
  destructive operations (`mode=apply` under `policy=mirror` can delete
  tables, fields, views, sections and records), so it never belonged in a
  profile whose own description promises "no deletes". It now lives in
  `full` only; `safe-write` drops from 55 to **54** tools (`read-only` stays
  12, `full` stays 71).
- **`sync` and `recordDestructive` — both new categories on this branch — no
  longer silently widen an existing `custom` profile on upgrade.** A
  pre-existing `~/.airtable-user-mcp/tools-config.json` with
  `activeProfile: "custom"` and no key at all for `sync_base`/`delete_records`
  (because those tools didn't exist when the file was written) previously
  resolved the absent key to *enabled* — so an upgrade alone handed an
  existing custom-profile user two destructive/gated tools they never opted
  into. `enabledToolNames()`'s absent-key resolution is now driven by a
  frozen `LEGACY_CATEGORIES_DEFAULT_ON` allowlist of the 13 categories that
  predate this change: an absent key for `sync`/`record-destructive` now
  resolves to disabled, while every pre-existing category keeps its legacy
  enabled-by-default behavior for absent keys (so a new *tool* added to an
  already-adopted category still "just works"). A future category is safe by
  construction — nothing to remember to update. `toggleTool`/`toggleCategory`
  also now derive their "did this actually change" check from
  `enabledToolNames()` itself (previously a separate, disagreeing rule could
  silently skip the `tools/list_changed` notification when toggling an
  absent-key tool on a legacy config).
- **`sync_base`'s `destructiveHint` is now `true`.** It was `false`, and the
  tool-category comment described `sync_base` as "read-only plan mode" —
  true for 3 of its 5 modes (`plan`/`diff`/`status`) but not for `apply`
  (which mutates the destination and can delete under `policy=mirror` + the
  confirmation flags) or `reconcile` (which updates local mapping state).
  MCP clients that gate tool calls on `destructiveHint` now correctly prompt
  for `sync_base`.

### Fixed (2026-07-25 corporate proxy / TLS)

- **The dead-session circuit-breaker resets on re-authentication.** Once `_sessionDead` latched, `_apiCall` short-circuited every request, and the only production `resetSessionHealth()` callers were the daemon's byo/direct-login credential endpoint and the sync records engine — so a browser-mode session stayed dead until the process restarted. It is now cleared by `close()` (the `/daemon/release-browser` teardown the extension runs before an interactive login) and by a completed initialization that is neither driven by the internal `_recoverSession()` loop nor merely mid-streak — only an already-latched breaker is un-stuck, so a partial failure count still accumulates to the threshold and the breaker keeps bounding recovery storms.
- **`airtable-user-mcp logout` now stops a running daemon** before wiping the browser profile. It previously deleted the profile directory only, leaving the daemon serving the session from memory (and, on Windows, leaving the profile un-deletable because the daemon's Chromium held it open). A removal that genuinely fails is now reported as a failure with a non-zero exit code — the old code printed "No session to clear.", which was the opposite of the truth, since `fs.rm(..., {force:true})` does not throw on a missing directory.
- **`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` are now honoured** by the direct-HTTP transport (`src/http-transport.js` + new `src/proxy.js`). Node's global `fetch` ignores them by design (Node ≥24 needs an explicit `NODE_USE_ENV_PROXY=1`; this package targets Node ≥22), so on a proxy-only network every API call failed while the browser login — which uses the OS proxy — still succeeded, and the auth layer reported the result as `SESSION_INVALID`. undici's `EnvHttpProxyAgent` is now attached as the fetch dispatcher whenever those variables are set, with `NO_PROXY` bypass matching handled by the agent itself. `undici` is an **optionalDependency**, lazy-loaded like `patchright`/`otpauth`/`impit`: if it is missing, the transport logs one actionable warning and behaves exactly as before. Browser-free login (`AIRTABLE_AUTH_MODE=direct-login`) uses the same dispatcher.
- **Network errors are diagnosable.** undici reports every network/TLS failure as `fetch failed` with the real reason buried in `err.cause`; the cause chain is now unwrapped into the returned error, and certificate failures ("TLS certificate rejected …") name `NODE_EXTRA_CA_CERTS` while an unreachable network with no proxy configured names `HTTPS_PROXY`.

#### Known limitations (tracked and accepted)

- **TLS interception needs `NODE_EXTRA_CA_CERTS`.** Node uses its own bundled CA list, not the OS trust store, so a proxy that re-signs HTTPS with a private root is rejected even when routing works. **Workaround:** `NODE_EXTRA_CA_CERTS=/path/to/corp-root.pem` in the environment that starts the server (the VS Code extension spawns the daemon with the full inherited environment, so setting it before launching VS Code is enough). Not fixed in code: Node exposes no supported OS-trust-store API.
- **`AIRTABLE_HTTP_CLIENT=impit` ignores the proxy environment.** impit takes an explicit `proxyUrl` and has no `NO_PROXY` support, so a partial implementation would be misleading. **Workaround:** use the default `fetch` client behind a proxy.
- **`ALL_PROXY` is not honoured** (undici's env contract does not include it). Setting it alone logs a warning pointing at `HTTPS_PROXY`.

### Fixed (2026-07-25 sync column-visibility)

- **`sync_base mode=diff`/`mode=apply` — column-visibility comparison no
  longer produces a false negative on an absent `visibility` key.**
  Airtable's internal API omits the `visibility` key entirely for a visible
  column in some responses (absent key = visible; visibility is only ever
  explicitly `false` for a hidden column) — `client.js`'s `getView` has
  always honoured this correctly, but `sync/remap.js`'s
  `canonicalizeViewConfig` (feeds `mode=diff`'s classified compare) and
  `sync/apply.js`'s `applyViewConfig` columns facet both treated an absent
  key as **hidden**, backwards from `getView`'s semantics. A source column
  returned without the key therefore canonicalized as hidden, which
  **matched** a dest column explicitly `false` and reported convergence —
  silently masking real column-visibility drift — and `apply` never
  re-showed that column on the destination. All four read sites
  (`client.js`'s `getView` + `_showColumnsWithRetry`, `sync/apply.js`,
  `sync/remap.js`) now share one predicate, `isColumnVisible()` in the new
  `src/column-visibility.js`, so the semantics cannot re-diverge.
  **This is a correctness fix that surfaces previously-hidden drift, not a
  regression:** a base pair previously reported `converged` or `identical`
  by `mode=diff` may correctly report column-visibility drift on the next
  run for any column whose source `columnOrder` entry omits `visibility`;
  re-run `mode=apply` to converge it.

### Fixed (2026-07-09 field-ref & upload bug report)

- **`download_base_formulas` / `download_formula_field` now emit real field names.** Airtable's internal API stores formulas with opaque `{column_value_fldXXX}` refs; downloads previously wrote them verbatim, producing unreadable files that Airtable rejected on re-upload ("Unknown field names: column_value_…"). Field refs are now resolved to `{Field Name}` (Airtable's native syntax) via a base-wide id→name map (`src/formula-refs.js`); an unknown id — or a name that cannot round-trip (contains braces, or is itself shaped like a ref token, e.g. a field literally named `fldXXX…`) — falls back to the `{fldXXX}` id form, which the write API accepts. Non-field placeholder tokens (e.g. n8n's `{ACCOUNT_TITLE_PLACEHOLDER}`) never match the fld-id pattern and pass through verbatim.
- **Formula writes accept the legacy `{column_value_fldXXX}` form.** `create_formula_field`, `update_formula_field`, `update_field_config`, `create_field`, and `validate_formula` now normalize `{column_value_fldXXX}` → `{fldXXX}` at the write boundary (`normalizeFieldType` + `validateFormula`), so `.formula` files downloaded before this fix round-trip without manual rewriting.
- **Daemon `/mcp` no longer 406s lenient clients.** Two-part fix: (1) `enableJsonResponse: true` — the endpoint is stateless (a fresh Server per request, nothing streamed mid-call), so POSTs are answered as plain JSON instead of an SSE stream; (2) a Postel shim upgrades an incomplete `Accept` header (e.g. curl, n8n HTTP nodes, hand-rolled `fetch` sending only `application/json`) to the spec-required `application/json, text/event-stream` before the SDK's 406 check, instead of failing the call. (Spec-conformant clients are unaffected.)
- **`list_fields` is lightweight by default**: returns `{ id, name, type }` per field; the full `typeOptions` (formula dependency graphs, select choice maps — ~350K chars on a wide table, past the MCP response window) is now opt-in via `includeOptions: true`.

### Added

- **`sync_base mode=plan` and `mode=apply` now run as background jobs** (`src/sync/job-status.js`): both were minutes-long and synchronous on real/view-heavy bases (plan snapshots every view's config on both bases; apply runs the whole schema phase before backgrounding records) — long enough that the MCP call returned `Connection closed` even though the work completed and persisted server-side. Both now return `{ jobId, status:"running" }` immediately and run detached; poll `mode=status` with the planId for phase progress (`planning → schema → records → done`/`failed`), with pid-liveness so a job whose worker died is reported failed with resume advice (not stuck "running"). `mode=diff`/`mode=reconcile` stay synchronous. `mode=status` returns a structured `{ planId, phase, status, recordsMapped, planDigest?, schemaResult?, recordsResult? }`. *(Live-verified: `planJob` returns in 3 ms; a ~2.3-min plan completes in the background and `mode=status` reports `done` with the digest.)* Note: `FIELD_MAP_INVALID`/`APPLY_LOCKED` now surface via `mode=status` (`phase:"failed"`) instead of synchronously, since apply runs in the background.
- **Direct-HTTP transport + browser-free auth modes** (`AIRTABLE_AUTH_MODE`, `AIRTABLE_HTTP_CLIENT`): Airtable API calls no longer run inside a headless Chrome page — they go through a direct node HTTP transport (`src/http-transport.js`; `fetch` by default, opt-in Chrome-TLS-impersonation via `impit` behind `AIRTABLE_HTTP_CLIENT=impit`). The browser is demoted to login/credential-capture only, which removes the class of failures where the browser was both auth store and transport (profile-lock crashes, single-profile no-parallelism, session death during long applies). Three credential modes:
  - `browser` (default, unchanged): patchright login mints + refreshes the session; all calls run direct-HTTP with the captured cookies. Backward-compatible — `new AirtableAuth()`, the daemon, and the extension are untouched.
  - `AIRTABLE_AUTH_MODE=byo`: **cookie-only, no browser**. Reads a session cookie from `AIRTABLE_COOKIE` or `~/.airtable-user-mcp/credentials.json` (`{cookie, csrf?}`); auto-scrapes the CSRF token from an authenticated page if not supplied. Log in once anywhere, paste the cookie, run with zero Chrome. *(Live-verified: 27 MB read + field create/delete with no browser launched.)*
  - `AIRTABLE_AUTH_MODE=direct-login`: **browser-free login** via `impit` + `otpauth` TOTP — replays Airtable's login flow over HTTP (`GET /login` → `getLoginTypeForEmail` → `login` → `verify2faCode`) from `AIRTABLE_EMAIL`/`AIRTABLE_PASSWORD`/`AIRTABLE_TOTP_SECRET` (or `~/.airtable-user-mcp/login.json`). Built + unit-tested; live verification pending real credentials. SSO accounts fall back to `browser` mode.
  - Also: dropped the (live-proven unnecessary) `secretSocketId` browser-navigation capture that added ~8s to the first mutation; and `sync_base mode=status` now returns the record-sync result as a structured `result` object + `recordsMapped` count instead of a JSON blob stringified into `summary`.
- **`upload_attachment`** (record-write category): new MCP tool for URL-based attachment uploads into `multipleAttachments` fields. Accepts `appId` + `updates[]` (`rowId`, `columnId`, `url`, optional `filename`). Fetches each URL's bytes and appends to the target cell via the existing 5-step multipart upload flow. Per-update isolation: individual fetch/upload failures are collected in `failed` and do not abort the rest. The general `update_records` tool cannot write attachment cells; use `upload_attachment` instead.
- **Scalar field retypes** (`sync_base mode=apply`): a matched field whose **scalar** type diverges from source is now retyped to match (via `updateFieldConfig`), gated by a new `confirmRetypes` param (boolean, default `false`). Without it the field is kept and a `RETYPE_GATED` warning is emitted; the applied count surfaces as `retyped`. Non-scalar retypes (either side computed/link/attachment) stay `RETYPE_DEFERRED`; select retypes converge their choice map on re-sync like created selects; per-field failures are continue-on-failure (`RETYPE_FAILED`); primary-field retypes remain the separate `reconcilePrimary` path. This is the last schema-drift category sync can fix (records data migration remains `pruneRecords`/Pass 1).
- **View-section orphan deletion** (`sync_base mode=apply`): completes the M4 deletion story — under `mirror`+`confirmDeletions`, dest-only sidebar view-sections (a section name absent from the source) are now deleted by `pruneSchema` (step 0, before views; `deleteViewSection` auto-promotes any contained views to top-level, so a promoted orphan view is then caught by the view step). Gated by `confirmDeletions` like fields/views (NOT `confirmTableDeletions`); counts into `schemaDeleted`; continue-on-failure (`SCHEMA_DELETE_FAILED`). The snapshot now captures the section id, and `mode=diff` compares sections by name+viewNames (ignoring the id) so semantically-identical sections no longer show as a spurious not-synced diff.

### Fixed

- **Chrome profile-lock auto-recovery** (`src/profile-lock.js`): a crashed/leaked Chrome that keeps the MCP-exclusive persistent profile locked used to make every browser-mode launch fail with exit code 21 until the zombie was killed by hand. `_doInit` now detects the lock failure, kills the stale Chrome/Edge process(es) holding *our* profile dir (win32 CIM+taskkill, posix pkill — best-effort, never throws), and retries the launch once. Reactive only (fires after actually hitting the lock, never proactively), so it can't kill a healthy instance. Live-verified against a real exit-21. `byo`/`direct-login` modes launch no browser and never hit this path.
- **Sync hardening audit** (`sync_base`, 25 commits, ~100 new regression tests): full multi-agent audit of the sync engine with adversarially verified findings, all fixed:
  - *Identity & concurrency*: `mode=plan`/`mode=diff` no longer wipe the persisted `idmap.records`/`idmap.attachments` (previously every re-plan destroyed the record identity map → mass duplication on the next apply). A per-pair `apply.lock` (pid-liveness, held until the background records job settles) refuses concurrent applies (`APPLY_LOCKED`); `mode=reconcile` takes the same lock. Journal resume is now reachable: a journal with ≥1 done action bypasses the drift guard (`RESUME_DRIFT_BYPASS`). Background job files carry the worker `pid`; `mode=status` reports a dead-pid `running` job as failed instead of `running` forever.
  - *Policy contracts*: Pass 2 (links) and attachments now honor `conflicts=dest-wins` for pre-existing rows (rows created by the plan are tracked resume-durably in the records journal and always get links/attachments). Mirror now propagates **source-side record deletions** (stale idmap entries no longer shield dest rows; truncation-guarded; still gated by `confirmDeletions`). Cells cleared on source propagate as explicit nulls under source-wins (never to computed dest fields). `reconcilePrimary` retypes of a pre-existing primary are gated behind `confirmRetypes`, and computed primaries are written in the writable options shape.
  - *Convergence*: matched link fields no longer emit a phantom `updateField` on every plan (and real link updates ship writable, remapped options); gated/deferred actions are no longer journaled `done`, so re-runs with `confirmRetypes:true` (or after a ref becomes resolvable) actually execute; forward-referenced link/computed fields retry within the run; reverse-link adoption matches the exact `symmetricColumnId` pair (no cross-wiring, cross-run safe); views match and adopt by (name, **type**); new select fields register their real choice map so first-run records write select cells; multiSelect/multiCollaborator and all other array-shaped cells are consistently deferred on the update path (internal type spellings recognized); collaborator `usr` ids pass through view-filter remap (they are Airtable-global).
  - *Data safety*: attachment-fallback dedupe key is now scoped to the destination cell (`row|field|filename|size`) — previously any later record carrying a same-named same-size file silently got an empty cell forever; record snapshots avoid filtered views and mark unavoidably-filtered tables as truncated (`SNAPSHOT_VIEW_FILTERED`, no prune); `mode=reconcile`'s existence-prune is truncation-guarded (no more false prunes → duplicates in >1000-row tables); truncation detection counts actually-fetched rows; the dest primary is never emitted as a deletable orphan; one failed view fetch no longer aborts the record-filter restore or blocks prune.
  - Capture-gated deferrals (mitigated, not yet fixed): unfiltered/paginated table reads (`readQueries` non-view source) and array-cell value updates on existing records (multiSelect/collaborator edits after creation).

- **Record-truncation safety** (`sync_base mode=apply`): the records snapshot reads each table at a hard 1000-row cap (the internal `readQueries` endpoint has no pagination — verified: a larger `limit` is rejected and no offset param is honored). Previously, under `mirror`+`confirmDeletions`, `pruneRecords` could delete a legitimate dest record whose source counterpart fell beyond the 1000-row window, treating it as a false orphan (silent data loss). Now any table whose snapshot hits the cap on **either** base is skipped by `pruneRecords` (`RECORDS_TRUNCATED_PRUNE_SKIPPED`), and each truncated table emits a `RECORDS_TRUNCATED` warning so the partial copy is visible. Actual >1000-row read pagination is a follow-up (capture-gated).

### Security

- **Hardening round-2** (audit findings #10, #28): `auth.js` no longer logs any portion of the CSRF token to stderr (even a 15-char prefix was a secret leak to logs), and the ngrok tunnel's `forwards_to` dashboard label no longer embeds the local daemon port. (The 2026-06-12 audit's HIGH tier was already fixed; a verification sweep of the remaining MEDIUM/LOW backlog found most either already fixed, theoretical, or requiring a redesign/decision — these two were the clean, surgical wins.)
