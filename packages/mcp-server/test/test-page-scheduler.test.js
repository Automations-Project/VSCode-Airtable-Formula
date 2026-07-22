import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PageScheduler,
  DaemonQueueFullError,
  runInToolContext,
  withToolDispatchContext,
  resolveToolClientId,
  currentToolContext,
} from "../src/page-scheduler.js";
import { AirtableAuth } from "../src/auth.js";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("PageScheduler", () => {
  it("runs exclusive ops FIFO", async () => {
    const s = new PageScheduler({ maxQueue: 8 });
    const order = [];
    const a = s.runExclusive("a", async () => {
      order.push("a-start");
      await delay(20);
      order.push("a-end");
      return 1;
    });
    const b = s.runExclusive("b", async () => {
      order.push("b");
      return 2;
    });
    assert.deepEqual(await Promise.all([a, b]), [1, 2]);
    assert.deepEqual(order, ["a-start", "a-end", "b"]);
  });

  it("barrier waits only the active op, not the whole queue", async () => {
    const s = new PageScheduler({ maxQueue: 8 });
    const order = [];
    let releaseA;
    const aGate = new Promise((r) => {
      releaseA = r;
    });

    const a = s.runExclusive("a", async () => {
      order.push("a-start");
      await aGate;
      order.push("a-end");
    });
    await delay(5);
    const b = s.runExclusive("b", async () => {
      order.push("b");
    });
    await delay(5);

    const barrier = s.runBarrier(async () => {
      order.push("barrier");
    });

    await delay(5);
    assert.ok(s.getBusyState().queued >= 1);
    releaseA();
    await Promise.all([a, barrier, b]);
    assert.deepEqual(order, ["a-start", "a-end", "barrier", "b"]);
  });

  it("concurrent barriers never overlap", async () => {
    const s = new PageScheduler({ maxQueue: 8 });
    let concurrent = 0;
    let maxConcurrent = 0;
    const order = [];

    const mk = (label, holdMs) =>
      s.runBarrier(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(`${label}-start`);
        await delay(holdMs);
        order.push(`${label}-end`);
        concurrent--;
        return label;
      });

    const results = await Promise.all([mk("b1", 30), mk("b2", 10), mk("b3", 5)]);
    assert.deepEqual(results, ["b1", "b2", "b3"]);
    assert.equal(maxConcurrent, 1);
    assert.deepEqual(order, ["b1-start", "b1-end", "b2-start", "b2-end", "b3-start", "b3-end"]);
  });

  it("busy is true while work is queued (even with no active op)", async () => {
    const s = new PageScheduler({ maxQueue: 8 });
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const first = s.runExclusive("hold", async () => {
      await gate;
    });
    await delay(5);
    const second = s.runExclusive("queued", async () => "q");
    await delay(5);
    // first is active; second is queued → busy must be true
    assert.equal(s.getBusyState().busy, true);
    assert.ok(s.getBusyState().queued >= 1);
    release();
    await first;
    await second;
    assert.equal(s.getBusyState().busy, false);
    assert.equal(s.getBusyState().queued, 0);
  });

  it("rate delay keeps busy and blocks concurrent pump", async () => {
    const s = new PageScheduler({ maxQueue: 8, rateDelayMs: 40 });
    const order = [];
    const t0 = Date.now();
    const a = s.runExclusive("a", async () => {
      order.push("a");
    });
    const b = s.runExclusive("b", async () => {
      order.push("b");
      return Date.now() - t0;
    });
    // While a finishes and delay runs, busy should stay true (delaying or queued).
    await a;
    await delay(5);
    assert.equal(s.getBusyState().busy, true);
    const elapsed = await b;
    assert.deepEqual(order, ["a", "b"]);
    assert.ok(elapsed >= 35, `rate delay should space ops, elapsed=${elapsed}`);
  });

  it("nested exclusive inside held slot passes through (no deadlock)", async () => {
    const s = new PageScheduler({ maxQueue: 4 });
    const result = await s.runExclusive("outer", async () => {
      return s.runExclusive("inner", async () => "ok");
    });
    assert.equal(result, "ok");
  });

  it("rejects when queue is saturated", async () => {
    const s = new PageScheduler({ maxQueue: 1 });
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const first = s.runExclusive("hold", async () => {
      await gate;
    });
    await delay(5);
    const second = s.runExclusive("queued", async () => "q");
    await assert.rejects(
      () => s.runExclusive("overflow", async () => "x"),
      (err) => {
        assert.ok(err instanceof DaemonQueueFullError || /Auth queue saturated/.test(err.message));
        return true;
      },
    );
    release();
    await first;
    await second;
  });

  it("barrier fail-open: throw still clears barrier and resumes queue", async () => {
    const s = new PageScheduler({ maxQueue: 4 });
    await assert.rejects(
      () =>
        s.runBarrier(async () => {
          throw new Error("boom");
        }),
      /boom/,
    );
    const v = await s.runExclusive("after", async () => 42);
    assert.equal(v, 42);
  });

  it("uses ambient tool context label when present", async () => {
    const s = new PageScheduler({ maxQueue: 4 });
    let seen = null;
    const unsub = s.onBusyChange((st) => {
      if (st.active) seen = st.active.tool;
    });
    await runInToolContext({ tool: "list_bases", clientId: "c1" }, () =>
      s.runExclusive("fallback", async () => {
        await delay(5);
      }),
    );
    unsub();
    assert.equal(seen, "list_bases");
  });

  it("getBusyState reports idle when empty", () => {
    const s = new PageScheduler();
    const st = s.getBusyState();
    assert.equal(st.busy, false);
    assert.equal(st.queued, 0);
    assert.equal(st.active, null);
  });
});

