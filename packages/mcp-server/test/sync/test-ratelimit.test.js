import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, createLimiter, defaultIsTransient } from '../../src/sync/ratelimit.js';

describe('ratelimit.withRetry', () => {
  it('retries a transient 429 then succeeds', async () => {
    let n = 0;
    const slept = [];
    const out = await withRetry(
      async () => {
        if (n++ < 2) {
          const e = new Error('rate limited');
          e.status = 429;
          throw e;
        }
        return 'ok';
      },
      { retries: 4, sleep: async (ms) => slept.push(ms), rand: () => 0, baseMs: 100, penaltyMs: 200 },
    );
    assert.equal(out, 'ok');
    assert.equal(n, 3);          // called 3 times: fail, fail, succeed
    assert.equal(slept.length, 2); // slept once per retry (2 retries)
  });

  it('retries a transient 503 then succeeds', async () => {
    let n = 0;
    const slept = [];
    const out = await withRetry(
      async () => {
        if (n++ < 1) {
          const e = new Error('server error');
          e.status = 503;
          throw e;
        }
        return 'data';
      },
      { retries: 4, sleep: async (ms) => slept.push(ms), rand: () => 0, baseMs: 100 },
    );
    assert.equal(out, 'data');
    assert.equal(n, 2);
    assert.equal(slept.length, 1);
  });

  it('rethrows a non-transient error immediately (no sleep)', async () => {
    let n = 0;
    const slept = [];
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n++;
            const e = new Error('bad request');
            e.status = 422;
            throw e;
          },
          { retries: 4, sleep: async (ms) => slept.push(ms), rand: () => 0 },
        ),
      /bad request/,
    );
    assert.equal(n, 1);         // only called once
    assert.equal(slept.length, 0); // no sleep
  });

  it('rethrows after exhausting retries', async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n++;
            const e = new Error('always fails');
            e.status = 503;
            throw e;
          },
          { retries: 2, sleep: async () => {}, rand: () => 0, baseMs: 10 },
        ),
      /always fails/,
    );
    assert.equal(n, 3); // initial + 2 retries
  });

  it('honors err.retryAfterMs over backoff', async () => {
    let n = 0;
    const slept = [];
    await withRetry(
      async () => {
        if (n++ < 1) {
          const e = new Error('rate');
          e.status = 429;
          e.retryAfterMs = 9999;
          throw e;
        }
        return 'ok';
      },
      { retries: 2, sleep: async (ms) => slept.push(ms), rand: () => 0, baseMs: 10, penaltyMs: 1 },
    );
    // retryAfterMs=9999 should win over backoff(10*1+0=10) and penaltyMs(1)
    assert.equal(slept[0], 9999);
  });

  it('returns value immediately when fn succeeds on first try', async () => {
    const slept = [];
    const out = await withRetry(async () => 42, {
      retries: 3,
      sleep: async (ms) => slept.push(ms),
      rand: () => 0,
    });
    assert.equal(out, 42);
    assert.equal(slept.length, 0);
  });
});

describe('ratelimit.defaultIsTransient', () => {
  it('returns true for 429', () => {
    assert.equal(defaultIsTransient({ status: 429 }), true);
  });
  it('returns true for 5xx', () => {
    assert.equal(defaultIsTransient({ status: 500 }), true);
    assert.equal(defaultIsTransient({ status: 503 }), true);
    assert.equal(defaultIsTransient({ status: 599 }), true);
  });
  it('returns false for 4xx non-429', () => {
    assert.equal(defaultIsTransient({ status: 422 }), false);
    assert.equal(defaultIsTransient({ status: 400 }), false);
    assert.equal(defaultIsTransient({ status: 404 }), false);
  });
  it('returns true for network errors by message', () => {
    assert.equal(defaultIsTransient({ message: 'network error' }), true);
    assert.equal(defaultIsTransient({ message: 'ECONNREFUSED' }), true);
    assert.equal(defaultIsTransient({ message: 'ETIMEDOUT' }), true);
    assert.equal(defaultIsTransient({ message: 'fetch failed' }), true);
    assert.equal(defaultIsTransient({ message: 'socket hang up' }), true);
  });
  it('returns false for non-network non-5xx errors', () => {
    assert.equal(defaultIsTransient({ message: 'bad input', status: 400 }), false);
  });
});

describe('ratelimit.createLimiter', () => {
  it('runs all tasks and preserves results/order', async () => {
    const lim = createLimiter({ rps: 1000, sleep: async () => {} });
    const out = await Promise.all([1, 2, 3].map((x) => lim.run(async () => x * 2)));
    assert.deepEqual(out, [2, 4, 6]);
  });

  it('a rejected task does not break the queue for subsequent tasks', async () => {
    const lim = createLimiter({ rps: 1000, sleep: async () => {} });
    const results = [];
    await Promise.allSettled([
      lim.run(async () => { throw new Error('task1 fails'); }),
      lim.run(async () => { results.push('task2'); return 'task2'; }),
      lim.run(async () => { results.push('task3'); return 'task3'; }),
    ]);
    assert.deepEqual(results, ['task2', 'task3']);
  });

  it('serializes tasks (each awaits the previous)', async () => {
    const order = [];
    // Use a fake sleep that records calls so we can verify ordering
    const fakeSleep = async (ms) => { order.push(`sleep:${ms}`); };
    // High rps so minGap ~0, tasks run sequentially but don't actually wait
    const lim = createLimiter({ rps: 1000, sleep: fakeSleep, now: (() => { let t = 0; return () => t += 10; })() });
    const r = await Promise.all([
      lim.run(async () => { order.push('a'); return 1; }),
      lim.run(async () => { order.push('b'); return 2; }),
      lim.run(async () => { order.push('c'); return 3; }),
    ]);
    assert.deepEqual(r, [1, 2, 3]);
    // Tasks must run in order a→b→c
    const tasks = order.filter((x) => !x.startsWith('sleep:'));
    assert.deepEqual(tasks, ['a', 'b', 'c']);
  });

  it('spacing: enforces minGap between tasks when now advances slowly', async () => {
    const slept = [];
    // now() returns same value each call → wait = minGap - 0 = minGap each time
    const lim = createLimiter({
      rps: 2,        // minGap = 500ms
      sleep: async (ms) => slept.push(ms),
      now: () => 0,  // always returns 0 → gap is always 0 → wait = minGap - 0 = 500
    });
    await Promise.all([1, 2].map((x) => lim.run(async () => x)));
    // First task: last=0, now=0, wait=500-0=500, but first run has last=0 too
    // Actually first task: wait = 500 - (0 - 0) = 500. Second: same.
    // Both tasks sleep 500ms
    assert.ok(slept.every((ms) => ms >= 499), `expected >= 499ms sleeps, got ${JSON.stringify(slept)}`);
  });
});
