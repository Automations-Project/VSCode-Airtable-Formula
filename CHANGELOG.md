# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed — Unconfigure destroyed unrelated config in Codex / Helix files (2026-07-31)

- **`unconfigureMcpToml` and `unconfigureHelix` truncated the user's config file from our marker
  to EOF.** Both did `existing.slice(0, indexOf(MARKER))`, discarding everything below our block
  rather than removing only our block. Since `configureMcpToml` appends at EOF and `codex mcp add`
  does too, any second MCP server or `[model_providers.*]` section the user added after running
  Setup sat below ours — and clicking **Unconfigure** in the dashboard (no confirmation prompt)
  destroyed it silently, with no backup and no error. Measured against the old code, a
  `config.toml` holding one extra MCP server was reduced to a **single newline**.
  Both now remove only the sections we own, preserving everything else verbatim.
  Note `HELIX_BLOCK` is *four* top-level tables, not one, so a naive "delete to the next `[`
  header" would have orphaned three `[[language]]` blocks; the header matcher is also strict
  enough not to mistake a continuation line of a multi-line array (`matrix = [\n[1,2],\n]`) for a
  table header. Pinned by `src/test/lsp-config-toml.test.ts`.

### Fixed — formatter tokenizers silently corrupted formulas / hung the extension host (2026-07-31)

Found by audit, both reproduced before fixing.

- **The default (v2) beautifier and minifier deleted lowercase function names and wrote the
  result to disk.** Airtable function names are case-insensitive, but both v2 tokenizers matched
  `/[A-Z_]/` with **no `/i` flag**, so every `a`–`z` character fell through to the operator
  chain's `else { i++ }` catch-all and vanished from the token stream. Measured before the fix:
  `lower({Email})` → `({Email})`, `IF({A}, lower({B}), 0)` → `IF({A}, ({B}), 0)`,
  `if({A},1,0)` →(minify)→ `({A},1,0)`, `If({A},1,0)` →(minify)→ `I({A},1,0)`. Because the
  mangled output still *parses*, `beautify()`'s try/catch never fired and no diagnostic was
  raised — so Shift+Alt+F and `editor.formatOnSave` corrupted the buffer silently, and the bulk
  `beautifyFilesWithStyle` path wrote unopened files directly with no undo stack. Both
  tokenizers now match case-insensitively and canonicalise only for the `FUNCTIONS`/`CONSTANTS`
  lookup, so **the casing you typed is preserved** in the output.
- **The v1 beautifier and minifier hung the extension host on an unrecognized character.** The
  identifier fallback was the only branch of the tokenizer loop with no unconditional advance:
  a character matched by no branch (`;`, `%`, `[`, `}`, a smart quote pasted from a doc, any
  non-ASCII letter) matched zero characters, left the cursor unmoved, and spun the loop
  allocating until V8 aborted (`Ineffective mark-compacts`, ~2 s). Both now **throw** rather
  than skip, which engages the callers' existing try/catch — an untokenizable formula is
  returned unchanged instead of being emitted with characters deleted.
- Pinned by `packages/extension/src/test/formatter-tokenizer.test.ts` (21 cases).

### Added — `manage_daemon` tool and the `Daemon Control` category (2026-07-30)

- **New MCP tool `manage_daemon` in a new `daemon` category.** Tool counts move
  **71 → 72** (`read-only` 12 and `safe-write` 54 are unchanged; only `full`
  grows), categories 15 → 16. `action="status"` is a read-only diagnostic that
  reports daemon liveness/holder/transport/uptime/tunnel plus the live session
  state — `sessionDead`, the last circuit-breaker trip including Airtable's own
  captured response body, and the browser busy queue — which is what lets an AI
  agent tell *daemon gone* from *session dead* from *browser busy*. The remaining
  actions (`start`, `restart`, `stop`, `tunnel_enable`, `tunnel_disable`,
  `token_rotate`) administer the daemon process itself.
- **New setting `airtableFormula.mcp.categories.daemon`, defaulting to `false`.**
  For a `custom`-profile user that one value is the whole decision, and this tool
  can stop or restart the very server the agent is talking through — so it is off
  until explicitly enabled. It is included in the `full` profile only.

### Fixed — "Toggle MCP Tool Categories" showed 8 of 16 categories (2026-07-30)

- **The command-palette category picker had its own hand-written list of 8
  categories**, so Record Read/Write/Destructive, View Sections (both), Form
  Metadata, Sync and Daemon Control were simply unreachable from it — and a newly
  shipped category was invisible until someone noticed. It now enumerates
  `SETTINGS_TO_CATEGORY` from `tool-profile.ts` (the table `check:tool-sync`
  already guards) instead of a second copy, so the picker cannot fall behind the
  category list again.

### Fixed — `check:tool-sync` can no longer pass while a tool is uncallable (2026-07-30)

- **The tool-sync guard now cross-checks `mcp-server/src/index.js` against
  `tool-config.js` in both directions.** `manage_daemon` shipped with a definition
  and a handler in `index.js` but **no entry in `TOOL_CATEGORIES`** — and because
  `enabledToolNames()` iterates that map, a tool absent from it is yielded by
  nothing and `isToolEnabled()` returns `false` in *every* profile, `full`
  included. It was registered and permanently uncallable. `check:tool-sync`
  nevertheless printed green, because every check it performed walked
  `tool-config.js` and its mirrors — comparing the map against copies of itself,
  which cannot see a tool that belongs to no category. The guard now also asserts
  that every tool defined or handled in `index.js` is categorized, and that every
  categorized tool has both a definition and a handler. It fails loudly if either
  extraction yields zero tools, so a reformat degrades to a failure rather than to
  a silent pass.

### Changed — the shared daemon now starts when an MCP tool call needs it (2026-07-30)

- **You no longer have to open the dashboard for the daemon to start.** MCP tool
  calls now start it themselves. Before this, the extension only *looked* for a
  running daemon, so unless you had opened the Airtable dashboard (or run a formula
  command) that session quietly fell back to a per-window server — and **each VS
  Code window then drove its own Chromium against the same browser profile**. That
  collision is the failure this extension has historically shown you as "session
  dead". One shared daemon is the configuration that avoids it.
- **What you will notice:** one Airtable browser session shared by every window
  instead of one per window, fewer spurious "session dead" errors, and the daemon
  appearing in the dashboard without you starting it.
- **Stop still means stop.** A daemon you stop from the dashboard is not
  resurrected by the next tool call.
- **If the daemon cannot start, the extension falls back to the old per-window
  server** rather than leaving you with no MCP tools.
- **Fixed alongside it:** on `Bring your own cookie` / `Direct login`, a failed or
  stopped daemon used to leave the fallback server with no credentials at all —
  every tool call failed with a missing-credentials error. The fallback is now
  given credentials exactly when it is the one actually serving you.

### Fixed — login could report success when you were not signed in (issue #21) (2026-07-30)

- **Login declared success as soon as Airtable answered, and showed
  `User: undefined` even when it had worked.** The endpoint being polled
  (`getUserProperties`) turns out to carry **no identity whatsoever** — its
  signed-in response is a list of feature flags — so the user id being read had
  never existed, and any successful HTTP response counted as "logged in". In
  practice the login window could close about two seconds after opening, before an
  SSO redirect or a typed 2FA code could finish, and still report success.
- **Login now waits for Airtable to actually say who you are**, reading the signed-in
  user from the page itself, and every login path (dashboard login, CLI login,
  manual login) waits the same **5 minutes** — enough for SSO plus a hand-typed 2FA
  code. Previously these paths disagreed, one waiting 1 minute and the others 5.
- **The dashboard shows your user id only when it genuinely knows it**, and never
  carries one over from a previous session. In `Bring your own cookie` mode, where
  there is no page to read it from, it says so instead of showing a stale or made-up
  id. A missing user id is no longer treated as "signed out" — it is not evidence of
  anything, and treating it as such would have logged out working sessions.
- **`Direct login` now fails loudly with `DIRECT_LOGIN_UNVERIFIED`** when the login
  flow finishes and a session cookie exists but Airtable still serves no signed-in
  user — the same false success as above, on the browser-free path. It usually means
  an incomplete SSO or 2FA step: check your email/password/TOTP secret, or switch
  Auth Mode back to `browser`.
- **Session health checks retry before declaring a session expired.** The signed-in
  marker arrives with the page, so a single slow render used to read as "signed out"
  — and the extension answers that by relaunching the browser, so a false alarm cost
  a full browser launch. Login is also no longer killed at 2 minutes while it is
  still legitimately waiting for you to finish signing in.
- **CLI `doctor` and `status` now tell you different, true things.** `doctor`
  actually probes the session (`Session: signed in as usr…` / `NOT signed in —
  <reason>`) and reuses the running daemon's browser rather than opening a second one
  against the same profile. `status` reports only what is on disk and no longer
  claims anything about your session — it used to print `Session: not found` on
  perfectly healthy installs by looking for a file nothing writes any more.

### Pre-merge hardening pass — tool profiles, sync safety, packaging, transport, proxies, session recovery, logout (2026-07-25)

