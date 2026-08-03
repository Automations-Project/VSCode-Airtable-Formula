// Tests for `manage_daemon` — the model-facing daemon control surface.
//
// Nothing here touches the network beyond loopback, and nothing launches
// Chromium: `auth` is a plain object with the three diagnostic methods, and the
// "daemon" fixtures are real startDaemonServer instances with a hand-written
// lockfile pointing at them.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

import { manageDaemon, MANAGE_DAEMON_ACTIONS } from '../src/daemon/manage.js';
import { startDaemonServer } from '../src/daemon/server.js';
import { getLockfilePath, replace as replaceLock } from '../src/daemon/lockfile.js';
import { ensureToken, getTokenPath } from '../src/daemon/token.js';
import { adminRequest } from '../src/daemon/launcher.js';
import {
  requestDaemonExit, takeDaemonExit, peekDaemonExit, clearDaemonExit,
  discardDaemonExit, withDaemonExitOwner,
} from '../src/daemon/exit-intent.js';
import {
  clearStopSentinel, getStopSentinelPath, readStopSentinel, writeStopSentinel,
} from '../src/daemon/stop-sentinel.js';
import { getTunnelSettingsPath } from '../src/daemon/tunnel-providers/index.js';

// ─── helpers ──────────────────────────────────────────────────

function tmp(label) {
  return mkdtempSync(join(tmpdir(), `at-mgd-${label}-`));
}

const fakeAuth = (overrides = {}) => ({
  isSessionDead: () => false,
  getLastTrip: () => null,
  getBusyState: () => ({ busy: false, active: null, queued: 0, delaying: false, updatedAt: 'X' }),
  ...overrides,
});

/** A live daemon server plus the lockfile that advertises it. */
async function startFixtureDaemon(configDir, options = {}) {
  const uuid = options.uuid ?? randomUUID();
  const token = ensureToken({ tokenPath: getTokenPath(configDir) });
  const srv = await startDaemonServer({
    port: 0,
    configDir,
    uuid,
    version: '0.0.0-test',
    bearerToken: token.bearerToken,
    getTools: async () => [],
    ...options.serverOptions,
  });
  replaceLock({
    pid: process.pid,
    uuid,
    port: srv.port,
    port_lsp: null,
    bearerToken: token.bearerToken,
    version: '0.0.0-test',
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    tunnelUrl: null,
  }, { lockPath: getLockfilePath(configDir) });
  return { srv, uuid };
}

/** A lockfile for a daemon that is NOT answering (fixed high port, nothing bound). */
function writeDeadLockfile(configDir, overrides = {}) {
  const record = {
    pid: process.pid,
    uuid: 'uuid-dead',
    port: 1,           // port 1 is browser-blocked and never bound by this suite
    port_lsp: null,
    bearerToken: 'stale-bearer-token',
    version: '0.0.0-dead',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    tunnelUrl: null,
    ...overrides,
  };
  replaceLock(record, { lockPath: getLockfilePath(configDir) });
  return record;
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}

function callTool(port, bearer, name, args = {}, headers = {}, signal) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
    }),
  });
}

// ─── status ───────────────────────────────────────────────────

