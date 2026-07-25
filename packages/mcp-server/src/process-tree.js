import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const execFile = promisify(execFileCb);

/**
 * Node's default `maxBuffer` is 1 MB and OVERFLOW REJECTS THE CALL — for a process enumeration
 * that means "no candidates", i.e. a squatter is never evicted and the profile lock stays wedged.
 * 16 MB, matching `daemon-manager.ts`'s `_listProcesses`. One constant for every exec in this
 * module so the two enumeration paths cannot drift apart on it.
 */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Windows PowerShell 5.1 writes REDIRECTED stdout in the console OEM codepage (e.g. 437/850),
 * while Node decodes it as UTF-8. Every PowerShell invocation in this module must therefore open
 * with this, exactly as `daemon-manager.ts:_listProcesses` does.
 *
 * It was immaterial while only ASCII pids crossed stdout. It stopped being immaterial the moment
 * the command line itself started round-tripping: without it, a profile path containing non-ASCII
 * (`C:\Users\José\.airtable-user-mcp\.chrome-profile`) arrives mojibaked (`Jos\uFFFD`), so
 *   1. `findProfileBrowserPids` re-checks the mangled string, the `--user-data-dir` token no
 *      longer matches, and a REAL squatter is never evicted — the profile lock stays wedged and
 *      the browser cannot launch; and, worse,
 *   2. `makeOwnershipVerifier`'s re-read returns a NON-EMPTY mangled string, which is not
 *      `'unknown'` but `'not-owned'` — so it does not merely fail to help, it ACTIVELY ABORTS a
 *      legitimate eviction that the selection pass had already approved.
 * Both fail safe (never a false kill), but both are functional breakage on this project's primary
 * platform, for users whose Windows account name is not ASCII.
 */
const PS_UTF8_PROLOGUE = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ';

/**
 * Process-tree termination and browser-profile squatter eviction.
 *
 * Orphan Chromium processes hold the profile ProcessSingleton so later
 * launchPersistentContext calls get forwarded ("Opening in existing browser
 * session") and the new chrome exits while the orphan keeps the RAM.
 */

/**
 * Terminate a process AND its children.
 * Windows: taskkill /T /F.
 * POSIX: SIGTERM the root, then walk children (pgrep -P), then SIGKILL stragglers.
 *
 * PID-RECYCLING WINDOW (`verify`). Between the moment `findProfileBrowserPids` decided a pid was
 * ours and the moment this function signals it, the pid can exit and be reassigned to an
 * unrelated process — which is then force-killed WITH ITS CHILDREN (on POSIX the `pgrep -P` walk
 * collects the NEW process's children, so the blast radius is a whole foreign tree). `verify` is
 * an optional last-instant re-read of the pid's own argv, run BEFORE the descendant walk and
 * before any signal.
 *
 * Its contract is deliberately three-valued, so that adding it introduces NO new failure mode:
 *   `'not-owned'` → positive proof the pid is now something else → abort, signal nothing.
 *   `'owned'`     → proceed.
 *   `'unknown'`   → the command line could not be read (pid already gone, EPERM, no `ps`,
 *                   PowerShell unavailable) → proceed, i.e. behave exactly as before `verify`
 *                   existed. Failing CLOSED here would mean a transient read failure silently
 *                   abandoning the eviction this whole module exists to perform, turning a
 *                   safety check into a "browser won't launch" bug.
 * The window is narrowed, not closed: a re-read is still not atomic with the signal. Closing it
 * fully needs a pid-stable handle (`pidfd_open` / `OpenProcess`), which Node does not expose.
 */