describe("withToolDispatchContext", () => {
  it("sets ambient tool + clientId from request/extra", async () => {
    let seen = null;
    await withToolDispatchContext(
      { params: { name: "list_bases" } },
      { requestInfo: { headers: { "x-airtable-client-id": "vscode-1" } } },
      async () => {
        seen = currentToolContext();
      },
    );
    assert.deepEqual(seen, { tool: "list_bases", clientId: "vscode-1" });
  });

  it("missing client id → null, never throws", async () => {
    assert.equal(resolveToolClientId(undefined), null);
    assert.equal(resolveToolClientId(null), null);
    assert.equal(resolveToolClientId({}), null);
    assert.equal(resolveToolClientId({ headers: {} }), null);

    let seen = null;
    await withToolDispatchContext({ params: { name: "get_base_schema" } }, undefined, async () => {
      seen = currentToolContext();
    });
    assert.deepEqual(seen, { tool: "get_base_schema", clientId: null });
  });

  it("reads x-airtable-client-id case-insensitively from requestInfo.headers", () => {
    assert.equal(
      resolveToolClientId({
        requestInfo: { headers: { "X-Airtable-Client-Id": "vscode-airtable-formula" } },
      }),
      "vscode-airtable-formula",
    );
    assert.equal(
      resolveToolClientId({
        requestInfo: { headers: { "x-airtable-client-id": ["daemon-attach-1"] } },
      }),
      "daemon-attach-1",
    );
  });

  it("prefers sessionId over headers", () => {
    assert.equal(
      resolveToolClientId({
        sessionId: "sess-9",
        requestInfo: { headers: { "x-airtable-client-id": "hdr" } },
      }),
      "sess-9",
    );
  });

  it("dispatch wrap carries clientId into PageScheduler active state", async () => {
    const scheduler = new PageScheduler({ maxQueue: 4 });
    let seenClient = null;
    const unsub = scheduler.onBusyChange((st) => {
      if (st.active) seenClient = st.active.clientId;
    });
    await withToolDispatchContext(
      { params: { name: "list_bases" } },
      { requestInfo: { headers: { "x-airtable-client-id": "vscode-airtable-formula" } } },
      () =>
        scheduler.runExclusive("auth", async () => {
          await delay(5);
        }),
    );
    unsub();
    assert.equal(seenClient, "vscode-airtable-formula");
  });

  it("dispatch wrap → PageScheduler busy label is real tool name (not fallback)", async () => {
    const scheduler = new PageScheduler({ maxQueue: 4 });
    const auth = new AirtableAuth({
      profileDir: "/fake/profile",
      idleParkMs: 0,
      scheduler,
      killBrowserTree: async () => ({ killed: false, pids: [] }),
    });

    let seenTool = null;
    const unsub = scheduler.onBusyChange((st) => {
      if (st.active) seenTool = st.active.tool;
    });

    // Simulate outermost CallTool handler wrap → auth exclusive work.
    await withToolDispatchContext(
      { params: { name: "list_bases" } },
      { headers: { "x-airtable-client-id": "c-ext" } },
      () =>
        auth._enqueue(async () => {
          await delay(5);
          return "ok";
        }, "auth"),
    );
    unsub();
    assert.equal(seenTool, "list_bases");
  });
});