describe('manage_daemon status', () => {
  let dir;
  beforeEach(() => { dir = tmp('status'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports stdio + no daemon when nothing is running', async () => {
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth(), version: '1.2.3' });
    assert.equal(out.ok, true);
    assert.equal(out.daemon, null);
    assert.equal(out.process.isDaemonHolder, false);
    assert.match(out.process.transport, /^stdio/);
    assert.equal(out.process.version, '1.2.3');
    assert.equal(out.caller.origin, 'local');
  });

  it('never emits a bearer token, even with one sitting in the lockfile', async () => {
    writeDeadLockfile(dir, { bearerToken: 'SUPER-SECRET-BEARER' });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth() });
    const serialized = JSON.stringify(out);
    assert.ok(!serialized.includes('SUPER-SECRET-BEARER'), 'bearer token leaked into the status payload');
    assert.ok(!/bearerToken/i.test(serialized), 'status must not carry a bearerToken field at all');
  });

  it('knows it IS the daemon when the lockfile names this pid AND this uuid', async () => {
    const { srv, uuid } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon({ action: 'status' }, { configDir: dir, runtime: { uuid }, auth: fakeAuth() });
      assert.equal(out.process.isDaemonHolder, true);
      assert.equal(out.process.transport, 'daemon-http');
      assert.equal(out.daemon.healthy, true);
      assert.equal(out.daemon.port, srv.port);
      assert.ok(out.daemon.uptimeMs >= 5_000, 'uptime derives from the lockfile startedAt');
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('does NOT claim to be the daemon when the lockfile uuid differs (recycled pid)', async () => {
    writeDeadLockfile(dir, { uuid: 'someone-elses-uuid' });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, runtime: { uuid: 'mine' }, auth: fakeAuth() });
    assert.equal(out.process.isDaemonHolder, false);
  });

  it('does NOT claim to be the daemon without a runtime uuid, even on a pid match', async () => {
    writeDeadLockfile(dir); // pid === process.pid
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.process.isDaemonHolder, false);
  });

  it('surfaces the session diagnostics, including Airtable\'s captured response body', async () => {
    const auth = fakeAuth({
      isSessionDead: () => true,
      getLastTrip: () => ({ status: 403, reason: 'auth-403-persist', body: '{"error":{"type":"INVALID_PERMISSIONS"}}' }),
      getBusyState: () => ({ busy: true, active: { tool: 'sync_base' }, queued: 3, delaying: false, updatedAt: 'X' }),
    });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth });
    assert.equal(out.session.sessionDead, true);
    assert.equal(out.session.lastTrip.status, 403);
    assert.match(out.session.lastTrip.body, /INVALID_PERMISSIONS/);
    assert.equal(out.session.busy.queued, 3);
    assert.equal(out.session.busy.active.tool, 'sync_base');
  });

  it('tolerates an auth object that throws instead of failing the whole status', async () => {
    const auth = fakeAuth({ isSessionDead: () => { throw new Error('boom'); } });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth });
    assert.equal(out.ok, true);
    assert.equal(out.session.sessionDead, null);
  });

  it('never reclaims a stale lockfile — a read must not mutate', async () => {
    const lockPath = getLockfilePath(dir);
    writeDeadLockfile(dir, { pid: 999_999 }); // dead pid → getDaemonStatus would DELETE this with reclaimStale
    const before = readFileSync(lockPath, 'utf8');
    const mtimeBefore = statSync(lockPath).mtimeMs;

    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.daemon.stale, true);

    assert.ok(existsSync(lockPath), 'status deleted the lockfile');
    assert.equal(readFileSync(lockPath, 'utf8'), before, 'status rewrote the lockfile');
    assert.equal(statSync(lockPath).mtimeMs, mtimeBefore);
  });

  it('redacts host-identifying fields for a tunnel-origin caller', async () => {
    writeDeadLockfile(dir, { bearerToken: 'SUPER-SECRET-BEARER' });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, origin: 'tunnel', auth: fakeAuth() });

    assert.equal(out.caller.origin, 'tunnel');
    assert.equal(out.process.pid, null);
    assert.equal(out.daemon.pid, null);
    assert.equal(out.daemon.port, null);
    assert.equal(out.daemon.port_lsp, null);
    assert.equal(out.daemon.uuid, null);
    assert.equal(out.daemon.lockPath, null);
    assert.equal(out.configDir, null);
    assert.deepEqual(out.redacted, ['pid', 'port', 'port_lsp', 'uuid', 'lockPath', 'configDir']);
    // Non-identifying facts still come through — the point is a usable answer.
    assert.equal(out.daemon.version, '0.0.0-dead');
    assert.ok(!JSON.stringify(out).includes('SUPER-SECRET-BEARER'));
  });

  it('returns the local status un-redacted', async () => {
    writeDeadLockfile(dir);
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.process.pid, process.pid);
    assert.equal(out.redacted, undefined);
  });
});

// ─── refusals ─────────────────────────────────────────────────