Pre-merge hardening pass on `feat/base-to-base-sync` before merging base-to-base
sync into `main`. Covers tool-profile safety, packaging, and — retroactively,
since it was never documented — the direct-HTTP transport rework this branch
already shipped.

#### Changed
- **`safe-write` no longer includes `sync_base`, and two new tool categories
  now default to *off* for existing `custom`-profile users.** `sync_base`
  reaches destructive operations (`mode=apply` under `policy=mirror` can
  delete tables, fields, views, sections and records), so it never belonged
  in a profile whose own description promises "no deletes" — and `safe-write`
  is the extension's default profile. It now lives in `full` only;
  `safe-write` drops from 55 to **54** tools (`read-only` stays 12, `full`
  stays 71). Separately, `sync` and `recordDestructive` are new categories on
  this branch, and every `airtableFormula.mcp.categories.*` setting defaulted
  to `true` — so a user already running the `custom` profile would have
  silently gained `sync_base` and `delete_records` on upgrade, with no action
  on their part. Both defaults are now `false`; the other 13 categories are
  unchanged. The same gap existed server-side: a pre-existing
  `~/.airtable-user-mcp/tools-config.json` with `activeProfile: "custom"` and
  no key at all for these newly-introduced tools resolved them to *enabled*
  (absent key → enabled). An absent key for `sync`/`recordDestructive` now
  resolves to disabled; a frozen `LEGACY_CATEGORIES_DEFAULT_ON` allowlist of
  the 13 pre-existing categories keeps their legacy enabled-by-default
  behavior for absent keys, so this doesn't silently regress the *next*
  category either. If you want `sync_base`, switch to the `full` profile or
  opt in explicitly under `custom`.
- **`sync_base` is now correctly annotated as destructive (`destructiveHint:
  true`)**, and the "read-only plan mode" wording that described only two of
  its five modes has been replaced everywhere it appeared (tool description,
  Settings UI, `CLAUDE.md`) with an accurate summary: `plan`/`diff`/`status`
  are read-only; `apply` mutates the destination and, with `policy=mirror`
  plus the confirmation flags, can delete tables, fields, views, sections and
  records; `reconcile` updates local mapping state only. MCP clients that gate
  tool calls on `destructiveHint` (auto-approve UIs, etc.) now correctly
  prompt for `sync_base`. (The Settings UI's "Record Write" row was also
  under-counting itself — "3 tools" instead of 4 — and missing
  `upload_attachment` from its list; both are fixed.)

