import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AirtableAuth, resolveIdleParkMs } from "../src/auth.js";
import { PageScheduler } from "../src/page-scheduler.js";

describe("AirtableAuth idle park", () => {
  it("parkBrowser closes context but keeps credentials and isLoggedIn", async () => {
    const killed = [];
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      killBrowserTree: async (dir) => {
        killed.push(dir);
        return { killed: true, pids: [1] };
      },
      killProfileHolders: async () => ({ killed: true }),
    });

    let closed = false;
    auth.context = {
      close: async () => {
        closed = true;
      },
    };
    auth.page = { url: () => "https://airtable.com/", removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = { cookieHeader: "sid=abc", csrfToken: "csrf" };
    auth.csrfToken = "csrf";

    await auth.parkBrowser();

    assert.equal(closed, true);
    assert.equal(auth.context, null);
    assert.equal(auth.page, null);
    assert.equal(auth.isLoggedIn, true);
    assert.equal(auth._credentials.cookieHeader, "sid=abc");
    assert.deepEqual(killed, ["/fake/profile"]);
  });

  it("parkBrowser aborts while rate-delaying even if queue is empty", async () => {
    const scheduler = new PageScheduler({ maxQueue: 4, rateDelayMs: 80 });
    let closed = false;
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      scheduler,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });
    auth.context = {
      close: async () => {
        closed = true;
      },
    };
    auth.page = { removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = { cookieHeader: "sid=1", csrfToken: "c" };

    // One exclusive op + one queued so pump enters rate-delay after the first.
    let releaseHold;
    const hold = new Promise((r) => {
      releaseHold = r;
    });
    const first = scheduler.runExclusive("hold", async () => {
      await hold;
    });
    const second = scheduler.runExclusive("next", async () => "done");
    await new Promise((r) => setTimeout(r, 5));
    releaseHold();
    // First settles; rate delay starts with second still queued.
    await first;
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(scheduler.getBusyState().delaying || scheduler.getBusyState().queued > 0, true);

    await auth.parkBrowser();
    assert.equal(closed, false, "must not park during rate-delay / queued drain");
    assert.ok(auth.context);
    await second;
  });

  it("parkBrowser aborts when no cookie snapshot is available", async () => {
    let closed = false;
    let killed = 0;
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      killBrowserTree: async () => {
        killed++;
        return { killed: true, pids: [] };
      },
    });
    auth.context = {
      close: async () => {
        closed = true;
      },
    };
    auth.page = { removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = null;
    auth._snapshotCredentials = async () => {
      /* leave empty */
    };

    await auth.parkBrowser();
    assert.equal(closed, false);
    assert.ok(auth.context);
    assert.equal(killed, 0);
  });

  it("a cookie-less park RE-ARMS the timer instead of stranding Chromium", async () => {
    // scheduleIdlePark() nulls _parkTimer before invoking parkBrowser, and the only
    // other re-arm is a scheduler busy->idle edge — which on a genuinely idle daemon
    // never comes again. Without the re-arm this branch kept the whole browser tree
    // alive for the life of the process: the single path where "idle costs nothing"
    // was false. Now that the daemon auto-starts, that leak would have all day to run.
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 60_000,
      killBrowserTree: async () => ({ killed: true, pids: [] }),
    });
    auth.context = { close: async () => {} };
    auth.page = { removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = null;
    auth._snapshotCredentials = async () => { /* never produces a cookie */ };

    // Simulate the real entry point: the timer fired and cleared itself.
    auth._parkTimer = null;

    await auth.parkBrowser();

    assert.ok(auth.context, "browser is deliberately kept up without a cookie snapshot");
    assert.ok(auth._parkTimer, "a retry must be armed, or the browser is stranded forever");
    auth.cancelIdlePark();
  });

  it("ensureLoggedIn is a no-op when parked with valid credentials", async () => {
    let initCalled = 0;
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });
    auth.isLoggedIn = true;
    auth._credentials = { cookieHeader: "sid=abc", csrfToken: "csrf" };
    auth.context = null;
    auth.page = null;
    auth.init = async () => {
      initCalled++;
    };

    await auth.ensureLoggedIn();
    assert.equal(initCalled, 0);
  });

  it("ensureLoggedIn relaunches when parked without credentials", async () => {
    let initCalled = 0;
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });
    auth.isLoggedIn = false;
    auth._credentials = null;
    auth.context = null;
    auth.init = async () => {
      initCalled++;
      auth.isLoggedIn = true;
    };

    await auth.ensureLoggedIn();
    assert.equal(initCalled, 1);
  });

  it("close clears credentials and tree-kills", async () => {
    const killed = [];
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      killBrowserTree: async (dir) => {
        killed.push(dir);
        return { killed: true, pids: [] };
      },
    });
    auth.context = { close: async () => {} };
    auth.page = { removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = { cookieHeader: "x" };

    await auth.close();
    assert.equal(auth.context, null);
    assert.equal(auth.isLoggedIn, false);
    assert.equal(auth._credentials, null);
    assert.deepEqual(killed, ["/fake/profile"]);
  });

  it("close waits for in-flight init (barrier vs exclusive)", async () => {
    const order = [];
    let releaseInit;
    const initGate = new Promise((r) => {
      releaseInit = r;
    });
    const scheduler = new PageScheduler({ maxQueue: 4 });
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      scheduler,
      killBrowserTree: async () => {
        order.push("kill");
        return { killed: false, pids: [] };
      },
    });
    auth._doInitBounded = async () => {
      order.push("init-start");
      await initGate;
      auth.context = { close: async () => order.push("ctx-close") };
      auth.page = { removeListener() {} };
      auth.isLoggedIn = true;
      auth._credentials = { cookieHeader: "c" };
      order.push("init-end");
    };

    const initP = auth.init();
    await new Promise((r) => setTimeout(r, 10));
    const closeP = auth.close();
    await new Promise((r) => setTimeout(r, 10));
    // close must not have finished before init
    assert.ok(order.includes("init-start"));
    assert.ok(!order.includes("kill"));
    releaseInit();
    await Promise.all([initP, closeP]);
    assert.deepEqual(order, ["init-start", "init-end", "ctx-close", "kill"]);
    assert.equal(auth.context, null);
  });

  it("parkBrowser is a no-op for byo mode", async () => {
    const prev = process.env.AIRTABLE_AUTH_MODE;
    process.env.AIRTABLE_AUTH_MODE = "byo";
    try {
      let closed = false;
      const auth = new AirtableAuth({
        profileDir: "/fake/profile",
        idleParkMs: 60_000,
        killBrowserTree: async () => {
          throw new Error("should not kill");
        },
      });
      auth.context = {
        close: async () => {
          closed = true;
        },
      };
      auth.isLoggedIn = true;
      auth._credentials = { cookieHeader: "x" };
      await auth.parkBrowser();
      assert.equal(closed, false);
      assert.ok(auth.context);
    } finally {
      if (prev === undefined) delete process.env.AIRTABLE_AUTH_MODE;
      else process.env.AIRTABLE_AUTH_MODE = prev;
    }
  });

  it("scheduleIdlePark fires park after idle ms", async () => {
    const scheduler = new PageScheduler({ maxQueue: 4 });
    let parked = 0;
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 30,
      scheduler,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });
    auth.context = {
      close: async () => {
        parked++;
      },
    };
    auth.page = { removeListener() {} };
    auth.isLoggedIn = true;
    auth._credentials = { cookieHeader: "sid=1", csrfToken: "c" };

    auth.scheduleIdlePark();
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(parked >= 1, "park should have run");
    assert.equal(auth.context, null);
  });
});