export async function terminateProcessTree(
  pid,
  { platform = process.platform, exec = execFile, verify } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  if (typeof verify === 'function') {
    let verdict = 'unknown';
    try {
      verdict = await verify(pid);
    } catch {
      verdict = 'unknown';
    }
    if (verdict === 'not-owned') return;
  }

  if (platform === 'win32') {
    await exec('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10_000,
    }).catch(() => undefined);
    return;
  }

  const descendants = await collectDescendantPids(pid, exec).catch(() => []);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // root already gone
  }
  for (const child of descendants) {
    try {
      process.kill(child, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await delay(1_000);
  for (const target of [pid, ...descendants]) {
    try {
      process.kill(target, 0);
      process.kill(target, 'SIGKILL');
    } catch {
      // ESRCH — exited after SIGTERM
    }
  }
}

/** BFS children of `rootPid` via `pgrep -P` (best-effort). */
async function collectDescendantPids(rootPid, exec) {
  const out = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    const parent = queue.shift();
    let stdout = '';
    try {
      ({ stdout } = await exec('pgrep', ['-P', String(parent)], { timeout: 5_000, maxBuffer: EXEC_MAX_BUFFER }));
    } catch {
      continue;
    }
    for (const tok of String(stdout).split(/\s+/)) {
      const child = Number.parseInt(tok, 10);
      if (!Number.isInteger(child) || child <= 0 || seen.has(child) || child === process.pid) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

// ─── Positive-attribution primitives ──────────────────────────────────────────
//
// CROSS-REFERENCE: these are a LINE-FOR-LINE port of `_canon`, `_splitArgv`, `_argvParses`,
// `_argvEntryEnds`, `WIN_EXEC_EXT`, `ABSOLUTE_LIKE`, `_stripTrailingSep`,
// `CHROME_FAMILY_IMAGES`, `CHROME_FAMILY_HELPER`, `WRAPPER_IMAGES`, `ROOTED`, `NEW_ARG_LIKE`,
// `MAC_BUNDLE_MARKER`, `_isWindowsSpelling`, `_macBundleExec`, `_imageName`, `_basename`,
// `_isChromeFamilyImage` and
// `_hasUserDataDirArg` in `packages/extension/src/mcp/daemon-manager.ts` (`_sweepOrphans`
// ownership criterion (b)). They are REIMPLEMENTED rather than imported because
// `packages/mcp-server` is a standalone npm package (`airtable-user-mcp`) that must not depend
// on the extension package, and bridging the ESM/CJS boundary would mean a new build step.
//
// THE DRIFT IS NOW TEST-ENFORCED, not comment-enforced. Both implementations are driven over
// ONE committed vector — `packages/shared/test-fixtures/process-attribution-cases.json` — by
// `packages/mcp-server/test/test-process-tree.test.js` and
// `packages/extension/src/test/daemon-manager.test.ts`. Editing the predicate on one side and
// not the other now fails a test on the side that was NOT edited. Five previous "fix the
// reported example" passes each missed a neighbouring spelling; the fixture is the thing that
// stops the sixth.
//
// WHAT THAT VECTOR DOES AND DOES NOT PROVE, stated because it has been over-claimed before:
// these two files are line-for-line ports, so when they AGREE that proves MIRROR PARITY and
// nothing more — a defect present in the reference is present in the port, and the vector will
// happily record both sides agreeing on the wrong answer (that is exactly what happened with the
// nested-quoted-value defect, which both sides answered OWNED). Correctness comes from the
// EXPECTATIONS in the vector being argued case by case, per implementation. Agreement is a
// regression guard, not evidence.
//
// The defect class: "a process whose command line merely MENTIONS our profile path is force-
// killed WITH ITS PROCESS TREE". The cure is always the same shape — kill only on POSITIVE
// attribution, built from two independent conjuncts (it IS a browser we could have launched,
// AND it claims OUR exact profile as a whole argv entry) — and fail safe: anything not
// positively attributable is left alive.

/** `C:\…`, `\\server\share…` or `/…` — guards against an empty/relative userDataDir. */
const ABSOLUTE_LIKE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * Canonical form for command-line comparison: `\` → `/`, lower-cased.
 * Case folding is what makes Windows path matching correct; on POSIX it is a negligible
 * widening (two real profile dirs differing only in letter case would have to collide) and
 * keeps ONE code path. Quotes are deliberately left in place here — removing them is
 * `splitArgv`'s job, and it can only be done correctly while the entry structure is still known.
 *
 * NOTE the one thing `\` → `/` costs: a Windows-style escaped quote (`\"`) becomes `/"`, i.e. a
 * REAL quote to `splitArgv`. That can only ever split an entry that would otherwise have stayed
 * whole, so it can only ever make a command line LESS attributable — the fail-safe direction.
 */
function canon(s) {
  return String(s).replace(/\\/g, '/').toLowerCase();
}

/** Trailing separators are not part of a directory's identity (`canon` already made them `/`). */
function stripTrailingSep(p) {
  return p.replace(/\/+$/, '');
}

/**
 * ── THE ARGV SPLITTER ────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS REPLACES, AND WHY. The predicate used to ask "does `needle` appear in the command
 * line with a boundary character (`[\s"']`) on each side?". Treating a QUOTE as a generic
 * boundary is what made a value NESTED INSIDE ANOTHER ARGUMENT satisfy the flag match, because
 * the nested value's own quotes are boundaries:
 *
 *     chrome.exe --user-agent="--user-data-dir=<P>"      ← a USER-AGENT STRING
 *     chrome.exe --proxy-pac-url="--user-data-dir=<P>"   ← a PAC URL
 *     chrome.exe --app="--user-data-dir=<P>"             ← an app URL
 *     /opt/google/chrome/chrome --user-agent="--user-data-dir=<P>"
 *
 * All four returned OWNED against the shipped predicate (reproduced, then pinned as fixture
 * cases `nested-value-*`). Chrome is NOT using our profile in any of them — the string is one
 * argument whose VALUE merely contains our flag — and on win32 the eviction path would have
 * `taskkill /T /F`ed the user's whole browser.
 *
 * The cure is to stop pattern-matching a flat string and instead PARSE it into argv entries, then
 * require the flag to BE an entry. `splitArgv` is that parser: whitespace separates entries; a
 * quoted section is part of the entry it sits in and its quotes are removed, exactly as
 * `CommandLineToArgvW` and POSIX shells do. `--user-agent="--user-data-dir=<P>"` is therefore ONE
 * entry whose text is `--user-agent=--user-data-dir=<P>` — not equal to the flag, so: not owned.
 *
 * @param {string} cmd            command line, already in `canon` form
 * @param {boolean} singleQuotes  whether `'` opens/closes a quoted section — see `argvParses`
 * @returns {{text: string, quoted: boolean, sep: string}[]}
 *   `text`   the entry with its quoting removed;
 *   `quoted` the entry contained at least one quoted section (so it is NOT a fragment of an
 *            unquoted space-containing path, and may not take part in a run join);
 *   `sep`    the raw whitespace run that preceded the entry (a run join requires exactly `' '`,
 *            which is what `ps -o args=` / `/proc/<pid>/cmdline` emit between argv entries).
 */
export function splitArgv(cmd, singleQuotes) {
  const out = [];
  let text = '';
  let quoted = false;
  let started = false;
  let sep = '';
  let open = '';
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (open) {
      if (ch === open) { open = ''; continue; }
      text += ch;
      started = true;
      continue;
    }
    if (ch === '"' || (singleQuotes && ch === "'")) {
      open = ch;
      quoted = true;
      started = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      if (started) {
        out.push({ text, quoted, sep });
        text = '';
        quoted = false;
        started = false;
        sep = '';
      }
      sep += ch;
      continue;
    }
    text += ch;
    started = true;
  }
  // An unterminated quote runs to end of string — which is exactly what `CommandLineToArgvW` does,
  // so a malformed command line attributes the same way the OS would parse it.
  if (started) out.push({ text, quoted, sep });
  return out;
}

/**
 * BOTH readings of the command line: `'` as a quote, and `'` as a literal character.
 *
 * Neither reading alone is right, because the two sources this predicate consumes disagree about
 * what a single quote means:
 *   - `ps -o args=` and `/proc/<pid>/cmdline` do NOT re-quote anything, and `Win32_Process`
 *     quotes with `"` only — `CommandLineToArgvW` gives `'` no meaning at all. So in real argv a
 *     single quote is a LITERAL character, and a Windows/POSIX account named `O'Brien` puts one
 *     inside our own profile path (`c:/users/o'brien/.airtable-user-mcp/.chrome-profile`).
 *     Reading it as a quote would make the owner's own browser unattributable — the profile stays
 *     wedged and the browser cannot launch.
 *   - but the predicate has always accepted the shell-ish spellings `--user-data-dir='<P>'` and
 *     `'--user-data-dir=<P>'`, which only parse under the other reading.
 * A match under EITHER reading is a match. That union is safe against the defect this fixes:
 * a nested value fails BOTH readings (`--proxy-pac-url='--user-data-dir=<P>'` is one entry either
 * way — `--proxy-pac-url=--user-data-dir=<P>` or `--proxy-pac-url='--user-data-dir=<P>'`, and
 * neither equals the flag). What the union must NOT be replaced by is "whitespace-only
 * boundaries", which is the same thing minus the quote handling: that re-admits
 * `--user-agent="x --user-data-dir=<P> y"`, where our flag sits whitespace-bounded INSIDE a
 * quoted value.
 */
function argvParses(cmd) {
  return [splitArgv(cmd, true), splitArgv(cmd, false)];
}

/**
 * Every index at which `needle` occurs as a WHOLE argv entry, returned as the index of the entry
 * AFTER the match (so a caller can assert what follows it). Empty array = no match.
 *
 * Two ways to match, and the second one is load-bearing:
 *   1. a single entry whose text equals the needle. This covers bare (`--user-data-dir=<P>`),
 *      value-quoted (`--user-data-dir="<P>"`) and whole-argument-quoted (`"--user-data-dir=<P>"`)
 *      spellings identically, because `splitArgv` has already removed the quoting.
 *   2. a RUN of consecutive entries, each written with NO quoting and each separated from the last
 *      by exactly one space, whose single-space join equals the needle. This is not a widening —
 *      it is the only way to keep matching the source that has no quoting to begin with:
 *      `ps -o args=` and `/proc/<pid>/cmdline` join argv with single spaces, so a profile under
 *      `/home/a b/` arrives as the two "entries" `--user-data-dir=/home/a` and `b/…`. A run join
 *      can only ever produce a string CONTAINING a space, so when the profile path has no space
 *      (the overwhelmingly common case) this branch cannot match anything at all. Quoted entries
 *      are excluded from runs, which is what stops it from re-opening the nested-value defect.
 */
function argvEntryEnds(entries, needle) {
  const ends = [];
  if (!needle) return ends;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].text === needle) { ends.push(i + 1); continue; }
    if (entries[i].quoted) continue;
    let joined = entries[i].text;
    if (joined.length >= needle.length) continue;
    for (let j = i + 1; j < entries.length; j += 1) {
      const e = entries[j];
      if (e.quoted || e.sep !== ' ') break;
      joined += ` ${e.text}`;
      if (joined === needle) { ends.push(j + 1); break; }
      if (joined.length >= needle.length) break;
    }
  }
  return ends;
}

/**
 * Chrome-family process images (argv[0] basename, lower-cased, `.exe` stripped) — the ONLY
 * images this module will ever kill. DERIVED from what this project can actually launch:
 *
 *  - `src/auth.js` launches patchright with `channel: AIRTABLE_BROWSER_CHANNEL || 'chrome'`
 *    (documented values `chrome|msedge|chromium`) plus an optional explicit
 *    `AIRTABLE_BROWSER_PATH` executable.
 *  - patchright-core's channel registry resolves those channels to `chrome.exe`/`msedge.exe`
 *    (win32), `/opt/google/chrome{,-beta,-unstable,-canary}/chrome` and
 *    `/opt/microsoft/msedge{,-beta,-dev}/msedge` (linux), and
 *    `…/MacOS/Google Chrome[ Beta|Dev|Canary]` / `…/MacOS/Microsoft Edge[ …]` (darwin).
 *  - patchright-core's DOWNLOADED-browser registry (driven by the extension's
 *    `browser-download.ts`) resolves to `chrome`/`chrome.exe`, `Google Chrome for Testing`,
 *    `Chromium` (mac layout), `chrome-headless-shell[.exe]` and `headless_shell`.
 *  - the extension's `browser-detect.ts` additionally hands patchright a system Chromium
 *    (`chromium`, `chromium-browser`, `…/MacOS/Chromium`), Chrome (`google-chrome`,
 *    `google-chrome-stable`), Edge (`microsoft-edge`, `microsoft-edge-stable`) or Brave
 *    (`brave.exe`, `brave`, `brave-browser`, `…/MacOS/Brave Browser`).
 *
 * This is the POSIX equivalent of the process-NAME filter the win32 branch below already
 * applies (`chrome.exe`/`msedge.exe`/`chromium.exe`), widened to the images the other
 * platforms and the downloaded/Brave paths actually produce.
 *
 * Chromium HELPER images live in `CHROME_FAMILY_HELPER` below — the attribution predicate
 * recognises them so it stays byte-identical to the extension's, but THIS module's selection
 * layer drops every `--type=` process a step earlier, because a helper dies with its root
 * browser's process tree.
 */
const CHROME_FAMILY_IMAGES = new Set([
  'chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell', 'headless_shell',
  'google chrome for testing',
  'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable',
  'google chrome', 'google chrome beta', 'google chrome dev', 'google chrome canary',
  'msedge', 'microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'microsoft-edge-dev',
  'microsoft edge', 'microsoft edge beta', 'microsoft edge dev', 'microsoft edge canary',
  'brave', 'brave-browser', 'brave browser',
]);

/**
 * macOS helper images (`Google Chrome Helper`, `… Helper (Renderer)`, …). Present so this
 * module's attribution predicate is byte-identical to the extension's; the SELECTION layer here
 * drops every `--type=` process before this is consulted (a helper dies with its root's tree).
 */
const CHROME_FAMILY_HELPER =
  /^(?:google chrome(?: for testing| beta| dev| canary)?|microsoft edge(?: beta| dev| canary)?|chromium|brave browser) helper(?: \([^)]*\))?$/;

