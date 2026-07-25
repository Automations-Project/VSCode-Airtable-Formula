import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  terminateProcessTree,
  findProfileBrowserPids,
  evictProfileSquatters,
  killProfileBrowserTree,
  isOwnedBrowserCommandLine,
} from "../src/process-tree.js";

function spyExec() {
  return {
    calls: [],
    impl: null,
    async exec(file, args, opts) {
      this.calls.push({ file, args, opts });
      if (this.impl) return this.impl(file, args, opts);
      return { stdout: "", stderr: "" };
    },
  };
}

describe("terminateProcessTree", () => {
  it("win32: taskkill /T /F", async () => {
    const s = spyExec();
    await terminateProcessTree(1234, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].file, "taskkill");
    assert.deepEqual(s.calls[0].args, ["/PID", "1234", "/T", "/F"]);
  });

  it("ignores invalid pids", async () => {
    const s = spyExec();
    await terminateProcessTree(0, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });
    await terminateProcessTree(process.pid, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });
    assert.equal(s.calls.length, 0);
  });

  // ── pid-recycling window: the last-instant argv re-read ────────────────────

  it("aborts when the last-instant re-read proves the pid is now something ELSE", async () => {
    const s = spyExec();
    await terminateProcessTree(1234, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
      verify: async () => "not-owned",
    });
    assert.equal(s.calls.length, 0, "a recycled pid must not be taskkill'd");
  });

  it("aborts BEFORE the POSIX descendant walk, so a recycled pid's children are safe too", async () => {
    const s = spyExec();
    await terminateProcessTree(1234, {
      platform: "linux",
      exec: (f, a, o) => s.exec(f, a, o),
      verify: async () => "not-owned",
    });
    assert.deepEqual(s.calls, [], "no `pgrep -P` may run for a pid that is no longer ours");
  });

  it("proceeds on 'owned'", async () => {
    const s = spyExec();
    await terminateProcessTree(1234, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
      verify: async () => "owned",
    });
    assert.equal(s.calls[0].file, "taskkill");
  });

  it("proceeds on 'unknown' and on a throwing verifier — an unreadable argv is NOT proof", async () => {
    // Failing CLOSED here would turn a safety check into a "browser won't launch" bug: a
    // transient read failure would silently abandon the eviction this module exists to perform.
    for (const verify of [async () => "unknown", async () => { throw new Error("no ps"); }]) {
      const s = spyExec();
      await terminateProcessTree(1234, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o), verify });
      assert.equal(s.calls[0].file, "taskkill");
    }
  });

  it("runs no verification at all when no verifier is supplied (unchanged default)", async () => {
    const s = spyExec();
    await terminateProcessTree(1234, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].file, "taskkill");
  });
});

const WIN_PROFILE = "C:\\Users\\admin\\.airtable-user-mcp\\.chrome-profile";

/** Format a `{ pid: commandLine }` table the way the win32 CIM query emits it. */
function winRows(table) {
  return Object.entries(table).map(([pid, cmd]) => `${pid}\t${cmd}`).join("\r\n") + "\r\n";
}

