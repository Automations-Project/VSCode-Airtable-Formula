import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Serializes exclusive work on the daemon's shared browser/auth path.
 *
 * TWO PRIMITIVES
 * --------------
 * - `runExclusive` — FIFO, one op at a time.
 * - `runBarrier` — for park/shutdown/reinit. Stops dequeue, waits out only the
 *   ACTIVE op, runs, then resumes. Deliberately does NOT drain the whole queue.
 *
 * Barriers are mutually exclusive with each other (serialized via barrierQueue).
 *
 * Nested runExclusive/runBarrier inside a held slot pass through via
 * schedulerDepth (process-global ALS — one scheduler per process is the
 * intended invariant). Nested acquires intentionally bypass the queue-cap
 * check; they cannot enqueue.
 */

const schedulerDepth = new AsyncLocalStorage();
const toolContext = new AsyncLocalStorage();

export function runInToolContext(ctx, fn) {
  return toolContext.run(ctx, fn);
}

export function currentToolContext() {
  return toolContext.getStore();
}

/**
 * Resolve an optional client id from an MCP request `extra` bag.
 * Missing / malformed → null (never throws).
 *
 * Sources (first win):
 *  1. extra.sessionId
 *  2. x-airtable-client-id header (case-insensitive; SDK requestInfo.headers)
 *  3. x-client-id header
 */
export function resolveToolClientId(extra) {
  try {
    if (!extra || typeof extra !== 'object') return null;
    if (typeof extra.sessionId === 'string' && extra.sessionId) return extra.sessionId;
    const headers = extra.requestInfo?.headers ?? extra.headers;
    if (!headers || typeof headers !== 'object') return null;

    const lookup = (name) => {
      const want = name.toLowerCase();
      for (const [k, v] of Object.entries(headers)) {
        if (String(k).toLowerCase() !== want) continue;
        if (Array.isArray(v)) {
          const first = v.find((x) => typeof x === 'string' && x.length > 0);
          return first ?? null;
        }
        if (typeof v === 'string' && v.length > 0) return v;
        return null;
      }
      return null;
    };

    return lookup('x-airtable-client-id') ?? lookup('x-client-id') ?? null;
  } catch {
    return null;
  }
}

/**
 * Outermost MCP tools/call wrap: names the async chain for PageScheduler labels.
 * Prefer this once at the request handler — do not scatter per-tool.
 *
 * `context` merges extra per-request facts into the ambient store. The daemon
 * passes `{ origin: 'local'|'tunnel' }` there so `manage_daemon` can tell a
 * loopback caller from a tunnel one without re-deriving it from headers — the
 * transport knows (it has the socket), the handler does not. Absent means the
 * call never crossed HTTP at all (in-process stdio), i.e. local.
 */
export function withToolDispatchContext(request, extra, fn, context) {
  const tool =
    typeof request?.params?.name === 'string' && request.params.name
      ? request.params.name
      : 'unknown';
  const clientId = resolveToolClientId(extra);
  return runInToolContext({ tool, clientId, ...context }, fn);
}

/** Thrown when the queue is at capacity. */
export class DaemonQueueFullError extends Error {
  constructor(depth, maxQueue) {
    super(
      `Auth queue saturated (${depth}/${maxQueue}). ` +
        `Retry after in-flight browser calls drain, or set AIRTABLE_MAX_AUTH_QUEUE to raise the cap.`,
    );
    this.name = 'DaemonQueueFullError';
    this.code = 'daemon_queue_full';
  }
}

export class PageScheduler {
  constructor(options = {}) {
    this.queue = [];
    this.active = null;
    this.activeSettled = null;
    this.barrierActive = false;
    this.barrierSettled = null;
    /** Serialize concurrent runBarrier acquires (while+flag is not atomic). */
    this.barrierQueue = Promise.resolve();
    /** True while inter-op rate delay is in progress after an exclusive op. */
    this.delaying = false;
    this.listeners = new Set();
    this.maxQueue = options.maxQueue ?? 64;
    this.now = options.now ?? Date.now;
    this._rateDelayMs = options.rateDelayMs ?? 0;
  }

  /**
   * Run `fn` with exclusive use of the shared page/auth path. FIFO by arrival.
   * `label` is a fallback — ambient tool context wins when present.
   */
  runExclusive(label, fn) {
    if (schedulerDepth.getStore() !== undefined) {
      // Nested acquire inside a held slot must pass through or we deadlock.
      return fn();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new DaemonQueueFullError(this.queue.length, this.maxQueue));
    }
    const ctx = currentToolContext();
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        label: ctx?.tool ?? label,
        clientId: ctx?.clientId ?? null,
        resolve,
        reject,
      });
      this.emit();
      this.pump();
    });
  }

  /**
   * Run `fn` (park/shutdown/reinit) with the page quiesced.
   * Fail-open: `finally` always clears the barrier.
   * Barriers are serialized through barrierQueue so concurrent callers cannot
   * both observe barrierActive=false and run fn at once.
   */
  runBarrier(fn) {
    if (schedulerDepth.getStore() !== undefined) {
      return fn();
    }
    const run = async () => {
      this.barrierActive = true;
      let release;
      this.barrierSettled = new Promise((r) => {
        release = r;
      });
      this.emit();
      try {
        // Wait out ONLY the currently in-flight exclusive op (activeSettled
        // spans the op + inter-op rate delay). Snapshot once — do not loop or
        // a back-to-back queue would make the barrier drain everything.
        const inFlight = this.activeSettled;
        if (inFlight) await inFlight.catch(() => {});
        return await this.withDepth(fn);
      } finally {
        this.barrierActive = false;
        this.barrierSettled = null;
        release();
        this.emit();
        this.pump();
      }
    };
    const result = this.barrierQueue.then(run, run);
    // Keep the chain alive even if this barrier rejects.
    this.barrierQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async whenReady() {
    while (this.barrierActive && this.barrierSettled) {
      await this.barrierSettled.catch(() => {});
    }
  }

  getBusyState() {
    return {
      // queued and delaying count as busy so idle-park does not arm mid-drain
      // or during inter-op rate delay.
      busy:
        this.active !== null ||
        this.barrierActive ||
        this.delaying ||
        this.queue.length > 0,
      active: this.active,
      queued: this.queue.length,
      /** True during inter-op rate delay (after exclusive op, before next pump). */
      delaying: this.delaying,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  onBusyChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  withDepth(fn) {
    const depth = (schedulerDepth.getStore() ?? 0) + 1;
    return schedulerDepth.run(depth, fn);
  }

  emit() {
    if (this.listeners.size === 0) return;
    const state = this.getBusyState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // A dashboard subscriber must never break the page pipeline.
      }
    }
  }

  pump() {
    if (this.active || this.barrierActive || this.delaying) return;
    const next = this.queue.shift();
    if (!next) {
      this.emit();
      return;
    }

    this.active = {
      tool: next.label,
      clientId: next.clientId,
      startedAt: new Date(this.now()).toISOString(),
    };
    this.emit();

    const run = async () => {
      try {
        next.resolve(await this.withDepth(next.fn));
      } catch (err) {
        next.reject(err);
      } finally {
        this.active = null;
        // Hold activeSettled through rate delay so barriers wait and pump
        // cannot start the next op early via a concurrent enqueue.
        if (this._rateDelayMs > 0 && this.queue.length > 0) {
          this.delaying = true;
          this.emit();
          try {
            await new Promise((r) => setTimeout(r, this._rateDelayMs));
          } finally {
            this.delaying = false;
          }
        }
        this.activeSettled = null;
        this.emit();
        this.pump();
      }
    };
    this.activeSettled = run();
  }
}