/**
 * Exec-wrappers that replace themselves with the real image, shifting it out of argv[0]. A
 * LEADING run of these is skipped so `env chrome …` / `xvfb-run /usr/bin/chromium …` are still
 * attributable. Deliberately tiny and allowlisted: any other leading token (`vim`, `node`,
 * `python3`, `notepad.exe`, …) means the browser-looking token is that program's ARGUMENT, not
 * the process image, and the command line is then NOT attributable — the exact confusion this
 * whole predicate exists to prevent. A wrapper form we do not list (`xvfb-run -a chrome …`,
 * `snap run chromium`, `flatpak run …`) simply fails to attribute: reported, never killed.
 */
const WRAPPER_IMAGES = new Set([
  'env', 'nohup', 'xvfb-run', 'dbus-run-session', 'setarch', 'stdbuf',
]);

/**
 * A ROOTED path in `canon` form: absolute POSIX (`/…`), UNC (`\\srv` → `//srv`), drive-rooted
 * Windows (`c:/…`), or explicitly relative (`./…`, `../…`). Deliberately NOT matched: a bare
 * relative path (`x/chrome`, `tools/chrome`, `sub/msedge`) and a drive-RELATIVE Windows path
 * (`c:x/chrome`) — the shapes that let a browser-named file masquerade as a process image.
 */
