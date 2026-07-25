# Native Airtable Workbench — Webview UI/UX and Hardening Design

**Date:** 2026-07-26
**Status:** Approved
**Packages:** `packages/webview`, `packages/extension`, `packages/shared`
**Author:** Project owner + Codex

---

## 1. Problem and baseline

The extension dashboard is functional and already contains several thoughtful
product-specific surfaces: IDE detection, MCP/LSP setup, authentication,
daemon/tunnel controls, prompt editing, tool profiles, and diagnostics. A June
2026 audit also fixed many dead ends and asynchronous-state problems.

The remaining problem is not a missing coat of polish. The dashboard still
behaves and looks like a dense, custom dark administration page embedded in a
small VS Code sidebar:

- The visual system is hard-coded around a dark glass treatment instead of VS
  Code semantic theme tokens
  ([`styles.css`](../../../packages/webview/src/styles.css)).
- The Overview repeats status, metrics, features, quick actions, and IDE state
  instead of helping the user resolve the next blocker
  ([`Overview.tsx`](../../../packages/webview/src/tabs/Overview.tsx)).
- Setup and Settings expose almost every capability at equal weight across
  very long scroll paths
  ([`Setup.tsx`](../../../packages/webview/src/tabs/Setup.tsx),
  [`Settings.tsx`](../../../packages/webview/src/tabs/Settings.tsx)).
- The top-level and snippet selectors use partial ARIA tab semantics without
  the expected keyboard model
  ([`App.tsx`](../../../packages/webview/src/App.tsx)).
- Inline styles make theming inconsistent and require
  `style-src 'unsafe-inline'`
  ([`html.ts`](../../../packages/extension/src/webview/html.ts)).
- The extension host casts inbound data to `WebviewMessage` without runtime
  validation. A compromised webview can currently request arbitrary settings,
  external URIs, storage paths, or browser executable paths
  ([`DashboardProvider.ts`](../../../packages/extension/src/webview/DashboardProvider.ts),
  [`messages.ts`](../../../packages/shared/src/messages.ts)).
- The 88 discovered webview tests are 44 source tests duplicated through the
  generated `.ds-src` mirror. They cover store and snippet helpers, not
  rendered behavior, keyboard use, themes, or accessibility.

The audit baseline is **6.4/10** overall:

| Dimension | Baseline |
|---|---:|
| Visual hierarchy and product identity | 6.0 |
| Accessibility and keyboard UX | 6.3 |
| Webview/host hardening | 7.0 |
| Rendered regression coverage | 4.5 |

The intended result is a release-quality workbench that is distinctive because
it reflects Airtable formulas and editor readiness, not because it applies more
decoration.

---

## 2. Goals and non-goals

### Goals

- Make the first screen answer three questions immediately:
  1. Is the Airtable session usable?
  2. Is the selected MCP transport usable?
  3. Which editor/client needs attention next?
- Give the extension one memorable, subject-specific visual signature: a live
  readiness formula built from actual dashboard state.
- Preserve every existing dashboard capability while reducing simultaneous
  cognitive load through grouping and progressive disclosure.
- Fit naturally in VS Code light, dark, high-contrast dark, and high-contrast
  light themes.
- Remain usable from 240 CSS pixels upward, with 320 CSS pixels as the WCAG
  reflow acceptance width.
- Implement predictable keyboard navigation, focus management, status
  announcements, reduced motion, and readable type.
- Treat the webview as an untrusted input boundary. Runtime-validate every
  message before host-side effects.
- Remove inline styling so the webview can use a strict CSP without
  `'unsafe-inline'`.
- Add rendered tests that prove the main user journeys and accessibility
  contracts.
- Keep or reduce the current production webview bundle size.

### Non-goals

- No change to the Airtable API, MCP tool behavior, LSP behavior, authentication
  protocol, daemon protocol, or tunnel-provider protocol.
- No removal of supported IDEs, prompt operations, settings, diagnostics,
  backup/restore, official Airtable MCP integration, or manual snippets.
- No new web framework, component library, router, animation framework, or
  external font.