describe('manage_daemon refusals', () => {
  let dir;
  beforeEach(() => { dir = tmp('refuse'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const MUTATING = MANAGE_DAEMON_ACTIONS.filter((a) => a !== 'status');

  for (const action of MUTATING) {
    it(`refuses "${action}" for a tunnel-origin caller and says what to run instead`, async () => {
      const out = await manageDaemon({ action }, { configDir: dir, origin: 'tunnel', auth: fakeAuth() });
      assert.equal(out.refused, true);
      assert.equal(out.ok, false);
      assert.equal(out.action, action);
      assert.match(out.reason, /local-only/);
      assert.ok(out.runInstead && out.runInstead.length > 0, 'a refusal must name the alternative');
    });
  }

  it('still answers "status" for a tunnel caller (refusal is not the default)', async () => {
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, origin: 'tunnel', auth: fakeAuth() });
    assert.equal(out.ok, true);
    assert.equal(out.refused, undefined);
  });

  it('refuses token_rotate when no healthy daemon is answering', async () => {
    writeDeadLockfile(dir);
    const out = await manageDaemon({ action: 'token_rotate' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.refused, true);
    assert.match(out.reason, /no healthy daemon/i);
    assert.match(out.runInstead, /daemon start/);
  });

  it('refuses tunnel_enable and tunnel_disable when no daemon is running', async () => {
    for (const action of ['tunnel_enable', 'tunnel_disable']) {
      const out = await manageDaemon({ action }, { configDir: dir, auth: fakeAuth() });
      assert.equal(out.refused, true, action);
      assert.match(out.reason, /owned by the daemon/);
    }
  });

  it('refuses the ngrok provider (its authtoken never reaches the daemon)', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'tunnel_enable', provider: 'ngrok' },
        { configDir: dir, auth: fakeAuth() },
      );
      assert.equal(out.refused, true);
      assert.match(out.reason, /SecretStorage/);
      assert.match(out.runInstead, /dashboard/);
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('refuses an unknown tunnel provider', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'tunnel_enable', provider: 'ssh-reverse' },
        { configDir: dir, auth: fakeAuth() },
      );
      assert.equal(out.refused, true);
      assert.match(out.runInstead, /cf-quick/);
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('refuses "start" when this process already holds the shared Chrome profile', async () => {
    const out = await manageDaemon(
      { action: 'start' },
      { configDir: dir, auth: fakeAuth({ context: {} }) },
    );
    assert.equal(out.refused, true);
    assert.match(out.reason, /second Chromium/);
    assert.match(out.reason, /21/);
    assert.match(out.runInstead, /daemon start|byo/);
  });

  it('does not apply the profile guard in browser-free auth modes', async () => {
    const previous = process.env.AIRTABLE_AUTH_MODE;
    process.env.AIRTABLE_AUTH_MODE = 'byo';
    try {
      const { srv } = await startFixtureDaemon(dir);
      try {
        // A healthy daemon exists, so this short-circuits to the no-op branch —
        // reaching it at all proves the contention guard did not fire.
        const out = await manageDaemon({ action: 'start' }, { configDir: dir, auth: fakeAuth({ context: {} }) });
        assert.equal(out.refused, undefined);
        assert.equal(out.noop, true);
      } finally {
        await srv.stop().catch(() => {});
      }
    } finally {
      if (previous === undefined) delete process.env.AIRTABLE_AUTH_MODE;
      else process.env.AIRTABLE_AUTH_MODE = previous;
    }
  });

  it('throws with the valid action list on an unknown action', async () => {
    await assert.rejects(
      () => manageDaemon({ action: 'nuke' }, { configDir: dir }),
      /Unknown action "nuke".*status, start, restart, stop/s,
    );
  });
});

// ─── idempotency / no-ops ─────────────────────────────────────