#### Added
- **Direct-HTTP transport (shipped earlier on this branch — 2026-07-04 —
  never previously mentioned here).** This is the single biggest behavioral
  change on this branch for anyone who never touches sync: every Airtable API
  call used to run inside a headless Chrome page (`page.evaluate(fetch)`);
  it now goes over a direct Node HTTP client (`fetch` by default, opt-in
  Chrome-TLS-impersonation via `mcp.httpClient: "impit"`), with the browser
  demoted to login/credential-capture only. This is why a proxy-only network
  used to look like a healthy login with every tool call failing as
  `SESSION_INVALID` (see the proxy fix below) — Chrome used the OS proxy for
  the browser session, but Node's `fetch` did not for the actual API traffic.
  It also unlocked two browser-free credential modes exposed via
  `mcp.authMode`: `byo` (cookie-only, no browser) and `direct-login`
  (email+password+TOTP replaying Airtable's HTTP login flow). Users on the
  default `browser` auth mode see no behavior change beyond faster/steadier
  API calls and the proxy-visibility fix; this entry exists purely to close a
  documentation gap ahead of merge.

#### Fixed
- **The VSIX native-binary assertion now verifies the actual machine code, not
  just its labels.** The previous check validated package name, `package.json`
  `os`/`cpu`/`version`, filename, and a 4-byte magic number. Only the magic
  reads the bytes at all, and it distinguishes PE from ELF from Mach-O — that
  is, the operating system and nothing else. The `cpu` field was read from the
  vendored package's own manifest, never from the binary. So two whole classes
  of mis-vendored artifact passed clean, with a green tick: an **x64 binary
  swapped for an ARM64 one on the same OS**, and a **glibc build swapped for a
  musl build**. Both were reproduced as controls and both passed before this
  change. Every `.node` is now hashed and compared against
  `scripts/native-binary-digests.json`, which records the exact SHA-256 of
  every binary each platform package ships. Those digests are recorded from
  tarballs whose SHA-512 was verified against `pnpm-lock.yaml` **before**
  anything inside was hashed, so the expected values derive from the lockfile
  and never from the artifact being checked. A mismatch now also names the
  impostor ("these are the bytes of `impit-darwin-x64`… the binary for
  `darwin-x64`, not `darwin-arm64`"). A missing or stale pin fails packaging
  and assertion **closed** rather than falling back to the weaker check.
- **Vendored native binaries are re-validated on every reuse.** Cached
  platform packages under `.cache/vsix-platform-packages/` were verified once
  at download and thereafter trusted via a `.vendored.json` marker — a file
  living inside the very directory it vouches for, so anything able to alter
  the binaries could equally rewrite the marker. Cached contents are now
  re-hashed against the pinned digests before reuse, and a copy that fails is
  discarded and re-fetched.
- **The symlink-escape guard now covers foreign platform packages too.**
  `assertSafeSymlinks` protected the workspace vendoring path but not the
  registry-tarball path, even though that path unpacks with `tar` (which
  creates whatever symlinks the archive asks for) and then copies with
  `dereference: true`. A tarball could therefore have pulled a file from
  outside the tree into a published VSIX. Both paths now share one guard
  (`scripts/safe-symlinks.mjs`).
- **Wording: these are eight target artifact packaging/assertion smokes.**
  Earlier notes could be read as claiming all eight platform builds are
  runtime-tested. They are not, and cannot be from one machine: a single host
  can only `require()` the binding compiled for itself, so **only the host
  target's binding receives a genuine runtime smoke**. The other seven are
  verified by exact content — which is the strongest claim available, and why
  the digests above matter.
- **`sync_base`'s column-visibility comparison no longer produces a false
  negative.** Airtable's internal API omits the `visibility` key entirely for
  a visible column in some responses (absent = visible, explicit `false` =
  hidden); the sync engine's `apply`/`diff` column-visibility handling
  (`sync/apply.js`, `sync/remap.js`) previously treated an absent key as
  *hidden* instead, the opposite of `getView`'s own long-standing semantics.
  A source column returned without the key therefore compared as hidden
  against a dest column explicitly `false`, which **matched** — masking real
  column-visibility drift behind a false `converged`/`identical` verdict —
  and `apply` never re-showed that column on the destination. The predicate
  is now unified behind one function (`src/column-visibility.js`) shared by
  `client.js` and both sync sites. **This is a correctness fix, not a
  regression:** the drift was always real, just hidden by the comparison
  bug. A base pair that previously reported `sync_base mode=diff` as
  `converged`/`identical` may now correctly surface column-visibility drift
  on the next run — re-run `mode=apply` to converge it.
- **The daemon's orphan-process sweep (Stop button / `stopDaemon` command) no
  longer kills unrelated Node processes on a loose command-line match.** The
  previous kill criteria were an unanchored substring match against
  `index.mjs … daemon … start`, so any process whose argv merely *contained*
  those words — another vendor's MCP server, a build watcher, even a text
  editor with our bundled file open — could be force-killed along with its
  whole process tree. Kill criteria are now positive-attribution only: the
  exact bundled `dist/mcp/index.mjs` path **and** the daemon-start argv shape
  this install actually spawns, or the paired `.airtable-user-mcp` /
  `.chrome-profile` directories. A process that merely resembles a stray
  daemon but can't be attributed to this install is left alive and reported
  in the new `StopResult.skippedUnowned` instead of being killed on a guess.
- **The packaged VSIX now actually includes the `impit` and `@ngrok/ngrok`
  native (napi) binaries.** Both packages were correctly kept external by
  esbuild and their pure-JS loader was vendored into `dist/node_modules/`,
  but each ships its compiled binding in a *separate* per-platform
  optionalDependency (e.g. `impit-win32-x64-msvc`,
  `@ngrok/ngrok-win32-x64-msvc`) that was never copied — so
  `mcp.httpClient: "impit"` or the ngrok tunnel provider threw "Cannot find
  native binding" the first time either was used from an installed `.vsix`,
  even though the setting was selectable and looked present. The extension
  now ships **one VSIX per platform**, each vendoring exactly its own
  target's binaries — see the next entry.
- **The extension is now published as platform-specific VSIXes, one per
  supported desktop target.** Vendoring the build machine's own native
  binaries fixes the "Cannot find native binding" crash only for users on
  the same platform as the release runner — CI builds on `ubuntu-latest`, so
  a single untargeted VSIX would carry Linux-x64 binaries and leave
  `mcp.httpClient: "impit"` and the ngrok tunnel provider broken on Windows
  and macOS. The release workflow now builds and publishes eight targeted
  artifacts (`win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`,
  `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`) to both the VS
  Code Marketplace and Open VSX; VS Code installs the one matching each
  user's machine. The matrix lives in one place
  (`scripts/vsix-targets.mjs`), foreign-platform packages are fetched as
  plain tarballs and verified against the **version and integrity hash
  already recorded in `pnpm-lock.yaml`** (so a published VSIX can never carry
  an impit/ngrok build other than the tested one), and every artifact is
  checked by `scripts/assert-vsix-binaries.mjs` before it can be published —
  which asserts both that the target's expected `.node` files are present and
  that no other platform's are, since a wrong-platform binary fails exactly
  like a missing one but looks correct on the build machine.
  - **No untargeted fallback is published.** An untargeted VSIX is only ever
    correct on the machine that built it, so shipping one as a catch-all
    would reintroduce the original bug for everyone else.
  - **`linux-armhf` (32-bit ARM) is deliberately not published.** `impit`
    publishes no `arm-gnueabihf` binary, so an armhf build would advertise
    the `impit` HTTP client in its settings UI and then fail the moment it
    was selected. VS Code reporting the extension as unavailable on armhf is
    the honest outcome; the target can be added the day impit ships that
    artifact.
  - The standalone npm package `airtable-user-mcp` is **unchanged and stays
    universal** — npm resolves the correct optional dependency on the user's
    own machine at install time, so it needs no per-platform publishing.
  - Local packaging (`pnpm packx`) now also produces a targeted VSIX for the
    host platform rather than an untargeted one, so what a developer
    sideloads has the same shape as what users receive.
- **Logging out now actually stops the daemon serving your session.** The Command-Palette "Airtable: Log out" cleared the OS keychain and tried to delete the browser profile, but never told the running daemon — which keeps the live browser session (browser mode) or the injected cookie/credentials (byo / direct-login) in memory — so tool calls kept working after the user believed they had logged out. Only the dashboard's logout button did part of this. Both entry points now run one path that also releases the daemon's browser and restarts it to drop in-memory credentials. Releasing the browser first also frees the profile directory, so the profile wipe no longer silently fails on Windows. If the daemon cannot be confirmed stopped — it can be alive but slow enough to miss its health probe — logout escalates to a daemon restart/force-stop, and when even that fails it now says so instead of reporting success. The profile wipe is retried after that restart (a profile the daemon's Chromium had locked can only be removed once it is gone), and a profile still on disk is never reported as a cleared session: it holds live Airtable cookies, and the next daemon would authenticate straight from it.
- **`npx airtable-user-mcp logout` (standalone CLI) got the same treatment**: it stops a running daemon before wiping the profile, and a wipe that genuinely fails is reported as a failure ("Could not clear the browser session at …") instead of the previous, exactly-backwards "No session to clear."
- **A dead session can be recovered without restarting the daemon.** After repeated rejected requests the server latches a dead-session circuit-breaker that fails every subsequent call fast. In browser mode nothing cleared it: re-logging in from the dashboard left the daemon in the same state, and only a daemon restart helped. It is now cleared whenever a freshly verified session is established — including the browser release the dashboard performs right before an interactive login — while still latching on failures that persist across the server's own internal recovery attempts.
- **Airtable API calls now honour `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`.** Node's built-in `fetch` deliberately ignores the proxy environment variables that curl, git and Chrome all respect. Since all Airtable traffic moved off the browser page and onto direct HTTP, that produced a uniquely confusing failure on networks that only reach the internet through a proxy: the browser login succeeded (Chrome uses the OS proxy), so the dashboard could show a healthy session, while every MCP tool call failed and was reported as `SESSION_INVALID` — as if the Airtable login had expired. The transport now attaches undici's `EnvHttpProxyAgent` whenever those variables are set, including `NO_PROXY` bypass matching, so tool calls take the same route as the browser. Nothing changes when no proxy is configured. Browser-free login (`AIRTABLE_AUTH_MODE=direct-login`) goes through the same dispatcher.
- **A failed network call now says what actually failed.** undici collapses every network/TLS error into the message `fetch failed` and hides the real reason in `err.cause`; the daemon logged (and the extension surfaced) only that. The cause chain is now unwrapped into the error, and two common misconfigurations get explicit advice: a rejected certificate points at `NODE_EXTRA_CA_CERTS`, and an unreachable network with no proxy configured points at `HTTPS_PROXY`.

#### Known limitations (tracked, not fixed)
- **TLS-inspecting proxies still need `NODE_EXTRA_CA_CERTS`.** Routing through the proxy is only half of it: a proxy that re-signs HTTPS with a private root certificate is rejected by Node, which uses its own bundled CA list rather than the OS trust store — so the browser (OS trust store) keeps working while API calls fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN`. **Workaround:** set `NODE_EXTRA_CA_CERTS=/path/to/corp-root.pem` in the environment that launches VS Code, then restart it — the extension spawns the daemon with the full inherited environment, so the setting reaches every code path. No code change is planned: Node offers no supported way to read the OS trust store, and the error message now names this fix.
- **`AIRTABLE_HTTP_CLIENT=impit` does not use the proxy.** The optional impit (Chrome-TLS-impersonation) client takes an explicit proxy URL and has no `NO_PROXY` support, so honouring the environment there would be a partial, misleading implementation. **Workaround:** behind a proxy, leave `mcp.httpClient` on the default `fetch`.
- **`ALL_PROXY` is not honoured** (neither is it by Node ≥24's own `NODE_USE_ENV_PROXY`). Setting it alone logs a warning naming the fix. **Workaround:** set `HTTPS_PROXY` (plus `NO_PROXY`).
- **Session health and tool calls can still disagree when the daemon is disabled.** With the daemon on (`airtableFormula.mcp.useDaemon`, default `true`) the dashboard's health check runs over the same HTTP transport as tool calls, so it fails the same way and reports the session as invalid. With the daemon disabled, the extension falls back to a forked browser health check, which uses Chrome's own networking — it can report a valid session while direct-HTTP tool calls fail on a proxy/CA problem. The failure is no longer silent (the tool error names the proxy/CA cause), but the two paths are not unified.

### Formula round-trip + daemon upload fixes (2026-07-09)

#### Fixed
- **MCP server — formula downloads emit real field names.** `download_base_formulas` / `download_formula_field` used to write Airtable's internal `{column_value_fldXXX}` refs verbatim — unreadable, and rejected by Airtable on re-upload ("Unknown field names"). Refs are now resolved to `{Field Name}` (native syntax); unknown ids fall back to `{fldXXX}`, which the API accepts. Non-field placeholders (`{FOO_PLACEHOLDER}`) pass through untouched.
- **MCP server — formula writes normalize legacy refs.** All formula write paths (`create_formula_field`, `update_formula_field`, `update_field_config`, `validate_formula`) convert `{column_value_fldXXX}` → `{fldXXX}` before sending, so previously-downloaded files round-trip without manual rewriting.
- **Extension — "Upload formula" no longer fails with HTTP 406.** The right-click upload/download commands' daemon HTTP client now sends the MCP-spec-required `Accept: application/json, text/event-stream` header, and parses both JSON and SSE-framed responses (older daemons). The daemon side now answers stateless `/mcp` POSTs as plain JSON (`enableJsonResponse`).
- **MCP server — `list_fields` lightweight by default**: returns `{ id, name, type }`; full `typeOptions` is opt-in via `includeOptions: true` (previously ~350K chars on a wide table). The installed AI-skill template and `server.json` tool listing were updated to match.
- **Language services — field names with special characters no longer produce false errors.** With downloads now emitting real `{Field Name}` refs, names containing apostrophes (`{Owner's List}`), parentheses (`{Total (USD)}`), or smart quotes (`{Owner’s List}`, common via Airtable UI autocorrect) used to trigger spurious `Unclosed quote` / `Missing closing parenthesis` / `Smart quote` Errors in the `.formula` editor — and the smart-quote quick fix would rename the ref into a dangling reference. The paren/bracket/quote/smart-quote checkers now skip `{…}` field-ref bodies (real errors outside refs still report; an unclosed `{` still reports).

### MCP server — sync_base schema-orphan deletion under mirror (2026-06-21)

#### Added
- `sync_base mode=apply` — **schema-orphan deletion** (`pruneSchema`): under `policy=mirror`, dest-only fields/views/tables that have no counterpart in the source are deleted from the destination after `applyPlan` completes. Two independent gates: `confirmDeletions:true` is required to delete dest-only **fields and views** (same flag as `pruneRecords`); the new `confirmTableDeletions:true` is required to drop dest-only **tables** — `confirmDeletions` alone never deletes an entire table. Without each gate the operation is a dry-count only (`DELETION_GATED` for fields/views, `TABLE_DELETION_GATED` for tables). Deletion is dependency-safe: fields are deleted without `force` (so no matched field is ever cascade-deleted), orphan→orphan formula dependencies are resolved by retry-until-stable, and a field blocked by a matched-field dependency is kept and reported as `SCHEMA_DELETE_BLOCKED`. Deletion order: views first (no dependents), then fields, then tables (after their content). Applied counts are surfaced in the result as `schemaDeleted` (fields + views) and `tablesDeleted`; failures are continue-on-failure warnings (`SCHEMA_DELETE_FAILED`). Per-table `policyOverrides` are respected — `overlay`/`preserve` tables are never pruned. Module: `src/sync/prune-schema.js`. Deferred: retypes, view-section orphan deletion, attachment-strip (M4).

### MCP server — sync_base natural-key record matching (2026-06-21)

#### Added
- `sync_base` — **natural-key record matching** (`naturalKeys: { [tableName]: fieldName }`): matches dest↔source records by a shared key field's value (resolved by name per base) and grows `idmap.records` without any write to either base. Add-only + ambiguity-safe: existing mappings are never overwritten, already-mapped dest records are never re-claimed, and ambiguous/duplicate key values are skipped with a `NATURAL_KEY_AMBIGUOUS` warning; a missing key field emits `NATURAL_KEY_FIELD_MISSING`. Runs in two places: (1) **`mode=reconcile`** — after the existence-prune, snapshots source records and calls the matcher, then saves the updated idmap; (2) **`mode=apply` auto pre-pass** — runs before Pass 1 and before `pruneRecords`, so records `mirror` no longer treats real-but-unmapped dest records as orphans and re-syncs no longer duplicate them. The key field must be stable across bases (autoNumber renumbers → bad key; name/email/injected `InjectID` → good key). Single-field keys only; composite keys and value normalization are deferred. A `matched` count is returned in the result.

### MCP server — sync_base reconciliation policy + custom field mappings (2026-06-20)

#### Added
- `sync_base mode=apply` — **records reconciliation policy**: new `policy` param (`mirror` | `overlay` | `preserve`, default `overlay`) controls two independent axes — **extras** (keep or remove dest-only records) and **conflicts** (source-wins or dest-wins when both bases hold the record). Presets: `mirror` = {remove, source-wins} (make dest identical to source), `overlay` = {keep, source-wins} (default — today's existing behavior), `preserve` = {keep, dest-wins} (never overwrite dest edits). `policyOverrides` (`{ [tableName]: preset }`) overrides the global preset per table.
- `sync_base mode=apply` — **deletion gate** (`confirmDeletions`): under `mirror` policy (or any table override that removes extras), dest-only orphan records are not deleted unless `confirmDeletions: true`. Without it, `pruneRecords` reports a `DELETION_GATED` warning with the would-delete count and does nothing — poll `mode=status` to see counts, then re-run with `confirmDeletions:true` to apply. Separately, `createTable` unconditionally clears the ~3 blank scaffolding rows it seeds (best-effort; `SCAFFOLDING_ROWS_KEPT` warning if the deletion attempt fails); `pruneRecords` under `mirror`+`confirmDeletions` additionally removes any leftover dest-only blank rows as part of the ordinary orphan prune. Attachment-strip under mirror remains a deferred follow-up (schema-orphan deletion and natural-key matching shipped separately).
- `sync_base` — **custom field mappings** (`fieldMappings: { [tableName]: { sourceFieldName: destFieldName } }`): inject a source field's value (including computed fields like `autoNumber` or formula) into a different writable scalar dest field during record sync. Classic use: inject a source `autoNumber` field (`Code`) into a writable dest text field (`InjectID`) so a dest primary-key formula can reconstruct original identity across bases. Fail-fast pre-flight validation aborts `mode=apply` synchronously on any error (`FIELD_MAP_INVALID`); `mode=plan` and `mode=diff` run the same validation as a dry check and return errors in `fieldMappingErrors` (machine output). Validation codes: `FIELD_MAP_TABLE_MISSING`, `FIELD_MAP_SOURCE_MISSING`, `FIELD_MAP_TARGET_MISSING`, `FIELD_MAP_TARGET_COMPUTED` (dest must be writable scalar), `FIELD_MAP_TYPE_INCOMPATIBLE` (array-typed source/dest rejected), `FIELD_MAP_COLLISION` (two sources targeting the same dest).

### MCP server — sync_base compare, curatable changeset, selective apply (2026-06-19)

#### Added
- `sync_base mode=diff` (read-only): comprehensive schema comparison of two bases via a new pure `src/sync/compare.js`. Every difference is classified as **drift** (sync enforces it — table/field/view existence, field type/options/choices, view filters/sorts/groups content, column visibility, colors/cover/frozen/rowHeight, primary, form), **best-effort** (sync applies but doesn't guarantee — field/view/column order, sort/group clause order), or **not-synced** (view sections, now captured by the snapshot). Two verdicts: `identical` (zero diffs) and `converged` (zero drift; best-effort/not-synced may remain). The full diff is persisted to `~/.airtable-user-mcp/sync/<src>__<dest>/diff-<id>.json`; the tool returns a token-budgeted DIGEST (verdicts + class counts + per-table count rollup + a capped driftSample, ≤25). Drill into one table via `mode=diff detail="<table>"` (params: `detail`, `diffId`, `offset`, `limit`).
- `sync_base mode=plan` now emits a curatable **changeset**: each action carries a stable name-based `changeId` (`<op>|<table>|<target>`), a `class`, and an `apply:true` flag; the digest includes a `sample` + an `editHint`. New `direction` param (`to-dest` default | `to-source`) targets either base as the destination.
- `sync_base mode=apply` accepts a `skip:[changeId]` list (and honors `apply:false` on changeset entries) → applies everything except the removed changes. Journal-safe; skipped dependencies degrade gracefully to UNRESOLVABLE_REF.

#### Fixed
- `sync_base mode=apply` field creation — **autoNumber** fields now create. The read-only runtime counter `maxUsedAutoNumber` is stripped from `typeOptions` before `createField` (the internal API rejected it with 422 "options not valid").
- `sync_base mode=apply` field creation — **count** fields now create. `toWritableComputedOptions` emitted the public-REST key `recordLinkFieldId`, but internal-API snapshots store a count's link under `relationColumnId` (like rollup) and the count create path passes `typeOptions` through untranslated — so every count field 422'd "options not valid". It now reads/emits the internal `relationColumnId`. (Both fixes validated live by converging a full base copy: 5 autoNumber + 3 count fields that previously failed now create cleanly.)
- `sync_base mode=apply` — **createTable scaffolding rows are now removed** (clean mirror). A new table is seeded with ~3 blank rows (like the 6 default fields); apply already deleted the scaffolding fields but left the rows, so every synced table carried blank rows. The rows are now cleared right after create (best-effort; `SCAFFOLDING_ROWS_KEPT` warning on failure). Live-confirmed: createTable → 3 rows → 0.
- `sync_base mode=diff` / view convergence — **empty-predicate filter representations no longer report false drift.** Airtable's internal API stores the same emptiness check two equivalent ways (`isNotEmpty`/null ≡ `!=`/"" and `isEmpty`/null ≡ `=`/""): a source base holds the named-operator form, the dest holds the `=`/`!=` form after the sync applied it. `canonFilterSet` now normalizes these (only when the value is genuinely empty — `0`/`false` are preserved), so semantically-equal filters compare equal in the diff report and stop re-emitting `applyViewConfig` every apply.

### MCP server — sync_base record sync (2026-06-17)

#### Added
- `sync_base mode=apply`: after schema + view sync, launches a **background** record sync and returns a `jobId` immediately. Two-pass: Pass 1 creates/updates scalar + single/multi-select cells (computed fields + computed primary are never written) and fills a persisted `idmap.records` (rec→rec map); Pass 2 writes linked-record cells (remapped via record map, unresolved targets reported). Attachments are then downloaded from source and re-uploaded to dest (deduped by filename+size). Record-referencing view filters that were stripped during view sync are restored once records exist. Throttling is handled by per-request 429 backoff in the auth queue; resumable (records journal, per-chunk persist) and continue-on-failure (per-record errors are warnings, not aborts).
- `sync_base mode=status`: poll a background record job by planId — returns running/done/failed plus live records-mapped count.
- `sync_base mode=reconcile`: **prune** dead record-map entries (existence-prune). Per-table natural-key re-match is planned (not yet implemented); reconcile does not de-duplicate records.

### MCP server — sync_base collaborative view sync (2026-06-17)

#### Added
- `sync_base`: full collaborative-view sync — create views + mirror filters, sorts, group levels, field visibility + column order, frozen columns, color config, cover, calendar date columns, form metadata, and row height, with source→dest field+choice ID remapping, per-view-type anchor validation + grid fallback, applied after fields. Idempotent (convergent canonical compare). Personal views skipped; orphan views reported (not deleted).

### MCP server — sync_base mode=apply (2026-06-16)

#### Added
- `sync_base mode=apply`: execute a saved base-to-base schema plan against the destination — creates tables, reconciles the primary, creates scalar/link/computed fields (source→dest reference remapping + dest-space formula validation), and applies non-destructive field updates. Drift-guarded (aborts if the destination changed since the plan) and resumable via an on-disk journal. Type-changing retypes, deletions, records, and views are out of scope for this release.

### LSP server — fix runtime startup + CI bin-link warning (2026-06-12)

- **`airtable-user-lsp` was runtime-broken when executed with Node directly**
  (both `--stdio` and `--tcp` — i.e. every editor config using
  `npx -y airtable-user-lsp` and the daemon's TCP spawn): the bundle imported
  the extensionless `vscode-languageserver/node` subpath, which Node's ESM
  resolver rejects because that package ships no `exports` map (build tools
  resolve it bundler-style, which is why tsup/vitest never caught it). Fixed
  with explicit `/node.js` deep imports. A second masked failure —
  `Dynamic require of "util" is not supported` from CJS code bundled into the
  ESM output — is fixed with a `createRequire` banner in
  [`tsup.config.ts`](packages/lsp-server/tsup.config.ts) (same pattern
  `bundle-mcp.mjs` already uses). Both modes smoke-tested via the real bin.
- **CI install warning eliminated:** the `airtable-user-lsp` bin pointed at
  `dist/index.mjs`, which doesn't exist at install time on fresh checkouts, so
  every CI run logged `WARN Failed to create bin … ENOENT`. The bin now points
  at a committed launcher shim ([`bin/airtable-user-lsp.mjs`](packages/lsp-server/bin/airtable-user-lsp.mjs))
  that defers to the built entry and prints an actionable error when `dist/`
  is missing.
- Known follow-up (pre-existing, unchanged): the extension never bundles an
  LSP copy at `dist/lsp/index.mjs`, so the daemon's first spawn candidate is
  dead in installed extensions; editors use the npm package instead.

### Dashboard — named-tunnel hostname display + confirmed prompt saves (2026-06-12)

- **`TunnelState.namedTunnelHostname`** (new optional shared-protocol field):
  the extension now reads the hostname from `cloudflared-named.yml` (same
  mechanical format the daemon writes) and the Setup tab shows a
  "Configured: <hostname>" row for the named-tunnel provider, relabels the
  input "New Hostname (optional)", and explains that leaving it empty reuses
  the configured tunnel ([`types.ts`](packages/shared/src/types.ts),
  [`DashboardProvider.ts`](packages/extension/src/webview/DashboardProvider.ts),
  [`Setup.tsx`](packages/webview/src/tabs/Setup.tsx)).
- **PromptEditor waits for confirmation**: `savePrompt`/`deletePrompt`/
  `resetPrompt` now return their action id, `markActionDone` records a
  consumable per-action result, and the editor navigates back only after the
  extension confirms success — a failure keeps the editor open with the
  user's input intact and shows an inline error
  ([`store.ts`](packages/webview/src/store.ts), [`Prompts.tsx`](packages/webview/src/tabs/Prompts.tsx)).
  3 new store tests cover the id/result round-trip.

### Dashboard — second-pass dead-end & cosmetics sweep (2026-06-12)

A targeted second audit (flow dead-ends, unreachable conditional UI, stale
affordances, cosmetics) confirmed 12 more issues; all fixed:

- **ngrok auth token now has an update path** — once a token was stored, the
  input vanished forever (`!ngrokAuthtokenSet` gate) and the existing
  `setNgrokAuthtoken` store action was never wired to any UI. A "token
  stored" chip with a **Replace…** flow now lets users rotate/update the
  token without disabling the tunnel ([`Setup.tsx`](packages/webview/src/tabs/Setup.tsx)).
- **PromptEditor feedback** — Save/Reset/Delete now disable (+`aria-busy`)
  while the action is in flight ([`Prompts.tsx`](packages/webview/src/tabs/Prompts.tsx)).
- **Token/PAT buttons** — Copy Token tracks pending state and disables;
  Rotate is daemon-scoped (`beginDaemonAction`) and disables with the other
  daemon controls; Copy PAT disables while busy ([`store.ts`](packages/webview/src/store.ts)).
- **Credentials form state** — email is now cleared along with password/OTP
  on save, and Cancel resets all fields (stale pre-filled email no longer
  reappears on "Update credentials") ([`Settings.tsx`](packages/webview/src/tabs/Settings.tsx)).
- **Cosmetics:** input padding unified at `6px 10px` across tunnel/PAT/
  credentials fields; helper text consistently `--fg-subtle`; daemon button
  row gap aligned to 8px; chip casing normalized (Ready/Missing/Via
  extension); repeated uppercase-label inline styles extracted to a shared
  `.uppercase-label` class; the ngrok section's state-dependent spacing
  asymmetry (introduced by the hostname-field fix) removed.

### Setup tab — Cloudflare Named Tunnel hostname field (2026-06-12)

Selecting **Cloudflare Named Tunnel** and pressing Enable always failed with
"Named tunnel requires a hostname (domain)" — the Setup tab never rendered a
field to enter one (only ngrok had inputs). Fixes:

- New **Hostname** input shown when `cf-named` is selected, with helper text
  (Cloudflare-managed domain, one-time browser login, empty = reuse existing
  config) ([`Setup.tsx`](packages/webview/src/tabs/Setup.tsx)).
- `handleEnableTunnel` now sends the hostname for `cf-named` (it previously
  sent the ngrok field's value for every provider).
- Same bug class for ngrok: the **Reserved Domain** field was hidden once an
  authtoken was stored — it now always renders for ngrok.
- Host-side fallback: if the setup flow is reached without a hostname (e.g.
  via a command), an input box prompts for it instead of dead-ending; the
  post-setup enable retry uses the resolved hostname (previously re-sent the
  original empty value) ([`DashboardProvider.ts`](packages/extension/src/webview/DashboardProvider.ts)).

### Daemon Stop reliability + dashboard UI/UX hardening (2026-06-12)

**Daemon Stop button** — root-caused "stop sometimes does nothing":

- [`daemon-manager.ts`](packages/extension/src/mcp/daemon-manager.ts) `stopDaemon()`
  now mirrors the CLI launcher semantics: verifies the shutdown HTTP response
  (a 401 from a stale lockfile token no longer counts as success), waits for
  the daemon to release `daemon.lock` before reporting done, escalates
  SIGTERM → SIGKILL when the daemon answers but won't exit, and reclaims
  stale lockfiles so a crashed daemon can't leave the dashboard stuck on
  "running". When the port is unreachable, the recorded pid is *not* killed
  (PID-reuse safety) — the stale lock is just removed.
- **No more auto-resurrect:** with `useDaemon` + `loginMode: auto`, VS Code
  re-querying MCP definitions used to respawn the daemon seconds after the
  user stopped it (via `getCredentials → ensureDaemon`). A user-stopped latch
  now blocks implicit respawns; explicit Start/Restart clears it.
- Stop failures are surfaced in the UI / `stopDaemon` command instead of
  silently reporting success. 6 new DaemonManager tests.

**Dashboard webview** — 26 confirmed findings from a 44-agent UI/UX audit
(action feedback, state sync, theming, accessibility, content):

- **Action feedback:** every async store action now tracks pending state
  (`refresh`, `selectCustomBrowser`, `setBrowserChoice`, `copyAirtablePat`,
  `openStoragePath` were missing it), and pending actions **auto-expire**
  (60s default; longer for login/downloads) so a lost `action:result` can
  no longer leave buttons disabled forever ([`store.ts`](packages/webview/src/store.ts)).
- **State sync:** `pushState()` is serialized + coalesced (concurrent file-watch
  bursts could previously post a stale `state:update` last); the dashboard
  re-syncs on `onDidChangeVisibility` when the sidebar is re-opened;
  `daemon:start` reports failure when the daemon manager is unavailable; the
  toolProfile fallback now includes all 13 categories (was missing
  `recordRead`/`recordWrite`); dropped webview messages are logged
  ([`DashboardProvider.ts`](packages/extension/src/webview/DashboardProvider.ts), [`vscode.ts`](packages/webview/src/lib/vscode.ts)).
- **Theming:** fixed undefined `--accent-green` token (Overview update badge);
  LSP badges and error/warning banners now use theme tokens instead of
  hard-coded rgba; new `--border-error/--border-warn/--bg-lsp-*` tokens.
- **Accessibility:** global `:focus-visible` outlines for buttons/inputs/selects
  (credentials form and icon-only buttons had none); `--fg-muted` brightened
  from 2.86:1 to ~4.8:1 contrast (WCAG AA); login-mode toggle gets
  `role="switch"` + aria-label; daemon buttons get `aria-busy`; disabled
  buttons get `cursor: not-allowed`.
- **Content:** raw exception text (auth errors, browser download failures) is
  now mapped to human-readable guidance with the raw detail in a tooltip
  ([`friendlyError.ts`](packages/webview/src/lib/friendlyError.ts)); TOTP and
  bearer-token jargon explained inline; tunnel URL row in Daemon Status is
  responsive with a Copy button (was fixed 60% truncation, no copy); IDE
  detection shows an animated skeleton instead of static "Loading...".

### Security hardening — critical-tier fixes from full-codebase audit (2026-06-12)

A multi-agent security audit (71 findings raised, 49 confirmed under adversarial
verification — full report in `.planning/audits/2026-06-12-hardening-audit.md`)
produced these fixes for the highest-impact tier:

- **`daemon.lock` no longer world-readable** ([`lockfile.js`](packages/mcp-server/src/daemon/lockfile.js)) —
  the lockfile carries the plaintext daemon bearer token but was created with
  default permissions. `acquire()` now opens with mode `0o600`, `replace()`
  stages its temp file at `0o600` (via `safeAtomicWriteFileSync`), and both
  apply the same Windows ACL restriction `daemon.token` already used. The LSP
  server's `port_lsp` writer ([`lockfile-writer.ts`](packages/lsp-server/src/lockfile-writer.ts))
  stages at `0o600` too so its atomic rename doesn't undo the hardening. The
  shared `applyPrivatePermissions` helper ([`token.js`](packages/mcp-server/src/daemon/token.js))
  is now exported and sanitizes `USERNAME`/`USERDOMAIN` before building the
  icacls principal.
- **Login credentials moved off the child environment** ([`auth-manager.ts`](packages/extension/src/mcp/auth-manager.ts),
  [`login-runner.js`](packages/mcp-server/src/login-runner.js)) — auto-login
  previously passed `AIRTABLE_EMAIL`/`AIRTABLE_PASSWORD`/`AIRTABLE_OTP_SECRET`
  via env, visible in `/proc/<pid>/environ` and core dumps. The runner now
  requests credentials over the `fork()` IPC channel
  (`request-credentials` → `credentials` handshake) with env retained only as
  a standalone-use fallback. The VS Code MCP stdio definition
  (`registration.ts`) still uses env — VS Code owns that spawn and env is the
  only channel there.
- **Unknown tool profile now fails closed** ([`tool-config.js`](packages/mcp-server/src/tool-config.js)) —
  a hand-edited or corrupted `tools-config.json` with an unrecognized
  `activeProfile` used to silently enable **all 66 tools** including
  destructive ones; it now falls back to the `read-only` set and logs a
  warning. `tools-config.json` is also written `0o600`.
- **Release workflow supply-chain pinning** ([`release.yml`](.github/workflows/release.yml)) —
  `@vscode/vsce@3.9.2` / `ovsx@1.0.1` installed with exact pins, all
  invocations use `npx --no-install` (publish tokens are in scope of those
  steps), and Marketplace/npm version replies are validated as strict semver
  before being interpolated into version-bump scripts.
- **VSIX packaging symlink guard** ([`prepare-package-deps.mjs`](scripts/prepare-package-deps.mjs)) —
  the `dereference: true` copy follows every symlink in the copied packages;
  a trojanized dependency could ship a symlink at `~/.ssh` or CI credentials
  and have the target land in the published VSIX. The build now walks each
  package tree (cycle-safe, through directory-symlink targets) and fails if
  any symlink resolves outside the workspace `node_modules` tree.
- **Daemon token hygiene** ([`server.js`](packages/mcp-server/src/daemon/server.js),
  [`cli.js`](packages/mcp-server/src/cli.js)) — bearer comparison is now
  constant-time (`crypto.timingSafeEqual`), and `airtable-user-mcp daemon
  status` redacts the bearer token instead of printing it into shell
  history/scrollback.

Tests: mcp-server 273 (incl. new fail-closed profile test), extension 65,
lsp-server 21 — all pass; `check:tool-sync` green; packaging script verified
against the real pnpm tree; IPC handshake smoke-tested end-to-end.

### Extension — Windsurf renamed to Devin Desktop, legacy-compatible (2026-06-05)

Cognition rebranded the Windsurf editor to **Devin Desktop** on 2026-06-02 (in-place OTA rename) and moved workspace AI assets from `.windsurf/` to `.devin/`, keeping `.windsurf/` as a read fallback (Windsurf-import is on by default).

- **Relabel:** the Setup IDE picker and auto-config now show **"Devin Desktop (Windsurf)"** / **"Devin Desktop Next (Windsurf Next)"** ([`ide-configs.ts`](packages/extension/src/auto-config/ide-configs.ts), [`Setup.tsx`](packages/webview/src/tabs/Setup.tsx), [`Prompts.tsx`](packages/webview/src/tabs/Prompts.tsx)).
- **AI-files install** ([`skills/installer.ts`](packages/extension/src/skills/installer.ts)) now **dual-writes** skills/rules/workflows to both `.devin/{skills,rules,workflows}/airtable-formula.md` (new primary) and `.windsurf/…` (legacy — for pre-rebrand Windsurf + the vendor import path); `checkAiFiles` reports "ok" if either exists. New optional `AiInstallConfig.legacy` field drives this.
- **Unchanged (back-compat):** the `windsurf` / `windsurf-next` IDE ids and the `.codeium/windsurf*/mcp_config.json` MCP config paths — the `.codeium` tree is unchanged per the vendor docs.
- Tests: [`installer.test.ts`](packages/extension/src/test/installer.test.ts) covers the `.devin` primary, the `.windsurf` legacy fallback, and dual-write for both ids. Full build + extension (65) + webview (35) tests pass.

### MCP Server 2.5.0 — Record Templates (9 new tools) + round-4 user-report fixes (2026-05-01)

Promotes record templates to a first-class MCP capability. Templates are
the saved row scaffolds that Airtable surfaces under the "+ Add record"
flyout and inside the row-create extension — previously not addressable
through any public or internal API client we had. Discovered by capturing
the rowTemplate endpoints with `pnpm capture:cdp:mutations` while the
reporter exercised every template UI path.

**New tools (9):**

| Tool | Category | Purpose |
|:-----|:---------|:--------|
| `list_record_templates` | read | List record templates for a table |
| `create_record_template` | table-write | Create a template (client-side `rtp...` ID like view sections use `vsc...`) |
| `rename_record_template` | table-write | Rename a template |
| `update_record_template_description` | table-write | Set or clear a template's description |
| `set_record_template_cell` | table-write | Set a cell value in a template (static, linked rows, or linked templates) |
| `set_record_template_visible_columns` | table-write | Choose which columns the template surfaces in its UI |
| `duplicate_record_template` | table-write | Clone an existing template |
| `apply_record_template` | table-write | Apply a template — creates a new record using the template's cell defaults |
| `delete_record_template` | table-destructive | Delete a template |

**Round-4 fixes (carried into 2.5.0 from interim 2.4.4 work):**

- `set_view_columns` now filters the primary column out of the move step
  before calling `moveVisibleColumns` — Airtable rejects any move that
  displaces the pinned primary at index 0.
- `reorder_view_fields` `mergePartialFieldOrder` protects the primary
  column at index 0; user-requested moves to index 0 are clamped to 1.
- `update_view_group_levels` always sends `emptyGroupState: 'hidden'`;
  Airtable's API rejects `'visible'` with INVALID_REQUEST.
- `list_tables` now reads `data.tableById` as a fallback when
  `tableSchemas` / `tables` / `tableDatas` are absent (matches the shape
  the reporter saw).
- `update_view_filters` `isWithin` corrected: requires `timeZone` (IANA)
  and `shouldUseCorrectTimeZoneForFormulaicColumn: true`, no `exactDate`,
  modes are `thisCalendarMonth` / `thisCalendarYear` (not `thisMonth` /
  `thisYear`). Tool description and AI skill template updated.

**Counts:** 52 → **61 tools**. `read-only` profile: 8 → 9. `safe-write`
profile: 39 → 47. `full` profile: 52 → 61.

mcp-server: 2.4.4 → 2.5.0.

### MCP Server 2.4.3 — `list_view_sections` full fix (carry-over from 2.4.2)

Probed the schema read response with a fresh patchright session against
a base that has sections (`packages/mcp-server/dev-tools/debug-sections.js`,
new `pnpm probe:sections` script). Found that sidebar sections live at
`data.tableSchemas[N].viewSectionsById` — NOT `viewSections` like the
WebSocket realtime delta model uses. 2.4.0 + 2.4.1 read the wrong key,
which is why the sections array came back empty.

`listViewSections` now reads from `viewSectionsById` first, falls back
to `viewSections` for fixture/test compatibility, falls back to the
2.4.2 ID-only-from-tableViewOrder path if both are absent. The rich
shape (`name`, `viewOrder`, `pinnedForUserId`, `createdByUserId`) is
fully restored on real bases.

mcp-server: 2.4.2 → 2.4.3.

### MCP Server 2.4.2 — User follow-up bugs (report 2026-05-01)

After upgrading to 2.4.0 and running real end-to-end view-rollout work,
the reporter surfaced two bugs in the new tooling. Both fixed here.

**Bug 1 — `set_view_columns` orchestration 422'd at the move step** (P1).
The internal step 3 looped per-id `moveVisibleColumns([id], i)` starting
at index 0. That fails reliably because grid views pin the primary
column at visible index 0 (you can't move anything else there) and
per-id moves of an already-correctly-positioned column also fail.
Steps 1 and 2 (hide-all + show-the-set) succeeded, so visibility was
correct but column order was untouched.

Fix: replace the loop with one batched `moveVisibleColumns(visibleColumnIds, 1)`
call — the entire ordered list is inserted starting at visible index 1,
after the pinned primary. Verified by the reporter's workaround snippet
on 11 grid views (100% success rate). Test updated to match.

**Bug 2 — `list_view_sections` returned empty `sections`** (P2, partial fix).
On the reporter's base, `table.viewSections` is absent from the cached
`application/{appId}/read` response even when `tableViewOrder` clearly
contains `vsc...` IDs. The full fix needs a network capture from a base
with sections to discover where the section objects actually live in
the schema response (none of our existing captures cover this — they
were either mutations-only or pre-section).

Partial fix shipped here: when `viewSections` is empty but
`tableViewOrder` contains `vsc...` IDs, surface them as bare-id entries
with `name: null`, `viewOrder: null`, `partial: true`, and a top-level
`introspectionPartial: true` flag with a `introspectionNote` explaining
the limitation. The agent at least knows which section IDs exist and
can pass them to `move_view_to_section` / `rename_view_section` /
`delete_view_section` (all of which still work for side effects).

mcp-server: 2.4.1 → 2.4.2.

### MCP Server 2.4.1 — Hotfix: bundled server crashed on startup

Released hours after 2.4.0. The bundled extension copy of the MCP
server crashed immediately on every spawn with `MODULE_NOT_FOUND` for
`../package.json`, surfacing in MCP clients as `transport error:
transport closed`. No tool ever ran from the bundled launcher.

Root cause: `index.js` resolved its own version with
`require('../package.json')`. That works when running from source
(`packages/mcp-server/src/index.js` → `packages/mcp-server/package.json`)
but fails when bundled to `packages/extension/dist/mcp/index.mjs` —
`../package.json` resolves to a non-existent
`packages/extension/dist/package.json`.

Fix: read `version.json` (which `bundle-mcp.mjs` writes alongside the
bundle) first, fall back to `../package.json` for source/npx runs, fall
back to `'unknown'` if both fail. Verified end-to-end against the bundled
launcher with a real `initialize` handshake.

Anyone whose MCP entries pointed at the bundled launcher
(`~/.airtable-user-mcp/start.mjs` → `dist/mcp/index.mjs`) was affected.
Standalone npx runs (`npx -y airtable-user-mcp`) were not — that path
keeps `package.json` adjacent. mcp-server: 2.4.0 → 2.4.1.

### MCP Server 2.4.0 — Sidebar sections, view setup, non-grid metadata, user-report bug fixes (user report 2026-04-30)

**16 net-new tools (52 total, was 36).** All endpoints captured against Airtable's internal API on 2026-04-30 with `pnpm capture:cdp:mutations`.

#### New features (user report §1.3, §1.4, §3.1)

**View sections (sidebar grouping) — new `view-section` category, defaults on in `safe-write`:**
- `list_view_sections` — read all sections in a table with their view membership and the table-level mixed `viewOrder` (mixes view IDs and section IDs)
- `create_view_section` — generate a `vsc...` ID and create a section
- `rename_view_section` — change a section's name
- `move_view_to_section` — single tool covering four user actions: move view INTO section, move view OUT to ungrouped, reorder sections among each other, reorder views within a section. Maps to one Airtable endpoint (`moveViewOrViewSection`)
- `delete_view_section` — destroy a section. Verified behavior: views inside the section are NOT deleted — Airtable auto-promotes them into the table-level `viewOrder` at the position the section used to occupy. Lives in the new `view-section-destructive` category, gated to `full` profile

**View column setup — extend `view-write`:**
- `set_view_columns` — one-shot tool that hides every column, shows only `visibleColumnIds`, places them in left-to-right order, and optionally sets `frozenColumnCount`. Solves the user report's §1.4 "new views show all 168 fields, unusable until manually trimmed" problem in a single call
- `show_or_hide_all_columns` — bulk on/off. Closes the §3.2 doc-promised-but-missing tool
- `move_visible_columns` — move columns to a target index in the *visible-only* ordering
- `move_overall_columns` — same, but in the *overall* (visible + hidden) ordering. Distinct from existing `reorder_view_fields` (which writes the full map) and from `move_visible_columns` (different index space)
- `update_frozen_column_count` — set the frozen-column divider position

**View presentation (Kanban / Gallery / Calendar) — extend `view-write`:**
- `set_view_cover` — set or clear the cover-image field and choose `fit` vs `crop`. Same endpoints work for both Kanban and Gallery (verified)
- `set_view_color_config` — apply a color config. Currently supports `type: "selectColumn"` (cards colored by a single-select field's choice colors); other types pass through for forward compatibility
- `set_view_cell_wrap` — toggle whether long values wrap (multi-line) or truncate (single-line)
- `set_calendar_date_columns` — set `dateColumnRanges`. Each entry is `{ startColumnId }` for single-point events or `{ startColumnId, endColumnId }` for ranges; the array form lets a Calendar overlay multiple date series at once

**Form metadata (legacy form views only) — new `form-write` category, opt-in (gated to `full` profile since changes are visible to anyone with the form URL):**
- `set_form_metadata` — bundled tool that fans out to atomic Airtable endpoints for `description`, `afterSubmitMessage`, `redirectUrl`, `refreshAfterSubmit`, `shouldAllowRequestCopyOfResponse`, `shouldAttributeResponses`, `isAirtableBrandingRemoved`. Unset properties are not touched
- `set_form_submission_notification` — per-user email-on-submit toggle (separate because it's per-user, not per-form)

Note on builder forms: Airtable's "Interfaces" / page-based forms (`page/{pageId}/*` endpoints, layout-engine element trees) are intentionally out of scope — they're a separate product surface that warrants a dedicated tool family. Filed as a follow-up.

**Categories now in `safe-write`:** `read`, `table-write`, `field-write`, `view-write`, `view-section`. Categories opt-in only via `full` or `custom`: `*-destructive`, `view-section-destructive`, `form-write`, `extension`.

#### Bug fixes (user report §1.2, §2.x, §4.3)

- **`isEmpty` / `isNotEmpty` on text + formula(text) + lookup/rollup(text) fields** — auto-rewritten to `=` / `!=` `""` before sending. The internal API rejects the documented operators with `FAILED_STATE_CHECK` on these field types; the rewrite happens client-side using the cached table schema (§2.1, §2.2)
- **`isEmpty` / `isNotEmpty` on linked-record (foreignKey) fields** — now throws a clear error pointing at the helper-formula workaround instead of letting Airtable's opaque `422` through (§2.3)
- **3-level nested filter rejection** — `updateViewFilters` errors now annotate the depth, the leaf operators that failed, and the recommended flatten pattern (`(A AND B) OR (A AND C)` instead of `A AND (B OR C)`) (§2.4, §2.5)
- **`reorder_view_fields` accepts partial maps** — pass only the field IDs you want to move; the tool reads the current `columnOrder`, applies moves in ascending target-position order, and sends the complete map. Avoids the `FAILED_STATE_CHECK` Airtable's internal API returns for single-key payloads (§2.6)
- **`manage_tools` discoverability** — `ListTools` response now includes a dynamic description on `manage_tools` listing every tool hidden by the active profile (e.g. `delete_table` / `delete_field` / `delete_view` in `safe-write`). `get_tool_status` also returns a `disabledByCategory` summary so an LLM can show the user what to enable (root-cause behind §1.2 — the delete tools always existed, they were just filtered)
- **Tool docstring audit** — corrected `update_view_filters`, `show_or_hide_view_columns`, and `reorder_view_fields` descriptions to match actual behavior (§4.3)

### Fixed (Audit Round 3)
- **Formatter version setting was inert** — Dashboard's "Formatter version" dropdown now actually switches engines. Extension consolidated on `airtableFormula.formula.formatterVersion` and reads this key from all four load sites; legacy `beautifierVersion` / `minifierVersion` remain as fallback for user settings migrated from prior versions
- **Browser-choice changes didn't propagate to IDE MCP configs** — Selecting a different browser (or picking a custom path) now re-writes the MCP entry for every already-configured IDE, so the new `AIRTABLE_BROWSER_CHANNEL` / `AIRTABLE_BROWSER_PATH` env vars take effect immediately instead of staying stale until the next Setup
- **Toggle MCP Tool Category command couldn't toggle table categories** — Added `tableWrite` and `tableDestructive` to the command palette quick-pick; also fixed mis-mapped `fieldWrite` / `viewWrite` file keys that were breaking the label and tool-count display for those rows
- **Formatter commands missing from command palette** — `beautify`, `minify`, `beautifyWithStyle`, `minifyWithLevel`, and `formatWithPreset` are now contributed in `package.json`, with `.formula` language enablement. `beautifyFile` / `minifyFile` added to the explorer context menu for `.formula` files
- **Webview action cards weren't keyboard-accessible** — All clickable `.action-card` divs are now `<button>` elements (or proper `<a>` for links); added `:focus-visible` outline and button resets so styling is preserved
- **Browser select had no way back to Auto** — Added an "Auto (pick best available)" option to the Settings browser dropdown
- **Dead "Docs" button on undetected IDE cards** — Now links to each IDE's install/docs URL (Cursor, Windsurf, Claude Code/Desktop, Cline, Amp)
- **`AIRTABLE_USER_MCP_HOME` advertised but not honored** — Introduced `packages/mcp-server/src/paths.js` as the single source of truth; `auth.js`, `tool-config.js`, `health-check.js`, `login.js`, `login-runner.js`, `manual-login-runner.js`, and `cli.js` all read config and profile paths through it so the env var works everywhere, not just in the CLI `status` / `doctor` commands
- **CI npm-pack smoke masked failures** — Removed `|| true` so `npm pack --dry-run` failures (missing files, malformed package.json) actually fail the job; switched to `set -euo pipefail` and a workspace-relative log file instead of `/tmp/`
- **README screenshot TODOs** — Removed placeholder comments in the root and mcp-server READMEs

### Fixed (Audit Round 2)
- **Incomplete URL injection guard** — `renameTable`, `deleteTable`, `createView`, `updateFieldConfig`, and `renameField` now validate Airtable IDs before URL construction (previously only early resolvers caught the issue)
- **Auth logout timer leak** — `AuthManager.logout()` now stops the auto-refresh timer before wiping credentials, eliminating ghost browser launches against a cleared profile
- **Dashboard logout false-success** — Cancelling the logout confirmation modal now correctly reports cancellation to the webview instead of claiming success
- **`manualTestLogPath` secret leakage** — Debug mirror now scrubs `secretSocketId`, CSRF tokens, Bearer headers, passwords, OTP secrets, and cookies before writing to disk
- **Hung child-process cleanup** — Auth manager's `_spawnScript` now escalates to `SIGKILL` 5 s after `SIGTERM` if a child process ignores the termination signal
- **Non-atomic config writes** — `tools-config.json` is now written via a temp file + rename, preventing truncation on mid-write crashes
- **Debug tracer crash on circular refs** — `trace()` now uses a circular-safe stringify with a breadcrumb fallback so unusual tool arguments can't crash the server
- **Debug tracer error-message redaction** — Thrown error messages routed through `traceToolHandler` now have bearer tokens, CSRF tokens, and `secretSocketId` values scrubbed
- **Weak request-ID randomness** — Replaced `Math.random()` with `crypto.randomBytes` for Airtable request IDs, entity IDs, and `page-load-id` headers
- **`_rawApiCall` ignored `method` in JSON branch** — JSON content-type calls were hardcoded to POST; now honor GET/PUT/PATCH/DELETE from the caller
- **Silent skill-install failure** — `installSkills()` during activation is now wrapped so failures log a warning instead of going unnoticed
- **Fallback `ToolProfileSnapshot` was missing new categories** — Added `tableWrite` / `tableDestructive` keys to the DashboardProvider fallback, fixing a latent TS type error
- **Non-graceful MCP server shutdown** — `SIGINT` / `SIGTERM` now run a bounded, idempotent shutdown (5 s timeout) that closes the transport and stops file watchers before exit, reducing Chromium orphans on Windows
- **Unbounded schema cache** — `SchemaCache` now enforces a 50-entry LRU cap per map, preventing memory growth for long-running servers managing many bases
- **`check-tool-sync.mjs` coverage gaps** — Now also detects drift in `BUILTIN_PROFILES` category arrays and `CATEGORY_LABELS` keys between the server and the extension mirror
- **`_apiCall` could stall forever** — Added a hard 30 s wall-clock budget so a hung `_recoverSession` can't block queued requests indefinitely
- **Webview payload validation** — `App.tsx` now runtime-checks incoming `state:update` / `auth:state` messages, silently dropping malformed payloads instead of crashing the React tree
- **Orphan browser on login failure** — `login.js` now wraps its main automation in `try/finally` so selector misses and TOTP crashes always close the Chrome context
- **No rate limit on inbound tool calls** — MCP server now caps concurrent tool calls (default 16, `AIRTABLE_MAX_CONCURRENT_TOOLS` to override), preventing runaway LLM loops from flooding the auth queue
- **Accessibility** — Dashboard tabs now use proper `role="tab"` / `role="tabpanel"` / `aria-selected`; footer links, toggle switches, and buttons have explicit `aria-label`s for screen readers
- **`autoConfigureOnInstall` default drift** — Fixed `packages/extension/package.json` default from `false` to `true` to match `settings.ts` and the webview store

### Fixed (Audit Round 1)
- **Hardcoded MCP version** — Server now reads its version from `package.json` at runtime instead of a stale constant
- **Settings default mismatch** — Webview `autoConfigureOnInstall` default now matches extension default (`true`)
- **Debug secret leakage** — Debug tracer now redacts `_csrf`, `secretSocketId`, `password`, `otpSecret`, and other credentials before writing to stderr
- **URL injection guard** — All Airtable ID parameters are validated before interpolation into API URLs, preventing path-traversal attacks from malformed tool arguments
- **CI matrix** — GitHub Actions now runs on `ubuntu-latest`, `windows-latest`, and `macos-latest`
- **Build script robustness** — `check-tool-sync.mjs` now uses brace-counting instead of a fragile regex to parse the TypeScript mirror

## [2.0.0] — Daemon & LSP

### Daemon transport

`airtable-user-mcp` now runs as a shared background daemon instead of per-client stdio processes.
One Chromium session is shared across all MCP clients and editor LSP connections.

- **HTTP MCP server** — `StreamableHTTPServerTransport` on a dynamic port; bearer token auth; SSE events
- **stdio-proxy mode** — default `npx airtable-user-mcp` transparently bridges stdin/stdout to the daemon when a lock exists
- **opt-out** — `AIRTABLE_NO_DAEMON=1` (or `--no-daemon`) forces in-process stdio (backwards-compatible)
- **New CLI subcommands** — `daemon start`, `daemon stop`, `daemon status`
- **Lockfile** — `~/.airtable-user-mcp/daemon.lock` carries `pid`, `port`, `port_lsp`, `bearerToken`, `tunnelUrl`

### LSP server

New `airtable-user-lsp` npm package — Airtable language server for formula, script, and automation files.

- Works with any LSP-capable editor (Neovim, Zed, OpenCode, Helix, and more)
- `npx airtable-user-lsp --stdio` for standalone use; `--tcp` for shared daemon instance
- Daemon auto-spawns `airtable-user-lsp --tcp` and writes `port_lsp` to the lockfile

### Tunnel support

Cloudflare and ngrok tunnel integration lets remote AI clients reach the local MCP daemon.

- Two providers: `cloudflared` (Quick Tunnel or Named Tunnel) and `ngrok`
- Tunnel URL exposed in daemon lockfile and Setup tab
- 401-burst auto-disable guard

### Setup tab

New Setup tab in the VS Code dashboard with one-click copy snippets for:
- MCP configuration (5 IDEs × HTTP and stdio transport modes)
- LSP configuration (4 IDEs × TCP and stdio modes)
- Daemon status block with health indicators

mcp-server: 2.4.5. Extension: 2.0.48.

## [2.0.11] - 2026-04-11

### Added
- **Dual-channel publishing** — MCP server now available as standalone `airtable-user-mcp` npm package
- **CLI subcommands** — `npx airtable-user-mcp login`, `logout`, `status`, `doctor`, `install-browser`
- **Dashboard version card** — Shows extension + bundled MCP server versions with update-available hints
- **Build-time version manifest** — Fixes hardcoded `v2.0.0` MCP version bug in dashboard
- **GitHub Actions CI/CD** — Publish workflows for npm, VS Code Marketplace, and Open VSX

### Changed
- **Package rename** — MCP server renamed from `mcp-internal-airtable` to `airtable-user-mcp`
- **Lazy-load patchright** — Dynamic imports for browser deps (smaller install, no crash without browser)
- **Command renames** — `checkSession` → `status`, `downloadBrowser` → `install-browser`

## [0.2.0] - 2026-01-24

### Added
- **Context menu submenus** for beautify styles and minify levels
- **Batch style/level commands** for explorer selections

### Changed
- **Explorer file operations** now use file-based formatting for better stability
- **Minify in-place** when running on `.min.formula` or `.ultra-min.formula`

### Fixed
- **Beautifier v2 JSON performance** improvements to prevent extension host freezes
- **Vendor script resolution** consistency across style/level commands

## [0.1.0] - 2025-09-28

### Added
- **Airtable-Matching Color Scheme**: Exact syntax highlighting colors matching Airtable's interface
- **Intelligent Diagnostics**: Real-time error detection for unclosed parentheses, brackets, quotes
- **IntelliSense Support**: Auto-completion for all Airtable functions with parameter hints
- **Version Selection**: Choose between v1 (stable) and v2 (enhanced) for beautifier and minifier
- **New Formatting Styles**: `smart` style (v2) and `safe` minification level (v2)
- **Extended File Support**: `.min.formula` and `.ultra-min.formula` extensions
- **Enhanced Error Reporting**: Better parenthesis mismatch detection with linked errors

### Changed
- Default to v2 versions for both beautifier and minifier (with v1 fallback)
- Improved diagnostics to not flag `{}` as errors (used in JSON string building)

### Fixed
- Syntax highlighting for minified files
- False positive errors for empty field references `{}`
- Better handling of long single-line formulas in minified files

## [0.0.2] - 2025-09-24

### Added
- Initial release of Airtable Formula VS Code extension
- **Beautify functionality**: Format Airtable formulas with proper indentation and line breaks
- **Minify functionality**: Compress formulas to reduce size while maintaining functionality
- **Syntax highlighting**: Full support for `.formula` files with custom language definition
- **Multiple formatting styles**: Ultra-compact, compact, readable, JSON, and cascade styles
- **Customizable settings**: Configure indentation, line length, quote style, and minification levels
- **Context menu integration**: Right-click options for beautify/minify in formula files
- **File operations**: Batch beautify/minify operations on multiple files