- No generic marketing page, onboarding wizard, or feature-tour carousel.
- No redesign of VS Code's native Settings UI.
- No attempt to remediate unrelated low- and moderate-severity repository
  findings as part of this work.

---

## 3. Locked design decisions

| Dimension | Decision |
|---|---|
| Product metaphor | **Workbench/control plane**, not analytics dashboard |
| Signature | Live readiness formula: session + transport + clients → state |
| Visual integration | VS Code semantic surfaces first; Airtable colors as restrained accents |
| Navigation | Four top-level tabs retained: Overview, Setup, Prompts, Settings |
| Top-level tab behavior | Full WAI-ARIA automatic-activation tab pattern |
| Nested selection | Native selects, radio groups, or disclosures; no nested pseudo-tabs |
| Information density | Essential status open; advanced controls collapsed until relevant |
| CSS architecture | External semantic CSS classes and state attributes; no JSX `style` props |
| Motion | CSS only, state-serving, disabled for reduced motion |
| Confirmation | VS Code host-native modal confirmation for destructive or discard actions |
| Message security | Closed runtime schemas and allowlists before dispatch |
| URL/path security | Webview sends opaque IDs; extension resolves trusted URLs and paths |
| Browser selection | Host validates detected choices; custom paths only originate from host file picker |
| Test strategy | Unit + rendered interaction + accessibility + host-boundary tests |
| Compatibility | Preserve existing message outcomes and current settings values during migration |

---

## 4. Experience architecture

### 4.1 App shell

The shell becomes a quiet frame for the work:

```text
┌ Airtable Control                                      ● Ready
├ Overview │ Setup │ Prompts │ Settings
│
│ Active tab content
│
└
```

- The header contains the Airtable mark, `Airtable Control`, and one aggregate
  text status. Version information moves to Settings → About.
- The persistent Docs/Changelog/GitHub footer is removed. Those destinations
  move to Settings → Support, returning vertical space on small sidebars.
- The tab bar uses four equal-width cells so it reflows without horizontal
  page scrolling at narrow widths.
- The content region owns vertical scrolling. Focused controls must never be
  hidden behind sticky UI.
- The active tab is persisted with `acquireVsCodeApi().setState()` using only
  non-sensitive UI state.

### 4.2 Top-level navigation semantics

The four sections remain a real tab interface because their panels are
preloaded locally and switch without latency.

Required behavior:

- The tab container has `role="tablist"` and an accessible label.
- Each tab has a stable `id`, `aria-controls`, `aria-selected`, and roving
  `tabIndex`.
- Left/Right wrap through tabs; Home/End jump to the first/last tab.
- Focus activates the selected tab immediately.
- The panel has `role="tabpanel"` and `aria-labelledby`.
- When a card inside Overview navigates to another tab, focus moves to the
  destination panel heading.
- Normal tab switching does not unexpectedly move focus when activation came
  from the top tab list.
- Prompt-editor dirty state can block navigation until the user confirms
  discard or returns to the editor.

