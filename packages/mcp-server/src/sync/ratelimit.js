/**
 * ratelimit.js — token-bucket serializer + transient retry with exponential backoff
 *
 * Clock and randomness are injectable so the live path uses real Date.now/Math.random
 * while tests inject deterministic stubs and pass rps:1000 to eliminate real delays.
 */

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns true for errors that are safe to retry:
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx (server errors)
 *   - Network-level failures (connection refused, timeout, fetch failure, etc.)
 */
export function defaultIsTransient(err) {
  const s = err && err.status;
  if (s === 429 || (s >= 500 && s < 600)) return true;
  return /network|fetch|ECONN|ETIMEDOUT|socket/i.test(String(err && err.message));
}

/**
 * Retry `fn` on transient errors with exponential backoff + jitter.
 *
 * @param {() => Promise<T>} fn              - The operation to retry
 * @param {object}           opts
 * @param {number}           opts.retries     - Max retries (default 4); after which the last error is rethrown
 * @param {(ms:number)=>Promise<void>} opts.sleep  - Sleep fn (default: real setTimeout)
 * @param {()=>number}       opts.rand        - Random source for jitter (default: Math.random)
 * @param {(err:any)=>boolean} opts.isTransient - Predicate (default: defaultIsTransient)
 * @param {number}           opts.baseMs      - Backoff base in ms (default 500)
 * @param {number}           opts.penaltyMs   - Floor for 429 when no retryAfterMs (default 30000)
 * @returns {Promise<T>}
 */
export async function withRetry(
  fn,
  {
    retries = 4,
    sleep = realSleep,
    rand = Math.random,
    isTransient = defaultIsTransient,
    baseMs = 500,
    penaltyMs = 30000,
  } = {},
) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err;
      // Honor explicit retryAfterMs; fall back to 429 penalty or plain backoff
      const retryAfterMs = err.retryAfterMs ?? (err.status === 429 ? penaltyMs : 0);
      const backoff = baseMs * 2 ** attempt + Math.floor(rand() * baseMs);
      await sleep(Math.max(retryAfterMs, backoff));
      attempt++;
    }
  }
}

/**
 * Creates a rate-limiting queue that serializes tasks to at most `rps` calls/second.
 *
 * Tasks are chained on a single promise so they always run one-at-a-time in submission
 * order. A rejected task leaves the chain intact so subsequent tasks still run.
 *
 * @param {object}           opts
 * @param {number}           opts.rps   - Max requests per second (default 5)
 * @param {(ms:number)=>Promise<void>} opts.sleep - Sleep fn (default: real setTimeout)
 * @param {()=>number}       opts.now   - Monotonic clock in ms (default: Date.now)
 * @returns {{ run: (fn: () => Promise<T>) => Promise<T> }}
 */
export function createLimiter({ rps = 5, sleep = realSleep, now = () => Date.now() } = {}) {
  const minGap = 1000 / rps; // minimum ms between task starts
  let chain = Promise.resolve();
  let lastStart = 0;           // timestamp of the most recent task start

  const run = (fn) => {
    // Capture the result promise separately from the chain so:
    //   - `run()` callers get the real result (or rejection) from `fn`
    //   - `chain` swallows rejections to keep the queue alive
    const p = chain.then(async () => {
      const wait = minGap - (now() - lastStart);
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return fn();
    });
    // Keep chain alive even when a task rejects
    chain = p.catch(() => {});
    return p;
  };

  return { run };
}