const ROOTED = /^(?:[a-z]:\/|\/|\.\.?\/)/;

/**
 * A token that CANNOT be the continuation of a path containing spaces, because it is itself
 * rooted, quoted, or flag-shaped. NOTE what this does NOT cover: a bare relative path
 * (`x/chrome`) is indistinguishable from a path continuation by inspection alone. That gap is
 * closed ELSEWHERE, and differently per branch — unquoted: `ROOTED` + the spelling gate + the
 * bundle-naming rule; quoted: `ROOTED` + the bundle-naming rule on POSIX spellings, or
 * `WIN_EXEC_EXT` on Windows spellings. This regex closes none of it on its own.
 */
const NEW_ARG_LIKE = /^(?:[a-z]:\/|\/|\.|["'-])/;

/**
 * A fragment ending in a Windows executable extension. A single Windows path names ONE executable
 * and names it LAST, so an executable extension in any fragment BUT the final one means a quoted
 * token is a program plus arguments, not one image path:
 * `"C:\Program Files\vim\vim.exe x\chrome.exe"` → not an image;
 * `"C:\Program Files\Google\Chrome\Application\chrome.exe"` → image.
 */
const WIN_EXEC_EXT = /\.(?:exe|com|bat|cmd)$/;

/**
 * The only structural proof that an unquoted, SPACE-CONTAINING string is one path rather than a
 * program plus arguments: the macOS app-bundle layout. Every Chrome-family image whose real path
 * contains a space is a bundle executable — `…/Google Chrome.app/Contents/MacOS/Google Chrome`,
 * `…/Google Chrome Helper.app/…`, `…/Google Chrome for Testing.app/…`, Edge, Brave, Chromium.
 *
 * The marker ALONE proves nothing — `git add x.app/contents/macos/chrome` carries it too — so
 * `macBundleExec` additionally enforces the bundle's own naming rule, and a Windows-spelled
 * command line is refused the multi-token path entirely (Windows has no `.app` executables).
 */
const MAC_BUNDLE_MARKER = '.app/contents/macos/';

/**
 * Is this command line written in a WINDOWS path spelling? Decided from the RAW string, before
 * `canon` erases the distinction by folding `\` into `/`: a backslash anywhere, or a drive-rooted
 * token. Spelling, NOT host platform — the same command line must attribute the same way on every
 * machine, which is what lets the shared vector assert both forms in both packages regardless of
 * the runner's OS. (An escaped-space POSIX path, `/home/u/my\ apps/chrome`, reads as Windows-
 * spelled here and simply fails to attribute — the safe direction.)
 */
function isWindowsSpelling(raw, canonCmd) {
  return String(raw).includes('\\') || /(?:^|[\s"'])[a-z]:\//.test(canonCmd);
}

/**
 * The executable name of a macOS app-bundle path, or `''` if the string is not one.
 *
 * A real bundle names its executable after the bundle: `Google Chrome.app/Contents/MacOS/Google
 * Chrome`, `Google Chrome Helper.app/…/Google Chrome Helper (Renderer)`, `Brave Browser.app/…/
 * Brave Browser`. So the segment before `.app` must equal the executable, or be its prefix
 * followed by ` (` (the helper variants). That naming rule is what the marker alone was missing:
 * it rejects `x.app/contents/macos/chrome`, `Foo.App/Contents/MacOS/Chrome` and every other
 * "a browser-named file that happens to sit under some .app" spelling. The LAST marker occurrence
 * is used because helpers nest inside the outer browser bundle.
 */
function macBundleExec(joined) {
  const at = joined.lastIndexOf(MAC_BUNDLE_MARKER);
  if (at < 0) return '';
  const bundle = joined.slice(joined.lastIndexOf('/', at) + 1, at);
  const exec = joined.slice(at + MAC_BUNDLE_MARKER.length);
  if (!bundle || !exec || exec.includes('/')) return '';
  if (exec !== bundle && !exec.startsWith(`${bundle} (`)) return '';
  return exec;
}

/**
 * argv[0]'s basename, lower-cased and `.exe`-stripped, from a `canon`-form command line — or
 * `''` when argv[0] cannot be identified unambiguously.
 *
 * Process enumeration hands us a FLAT STRING, and an unquoted argv[0] may itself contain spaces,
 * so argv[0]'s extent has to be recovered. The rules, and the reason each one exists:
 *
 *   1. A quoted leading token BOUNDS argv[0]: the launcher's quoting states where it ENDS, which
 *      is why quoted Windows paths with spaces attribute at all. It does NOT state that the
 *      interior is one path, and argv[0] is caller-chosen (`execve`/`CreateProcess` let a launcher
 *      write anything there), so a space-containing quoted token must clear the same structural
 *      bar as the unquoted branch: `ROOTED`, no later sub-token `NEW_ARG_LIKE`, and then the
 *      bundle-naming rule on POSIX spellings (rejecting `"/usr/bin/vim x/chrome"`,
 *      `"/usr/bin/git add sub/msedge"`) or `WIN_EXEC_EXT` on Windows spellings (rejecting
 *      `"C:\Program Files\vim\vim.exe x\chrome.exe"`), while
 *      `"C:\Program Files\Google\Chrome\Application\chrome.exe"` is left intact.
 *   2. Otherwise: take the text before the first flag-shaped token (`\s["']?-{1,2}\S`), skip a
 *      leading run of `WRAPPER_IMAGES`, and then
 *        - ONE token left  → that is argv[0] (`chrome.exe`, `/opt/chromium`, `./chrome`, `vim`);
 *        - MORE than one   → argv[0] may span them ONLY when all four hold:
 *            (a) the first token is `ROOTED`,
 *            (b) no later token is `NEW_ARG_LIKE`,
 *            (c) the command line is not Windows-spelled (`isWindowsSpelling`), and
 *            (d) the join is a macOS bundle path whose executable obeys the bundle's naming rule
 *                (`macBundleExec`).
 *          (c)+(d) are what make this exhaustive rather than a list of patched examples. A bare
 *          relative argument (`vim x/chrome`, `git add sub/msedge`) is SYNTACTICALLY IDENTICAL
 *          to a legitimate space-containing path (`/applications/google chrome.app/…`), so no
 *          rule over tokens alone can separate them; only the bundle LAYOUT can, and the layout is
 *          meaningless on Windows and meaningless when the executable is not named after its
 *          bundle. The marker alone — which is all this used to require — accepted
 *          `/usr/bin/git add x.app/contents/macos/chrome`,
 *          `notepad.exe x.app\contents\macos\chrome.exe` and
 *          `7z.exe e Foo.App\Contents\MacOS\Chrome`.
 *
 * THIS IS THE PRE-FIX LOGIC'S REPLACEMENT. What stood here took "everything before the first
 * flag" as the image and returned its basename unconditionally, with no wrapper allowlist, no
 * rooted/argument-shaped rejection and no empty-on-ambiguity. So `vim x/chrome
 * --user-data-dir=<our profile>`, `node /home/u/tools/chrome …`, `vim ./chrome …`,
 * `vim /home/u/chrome …` and `notepad.exe C:\x\chrome …` ALL reported the image `chrome` and
 * were SIGTERM/SIGKILLed together with their children.
 *
 * CONSEQUENCE, stated because it is a real narrowing: an UNQUOTED Windows image path containing
 * spaces (`C:\Program Files\Google\Chrome\Application\chrome.exe --user-data-dir=…`) no longer
 * attributes. Keeping it would mean accepting
 * `C:\Windows\System32\notepad.exe x\chrome.exe --user-data-dir=…` as a browser, since the two
 * are the same shape. Every launcher that matters (Node's `child_process`, shell shortcuts, the
 * Start menu) quotes an argv[0] containing spaces, so the quoted branch still covers Windows.
 *
 * RESIDUALS — two, both narrow, both PINNED in the shared vector so neither can drift:
 *   1. a FORWARD-SLASH-SPELLED command line (any host — the gate is spelling, not platform) that
 *      hands another program a CORRECTLY-NAMED bundle executable path, e.g.
 *      `/usr/bin/vim x/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=<profile>`;
 *      byte-for-byte a real macOS invocation (`residual-posix-named-bundle-arg`).
 *   2. a Windows-spelled QUOTED argv[0] holding two relative paths with no executable extension —
 *      `"C:\x\vim x\chrome" --user-data-dir=<profile>` — where `WIN_EXEC_EXT` has nothing to bite
 *      on, and refusing every space-containing quoted Windows token would drop the one shape
 *      Windows browsers actually emit (`residual-win-quoted-two-relative-paths`).
 * Both still require the caller to pass our exact profile flag.
 */
function imageName(cmd, winSpelling) {
  const quote = cmd[0];
  if (quote === '"' || quote === "'") {
    const end = cmd.indexOf(quote, 1);
    const token = (end > 0 ? cmd.slice(1, end) : cmd.slice(1)).trim();
    if (!/\s/.test(token)) return basename(token);
    if (!ROOTED.test(token)) return '';
    if (token.split(/\s+/).slice(1).some((t) => NEW_ARG_LIKE.test(t))) return '';
    // A space-containing quoted token gets the SAME structural proof the unquoted branch demands:
    // quoting settles where argv[0] ENDS, not that its interior is one path. POSIX spelling → a
    // correctly named macOS bundle; Windows spelling → an executable extension only in the FINAL
    // fragment. This is what closes the bare-relative twins `"/usr/bin/vim x/chrome"` and
    // `"C:\Program Files\vim\vim.exe x\chrome.exe"`.
    if (!winSpelling) return basename(macBundleExec(token));
    if (token.split(/\s+/).slice(0, -1).some((t) => WIN_EXEC_EXT.test(t))) return '';
    return basename(token);
  }
  const flag = /\s["']?-{1,2}\S/.exec(cmd);
  const head = (flag ? cmd.slice(0, flag.index) : cmd).trim();
  let tokens = head.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && WRAPPER_IMAGES.has(basename(tokens[0]))) {
    tokens = tokens.slice(1);
  }
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return basename(tokens[0]);
  if (!ROOTED.test(tokens[0])) return '';
  if (tokens.slice(1).some((t) => NEW_ARG_LIKE.test(t))) return '';
  if (winSpelling) return '';
  return basename(macBundleExec(tokens.join(' ')));
}

/** Basename of a `canon`-form path: quotes trimmed, text after the last `/`, `.exe` dropped. */
function basename(p) {
  const s = p.trim().replace(/^["']+/, '').replace(/["']+$/, '');
  const base = s.slice(s.lastIndexOf('/') + 1);
  return base.endsWith('.exe') ? base.slice(0, -'.exe'.length) : base;
}

/** Is this command line's process image a Chrome-family browser we could have launched? */
function isChromeFamilyImage(cmd, winSpelling) {
  const image = imageName(cmd, winSpelling);
  return CHROME_FAMILY_IMAGES.has(image) || CHROME_FAMILY_HELPER.test(image);
}

const USER_DATA_DIR_FLAG = '--user-data-dir=';

/**
 * Does argv carry `--user-data-dir=<profileDir>` for EXACTLY this directory?
 *
 * `flag+dir` must BE an argv entry (`argvEntryEnds`), not merely occur inside one, so:
 *   - `<profile>-backup`, `<profile>.old`, `<profile>/Default` (a subdirectory),
 *     `--user-data-dir=<dir>=2` → a different entry text → MISS;
 *   - `--user-data-dir=/mnt/backup<profile>`, another OS user's identically-named
 *     `/home/other/.chrome-profile` → different absolute string → MISS;
 *   - a longer flag ending in `user-data-dir=` → different entry text → MISS;
 *   - a NESTED spelling — `--foo=--user-data-dir=<dir>`, `--user-data-dir=/other=--user-data-dir=
 *     <dir>` (a browser pointed at a DIFFERENT profile) → one entry, text ≠ flag → MISS;
 *   - a nested QUOTED VALUE — `--user-agent="--user-data-dir=<dir>"`, `--proxy-pac-url=`, `--app=`
 *     and every other Chrome switch that takes a quoted value, in both spellings and both quote
 *     characters → the quotes belong to the ENCLOSING entry, so the entry text is
 *     `--user-agent=--user-data-dir=<dir>` → MISS. This is the defect `splitArgv` exists to fix;
 *     the boundary-character matcher it replaces answered OWNED to all of them.
 * Quoting is handled by the parser rather than by extra needles, so bare,
 * `"--user-data-dir=<dir>"` and `--user-data-dir="<dir>"`/`'<dir>'` all reduce to the same entry
 * text. A trailing separator is the same directory.
 *
 * Both args must be in `canon` form — that is what makes the comparison case-insensitive and
 * `\` vs `/` tolerant.
 */
function hasUserDataDirArg(cmd, profileDir) {
  if (!profileDir) return false;
  const parses = argvParses(cmd);
  for (const dir of [profileDir, `${profileDir}/`]) {
    const needle = `${USER_DATA_DIR_FLAG}${dir}`;
    for (const entries of parses) {
      if (argvEntryEnds(entries, needle).length > 0) return true;
    }
  }
  return false;
}

/**
 * THE SHARED ATTRIBUTION PREDICATE — "is this command line a Chrome-family browser process
 * running EXACTLY our persistent profile?".
 *
 * Semantically identical to `DaemonManager._isOwnedCommandLine`'s criterion (b) in
 * `packages/extension/src/mcp/daemon-manager.ts`, and pinned to it by the shared vector
 * `packages/shared/test-fixtures/process-attribution-cases.json`, which both packages' test
 * suites load and assert against. Exported for exactly that reason.
 *
 * NOT included here, deliberately: the `--type=` Chromium-helper exclusion. That is a
 * SITE-SPECIFIC SELECTION POLICY, not part of attribution — a helper IS ours, but this module
 * kills process TREES, so a helper is skipped because its root's kill already takes it, whereas
 * the extension's sweep kills pids individually and therefore keeps helpers. Encoding it here
 * would make the two predicates disagree for a reason that has nothing to do with ownership.
 *
 * @param {string} commandLine raw command line, any platform's spelling
 * @param {string} profileDir  raw absolute profile directory
 */
export function isOwnedBrowserCommandLine(commandLine, profileDir) {
  const cmd = typeof commandLine === 'string' ? commandLine : '';
  const dir = typeof profileDir === 'string' ? profileDir.trim() : '';
  if (!cmd.trim() || !dir || !ABSOLUTE_LIKE.test(dir)) return false;
  const canonCmd = canon(cmd);
  return isOwnedCanonCommandLine(
    canonCmd,
    stripTrailingSep(canon(dir)),
    isWindowsSpelling(cmd, canonCmd),
  );
}

/**
 * `isOwnedBrowserCommandLine` for arguments already in `canon` (+ trailing-sep-stripped) form.
 * `winSpelling` must be derived from the RAW command line (see `isWindowsSpelling`) — `canon` has
 * already folded `\` into `/` by this point, so it cannot be recovered here.
 */
function isOwnedCanonCommandLine(cmd, canonProfileDir, winSpelling) {
  // Conjunct 1: is it a browser this project could have launched? This is the check POSIX was
  // missing entirely, and it is what keeps `vim`/`grep`/`rg`/`find`/`rsync`/a file manager
  // holding a path under the profile out of `terminateProcessTree`.
  if (!isChromeFamilyImage(cmd, winSpelling)) return false;
  // Conjunct 2: does it claim OUR exact profile, as a whole argv entry? Rejects a browser on a
  // DIFFERENT `--user-data-dir`, `<profile>-backup`, `<profile>/Default`, `/mnt/backup<profile>`
  // and another OS user's identically-named path.
  return hasUserDataDirArg(cmd, canonProfileDir);
}

/**
 * The full SELECTION test this module applies to a candidate: attributable to us AND not a
 * Chromium helper (`--type=…`), which dies with its root browser's process tree.
 */
function isSelectableBrowserCommandLine(args, canonProfileDir) {
  // Unreadable / empty command line (pid gone, kernel thread, EPERM) → not attributable.
  if (typeof args !== 'string' || !args.trim()) return false;
  const cmd = canon(args);
  if (cmd.includes('--type=')) return false;
  return isOwnedCanonCommandLine(cmd, canonProfileDir, isWindowsSpelling(args, cmd));
}

/**
 * Find root browser pids that are ACTUALLY RUNNING our persistent profile.
 *
 * A pid is returned only on POSITIVE attribution — never because our profile path merely
 * appears somewhere in its command line:
 *   1. the process image (argv[0]'s basename) is a Chrome-family binary this project can
 *      launch (`CHROME_FAMILY_IMAGES`), AND
 *   2. argv carries `--user-data-dir=<userDataDir>` for the EXACT directory, matched as a
 *      whole argv entry (`hasUserDataDirArg`), AND
 *   3. it is not a Chromium helper (`--type=…`) — those die with their root's tree.
 * Anything whose command line cannot be read at all is left ALIVE.
 *
 * FALLBACK REMOVED (the hole this replaces). The previous implementation ran
 *   try   { pgrep -f -- `--user-data-dir=<dir>` }
 *   catch { pgrep -f -- `<dir>` }              // ← ANY process mentioning the profile path
 * and passed the result to a filter that dropped only `--type=` helpers, with NO executable
 * filter on POSIX at all. Because `pgrep` exits 1 on "no match", the bare-directory fallback
 * fired in the NORMAL case (no squatter present), so on Linux/macOS
 * `vim ~/.airtable-user-mcp/.chrome-profile/Default/Preferences` — or a `grep -r`, an `rg`,
 * a `find`, an `rsync` backup, a file manager — was SIGTERMed then SIGKILLed together with
 * its children by `terminateProcessTree`, automatically, during ordinary operation
 * (`profile-lock.evictProfileSquatters` on lock acquisition, `killProfileBrowserTree` on
 * browser park/close).
 *
 * The fallback is gone rather than merely image-filtered, because it is provably incapable of
 * contributing a killable pid: the bare-dir query is a strict superset of the marker query,
 * so the only processes it ADDS are those that do NOT carry `--user-data-dir=<dir>` — and
 * requirement 2 above rejects every one of them. It existed to catch "Chromium variants that
 * embed the path without the flag form", but no such variant exists: Chromium's
 * `base::CommandLine` parser only understands `--switch=value` (a space-separated
 * `--user-data-dir /path` is parsed as an empty-valued switch plus a positional URL and does
 * NOT claim the profile), and patchright/Playwright always emits the `=` form. Every real
 * squatter — a leaked headless Chrome, a stale Edge, a user's Brave opened on our profile —
 * carries the marker and is still found. Keeping a query whose entire marginal yield is
 * unkillable would only mean enumerating the user's editors for no benefit.
 *
 * WIN32 IS NOW SYMMETRIC WITH POSIX (this is the second hole, fixed here). The CIM query used
 * to select on
 *   `$_.CommandLine.Contains($env:AIRTABLE_EVICT_MARKER) -or
 *    $_.CommandLine.Contains($env:AIRTABLE_EVICT_DIR)`
 * and `taskkill /T /F` everything it returned. The second clause meant ANY root
 * chrome.exe/msedge.exe/chromium.exe whose command line merely MENTIONED the profile path was
 * killed with all of its tabs — a user opening
 * `file:///C:/Users/u/.airtable-user-mcp/.chrome-profile/Default/Preferences` in their everyday
 * Chrome lost the whole browser. It was the same redundant-but-dangerous widening that was
 * removed from the POSIX `pgrep` fallback, left behind on this project's PRIMARY platform, and
 * it was strictly redundant for the same reason: the marker already IS `--user-data-dir=<dir>`,
 * so the bare-dir clause can only ADD processes that lack the flag — none of which may be
 * killed. It is gone. PowerShell is now CANDIDATE GENERATION ONLY, exactly like `pgrep -f`:
 * a cheap Name + canonical-substring pre-filter whose output is re-checked in JS by the shared
 * `isOwnedBrowserCommandLine` predicate, as a whole argv entry. The chrome/msedge/chromium
 * process-Name filter is kept (it can only under-select, which is the safe direction).
 */
export async function findProfileBrowserPids(
  userDataDir,
  { platform = process.platform, exec = execFile, readProc } = {},
) {
  // An empty or relative userDataDir would turn every match below into a bare fragment that
  // matches half the machine. Nothing is attributable → kill nothing.
  const dir = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (!dir || !ABSOLUTE_LIKE.test(dir)) return [];

  // Built from the TRIMMED dir. Interpolating the raw `userDataDir` (as this did) meant a padded
  // path produced a marker no live process could ever carry — a silent no-match.
  const marker = `${USER_DATA_DIR_FLAG}${dir}`;
  const canonDir = stripTrailingSep(canon(dir));

  if (platform === 'win32') {
    // Marker travels via ENV so PowerShell's own command line doesn't self-match. It is
    // pre-CANONICALISED (`\`→`/`, lower-cased) and the command line is canonicalised the same
    // way in-query, so the coarse filter is case- and separator-insensitive exactly like the JS
    // predicate that decides the outcome. Emits `<pid>\t<commandLine>` so that decision can be
    // made here rather than in PowerShell.
    const script =
      // Required: the command line ROUND-TRIPS through this stdout. See PS_UTF8_PROLOGUE.
      PS_UTF8_PROLOGUE +
      'Get-CimInstance Win32_Process | Where-Object { ' +
      "($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe' -or $_.Name -eq 'chromium.exe') -and " +
      '$_.CommandLine -and ' +
      "$_.CommandLine.Replace('\\','/').ToLowerInvariant().Contains($env:AIRTABLE_EVICT_MARKER) -and " +
      "$_.CommandLine -notlike '*--type=*' } | " +
      'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine -replace \'[\\r\\n]+\', \' \')" }';
    try {
      const { stdout } = await exec(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: EXEC_MAX_BUFFER,
          env: { ...process.env, AIRTABLE_EVICT_MARKER: canon(marker) },
        },
      );
      return parseWin32Rows(stdout)
        .filter((row) => isSelectableBrowserCommandLine(row.commandLine, canonDir))
        .map((row) => row.pid);
    } catch {
      return [];
    }
  }

  let pids = [];
  try {
    // CANDIDATE GENERATION ONLY — never the authority on what gets killed. `pgrep -f` treats
    // its pattern as an ERE (so `.` in `.chrome-profile` is a wildcard) and matches
    // substrings; `filterOwnedBrowserPids` below re-checks every candidate literally, as a
    // whole argv entry, against a Chrome-family image. `pgrep` exits 1 on "no match" — there
    // is deliberately no bare-directory fallback (see the docblock above).
    const { stdout } = await exec('pgrep', ['-f', '--', marker], { timeout: 10_000, maxBuffer: EXEC_MAX_BUFFER });
    pids = parsePids(stdout);
  } catch {
    return [];
  }
  return filterOwnedBrowserPids(pids, canonDir, exec, readProc);
}

/**
 * Parse the win32 CIM query's `<pid>\t<commandLine>` rows. A row whose command line is missing
 * is dropped: an unreadable command line is not attributable, so it must not be killed.
 */
function parseWin32Rows(stdout) {
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const pid = Number.parseInt(line.slice(0, tab).trim(), 10);
    const commandLine = line.slice(tab + 1);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    rows.push({ pid, commandLine });
  }
  return rows;
}

/**
 * Keep only pids positively attributable to a Chrome-family browser running OUR exact
 * profile; drop everything else. Fails safe in every ambiguous case.
 * Linux: /proc/<pid>/cmdline. macOS/BSD: ps -p <pid> -o args=.
 *
 * @param {number[]} pids           candidates from `pgrep`
 * @param {string}   profileDir     our profile dir, already `canon`-ed + trailing-sep-stripped
 */
async function filterOwnedBrowserPids(pids, profileDir, exec, readProc = readProcCmdline) {
  const roots = [];
  for (const pid of pids) {
    const args = await readProcessArgs(pid, exec, readProc);
    if (isSelectableBrowserCommandLine(args, profileDir)) roots.push(pid);
  }
  return roots;
}

// Default /proc reader (Linux fast-path, no shell). Returns the space-joined cmdline (may be '' for
// a kernel thread), or null when /proc is unavailable (not Linux / pid gone) so the caller falls
// back to `ps`. Injectable so tests can bypass the runner's REAL /proc (whose low PIDs 55/66/77 are
// kernel threads with empty cmdlines — that made the mocked `ps` path unreachable and the test fail
// only on Linux CI).
function readProcCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return null;
  }
}

async function readProcessArgs(pid, exec, readProc = readProcCmdline) {
  const fromProc = readProc(pid);
  if (fromProc != null) return fromProc;
  try {
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 5_000, maxBuffer: EXEC_MAX_BUFFER });
    return String(stdout || '');
  } catch {
    return '';
  }
}