describe("findProfileBrowserPids", () => {
  it("win32: uses a canonicalised env marker and the chrome/msedge/chromium name filter", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: winRows({ 111: `chrome.exe --user-data-dir=${WIN_PROFILE}` }) });
    const pids = await findProfileBrowserPids(WIN_PROFILE, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, [111]);
    assert.equal(s.calls[0].file, "powershell.exe");
    // Marker is pre-canonicalised (`\`→`/`, lower-cased) because the query canonicalises the
    // command line the same way — so the coarse filter is case/separator-insensitive exactly
    // like the JS predicate that makes the final decision.
    assert.equal(
      s.calls[0].opts.env.AIRTABLE_EVICT_MARKER,
      "--user-data-dir=c:/users/admin/.airtable-user-mcp/.chrome-profile",
    );
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    assert.match(script, /chrome\.exe/);
    assert.match(script, /msedge\.exe/);
    assert.match(script, /chromium\.exe/);
    assert.match(script, /--type=/);
  });

  it("posix: filters out --type= helper processes", async () => {
    const s = spyExec();
    s.impl = async (file, args) => {
      if (file === "pgrep" && args.includes("-f")) {
        return { stdout: "55 66 77" };
      }
      if (file === "ps") {
        const pid = args[1];
        if (pid === "55") return { stdout: "chrome --user-data-dir=/home/u/.chrome-profile" };
        if (pid === "66") return { stdout: "chrome --type=renderer --user-data-dir=/home/u/.chrome-profile" };
        if (pid === "77") return { stdout: "chrome --type=gpu-process --user-data-dir=/home/u/.chrome-profile" };
      }
      return { stdout: "" };
    };
    const pids = await findProfileBrowserPids("/home/u/.chrome-profile", {
      platform: "linux",
      exec: (f, a, o) => s.exec(f, a, o),
      // Force the mocked `ps` path: on real Linux CI, /proc/55|66|77/cmdline are kernel threads
      // with EMPTY cmdlines, which would bypass the mock and make this test fail only on Linux.
      readProc: () => null,
    });
    assert.deepEqual(pids, [55]);
    assert.equal(s.calls[0].file, "pgrep");
    assert.ok(s.calls[0].args.includes("--user-data-dir=/home/u/.chrome-profile"));
  });

  /**
   * THE WIN32 HOLE. The CIM query used to select on
   *   `$_.CommandLine.Contains($env:AIRTABLE_EVICT_MARKER) -or
   *    $_.CommandLine.Contains($env:AIRTABLE_EVICT_DIR)`
   * so ANY root chrome.exe/msedge.exe/chromium.exe whose command line merely MENTIONED the
   * profile path was `taskkill /T /F`'d — a user opening
   * `file:///C:/Users/u/.airtable-user-mcp/.chrome-profile/Default/Preferences` in their everyday
   * Chrome lost the whole browser and every tab. On this project's primary platform.
   */
  it("win32: the bare profile-dir clause is GONE — only the --user-data-dir marker is queried", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "" });
    await findProfileBrowserPids(WIN_PROFILE, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    assert.match(script, /AIRTABLE_EVICT_MARKER/);
    assert.ok(
      !/AIRTABLE_EVICT_DIR/.test(script),
      "the bare profile-dir clause must never be part of the query again",
    );
    assert.equal(
      s.calls[0].opts.env.AIRTABLE_EVICT_DIR,
      undefined,
      "the bare profile-dir must not even be handed to PowerShell",
    );
  });

  it("win32: an everyday Chrome that merely MENTIONS the profile path is NOT selected", async () => {
    const s = spyExec();
    // Both rows survive the coarse CIM filter (both are chrome.exe and both contain the marker
    // text somewhere); only the JS predicate can tell them apart.
    s.impl = async () => ({
      stdout: winRows({
        // The user's own browser, opening a file under our profile. Right image, right mention,
        // WRONG --user-data-dir.
        3001:
          `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ` +
          `--user-data-dir=C:\\Users\\admin\\AppData\\Local\\Google\\Chrome\\User Data ` +
          `file:///C:/Users/admin/.airtable-user-mcp/.chrome-profile/Default/Preferences`,
        // An actual squatter.
        3002: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=${WIN_PROFILE}`,
      }),
    });
    const pids = await findProfileBrowserPids(WIN_PROFILE, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, [3002]);
  });

  it("win32: a row whose command line is missing or unparseable is never selected", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "4242\r\n\t\r\n0\tchrome.exe --user-data-dir=" + WIN_PROFILE + "\r\n" });
    const pids = await findProfileBrowserPids(WIN_PROFILE, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    // `4242` has no tab (no command line), the blank row has no pid, `0` is not a valid pid.
    assert.deepEqual(pids, []);
  });

  it("builds the marker from the TRIMMED dir, so a padded path still matches (win32 + posix)", async () => {
    const padded = `  ${WIN_PROFILE}  `;
    const w = spyExec();
    w.impl = async () => ({ stdout: winRows({ 5151: `chrome.exe --user-data-dir=${WIN_PROFILE}` }) });
    assert.deepEqual(
      await findProfileBrowserPids(padded, { platform: "win32", exec: (f, a, o) => w.exec(f, a, o) }),
      [5151],
      "a padded userDataDir used to produce a marker no live process could carry",
    );
    assert.ok(!w.calls[0].opts.env.AIRTABLE_EVICT_MARKER.includes(" --user-data-dir"));

    const posixPadded = "  /home/u/.airtable-user-mcp/.chrome-profile  ";
    const p = spyExec();
    p.impl = async (file, args) => {
      if (file === "pgrep") return { stdout: "5252" };
      if (file === "ps") return { stdout: "/opt/google/chrome/chrome --user-data-dir=/home/u/.airtable-user-mcp/.chrome-profile" };
      return { stdout: "" };
    };
    assert.deepEqual(
      await findProfileBrowserPids(posixPadded, {
        platform: "linux",
        exec: (f, a, o) => p.exec(f, a, o),
        readProc: () => null,
      }),
      [5252],
    );
    assert.deepEqual(
      p.calls[0].args,
      ["-f", "--", "--user-data-dir=/home/u/.airtable-user-mcp/.chrome-profile"],
      "the pgrep pattern must carry the trimmed dir",
    );
  });

  it("refuses to enumerate for an empty or relative userDataDir (no exec at all)", async () => {
    for (const bad of ["", "   ", ".chrome-profile", "relative/.chrome-profile", undefined, null]) {
      for (const platform of ["linux", "darwin", "win32"]) {
        const s = spyExec();
        const pids = await findProfileBrowserPids(bad, {
          platform,
          exec: (f, a, o) => s.exec(f, a, o),
          readProc: () => null,
        });
        assert.deepEqual(pids, [], `platform=${platform} dir=${JSON.stringify(bad)}`);
        assert.equal(s.calls.length, 0, `platform=${platform} dir=${JSON.stringify(bad)}`);
      }
    }
  });
});

// ─── Positive-attribution filter (POSIX) ──────────────────────────────────────
//
// Regression suite for the Critical process-kill hole: `findProfileBrowserPids` used to fall
// back to `pgrep -f -- <profileDir>` — ANY process merely MENTIONING the profile path —
// whenever the `--user-data-dir=` marker query found nothing, which is the NORMAL case. Its
// output went to a filter that dropped only `--type=` helpers, with no executable filter on
// POSIX at all, and straight into `terminateProcessTree` (SIGTERM → SIGKILL, children too).
// So `vim ~/.airtable-user-mcp/.chrome-profile/Default/Preferences` was killed, automatically,
// on profile-lock acquisition and on every browser park/close.
//
// Mirrors the daemon-manager `_sweepOrphans` ownership suite in the extension package.

const PROFILE = "/home/u/.airtable-user-mcp/.chrome-profile";

/**
 * ADVERSARIAL candidate generator: `pgrep` returns EVERY pid in the table regardless of what
 * its command line says. That deliberately bypasses the marker query so each case is decided
 * by `filterOwnedBrowserPids` alone — which is what must hold the line even if a future change
 * ever re-widens candidate generation (as the removed bare-dir fallback did).
 */
function posixExecAll(cmdlines) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push({ file, args });
    if (file === "pgrep" && args.includes("-f")) {
      const pids = Object.keys(cmdlines);
      if (pids.length === 0) {
        const err = new Error("pgrep: no match");
        err.code = 1;
        throw err;
      }
      return { stdout: pids.join("\n") };
    }
    if (file === "ps") return { stdout: cmdlines[args[1]] ?? "" };
    return { stdout: "" };
  };
  return { calls, exec };
}

/** Run the POSIX path over a { pid: commandLine } table and return the surviving pids. */
async function findPosix(cmdlines, { platform = "linux", profile = PROFILE } = {}) {
  const { calls, exec } = posixExecAll(cmdlines);
  // readProc: () => null forces the mocked `ps` path — on real Linux the runner's /proc would
  // answer first for these synthetic low pids (see the --type= test above).
  const pids = await findProfileBrowserPids(profile, { platform, exec, readProc: () => null });
  return { pids, calls };
}

describe("findProfileBrowserPids — POSIX must not kill non-browsers (Critical regression)", () => {
  const NOT_A_BROWSER = {
    "editor: vim holding a profile file": `vim ${PROFILE}/Default/Preferences`,
    "editor: nano holding a profile file": `nano ${PROFILE}/Default/Preferences`,
    "editor: code holding a profile file": `/usr/share/code/code ${PROFILE}/Default/Preferences`,
    "editor: vi with the profile dir itself": `vi ${PROFILE}`,
    "grep -r over the profile": `grep -r cookie ${PROFILE}`,
    "rg over the profile": `rg --files ${PROFILE}`,
    "find over the profile": `find ${PROFILE} -name SingletonLock`,
    "rsync backing the profile up": `rsync -a ${PROFILE}/ /mnt/backup/chrome-profile/`,
    "tar archiving the profile": `tar -czf /mnt/backup/p.tgz ${PROFILE}`,
    "file manager showing the profile": `nautilus ${PROFILE}`,
    "file manager (dolphin) showing the profile": `/usr/bin/dolphin ${PROFILE}`,
    "shell tail on a profile log": `tail -f ${PROFILE}/chrome_debug.log`,
    "node script whose argv names the profile": `node /home/u/tools/inspect.js ${PROFILE}`,
  };

  for (const [label, cmdline] of Object.entries(NOT_A_BROWSER)) {
    it(`does NOT kill — ${label}`, async () => {
      const { pids } = await findPosix({ 4101: cmdline });
      assert.deepEqual(pids, [], `killed a non-browser: ${cmdline}`);
    });
  }

  const NOT_OUR_PROFILE = {
    "a Chrome on a completely different --user-data-dir":
      `/opt/google/chrome/chrome --user-data-dir=/home/u/.config/google-chrome`,
    "a Chrome on the user's default profile":
      `/opt/google/chrome/chrome --user-data-dir=/home/u/.airtable-user-mcp/other-profile`,
    "suffix near-miss: <profile>-backup":
      `/opt/google/chrome/chrome --user-data-dir=${PROFILE}-backup`,
    "suffix near-miss: <profile>.old":
      `/opt/google/chrome/chrome --user-data-dir=${PROFILE}.old`,
    "subdirectory near-miss: <profile>/Default":
      `/opt/google/chrome/chrome --user-data-dir=${PROFILE}/Default`,
    "prefix near-miss: /mnt/backup<profile>":
      `/opt/google/chrome/chrome --user-data-dir=/mnt/backup${PROFILE}`,
    "another OS user's identically-named profile":
      `/opt/google/chrome/chrome --user-data-dir=/home/other/.airtable-user-mcp/.chrome-profile`,
    "a longer flag that merely ends in user-data-dir=":
      `/opt/google/chrome/chrome --xx-user-data-dir=${PROFILE}`,
    "the dir mentioned in a different flag":
      `/opt/google/chrome/chrome --disk-cache-dir=${PROFILE} --user-data-dir=/home/u/other`,
  };

  for (const [label, cmdline] of Object.entries(NOT_OUR_PROFILE)) {
    it(`does NOT kill — ${label}`, async () => {
      const { pids } = await findPosix({ 4201: cmdline });
      assert.deepEqual(pids, [], `killed a browser on a foreign profile: ${cmdline}`);
    });
  }

  it("does NOT kill a non-Chrome-family process even with our EXACT --user-data-dir flag", async () => {
    // Both conjuncts are required: the flag alone is not ownership. (Firefox has an unrelated
    // switch of its own; an editor could be handed one by a script.)
    const { pids } = await findPosix({
      4301: `/usr/bin/firefox --user-data-dir=${PROFILE}`,
      4302: `vim --user-data-dir=${PROFILE}`,
      4303: `/usr/bin/python3 /home/u/probe.py --user-data-dir=${PROFILE}`,
    });
    assert.deepEqual(pids, []);
  });

  it("does NOT kill a process whose command line cannot be read", async () => {
    const { pids } = await findPosix({ 4401: "", 4402: "   " });
    assert.deepEqual(pids, []);
  });

  it("does NOT kill Chromium helpers of our own profile (they die with the root's tree)", async () => {
    const { pids } = await findPosix({
      4501: `/opt/google/chrome/chrome --type=renderer --user-data-dir=${PROFILE}`,
      4502: `/opt/google/chrome/chrome --type=gpu-process --user-data-dir=${PROFILE}`,
      4503: `/applications/google chrome.app/contents/macos/google chrome helper (renderer) --type=renderer --user-data-dir=${PROFILE}`,
    });
    assert.deepEqual(pids, []);
  });

  it("kills nothing when the whole process table is innocent bystanders", async () => {
    const { pids } = await findPosix({
      5001: `vim ${PROFILE}/Default/Preferences`,
      5002: `grep -r x ${PROFILE}`,
      5003: `/opt/google/chrome/chrome --user-data-dir=${PROFILE}-backup`,
      5004: `/usr/bin/firefox --user-data-dir=${PROFILE}`,
    });
    assert.deepEqual(pids, []);
  });
});

describe("findProfileBrowserPids — POSIX still finds real squatters", () => {
  const REAL_SQUATTERS = {
    "linux Chrome (patchright channel:chrome)": `/opt/google/chrome/chrome --user-data-dir=${PROFILE} --headless=new`,
    "linux google-chrome-stable (browser-detect)": `/usr/bin/google-chrome-stable --user-data-dir=${PROFILE}`,
    "linux system Chromium": `/usr/bin/chromium --user-data-dir=${PROFILE}`,
    "linux chromium-browser": `/usr/bin/chromium-browser --user-data-dir=${PROFILE}`,
    "linux Edge (channel:msedge)": `/opt/microsoft/msedge/msedge --user-data-dir=${PROFILE}`,
    "linux microsoft-edge-stable": `/usr/bin/microsoft-edge-stable --user-data-dir=${PROFILE}`,
    "linux Brave": `/usr/bin/brave-browser --user-data-dir=${PROFILE}`,
    "downloaded Chromium (browser-download.ts layout)":
      `/home/u/.vscode/globalStorage/browsers/chromium-1208/chrome-linux/chrome --user-data-dir=${PROFILE}`,
    "chrome-headless-shell": `/home/u/.cache/chromium-1208/chrome-headless-shell --user-data-dir=${PROFILE}`,
    "macOS Google Chrome (spaces in image path)":
      `/applications/google chrome.app/contents/macos/google chrome --user-data-dir=${PROFILE}`,
    "macOS Google Chrome for Testing":
      `/users/u/browsers/chrome-mac/google chrome for testing.app/contents/macos/google chrome for testing --user-data-dir=${PROFILE}`,
    "macOS Brave Browser":
      `/applications/brave browser.app/contents/macos/brave browser --user-data-dir=${PROFILE}`,
    "trailing separator on the profile dir": `/opt/google/chrome/chrome --user-data-dir=${PROFILE}/`,
    "flag value quoted": `/opt/google/chrome/chrome --user-data-dir="${PROFILE}"`,
    "quoted image path": `"/opt/google/chrome/chrome" --user-data-dir=${PROFILE}`,
    // Whole-argument quoting is the shape Node/Windows produce; there the IMAGE is quoted too,
    // which is what lets argv[0] be identified. (An unquoted image followed by a quoted flag
    // does not occur — POSIX `ps -o args=` and /proc/<pid>/cmdline never re-quote — and would
    // simply be left alive, i.e. it fails in the under-kill direction.)
    "whole argument quoted, image quoted too":
      `"/opt/google/chrome/chrome" "--user-data-dir=${PROFILE}"`,
    "profile flag late in a long argv":
      `/opt/google/chrome/chrome --no-sandbox --disable-gpu --remote-debugging-port=9222 --user-data-dir=${PROFILE} about:blank`,
  };

  for (const [label, cmdline] of Object.entries(REAL_SQUATTERS)) {
    it(`DOES find — ${label}`, async () => {
      const { pids } = await findPosix({ 4601: cmdline });
      assert.deepEqual(pids, [4601], `missed a real squatter: ${cmdline}`);
    });
  }

  it("DOES find a squatter when the home directory contains a space", async () => {
    const spaced = "/home/a b/.airtable-user-mcp/.chrome-profile";
    const { pids } = await findPosix(
      { 4701: `/opt/google/chrome/chrome --user-data-dir=${spaced}` },
      { profile: spaced },
    );
    assert.deepEqual(pids, [4701]);
  });

  it("picks exactly the real squatter out of a crowded, hostile process table", async () => {
    const { pids } = await findPosix({
      4801: `vim ${PROFILE}/Default/Preferences`,
      4802: `rg --files ${PROFILE}`,
      4803: `/opt/google/chrome/chrome --user-data-dir=${PROFILE}-backup`,
      4804: `/opt/google/chrome/chrome --type=renderer --user-data-dir=${PROFILE}`,
      4805: `/opt/google/chrome/chrome --user-data-dir=${PROFILE}`,
      4806: `/usr/bin/firefox --user-data-dir=${PROFILE}`,
      4807: `rsync -a ${PROFILE}/ /mnt/backup/`,
    });
    assert.deepEqual(pids, [4805]);
  });
});

describe("findProfileBrowserPids — the bare-directory pgrep fallback is gone", () => {
  it("issues exactly ONE pgrep, always with the --user-data-dir= marker", async () => {
    const { calls } = await findPosix({ 4901: `/opt/google/chrome/chrome --user-data-dir=${PROFILE}` });
    const pgreps = calls.filter((c) => c.file === "pgrep");
    assert.equal(pgreps.length, 1);
    assert.ok(pgreps[0].args.includes(`--user-data-dir=${PROFILE}`));
    for (const call of pgreps) {
      assert.ok(!call.args.includes(PROFILE), "a bare profile-dir pgrep pattern must never be issued");
    }
  });

  it("returns [] without a second pgrep when the marker query finds nothing", async () => {
    // This is the NORMAL case (no squatter) — the one that used to trigger the bare-dir
    // fallback and enumerate the user's editors.
    const { pids, calls } = await findPosix({});
    assert.deepEqual(pids, []);
    assert.equal(calls.filter((c) => c.file === "pgrep").length, 1);
    assert.equal(calls.filter((c) => c.file === "ps").length, 0);
  });
});

/**
 * PROPERTIES OF THE WIN32 POWERSHELL INVOCATION ITSELF.
 *
 * The shared fixture pins the PREDICATE. It structurally cannot pin the CANDIDATE-GENERATION
 * QUERY — and that is precisely where the last drift from the reference crept in: the query round-
 * trips the command line through PowerShell's stdout, and Windows PowerShell 5.1 writes redirected
 * stdout in the console OEM codepage while Node decodes UTF-8. `daemon-manager.ts:_listProcesses`
 * has always opened with `[Console]::OutputEncoding=[Text.Encoding]::UTF8;` for exactly this; this
 * module did not, because until the command line started round-tripping only ASCII pids crossed
 * stdout.
 *
 * Consequence for a user whose Windows account name is not ASCII
 * (`C:\Users\José\.airtable-user-mcp\.chrome-profile`): the path arrives mojibaked, the
 * `--user-data-dir` token no longer matches, a real squatter is NEVER evicted, and the profile
 * lock stays wedged. Worse in `makeOwnershipVerifier`, where a mojibaked re-read is non-empty and
 * therefore reads as `'not-owned'` — it does not merely fail to confirm an eviction, it ABORTS one
 * the selection pass already approved.
 *
 * These tests are the answer to "what else in the PowerShell invocation should be pinned by a
 * non-fixture test": the encoding prologue, the buffer ceiling, and an end-to-end non-ASCII
 * round-trip through BOTH win32 PowerShell call sites.
 */
describe("win32 PowerShell invocation — properties the fixture cannot pin", () => {
  const PROLOGUE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ";
  const ACCENTED = "C:\\Users\\Jos\u00e9\\.airtable-user-mcp\\.chrome-profile";

  it("the selection query OPENS with the UTF-8 output-encoding prologue", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "" });
    await findProfileBrowserPids(WIN_PROFILE, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    assert.ok(
      script.startsWith(PROLOGUE),
      "without this a non-ASCII profile path arrives mojibaked and the squatter is never evicted",
    );
  });

  it("the verifier's per-pid re-read ALSO opens with the prologue", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "" });
    let verify;
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      await evictProfileSquatters(WIN_PROFILE, dir, {
        platform: "win32",
        exec: (f, a, o) => s.exec(f, a, o),
        findPids: async () => [101],
        terminate: async (_pid, opts) => { verify = opts.verify; },
        settleMs: 0,
      });
      s.calls.length = 0;
      await verify(101);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    assert.ok(
      script.startsWith(PROLOGUE),
      "a mojibaked re-read is non-empty → 'not-owned' → it ABORTS a legitimate eviction",
    );
  });

  it("both win32 call sites decode utf8 and raise maxBuffer to 16 MB", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "" });
    await findProfileBrowserPids(WIN_PROFILE, { platform: "win32", exec: (f, a, o) => s.exec(f, a, o) });

    let verify;
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      await evictProfileSquatters(WIN_PROFILE, dir, {
        platform: "win32",
        exec: (f, a, o) => s.exec(f, a, o),
        findPids: async () => [101],
        terminate: async (_pid, opts) => { verify = opts.verify; },
        settleMs: 0,
      });
      await verify(101);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const psCalls = s.calls.filter((c) => c.file === "powershell.exe");
    assert.equal(psCalls.length, 2, "both win32 PowerShell call sites must be covered");
    for (const call of psCalls) {
      assert.equal(call.opts.encoding, "utf8");
      // Node's default is 1 MB and overflow REJECTS the call — which for an enumeration means
      // "no candidates", i.e. the squatter is silently never evicted.
      assert.equal(call.opts.maxBuffer, 16 * 1024 * 1024);
    }
  });

  it("ROUND-TRIP: a non-ASCII profile path still finds its squatter and still verifies as ours", async () => {
    const squatter = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=${ACCENTED}`;
    const s = spyExec();
    s.impl = async (_file, args) => {
      const script = args[args.length - 1];
      if (script.includes("ProcessId=")) return { stdout: `${squatter}\r\n` };
      return { stdout: winRows({ 7777: squatter }) };
    };

    // 1. selection
    const pids = await findProfileBrowserPids(ACCENTED, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, [7777]);
    assert.equal(
      s.calls[0].opts.env.AIRTABLE_EVICT_MARKER,
      "--user-data-dir=c:/users/jos\u00e9/.airtable-user-mcp/.chrome-profile",
      "the marker must carry the accented path canonicalised, not stripped",
    );

    // 2. last-instant verification
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      let verify;
      await evictProfileSquatters(ACCENTED, dir, {
        platform: "win32",
        exec: (f, a, o) => s.exec(f, a, o),
        findPids: async () => [7777],
        terminate: async (_pid, opts) => { verify = opts.verify; },
        settleMs: 0,
      });
      assert.equal(await verify(7777), "owned");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REGRESSION SHAPE: a mojibaked command line aborts the eviction — which is why the prologue is required", async () => {
    // Documents the failure mode the prologue prevents, so that removing it is visibly a
    // behaviour change rather than a silent one. `é` (U+00E9) written as CP437 and decoded as
    // UTF-8 becomes U+FFFD.
    const mangled = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ` +
      `--user-data-dir=C:\\Users\\Jos\uFFFD\\.airtable-user-mcp\\.chrome-profile`;
    const s = spyExec();
    s.impl = async () => ({ stdout: `${mangled}\r\n` });
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      let verify;
      await evictProfileSquatters(ACCENTED, dir, {
        platform: "win32",
        exec: (f, a, o) => s.exec(f, a, o),
        findPids: async () => [7777],
        terminate: async (_pid, opts) => { verify = opts.verify; },
        settleMs: 0,
      });
      assert.equal(
        await verify(7777),
        "not-owned",
        "non-empty but mangled reads as 'not-owned', NOT 'unknown' — it actively aborts",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── THE SHARED VECTOR ────────────────────────────────────────────────────────
//
// `packages/shared/test-fixtures/process-attribution-cases.json` is asserted by BOTH this file
// and `packages/extension/src/test/daemon-manager.test.ts`. The attribution predicate exists
// twice (this package is a standalone npm package and cannot import the extension's
// TypeScript), and it has drifted apart five separate times — each drift shipping a force-kill
// of an innocent process, each fix patching the reported example and missing a neighbour.
//
// This is the thing that stops the sixth: edit one implementation and not the other, and the
// side that was NOT edited fails here or there. Verified by deliberately breaking each side in
// turn — see `.superpowers/sdd/PLAN-round3/task-22-report.md`.

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../shared/test-fixtures/process-attribution-cases.json",
);
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

/** Expand a fixture case's placeholders into its form's concrete paths. */
function expandCase(testCase) {
  const paths = FIXTURE.paths[testCase.form];
  const cmd = testCase.cmd
    .split("{PROFILE_URL}").join(paths.profile.replace(/\\/g, "/"))
    .split("{PROFILE}").join(paths.profile)
    .split("{CFG}").join(paths.cfg);
  return { cmd, profile: paths.profile, cfg: paths.cfg };
}

describe("shared attribution vector — isOwnedBrowserCommandLine", () => {
  it("the fixture is well-formed and every placeholder is expanded", () => {
    assert.ok(Array.isArray(FIXTURE.cases) && FIXTURE.cases.length >= 100);
    const ids = new Set();
    for (const c of FIXTURE.cases) {
      assert.ok(!ids.has(c.id), `duplicate case id ${c.id}`);
      ids.add(c.id);
      assert.ok(["owned", "not-owned"].includes(c.expect), `bad expect on ${c.id}`);
      assert.ok(FIXTURE.paths[c.form], `unknown form on ${c.id}`);
      // Guards the ONE thing a shared vector cannot itself catch: a suite that expands the
      // placeholders differently (or not at all) would silently assert on the wrong strings.
      const { cmd } = expandCase(c);
      assert.ok(!/\{[A-Z_]+\}/.test(cmd), `unexpanded placeholder in ${c.id}: ${cmd}`);
    }
  });

  for (const testCase of FIXTURE.cases) {
    it(`${testCase.expect} — ${testCase.id}`, () => {
      const { cmd, profile } = expandCase(testCase);
      assert.equal(
        isOwnedBrowserCommandLine(cmd, profile) ? "owned" : "not-owned",
        testCase.expect,
        `${testCase.why}\n    ${cmd}`,
      );
    });
  }

  it("SELECTION (POSIX): every owned non-helper case is found, everything else is left alive", async () => {
    const posix = FIXTURE.cases.filter((c) => c.form === "posix");
    const table = {};
    const expected = [];
    posix.forEach((c, i) => {
      const pid = 20000 + i;
      table[pid] = expandCase(c).cmd;
      if (c.expect === "owned" && !c.helper) expected.push(pid);
    });
    const { pids } = await findPosix(table);
    assert.deepEqual(pids, expected);
  });

  it("SELECTION (win32): every owned non-helper case is found, everything else is left alive", async () => {
    const win = FIXTURE.cases.filter((c) => c.form === "win32");
    const table = {};
    const expected = [];
    win.forEach((c, i) => {
      const pid = 30000 + i;
      table[pid] = expandCase(c).cmd;
      if (c.expect === "owned" && !c.helper) expected.push(pid);
    });
    const s = spyExec();
    s.impl = async () => ({ stdout: winRows(table) });
    const pids = await findProfileBrowserPids(FIXTURE.paths.win32.profile, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, expected);
  });

  it("SELECTION: a Chromium helper is OWNED but never selected — the one deliberate site difference", async () => {
    const helpers = FIXTURE.cases.filter((c) => c.helper);
    assert.ok(helpers.length > 0, "the vector must cover the helper case");
    for (const c of helpers) {
      const { cmd, profile } = expandCase(c);
      assert.equal(isOwnedBrowserCommandLine(cmd, profile), true, `${c.id} must attribute`);
      const { pids } = await findPosix({ 21000: cmd }, { profile });
      assert.deepEqual(pids, [], `${c.id} must NOT be selected — it dies with its root's tree`);
    }
  });
});

describe("evictProfileSquatters", () => {
  it("refuses when a foreign live daemon owns the lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      const foreignPid = process.platform === "win32" ? 4 : 1;
      writeFileSync(join(dir, "daemon.lock"), JSON.stringify({ pid: foreignPid }), "utf8");

      let findCalled = false;
      const result = await evictProfileSquatters("/fake/profile", dir, {
        findPids: async () => {
          findCalled = true;
          return [999];
        },
        terminate: async () => {},
        settleMs: 0,
      });

      try {
        process.kill(foreignPid, 0);
        assert.equal(result.refusedReason, "foreign-daemon-owns-profile");
        assert.deepEqual(result.evicted, []);
        assert.equal(findCalled, false);
      } catch {
        // pid not alive on this host
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evicts when no foreign daemon owns the lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      const terminated = [];
      const result = await evictProfileSquatters("/fake/profile", dir, {
        findPids: async () => [101, 102],
        terminate: async (pid) => {
          terminated.push(pid);
        },
        settleMs: 0,
      });
      assert.equal(result.refusedReason, null);
      assert.deepEqual(result.evicted, [101, 102]);
      assert.deepEqual(terminated, [101, 102]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hands terminateProcessTree a verifier that re-reads argv at the last instant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      const verifiers = [];
      // win32 so the re-read goes through the injected `exec` on every host.
      const s = spyExec();
      s.impl = async (_file, args) => {
        const script = args[args.length - 1];
        if (script.includes("ProcessId=101")) return { stdout: `chrome.exe --user-data-dir=${WIN_PROFILE}\r\n` };
        if (script.includes("ProcessId=102")) return { stdout: "sshd: u@pts/0\r\n" };
        return { stdout: "" };
      };
      await evictProfileSquatters(WIN_PROFILE, dir, {
        platform: "win32",
        exec: (f, a, o) => s.exec(f, a, o),
        findPids: async () => [101],
        terminate: async (_pid, opts) => verifiers.push(opts.verify),
        settleMs: 0,
      });
      assert.equal(typeof verifiers[0], "function", "the pid-recycling re-read must be wired up");

      // And it decides on the SAME predicate the selection used.
      const verify = verifiers[0];
      assert.equal(await verify(101), "owned", "still our browser → proceed");
      assert.equal(await verify(102), "not-owned", "pid recycled into someone else → abort");
      assert.equal(await verify(103), "unknown", "unreadable argv is not proof → proceed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supplies no verifier for an unusable (empty/relative) profile dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      const seen = [];
      await evictProfileSquatters("relative/.chrome-profile", dir, {
        platform: "linux",
        findPids: async () => [101],
        terminate: async (_pid, opts) => seen.push(opts.verify),
        settleMs: 0,
      });
      assert.equal(seen[0], undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows eviction when lock pid is ourselves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-evict-"));
    try {
      writeFileSync(join(dir, "daemon.lock"), JSON.stringify({ pid: process.pid }), "utf8");
      const result = await evictProfileSquatters("/fake/profile", dir, {
        findPids: async () => [77],
        terminate: async () => {},
        settleMs: 0,
      });
      assert.equal(result.refusedReason, null);
      assert.deepEqual(result.evicted, [77]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("killProfileBrowserTree", () => {
  it("never throws and reports pids", async () => {
    const terminated = [];
    const out = await killProfileBrowserTree("/p", {
      findPids: async () => [9],
      terminate: async (pid) => {
        terminated.push(pid);
      },
    });
    assert.equal(out.killed, true);
    assert.deepEqual(out.pids, [9]);
    assert.deepEqual(terminated, [9]);
  });

  it("returns killed:false on empty", async () => {
    const out = await killProfileBrowserTree("/p", {
      findPids: async () => [],
      terminate: async () => {},
    });
    assert.equal(out.killed, false);
  });
});