describe('manage_daemon idempotency', () => {
  let dir;
  beforeEach(() => { dir = tmp('idem'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports stop as an explicit no-op when nothing is running', async () => {
    const out = await manageDaemon({ action: 'stop' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.ok, true);
    assert.equal(out.stopped, false);
    assert.equal(out.noop, true);
    assert.match(out.note, /No daemon is running/);
  });

  it('reports stop as a no-op when the lockfile is stale rather than pretending', async () => {
    writeDeadLockfile(dir, { pid: 999_999 });
    const out = await manageDaemon({ action: 'stop' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.stopped, false);
    assert.equal(out.noop, true);
    assert.match(out.note, /not answering/);
  });

  it('start attaches to a healthy daemon instead of starting a second one', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      let spawned = 0;
      const out = await manageDaemon(
        { action: 'start' },
        { configDir: dir, auth: fakeAuth(), spawnDaemon: async () => { spawned++; } },
      );
      assert.equal(out.started, false);
      assert.equal(out.noop, true);
      assert.equal(out.daemon.port, srv.port);
      assert.equal(spawned, 0, 'a healthy daemon must never be joined by a second one');
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('start as the holder is a no-op naming this process', async () => {
    const { srv, uuid } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon({ action: 'start' }, { configDir: dir, runtime: { uuid }, auth: fakeAuth() });
      assert.equal(out.started, false);
      assert.equal(out.noop, true);
      assert.match(out.note, new RegExp(`pid ${process.pid}`));
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('start spawns a daemon when none is running and reports the real connection', async () => {
    const started = [];
    // Stands in for the detached `daemon start` child: ensureDaemon polls until a
    // HEALTHY daemon answers, so the fake has to produce a genuine one.
    const spawnDaemon = async () => { started.push((await startFixtureDaemon(dir)).srv); };
    try {
      const out = await manageDaemon({ action: 'start' }, { configDir: dir, auth: fakeAuth(), spawnDaemon });
      assert.equal(out.started, true);
      assert.equal(out.daemon.port, started[0].port);
      assert.equal(out.daemon.pid, process.pid);
      assert.ok(!JSON.stringify(out).includes(started[0].bearerToken), 'start leaked the bearer token');
    } finally {
      for (const s of started) await s.stop().catch(() => {});
    }
  });

  it('restart with no daemon running starts one and says so, instead of failing', async () => {
    const started = [];
    const spawnDaemon = async () => { started.push((await startFixtureDaemon(dir)).srv); };
    try {
      const out = await manageDaemon({ action: 'restart' }, { configDir: dir, auth: fakeAuth(), spawnDaemon });
      assert.equal(out.ok, true);
      assert.equal(out.restarted, false);
      assert.equal(out.started, true);
      assert.match(out.note, /No daemon was running/);
    } finally {
      for (const s of started) await s.stop().catch(() => {});
    }
  });

  it('restart refuses when this process already holds the shared Chrome profile', async () => {
    const out = await manageDaemon({ action: 'restart' }, { configDir: dir, auth: fakeAuth({ context: {} }) });
    assert.equal(out.refused, true);
    assert.match(out.reason, /same profile/);
  });

  it('start clears a stop sentinel so a deliberate stop cannot wedge the next start', async () => {
    writeStopSentinel({ configDir: dir, by: 'test' });
    assert.ok(existsSync(getStopSentinelPath(dir)));
    const { srv } = await startFixtureDaemon(dir);
    try {
      await manageDaemon({ action: 'start' }, { configDir: dir, auth: fakeAuth() });
      assert.equal(existsSync(getStopSentinelPath(dir)), false);
    } finally {
      await srv.stop().catch(() => {});
    }
  });
});

// ─── stop/restart vs an exit already staged ───────────────────

describe('manage_daemon when an exit is already staged', () => {
  let dir;
  beforeEach(() => { dir = tmp('staged'); clearDaemonExit(); });
  afterEach(() => { clearDaemonExit(); rmSync(dir, { recursive: true, force: true }); });

  it('stop as the holder stages the exit and reports stopping', async () => {
    const { srv, uuid } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'stop', reason: 'because' },
        { configDir: dir, runtime: { uuid }, auth: fakeAuth() },
      );
      assert.equal(out.ok, true);
      assert.equal(out.stopping, true);
      assert.equal(peekDaemonExit()?.action, 'stop');
      assert.equal(peekDaemonExit()?.reason, 'because');
    } finally {
      clearDaemonExit();
      await srv.stop().catch(() => {});
    }
  });

  it('stop as the holder is refused when another in-flight request already staged an exit', async () => {
    const { srv, uuid } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'stop' },
        {
          configDir: dir, runtime: { uuid }, auth: fakeAuth(),
          stageExit: () => ({ staged: false, pending: { action: 'restart', by: 'manage_daemon' } }),
        },
      );
      assert.equal(out.refused, true);
      assert.equal(out.ok, false);
      assert.match(out.reason, /already staged/i);
      assert.match(out.reason, /restart/);
      assert.match(out.runInstead, /status/);
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('restart as the holder is refused when another in-flight request already staged an exit', async () => {
    const { srv, uuid } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'restart' },
        {
          configDir: dir, runtime: { uuid }, auth: fakeAuth(),
          stageExit: () => ({ staged: false, pending: { action: 'stop', by: 'manage_daemon' } }),
        },
      );
      assert.equal(out.refused, true);
      assert.match(out.reason, /already staged/i);
    } finally {
      await srv.stop().catch(() => {});
    }
  });
});

// ─── through the daemon's own routes ──────────────────────────