/** One pid's command line, on either platform, or `''` when it cannot be read. */
async function readOneCommandLine(pid, { platform, exec, readProc }) {
  if (platform !== 'win32') return readProcessArgs(pid, exec, readProc);
  // `pid` is integer-validated by every caller, so it cannot inject into the CIM filter.
  try {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // Required, and MORE consequential here than in the selection query: a mojibaked re-read
        // is non-empty, so it reads as 'not-owned' and ABORTS an eviction rather than merely
        // failing to confirm one. See PS_UTF8_PROLOGUE.
        PS_UTF8_PROLOGUE +
          `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ForEach-Object { $_.CommandLine }`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: EXEC_MAX_BUFFER },
    );
    return String(stdout || '').replace(/[\r\n]+/g, ' ');
  } catch {
    return '';
  }
}

/**
 * Build the `verify` callback `terminateProcessTree` runs immediately before signalling — the
 * last-instant re-read that closes most of the pid-recycling window (see that function's
 * docblock for the three-valued contract and why `'unknown'` proceeds).
 */
function makeOwnershipVerifier(userDataDir, { platform, exec, readProc }) {
  const dir = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (!dir || !ABSOLUTE_LIKE.test(dir)) return undefined;
  const canonDir = stripTrailingSep(canon(dir));
  return async (pid) => {
    const args = await readOneCommandLine(pid, { platform, exec, readProc });
    if (typeof args !== 'string' || !args.trim()) return 'unknown';
    return isSelectableBrowserCommandLine(args, canonDir) ? 'owned' : 'not-owned';
  };
}

