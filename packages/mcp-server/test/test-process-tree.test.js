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