describe('manage_daemon drives the daemon through its own routes', () => {
  let dir;
  beforeEach(() => { dir = tmp('routes'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('token_rotate goes through POST /daemon/rotate-token and never returns the token', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      const before = srv.bearerToken;
      const out = await manageDaemon(
        { action: 'token_rotate' },
        { configDir: dir, auth: fakeAuth(), request: adminRequest },
      );
      assert.equal(out.rotated, true);
      assert.ok(out.rotatedAt);
      assert.notEqual(srv.bearerToken, before, 'the live server must adopt the new bearer');
      const serialized = JSON.stringify(out);
      assert.ok(!serialized.includes(srv.bearerToken), 'token_rotate leaked the new bearer');
      assert.ok(!serialized.includes(before), 'token_rotate leaked the old bearer');
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('tunnel_disable goes through the route and persists enabled:false', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'tunnel_disable' },
        { configDir: dir, auth: fakeAuth(), request: adminRequest },
      );
      assert.equal(out.ok, true);
      assert.equal(out.enabled, false);
      const settings = JSON.parse(readFileSync(getTunnelSettingsPath(dir), 'utf8'));
      assert.equal(settings.enabled, false);
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('tunnel_enable turns the route\'s 428 (binary missing) into a refusal with a setup command', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      const out = await manageDaemon(
        { action: 'tunnel_enable', provider: 'cf-quick' },
        { configDir: dir, auth: fakeAuth(), request: adminRequest },
      );
      assert.equal(out.refused, true);
      assert.match(out.runInstead, /install-tunnel/);
      // The route checks the binary BEFORE persisting anything, so a refused
      // enable must leave no settings behind at all — the "stuck on Starting…"
      // state the 428 branch exists to prevent.
      assert.equal(existsSync(getTunnelSettingsPath(dir)), false);
    } finally {
      await srv.stop().catch(() => {});
    }
  });

  it('stop against a daemon in another process uses /daemon/shutdown and writes the sentinel', async () => {
    const { srv } = await startFixtureDaemon(dir);
    try {
      // No `runtime` → isHolder is false, i.e. "the daemon is somebody else".
      const out = await manageDaemon(
        { action: 'stop', reason: 'freeing the Chrome profile' },
        { configDir: dir, auth: fakeAuth(), request: adminRequest },
      );
      assert.equal(out.stopped, true);
      assert.equal(out.via, '/daemon/shutdown');

      const sentinel = readStopSentinel({ configDir: dir });
      assert.ok(sentinel, 'a delegated stop must still record the sentinel');
      assert.equal(sentinel.by, 'manage_daemon');
      assert.equal(sentinel.reason, 'freeing the Chrome profile');
      assert.equal(sentinel.pid, process.pid);
    } finally {
      await srv.stop().catch(() => {});
    }
  });
});

// ─── stop sentinel ────────────────────────────────────────────

describe('stop sentinel', () => {
  let dir;
  beforeEach(() => { dir = tmp('sentinel'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips write → read → clear', () => {
    assert.equal(readStopSentinel({ configDir: dir }), null);
    const written = writeStopSentinel({ configDir: dir, pid: 4242, uuid: 'u', by: 'manage_daemon', reason: 'r' });
    assert.equal(written.pid, 4242);

    const read = readStopSentinel({ configDir: dir });
    assert.equal(read.pid, 4242);
    assert.equal(read.by, 'manage_daemon');
    assert.ok(Date.parse(read.stoppedAt) > 0);

    assert.equal(clearStopSentinel({ configDir: dir }), true);
    assert.equal(readStopSentinel({ configDir: dir }), null);
    assert.equal(clearStopSentinel({ configDir: dir }), false, 'clearing twice is a no-op, not an error');
  });

  it('reads a corrupt sentinel as absent — it must never wedge a start', () => {
    writeFileSync(getStopSentinelPath(dir), '{ this is not json');
    assert.equal(readStopSentinel({ configDir: dir }), null);
  });

  it('surfaces in status so the model can see WHY no daemon is running', async () => {
    writeStopSentinel({ configDir: dir, by: 'manage_daemon', reason: 'user asked' });
    const out = await manageDaemon({ action: 'status' }, { configDir: dir, auth: fakeAuth() });
    assert.equal(out.stopSentinel.reason, 'user asked');
  });
});

// ─── exit-intent slot: overwrite refusal + owner-death scavenging ──

describe('exit intent slot', () => {
  beforeEach(() => clearDaemonExit());
  afterEach(() => clearDaemonExit());

  it('refuses to overwrite a still-pending intent and keeps the first owner', () => {
    const ownerA = Symbol('A');
    const ownerB = Symbol('B');
    const first = withDaemonExitOwner(ownerA, () => requestDaemonExit({ action: 'stop', by: 'A' }));
    assert.equal(first.staged, true);

    const second = withDaemonExitOwner(ownerB, () => requestDaemonExit({ action: 'restart', by: 'B' }));
    assert.equal(second.staged, false, 'a second stage while one is pending must be refused');
    assert.equal(second.pending.action, 'stop', 'the refusal must name what is already staged');

    // Ownership is unchanged: B cannot take it, A still can.
    assert.equal(peekDaemonExit()?.by, 'A', 'the second request overwrote the first intent');
    assert.equal(takeDaemonExit(ownerB), null);
    assert.equal(takeDaemonExit(ownerA)?.action, 'stop');
  });

  it('owner-death discard clears the slot so a retry can stage — without executing', () => {
    const ownerA = Symbol('A');
    withDaemonExitOwner(ownerA, () => requestDaemonExit({ action: 'stop', by: 'A' }));
    assert.equal(discardDaemonExit(ownerA), true);
    assert.equal(peekDaemonExit(), null);

    const ownerB = Symbol('B');
    const retry = withDaemonExitOwner(ownerB, () => requestDaemonExit({ action: 'stop', by: 'B' }));
    assert.equal(retry.staged, true, 'a scavenged slot must accept the retried stop');
    assert.equal(takeDaemonExit(ownerB)?.by, 'B');
  });

  it('a non-owner cannot discard someone else\'s pending intent', () => {
    const ownerA = Symbol('A');
    withDaemonExitOwner(ownerA, () => requestDaemonExit({ action: 'stop', by: 'A' }));
    assert.equal(discardDaemonExit(Symbol('B')), false);
    assert.equal(discardDaemonExit(undefined), false);
    assert.equal(peekDaemonExit()?.by, 'A');
  });
});

// ─── mechanism 1: the post-response exit hook ─────────────────

describe('post-response exit hook', () => {
  let dir;

  beforeEach(() => {
    dir = tmp('hook');
    clearDaemonExit(); // no intent may leak between tests
  });
  afterEach(() => {
    clearDaemonExit();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers the tool call IN FULL, then exits — never the other way round', async () => {
    const events = [];
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'hook-uuid',
      getTools: async () => [],
      callTool: async () => {
        events.push('handler');
        // Exactly what manage_daemon's handler does: state the intent, answer normally.
        requestDaemonExit({ action: 'stop', by: 'manage_daemon', reason: null });
        // While the handler is still running the intent must be UNCONSUMED —
        // if anything took it here, the exit would race the response.
        assert.equal(peekDaemonExit()?.action, 'stop');
        return { content: [{ type: 'text', text: '{"action":"stop","stopping":true}' }] };
      },
      onShutdown: async () => { events.push('shutdown'); },
    });

    let response;
    try {
      response = await callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' });
      assert.equal(response.status, 200);
      const body = await response.json();
      // The deadlock this design exists to avoid produces NO body at all.
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, 1);
      assert.match(body.result.content[0].text, /"stopping":true/);

      await waitFor(() => events.includes('shutdown'));
      assert.deepEqual(events, ['handler', 'shutdown'], 'the exit must run after the handler, not during it');
      assert.equal(takeDaemonExit(), null, 'the hook consumes the intent exactly once');
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('only the response that staged an exit intent may consume it', async () => {
    const events = [];
    let releaseOrdinary;
    let releaseStop;
    let ordinaryStartedResolve;
    let stopStagedResolve;
    const ordinaryGate = new Promise((resolve) => { releaseOrdinary = resolve; });
    const stopGate = new Promise((resolve) => { releaseStop = resolve; });
    const ordinaryStarted = new Promise((resolve) => { ordinaryStartedResolve = resolve; });
    const stopStaged = new Promise((resolve) => { stopStagedResolve = resolve; });
    const stopAbort = new AbortController();
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'owned-hook-uuid',
      getTools: async () => [],
      callTool: async (request) => {
        if (request.params.name === 'slow_read') {
          ordinaryStartedResolve();
          await ordinaryGate;
          return { content: [{ type: 'text', text: 'ordinary complete' }] };
        }
        requestDaemonExit({ action: 'stop', by: 'manage_daemon', reason: null });
        stopStagedResolve();
        await stopGate;
        return { content: [{ type: 'text', text: '{"stopping":true}' }] };
      },
      onShutdown: async () => { events.push('shutdown'); },
    });

    let ordinaryCall;
    let stopCall;
    try {
      // Start an ordinary request first, then hold the stop request after it has
      // staged the process-wide intent but before it can flush its own answer.
      ordinaryCall = callTool(server.port, server.bearerToken, 'slow_read');
      await ordinaryStarted;
      stopCall = callTool(
        server.port,
        server.bearerToken,
        'manage_daemon',
        { action: 'stop' },
        {},
        stopAbort.signal,
      );
      await stopStaged;

      // Finishing the older request must not steal the newer request's intent.
      releaseOrdinary();
      const ordinaryResponse = await ordinaryCall;
      assert.equal(ordinaryResponse.status, 200);
      await ordinaryResponse.json();
      assert.equal(peekDaemonExit()?.action, 'stop', 'the unrelated response consumed the stop intent');
      assert.deepEqual(events, [], 'shutdown began before the stop response could finish');

      releaseStop();
      const stopResponse = await stopCall;
      assert.equal(stopResponse.status, 200);
      const body = await stopResponse.json();
      assert.match(body.result.content[0].text, /"stopping":true/);
      await waitFor(() => events.includes('shutdown'));
    } finally {
      releaseOrdinary();
      releaseStop();
      stopAbort.abort();
      await Promise.allSettled([ordinaryCall, stopCall].filter(Boolean));
      await server.stop().catch(() => {});
    }
  });

  it('a staging request that aborts before flushing scavenges its intent — a retried stop still stops the daemon', async () => {
    const events = [];
    let calls = 0;
    let releaseFirst;
    let firstStagedResolve;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const firstStaged = new Promise((resolve) => { firstStagedResolve = resolve; });
    const abort = new AbortController();
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'scavenge-uuid',
      getTools: async () => [],
      callTool: async () => {
        calls += 1;
        const result = requestDaemonExit({ action: 'stop', by: `caller-${calls}`, reason: null });
        if (calls === 1) {
          firstStagedResolve();
          await firstGate; // hold the response open so the abort lands pre-flush
        }
        return { content: [{ type: 'text', text: JSON.stringify({ stopping: true, staged: result?.staged !== false }) }] };
      },
      onShutdown: async () => { events.push('shutdown'); },
    });

    let firstCall;
    try {
      firstCall = callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' }, {}, abort.signal);
      await firstStaged;
      assert.equal(peekDaemonExit()?.by, 'caller-1');

      // The client goes away before the response can flush: 'close' with no
      // 'finish'. The wedge this pins: without scavenging, the slot stays owned
      // by a response that can never finish, and no later stop can ever stage.
      // The gate stays HELD until the server has observed the close (the
      // scavenger runs on socket close even while the handler is pending) —
      // releasing earlier would race the abort against a normal 'finish'.
      abort.abort();
      await Promise.allSettled([firstCall]);
      await waitFor(() => peekDaemonExit() === null);
      assert.deepEqual(events, [], 'an aborted stop must never execute — its caller got no confirmation');
      releaseFirst(); // let the zombie handler unwind into its closed transport

      const retry = await callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' });
      assert.equal(retry.status, 200);
      const body = await retry.json();
      assert.match(body.result.content[0].text, /"staged":true/);
      await waitFor(() => events.includes('shutdown'));
    } finally {
      releaseFirst();
      abort.abort();
      await Promise.allSettled([firstCall].filter(Boolean));
      await server.stop().catch(() => {});
    }
  });

  it('a second stop racing a pending one cannot steal or orphan the slot — the first flushed confirmation still exits', async () => {
    const events = [];
    const staged = [];
    let calls = 0;
    let releaseA;
    let releaseB;
    let aStagedResolve;
    let bStagedResolve;
    const gateA = new Promise((resolve) => { releaseA = resolve; });
    const gateB = new Promise((resolve) => { releaseB = resolve; });
    const aStaged = new Promise((resolve) => { aStagedResolve = resolve; });
    const bStaged = new Promise((resolve) => { bStagedResolve = resolve; });
    const abortB = new AbortController();
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'race-uuid',
      getTools: async () => [],
      callTool: async () => {
        calls += 1;
        const who = calls === 1 ? 'A' : 'B';
        staged.push({ who, result: requestDaemonExit({ action: 'stop', by: who, reason: null }) });
        if (who === 'A') { aStagedResolve(); await gateA; }
        else { bStagedResolve(); await gateB; }
        return { content: [{ type: 'text', text: '{"stopping":true}' }] };
      },
      onShutdown: async () => { events.push('shutdown'); },
    });

    let callA;
    let callB;
    try {
      callA = callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' });
      await aStaged;
      callB = callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' }, {}, abortB.signal);
      await bStaged;

      // B must be refused, not overwrite: A's ownership survives.
      assert.equal(staged[0].result?.staged, true);
      assert.equal(staged[1].result?.staged, false, 'the second stage while one is pending must be refused');
      assert.equal(peekDaemonExit()?.by, 'A', 'the racing request stole the slot');

      // B's client aborts before B's response can flush. Its close-scavenger
      // must not touch A's intent — B owns nothing. B's gate stays held until
      // the server-side 'close' has landed, so the scavenger runs for certain.
      abortB.abort();
      await Promise.allSettled([callB]);
      await new Promise((r) => setTimeout(r, 50)); // let the server-side 'close' land
      assert.equal(peekDaemonExit()?.by, 'A', 'B\'s abort discarded an intent it did not own');
      releaseB();

      // A's response flushes — and the exit it was promised actually runs.
      releaseA();
      const responseA = await callA;
      assert.equal(responseA.status, 200);
      const body = await responseA.json();
      assert.match(body.result.content[0].text, /"stopping":true/);
      await waitFor(() => events.includes('shutdown'));
      assert.ok(existsSync(getStopSentinelPath(dir)), 'the flushed stop must write the sentinel on its way down');
    } finally {
      releaseA();
      releaseB();
      abortB.abort();
      await Promise.allSettled([callA, callB].filter(Boolean));
      await server.stop().catch(() => {});
    }
  });

  it('a stop through /mcp writes the sentinel as the process goes down', async () => {
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'sentinel-uuid',
      getTools: async () => [],
      callTool: async () => {
        requestDaemonExit({ action: 'stop', by: 'manage_daemon', reason: 'because' });
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    try {
      await callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'stop' });
      await waitFor(() => existsSync(getStopSentinelPath(dir)));
      const sentinel = readStopSentinel({ configDir: dir });
      assert.equal(sentinel.uuid, 'sentinel-uuid');
      assert.equal(sentinel.pid, process.pid);
      assert.equal(sentinel.reason, 'because');
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('a restart CLEARS the sentinel and spawns a replacement — a restart is not a stop', async () => {
    writeStopSentinel({ configDir: dir, by: 'earlier-stop' });
    const spawns = [];
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      uuid: 'restart-uuid',
      getTools: async () => [],
      // The real respawn is a detached `daemon start` that would outlive the run.
      spawnDaemon: async (opts) => { spawns.push(opts); },
      callTool: async () => {
        requestDaemonExit({ action: 'restart', by: 'manage_daemon' });
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    try {
      await callTool(server.port, server.bearerToken, 'manage_daemon', { action: 'restart' });
      await waitFor(() => spawns.length === 1);
      assert.equal(existsSync(getStopSentinelPath(dir)), false, 'a restart must not leave a stop sentinel behind');
      assert.equal(spawns[0].configDir, dir);
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('an ordinary tool call with no intent staged has no side effect', async () => {
    const events = [];
    const server = await startDaemonServer({
      port: 0,
      configDir: dir,
      getTools: async () => [],
      callTool: async () => ({ content: [{ type: 'text', text: 'plain' }] }),
      onShutdown: async () => { events.push('shutdown'); },
    });
    try {
      const response = await callTool(server.port, server.bearerToken, 'list_tables');
      assert.equal(response.status, 200);
      await new Promise((r) => setTimeout(r, 150));
      assert.deepEqual(events, []);
      assert.equal(existsSync(getStopSentinelPath(dir)), false);
      // Still serving.
      const again = await callTool(server.port, server.bearerToken, 'list_tables');
      assert.equal(again.status, 200);
    } finally {
      await server.stop().catch(() => {});
    }
  });
});

// ─── mechanism 2: caller origin plumbing ──────────────────────

describe('caller origin reaches the tool handler', () => {
  let dir;
  let server;
  let seen;

  before(async () => {
    dir = tmp('origin');
    seen = [];
    const { currentToolContext } = await import('../src/page-scheduler.js');
    server = await startDaemonServer({
      port: 0,
      configDir: dir,
      getTools: async () => [],
      callTool: async () => {
        seen.push(currentToolContext()?.origin ?? null);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
  });

  after(async () => {
    if (server) await server.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });

  it('a loopback call is local', async () => {
    seen.length = 0;
    await callTool(server.port, server.bearerToken, 'manage_daemon');
    assert.deepEqual(seen, ['local']);
  });

  it('a forwarded (tunnel) call is tunnel — same signal the /daemon/* allowlist uses', async () => {
    seen.length = 0;
    await callTool(server.port, server.bearerToken, 'manage_daemon', {}, { 'X-Forwarded-For': '203.0.113.9' });
    assert.deepEqual(seen, ['tunnel']);
  });

  it('the tool label still reaches the scheduler alongside the origin', async () => {
    const { currentToolContext } = await import('../src/page-scheduler.js');
    const labels = [];
    const dir2 = tmp('origin2');
    const s = await startDaemonServer({
      port: 0,
      configDir: dir2,
      getTools: async () => [],
      callTool: async () => {
        labels.push(currentToolContext()?.tool);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    try {
      await callTool(s.port, s.bearerToken, 'sync_base');
      assert.deepEqual(labels, ['sync_base']);
    } finally {
      await s.stop().catch(() => {});
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

// ─── regression: the stdio dispatcher's missing import ────────

describe('in-process stdio dispatch', () => {
  it('imports every page-scheduler helper it calls', () => {
    // src/index.js used withToolDispatchContext without importing it, so EVERY
    // tools/call on the AIRTABLE_NO_DAEMON stdio path threw
    // "withToolDispatchContext is not defined" before reaching its handler.
    // Only the daemon path (which imports it in daemon/server.js) worked.
    const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    const imported = new Set(
      [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/page-scheduler\.js'/g)]
        .flatMap((m) => m[1].split(',').map((s) => s.trim())),
    );
    for (const helper of ['withToolDispatchContext', 'currentToolContext']) {
      assert.ok(
        !source.includes(`${helper}(`) || imported.has(helper),
        `src/index.js calls ${helper}() without importing it from page-scheduler.js`,
      );
    }
  });
});