function parsePids(stdout) {
  return String(stdout)
    .split(/\s+/)
    .map((tok) => Number.parseInt(tok, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Kill browser processes squatting `userDataDir` — with an ownership guard.
 *
 * If a LIVE daemon other than us holds `<configDir>/daemon.lock`, refuse:
 * that Chrome belongs to the other daemon.
 */
export async function evictProfileSquatters(
  userDataDir,
  configDir,
  {
    platform = process.platform,
    exec = execFile,
    findPids = findProfileBrowserPids,
    terminate = terminateProcessTree,
    settleMs = 300,
  } = {},
) {
  const lockPath = join(configDir, 'daemon.lock');
  if (existsSync(lockPath)) {
    try {
      const record = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (
        Number.isInteger(record.pid) &&
        record.pid > 0 &&
        record.pid !== process.pid &&
        isProcessAlive(record.pid)
      ) {
        return { evicted: [], refusedReason: 'foreign-daemon-owns-profile' };
      }
    } catch {
      // Unreadable lock — nobody provably owns the profile; eviction may proceed.
    }
  }

  const pids = await findPids(userDataDir, { platform, exec });
  if (pids.length === 0) return { evicted: [], refusedReason: null };

  console.error(
    `[airtable-mcp] evicting orphaned browser process(es) ${pids.join(', ')} squatting ${userDataDir} ` +
      `(no live daemon owns this profile).`,
  );
  const verify = makeOwnershipVerifier(userDataDir, { platform, exec });
  for (const pid of pids) {
    await terminate(pid, { platform, exec, verify });
  }
  if (settleMs > 0) await delay(settleMs);
  return { evicted: pids, refusedReason: null };
}

/**
 * Best-effort kill of profile holders without ownership guard.
 * Used when the caller already knows it owns the profile (park/close of self).
 * NEVER throws.
 *
 * OWNERSHIP-GUARD ASSESSMENT (does this need `evictProfileSquatters`' daemon.lock check?).
 * Verdict: NO — deliberately left unguarded, and the tightened pid source is what makes that
 * defensible.
 *
 *  - Before this change the absence of a guard was alarming: `findProfileBrowserPids` could
 *    return ANY process mentioning the profile path, so "kill without asking" meant killing a
 *    user's editor. That is now impossible — the only pids reachable here are Chrome-family
 *    browsers running `--user-data-dir=<our exact profile>`. The blast radius went from
 *    "arbitrary user processes and their children" to "a browser on our own profile".
 *  - Both call sites (`auth.js` `_park()` and `close()`) run INSIDE the PageScheduler barrier
 *    immediately after we closed our own context, precisely to reap the orphan `chrome.exe`
 *    that `context.close()` leaves behind. By construction the target is our own leak.
 *  - The residual case a guard would cover is narrow: a second airtable-user-mcp instance
 *    sharing the same `AIRTABLE_USER_MCP_HOME` whose browser holds the profile. That is
 *    already unreachable in practice (the profile is MCP-exclusive and Chromium's
 *    ProcessSingleton admits one holder), and the ACQUISITION path — the one that runs before
 *    we own anything — is guarded: `profile-lock.killProfileHolders` goes through
 *    `evictProfileSquatters`, which refuses on a live foreign daemon.
 *  - Adding the guard here would have a concrete cost in the opposite direction: with
 *    `AIRTABLE_NO_DAEMON=1` (stdio standalone) a live daemon.lock belongs to a DIFFERENT pid,
 *    so the guard would refuse, and the orphaned-Chromium RAM leak this function exists to fix
 *    would come back unfixed for that transport.
 * If a future change ever widens the pid source again, this verdict must be revisited.
 */
export async function killProfileBrowserTree(
  userDataDir,
  { platform = process.platform, exec = execFile, findPids = findProfileBrowserPids, terminate = terminateProcessTree } = {},
) {
  try {
    const pids = await findPids(userDataDir, { platform, exec });
    const verify = makeOwnershipVerifier(userDataDir, { platform, exec });
    for (const pid of pids) {
      await terminate(pid, { platform, exec, verify });
    }
    return { killed: pids.length > 0, pids, platform };
  } catch (err) {
    return {
      killed: false,
      pids: [],
      platform,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
