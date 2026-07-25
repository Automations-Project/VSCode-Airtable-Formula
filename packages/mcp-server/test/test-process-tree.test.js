import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  terminateProcessTree,
  findProfileBrowserPids,
  evictProfileSquatters,
  killProfileBrowserTree,
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
});

describe("findProfileBrowserPids", () => {
  it("win32: uses env marker and chrome/msedge name filter", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "111\n222\n" });
    const profileDir = "C:\\\\Users\\\\admin\\\\.airtable-user-mcp\\\\.chrome-profile";
    const pids = await findProfileBrowserPids(profileDir, {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, [111, 222]);
    assert.equal(s.calls[0].file, "powershell.exe");
    assert.equal(s.calls[0].opts.env.AIRTABLE_EVICT_MARKER, "--user-data-dir=" + profileDir);
    assert.equal(s.calls[0].opts.env.AIRTABLE_EVICT_DIR, profileDir);
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    assert.match(script, /chrome\.exe/);
    assert.match(script, /msedge\.exe/);
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

  it("win32: keeps matching on the bare profile-dir clause (unchanged coverage)", async () => {
    const s = spyExec();
    s.impl = async () => ({ stdout: "4242\n" });
    const pids = await findProfileBrowserPids("C:\\Users\\admin\\.airtable-user-mcp\\.chrome-profile", {
      platform: "win32",
      exec: (f, a, o) => s.exec(f, a, o),
    });
    assert.deepEqual(pids, [4242]);
    const script = s.calls[0].args[s.calls[0].args.length - 1];
    // Both clauses (marker OR bare dir) are still present, and BOTH are still gated by the
    // process-Name filter — the win32 branch is deliberately untouched by this fix.
    assert.match(script, /AIRTABLE_EVICT_MARKER/);
    assert.match(script, /AIRTABLE_EVICT_DIR/);
    assert.match(script, /chromium\.exe/);
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