This follows the W3C
[Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

---

## 5. The signature: live readiness formula

The Overview hero is a state expression, not a row of vanity metrics:

```text
{ SESSION ✓ } + { SERVICE ✓ } + { 3 CLIENTS } = READY
```

When blocked, the expression identifies the first actionable term:

```text
{ SESSION ! } + { SERVICE — } + { CLIENTS — } = SIGN IN
```

The expression is made from compact formula tokens using the editor monospace
font. Airtable yellow, cyan, and pink identify the terms; status text and icons
carry meaning in addition to color. The equals/result term is the only strong
visual accent on the page.

### 5.1 Readiness state

A pure selector derives a `ReadinessModel` from `DashboardState`:

```ts
interface ReadinessModel {
  state: 'loading' | 'blocked' | 'degraded' | 'ready';
  terms: {
    session: ReadinessTerm;
    service: ReadinessTerm;
    clients: ReadinessTerm;
  };
  headline: string;
  detail: string;
  nextAction: ReadinessAction | null;
  issues: ReadinessIssue[];
}
```

The selector has no side effects and receives full unit coverage.

### 5.2 Priority rules

1. `loading` while the extension has not delivered initial state.
2. Browser missing → choose/install a browser.
3. Session absent, expired, or invalid → open the appropriate authentication
   section or start login.
4. Daemon mode selected and service stopped/unhealthy → start or inspect the
   service.
5. No configured external client → open detected editor setup or manual setup.
6. Partial AI/LSP/MCP configuration → repair the first affected detected
   editor.
7. Healthy session + selected transport + at least one usable client → ready.

The settings snapshot will include the existing `mcp.useDaemon` value so the
service term can distinguish daemon HTTP mode from stdio mode. Stdio mode must
not be reported as a stopped daemon.

The formula is descriptive, not a wizard. Users can enter any tab at any time.

---

## 6. Per-tab design

### 6.1 Overview

Order:

1. Live readiness formula.
2. One state-derived primary action, only when action is useful.
3. Actionable issues, if any.
4. Connected clients summary.
5. Compact links to Setup, Prompts, and tool-safety settings.

Removed from Overview:

- Duplicate version metric.
- The five-card feature catalogue.
- Generic quick actions already present in relevant tabs.
- A second full copy of editor status.
- Always-visible daemon details.

Ready state remains useful: it shows connected clients, last session check,
transport mode, and a quiet Refresh action without manufacturing work.

Empty and error states always explain the recovery action. Raw errors remain
available through a details disclosure or VS Code notification, not as the
primary message.

### 6.2 Setup

Setup becomes a sequence of independent operational sections:

1. **Local service**
   - Selected transport, health, ports, uptime.
   - Start/Restart/Stop actions.
   - Bearer-token copy/rotation behind a Safety disclosure.
2. **Editors**
   - Detected editors first.
   - One setup/repair action per editor.
   - Undetected editors behind `Show available editors`.
   - `Set up all detected editors` appears only when more than one needs work.
3. **Remote access**
   - Collapsed when disabled and healthy.
   - Automatically open when active, starting, auto-disabled, or errored.
   - Provider-specific controls render only after provider selection.
4. **Manual configuration**
   - MCP and LSP snippets in separate disclosures.
   - Editor and transport chosen with native selects.
   - One visible snippet and Copy action at a time.
5. **Official Airtable MCP**
   - Clearly labelled as complementary.
   - PAT storage and per-editor configuration retained.

The existing nested snippet tab bars are removed. Native selects are more
compact, clearer at sidebar widths, and avoid multiple composite widgets.

Code snippets may scroll horizontally inside their own code region; the page
itself may not.

### 6.3 Prompts

Prompt list:

- Compact heading and New Prompt action.
- Built-in/modified/custom chips retained.
- Reconnect guidance becomes a short disclosure instead of an always-expanded
  multi-client notice.
- Empty state includes its action.

Prompt editor:

- Uses real visible labels with description/error associations.
- Argument rows switch from columns to stacked fields under 420 pixels.
- Argument names use the same validation rules as prompt names where
  applicable; duplicate argument names are rejected.
- Save reports pending/success/failure through a live status region.
- Delete uses a host-native modal confirmation.
- Reset explains that the built-in default will replace the override.
- Leaving with unsaved changes requires confirmation.
- After returning to the list, focus returns to the edited prompt or New
  Prompt button.

### 6.4 Settings

Settings uses grouped, VS Code-like rows:

1. **Account and authentication**
2. **Browser**
3. **Tool safety**
4. **Formula and scripting**
5. **Storage and session backup**
6. **Diagnostics** — collapsed by default
7. **Advanced runtime** — collapsed by default
8. **Support and About**

Rules:

- Authentication status and its primary action stay open.
- Settings that cause a daemon restart say so before the user changes them.
- Settings writes show local pending state and confirmed success/failure.
- Daemon lifecycle controls live in Setup; Settings links there rather than
  duplicating them.
- Destructive actions use text that names the object and outcome.
- Debug controls cannot be mistaken for normal operation.
- Docs, changelog, GitHub, and version information live in Support and About.

---

## 7. Visual system

### 7.1 Design intent

The distinctive element is the readiness formula. Everything around it is
quiet, compact, and native. The existing combination of glass panels, ambient
orbs, large radii, repeated icon badges, and glow effects is removed.

This is intentionally not one of the common AI-generated dark-dashboard
directions. It derives its identity from formulas and Airtable block colors.

### 7.2 Color

All structural colors alias VS Code variables with safe fallbacks:

```css
--surface-canvas: var(--vscode-sideBar-background, #181818);
--surface-panel: var(--vscode-editorWidget-background, #1f1f1f);
--surface-raised: var(--vscode-input-background, #242424);
--text-primary: var(--vscode-foreground, #f0f0f0);
--text-secondary: var(--vscode-descriptionForeground, #b3b3b3);
--border-default: var(--vscode-widget-border, #3a3a3a);
--border-focus: var(--vscode-focusBorder, #007fd4);
```

Brand accents:

| Token | Value | Use |
|---|---|---|
| Airtable blue | `#166EE1` | Primary actions and brand emphasis |
| Airtable cyan | `#18BFFF` | Service/transport formula term |
| Airtable yellow | `#FCB400` | Session formula term |
| Airtable pink | `#F82B60` | Client/prompt formula term |

Success, warning, and error use VS Code semantic colors first. Brand colors
never replace semantic status meaning.

High-contrast themes use `--vscode-contrastBorder`,
`--vscode-contrastActiveBorder`, and forced-color system values. Decorative
fills disappear when they reduce clarity.

### 7.3 Typography

- UI/prose: `--vscode-font-family`, `--vscode-font-size`,
  `--vscode-font-weight`.
- Formula/code/data: `--vscode-editor-font-family` and
  `--vscode-editor-font-size`.
- No text smaller than 11 CSS pixels.
- Uppercase and letter spacing are limited to short utility labels.
- Headings use weight and spacing rather than oversized type.

### 7.4 Spacing and shape

- Spacing scale: 4, 6, 8, 12, 16, 20 pixels.
- Control height: at least 28 pixels; icon-only actions use at least a 28×28
  hit area.
- Radius scale: 2, 4, and 6 pixels.
- One-pixel semantic borders replace nested shadows and glow.
- No `transition: all`; only the property that communicates the state change
  transitions.

### 7.5 Motion

Allowed:

- A short readiness-result transition after a confirmed state update.
- Indeterminate progress only for an operation with no known percentage.
- Real progressbar movement for browser download.

Disallowed:

- Ambient spinning logo glow.
- Breathing/bouncing loading decoration.
- Decorative panel entrance animations.

Both `.vscode-reduce-motion` and
`@media (prefers-reduced-motion: reduce)` disable non-essential animation.

---

## 8. Component and CSS architecture

### 8.1 Components

New or reshaped components:

| Component | Responsibility |
|---|---|
| `AppShell` | Header, tab bar, content region |
| `DashboardTabs` | Complete keyboard/focus tab contract |
| `ReadinessFormula` | Pure visual rendering of `ReadinessModel` |
| `NextAction` | One state-derived primary action |
| `StatusSummary` | Semantic status/issue list |
| `Section` | Heading, description, actions, body |
| `Disclosure` | Accessible progressive disclosure |
| `Feedback` | Status, warning, error, and success announcements |
| `FormField` | Label, control, description, validation association |
| `SnippetCard` | Code, copy action, overflow behavior |
| `EditorCard` | Refined replacement for current `IdeCard` |
| `SettingRow` | Label/description/control layout |
| `ActionButton` | Consistent pending, disabled, and busy behavior |

The components remain small and local to `packages/webview`; no new design
system dependency is introduced.

### 8.2 CSS

`styles.css` becomes an explicit cascade:

```css
@layer reset, tokens, base, components, utilities, states, accessibility;
```

Rules:

- No JSX `style` properties in shipped webview components.
- Variants use semantic classes or `data-state`/`data-variant`.
- Dynamic progress uses native `<progress>`, not an inline width.
- Dynamic color is represented by finite classes, not inline values.
- Responsive rules live with the owning component class.
- The generated design-sync mirror remains generated and is never edited by
  hand.

Tailwind and Motion are currently unused by application code. Both dependencies
and the Tailwind Vite plugin/import are removed. This reduces the build surface
and prevents a second styling model from competing with semantic CSS.

---

## 9. State, actions, and feedback

### 9.1 Action model

The store keeps per-action identity, but components consume derived helpers:

- `isActionPending(kind, target?)`
- `getActionResult(kind, target?)`
- `runAction(...)`

Buttons disable only for conflicting work. An unrelated slow file dialog must
not freeze authentication or daemon controls.

Every action follows:

```text
idle → pending → confirmed success
               ↘ confirmed failure
               ↘ timeout with recovery guidance
```

The user receives visible feedback at the point of action. VS Code
notifications remain the place for host-level detail.

### 9.2 Status semantics

- Passive state updates: `role="status"` or `aria-live="polite"`.
- Blocking failures: `role="alert"`.
- Known download percentage: native progressbar semantics.
- Pending buttons: `aria-busy="true"` and stable action name.
- Visual spinners are hidden from assistive technology.
- State is never communicated by color alone.

### 9.3 Error content

Errors use:

1. What failed.
2. What remains safe or preserved.
3. The next corrective action.
4. Optional technical detail.

Example:

> Prompt was not saved. Your edits are still here. Check the VS Code
> notification, then try again.

Raw credential, cookie, token, or full inbound message content is never logged
or placed in the DOM.

---

## 10. Webview boundary hardening

### 10.1 Runtime validation

`onDidReceiveMessage` receives `unknown`. A new parser validates the complete
discriminated union before `handleMessage` runs:

```ts
const parsed = parseWebviewMessage(input);
if (!parsed.ok) {
  traceRejectedMessage(parsed.reason, parsed.type);
  return;
}
await handleMessage(parsed.value);
```

Validation includes:

- Known message type.
- Exact required fields.
- Action ID shape and maximum length.
- Enum membership for IDE, tunnel provider, profile, and setting values.
- String length limits appropriate to credentials, tokens, prompts, domains,
  and templates.
- Numeric range and integer checks.
- Prompt argument and object-shape validation.
- Rejection of unexpected path-bearing or executable-bearing data.

The webview also fully validates extension-to-webview messages before mutating
the store.

### 10.2 Settings

The free-form `setting:change { key: string; value: unknown }` contract becomes
a closed union of webview-editable keys with per-key value types.

`mcp.serverPathOverride` and other host/admin-only settings are never writable
from the webview.

### 10.3 External destinations

The webview sends an opaque link ID:

```ts
{ type: 'action:openLink', id, link: 'docs' | 'changelog' | 'github' | 'chrome' }
```

The extension maps the ID to a hard-coded HTTPS URL. No arbitrary scheme or
host crosses the boundary.

### 10.4 Storage

The webview sends a storage entry ID, not a filesystem path. The extension
resolves that ID from its freshly computed storage inventory and opens only the
matching path.

### 10.5 Browser choice

- `auto` is always allowed.
- A detected browser choice is accepted only if it matches the latest
  host-side `detectAllBrowsers()` result.
- A custom executable path is selected and persisted entirely by the host-side
  file picker.
- The general `setBrowserChoice` message cannot carry a custom path.

### 10.6 CSP

`getWebviewHtml` uses a cryptographically random nonce and the strict policy:

```text
default-src 'none';
base-uri 'none';
object-src 'none';
frame-src 'none';
connect-src 'none';
img-src <webview-source> data:;
font-src <webview-source>;
style-src <webview-source>;
script-src 'nonce-<nonce>';
form-action 'none'
```

There are no inline style attributes and no inline executable scripts.
`localResourceRoots` remains limited to `dist/webview`.

These decisions align with the official
[VS Code webview guide](https://code.visualstudio.com/api/extension-guides/webview)
and [webview UX guidance](https://code.visualstudio.com/api/ux-guidelines/webviews).

---

## 11. Accessibility and responsive contract

The target is WCAG 2.2 AA, plus the focus-appearance quality floor where
practical for a desktop workbench.

### Keyboard

- All functionality is operable without a pointer.
- Composite widgets follow their WAI-ARIA keyboard pattern.
- No positive `tabIndex`.
- No keyboard trap.
- Focus remains visible and predictable after panel/editor changes.
- Escape closes only the current dismissible layer and returns focus.

### Forms

- Every input has a visible label.
- Description and error IDs are wired with `aria-describedby`.
- Required and invalid state are programmatic.
- Password/token fields do not expose values in copyable status text.
- Native inputs/selects/checkboxes are preferred.

### Reflow

At 240, 280, 320, 420, and 600 CSS pixels:

- No page-level horizontal scrollbar.
- No clipped tabs or action labels.
- Buttons wrap without changing action order.
- Argument fields stack when columns stop being readable.
- Code blocks alone may scroll horizontally.
- Content survives 200% text zoom without loss of function.

### Themes

Manual validation covers:

- Dark Modern
- Light Modern
- High Contrast Dark
- High Contrast Light

Theme switching must not require a webview reload.

### Motion and assistive technology

- `.vscode-reduce-motion` and `prefers-reduced-motion` are tested.
- `.vscode-using-screen-reader` does not hide information needed by sighted
  keyboard users.
- Status transitions are announced once, without repeated chatter.

Reference:
[WCAG 2.2](https://www.w3.org/TR/WCAG22/).

---

## 12. Test and verification strategy

### 12.1 Test infrastructure

Add:

- jsdom Vitest environment for rendered tests.
- React Testing Library.
- `@testing-library/user-event`.
- `axe-core` integration for automated accessibility checks.

Vitest excludes generated `.ds-src/**` and `.ds-css/**` so test counts reflect
real source tests.

### 12.2 Required test groups

**Readiness selector**

- Loading, browser missing, signed out, expired, daemon stopped, stdio mode,
  unconfigured clients, partially configured client, ready, and degraded
  states.
- Correct next action and no contradictory status.

**Navigation**

- Arrow/Home/End behavior.
- Roving `tabIndex`.
- `aria-controls`/`aria-labelledby`.
- Focus handoff from Overview cards.
- Active-tab state restoration without sensitive persistence.

**Overview**

- One primary action at most.
- Empty/error/ready render contracts.
- Status announcements.

**Setup**

- Disclosures and state-dependent expansion.
- Editor actions and conflicting-action disabling.
- Native snippet selection.
- Copy confirmation and code overflow semantics.
- Real progressbar behavior.

**Prompts**

- Validation, duplicate arguments, save confirmation, failure retention.
- Dirty navigation guard.
- Delete/reset confirmation.
- Narrow argument layout class.
- Focus return.

**Settings**

- Grouping, advanced disclosure, pending/confirmed writes.
- Restart-impact guidance.
- Safe support links.

**Message security**

- Unknown messages rejected.
- Prototype-bearing and malformed objects rejected.
- Arbitrary setting keys rejected.
- Custom executable paths rejected.
- Arbitrary URI schemes rejected.
- Arbitrary storage paths rejected.
- Valid messages still dispatch exactly once.
- Secrets do not appear in trace output.

**CSP**

- Policy contains no `'unsafe-inline'`.
- Nonce uses cryptographic entropy and is attached to the script.
- Local resource roots remain narrow.

**Accessibility**

- Axe checks for each primary tab and important error/empty state.
- Visible name/role/state assertions for controls.
- Live regions and progress semantics.
- Reduced-motion class behavior.

### 12.3 Verification commands

At implementation completion:

```powershell
pnpm -F @airtable-formula/webview test
pnpm -F @airtable-formula/webview build
pnpm -F airtable-formula test
pnpm build
pnpm test
pnpm audit --prod --audit-level high
```

Package-specific type checks or lint commands added during implementation also
become required gates.

### 12.4 Manual verification

- Exercise keyboard-only flows in the real VS Code webview.
- Inspect all four target themes.
- Resize the sidebar through the acceptance widths.
- Verify CSP produces no console violations.
- Verify external links and storage paths resolve through host allowlists.
- Verify auth, service, editor setup, prompt save/delete, settings update,
  tunnel, and copy actions against the extension host.
- Run NVDA on Windows for navigation, status, and prompt-editor smoke tests
  before making a 10/10 claim.

The in-app browser was unavailable during the initial audit, so runtime visual
evidence must be gathered after implementation in VS Code itself.

---

## 13. Dependency hardening

The production audit on 2026-07-25 reported eight high-severity advisories,
including `undici`, `fast-uri`, and `hono` paths in the MCP server dependency
tree.

This work will:

- Update direct dependencies or lockfile resolutions to patched versions.
- Prefer upgrading the owning direct package over permanent overrides.
- Use a temporary override only when the direct package has no compatible
  release, with a comment explaining removal conditions.
- Run the full MCP and extension suites after dependency changes.
- Finish with zero known high-severity production advisories, or document a
  specific upstream blocker and demonstrated non-reachability.

Dependency remediation is a hardening gate, not part of the visual redesign.
It will be isolated into its own commit.

---

## 14. Migration and implementation boundaries

Implementation is split into independently reviewable slices:

1. Test infrastructure and baseline rendered contracts.
2. Runtime message validation and opaque host actions.
3. Strict CSP and externalized styling foundation.
4. App shell, navigation, tokens, themes, and responsive primitives.
5. Readiness model and Overview.
6. Setup information architecture.
7. Prompts workflow.
8. Settings information architecture.
9. Dependency hardening.
10. Full verification and manual accessibility/theme pass.

Rules:

- Each behavior change starts with a failing test.
- Existing functionality remains reachable throughout the migration.
- Protocol changes land in shared types, extension handling, webview store, and
  tests together.
- Generated `.ds-src`/`.ds-css` files are regenerated, not edited.
- Design-sync conventions and preview fixture are updated after the shipped UI
  stabilizes.
- Existing unrelated worktree changes are never reverted or folded into these
  commits.

---

## 15. Acceptance criteria

The work is complete only when all of the following are true:

### Product and visual UX

- Overview presents the live readiness formula and at most one primary next
  action.
- The UI no longer uses ambient orbs, spinning glow, glass-panel gradients, or
  generic metric-card hierarchy.
- All existing capabilities remain reachable.
- Setup and Settings use progressive disclosure and no longer expose every
  advanced control simultaneously.
- The workbench is visually coherent in all four target VS Code theme classes.

### Accessibility

- Top-level tabs implement the complete keyboard and ARIA contract.
- Focus is visible on every interactive control.
- View changes and prompt-editor transitions preserve or intentionally move
  focus.
- Loading, progress, success, and failure states have correct live semantics.
- Reduced motion is honored.
- No page-level horizontal scroll at 320 CSS pixels.
- Automated axe checks have no serious or critical violations in covered
  states.

### Security

- Every inbound webview message is runtime-validated before side effects.
- No arbitrary setting key, external URL, storage path, or executable path can
  cross the webview boundary.
- CSP contains no `'unsafe-inline'`.
- CSP nonce is cryptographically random.
- `localResourceRoots` remains limited to the built webview assets.
- No credential/token content is logged or persisted as webview UI state.

### Engineering quality

- Generated test mirrors are excluded from discovery.
- New behavior is covered by demonstrated red/green regression tests.
- Webview tests, extension tests, full build, and full repository tests pass.
- Production audit has no unresolved high-severity advisory without a
  documented upstream exception.
- Production webview JavaScript remains at or below the current baseline of
  approximately 90 kB gzip.
- Real VS Code keyboard, theme, resize, and NVDA smoke checks are recorded
  before the final rating.

---

## 16. Rating policy

The final score will be evidence-based:

| Score | Meaning |
|---|---|
| 8/10 | Strong visual refactor, core flows and tests pass |
| 9/10 | Theme, reflow, keyboard, and security contracts verified |
| 9.5/10 | Full real-webview integration and accessibility smoke pass |
| 10/10 | No known release blocker, all acceptance criteria met, and manual assistive-technology verification recorded |

Passing a build alone cannot produce a 10/10 rating.