describe("resolveIdleParkMs", () => {
  it("defaults to 30 minutes when unset", () => {
    const prev = process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
    delete process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
    try {
      assert.equal(resolveIdleParkMs(), 30 * 60_000);
    } finally {
      if (prev !== undefined) process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = prev;
    }
  });

  it("disables only on an explicit 0 or negative", () => {
    const prev = process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
    try {
      process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = "0";
      assert.equal(resolveIdleParkMs(), 0);
      process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = "-1";
      assert.equal(resolveIdleParkMs(), 0);
      process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = "45000";
      assert.equal(resolveIdleParkMs(), 45000);
    } finally {
      if (prev === undefined) delete process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
      else process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = prev;
    }
  });

  it("falls back to the default on malformed input instead of disabling parking", () => {
    // A typo in the tuning knob used to SWITCH PARKING OFF, pinning a ~300-600MB
    // Chromium tree resident for the life of the process. Failing to the default is
    // the safe direction: the worst case is that the user's intended interval is
    // ignored, not that the browser never parks again.
    const prev = process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
    try {
      for (const junk of ["30abc", "1.5", "30m", "1_800_000", '"600000"', "NaN", "  "]) {
        process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = junk;
        assert.equal(resolveIdleParkMs(), 30 * 60_000, `expected default for ${JSON.stringify(junk)}`);
      }
    } finally {
      if (prev === undefined) delete process.env.AIRTABLE_BROWSER_IDLE_PARK_MS;
      else process.env.AIRTABLE_BROWSER_IDLE_PARK_MS = prev;
    }
  });
});
